import type { InventoryCatalogItemRow, InventorySessionItemRow } from "@/domain/inventory/enterInventoryTypes";

/** Session row brand, then catalog fallback when session brand is empty. */
export function resolveSessionItemBrandName(
  item: Pick<InventorySessionItemRow, "brand_name">,
  catalog: Pick<InventoryCatalogItemRow, "brand_name"> | null | undefined,
): string | null {
  const sessionBrand = item.brand_name?.trim();
  if (sessionBrand) return sessionBrand;
  const catalogBrand = catalog?.brand_name?.trim();
  if (catalogBrand) return catalogBrand;
  return null;
}

export function formatCountItemSkuPackLine(
  sku: string | null | undefined,
  packSize: string | null | undefined,
): string | null {
  const parts: string[] = [];
  if (sku?.trim()) parts.push(`#${sku.trim()}`);
  if (packSize?.trim()) parts.push(packSize.trim());
  return parts.length > 0 ? parts.join(" · ") : null;
}
