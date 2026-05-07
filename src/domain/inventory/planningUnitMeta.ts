import type { InventoryCatalogItemRow, InventorySessionItemRow } from "@/domain/inventory/enterInventoryTypes";
import type { PlanningUnitMeta } from "@/domain/inventory/zoneCounting";

/** Labels for zone entry unit dropdown (planning vs count base). No quantity math. */
export function zoneEntryUnitOptions(meta: PlanningUnitMeta): { value: string; label: string }[] {
  return [
    { value: meta.planning_unit, label: `${meta.planning_unit} (order)` },
    { value: meta.count_base_unit, label: `${meta.count_base_unit} (count)` },
  ];
}

export type SessionPackUnitFallback = Pick<InventorySessionItemRow, "unit" | "pack_size">;

/**
 * First positive numeric literal in pack_size (e.g. "40 lb" → 40, "960 each" → 960).
 */
export function parseUnitsPerPlanningUnitFromPackSize(packSize: string | null | undefined): number | null {
  if (packSize == null) return null;
  const s = String(packSize).trim();
  if (!s) return null;
  const m = s.match(/(\d+(?:\.\d+)?)/);
  if (!m) return null;
  const n = Number(m[1]);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

/**
 * Label for the count-base field (e.g. lb). Prefer session/catalog `unit`, else a token from `pack_size` after the size number.
 */
export function countBaseLabelForDualStock(
  packSize: string | null | undefined,
  sessionUnit: string | null | undefined,
): string {
  const u = (sessionUnit || "").trim();
  if (u) return u;
  const ps = (packSize || "").trim();
  if (!ps) return "";
  const rest = ps.replace(/^\D*\d+(?:\.\d+)?\s*/i, "").trim();
  if (!rest) return "";
  return rest.split(/[/,]/)[0].trim() || "";
}

export function splitCurrentStockToCasesAndBase(
  currentStockCases: number | null | undefined,
  unitsPerCase: number,
): { wholeCases: number; baseQty: number } {
  const q = currentStockCases == null || !Number.isFinite(Number(currentStockCases)) ? 0 : Math.max(0, Number(currentStockCases));
  if (!Number.isFinite(unitsPerCase) || unitsPerCase <= 0) {
    return { wholeCases: 0, baseQty: 0 };
  }
  const whole = Math.floor(q + 1e-9);
  const base = (q - whole) * unitsPerCase;
  return { wholeCases: whole, baseQty: Math.round(base * 1e6) / 1e6 };
}

/** `current_stock` is in planning (case) units. */
export function totalCasesFromWholeCasesAndBaseQty(
  wholeCases: number,
  baseQty: number,
  unitsPerCase: number,
): number {
  if (!Number.isFinite(unitsPerCase) || unitsPerCase <= 0) return 0;
  const wc = Number.isFinite(wholeCases) && wholeCases > 0 ? Math.floor(wholeCases) : 0;
  const b = !Number.isFinite(baseQty) || baseQty < 0 ? 0 : baseQty;
  return Math.round((wc + b / unitsPerCase) * 1e6) / 1e6;
}

/**
 * Build {@link PlanningUnitMeta} for zone normalization.
 * Planning unit is always "case" (vendor/PAR unit); count base comes from catalog or session line.
 */
export function resolvePlanningUnitMetaFromCatalogItem(
  catalogItem: InventoryCatalogItemRow,
  sessionItemFallback?: SessionPackUnitFallback | null,
): PlanningUnitMeta | null {
  const packSource = catalogItem.pack_size ?? sessionItemFallback?.pack_size ?? null;
  const units = parseUnitsPerPlanningUnitFromPackSize(packSource);
  const rawBase = (catalogItem.unit ?? sessionItemFallback?.unit ?? "").trim();
  if (!units || !rawBase) return null;
  return {
    planning_unit: "case",
    count_base_unit: rawBase.toLowerCase(),
    units_per_planning_unit: units,
  };
}
