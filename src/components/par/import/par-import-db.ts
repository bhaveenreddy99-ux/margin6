import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import type { MatchedRow } from "./types";
import type { CatalogLookupItem } from "./par-import-logic";

type InventoryListRow = Database["public"]["Tables"]["inventory_lists"]["Row"];
type ParGuideRow = Database["public"]["Tables"]["par_guides"]["Row"];
type ParGuideItemInsert = Database["public"]["Tables"]["par_guide_items"]["Insert"];
type ParGuideItemUpdate = Database["public"]["Tables"]["par_guide_items"]["Update"];

export async function fetchInventoryLists(restaurantId: string): Promise<InventoryListRow[]> {
  const { data } = await supabase
    .from("inventory_lists")
    .select("*")
    .eq("restaurant_id", restaurantId);
  return data ?? [];
}

export async function fetchCatalogItemsForLists(
  restaurantId: string,
  listIds: string[],
): Promise<CatalogLookupItem[]> {
  if (listIds.length > 0) {
    const { data } = await supabase
      .from("inventory_catalog_items")
      .select("id, item_name, vendor_sku, pack_size, inventory_list_id")
      .eq("restaurant_id", restaurantId)
      .in("inventory_list_id", listIds);
    return data ?? [];
  }
  const { data } = await supabase
    .from("inventory_catalog_items")
    .select("id, item_name, vendor_sku, pack_size, inventory_list_id")
    .eq("restaurant_id", restaurantId);
  return data ?? [];
}

export async function createParGuide(args: {
  restaurantId: string;
  inventoryListId: string | null;
  locationId: string | null;
  name: string;
  createdBy: string;
}): Promise<{ data: Pick<ParGuideRow, "id"> | null; error: { message: string } | null }> {
  const { data, error } = await supabase
    .from("par_guides")
    .insert({
      restaurant_id: args.restaurantId,
      inventory_list_id: args.inventoryListId,
      location_id: args.locationId,
      name: args.name,
      created_by: args.createdBy,
    })
    .select("id")
    .single();
  return { data, error: error ? { message: error.message } : null };
}

export async function importIntoGuide(
  guideId: string,
  listId: string,
  rowsToProcess: MatchedRow[],
  ctx: { restaurantId: string },
): Promise<{ created: number; updated: number }> {
  const { data: existingItems } = await supabase
    .from("par_guide_items")
    .select("id, item_name, catalog_item_id")
    .eq("par_guide_id", guideId);

  const existingByName = new Map<string, string>();
  const existingByCatalogId = new Map<string, string>();
  (existingItems ?? []).forEach(e => {
    existingByName.set(e.item_name.toLowerCase().trim(), e.id);
    if (e.catalog_item_id) existingByCatalogId.set(e.catalog_item_id, e.id);
  });

  const toInsert: ParGuideItemInsert[] = [];
  const toUpdate: { id: string; data: ParGuideItemUpdate }[] = [];
  let created = 0;
  let updated = 0;

  for (const row of rowsToProcess) {
    if (row.action === "create_catalog" && row.matchType === "unmatched" && listId) {
      const { data: newCatalog } = await supabase
        .from("inventory_catalog_items")
        .insert({
          restaurant_id: ctx.restaurantId,
          inventory_list_id: listId,
          item_name: row.itemName,
          category: row.category,
          unit: row.unit,
          pack_size: row.packSize,
          vendor_sku: row.vendorSku,
          product_number: row.vendorSku,
          brand_name: row.brand,
        })
        .select("id")
        .single();
      if (newCatalog) row.catalogItemId = newCatalog.id;
    }

    if (row.action === "map_to_catalog" && row.manualCatalogId) {
      row.catalogItemId = row.manualCatalogId;
    }

    const existingId =
      (row.catalogItemId && existingByCatalogId.get(row.catalogItemId)) ||
      existingByName.get(row.itemName.toLowerCase().trim());
    if (existingId) {
      toUpdate.push({
        id: existingId,
        data: {
          par_level: row.parLevel ?? 0,
          ...(row.category && { category: row.category }),
          ...(row.unit && { unit: row.unit }),
          ...(row.catalogItemId ? { catalog_item_id: row.catalogItemId } : {}),
        },
      });
      updated++;
    } else {
      toInsert.push({
        par_guide_id: guideId,
        item_name: row.itemName,
        par_level: row.parLevel ?? 0,
        category: row.category || null,
        unit: row.unit || null,
        ...(row.catalogItemId ? { catalog_item_id: row.catalogItemId } : {}),
      });
      created++;
    }

    if (row.packSize && row.catalogItemId) {
      await supabase
        .from("inventory_catalog_items")
        .update({ pack_size: row.packSize })
        .eq("id", row.catalogItemId);
    }
  }

  if (toInsert.length > 0) {
    for (let i = 0; i < toInsert.length; i += 500) {
      const { error } = await supabase
        .from("par_guide_items")
        .insert(toInsert.slice(i, i + 500));
      if (error) throw error;
    }
  }
  for (const u of toUpdate) {
    await supabase.from("par_guide_items").update(u.data).eq("id", u.id);
  }

  return { created, updated };
}

export type { InventoryListRow };
