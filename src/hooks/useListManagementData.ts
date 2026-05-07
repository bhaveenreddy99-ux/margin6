import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  buildIssueItems,
  buildListItemCounts,
  buildRecentPurchasedItems,
} from "@/domain/catalog/listManagementHelpers";
import type {
  CatalogItem,
  CategorySet,
  ItemCategoryMap,
  LinkedParGuide,
  InventoryListRow,
  ListCategory,
  ParGuideRow,
  PurchaseHistoryItemRow,
  RecentPurchasedItem,
} from "@/domain/catalog/listManagementTypes";

type UseListManagementDataArgs = {
  restaurantId: string | null | undefined;
};

type BasicParGuideRow = Pick<ParGuideRow, "id" | "name">;
type PurchaseHistoryLookupRow = { id: string; created_at: string; vendor_name: string | null };

export function useListManagementData({ restaurantId }: UseListManagementDataArgs) {
  const [lists, setLists] = useState<InventoryListRow[]>([]);
  const [itemCounts, setItemCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);

  const [catalogItems, setCatalogItems] = useState<CatalogItem[]>([]);
  const [listCategories, setListCategories] = useState<ListCategory[]>([]);
  const [categorySets, setCategorySets] = useState<CategorySet[]>([]);
  const [itemCategoryMaps, setItemCategoryMaps] = useState<ItemCategoryMap[]>([]);
  const [issues, setIssues] = useState(buildIssueItems([]));
  const [linkedParGuide, setLinkedParGuide] = useState<LinkedParGuide | null>(null);
  const [recentPurchasedItems, setRecentPurchasedItems] = useState<RecentPurchasedItem[]>([]);

  const refreshLists = useCallback(async () => {
    if (!restaurantId) return;

    setLoading(true);
    const { data: listRows } = (await supabase
      .from("inventory_lists")
      .select("*")
      .eq("restaurant_id", restaurantId)
      .order("created_at", { ascending: false })) as unknown as {
      data: InventoryListRow[] | null;
    };

    if (listRows) {
      setLists(listRows);
      const { data: catalogRows } = (await supabase
        .from("inventory_catalog_items")
        .select("id, inventory_list_id")
        .eq("restaurant_id", restaurantId)) as unknown as {
        data: Array<Pick<CatalogItem, "id" | "inventory_list_id">> | null;
      };
      setItemCounts(buildListItemCounts(catalogRows ?? []));
    }

    setLoading(false);
  }, [restaurantId]);

  const loadListDetail = useCallback(
    async (list: InventoryListRow) => {
      if (!restaurantId) return;

      const [catalogRes, categoriesRes, categorySetsRes, itemCategoryMapsRes, parGuideRes] =
        await Promise.all([
          (supabase
            .from("inventory_catalog_items")
            .select("*")
            .eq("inventory_list_id", list.id)
            .order("sort_order", { ascending: true })) as unknown as Promise<{
            data: CatalogItem[] | null;
          }>,
          (supabase
            .from("list_categories")
            .select("*")
            .eq("list_id", list.id)
            .order("sort_order", { ascending: true })) as unknown as Promise<{
            data: ListCategory[] | null;
          }>,
          (supabase
            .from("list_category_sets")
            .select("*")
            .eq("list_id", list.id)) as unknown as Promise<{
            data: CategorySet[] | null;
          }>,
          (supabase
            .from("list_item_category_map")
            .select("*")
            .eq("list_id", list.id)
            .order("item_sort_order", { ascending: true })) as unknown as Promise<{
            data: ItemCategoryMap[] | null;
          }>,
          (supabase
            .from("par_guides")
            .select("id, name")
            .eq("restaurant_id", restaurantId)
            .eq("inventory_list_id", list.id)
            .order("updated_at", { ascending: false })
            .limit(1)
            .maybeSingle()) as unknown as Promise<{
            data: BasicParGuideRow | null;
          }>,
        ]);

      const nextCatalogItems = catalogRes.data ?? [];
      setCatalogItems(nextCatalogItems);
      setIssues(buildIssueItems(nextCatalogItems));
      setListCategories(categoriesRes.data ?? []);
      setCategorySets(categorySetsRes.data ?? []);
      setItemCategoryMaps(itemCategoryMapsRes.data ?? []);

      if (parGuideRes.data) {
        const { data: guideItems } = (await supabase
          .from("par_guide_items")
          .select("id")
          .eq("par_guide_id", parGuideRes.data.id)) as unknown as {
          data: Array<{ id: string }> | null;
        };
        setLinkedParGuide({
          id: parGuideRes.data.id,
          name: parGuideRes.data.name,
          itemCount: guideItems?.length || 0,
        });
      } else {
        setLinkedParGuide(null);
      }

      const { data: recentPurchaseHistoryRows } = (await supabase
        .from("purchase_history")
        .select("id, created_at, vendor_name")
        .eq("restaurant_id", restaurantId)
        .order("created_at", { ascending: false })
        .limit(20)) as unknown as {
        data: PurchaseHistoryLookupRow[] | null;
      };

      if (recentPurchaseHistoryRows?.length) {
        const recentItems: RecentPurchasedItem[] = [];
        for (const purchase of recentPurchaseHistoryRows) {
          const { data: items } = (await supabase
            .from("purchase_history_items")
            .select("*")
            .eq("purchase_history_id", purchase.id)) as unknown as {
            data: PurchaseHistoryItemRow[] | null;
          };
          (items ?? []).forEach((item) => {
            recentItems.push({
              ...item,
              purchase_date: purchase.created_at,
              vendor_name: purchase.vendor_name,
            });
          });
        }
        setRecentPurchasedItems(buildRecentPurchasedItems(recentItems));
      } else {
        setRecentPurchasedItems([]);
      }
    },
    [restaurantId],
  );

  useEffect(() => {
    void refreshLists();
  }, [refreshLists]);

  return {
    lists,
    itemCounts,
    loading,
    catalogItems,
    listCategories,
    categorySets,
    itemCategoryMaps,
    issues,
    linkedParGuide,
    recentPurchasedItems,
    setCatalogItems,
    setListCategories,
    setCategorySets,
    setItemCategoryMaps,
    refreshLists,
    loadListDetail,
  };
}
