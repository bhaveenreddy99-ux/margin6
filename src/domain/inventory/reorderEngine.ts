/**
 * Pure reorder, stock risk, and waste math for inventory lines.
 * Reorder qty uses {@link computeOrderQty} (same as Smart Order). Risk uses {@link getRisk}
 * with restaurant thresholds (same as Enter Inventory / Smart Order).
 */

import {
  computeOrderQty,
  getRisk,
  type RiskLevel,
  type RiskThresholds,
} from "@/lib/inventory-utils";

export type InventoryItemInput = {
  current_stock: number | null;
  par_level: number | null;
  unit_cost: number | null;
  unit?: string | null;
  /** Session / catalog pack hint — must match Smart Order for identical suggested qty. */
  pack_size?: string | null;
};

export type InventoryItemComputed = {
  suggestedOrder: number;
  ratio: number;
  riskLevel: RiskLevel;
  wasteValue: number;
};

function finiteOrZero(n: number | null | undefined): number {
  return n != null && Number.isFinite(n) ? n : 0;
}

function finitePar(n: number | null | undefined): number | null {
  if (n == null || !Number.isFinite(n)) return null;
  return n;
}

/**
 * Stock coverage vs PAR: current_stock / par_level.
 * Returns 0 when PAR is missing or ≤ 0 (no meaningful ratio).
 */
export function computeStockRatio(item: InventoryItemInput): number {
  const par = finitePar(item.par_level);
  if (par == null || par <= 0) return 0;
  const cur = finiteOrZero(item.current_stock);
  return cur / par;
}

/**
 * Dollar value of stock above PAR (overage × unit cost).
 * If current ≤ par or `unit_cost` missing → 0.
 */
export function computeWasteValue(item: InventoryItemInput): number {
  const cur = finiteOrZero(item.current_stock);
  const par = finiteOrZero(item.par_level);
  const cost = finiteOrZero(item.unit_cost);
  if (cur <= par) return 0;
  return (cur - par) * cost;
}

/**
 * Full computed row: suggested order matches Smart Order (`computeOrderQty`);
 * risk matches configurable thresholds via `getRisk`.
 */
export function computeInventoryItem(
  item: InventoryItemInput,
  thresholds?: RiskThresholds,
): InventoryItemComputed {
  const suggestedOrder = computeOrderQty(
    item.current_stock,
    item.par_level,
    item.unit,
    item.pack_size ?? null,
  );
  const ratio = computeStockRatio(item);
  const riskLevel = getRisk(item.current_stock, item.par_level, thresholds).level;
  return {
    suggestedOrder,
    ratio,
    riskLevel,
    wasteValue: computeWasteValue(item),
  };
}

export type ReorderSummary = {
  totalReorderValue: number;
  totalSuggestedUnits: number;
  totalWasteValue: number;
  redCount: number;
  yellowCount: number;
  greenCount: number;
  noParCount: number;
  /** Items where unit_cost is null — these contribute $0 to reorder and waste values. */
  missingCostCount: number;
};

/**
 * Aggregates across many lines.
 * `totalReorderValue` = Σ(suggestedOrder × unit_cost) per item (missing cost → 0).
 * `totalSuggestedUnits` = Σ suggestedOrder (aligned with Smart Order rounding).
 */
export function computeReorderSummary(
  items: InventoryItemInput[],
  thresholds?: RiskThresholds,
): ReorderSummary {
  let totalReorderValue = 0;
  let totalSuggestedUnits = 0;
  let totalWasteValue = 0;
  let redCount = 0;
  let yellowCount = 0;
  let greenCount = 0;
  let noParCount = 0;

  for (const item of items) {
    const c = computeInventoryItem(item, thresholds);
    totalReorderValue += c.suggestedOrder * finiteOrZero(item.unit_cost);
    totalSuggestedUnits += c.suggestedOrder;
    totalWasteValue += c.wasteValue;
    if (c.riskLevel === "RED") redCount += 1;
    else if (c.riskLevel === "YELLOW") yellowCount += 1;
    else if (c.riskLevel === "GREEN") greenCount += 1;
    else if (c.riskLevel === "NO_PAR") noParCount += 1;
  }

  const missingCostCount = items.filter((item) => item.unit_cost == null).length;

  return {
    totalReorderValue,
    totalSuggestedUnits,
    totalWasteValue,
    redCount,
    yellowCount,
    greenCount,
    noParCount,
    missingCostCount,
  };
}
