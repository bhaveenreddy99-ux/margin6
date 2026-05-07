/**
 * Recorded waste dollar estimates — no fuzzy name matching; only FK-backed or row snapshots.
 */

export type WasteCostRowInput = {
  quantity: number | null;
  /** Unit the staff member entered quantity in ("case", "lb", "each"). Null/undefined = legacy row, treat as "case". */
  quantity_unit?: string | null;
  total_cost?: number | null;
  unit_cost?: number | null;
  catalog_item_id?: string | null;
};

/**
 * Returns true when the stored quantity unit is in cases (or is a legacy null row).
 * Fallbacks 2-4 multiply raw qty × a per-case cost, so they are only safe for case-unit entries.
 */
function isUnitCase(quantityUnit: string | null | undefined): boolean {
  return quantityUnit == null || quantityUnit === "case";
}

/**
 * Priority: stored line total → unit_cost × qty → catalog default_unit_cost (by catalog_item_id) → latest session unit_cost (by catalog_item_id).
 * Fallbacks 2-4 (per-case × qty) are skipped for non-case units (lb, each) because multiplying
 * a per-case cost by a raw lb/each count produces a wildly wrong value.
 * If nothing trustworthy, 0 for that row.
 */
export function dollarsForWasteRow(
  row: WasteCostRowInput,
  catalogDefaultUnitById: ReadonlyMap<string, number>,
  sessionUnitByCatalogId: ReadonlyMap<string, number>,
): number {
  const qty = Number(row.quantity);
  if (!Number.isFinite(qty) || qty <= 0) return 0;

  // Fallback 1: pre-computed total_cost stored at save time — always reliable regardless of unit.
  const tc = row.total_cost;
  if (tc != null) {
    const t = Number(tc);
    if (Number.isFinite(t) && t >= 0) return t;
  }

  // Fallbacks 2-4 multiply raw qty by a per-case cost — only valid for case-unit rows.
  if (!isUnitCase(row.quantity_unit)) return 0;

  const uc = row.unit_cost;
  if (uc != null) {
    const u = Number(uc);
    if (Number.isFinite(u) && u >= 0) return u * qty;
  }

  const cid = row.catalog_item_id;
  if (cid) {
    const def = catalogDefaultUnitById.get(cid);
    if (def !== undefined && Number.isFinite(def) && def >= 0) return def * qty;

    const su = sessionUnitByCatalogId.get(cid);
    if (su !== undefined && Number.isFinite(su) && su >= 0) return su * qty;
  }

  return 0;
}

/**
 * Returns true if any reliable cost source is available for this row.
 * Use this to count waste entries that will silently contribute $0 to the total.
 * For non-case units, only total_cost is considered reliable (fallbacks 2-4 require case qty).
 */
export function hasReliableWasteCost(
  row: WasteCostRowInput,
  catalogDefaultUnitById: ReadonlyMap<string, number>,
  sessionUnitByCatalogId: ReadonlyMap<string, number>,
): boolean {
  const qty = Number(row.quantity);
  if (!Number.isFinite(qty) || qty <= 0) return true; // zero quantity needs no cost

  // Fallback 1: pre-computed total_cost — always reliable.
  const tc = row.total_cost;
  if (tc != null) {
    const t = Number(tc);
    if (Number.isFinite(t) && t >= 0) return true;
  }

  // Fallbacks 2-4 only valid for case-unit rows.
  if (!isUnitCase(row.quantity_unit)) return false;

  const uc = row.unit_cost;
  if (uc != null) {
    const u = Number(uc);
    if (Number.isFinite(u) && u >= 0) return true;
  }

  const cid = row.catalog_item_id;
  if (cid) {
    if (catalogDefaultUnitById.has(cid)) return true;
    if (sessionUnitByCatalogId.has(cid)) return true;
  }

  return false;
}
