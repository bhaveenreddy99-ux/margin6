/**
 * Recorded waste dollar estimates — no fuzzy name matching; only FK-backed or row snapshots.
 */

export type WasteCostRowInput = {
  quantity: number | null;
  total_cost?: number | null;
  unit_cost?: number | null;
  catalog_item_id?: string | null;
};

/**
 * Priority: stored line total → unit_cost × qty → catalog default_unit_cost (by catalog_item_id) → latest session unit_cost (by catalog_item_id).
 * If nothing trustworthy, 0 for that row.
 */
export function dollarsForWasteRow(
  row: WasteCostRowInput,
  catalogDefaultUnitById: ReadonlyMap<string, number>,
  sessionUnitByCatalogId: ReadonlyMap<string, number>,
): number {
  const qty = Number(row.quantity);
  if (!Number.isFinite(qty) || qty <= 0) return 0;

  const tc = row.total_cost;
  if (tc != null) {
    const t = Number(tc);
    if (Number.isFinite(t) && t >= 0) return t;
  }

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
 * Returns true if any of the 4 cost sources is available for this row.
 * Use this to count waste entries that will silently contribute $0 to the total.
 */
export function hasReliableWasteCost(
  row: WasteCostRowInput,
  catalogDefaultUnitById: ReadonlyMap<string, number>,
  sessionUnitByCatalogId: ReadonlyMap<string, number>,
): boolean {
  const qty = Number(row.quantity);
  if (!Number.isFinite(qty) || qty <= 0) return true; // zero quantity needs no cost

  const tc = row.total_cost;
  if (tc != null) {
    const t = Number(tc);
    if (Number.isFinite(t) && t >= 0) return true;
  }

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
