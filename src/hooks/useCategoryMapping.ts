import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export interface MappedCategory {
  id: string;
  name: string;
  sort_order: number;
}

export interface ItemCategoryEntry {
  catalog_item_id: string;
  category_id: string | null;
  category_name: string;
  item_sort_order: number;
}

interface UseCategoryMappingResult {
  categories: MappedCategory[];
  itemCategoryMap: Record<string, ItemCategoryEntry>; // keyed by item_name
  hasMappings: boolean;
  loading: boolean;
}

/** Align UI mode and DB `active_category_mode` values with list_category_sets.set_type */
function resolveSetType(mode: string | null | undefined): "user_manual" | "custom_ai" | null {
  if (mode === "my-categories" || mode === "user_manual" || mode === "user") return "user_manual";
  if (mode === "custom-categories" || mode === "custom_ai" || mode === "ai") return "custom_ai";
  return null;
}

/**
 * Fetches the saved category mapping for a given inventory list.
 * Returns mapped categories + a lookup from item_name → mapped category info.
 * Loads list_item_category_map by list_id whenever rows exist (including list_order).
 * Falls back gracefully (hasMappings=false) only when no map rows exist for the list.
 */
export function useCategoryMapping(listId: string | null | undefined, modeOverride?: string | null): UseCategoryMappingResult {
  const [categories, setCategories] = useState<MappedCategory[]>([]);
  const [itemCategoryMap, setItemCategoryMap] = useState<Record<string, ItemCategoryEntry>>({});
  const [hasMappings, setHasMappings] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!listId) {
      setCategories([]);
      setItemCategoryMap({});
      setHasMappings(false);
      return;
    }

    let cancelled = false;
    const load = async () => {
      setLoading(true);

      const [{ data: listData }, { data: allMapsForList }, { data: catalogItems }] = await Promise.all([
        supabase.from("inventory_lists").select("active_category_mode").eq("id", listId).single(),
        supabase
          .from("list_item_category_map")
          .select("catalog_item_id, category_id, item_sort_order, category_set_id")
          .eq("list_id", listId),
        supabase
          .from("inventory_catalog_items")
          .select("id, item_name")
          .eq("inventory_list_id", listId),
      ]);

      if (cancelled) return;

      const maps = allMapsForList || [];
      if (maps.length === 0) {
        setCategories([]);
        setItemCategoryMap({});
        setHasMappings(false);
        setLoading(false);
        return;
      }

      const mode = modeOverride !== undefined ? modeOverride : listData?.active_category_mode;
      const setType = resolveSetType(mode);

      let preferredSetId: string | null = null;
      if (setType) {
        const { data: catSets } = await supabase
          .from("list_category_sets")
          .select("id")
          .eq("list_id", listId)
          .eq("set_type", setType)
          .limit(1);
        if (cancelled) return;
        preferredSetId = catSets?.[0]?.id ?? null;
      }

      const { data: catsRows } = await supabase
        .from("list_categories")
        .select("id, name, sort_order")
        .eq("list_id", listId)
        .order("sort_order", { ascending: true })
        .order("id", { ascending: true });

      if (cancelled) return;

      const cats = (catsRows || []) as MappedCategory[];
      const catalogItemsArr = catalogItems || [];

      const catalogIdToName: Record<string, string> = {};
      catalogItemsArr.forEach((ci) => {
        catalogIdToName[ci.id] = ci.item_name;
      });

      const catIdToName: Record<string, string> = {};
      cats.forEach((c) => {
        catIdToName[c.id] = c.name;
      });

      const sortedMaps = [...maps].sort((a, b) => {
        if (!preferredSetId) return 0;
        const aPref = a.category_set_id === preferredSetId ? 1 : 0;
        const bPref = b.category_set_id === preferredSetId ? 1 : 0;
        return aPref - bPref;
      });

      const nameMap: Record<string, ItemCategoryEntry> = {};
      sortedMaps.forEach((m) => {
        const itemName = catalogIdToName[m.catalog_item_id];
        if (itemName) {
          nameMap[itemName] = {
            catalog_item_id: m.catalog_item_id,
            category_id: m.category_id,
            category_name: m.category_id ? (catIdToName[m.category_id] || "Uncategorized") : "Uncategorized",
            item_sort_order: m.item_sort_order,
          };
        }
      });

      setCategories(cats);
      setItemCategoryMap(nameMap);
      setHasMappings(true);
      setLoading(false);
    };

    load();
    return () => {
      cancelled = true;
    };
  }, [listId, modeOverride]);

  return { categories, itemCategoryMap, hasMappings, loading };
}
