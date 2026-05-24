import type { InventorySessionItemRow } from "@/domain/inventory/enterInventoryTypes";

/**
 * Maps DB session item stock to UI count state.
 * DB stores NOT NULL 0 for "never counted / cleared"; UI uses null for that case.
 * Explicit zero entry is marked via counted_as / counted_value.
 */
export function uiCurrentStockFromSessionItem(
  row: Pick<
    InventorySessionItemRow,
    "current_stock" | "counted_as" | "counted_value" | "inventory_session_item_zones"
  >,
): number | null {
  const stock = row.current_stock;
  if (stock === null || stock === undefined) return null;
  const n = Number(stock);
  if (!Number.isFinite(n)) return null;
  if (n > 0) return n;
  if (n === 0) {
    const hasExplicitZero =
      row.counted_as != null ||
      row.counted_value != null ||
      (row.inventory_session_item_zones?.length ?? 0) > 0;
    return hasExplicitZero ? 0 : null;
  }
  return null;
}

export function normalizeSessionItemForUi(
  row: InventorySessionItemRow,
): InventorySessionItemRow {
  return { ...row, current_stock: uiCurrentStockFromSessionItem(row) };
}
