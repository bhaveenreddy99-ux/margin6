/**
 * PAR guide resolution for session lines and smart order runs.
 * Prefer par_guide_items.catalog_item_id; fall back to normalized item_name when id is missing.
 */

export type ParGuideLevelMaps = {
  byCatalogId: Record<string, number>;
  byNormalizedName: Record<string, number>;
};

export function normalizeParGuideItemName(itemName: string | null | undefined): string {
  return itemName?.trim().toLowerCase() ?? "";
}

type ParGuideRow = {
  item_name: string | null;
  par_level: number | string | null | undefined;
  catalog_item_id?: string | null;
};

/**
 * Build lookup maps from par_guide_items. Rows with catalog_item_id populate byCatalogId;
 * all rows with a non-empty normalized name populate byNormalizedName (name can override for legacy rows).
 */
export function buildParGuideLevelMaps(guideItems: ParGuideRow[]): ParGuideLevelMaps {
  const byCatalogId: Record<string, number> = {};
  const byNormalizedName: Record<string, number> = {};
  for (const item of guideItems) {
    const parsed = Number(item.par_level ?? 0);
    const val = Number.isFinite(parsed) ? parsed : 0;
    const cid =
      item.catalog_item_id != null && String(item.catalog_item_id).trim() !== ""
        ? String(item.catalog_item_id).trim()
        : null;
    if (cid) {
      byCatalogId[cid] = val;
    }
    const key = normalizeParGuideItemName(item.item_name);
    if (key) {
      byNormalizedName[key] = val;
    }
  }
  return { byCatalogId, byNormalizedName };
}

type LineWithCatalog = {
  catalog_item_id?: string | null;
  item_name: string | null | undefined;
};

/**
 * Resolve PAR for a session or smart-order line: guide catalog id match, then guide name match, else sessionPar.
 */
export function resolveParLevelFromGuideMaps(
  line: LineWithCatalog,
  maps: ParGuideLevelMaps | null,
  sessionPar: number,
): number {
  if (!maps) return sessionPar;
  const cid =
    line.catalog_item_id != null && String(line.catalog_item_id).trim() !== ""
      ? String(line.catalog_item_id).trim()
      : null;
  if (cid && cid in maps.byCatalogId) return maps.byCatalogId[cid];
  const key = normalizeParGuideItemName(line.item_name);
  if (key && key in maps.byNormalizedName) return maps.byNormalizedName[key];
  return sessionPar;
}

/**
 * PAR from the guide only (no session-line fallback). For review UI “guide PAR” column when no match should be null.
 */
export function resolveGuideParFromMaps(line: LineWithCatalog, maps: ParGuideLevelMaps | null): number | null {
  if (!maps) return null;
  const cid =
    line.catalog_item_id != null && String(line.catalog_item_id).trim() !== ""
      ? String(line.catalog_item_id).trim()
      : null;
  if (cid && cid in maps.byCatalogId) return maps.byCatalogId[cid];
  const key = normalizeParGuideItemName(line.item_name);
  if (key && key in maps.byNormalizedName) return maps.byNormalizedName[key];
  return null;
}
