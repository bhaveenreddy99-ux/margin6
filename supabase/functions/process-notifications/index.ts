import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { computeRiskLevel } from "../../../src/lib/inventory-utils.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// ─── Helper: resolve recipient user IDs based on recipients_mode ───
async function resolveRecipients(
  supabase: any,
  restaurantId: string,
  recipientsMode: string,
  customUserIds: string[],
): Promise<string[]> {
  if (recipientsMode === "CUSTOM" && customUserIds.length > 0) {
    return customUserIds;
  }

  const roleFilter = recipientsMode === "ALL"
    ? ["OWNER", "MANAGER", "STAFF"]
    : ["OWNER", "MANAGER"];

  const { data: members } = await supabase
    .from("restaurant_members")
    .select("user_id, role")
    .eq("restaurant_id", restaurantId)
    .in("role", roleFilter);

  return (members || []).map((m: any) => m.user_id);
}

function buildAlertEmailHtml(restaurantName: string, locationName: string | null, items: any[], timestamp: string): string {
  const rows = items.map(i => `
    <tr>
      <td style="padding:8px 12px;border-bottom:1px solid #eee;font-size:14px">${i.item_name}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #eee;font-size:14px;text-align:center">${i.current_stock} / ${i.par_level}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #eee;font-size:14px;text-align:center;color:${i.risk === 'RED' ? '#dc2626' : '#f59e0b'};font-weight:600">${i.risk}</td>
    </tr>
  `).join("");

  return `
    <div style="font-family:'Helvetica Neue',Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px">
      <div style="background:linear-gradient(135deg,#c2410c,#ea580c);padding:24px;border-radius:12px 12px 0 0">
        <h1 style="color:white;margin:0;font-size:20px">🚨 Low Stock Alert</h1>
        <p style="color:rgba(255,255,255,0.8);margin:4px 0 0;font-size:14px">${restaurantName}${locationName ? ` — ${locationName}` : ""}</p>
      </div>
      <div style="background:white;border:1px solid #e5e7eb;border-top:none;padding:24px;border-radius:0 0 12px 12px">
        <p style="color:#6b7280;font-size:13px;margin:0 0 16px">Generated at ${timestamp}</p>
        <table style="width:100%;border-collapse:collapse">
          <thead>
            <tr style="background:#f9fafb">
              <th style="padding:8px 12px;text-align:left;font-size:12px;color:#6b7280;text-transform:uppercase">Item</th>
              <th style="padding:8px 12px;text-align:center;font-size:12px;color:#6b7280;text-transform:uppercase">Stock / PAR</th>
              <th style="padding:8px 12px;text-align:center;font-size:12px;color:#6b7280;text-transform:uppercase">Risk</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
        <div style="margin-top:20px;padding:12px;background:#fef3c7;border-radius:8px;font-size:13px;color:#92400e">
          ⚡ Review your inventory and consider placing a Smart Order.
        </div>
      </div>
      <p style="text-align:center;color:#9ca3af;font-size:11px;margin-top:16px">Margin6 — Inventory Intelligence</p>
    </div>
  `;
}

function buildDigestEmailHtml(userName: string, groups: any[]): string {
  const sections = groups.map(g => {
    const rows = g.items.map((i: any) => `<li style="font-size:13px;color:#374151;margin:4px 0">${i.item_name}: ${i.current_stock}/${i.par_level} <span style="color:${i.risk === 'RED' ? '#dc2626' : '#f59e0b'};font-weight:600">${i.risk}</span></li>`).join("");
    return `
      <div style="margin-bottom:16px">
        <h3 style="font-size:15px;color:#111827;margin:0 0 8px">${g.restaurantName}${g.locationName ? ` — ${g.locationName}` : ""}</h3>
        <ul style="margin:0;padding-left:20px">${rows}</ul>
      </div>
    `;
  }).join("");

  return `
    <div style="font-family:'Helvetica Neue',Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px">
      <div style="background:linear-gradient(135deg,#7c3aed,#a855f7);padding:24px;border-radius:12px 12px 0 0">
        <h1 style="color:white;margin:0;font-size:20px">📋 Daily Inventory Digest</h1>
        <p style="color:rgba(255,255,255,0.8);margin:4px 0 0;font-size:14px">Hi ${userName}</p>
      </div>
      <div style="background:white;border:1px solid #e5e7eb;border-top:none;padding:24px;border-radius:0 0 12px 12px">
        ${sections}
      </div>
      <p style="text-align:center;color:#9ca3af;font-size:11px;margin-top:16px">Margin6 — Inventory Intelligence</p>
    </div>
  `;
}

function buildReminderEmailHtml(restaurantName: string, locationName: string | null, reminderName: string, timestamp: string): string {
  return `
    <div style="font-family:'Helvetica Neue',Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px">
      <div style="background:linear-gradient(135deg,#0284c7,#0ea5e9);padding:24px;border-radius:12px 12px 0 0">
        <h1 style="color:white;margin:0;font-size:20px">⏰ Inventory Reminder</h1>
        <p style="color:rgba(255,255,255,0.8);margin:4px 0 0;font-size:14px">${restaurantName}${locationName ? ` — ${locationName}` : ""}</p>
      </div>
      <div style="background:white;border:1px solid #e5e7eb;border-top:none;padding:24px;border-radius:0 0 12px 12px">
        <h2 style="font-size:16px;color:#111827;margin:0 0 8px">${reminderName}</h2>
        <p style="color:#6b7280;font-size:14px;margin:0">It's time to enter your inventory counts. Please log in and complete your inventory entry.</p>
        <p style="color:#9ca3af;font-size:12px;margin:16px 0 0">Scheduled for: ${timestamp}</p>
      </div>
      <p style="text-align:center;color:#9ca3af;font-size:11px;margin-top:16px">Margin6 — Inventory Intelligence</p>
    </div>
  `;
}

type ShrinkAnomalyInput = {
  item_name: string;
  usage: number;
  avg: number;
  type: "HIGH_USAGE" | "COUNT_VARIANCE";
};

type ShrinkAnomalyItem = ShrinkAnomalyInput & {
  dollar_impact: number;
  unit_cost: number;
  unit_cost_source: "catalog" | "invoice" | "unknown";
};

async function resolveUnitCostForShrinkItem(
  supabase: ReturnType<typeof createClient>,
  restaurantId: string,
  itemName: string,
): Promise<{ unit_cost: number; unit_cost_source: "catalog" | "invoice" | "unknown" }> {
  const { data: catalogRows } = await supabase
    .from("inventory_catalog_items")
    .select("default_unit_cost")
    .eq("restaurant_id", restaurantId)
    .ilike("item_name", itemName)
    .limit(1);

  const catalogCost = Number(catalogRows?.[0]?.default_unit_cost);
  if (Number.isFinite(catalogCost) && catalogCost >= 0) {
    return { unit_cost: catalogCost, unit_cost_source: "catalog" };
  }

  const { data: invoiceItemRows } = await supabase
    .from("invoice_items")
    .select("unit_cost, invoices!inner(invoice_date, restaurant_id)")
    .eq("invoices.restaurant_id", restaurantId)
    .ilike("item_name", itemName)
    .limit(20);

  const sorted = (invoiceItemRows || [])
    .map((row: { unit_cost: number | null; invoices: { invoice_date: string | null } | null }) => ({
      unit_cost: Number(row.unit_cost),
      invoice_date: row.invoices?.invoice_date ?? "",
    }))
    .filter((row) => Number.isFinite(row.unit_cost) && row.unit_cost >= 0)
    .sort((a, b) => new Date(b.invoice_date).getTime() - new Date(a.invoice_date).getTime());

  if (sorted.length > 0) {
    return { unit_cost: sorted[0].unit_cost, unit_cost_source: "invoice" };
  }

  return { unit_cost: 0, unit_cost_source: "unknown" };
}

async function enrichShrinkAnomalies(
  supabase: ReturnType<typeof createClient>,
  restaurantId: string,
  anomalies: ShrinkAnomalyInput[],
): Promise<{ items: ShrinkAnomalyItem[]; total_dollar_impact: number }> {
  const items: ShrinkAnomalyItem[] = [];

  for (const anomaly of anomalies) {
    const { unit_cost, unit_cost_source } = await resolveUnitCostForShrinkItem(
      supabase,
      restaurantId,
      anomaly.item_name,
    );

    let dollar_impact = 0;
    if (anomaly.type === "HIGH_USAGE") {
      dollar_impact = Math.max(0, (anomaly.usage - anomaly.avg) * unit_cost);
    } else if (anomaly.type === "COUNT_VARIANCE") {
      dollar_impact = Math.abs(anomaly.usage) * unit_cost;
    }
    dollar_impact = Math.round(dollar_impact * 100) / 100;

    items.push({
      ...anomaly,
      dollar_impact,
      unit_cost,
      unit_cost_source,
    });
  }

  const total_dollar_impact = Math.round(
    items.reduce((sum, item) => sum + (item.dollar_impact > 0 ? item.dollar_impact : 0), 0) * 100,
  ) / 100;

  return { items, total_dollar_impact };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceKey);

    const now = new Date();
    const results: string[] = [];

    // ─── 1) Process Low Stock Alerts ───
    const { data: restaurants } = await supabase.from("restaurants").select("id, name");
    
    for (const restaurant of restaurants || []) {
      const { data: smartOrderSettings } = await supabase
        .from("smart_order_settings")
        .select("red_threshold, yellow_threshold")
        .eq("restaurant_id", restaurant.id)
        .maybeSingle();

      const riskThresholds = {
        redThresholdPercent: smartOrderSettings?.red_threshold,
        yellowThresholdPercent: smartOrderSettings?.yellow_threshold,
      };

      // Get latest approved session per inventory list
      const { data: sessions } = await supabase
        .from("inventory_sessions")
        .select("id, inventory_list_id, location_id")
        .eq("restaurant_id", restaurant.id)
        .eq("status", "APPROVED")
        .order("approved_at", { ascending: false });

      if (!sessions?.length) continue;

      const seenLists = new Set<string>();
      const latestSessions = sessions.filter((s: any) => {
        if (seenLists.has(s.inventory_list_id)) return false;
        seenLists.add(s.inventory_list_id);
        return true;
      });

      for (const session of latestSessions) {
        const { data: items } = await supabase
          .from("inventory_session_items")
          .select("*")
          .eq("session_id", session.id);

        if (!items?.length) continue;

        const alertItems = items
          .map((i: any) => ({
            ...i,
            risk: computeRiskLevel(Number(i.current_stock), i.par_level, riskThresholds),
          }))
          .filter((i: any) => i.risk === "RED" || i.risk === "YELLOW");

        if (alertItems.length === 0) continue;

        // Get the restaurant-level alert preferences to determine recipients_mode
        // We use the first pref we find (typically the owner's) as the "master" config
        const { data: alertPrefs } = await supabase
          .from("notification_preferences")
          .select("*, alert_recipients(user_id)")
          .eq("restaurant_id", restaurant.id)
          .limit(1);

        const masterPref = alertPrefs?.[0];
        const recipientsMode = masterPref?.recipients_mode || "OWNERS_MANAGERS";
        const customUserIds = masterPref?.alert_recipients?.map((r: any) => r.user_id) || [];

        // Resolve which users should receive alerts
        const recipientUserIds = await resolveRecipients(supabase, restaurant.id, recipientsMode, customUserIds);

        for (const userId of recipientUserIds) {
          // Check per-user preferences
          const { data: pref } = await supabase
            .from("notification_preferences")
            .select("*")
            .eq("restaurant_id", restaurant.id)
            .eq("user_id", userId)
            .maybeSingle();

          const shouldAlertRed = pref?.low_stock_red ?? true;
          const shouldAlertYellow = pref?.low_stock_yellow ?? false;

          const filteredItems = alertItems.filter((i: any) =>
            (i.risk === "RED" && shouldAlertRed) || (i.risk === "YELLOW" && shouldAlertYellow)
          );

          if (filteredItems.length === 0) continue;

          const redCount = filteredItems.filter((i: any) => i.risk === "RED").length;
          const yellowCount = filteredItems.filter((i: any) => i.risk === "YELLOW").length;

          // Check if already notified today
          const todayStart = new Date();
          todayStart.setHours(0, 0, 0, 0);
          const { data: existing } = await supabase
            .from("notifications")
            .select("id")
            .eq("user_id", userId)
            .eq("restaurant_id", restaurant.id)
            .eq("type", "LOW_STOCK")
            .gte("created_at", todayStart.toISOString())
            .limit(1);

          if (existing?.length) continue;

          // Create in-app notification
          const channelInApp = pref?.channel_in_app ?? true;
          if (channelInApp) {
            await supabase.from("notifications").insert({
              restaurant_id: restaurant.id,
              location_id: session.location_id,
              user_id: userId,
              type: "LOW_STOCK",
              title: `${redCount} critical, ${yellowCount} low stock items`,
              message: `${restaurant.name}: ${filteredItems.map((i: any) => i.item_name).slice(0, 5).join(", ")}${filteredItems.length > 5 ? ` and ${filteredItems.length - 5} more` : ""}`,
              severity: redCount > 0 ? "CRITICAL" : "WARNING",
              data: { items: filteredItems.map((i: any) => ({ item_name: i.item_name, current_stock: i.current_stock, par_level: i.par_level, risk: i.risk })) },
            });
          }

          // Send email if IMMEDIATE
          const channelEmail = pref?.channel_email ?? true;
          const digestMode = pref?.email_digest_mode ?? "IMMEDIATE";

          if (channelEmail && digestMode === "IMMEDIATE") {
            const { data: profile } = await supabase
              .from("profiles")
              .select("email")
              .eq("id", userId)
              .single();

            if (profile?.email) {
              const locationName = session.location_id ? (await supabase.from("locations").select("name").eq("id", session.location_id).single())?.data?.name : null;
              const html = buildAlertEmailHtml(restaurant.name, locationName, filteredItems, now.toISOString());

              await fetch(`${supabaseUrl}/functions/v1/send-email`, {
                method: "POST",
                headers: { "Content-Type": "application/json", Authorization: `Bearer ${serviceKey}` },
                body: JSON.stringify({ to: profile.email, subject: `⚠️ Low Stock Alert — ${restaurant.name}`, html }),
              });

              results.push(`Sent alert email to ${profile.email} for ${restaurant.name}`);
            }
          }
        }
      }
    }

    // ─── 2) Process Reminders ───
    const dayMap: Record<number, string> = { 0: "SUN", 1: "MON", 2: "TUE", 3: "WED", 4: "THU", 5: "FRI", 6: "SAT" };

    const { data: reminders } = await supabase
      .from("reminders")
      .select("*, reminder_targets(user_id), restaurants(name), locations(name)")
      .eq("is_enabled", true);

    for (const reminder of reminders || []) {
      const [targetHour, targetMin] = (reminder.time_of_day || "21:00").split(":").map(Number);
      
      const tzOffsets: Record<string, number> = {
        "America/New_York": -5, "America/Chicago": -6, "America/Denver": -7, "America/Los_Angeles": -8,
      };
      const offset = tzOffsets[reminder.timezone] ?? -5;
      const utcHour = (targetHour - offset + 24) % 24;

      const nowUTC = now.getUTCHours();
      const nowMin = now.getUTCMinutes();

      if (nowUTC !== utcHour || Math.abs(nowMin - targetMin) > 4) continue;

      const dayInTz = dayMap[now.getUTCDay()];
      const days = reminder.days_of_week as string[];
      if (!days?.includes(dayInTz)) continue;

      // Resolve recipients based on recipients_mode
      const recipientsMode = reminder.recipients_mode || "OWNERS_MANAGERS";
      const customUserIds = (reminder.reminder_targets || []).map((t: any) => t.user_id);
      const recipientUserIds = await resolveRecipients(supabase, reminder.restaurant_id, recipientsMode, customUserIds);

      const todayStart = new Date();
      todayStart.setUTCHours(0, 0, 0, 0);

      for (const userId of recipientUserIds) {
        const { data: existing } = await supabase
          .from("notifications")
          .select("id")
          .eq("user_id", userId)
          .eq("type", "REMINDER")
          .eq("restaurant_id", reminder.restaurant_id)
          .gte("created_at", todayStart.toISOString())
          .limit(1);

        if (existing?.length) continue;

        await supabase.from("notifications").insert({
          restaurant_id: reminder.restaurant_id,
          location_id: reminder.location_id,
          user_id: userId,
          type: "REMINDER",
          title: reminder.name,
          message: `Time to enter inventory for ${reminder.restaurants?.name || "your restaurant"}`,
          severity: "INFO",
          data: { reminder_id: reminder.id },
        });

        // Send email
        const { data: pref } = await supabase
          .from("notification_preferences")
          .select("*")
          .eq("restaurant_id", reminder.restaurant_id)
          .eq("user_id", userId)
          .maybeSingle();

        if (pref?.channel_email !== false && (pref?.email_digest_mode ?? "IMMEDIATE") === "IMMEDIATE") {
          const { data: profile } = await supabase.from("profiles").select("email").eq("id", userId).single();
          if (profile?.email) {
            const html = buildReminderEmailHtml(
              reminder.restaurants?.name || "Restaurant",
              reminder.locations?.name || null,
              reminder.name,
              now.toISOString()
            );
            await fetch(`${supabaseUrl}/functions/v1/send-email`, {
              method: "POST",
              headers: { "Content-Type": "application/json", Authorization: `Bearer ${serviceKey}` },
              body: JSON.stringify({ to: profile.email, subject: `⏰ Reminder: ${reminder.name}`, html }),
            });
            results.push(`Sent reminder email to ${profile.email}`);
          }
        }
      }

      // ─── Auto-create session if this is an inventory schedule ───
      if ((reminder as any).inventory_list_id && (reminder as any).auto_create_session) {
        const todayStart = new Date();
        todayStart.setUTCHours(0, 0, 0, 0);
        const { data: existingSession } = await supabase
          .from("inventory_sessions")
          .select("id")
          .eq("restaurant_id", reminder.restaurant_id)
          .eq("inventory_list_id", (reminder as any).inventory_list_id)
          .gte("created_at", todayStart.toISOString())
          .limit(1);
        if (!existingSession?.length) {
          const dateStr = now.toLocaleDateString("en-US", { month: "short", day: "numeric" });
          await supabase.from("inventory_sessions").insert({
            restaurant_id: reminder.restaurant_id,
            inventory_list_id: (reminder as any).inventory_list_id,
            location_id: reminder.location_id || null,
            name: `${reminder.name} – ${dateStr}`,
            status: "IN_PROGRESS",
          });
          results.push(`Auto-created session: ${reminder.name} – ${dateStr}`);
        }
      }
    }

    // ─── 3) Process Daily Digests ───
    const { data: digestPrefs } = await supabase
      .from("notification_preferences")
      .select("*")
      .eq("email_digest_mode", "DAILY_DIGEST")
      .eq("channel_email", true);

    for (const pref of digestPrefs || []) {
      const tzOffsets: Record<string, number> = {
        "America/New_York": -5, "America/Chicago": -6, "America/Denver": -7, "America/Los_Angeles": -8,
      };
      const offset = tzOffsets[pref.timezone] ?? -5;
      const userHourUTC = (pref.digest_hour - offset + 24) % 24;

      if (now.getUTCHours() !== userHourUTC || now.getUTCMinutes() > 4) continue;

      const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
      const { data: pendingNotifs } = await supabase
        .from("notifications")
        .select("*")
        .eq("user_id", pref.user_id)
        .eq("restaurant_id", pref.restaurant_id)
        .is("emailed_at", null)
        .gte("created_at", yesterday.toISOString());

      if (!pendingNotifs?.length) continue;

      const { data: profile } = await supabase.from("profiles").select("email, full_name").eq("id", pref.user_id).single();
      if (!profile?.email) continue;

      const { data: restaurant } = await supabase.from("restaurants").select("name").eq("id", pref.restaurant_id).single();
      
      const groups = [{
        restaurantName: restaurant?.name || "Restaurant",
        locationName: null as string | null,
        items: pendingNotifs
          .filter((n: any) => n.data?.items)
          .flatMap((n: any) => n.data.items || []),
      }];

      if (groups[0].items.length > 0) {
        const html = buildDigestEmailHtml(profile.full_name || "Team Member", groups);
        await fetch(`${supabaseUrl}/functions/v1/send-email`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${serviceKey}` },
          body: JSON.stringify({ to: profile.email, subject: `📋 Daily Inventory Digest`, html }),
        });

        const ids = pendingNotifs.map((n: any) => n.id);
        for (const id of ids) {
          await supabase.from("notifications").update({ emailed_at: now.toISOString() }).eq("id", id);
        }
        results.push(`Sent digest to ${profile.email}`);
      }
    }

    // ─── 4) Process Overdue Inventory Schedules ───
    const { data: overdueSchedules } = await supabase
      .from("reminders")
      .select("*, restaurants(name)")
      .eq("is_enabled", true)
      .not("inventory_list_id", "is", null)
      .not("lock_after_hours", "is", null);

    for (const schedule of overdueSchedules || []) {
      const lockAfterHours = (schedule as any).lock_after_hours;
      const cutoffTime = new Date(now.getTime() - lockAfterHours * 60 * 60 * 1000);
      const { data: overdueSessions } = await supabase
        .from("inventory_sessions")
        .select("id, name, created_at")
        .eq("restaurant_id", schedule.restaurant_id)
        .eq("inventory_list_id", (schedule as any).inventory_list_id)
        .eq("status", "IN_PROGRESS")
        .lt("created_at", cutoffTime.toISOString());

      for (const session of overdueSessions || []) {
        const { data: existing } = await supabase
          .from("notifications")
          .select("id")
          .eq("restaurant_id", schedule.restaurant_id)
          .eq("type", "SCHEDULE_OVERDUE")
          .contains("data", { session_id: session.id })
          .limit(1);
        if (existing?.length) continue;
        const managerIds = await resolveRecipients(supabase, schedule.restaurant_id, "OWNERS_MANAGERS", []);
        for (const userId of managerIds) {
          await supabase.from("notifications").insert({
            restaurant_id: schedule.restaurant_id,
            user_id: userId,
            type: "SCHEDULE_OVERDUE",
            title: "Inventory overdue",
            message: `${session.name} has been in progress for over ${lockAfterHours} hours`,
            severity: "WARNING",
            data: { session_id: session.id, reminder_id: schedule.id },
          });
        }
        results.push(`Sent overdue notification for session: ${session.name}`);
      }
    }

    // ─── 5) Shrink / Abnormal Usage Detection ───
    // For each restaurant, compare usage between last 2 approved sessions to rolling avg of last 4
    for (const restaurant of restaurants || []) {
      const { data: recentSessions } = await supabase
        .from("inventory_sessions")
        .select("id, approved_at, location_id")
        .eq("restaurant_id", restaurant.id)
        .eq("status", "APPROVED")
        .not("approved_at", "is", null)
        .order("approved_at", { ascending: false })
        .limit(5);

      if (!recentSessions || recentSessions.length < 2) continue;

      // Check if we already sent shrink notification today
      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);
      const { data: existingShrink } = await supabase
        .from("notifications")
        .select("id")
        .eq("restaurant_id", restaurant.id)
        .eq("type", "SHRINK_ALERT")
        .gte("created_at", todayStart.toISOString())
        .limit(1);
      if (existingShrink?.length) continue;

      // Get items for all sessions
      const sessionIds = recentSessions.map(s => s.id);
      const { data: allItems } = await supabase
        .from("inventory_session_items")
        .select("session_id, item_name, current_stock, par_level")
        .in("session_id", sessionIds);

      if (!allItems?.length) continue;

      // Order chronologically
      const orderedIds = [...sessionIds].reverse();
      const sessionIndexMap: Record<string, number> = {};
      orderedIds.forEach((id, i) => { sessionIndexMap[id] = i; });

      // Group items
      const itemStocks: Record<string, number[]> = {};
      for (const si of allItems) {
        const key = si.item_name.trim().toLowerCase();
        if (!itemStocks[key]) itemStocks[key] = new Array(orderedIds.length).fill(-1);
        const idx = sessionIndexMap[si.session_id];
        if (idx !== undefined) itemStocks[key][idx] = Number(si.current_stock);
      }

      // Get approved_at dates for time diff
      const sessionDates = orderedIds.map(id => {
        const s = recentSessions.find(ss => ss.id === id);
        return s?.approved_at ? new Date(s.approved_at) : new Date();
      });

      // Compute per-period usage and check for anomalies
      const anomalies: ShrinkAnomalyInput[] = [];

      for (const [key, stocks] of Object.entries(itemStocks)) {
        const usages: number[] = [];
        for (let i = 1; i < stocks.length; i++) {
          if (stocks[i - 1] >= 0 && stocks[i] >= 0) {
            usages.push(stocks[i - 1] - stocks[i]);
          }
        }
        if (usages.length < 2) continue;

        const latestUsage = usages[usages.length - 1];
        const prevUsages = usages.slice(0, -1);
        const rollingAvg = prevUsages.reduce((a, b) => a + b, 0) / prevUsages.length;

        const displayName = allItems.find(si => si.item_name.trim().toLowerCase() === key)?.item_name || key;

        // Abnormal high usage: > 1.5x rolling avg
        if (rollingAvg > 0 && latestUsage > rollingAvg * 1.5) {
          anomalies.push({ item_name: displayName, usage: latestUsage, avg: rollingAvg, type: "HIGH_USAGE" });
        }
        // Negative usage (count variance / potential shrink)
        if (latestUsage < 0) {
          anomalies.push({ item_name: displayName, usage: latestUsage, avg: rollingAvg, type: "COUNT_VARIANCE" });
        }
      }

      if (anomalies.length === 0) continue;

      // Send notifications to OWNER + MANAGER
      const recipientUserIds = await resolveRecipients(supabase, restaurant.id, "OWNERS_MANAGERS", []);

      const highUsageItems = anomalies.filter(a => a.type === "HIGH_USAGE");
      const varianceItems = anomalies.filter(a => a.type === "COUNT_VARIANCE");

      const enrichedHighUsage = highUsageItems.length > 0
        ? await enrichShrinkAnomalies(supabase, restaurant.id, highUsageItems)
        : null;
      const enrichedVariance = varianceItems.length > 0
        ? await enrichShrinkAnomalies(supabase, restaurant.id, varianceItems)
        : null;

      for (const userId of recipientUserIds) {
        if (enrichedHighUsage && enrichedHighUsage.items.length > 0) {
          await supabase.from("notifications").insert({
            restaurant_id: restaurant.id,
            user_id: userId,
            type: "SHRINK_ALERT",
            title: `${highUsageItems.length} item${highUsageItems.length > 1 ? "s" : ""} with abnormal usage`,
            message: `${restaurant.name}: ${highUsageItems.map(a => `${a.item_name} (${a.usage.toFixed(0)} vs avg ${a.avg.toFixed(0)})`).slice(0, 3).join(", ")}`,
            severity: highUsageItems.length >= 3 ? "CRITICAL" : "WARNING",
            data: {
              items: enrichedHighUsage.items,
              total_dollar_impact: enrichedHighUsage.total_dollar_impact,
            },
          });
        }

        if (enrichedVariance && enrichedVariance.items.length > 0) {
          await supabase.from("notifications").insert({
            restaurant_id: restaurant.id,
            user_id: userId,
            type: "COUNT_VARIANCE",
            title: `${varianceItems.length} item${varianceItems.length > 1 ? "s" : ""} with count variance`,
            message: `${restaurant.name}: ${varianceItems.map(a => a.item_name).slice(0, 5).join(", ")} — stock increased without recorded delivery`,
            severity: varianceItems.length >= 3 ? "WARNING" : "INFO",
            data: {
              items: enrichedVariance.items,
              total_dollar_impact: enrichedVariance.total_dollar_impact,
            },
          });
        }
      }

      results.push(`Shrink check: ${anomalies.length} anomalies for ${restaurant.name}`);
    }

    // ─── 6) Monday 7am UTC Weekly Loss Digest ───────────────────────────────
    // Fires once per restaurant per week. Emails OWNER + MANAGER members a
    // breakdown of last week's losses. Skipped if not Mon 07:00–07:59 UTC, or
    // if a WEEKLY_DIGEST notification already exists for this restaurant in
    // the last 6 days.
    digest_block: {
      const isMonday = now.getUTCDay() === 1;
      const isSevenAmUtc = now.getUTCHours() === 7;
      if (!isMonday || !isSevenAmUtc) {
        break digest_block;
      }

      // Last week window: Monday 00:00 UTC through Sunday 23:59:59 UTC
      const lastWeekEnd = new Date(now);
      lastWeekEnd.setUTCDate(lastWeekEnd.getUTCDate() - 1);
      lastWeekEnd.setUTCHours(23, 59, 59, 999);
      const lastWeekStart = new Date(lastWeekEnd);
      lastWeekStart.setUTCDate(lastWeekStart.getUTCDate() - 6);
      lastWeekStart.setUTCHours(0, 0, 0, 0);

      const lastWeekStartIso = lastWeekStart.toISOString();
      const lastWeekEndIso = lastWeekEnd.toISOString();
      const lastWeekStartDate = lastWeekStartIso.slice(0, 10);
      const lastWeekEndDate = lastWeekEndIso.slice(0, 10);
      const dedupeWindowIso = new Date(now.getTime() - 6 * 24 * 60 * 60 * 1000).toISOString();

      const formatUsd = (n: number) =>
        `$${(Number.isFinite(n) ? n : 0).toLocaleString("en-US", { maximumFractionDigits: 0 })}`;

      for (const restaurant of restaurants || []) {
        const restaurantId = restaurant.id as string;
        const restaurantName = (restaurant.name as string) || "Your restaurant";

        // Skip restaurants with no confirmed invoices ever — these are inactive.
        const { data: anyConfirmed } = await supabase
          .from("invoices")
          .select("id")
          .eq("restaurant_id", restaurantId)
          .eq("status", "confirmed")
          .limit(1);
        if (!anyConfirmed?.length) continue;

        // Duplicate guard: already digested this restaurant within last 6 days.
        const { data: recentDigest } = await supabase
          .from("notifications")
          .select("id")
          .eq("restaurant_id", restaurantId)
          .eq("type", "WEEKLY_DIGEST")
          .gte("created_at", dedupeWindowIso)
          .limit(1);
        if (recentDigest?.length) continue;

        // ── Waste total ────────────────────────────────────────────────────
        let wasteTotal = 0;
        let topLeakItem: string | null = null;
        {
          const { data: wasteRows } = await supabase
            .from("waste_log")
            .select("item_name, total_cost, unit_cost, quantity")
            .eq("restaurant_id", restaurantId)
            .gte("logged_at", lastWeekStartIso)
            .lte("logged_at", lastWeekEndIso);
          const byItem = new Map<string, number>();
          for (const row of wasteRows || []) {
            const explicit = Number((row as any).total_cost);
            const derived = Number((row as any).unit_cost) * Number((row as any).quantity);
            const value =
              Number.isFinite(explicit) && explicit > 0
                ? explicit
                : Number.isFinite(derived) && derived > 0
                  ? derived
                  : 0;
            if (value <= 0) continue;
            wasteTotal += value;
            const name = ((row as any).item_name as string | null)?.trim() || "";
            if (!name) continue;
            byItem.set(name, (byItem.get(name) || 0) + value);
          }
          let topVal = 0;
          for (const [name, sum] of byItem.entries()) {
            if (sum > topVal) {
              topVal = sum;
              topLeakItem = name;
            }
          }
        }

        // ── Price hike total (last-week invoices + price_mismatch lines) ───
        let priceHikeTotal = 0;
        {
          const { data: invoices } = await supabase
            .from("invoices")
            .select("id")
            .eq("restaurant_id", restaurantId)
            .gte("invoice_date", lastWeekStartDate)
            .lte("invoice_date", lastWeekEndDate);
          const invoiceIds = (invoices || []).map((i: any) => i.id as string);
          if (invoiceIds.length > 0) {
            const { data: comparisons } = await supabase
              .from("invoice_line_comparisons")
              .select("po_unit_cost, invoiced_unit_cost, invoiced_qty, status")
              .in("invoice_id", invoiceIds)
              .eq("status", "price_mismatch");
            for (const row of comparisons || []) {
              const po = Number((row as any).po_unit_cost ?? 0);
              const inv = Number((row as any).invoiced_unit_cost ?? 0);
              const qty = Number((row as any).invoiced_qty ?? 0);
              if (!Number.isFinite(po) || po <= 0) continue;
              if (!Number.isFinite(inv) || inv <= po) continue;
              const impact = (inv - po) * qty;
              if (Number.isFinite(impact) && impact > 0) priceHikeTotal += impact;
            }
          }
        }

        // ── Overstock total (latest approved session) ──────────────────────
        let overstockTotal = 0;
        {
          const { data: latestSession } = await supabase
            .from("inventory_sessions")
            .select("id")
            .eq("restaurant_id", restaurantId)
            .eq("status", "APPROVED")
            .order("approved_at", { ascending: false })
            .limit(1);
          const sessionId = latestSession?.[0]?.id as string | undefined;
          if (sessionId) {
            const { data: items } = await supabase
              .from("inventory_session_items")
              .select("current_stock, par_level, unit_cost")
              .eq("session_id", sessionId);
            for (const row of items || []) {
              const stock = Number((row as any).current_stock ?? 0);
              const par = Number((row as any).par_level ?? 0);
              const cost = Number((row as any).unit_cost ?? 0);
              if (stock <= par || cost <= 0) continue;
              const dollars = (stock - par) * cost;
              if (Number.isFinite(dollars) && dollars > 0) overstockTotal += dollars;
            }
          }
        }

        // ── Shrinkage total (last-week SHRINK_ALERT / COUNT_VARIANCE) ──────
        let shrinkageTotal = 0;
        {
          const { data: shrinkNotifs } = await supabase
            .from("notifications")
            .select("data")
            .eq("restaurant_id", restaurantId)
            .in("type", ["SHRINK_ALERT", "COUNT_VARIANCE"])
            .gte("created_at", lastWeekStartIso)
            .lte("created_at", lastWeekEndIso);
          for (const n of shrinkNotifs || []) {
            const items = Array.isArray((n as any).data?.items) ? (n as any).data.items : [];
            for (const it of items) {
              const impact = Number(it?.dollar_impact);
              if (Number.isFinite(impact) && impact > 0) shrinkageTotal += impact;
            }
          }
        }

        const totalLost = wasteTotal + priceHikeTotal + overstockTotal + shrinkageTotal;
        if (totalLost <= 0) continue;

        // ── Resolve OWNER + MANAGER emails ─────────────────────────────────
        const { data: members } = await supabase
          .from("restaurant_members")
          .select("user_id")
          .eq("restaurant_id", restaurantId)
          .in("role", ["OWNER", "MANAGER"]);
        const memberIds = (members || []).map((m: any) => m.user_id as string);
        if (memberIds.length === 0) continue;

        const { data: profiles } = await supabase
          .from("profiles")
          .select("id, email")
          .in("id", memberIds);
        const emails = (profiles || [])
          .map((p: any) => p.email as string | null)
          .filter((e): e is string => !!e && e.includes("@"));
        if (emails.length === 0) continue;

        // ── Build email HTML ───────────────────────────────────────────────
        const weekStartLabel = lastWeekStart.toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
          timeZone: "UTC",
        });
        const weekEndLabel = lastWeekEnd.toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
          timeZone: "UTC",
        });

        const breakdownRow = (label: string, amount: number, isLast = false) => `
          <tr>
            <td style="padding:10px 0;${isLast ? "" : "border-bottom:1px solid #f3f4f6;"}font-size:14px;color:#374151">${label}</td>
            <td style="padding:10px 0;${isLast ? "" : "border-bottom:1px solid #f3f4f6;"}font-size:14px;text-align:right;font-weight:600;color:#111827;font-family:'Menlo','Consolas',monospace">${formatUsd(amount)}</td>
          </tr>`;

        const topLeakSection = topLeakItem
          ? `<div style="margin-top:24px;padding:14px 16px;background:#FFF7ED;border-left:3px solid #F97316;border-radius:6px;font-size:14px;color:#7C2D12"><strong>Your biggest leak:</strong> ${topLeakItem}</div>`
          : "";

        const html = `
          <div style="font-family:'Helvetica Neue',Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px;background:#FAFAFA">
            <div style="background:#0F172A;padding:22px 24px;border-radius:12px 12px 0 0">
              <h1 style="color:#FFFFFF;margin:0;font-size:18px;font-weight:700;letter-spacing:-0.01em">Margin6 <span style="color:#F97316">·</span> Weekly Loss Report</h1>
            </div>
            <div style="background:#FFFFFF;border:1px solid #E5E7EB;border-top:none;padding:28px;border-radius:0 0 12px 12px">
              <p style="color:#6B7280;font-size:12px;margin:0;text-transform:uppercase;letter-spacing:0.04em;font-weight:600">Week of ${weekStartLabel} – ${weekEndLabel}</p>
              <p style="color:#DC2626;font-size:36px;font-weight:800;margin:6px 0 0;line-height:1.1;letter-spacing:-0.02em">${formatUsd(totalLost)} lost last week</p>

              <table style="width:100%;border-collapse:collapse;margin-top:24px">
                ${breakdownRow("Food waste", wasteTotal)}
                ${breakdownRow("Price hikes", priceHikeTotal)}
                ${breakdownRow("Overstock", overstockTotal)}
                ${breakdownRow("Shrinkage", shrinkageTotal, true)}
              </table>

              ${topLeakSection}

              <div style="margin-top:28px">
                <a href="https://margin6.com/app/dashboard" style="display:inline-block;background:#F97316;color:#FFFFFF;padding:12px 22px;border-radius:8px;text-decoration:none;font-weight:600;font-size:14px">See the full breakdown →</a>
              </div>
            </div>
            <p style="text-align:center;color:#9CA3AF;font-size:11px;margin-top:18px;line-height:1.6">You're receiving this because you're an owner/manager at ${restaurantName}.<br/>Unsubscribe in Settings.</p>
          </div>
        `;

        const subject = `Your restaurant lost ${formatUsd(totalLost)} last week`;
        let sentCount = 0;
        for (const email of emails) {
          try {
            const r = await fetch(`${supabaseUrl}/functions/v1/send-email`, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${serviceKey}`,
              },
              body: JSON.stringify({ to: email, subject, html }),
            });
            if (r.ok) sentCount += 1;
          } catch (e) {
            console.error("Weekly digest send-email failed:", e);
          }
        }

        if (sentCount === 0) continue;

        // ── Record digest so we don't double-send this week ────────────────
        const firstMemberId = memberIds[0];
        await supabase.from("notifications").insert({
          restaurant_id: restaurantId,
          user_id: firstMemberId,
          type: "WEEKLY_DIGEST",
          title: "Weekly digest sent",
          message: `Sent loss report to ${sentCount} recipient${sentCount === 1 ? "" : "s"}`,
          severity: "INFO",
          data: {
            total_lost: Math.round(totalLost * 100) / 100,
            waste_total: Math.round(wasteTotal * 100) / 100,
            price_hike_total: Math.round(priceHikeTotal * 100) / 100,
            overstock_total: Math.round(overstockTotal * 100) / 100,
            shrinkage_total: Math.round(shrinkageTotal * 100) / 100,
            top_leak_item: topLeakItem,
            week_start: lastWeekStartDate,
            week_end: lastWeekEndDate,
            recipients_count: sentCount,
          },
        });

        results.push(`Weekly digest: ${restaurantName} → ${sentCount} recipient(s), ${formatUsd(totalLost)} lost`);
      }
    }

    return new Response(JSON.stringify({ success: true, processed: results.length, details: results }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("Process notifications error:", err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
