/**
 * dispatch-app-notifications
 *
 * Handles in-app + email notifications for count workflow events:
 *   COUNT_SUBMITTED, COUNT_APPROVED, SMART_ORDER_READY
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  APP_BASE_URL,
  emailWrapper,
  formatUsd,
  resolveOwnerManagerMembers,
  sendMargin6Email,
  userWantsEmail,
} from "../_shared/margin6Email.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type RiskLevel = "NO_PAR" | "RED" | "YELLOW" | "GREEN";

function computeRiskLevel(
  currentStock: number | null | undefined,
  parLevel: number | null | undefined,
  thresholds?: { redThresholdPercent?: number; yellowThresholdPercent?: number },
): RiskLevel {
  const stock = currentStock ?? 0;
  if (parLevel == null || parLevel <= 0) return "NO_PAR";
  const red = thresholds?.redThresholdPercent ?? 50;
  const yellow = thresholds?.yellowThresholdPercent ?? 100;
  const percent = Math.round((stock / parLevel) * 100);
  if (stock <= 0 || percent <= red) return "RED";
  if (percent <= yellow) return "YELLOW";
  return "GREEN";
}

function displayName(profile: { full_name: string | null; email: string | null } | null | undefined): string {
  if (profile?.full_name?.trim()) return profile.full_name.trim();
  if (profile?.email) return profile.email.split("@")[0];
  return "A team member";
}

async function loadRiskThresholds(supabase: ReturnType<typeof createClient>, restaurantId: string) {
  const { data } = await supabase
    .from("smart_order_settings")
    .select("red_threshold, yellow_threshold")
    .eq("restaurant_id", restaurantId)
    .maybeSingle();

  return {
    redThresholdPercent: data?.red_threshold ?? 50,
    yellowThresholdPercent: data?.yellow_threshold ?? 100,
  };
}

async function countSessionRiskStats(
  supabase: ReturnType<typeof createClient>,
  sessionId: string,
  restaurantId: string,
) {
  const thresholds = await loadRiskThresholds(supabase, restaurantId);
  const { data: items } = await supabase
    .from("inventory_session_items")
    .select("current_stock, par_level")
    .eq("session_id", sessionId);

  let critical = 0;
  let low = 0;
  let ok = 0;
  for (const row of items ?? []) {
    const risk = computeRiskLevel(Number(row.current_stock), row.par_level, thresholds);
    if (risk === "RED") critical += 1;
    else if (risk === "YELLOW") low += 1;
    else if (risk === "GREEN") ok += 1;
  }

  return {
    itemCount: items?.length ?? 0,
    criticalCount: critical,
    lowCount: low,
    okCount: ok,
  };
}

async function handleCountSubmitted(
  supabase: ReturnType<typeof createClient>,
  supabaseUrl: string,
  serviceKey: string,
  sessionId: string,
) {
  const { data: session } = await supabase
    .from("inventory_sessions")
    .select("id, restaurant_id, created_by, name")
    .eq("id", sessionId)
    .maybeSingle();

  if (!session) return { ok: false, error: "Session not found" };

  const { data: restaurant } = await supabase
    .from("restaurants")
    .select("name")
    .eq("id", session.restaurant_id)
    .maybeSingle();

  const restaurantName = restaurant?.name ?? "Your restaurant";
  const stats = await countSessionRiskStats(supabase, sessionId, session.restaurant_id);

  const { data: submitterProfile } = session.created_by
    ? await supabase
      .from("profiles")
      .select("full_name, email")
      .eq("id", session.created_by)
      .maybeSingle()
    : { data: null };

  const staffName = displayName(submitterProfile);
  const members = await resolveOwnerManagerMembers(supabase, session.restaurant_id);

  const notifRows = members.map((member) => ({
    restaurant_id: session.restaurant_id,
    user_id: member.user_id,
    type: "COUNT_SUBMITTED",
    title: `${staffName} submitted a count for review`,
    message: `${stats.itemCount} items counted · ${stats.criticalCount} critical · ${stats.lowCount} low stock`,
    severity: "INFO",
    data: {
      session_id: sessionId,
      item_count: stats.itemCount,
      critical_count: stats.criticalCount,
      low_count: stats.lowCount,
    },
  }));

  if (notifRows.length > 0) {
    await supabase.from("notifications").insert(notifRows);
  }

  const bodyHtml = `
    <p style="margin:0 0 16px"><strong>${staffName}</strong> submitted a count for review at <strong>${restaurantName}</strong>.</p>
    <table style="width:100%;border-collapse:collapse;margin-top:8px">
      <tr><td style="padding:8px 0;color:#6B7280">Items counted:</td><td style="padding:8px 0;text-align:right;font-weight:600">${stats.itemCount}</td></tr>
      <tr><td style="padding:8px 0;color:#DC2626">Critical (RED):</td><td style="padding:8px 0;text-align:right;font-weight:600;color:#DC2626">${stats.criticalCount}</td></tr>
      <tr><td style="padding:8px 0;color:#D97706">Low (YELLOW):</td><td style="padding:8px 0;text-align:right;font-weight:600;color:#D97706">${stats.lowCount}</td></tr>
      <tr><td style="padding:8px 0;color:#16A34A">OK (GREEN):</td><td style="padding:8px 0;text-align:right;font-weight:600;color:#16A34A">${stats.okCount}</td></tr>
    </table>
  `;

  const html = emailWrapper(
    "Count Ready",
    restaurantName,
    bodyHtml,
    "Review Count →",
    `${APP_BASE_URL}/app/inventory/review`,
    restaurantName,
  );

  for (const member of members) {
    if (!member.email?.includes("@")) continue;
    try {
      await sendMargin6Email({
        supabaseUrl,
        serviceKey,
        to: member.email,
        subject: `Count ready for review — ${restaurantName}`,
        html,
      });
    } catch (error) {
      console.error("[dispatch-app-notifications] COUNT_SUBMITTED email failed:", error);
    }
  }

  return { ok: true };
}

async function handleCountApproved(
  supabase: ReturnType<typeof createClient>,
  sessionId: string,
  approverUserId: string,
) {
  const { data: session } = await supabase
    .from("inventory_sessions")
    .select("id, restaurant_id, created_by")
    .eq("id", sessionId)
    .maybeSingle();

  if (!session?.created_by) return { ok: true, skipped: "no_submitter" };

  const { data: approverProfile } = await supabase
    .from("profiles")
    .select("full_name, email")
    .eq("id", approverUserId)
    .maybeSingle();

  const ownerName = displayName(approverProfile);

  await supabase.from("notifications").insert({
    restaurant_id: session.restaurant_id,
    user_id: session.created_by,
    type: "COUNT_APPROVED",
    title: "Your count was approved",
    message: `Count approved by ${ownerName}`,
    severity: "INFO",
    data: { session_id: sessionId },
  });

  return { ok: true };
}

async function handleSmartOrderReady(
  supabase: ReturnType<typeof createClient>,
  supabaseUrl: string,
  serviceKey: string,
  sessionId: string,
  runId: string,
) {
  const { data: existing } = await supabase
    .from("notifications")
    .select("id")
    .eq("type", "SMART_ORDER_READY")
    .contains("data", { session_id: sessionId })
    .limit(1);

  if (existing?.length) return { ok: true, skipped: "deduped" };

  const { data: session } = await supabase
    .from("inventory_sessions")
    .select("restaurant_id")
    .eq("id", sessionId)
    .maybeSingle();

  if (!session) return { ok: false, error: "Session not found" };

  const { data: restaurant } = await supabase
    .from("restaurants")
    .select("name")
    .eq("id", session.restaurant_id)
    .maybeSingle();

  const restaurantName = restaurant?.name ?? "Your restaurant";

  const { data: runItems } = await supabase
    .from("smart_order_run_items")
    .select("item_name, suggested_order, unit_cost, risk, pack_size")
    .eq("run_id", runId)
    .gt("suggested_order", 0)
    .order("risk", { ascending: true });

  const items = runItems ?? [];
  const itemCount = items.length;
  const totalCost = items.reduce((sum, row) => {
    const qty = Number(row.suggested_order) || 0;
    const cost = Number(row.unit_cost) || 0;
    return sum + qty * cost;
  }, 0);

  const criticalItems = items.filter((row) => row.risk === "RED");
  const lowItems = items.filter((row) => row.risk === "YELLOW");

  const lineRow = (row: { item_name: string; suggested_order: number; unit_cost: number | null; pack_size: string | null }) => {
    const qty = Number(row.suggested_order) || 0;
    const cost = (Number(row.unit_cost) || 0) * qty;
    const unitLabel = row.pack_size?.trim() || "units";
    return `<tr>
      <td style="padding:6px 0;font-size:14px">${row.item_name}</td>
      <td style="padding:6px 0;text-align:center;font-size:14px">${qty} ${unitLabel}</td>
      <td style="padding:6px 0;text-align:right;font-size:14px;font-weight:600">${formatUsd(cost, 0)}</td>
    </tr>`;
  };

  const members = await resolveOwnerManagerMembers(supabase, session.restaurant_id);
  const notifRows = members.map((member) => ({
    restaurant_id: session.restaurant_id,
    user_id: member.user_id,
    type: "SMART_ORDER_READY",
    title: `Smart order ready — ${itemCount} items to reorder`,
    message: `Estimated order cost: ${formatUsd(totalCost, 0)}`,
    severity: "INFO",
    data: {
      order_id: runId,
      session_id: sessionId,
      item_count: itemCount,
      total_cost: Math.round(totalCost * 100) / 100,
    },
  }));

  if (notifRows.length > 0) {
    await supabase.from("notifications").insert(notifRows);
  }

  const section = (label: string, color: string, rows: typeof items) => {
    if (rows.length === 0) return "";
    return `
      <p style="margin:20px 0 8px;font-weight:700;color:${color};text-transform:uppercase;font-size:12px;letter-spacing:0.04em">${label}</p>
      <table style="width:100%;border-collapse:collapse">${rows.slice(0, 8).map(lineRow).join("")}</table>
    `;
  };

  const bodyHtml = `
    <p style="margin:0 0 12px">Based on your latest count, here is what you need to reorder:</p>
    ${section("Critical (order now)", "#DC2626", criticalItems)}
    ${section("Low (order soon)", "#D97706", lowItems)}
    <p style="margin:20px 0 0;font-size:16px"><strong>Total estimate:</strong> <span style="color:#111827">${formatUsd(totalCost, 0)}</span></p>
  `;

  const html = emailWrapper(
    "Smart Order Ready",
    restaurantName,
    bodyHtml,
    "Review & Submit Order →",
    `${APP_BASE_URL}/app/smart-order?viewRun=${runId}`,
    restaurantName,
  );

  for (const member of members) {
    if (!member.email?.includes("@")) continue;
    const wantsEmail = await userWantsEmail(supabase, session.restaurant_id, member.user_id);
    if (!wantsEmail) continue;

    try {
      await sendMargin6Email({
        supabaseUrl,
        serviceKey,
        to: member.email,
        subject: `Your smart order is ready — ${itemCount} items, ${formatUsd(totalCost, 0)}`,
        html,
      });
    } catch (error) {
      console.error("[dispatch-app-notifications] SMART_ORDER_READY email failed:", error);
    }
  }

  return { ok: true };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: authData, error: authError } = await userClient.auth.getUser();
  if (authError || !authData.user) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const event = String(body.event ?? "");
  const sessionId = String(body.sessionId ?? "");
  if (!event || !sessionId) {
    return new Response(JSON.stringify({ error: "Missing event or sessionId" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const supabase = createClient(supabaseUrl, serviceKey);

  const { data: session } = await supabase
    .from("inventory_sessions")
    .select("restaurant_id")
    .eq("id", sessionId)
    .maybeSingle();

  if (!session) {
    return new Response(JSON.stringify({ error: "Session not found" }), {
      status: 404,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const { data: membership } = await supabase
    .from("restaurant_members")
    .select("id")
    .eq("restaurant_id", session.restaurant_id)
    .eq("user_id", authData.user.id)
    .maybeSingle();

  if (!membership) {
    return new Response(JSON.stringify({ error: "Forbidden" }), {
      status: 403,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    let result: Record<string, unknown> = { ok: true };

    if (event === "COUNT_SUBMITTED") {
      result = await handleCountSubmitted(supabase, supabaseUrl, serviceKey, sessionId);
    } else if (event === "COUNT_APPROVED") {
      result = await handleCountApproved(supabase, sessionId, authData.user.id);
    } else if (event === "SMART_ORDER_READY") {
      const runId = String(body.runId ?? "");
      if (!runId) {
        return new Response(JSON.stringify({ error: "Missing runId" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      result = await handleSmartOrderReady(supabase, supabaseUrl, serviceKey, sessionId, runId);
    } else {
      return new Response(JSON.stringify({ error: "Unknown event" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("[dispatch-app-notifications] error:", error);
    return new Response(JSON.stringify({ error: (error as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
