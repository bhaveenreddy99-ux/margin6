/**
 * Money Leak Report — read-only snapshot composition.
 * Orchestrates existing dashboard loaders and selectors only; no new money math.
 */

import { supabase } from "@/integrations/supabase/client";
import {
  dashboardSpendRangeFromFilter,
  invoiceBusinessDateInRange,
  isInvoiceLineComparisonProblem,
} from "@/domain/dashboard/dashboardSelectors";
import { loadInventoryMetrics, EMPTY_INVENTORY_RESULT } from "@/domain/dashboard/loadInventoryMetrics";
import type { InventoryMetricsResult } from "@/domain/dashboard/loadInventoryMetrics";
import { loadSpendMetrics } from "@/domain/dashboard/loadSpendMetrics";
import type { SpendMetricsResult } from "@/domain/dashboard/loadSpendMetrics";
import { loadWasteMetrics } from "@/domain/dashboard/loadWasteMetrics";
import type { WasteMetricsResult } from "@/domain/dashboard/loadWasteMetrics";
import type { DashboardInvoiceStatusRow, DashboardTimeFilter, InvoiceLineComparisonRow } from "@/domain/dashboard/dashboardTypes";

export type MoneyLeakPeriod = {
  start: string;
  end: string;
};

export type MoneyLeakRealLoss = {
  wasteDollars: number;
  priceIncreaseDollars: number;
  total: number;
};

export type MoneyLeakRiskExposure = {
  overstockDollars: number;
  reorderGapDollars: number;
  total: number;
};

export type MoneyLeakDataIssues = {
  wasteMissingCostCount: number;
  invoiceProblemLineCount: number;
  missingCostItems: number;
};

export type MoneyLeakMetadata = {
  lastApprovedSessionAt?: string;
  notes: string[];
};

export type MoneyLeakSnapshot = {
  period: MoneyLeakPeriod;
  locationId?: string;
  realLoss: MoneyLeakRealLoss;
  /** Decimal ratio (0.0342 = 3.42%). Null when gross sales unknown, ≤ 0, or missing. */
  realLossPercentOfRevenue: number | null;
  riskExposure: MoneyLeakRiskExposure;
  dataIssues: MoneyLeakDataIssues;
  metadata: MoneyLeakMetadata;
};

export type BuildMoneyLeakSnapshotInput = {
  restaurantId: string;
  locationId?: string;
  timeFilter: DashboardTimeFilter;
  grossSalesForWeek?: number | null;
};

const DEFAULT_NOTES = [
  "Real loss uses recorded waste (period) and invoice price walk vs PO (period). No POS.",
  "Risk exposure uses the latest approved inventory session (overstock and reorder gap in cases × $/case).",
  "Waste rows without reliable cost are counted in data issues and may understate waste dollars.",
] as const;

/**
 * Pure composition from loader outputs — use in tests; production callers use {@link buildMoneyLeakSnapshot}.
 */
export function moneyLeakSnapshotFromParts(args: {
  period: MoneyLeakPeriod;
  locationId?: string;
  inventory: Pick<
    InventoryMetricsResult,
    "overstockValue" | "reorderSummary" | "missingCostCount" | "lastSessionApprovedAtIso"
  >;
  waste: Pick<WasteMetricsResult, "recordedWasteValue" | "wasteItemsMissingCost">;
  spend: Pick<SpendMetricsResult, "priceIncreaseImpact">;
  invoiceProblemLineCount: number;
  extraNotes?: string[];
  grossSalesForWeek?: number | null;
}): MoneyLeakSnapshot {
  const wasteDollars = args.waste.recordedWasteValue;
  const priceIncreaseDollars = args.spend.priceIncreaseImpact;
  const overstockDollars = args.inventory.overstockValue;
  const reorderGapDollars = args.inventory.reorderSummary?.totalReorderValue ?? 0;
  const realLossTotal = wasteDollars + priceIncreaseDollars;
  const gross = args.grossSalesForWeek;
  const realLossPercentOfRevenue =
    gross != null && Number.isFinite(gross) && gross > 0 ? realLossTotal / gross : null;

  const notes = [...DEFAULT_NOTES, ...(args.extraNotes ?? [])];

  return {
    period: args.period,
    locationId: args.locationId,
    realLoss: {
      wasteDollars,
      priceIncreaseDollars,
      total: realLossTotal,
    },
    realLossPercentOfRevenue,
    riskExposure: {
      overstockDollars,
      reorderGapDollars,
      total: overstockDollars + reorderGapDollars,
    },
    dataIssues: {
      wasteMissingCostCount: args.waste.wasteItemsMissingCost,
      invoiceProblemLineCount: args.invoiceProblemLineCount,
      missingCostItems: args.inventory.missingCostCount,
    },
    metadata: {
      lastApprovedSessionAt: args.inventory.lastSessionApprovedAtIso ?? undefined,
      notes,
    },
  };
}

/**
 * Same period-invoice resolution as {@link loadSpendMetrics}; counts comparison rows where
 * {@link isInvoiceLineComparisonProblem} is true (line-level, not distinct invoices).
 */
async function fetchInvoiceProblemLineCountForPeriod(
  restaurantId: string,
  locationId: string | undefined,
  timeFilter: DashboardTimeFilter,
): Promise<number> {
  const { startDate, endDate } = dashboardSpendRangeFromFilter(timeFilter);
  const rangeStart = new Date(startDate);
  const rangeEnd = new Date(endDate);

  let invoiceStatusQuery = supabase
    .from("invoices")
    .select("id, invoice_total, invoice_date, status, receipt_status")
    .eq("restaurant_id", restaurantId);
  if (locationId) invoiceStatusQuery = invoiceStatusQuery.eq("location_id", locationId);

  const { data: invoiceStatusRows } = (await invoiceStatusQuery) as unknown as {
    data: DashboardInvoiceStatusRow[] | null;
  };

  const periodInvoiceIds = (invoiceStatusRows ?? [])
    .filter((row) => invoiceBusinessDateInRange(row.invoice_date, rangeStart, rangeEnd))
    .map((row) => row.id);

  if (periodInvoiceIds.length === 0) return 0;

  const { data: comparisons } = (await supabase
    .from("invoice_line_comparisons")
    .select("invoice_id, status, received_qty, po_qty, invoiced_unit_cost, po_unit_cost, invoiced_qty")
    .in("invoice_id", periodInvoiceIds)) as unknown as { data: InvoiceLineComparisonRow[] | null };

  let count = 0;
  for (const row of comparisons ?? []) {
    if (isInvoiceLineComparisonProblem(row)) count += 1;
  }
  return count;
}

export async function buildMoneyLeakSnapshot(input: BuildMoneyLeakSnapshotInput): Promise<MoneyLeakSnapshot> {
  const { startDate, endDate } = dashboardSpendRangeFromFilter(input.timeFilter);
  const period: MoneyLeakPeriod = { start: startDate, end: endDate };

  const inventoryOutcome = await loadInventoryMetrics(input.restaurantId, input.locationId);
  const inventory =
    inventoryOutcome.status === "ok" ? inventoryOutcome.value : EMPTY_INVENTORY_RESULT;

  const [wasteOutcome, spendOutcome, invoiceProblemLineCount] = await Promise.all([
    loadWasteMetrics(
      input.restaurantId,
      input.locationId,
      input.timeFilter,
      inventory.latestSessionUnitCostByCatalogId,
    ),
    loadSpendMetrics(input.restaurantId, input.locationId, input.timeFilter),
    fetchInvoiceProblemLineCountForPeriod(input.restaurantId, input.locationId, input.timeFilter),
  ]);

  // Reports surface has no per-KPI error UI; preserve prior behaviour (degrade a
  // failed waste query to an empty result). The dashboard is where the silent-$0
  // error state lives.
  const waste =
    wasteOutcome.status === "ok"
      ? wasteOutcome.value
      : { todayWasteEntries: [], recordedWasteValue: 0, recordedWasteCount: 0, wasteItemsMissingCost: 0 };
  const spend =
    spendOutcome.status === "ok"
      ? spendOutcome.value
      : { periodSpend: 0, spendOverviewData: null, deliveryIssuesCount: 0, priceIncreaseImpact: 0 };

  return moneyLeakSnapshotFromParts({
    period,
    locationId: input.locationId,
    inventory,
    waste,
    spend,
    invoiceProblemLineCount,
    grossSalesForWeek: input.grossSalesForWeek,
  });
}
