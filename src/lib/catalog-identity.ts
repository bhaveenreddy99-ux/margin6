export function normalizeItemName(itemName: string | null | undefined): string {
  return (itemName ?? "").trim().toLowerCase();
}

/**
 * Prefer stable catalog id for map keys; fall back to normalized display name when id is missing.
 */
export function buildCatalogIdentityKey(
  catalogItemId: string | null | undefined,
  itemName: string | null | undefined,
): string | null {
  if (catalogItemId) return `catalog:${catalogItemId}`;

  const normalizedName = normalizeItemName(itemName);
  return normalizedName ? `name:${normalizedName}` : null;
}
