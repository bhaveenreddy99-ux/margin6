import type { InventorySessionItemRow } from "@/domain/inventory/enterInventoryTypes";
import { catalogIdFromSessionItem } from "@/domain/inventory/sessionItemCatalogLink";
import { resolveItemCategoryEntry, type CategoryMappingResult } from "@/hooks/useCategoryMapping";

/**
 * Resolves the list_category_id for the current row's zone strip using stable mapping data
 * (catalog_item_id first, then item_name → category_id), not UI section titles.
 */
export function listCategoryIdForZoneStrip(
  item: Pick<InventorySessionItemRow, "item_name" | "catalog_item_id">,
  categoryMapping: CategoryMappingResult,
  hasZoneSections: boolean,
): string | null {
  if (!hasZoneSections) return null;
  const entry = resolveItemCategoryEntry(
    { ...item, catalog_item_id: catalogIdFromSessionItem(item as InventorySessionItemRow) },
    categoryMapping,
    true,
  );
  const id = entry?.category_id;
  return id && String(id).trim() ? id : null;
}
