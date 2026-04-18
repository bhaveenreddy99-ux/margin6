import { normalizeItemName } from "@/lib/catalog-identity";

export type ParGuideSyncRow = {
  item_name: string;
  par_level: number | null;
  catalog_item_id?: string | null;
};

export type CatalogRowLite = { id: string; item_name: string };

/**
 * Resolves which inventory_catalog_items rows should receive default_par_level updates
 * from PAR guide rows. Prefer catalog_item_id when present and valid for the list;
 * otherwise fall back to normalized item_name (all catalog rows with that name).
 */
export function resolveCatalogParUpdates(
  guideItems: ParGuideSyncRow[],
  catalogItems: CatalogRowLite[],
): { catalogId: string; parLevel: number }[] {
  const catalogById = new Map(catalogItems.map((c) => [c.id, c]));
  const catalogIdsByName = new Map<string, string[]>();
  for (const c of catalogItems) {
    const n = normalizeItemName(c.item_name);
    if (!n) continue;
    const ids = catalogIdsByName.get(n) || [];
    ids.push(c.id);
    catalogIdsByName.set(n, ids);
  }

  const updates: { catalogId: string; parLevel: number }[] = [];
  const seenCatalogIds = new Set<string>();

  for (const guideItem of guideItems) {
    const parLevel = guideItem.par_level ?? 0;
    const cid = guideItem.catalog_item_id ?? null;
    if (cid && catalogById.has(cid)) {
      if (!seenCatalogIds.has(cid)) {
        seenCatalogIds.add(cid);
        updates.push({ catalogId: cid, parLevel });
      }
      continue;
    }
    const n = normalizeItemName(guideItem.item_name);
    if (!n) continue;
    for (const catalogId of catalogIdsByName.get(n) || []) {
      if (!seenCatalogIds.has(catalogId)) {
        seenCatalogIds.add(catalogId);
        updates.push({ catalogId, parLevel });
      }
    }
  }

  return updates;
}
