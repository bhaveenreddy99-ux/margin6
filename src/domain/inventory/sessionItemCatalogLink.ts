import type { InventorySessionItemRow } from "@/domain/inventory/enterInventoryTypes";

/**
 * Catalog FK was removed from generated `inventory_session_items` Row; linkage may live in
 * optional denormalized fields or `metadata.catalog_item_id`.
 */
export function catalogIdFromSessionItem(
  item: Pick<InventorySessionItemRow, "catalog_item_id" | "metadata">,
): string | null {
  const direct = item.catalog_item_id?.trim();
  if (direct) return direct;
  const meta = item.metadata;
  if (meta && typeof meta === "object" && !Array.isArray(meta)) {
    const cid = (meta as Record<string, unknown>).catalog_item_id;
    if (typeof cid === "string" && cid.trim()) return cid.trim();
  }
  return null;
}
