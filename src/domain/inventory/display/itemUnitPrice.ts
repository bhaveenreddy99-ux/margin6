import type { InventoryCatalogItemRow, InventorySessionItemRow } from "@/domain/inventory/enterInventoryTypes";

/** Preferred session row price, then catalog default. */
export function resolveSessionItemUnitPrice(
  item: InventorySessionItemRow,
  catalog: InventoryCatalogItemRow | null | undefined,
): number | null {
  if (item.unit_cost != null && Number.isFinite(Number(item.unit_cost))) {
    return Number(item.unit_cost);
  }
  if (catalog?.default_unit_cost != null && Number.isFinite(Number(catalog.default_unit_cost))) {
    return Number(catalog.default_unit_cost);
  }
  return null;
}
