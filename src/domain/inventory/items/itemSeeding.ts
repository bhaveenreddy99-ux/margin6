import {
  buildParGuideLevelMaps,
  resolveParLevelFromGuideMaps,
} from "@/domain/inventory/parGuideLevels";
import type {
  InventoryCatalogItemRow,
  InventorySessionItemInsert,
  ParGuideItemRow,
} from "@/domain/inventory/enterInventoryTypes";
import type { Json } from "@/integrations/supabase/types";

export function isInventorySessionItemsCatalogIdSchemaError(
  message: string | undefined,
): boolean {
  if (!message) return false;
  return /inventory_session_items.*catalog_item_id|catalog_item_id.*inventory_session_items|schema cache/i.test(
    message,
  );
}

export function buildCatalogSeedRows(args: {
  sessionId: string;
  catalogItems: InventoryCatalogItemRow[];
  parGuideItems: ParGuideItemRow[];
}) {
  const validCatalog = args.catalogItems.filter(
    (item) => (item.item_name || "").trim().length > 0,
  );
  const parMaps = buildParGuideLevelMaps(args.parGuideItems);

  const withCatalog = validCatalog.map((catalogItem): InventorySessionItemInsert => {
    const base =
      catalogItem.default_par_level != null &&
      Number.isFinite(Number(catalogItem.default_par_level))
        ? Number(catalogItem.default_par_level)
        : 0;

    return {
      session_id: args.sessionId,
      metadata: { catalog_item_id: catalogItem.id } as Json,
      item_name: catalogItem.item_name.trim(),
      category: catalogItem.category || "Dry",
      unit: catalogItem.unit || "",
      pack_size: catalogItem.pack_size ?? null,
      brand_name: catalogItem.brand_name ?? null,
      vendor_name: catalogItem.vendor_name ?? null,
      vendor_sku: catalogItem.vendor_sku ?? null,
      current_stock: 0,
      par_level: resolveParLevelFromGuideMaps(
        { catalog_item_id: catalogItem.id, item_name: catalogItem.item_name },
        parMaps,
        base,
      ).parLevel,
      unit_cost: catalogItem.default_unit_cost ?? null,
    };
  });

  const withoutCatalog = withCatalog.map(({ metadata: _meta, ...row }) => ({ ...row, metadata: null }));

  return { withCatalog, withoutCatalog };
}

export function buildParOnlySeedRows(
  sessionId: string,
  parItems: ParGuideItemRow[],
): InventorySessionItemInsert[] {
  return parItems
    .filter((item) => (item.item_name || "").trim().length > 0)
    .map((item) => ({
      session_id: sessionId,
      item_name: item.item_name.trim(),
      category: item.category || "Dry",
      unit: item.unit || "",
      current_stock: 0,
      par_level: Number(item.par_level ?? 0),
    }));
}
