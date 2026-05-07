/**
 * Canonical case-based planning engine.
 *
 * Business rules enforced here:
 *  - PAR is always in CASES.
 *  - current_stock must represent CASES.
 *  - suggested_order is always whole CASES (Math.ceil).
 *  - unit_cost means cost per CASE.
 *  - All dollar outputs are rounded to 2 decimal places.
 *  - null stock is treated as 0 (uncounted).
 *  - null cost produces dollars=0 and isMissingCost=true (never silently inflates/deflates totals).
 *
 * UI pages must not multiply quantities by costs directly — use these functions instead.
 */

import { getRisk, type RiskInfo, type RiskThresholds } from "@/lib/inventory-utils";

// ── Types ──────────────────────────────────────────────────────────────────────

/** A numeric quantity that is always in CASES. */
export type CaseQty = number;

/** All inputs in canonical units: stock and PAR in cases, cost in $/case. */
export interface CasePlanningLine {
  currentStockCases: number | null | undefined;
  parLevelCases: number | null | undefined;
  unitCostPerCase: number | null | undefined;
  riskThresholds?: RiskThresholds;
}

/** Dollar result with explicit null-cost flag so callers can surface missing-cost warnings. */
export interface LineValueResult {
  /** Dollar amount, rounded to 2 decimal places. Always 0 when isMissingCost. */
  dollars: number;
  /** True when unitCostPerCase was null/undefined. Callers must NOT silently hide this. */
  isMissingCost: boolean;
}

/** Session-level aggregate produced by computeSessionPlanningAggregate. */
export interface SessionPlanningAggregate {
  totalInventoryValueDollars: number;
  totalReorderValueDollars: number;
  totalOverstockValueDollars: number;
  totalSuggestedOrderCases: CaseQty;
  itemsWithCost: number;
  /** Items with no unit cost — their dollar contributions are excluded from totals. */
  itemsMissingCost: number;
  redCount: number;
  yellowCount: number;
  greenCount: number;
  noParCount: number;
}

// ── Internal helpers ───────────────────────────────────────────────────────────

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function resolvedStock(line: CasePlanningLine): number {
  return line.currentStockCases ?? 0;
}

function resolvedPar(line: CasePlanningLine): number {
  return line.parLevelCases ?? 0;
}

// ── Exported functions ─────────────────────────────────────────────────────────

/**
 * Suggested order quantity in whole cases.
 * Always Math.ceil — fractional cases are not ordered.
 *
 * Examples:
 *   stock=4.5, par=5  → 1  (ceil(0.5))
 *   stock=5,   par=5  → 0  (at PAR)
 *   stock=6,   par=5  → 0  (overstock)
 *   stock=null,par=5  → 5  (treat null as 0)
 */
export function computeSuggestedOrderCases(line: CasePlanningLine): CaseQty {
  const par = resolvedPar(line);
  if (par <= 0) return 0;
  const need = par - resolvedStock(line);
  if (need <= 0) return 0;
  return Math.ceil(need);
}

/**
 * Stock risk using the standard getRisk logic (dimensionless stock/par ratio).
 * Accepts the same RiskThresholds as the rest of the app.
 */
export function computeStockRisk(line: CasePlanningLine): RiskInfo {
  return getRisk(resolvedStock(line), resolvedPar(line), line.riskThresholds);
}

/**
 * Dollar value of current stock (stock × cost/case).
 *
 * Examples:
 *   stock=2.5, cost=10   → { dollars: 25,   isMissingCost: false }
 *   stock=3,   cost=null → { dollars: 0,    isMissingCost: true  }
 */
export function computeLineInventoryValue(line: CasePlanningLine): LineValueResult {
  if (line.unitCostPerCase == null) {
    return { dollars: 0, isMissingCost: true };
  }
  return { dollars: round2(resolvedStock(line) * line.unitCostPerCase), isMissingCost: false };
}

/**
 * Estimated cost to reorder to PAR (suggested_order × cost/case).
 *
 * Examples:
 *   stock=2, par=5, cost=12.50 → { dollars: 37.50, isMissingCost: false }
 */
export function computeLineReorderValue(line: CasePlanningLine): LineValueResult {
  const order = computeSuggestedOrderCases(line);
  if (order === 0) {
    return { dollars: 0, isMissingCost: line.unitCostPerCase == null };
  }
  if (line.unitCostPerCase == null) {
    return { dollars: 0, isMissingCost: true };
  }
  return { dollars: round2(order * line.unitCostPerCase), isMissingCost: false };
}

/**
 * Dollar value of stock above PAR — "overstock" or "waste" risk.
 *
 * Examples:
 *   stock=7, par=5, cost=10 → { dollars: 20, isMissingCost: false }
 *   stock=3, par=5, cost=10 → { dollars: 0,  isMissingCost: false }
 */
export function computeLineOverstockValue(line: CasePlanningLine): LineValueResult {
  const overage = Math.max(0, resolvedStock(line) - resolvedPar(line));
  if (overage === 0) {
    return { dollars: 0, isMissingCost: line.unitCostPerCase == null };
  }
  if (line.unitCostPerCase == null) {
    return { dollars: 0, isMissingCost: true };
  }
  return { dollars: round2(overage * line.unitCostPerCase), isMissingCost: false };
}

/**
 * Dollar cost of ordering a known quantity at a known cost per case.
 * Use this when the order qty has already been decided (e.g. smart_order_run_items.suggested_order)
 * rather than recomputing it from stock/PAR.
 *
 * Examples:
 *   qty=3, cost=12.50 → { dollars: 37.50, isMissingCost: false }
 *   qty=3, cost=null  → { dollars: 0,     isMissingCost: true  }
 */
export function computeOrderDollars(
  orderQty: number,
  unitCostPerCase: number | null | undefined,
): LineValueResult {
  if (unitCostPerCase == null) return { dollars: 0, isMissingCost: true };
  if (!(orderQty > 0)) return { dollars: 0, isMissingCost: false };
  return { dollars: round2(orderQty * unitCostPerCase), isMissingCost: false };
}

/**
 * Aggregate planning metrics across all session lines.
 *
 * Dollar totals are rounded at the aggregate level (after summing individual line dollars,
 * which are themselves already rounded — this prevents compounding rounding errors).
 */
export function computeSessionPlanningAggregate(
  lines: CasePlanningLine[],
  riskThresholds?: RiskThresholds,
): SessionPlanningAggregate {
  let totalInventoryValueDollars = 0;
  let totalReorderValueDollars = 0;
  let totalOverstockValueDollars = 0;
  let totalSuggestedOrderCases: CaseQty = 0;
  let itemsWithCost = 0;
  let itemsMissingCost = 0;
  let redCount = 0;
  let yellowCount = 0;
  let greenCount = 0;
  let noParCount = 0;

  for (const line of lines) {
    // Merge session-level thresholds unless the line already has its own
    const resolved: CasePlanningLine =
      riskThresholds && !line.riskThresholds
        ? { ...line, riskThresholds }
        : line;

    const invVal = computeLineInventoryValue(resolved);
    const reorderVal = computeLineReorderValue(resolved);
    const overstockVal = computeLineOverstockValue(resolved);
    const suggestedOrder = computeSuggestedOrderCases(resolved);
    const risk = computeStockRisk(resolved);

    totalInventoryValueDollars += invVal.dollars;
    totalReorderValueDollars += reorderVal.dollars;
    totalOverstockValueDollars += overstockVal.dollars;
    totalSuggestedOrderCases += suggestedOrder;

    if (line.unitCostPerCase == null) {
      itemsMissingCost += 1;
    } else {
      itemsWithCost += 1;
    }

    if (risk.level === "RED") redCount += 1;
    else if (risk.level === "YELLOW") yellowCount += 1;
    else if (risk.level === "GREEN") greenCount += 1;
    else if (risk.level === "NO_PAR") noParCount += 1;
  }

  return {
    totalInventoryValueDollars: round2(totalInventoryValueDollars),
    totalReorderValueDollars: round2(totalReorderValueDollars),
    totalOverstockValueDollars: round2(totalOverstockValueDollars),
    totalSuggestedOrderCases,
    itemsWithCost,
    itemsMissingCost,
    redCount,
    yellowCount,
    greenCount,
    noParCount,
  };
}
