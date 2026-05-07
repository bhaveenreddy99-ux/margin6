import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import type {
  InventorySessionItemRow,
  ParGuideItemRow,
} from "@/domain/inventory/enterInventoryTypes";
import {
  buildParGuideLevelMaps,
  resolveParLevelFromGuideMaps,
} from "@/domain/inventory/parGuideLevels";
import { loadSessionItemsWithZones } from "@/domain/inventory/loadSessionItemsWithZones";

type AppSupabase = SupabaseClient<Database>;

export type SessionItemWithApprovedPar = InventorySessionItemRow & {
  approved_par: number | null;
};

export function buildSessionItemsWithApprovedPar(
  items: InventorySessionItemRow[],
  parGuideItems: Array<Pick<ParGuideItemRow, "item_name" | "par_level" | "catalog_item_id">>,
): SessionItemWithApprovedPar[] {
  const maps = buildParGuideLevelMaps(parGuideItems);
  return items.map((item) => ({
    ...item,
    approved_par: resolveParLevelFromGuideMaps(
      { catalog_item_id: item.catalog_item_id, item_name: item.item_name },
      maps,
      Number(item.par_level) || 0,
    ).parLevel,
  }));
}

export async function loadSessionItemsWithApprovedPar(args: {
  supabase: AppSupabase;
  restaurantId: string;
  inventoryListId: string;
  sessionId: string;
}) {
  const { data: items, error } = await loadSessionItemsWithZones(
    args.supabase,
    args.sessionId,
  );

  if (error) {
    return {
      items: null,
      errorMessage: error.message,
    };
  }

  const latestGuide = (await args.supabase
    .from("par_guides")
    .select("id")
    .eq("restaurant_id", args.restaurantId)
    .eq("inventory_list_id", args.inventoryListId)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle()) as unknown as {
    data: { id: string } | null;
  };

  const parGuideItems = latestGuide.data
    ? ((await args.supabase
        .from("par_guide_items")
        .select("item_name, par_level, catalog_item_id")
        .eq("par_guide_id", latestGuide.data.id)) as unknown as {
        data: Array<Pick<ParGuideItemRow, "item_name" | "par_level" | "catalog_item_id">> | null;
      }).data ?? []
    : [];

  return {
    items: buildSessionItemsWithApprovedPar(items ?? [], parGuideItems),
    errorMessage: null,
  };
}
