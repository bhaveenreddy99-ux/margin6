/**
 * PAR guide resolution for session lines and smart order runs.
 * Prefer par_guide_items.catalog_item_id; fall back to normalized item_name when id is missing.
 *
 * Canonical resolver: resolveParLevelFromGuideMaps (returns source provenance).
 * Adapter for ApprovedParLookupArgs callers: resolveParFromLookupArgs.
 */

import type { ApprovedParLookupArgs } from "@/domain/inventory/enterInventoryTypes";

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
    if (!Number.isFinite(parsed) || parsed <= 0) continue;
    const val = parsed;
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

export type ParResolutionResult = {
  parLevel: number;
  source: "catalog_id" | "item_name" | "session_default" | "catalog_default" | "no_par";
};

/** Optional catalog-level PAR defaults — used as last resort when guide and session have no PAR. */
export type CatalogDefaultParMaps = {
  byId: Record<string, number>;
  byName: Record<string, number>;
};

/**
 * Resolve PAR for a session or smart-order line.
 *
 * Resolution order (highest priority first):
 *   1. Guide match by catalog_item_id
 *   2. Guide match by normalized item_name
 *   3. Session item par_level (sessionPar argument)
 *   4. Catalog default PAR (catalogDefaults, optional — used when no guide is active)
 *   5. 0 / "no_par"
 *
 * `source` records provenance so operators can trace why a PAR was used.
 *
 * NOTE: catalogDefaults should be omitted when a counting guide is active; guide-based counting
 * intentionally does not fall back to catalog defaults (session par is authoritative there).
 */
export function resolveParLevelFromGuideMaps(
  line: LineWithCatalog,
  maps: ParGuideLevelMaps | null,
  sessionPar: number,
  catalogDefaults?: CatalogDefaultParMaps,
): ParResolutionResult {
  if (!maps) {
    if (sessionPar > 0) return { parLevel: sessionPar, source: "session_default" };
    return resolveCatalogDefault(line, catalogDefaults);
  }
  const cid =
    line.catalog_item_id != null && String(line.catalog_item_id).trim() !== ""
      ? String(line.catalog_item_id).trim()
      : null;
  if (cid) {
    const fromId = maps.byCatalogId[cid];
    if (fromId != null && fromId > 0) {
      return { parLevel: fromId, source: "catalog_id" };
    }
  }
  const key = normalizeParGuideItemName(line.item_name);
  if (key) {
    const fromName = maps.byNormalizedName[key];
    if (fromName != null && fromName > 0) {
      return { parLevel: fromName, source: "item_name" };
    }
  }
  if (sessionPar > 0) {
    return { parLevel: sessionPar, source: "session_default" };
  }
  return resolveCatalogDefault(line, catalogDefaults);
}

function resolveCatalogDefault(
  line: LineWithCatalog,
  catalogDefaults?: CatalogDefaultParMaps,
): ParResolutionResult {
  if (!catalogDefaults) return { parLevel: 0, source: "no_par" };
  const cid =
    line.catalog_item_id != null && String(line.catalog_item_id).trim() !== ""
      ? String(line.catalog_item_id).trim()
      : null;
  if (cid && catalogDefaults.byId[cid] != null) {
    return { parLevel: catalogDefaults.byId[cid], source: "catalog_default" };
  }
  const key = normalizeParGuideItemName(line.item_name);
  if (key && catalogDefaults.byName[key] != null) {
    return { parLevel: catalogDefaults.byName[key], source: "catalog_default" };
  }
  return { parLevel: 0, source: "no_par" };
}

/**
 * Adapter: resolve PAR using the full ApprovedParLookupArgs structure used by the
 * inventory review/approve flow. Replaces getApprovedPar while returning provenance.
 *
 * When a counting guide is active (countingParGuideId is set), catalog defaults are
 * intentionally NOT used — the counting guide + session par are authoritative.
 */
export function resolveParFromLookupArgs(
  item: {
    catalog_item_id?: string | null;
    item_name: string | null | undefined;
    par_level: number | string | null | undefined;
  },
  args: ApprovedParLookupArgs,
): ParResolutionResult {
  const sessionPar = (() => {
    const n = Number(item.par_level);
    return Number.isFinite(n) && n > 0 ? n : 0;
  })();

  if (args.countingParGuideId) {
    // Counting guide is active — use its maps, no catalog default fallback
    const guideMaps: ParGuideLevelMaps = {
      byCatalogId: args.countingParByCatalogId,
      byNormalizedName: args.countingParByNormalizedName,
    };
    return resolveParLevelFromGuideMaps(item, guideMaps, sessionPar);
  }

  // No counting guide — use approvedParMap (name-keyed) + catalog defaults
  const guideMaps: ParGuideLevelMaps = {
    byCatalogId: {},
    byNormalizedName: args.approvedParMap,
  };
  return resolveParLevelFromGuideMaps(item, guideMaps, sessionPar, {
    byId: args.catalogDefaultParById,
    byName: args.catalogDefaultParByName,
  });
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
