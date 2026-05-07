import type { WasteCostRowInput } from "@/domain/waste/recordedWasteValue";
import { dollarsForWasteRow, hasReliableWasteCost } from "@/domain/waste/recordedWasteValue";

/** Waste row plus restaurant/location keys for multi-site rollups (All Locations). */
export type WasteRollupRow = WasteCostRowInput & {
  restaurant_id: string;
  location_id: string | null;
};

const EMPTY_COST_MAP: ReadonlyMap<string, number> = new Map();

/**
 * Period rollup for a single restaurant + optional location scope (Dashboard `loadWasteMetrics`).
 * Uses {@link dollarsForWasteRow} / {@link hasReliableWasteCost} only — no duplicate formulas.
 */
export function aggregateWasteRows(
  rows: WasteCostRowInput[],
  catalogDefaultUnitById: ReadonlyMap<string, number>,
  sessionUnitByCatalogId: ReadonlyMap<string, number>,
): { totalDollars: number; missingCostCount: number } {
  let totalDollars = 0;
  let missingCostCount = 0;
  for (const row of rows) {
    totalDollars += dollarsForWasteRow(row, catalogDefaultUnitById, sessionUnitByCatalogId);
    if (!hasReliableWasteCost(row, catalogDefaultUnitById, sessionUnitByCatalogId)) {
      missingCostCount += 1;
    }
  }
  return { totalDollars, missingCostCount };
}

/**
 * Sums waste dollars per `location_id` using the same cost maps as Dashboard
 * (`catalog` scoped by restaurant, session unit cost by latest approved session per location).
 */
export function sumWasteDollarsByLocation(
  rows: WasteRollupRow[],
  catalogDefaultByRestaurant: ReadonlyMap<string, ReadonlyMap<string, number>>,
  sessionUnitByLocation: ReadonlyMap<string, ReadonlyMap<string, number>>,
): Map<string, number> {
  const byLoc = new Map<string, number>();
  for (const row of rows) {
    const lid = row.location_id;
    if (!lid) continue;
    const cat = catalogDefaultByRestaurant.get(row.restaurant_id) ?? EMPTY_COST_MAP;
    const sess = sessionUnitByLocation.get(lid) ?? EMPTY_COST_MAP;
    const d = dollarsForWasteRow(row, cat, sess);
    byLoc.set(lid, (byLoc.get(lid) ?? 0) + d);
  }
  return byLoc;
}
