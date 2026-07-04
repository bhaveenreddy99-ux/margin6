import { startOfDay, startOfWeek } from "date-fns";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  buildLatestInventorySnapshot,
  dashboardSpendRangeFromFilter,
  linePriceIncreaseImpact,
  sumPeriodInvoiceSpend,
} from "@/domain/dashboard/dashboardSelectors";
import type { DashboardTimeFilter, InventorySessionItemRow } from "@/domain/dashboard/dashboardTypes";
import {
  computeFoodCostPct,
  computeMoneyLostTotal,
} from "@/domain/dashboard/dashboardTrustFormulas";
import { aggregateWasteRows } from "@/domain/waste/wasteMetricsAggregate";
import { summarizeInvoices } from "@/domain/invoices/invoicesPageSelectors";
import type { InvoiceListQueryRow } from "@/domain/invoices/invoicesPageTypes";
import { flattenInvoiceListRows } from "@/domain/invoices/invoicesPageHelpers";
import { riskThresholdsFromSettings } from "@/domain/inventory/riskThresholds";
import {
  fetchPriceIncreaseNotifications,
  sumPriceIncreaseImpactFromNotifications,
} from "@/domain/dashboard/priceIncreaseFromNotifications";
import { withLocationOrNull } from "@/domain/locations/locationQueryScope";
import { createAuditSupabaseClient } from "./auditSupabase";
import type { BrowserAuditSession } from "./auditSession";

export type LiveExpectedMetrics = {
  restaurantId: string;
  locationId: string | null;
  timeFilter: DashboardTimeFilter;
  inventoryValue: number;
  overstockValue: number;
  criticalLowCount: number;
  reorderValue: number;
  recordedWasteValue: number;
  priceIncreaseImpact: number;
  shrinkageValue: number;
  moneyLostTotal: number;
  deliveryIssuesCount: number;
  foodCostPct: number | null;
  invoiceTotal: number;
  invoicePending: number;
  invoiceActiveVendors: number;
  invoicePendingReview: number;
  catalogItemCount: number;
  parGuideItemCount: number;
  submittedSessionCount: number;
  inProgressSessionCount: number;
  wasteWeekCost: number;
  wasteTodayCost: number;
  unreadNotifications: number;
  smartOrderRedCount: number | null;
};

async function loadShrinkageValue(
  supabase: SupabaseClient,
  restaurantId: string,
  locationId: string | null,
  timeFilter: DashboardTimeFilter,
): Promise<number> {
  const { startDate, endDate } = dashboardSpendRangeFromFilter(timeFilter);
  let q = supabase
    .from("notifications")
    .select("data")
    .eq("restaurant_id", restaurantId)
    .in("type", ["SHRINK_ALERT", "COUNT_VARIANCE"])
    .gte("created_at", startDate)
    .lte("created_at", endDate);
  if (locationId) q = withLocationOrNull(q, locationId);
  const { data } = await q;
  let total = 0;
  for (const row of data ?? []) {
    const raw = row.data as { items?: Array<{ dollar_impact?: number }> } | null;
    for (const item of raw?.items ?? []) {
      const impact = Number(item?.dollar_impact);
      if (Number.isFinite(impact) && impact > 0) total += impact;
    }
  }
  return total;
}

async function loadInventorySnapshot(
  supabase: SupabaseClient,
  restaurantId: string,
  locationId: string | null,
) {
  let sessionQuery = supabase
    .from("inventory_sessions")
    .select("id, approved_at, name")
    .eq("restaurant_id", restaurantId)
    .eq("status", "APPROVED")
    .order("approved_at", { ascending: false })
    .limit(1);
  if (locationId) sessionQuery = withLocationOrNull(sessionQuery, locationId);

  const [{ data: sessions }, { data: riskSettings }] = await Promise.all([
    sessionQuery,
    supabase
      .from("smart_order_settings")
      .select("red_threshold, yellow_threshold")
      .eq("restaurant_id", restaurantId)
      .maybeSingle(),
  ]);

  const riskThresholds = riskThresholdsFromSettings(riskSettings);
  if (!sessions?.length) {
    return {
      inventoryValue: 0,
      overstockValue: 0,
      criticalLowCount: 0,
      reorderValue: 0,
      latestSessionUnitCostByCatalogId: {} as Record<string, number>,
    };
  }

  const { data: items } = await supabase
    .from("inventory_session_items")
    .select("*")
    .eq("session_id", sessions[0]!.id);

  const snapshot = buildLatestInventorySnapshot(
    (items ?? []) as InventorySessionItemRow[],
    riskThresholds,
  );

  return {
    inventoryValue: snapshot.inventoryValue,
    overstockValue: snapshot.overstockValue,
    criticalLowCount: snapshot.stockStatus.red,
    reorderValue: snapshot.reorderSummary?.totalReorderValue ?? 0,
    latestSessionUnitCostByCatalogId: snapshot.latestSessionUnitCostByCatalogId,
  };
}

async function loadWasteMetrics(
  supabase: SupabaseClient,
  restaurantId: string,
  locationId: string | null,
  timeFilter: DashboardTimeFilter,
  latestSessionUnitCostByCatalogId: Record<string, number>,
) {
  const { startDate, endDate } = dashboardSpendRangeFromFilter(timeFilter);
  const rangeStart = new Date(startDate);
  const rangeEnd = new Date(endDate);
  const todayStart = startOfDay(new Date());
  const weekStart = startOfWeek(new Date(), { weekStartsOn: 1 });

  let rangeBase = supabase
    .from("waste_log")
    .select("quantity, quantity_unit, total_cost, unit_cost, catalog_item_id")
    .eq("restaurant_id", restaurantId)
    .gte("logged_at", rangeStart.toISOString())
    .lte("logged_at", rangeEnd.toISOString());
  if (locationId) rangeBase = withLocationOrNull(rangeBase, locationId);
  const { data: wasteRange } = await rangeBase;

  let todayBase = supabase
    .from("waste_log")
    .select("total_cost")
    .eq("restaurant_id", restaurantId)
    .gte("logged_at", todayStart.toISOString());
  if (locationId) todayBase = withLocationOrNull(todayBase, locationId);
  const { data: wasteToday } = await todayBase;

  let weekBase = supabase
    .from("waste_log")
    .select("total_cost")
    .eq("restaurant_id", restaurantId)
    .gte("logged_at", weekStart.toISOString());
  if (locationId) weekBase = withLocationOrNull(weekBase, locationId);
  const { data: wasteWeek } = await weekBase;

  const catalogIds = [
    ...new Set(
      (wasteRange ?? [])
        .map((row) => row.catalog_item_id)
        .filter((id): id is string => typeof id === "string" && id.length > 0),
    ),
  ];
  const catalogDefaultById = new Map<string, number>();
  if (catalogIds.length > 0) {
    const { data: catalogRows } = await supabase
      .from("inventory_catalog_items")
      .select("id, default_unit_cost")
      .eq("restaurant_id", restaurantId)
      .in("id", catalogIds);
    for (const row of catalogRows ?? []) {
      const value = Number(row.default_unit_cost);
      if (Number.isFinite(value) && value >= 0) catalogDefaultById.set(row.id, value);
    }
  }

  const sessionUnitByCatalogId = new Map(Object.entries(latestSessionUnitCostByCatalogId));
  const { totalDollars } = aggregateWasteRows(
    wasteRange ?? [],
    catalogDefaultById,
    sessionUnitByCatalogId,
  );

  const todayCost = (wasteToday ?? []).reduce((sum, row) => sum + Number(row.total_cost ?? 0), 0);
  const weekCost = (wasteWeek ?? []).reduce((sum, row) => sum + Number(row.total_cost ?? 0), 0);

  return {
    recordedWasteValue: totalDollars,
    wasteTodayCost: todayCost,
    wasteWeekCost: weekCost,
  };
}

async function loadSpendMetrics(
  supabase: SupabaseClient,
  restaurantId: string,
  locationId: string | null,
  timeFilter: DashboardTimeFilter,
) {
  const { startDate, endDate } = dashboardSpendRangeFromFilter(timeFilter);
  const rangeStart = new Date(startDate);
  const rangeEnd = new Date(endDate);

  let invoiceStatusQuery = supabase
    .from("invoices")
    .select("id, invoice_total, invoice_date, status, receipt_status")
    .eq("restaurant_id", restaurantId);
  if (locationId) invoiceStatusQuery = withLocationOrNull(invoiceStatusQuery, locationId);

  const { data: invoiceStatusRows } = await invoiceStatusQuery;
  const invoicePeriodSummary = sumPeriodInvoiceSpend(invoiceStatusRows ?? [], rangeStart, rangeEnd);

  let priceImpact = 0;
  const periodInvoiceIds = (invoiceStatusRows ?? [])
    .filter((row) => {
      if (!row.invoice_date) return false;
      const date = new Date(row.invoice_date);
      return date >= rangeStart && date <= rangeEnd;
    })
    .map((row) => row.id);

  if (periodInvoiceIds.length > 0) {
    const { data: comparisons } = await supabase
      .from("invoice_line_comparisons")
      .select(
        "invoice_id, status, received_qty, po_qty, invoiced_unit_cost, po_unit_cost, invoiced_qty",
      )
      .in("invoice_id", periodInvoiceIds);

    for (const comparison of comparisons ?? []) {
      priceImpact += linePriceIncreaseImpact(comparison);
    }
  }

  const priceNotifs = await fetchPriceIncreaseNotificationsWithClient(
    supabase,
    restaurantId,
    locationId,
    startDate,
    endDate,
  );
  priceImpact += sumPriceIncreaseImpactFromNotifications(priceNotifs);

  return {
    deliveryIssuesCount: invoicePeriodSummary.issueInvoiceIds.size,
    priceIncreaseImpact: priceImpact,
    periodSpend: invoicePeriodSummary.periodSpend,
  };
}

async function fetchPriceIncreaseNotificationsWithClient(
  supabase: SupabaseClient,
  restaurantId: string,
  locationId: string | null,
  from: string,
  to: string,
) {
  let q = supabase
    .from("notifications")
    .select("id, data, created_at")
    .eq("restaurant_id", restaurantId)
    .eq("type", "PRICE_INCREASE")
    .gte("created_at", from)
    .lte("created_at", to);
  if (locationId) q = withLocationOrNull(q, locationId);
  const { data } = await q;
  return data ?? [];
}

async function loadFoodCostPct(
  supabase: SupabaseClient,
  locationId: string | null,
  periodSpend: number,
  timeFilter: DashboardTimeFilter,
): Promise<number | null> {
  if (!locationId || periodSpend <= 0) return null;
  const weekStart = startOfWeek(new Date(), { weekStartsOn: 1 }).toISOString().slice(0, 10);
  const { data } = await supabase
    .from("weekly_sales")
    .select("gross_sales")
    .eq("location_id", locationId)
    .eq("week_start", weekStart)
    .maybeSingle();
  const gross = data?.gross_sales != null ? Number(data.gross_sales) : null;
  return computeFoodCostPct(periodSpend, gross);
}

async function loadInvoicesSummary(
  supabase: SupabaseClient,
  restaurantId: string,
  locationId: string | null,
) {
  let query = supabase
    .from("invoices")
    .select("*, purchase_orders(po_number, smart_order_run_id)")
    .eq("restaurant_id", restaurantId)
    .order("created_at", { ascending: false });
  if (locationId) query = withLocationOrNull(query, locationId);
  const { data } = await query;
  const purchases = flattenInvoiceListRows((data ?? []) as InvoiceListQueryRow[]);
  const summary = summarizeInvoices(purchases);
  return {
    invoiceTotal: purchases.length,
    invoicePending: summary.draftCount + summary.receivedCount,
    invoiceActiveVendors: summary.activeVendors,
    invoicePendingReview: summary.pendingReviewCount,
  };
}

export async function fetchLiveExpectedMetrics(
  session: BrowserAuditSession,
  locationIdOverride?: string | null,
  timeFilter: DashboardTimeFilter = "this_week",
): Promise<LiveExpectedMetrics | null> {
  if (!session.restaurantId) return null;
  const supabase = createAuditSupabaseClient(session.accessToken);
  if (!supabase) return null;

  const restaurantId = session.restaurantId;
  const locationId = locationIdOverride ?? session.locationId ?? null;

  const inventory = await loadInventorySnapshot(supabase, restaurantId, locationId);
  const [waste, spend, shrinkageValue, invoiceSummary] = await Promise.all([
    loadWasteMetrics(
      supabase,
      restaurantId,
      locationId,
      timeFilter,
      inventory.latestSessionUnitCostByCatalogId,
    ),
    loadSpendMetrics(supabase, restaurantId, locationId, timeFilter),
    loadShrinkageValue(supabase, restaurantId, locationId, timeFilter),
    loadInvoicesSummary(supabase, restaurantId, locationId),
  ]);

  const foodCostPct = await loadFoodCostPct(
    supabase,
    locationId,
    spend.periodSpend,
    timeFilter,
  );

  const moneyLostTotal = computeMoneyLostTotal({
    recordedWasteValue: waste.recordedWasteValue,
    priceIncreaseImpact: spend.priceIncreaseImpact,
    overstockValue: inventory.overstockValue,
    shrinkageValue,
  });

  let catalogItemCount = 0;
  const { data: lists } = await supabase
    .from("inventory_lists")
    .select("id")
    .eq("restaurant_id", restaurantId);
  if (lists?.length) {
    const listIds = lists.map((l) => l.id);
    const { count } = await supabase
      .from("inventory_catalog_items")
      .select("id", { count: "exact", head: true })
      .in("inventory_list_id", listIds);
    catalogItemCount = count ?? 0;
  }

  let parGuideItemCount = 0;
  let parGuideQuery = supabase
    .from("par_guides")
    .select("id")
    .eq("restaurant_id", restaurantId)
    .order("updated_at", { ascending: false })
    .limit(1);
  if (locationId) parGuideQuery = withLocationOrNull(parGuideQuery, locationId);
  const { data: guides } = await parGuideQuery;
  if (guides?.[0]?.id) {
    const { count } = await supabase
      .from("par_guide_items")
      .select("id", { count: "exact", head: true })
      .eq("par_guide_id", guides[0].id);
    parGuideItemCount = count ?? 0;
  }

  let submittedQuery = supabase
    .from("inventory_sessions")
    .select("id", { count: "exact", head: true })
    .eq("restaurant_id", restaurantId)
    .eq("status", "SUBMITTED");
  if (locationId) submittedQuery = withLocationOrNull(submittedQuery, locationId);
  const { count: submittedSessionCount } = await submittedQuery;

  let inProgressQuery = supabase
    .from("inventory_sessions")
    .select("id", { count: "exact", head: true })
    .eq("restaurant_id", restaurantId)
    .eq("status", "IN_PROGRESS");
  if (locationId) inProgressQuery = withLocationOrNull(inProgressQuery, locationId);
  const { count: inProgressSessionCount } = await inProgressQuery;

  let unreadNotifications = 0;
  if (session.userId) {
    const windowStart = new Date();
    windowStart.setDate(windowStart.getDate() - 30);
    let unreadQ = supabase
      .from("notifications")
      .select("id", { count: "exact", head: true })
      .eq("user_id", session.userId)
      .eq("restaurant_id", restaurantId)
      .is("read_at", null)
      .gte("created_at", windowStart.toISOString());
    const { count } = await unreadQ;
    unreadNotifications = count ?? 0;
  }

  let smartOrderRedCount: number | null = null;
  let runQuery = supabase
    .from("smart_order_runs")
    .select("id")
    .eq("restaurant_id", restaurantId)
    .order("created_at", { ascending: false })
    .limit(1);
  if (locationId) runQuery = withLocationOrNull(runQuery, locationId);
  const { data: latestRun } = await runQuery;
  if (latestRun?.[0]?.id) {
    const { data: runItems } = await supabase
      .from("smart_order_run_items")
      .select("current_stock, par_level")
      .eq("run_id", latestRun[0].id);
    const { data: settings } = await supabase
      .from("smart_order_settings")
      .select("red_threshold, yellow_threshold")
      .eq("restaurant_id", restaurantId)
      .maybeSingle();
    const thresholds = riskThresholdsFromSettings(settings);
    const redPct = thresholds.redThresholdPercent ?? 50;
    smartOrderRedCount = (runItems ?? []).filter((item) => {
      const par = Number(item.par_level ?? 0);
      const stock = Number(item.current_stock ?? 0);
      if (par <= 0) return false;
      return stock <= 0 || (stock / par) * 100 < redPct;
    }).length;
  }

  return {
    restaurantId,
    locationId,
    timeFilter,
    inventoryValue: inventory.inventoryValue,
    overstockValue: inventory.overstockValue,
    criticalLowCount: inventory.criticalLowCount,
    reorderValue: inventory.reorderValue,
    recordedWasteValue: waste.recordedWasteValue,
    priceIncreaseImpact: spend.priceIncreaseImpact,
    shrinkageValue,
    moneyLostTotal,
    deliveryIssuesCount: spend.deliveryIssuesCount,
    foodCostPct,
    invoiceTotal: invoiceSummary.invoiceTotal,
    invoicePending: invoiceSummary.invoicePending,
    invoiceActiveVendors: invoiceSummary.invoiceActiveVendors,
    invoicePendingReview: invoiceSummary.invoicePendingReview,
    catalogItemCount,
    parGuideItemCount,
    submittedSessionCount: submittedSessionCount ?? 0,
    inProgressSessionCount: inProgressSessionCount ?? 0,
    wasteWeekCost: waste.wasteWeekCost,
    wasteTodayCost: waste.wasteTodayCost,
    unreadNotifications,
    smartOrderRedCount,
  };
}
