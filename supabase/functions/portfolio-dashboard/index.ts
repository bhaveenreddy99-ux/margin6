import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { computeOrderQtyCases, computeRiskLevel } from "../../../src/lib/inventory-utils.ts";

/**
 * Dollar overstock above PAR — parity with {@link computeLineOverstockValue} in
 * `src/domain/inventory/casePlanningEngine.ts` (rounded to 2 decimals).
 * Inlined so Deno can bundle this function without resolving `@/` in that module.
 * - `unit_cost === 0` is valid (contributes $0 overstock, not treated as missing).
 * - `null` / `undefined` cost → $0 overstock when overage > 0.
 */
function lineOverstockDollars(
  currentStockCases: number | null | undefined,
  parLevelCases: number | null | undefined,
  unitCostPerCase: number | null | undefined,
): number {
  const stock = currentStockCases ?? 0;
  const par = parLevelCases ?? 0;
  const overage = Math.max(0, stock - par);
  if (overage === 0) return 0;
  if (unitCostPerCase == null) return 0;
  return Math.round(overage * unitCostPerCase * 100) / 100;
}

function parseUnitCostPerCase(raw: unknown): number | null {
  if (raw == null) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function resolvePurchaseHistoryBusinessDate(row: { invoice_date?: string | null; created_at?: string | null }): Date {
  if (row.invoice_date) {
    const parsed = new Date(`${row.invoice_date}T12:00:00`);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }

  return new Date(row.created_at ?? 0);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const userId = user.id;

    /** Spend aggregation window (client sends ISO strings). Default: month start → now (matches pre–body-filter behavior). */
    let spendRangeStart = new Date();
    spendRangeStart.setDate(1);
    spendRangeStart.setHours(0, 0, 0, 0);
    let spendRangeEnd = new Date();

    if (req.method === "POST") {
      try {
        const body = await req.json() as { startDate?: string; endDate?: string };
        if (body?.startDate && body?.endDate) {
          spendRangeStart = new Date(body.startDate);
          spendRangeEnd = new Date(body.endDate);
        }
      } catch {
        // keep defaults
      }
    }

    // Get all restaurants user belongs to
    const { data: memberships } = await supabase
      .from("restaurant_members")
      .select("restaurant_id, role, restaurants(id, name)")
      .eq("user_id", userId);

    if (!memberships?.length) {
      return new Response(JSON.stringify({ restaurants: [], totals: { red: 0, yellow: 0, green: 0 } }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const result: any[] = [];
    let totalRed = 0, totalYellow = 0, totalGreen = 0;
    let totalOverstockValue = 0;
    let totalSpendMonth = 0;

    for (const membership of memberships) {
      const rid = (membership as any).restaurants.id;
      const rname = (membership as any).restaurants.name;

      const { data: riskSettingsRow } = await supabase
        .from("smart_order_settings")
        .select("red_threshold, yellow_threshold")
        .eq("restaurant_id", rid)
        .maybeSingle();
      const riskThresholds = {
        redThresholdPercent: riskSettingsRow?.red_threshold ?? 50,
        yellowThresholdPercent: riskSettingsRow?.yellow_threshold ?? 100,
      };

      // Get all locations for this restaurant
      const { data: locations } = await supabase
        .from("locations")
        .select("id, name")
        .eq("restaurant_id", rid)
        .eq("is_active", true);

      const locationResults: any[] = [];

      // Process per-location if locations exist, otherwise one restaurant-level pass (no location filter).
      // When locations exist, also process sessions with location_id IS NULL ("Unassigned") — same idea as
      // loadInventoryMetrics: with a locationId you filter; without, unscoped / null-specific queries apply.
      const locationIds = locations?.map((l) => l.id) || [];
      type ProcessTarget = {
        locationId: string | null;
        locationName: string | null;
        /** If true, filter .is("location_id", null) — matches unassigned approved counts */
        isNullLocation?: boolean;
      };
      const processTargets: ProcessTarget[] =
        locationIds.length > 0
          ? [
              ...locationIds.map((lid) => ({
                locationId: lid,
                locationName: locations!.find((l) => l.id === lid)?.name || "",
                isNullLocation: false,
              })),
              { locationId: null, locationName: "Unassigned", isNullLocation: true },
            ]
          : [{ locationId: null, locationName: null, isNullLocation: false }];

      let restRed = 0, restYellow = 0, restGreen = 0;
      let restOverstockValue = 0;

      for (const target of processTargets) {
        // Latest approved session for this location (or unassigned), aligned with client session queries
        let sessionQuery = supabase
          .from("inventory_sessions")
          .select("id, approved_at")
          .eq("restaurant_id", rid)
          .eq("status", "APPROVED")
          .order("approved_at", { ascending: false })
          .limit(1);

        if (target.isNullLocation) {
          sessionQuery = sessionQuery.is("location_id", null);
        } else if (target.locationId) {
          sessionQuery = sessionQuery.eq("location_id", target.locationId);
        }

        const { data: sessions } = await sessionQuery;

        let locRed = 0, locYellow = 0, locGreen = 0;
        let locOverstockValue = 0;
        let topItems: any[] = [];

        if (sessions?.length) {
          const { data: items } = await supabase
            .from("inventory_session_items")
            .select("item_name, current_stock, par_level, unit, unit_cost, pack_size")
            .eq("session_id", sessions[0].id);

          if (items) {
            items.forEach((i: any) => {
              const stock = Number(i.current_stock ?? 0);
              const par = Number(i.par_level ?? 0);
              const risk = computeRiskLevel(stock, i.par_level, riskThresholds);
              if (risk === "RED") locRed++;
              else if (risk === "YELLOW") locYellow++;
              else if (risk === "GREEN") locGreen++;
              locOverstockValue += lineOverstockDollars(
                i.current_stock,
                i.par_level,
                parseUnitCostPerCase(i.unit_cost),
              );
            });
            topItems = items
              .map((i: any) => ({
                ...i,
                suggested: computeOrderQtyCases(i.current_stock, i.par_level),
                ratio: Number(i.current_stock) / Math.max(Number(i.par_level), 1),
              }))
              .sort((a: any, b: any) => b.suggested - a.suggested)
              .slice(0, 5);
          }
        }

        restRed += locRed;
        restYellow += locYellow;
        restGreen += locGreen;
        restOverstockValue += locOverstockValue;

        if (target.locationId || target.isNullLocation) {
          locationResults.push({
            locationId: target.isNullLocation ? "__unassigned__" : target.locationId,
            locationName: target.locationName ?? "",
            red: locRed,
            yellow: locYellow,
            green: locGreen,
            overstockValue: locOverstockValue,
            lastApproved: sessions?.[0]?.approved_at || null,
          });
        }
      }

      // Spend in requested period (see spendRangeStart / spendRangeEnd)
      const { data: invDocRows } = await supabase
        .from("invoices")
        .select("id")
        .eq("restaurant_id", rid);
      const invoiceIdSet = new Set((invDocRows ?? []).map((r: { id: string }) => r.id));

      let spendMonth = 0;

      const { data: invConfirmed } = await supabase
        .from("invoices")
        .select("id, created_at, invoice_date")
        .eq("restaurant_id", rid)
        .eq("status", "confirmed");

      const invInMonth = (invConfirmed ?? []).filter(
        (p: { invoice_date?: string | null; created_at?: string | null }) => {
          const d = resolvePurchaseHistoryBusinessDate(p);
          return d >= spendRangeStart && d <= spendRangeEnd;
        },
      );
      if (invInMonth.length > 0) {
        const iids = invInMonth.map((i: { id: string }) => i.id);
        const { data: invItems } = await supabase
          .from("invoice_items")
          .select("total_cost")
          .in("invoice_id", iids);
        if (invItems) {
          spendMonth += invItems.reduce((sum, i) => sum + Number(i.total_cost || 0), 0);
        }
      }

      const { data: recentPH } = await supabase
        .from("purchase_history")
        .select("id, created_at, invoice_date")
        .eq("restaurant_id", rid)
        .in("invoice_status", ["COMPLETE", "POSTED"]);

      const filteredPH = (recentPH ?? []).filter(
        (p: { id: string; invoice_date?: string | null; created_at?: string | null }) => {
          if (invoiceIdSet.has(p.id)) return false;
          const d = resolvePurchaseHistoryBusinessDate(p);
          return d >= spendRangeStart && d <= spendRangeEnd;
        },
      );
      if (filteredPH.length > 0) {
        const phIds = filteredPH.map((p: { id: string }) => p.id);
        const { data: phItems } = await supabase
          .from("purchase_history_items")
          .select("total_cost")
          .in("purchase_history_id", phIds);
        if (phItems) {
          spendMonth += phItems.reduce((sum, i) => sum + Number(i.total_cost || 0), 0);
        }
      }

      // Recent orders count
      const { count: orderCount } = await supabase
        .from("orders")
        .select("id", { count: "exact", head: true })
        .eq("restaurant_id", rid);

      // Unread notifications
      const { count: unreadAlerts } = await supabase
        .from("notifications")
        .select("id", { count: "exact", head: true })
        .eq("user_id", userId)
        .eq("restaurant_id", rid)
        .is("read_at", null);

      totalRed += restRed;
      totalYellow += restYellow;
      totalGreen += restGreen;
      totalOverstockValue += restOverstockValue;
      totalSpendMonth += spendMonth;

      result.push({
        id: rid,
        name: rname,
        role: membership.role,
        red: restRed,
        yellow: restYellow,
        green: restGreen,
        overstockValue: restOverstockValue,
        spendMonth,
        locations: locationResults,
        recentOrders: orderCount || 0,
        unreadAlerts: unreadAlerts || 0,
        lastApproved: null, // computed per-location
      });
    }

    return new Response(JSON.stringify({
      restaurants: result,
      totals: { red: totalRed, yellow: totalYellow, green: totalGreen, overstockValue: totalOverstockValue, spendMonth: totalSpendMonth },
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("Portfolio dashboard error:", err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
