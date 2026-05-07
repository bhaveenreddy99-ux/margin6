/**
 * Pure planning-unit math for multi-zone counts.
 * Planning unit = vendor / PAR / smart-order unit (e.g. case).
 * Count base unit = physical count unit (e.g. lb) with units_per_planning_unit per case.
 *
 * Item metadata (Phase 2 wiring — no DB columns added in Phase 1):
 * - planning_unit: convention or catalog — must match how current_stock / par_level are interpreted (e.g. "case").
 * - count_base_unit: typically inventory_catalog_items.unit (e.g. lb, each).
 * - units_per_planning_unit: derive from pack_size / catalog metadata (e.g. 40 for "40 lb" per case).
 */

export type PlanningUnitMeta = {
  planning_unit: string;
  count_base_unit: string;
  units_per_planning_unit: number;
};

function normUnitLabel(unit: string): string {
  return unit.trim().toLowerCase();
}

/** Synonyms for vendor case / CS planning counts (must match normalize path). */
const PLANNING_CASE_ALIASES = new Set(["case", "cases", "cs", "c/s", "ca"]);

function isCaseLikeUnit(unit: string): boolean {
  return PLANNING_CASE_ALIASES.has(normUnitLabel(unit));
}

function matchesPlanningUnit(enteredNorm: string, meta: PlanningUnitMeta): boolean {
  const planningNorm = normUnitLabel(meta.planning_unit);
  if (enteredNorm === planningNorm) return true;
  if (isCaseLikeUnit(enteredNorm) && isCaseLikeUnit(meta.planning_unit)) return true;
  return false;
}

/**
 * Whether the operator-selected unit is supported for zone entry.
 */
export function isAllowedZoneUnit(enteredUnit: string, meta: PlanningUnitMeta): boolean {
  const u = normUnitLabel(enteredUnit);
  if (!u) return false;
  if (!Number.isFinite(meta.units_per_planning_unit) || meta.units_per_planning_unit <= 0) {
    return false;
  }
  return matchesPlanningUnit(u, meta) || u === normUnitLabel(meta.count_base_unit);
}

/**
 * Convert a single zone line from entered qty/unit into planning-unit qty.
 */
export function normalizeZoneQtyToPlanningUnit(
  enteredQty: number,
  enteredUnit: string,
  meta: PlanningUnitMeta,
): number {
  if (!Number.isFinite(enteredQty) || enteredQty < 0) {
    throw new RangeError("enteredQty must be a finite number >= 0");
  }
  if (!isAllowedZoneUnit(enteredUnit, meta)) {
    throw new Error(
      `Unit ${JSON.stringify(enteredUnit)} is not allowed for this item (planning ${JSON.stringify(meta.planning_unit)}, base ${JSON.stringify(meta.count_base_unit)})`,
    );
  }
  const u = normUnitLabel(enteredUnit);
  if (matchesPlanningUnit(u, meta)) {
    return enteredQty;
  }
  return enteredQty / meta.units_per_planning_unit;
}

/**
 * Sum persisted normalized zone quantities (already in planning units).
 */
export function sumZoneRowsToCurrentStock(
  zoneRows: ReadonlyArray<{ normalized_qty: number }>,
): number {
  let sum = 0;
  for (const row of zoneRows) {
    const n = Number(row.normalized_qty);
    if (!Number.isFinite(n) || n < 0) {
      throw new RangeError("normalized_qty must be finite and >= 0");
    }
    sum += n;
  }
  return sum;
}

export type ZoneRowEntered = {
  entered_qty: number;
  entered_unit: string;
};

/**
 * Single item-level stock in planning units.
 * - If zoneRows.length > 0: sum of per-row normalization (authoritative for multi-zone).
 * - If zoneRows.length === 0: legacyCurrentStock (typically parent current_stock).
 */
export function buildReconciledSessionItemStock(args: {
  zoneRows: ReadonlyArray<ZoneRowEntered>;
  itemMeta: PlanningUnitMeta;
  legacyCurrentStock: number | null | undefined;
}): number {
  if (args.zoneRows.length === 0) {
    const legacy = args.legacyCurrentStock;
    if (legacy == null) return 0;
    const n = Number(legacy);
    if (!Number.isFinite(n) || n < 0) {
      throw new RangeError("legacyCurrentStock must be finite and >= 0 when no zone rows");
    }
    return n;
  }
  let sum = 0;
  for (const row of args.zoneRows) {
    sum += normalizeZoneQtyToPlanningUnit(row.entered_qty, row.entered_unit, args.itemMeta);
  }
  return sum;
}

/**
 * Per-row normalized qty in planning units (for persisting inventory_session_item_zones.normalized_qty).
 */
export function normalizedQtyForZoneRow(
  enteredQty: number,
  enteredUnit: string,
  meta: PlanningUnitMeta,
): number {
  return normalizeZoneQtyToPlanningUnit(enteredQty, enteredUnit, meta);
}
