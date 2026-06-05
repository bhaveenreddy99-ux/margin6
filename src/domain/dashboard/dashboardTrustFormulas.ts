/**
 * Pure dashboard financial formulas — thin wrappers over canonical production math.
 * Used by dashboard trust tests; UI loaders should keep calling the underlying modules.
 */

import { priceIncreaseDollarImpact } from "@/domain/dashboard/priceIncreaseFromNotifications";
import type { PriceIncreaseNotificationItem } from "@/domain/dashboard/priceIncreaseFromNotifications";
import {
  computeLineInventoryValue,
  computeLineOverstockValue,
  computeLineReorderValue,
  computeSuggestedOrderCases,
} from "@/domain/inventory/casePlanningEngine";
import type { InventoryItemInput } from "@/domain/inventory/reorderEngine";
import { computeReorderSummary } from "@/domain/inventory/reorderEngine";
import { receivedVsBilledDollarVariance } from "@/lib/invoice-comparison";
import { dollarsForWasteRow, type WasteCostRowInput } from "@/domain/waste/recordedWasteValue";

export function computeOverstockValue(
  onHand: number,
  par: number,
  unitCost: number | null,
): number {
  return computeLineOverstockValue({
    currentStockCases: onHand,
    parLevelCases: par,
    unitCostPerCase: unitCost,
  }).dollars;
}

export function computeSmartOrderQty(onHand: number, par: number): number {
  return computeSuggestedOrderCases({
    currentStockCases: onHand,
    parLevelCases: par,
    unitCostPerCase: null,
  });
}

export function computeInventoryLineValue(onHand: number, unitCost: number | null): number {
  return computeLineInventoryValue({
    currentStockCases: onHand,
    parLevelCases: null,
    unitCostPerCase: unitCost,
  }).dollars;
}

export function computeReorderNeededValue(
  onHand: number,
  par: number,
  unitCost: number | null,
): number {
  return computeLineReorderValue({
    currentStockCases: onHand,
    parLevelCases: par,
    unitCostPerCase: unitCost,
  }).dollars;
}

export function computeCriticalLowStockCount(items: InventoryItemInput[]): number {
  return computeReorderSummary(items).redCount;
}

export function computePriceHikePct(oldCost: number, newCost: number): number {
  if (!Number.isFinite(oldCost) || !Number.isFinite(newCost) || oldCost <= 0 || newCost <= oldCost) {
    return 0;
  }
  return ((newCost - oldCost) / oldCost) * 100;
}

export function computePriceHikeImpact(item: PriceIncreaseNotificationItem, qty = 1): number {
  return priceIncreaseDollarImpact(item, qty);
}

export function computeWasteValue(
  row: WasteCostRowInput,
  catalogDefaultUnitById: ReadonlyMap<string, number> = new Map(),
  sessionUnitByCatalogId: ReadonlyMap<string, number> = new Map(),
): number {
  return dollarsForWasteRow(row, catalogDefaultUnitById, sessionUnitByCatalogId);
}

/** missing_qty × invoice_unit_cost (short delivery at invoiced unit price). */
export function computeMissingDeliveryValue(missingQty: number, invoiceUnitCost: number): number {
  const qty = Number(missingQty);
  const cost = Number(invoiceUnitCost);
  if (!Number.isFinite(qty) || !Number.isFinite(cost) || qty <= 0 || cost <= 0) return 0;
  return qty * cost;
}

export function computeMissingDeliveryFromComparison(
  invoicedQty: number,
  receivedQty: number,
  invoicedUnitCost: number,
): number {
  const variance = receivedVsBilledDollarVariance(invoicedQty, receivedQty, invoicedUnitCost);
  return variance != null && variance > 0 ? variance : 0;
}

/** Food cost % stays null until weekly gross sales is entered (> 0). */
export function computeFoodCostPct(
  periodSpend: number,
  weeklyGrossSales: number | null | undefined,
): number | null {
  if (periodSpend <= 0) return null;
  if (weeklyGrossSales == null || weeklyGrossSales <= 0) return null;
  const pct = (periodSpend / weeklyGrossSales) * 100;
  return Number.isFinite(pct) ? pct : null;
}

/** Money Lost widget total (Dashboard hero). */
export function computeMoneyLostTotal(args: {
  recordedWasteValue: number;
  priceIncreaseImpact: number;
  overstockValue: number;
  shrinkageValue: number;
}): number {
  return (
    args.recordedWasteValue +
    args.priceIncreaseImpact +
    args.overstockValue +
    args.shrinkageValue
  );
}

/** Profit & Loss banner on Dashboard (excludes shrinkage and invoice-issue dollars). */
export function computeDashboardSavingsBannerTotal(args: {
  overstockValue: number;
  recordedWasteValue: number;
  priceIncreaseImpact: number;
}): number {
  return args.overstockValue + args.recordedWasteValue + args.priceIncreaseImpact;
}

/** Documented trust formula: overstock + waste + invoice issues + price hike impact. */
export function computeTrustPotentialSavings(args: {
  overstockValue: number;
  wasteValue: number;
  invoiceIssuesValue: number;
  priceHikeImpact: number;
}): number {
  return (
    args.overstockValue + args.wasteValue + args.invoiceIssuesValue + args.priceHikeImpact
  );
}

export function aggregateSeedInventoryMetrics(items: InventoryItemInput[]) {
  const summary = computeReorderSummary(items);
  const inventoryValue = items.reduce(
    (sum, item) =>
      sum +
      computeLineInventoryValue({
        currentStockCases: item.current_stock,
        parLevelCases: item.par_level,
        unitCostPerCase: item.unit_cost,
      }).dollars,
    0,
  );

  return {
    inventoryValue,
    overstockValue: summary.totalWasteValue,
    totalReorderValue: summary.totalReorderValue,
    criticalLowStockCount: summary.redCount,
    reorderSummary: summary,
  };
}
