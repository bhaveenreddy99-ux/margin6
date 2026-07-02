import { subDays } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import { linePriceIncreaseImpact } from "@/domain/dashboard/dashboardSelectors";
import { computeLineInventoryValue } from "@/domain/inventory/casePlanningEngine";
import type { InvoiceLineComparisonRow } from "@/domain/dashboard/dashboardTypes";
import type { LoadOutcome } from "@/domain/dashboard/loadOutcome";

export type RestaurantPortfolioSummary = {
  lastCountAt: string | null;
  /** null = insufficient data to show a dollar amount (display "—") */
  moneyLost: number | null;
  inventoryValue: number | null;
  hasConfirmedInvoices: boolean;
};

type ShrinkNotificationItem = {
  dollar_impact?: number | string;
};

const EMPTY_SUMMARY: RestaurantPortfolioSummary = {
  lastCountAt: null,
  moneyLost: null,
  inventoryValue: null,
  hasConfirmedInvoices: false,
};

function initSummaries(ids: string[]): Record<string, RestaurantPortfolioSummary> {
  const next: Record<string, RestaurantPortfolioSummary> = {};
  for (const id of ids) {
    next[id] = { ...EMPTY_SUMMARY };
  }
  return next;
}

function sumShrinkageFromNotificationData(data: unknown): number {
  const raw = data as { items?: unknown } | null | undefined;
  const items = Array.isArray(raw?.items) ? (raw.items as ShrinkNotificationItem[]) : [];
  let total = 0;
  for (const item of items) {
    const impact = Number(item?.dollar_impact);
    if (Number.isFinite(impact) && impact > 0) total += impact;
  }
  return total;
}

/**
 * Loads per-restaurant KPIs for the My Restaurants portfolio view.
 * Aggregates waste, price hikes, and shrinkage over the last 7 days.
 */
export async function loadRestaurantPortfolioSummaries(
  restaurantIds: string[],
): Promise<LoadOutcome<Record<string, RestaurantPortfolioSummary>>> {
  if (restaurantIds.length === 0) return { status: "ok", value: {} };

  const ids = restaurantIds;
  const weekStartIso = subDays(new Date(), 7).toISOString();
  const weekStartDate = subDays(new Date(), 7).toISOString().slice(0, 10);

  const [
    sessionsResult,
    wasteResult,
    invoicesResult,
    confirmedResult,
    shrinkResult,
  ] = await Promise.all([
    supabase
      .from("inventory_sessions")
      .select("id, restaurant_id, approved_at")
      .in("restaurant_id", ids)
      .eq("status", "APPROVED")
      .order("approved_at", { ascending: false }),
    supabase
      .from("waste_log")
      .select("restaurant_id, total_cost")
      .in("restaurant_id", ids)
      .gte("logged_at", weekStartIso)
      .not("total_cost", "is", null),
    supabase
      .from("invoices")
      .select("id, restaurant_id, invoice_date")
      .in("restaurant_id", ids)
      .eq("status", "confirmed")
      .gte("invoice_date", weekStartDate),
    supabase
      .from("invoices")
      .select("restaurant_id")
      .in("restaurant_id", ids)
      .eq("status", "confirmed"),
    supabase
      .from("notifications")
      .select("restaurant_id, data")
      .in("restaurant_id", ids)
      .in("type", ["SHRINK_ALERT", "COUNT_VARIANCE"])
      .gte("created_at", weekStartIso),
  ]);

  // Any failed core query makes the whole portfolio unreliable — surface an error
  // instead of rendering every restaurant as "—"/$0.
  if (sessionsResult.error) return { status: "error", error: sessionsResult.error };
  if (wasteResult.error) return { status: "error", error: wasteResult.error };
  if (invoicesResult.error) return { status: "error", error: invoicesResult.error };
  if (confirmedResult.error) return { status: "error", error: confirmedResult.error };
  if (shrinkResult.error) return { status: "error", error: shrinkResult.error };

  const summaries = initSummaries(ids);

  const latestSessionByRestaurant: Record<string, string> = {};
  for (const row of sessionsResult.data ?? []) {
    const rid = row.restaurant_id as string;
    if (!rid || !row.approved_at) continue;
    if (!summaries[rid].lastCountAt) {
      summaries[rid].lastCountAt = row.approved_at as string;
      latestSessionByRestaurant[rid] = row.id as string;
    }
  }

  const confirmedRestaurantIds = new Set<string>();
  for (const row of confirmedResult.data ?? []) {
    const rid = row.restaurant_id as string;
    if (rid) {
      confirmedRestaurantIds.add(rid);
      summaries[rid].hasConfirmedInvoices = true;
    }
  }

  const wasteByRestaurant: Record<string, number> = {};
  for (const row of wasteResult.data ?? []) {
    const rid = row.restaurant_id as string;
    const cost = Number(row.total_cost);
    if (!rid || !Number.isFinite(cost)) continue;
    wasteByRestaurant[rid] = (wasteByRestaurant[rid] ?? 0) + cost;
  }

  const hikeByRestaurant: Record<string, number> = {};
  const invoiceIds: string[] = [];
  const invoiceRestaurantById = new Map<string, string>();
  for (const row of invoicesResult.data ?? []) {
    const rid = row.restaurant_id as string;
    const iid = row.id as string;
    if (!rid || !iid) continue;
    invoiceIds.push(iid);
    invoiceRestaurantById.set(iid, rid);
  }

  if (invoiceIds.length > 0) {
    const { data: comparisons, error: comparisonsError } = (await supabase
      .from("invoice_line_comparisons")
      .select(
        "invoice_id, status, received_qty, po_qty, invoiced_unit_cost, po_unit_cost, invoiced_qty",
      )
      .in("invoice_id", invoiceIds)) as { data: InvoiceLineComparisonRow[] | null; error: unknown };
    if (comparisonsError) return { status: "error", error: comparisonsError };

    for (const comparison of comparisons ?? []) {
      if (!comparison.invoice_id || comparison.status !== "price_mismatch") continue;
      const rid = invoiceRestaurantById.get(comparison.invoice_id);
      if (!rid) continue;
      const impact = linePriceIncreaseImpact(comparison);
      if (impact > 0) {
        hikeByRestaurant[rid] = (hikeByRestaurant[rid] ?? 0) + impact;
      }
    }
  }

  const shrinkByRestaurant: Record<string, number> = {};
  for (const row of shrinkResult.data ?? []) {
    const rid = row.restaurant_id as string;
    if (!rid) continue;
    const impact = sumShrinkageFromNotificationData(row.data);
    if (impact > 0) {
      shrinkByRestaurant[rid] = (shrinkByRestaurant[rid] ?? 0) + impact;
    }
  }

  const sessionIds = Object.values(latestSessionByRestaurant);
  if (sessionIds.length > 0) {
    const { data: sessionItems, error: sessionItemsError } = await supabase
      .from("inventory_session_items")
      .select("session_id, current_stock, unit_cost")
      .in("session_id", sessionIds);
    if (sessionItemsError) return { status: "error", error: sessionItemsError };

    const sessionToRestaurant = new Map<string, string>(
      Object.entries(latestSessionByRestaurant).map(([rid, sid]) => [sid, rid]),
    );

    for (const item of sessionItems ?? []) {
      const sid = item.session_id as string;
      const rid = sessionToRestaurant.get(sid);
      if (!rid) continue;
      const { dollars: value } = computeLineInventoryValue({
        currentStockCases: Number(item.current_stock),
        parLevelCases: null,
        unitCostPerCase: Number(item.unit_cost),
      });
      if (value > 0) {
        summaries[rid].inventoryValue = (summaries[rid].inventoryValue ?? 0) + value;
      }
    }

    for (const rid of ids) {
      if (summaries[rid].inventoryValue == null && latestSessionByRestaurant[rid]) {
        summaries[rid].inventoryValue = 0;
      }
    }
  }

  for (const rid of ids) {
    const waste = wasteByRestaurant[rid] ?? 0;
    const hike = hikeByRestaurant[rid] ?? 0;
    const shrink = shrinkByRestaurant[rid] ?? 0;
    const total = waste + hike + shrink;
    const hasData =
      summaries[rid].hasConfirmedInvoices ||
      total > 0 ||
      summaries[rid].lastCountAt != null;

    summaries[rid].moneyLost = hasData ? total : null;
  }

  return { status: "ok", value: summaries };
}

export type RestaurantPortfolioStatus =
  | "active"
  | "overdue"
  | "no_count"
  | "setup_needed";

export function getRestaurantPortfolioStatus(
  summary: RestaurantPortfolioSummary,
): RestaurantPortfolioStatus {
  if (!summary.hasConfirmedInvoices) return "setup_needed";
  if (!summary.lastCountAt) return "no_count";

  const daysSince = Math.floor(
    (Date.now() - new Date(summary.lastCountAt).getTime()) / (1000 * 60 * 60 * 24),
  );
  if (daysSince < 7) return "active";
  if (daysSince <= 14) return "overdue";
  return "no_count";
}

export function portfolioStatusLabel(status: RestaurantPortfolioStatus): string {
  switch (status) {
    case "active":
      return "Active";
    case "overdue":
      return "Overdue";
    case "no_count":
      return "No Count";
    case "setup_needed":
      return "Setup needed";
  }
}
