import type { ChangeEvent, Dispatch, SetStateAction } from "react";
import type { DropResult } from "@hello-pangea/dnd";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import {
  buildImportAutoMapping,
  buildImportPreview,
  chunkArray,
  coerceImportTemplateMapping,
  DROPPABLE_SHELF_ORDER,
  getAICategory,
  getOrderedNamedCategoryKeys,
  getCategorySetTypeForView,
  parseItemDroppableId,
} from "@/domain/catalog/listManagementHelpers";
import type {
  AdvancedListView,
  CatalogItem,
  CatalogItemQuickUpdate,
  CategorySet,
  CategorySetType,
  EditSheetValues,
  ExportFormat,
  ImportMapping,
  ImportPreviewRow,
  ImportStep,
  ImportSummary,
  ImportTemplateRow,
  InventoryListRow,
  ItemCategoryMap,
  ItemCategoryMapInsert,
  ItemEditDraft,
  ListCategory,
  ListCategoryInsert,
  NewItemDraft,
  SaveStatus,
} from "@/domain/catalog/listManagementTypes";
import { exportToCSV, exportToExcel, exportToPDF, parseFile } from "@/lib/export-utils";

type UseListManagementActionsArgs = {
  restaurantId: string | null | undefined;
  userId: string | null | undefined;
  selectedList: InventoryListRow | null;
  setSelectedList: Dispatch<SetStateAction<InventoryListRow | null>>;
  catalogItems: CatalogItem[];
  categorySets: CategorySet[];
  listCategories: ListCategory[];
  itemCategoryMaps: ItemCategoryMap[];
  currentCategories: ListCategory[];
  currentMappings: ItemCategoryMap[];
  groupedItems: Record<string, CatalogItem[]>;
  filteredItems: CatalogItem[];
  advancedListView: AdvancedListView;
  selectedItems: Set<string>;
  bulkMoveTarget: string;
  newListName: string;
  renameListId: string | null;
  renameValue: string;
  deleteListId: string | null;
  newItem: NewItemDraft;
  editValues: ItemEditDraft;
  importData: Record<string, string | number | boolean | null | undefined>[];
  importTargetList: string;
  importNewListName: string;
  importPreview: ImportPreviewRow[];
  importMapping: ImportMapping;
  newListCategoryName: string;
  subCategoryParentId: string | null;
  subCategoryName: string;
  editSheetItem: CatalogItem | null;
  editSheetValues: EditSheetValues;
  setCategorySets: Dispatch<SetStateAction<CategorySet[]>>;
  setListCategories: Dispatch<SetStateAction<ListCategory[]>>;
  setItemCategoryMaps: Dispatch<SetStateAction<ItemCategoryMap[]>>;
  setCatalogItems: Dispatch<SetStateAction<CatalogItem[]>>;
  setSelectedItems: Dispatch<SetStateAction<Set<string>>>;
  setBulkMoveOpen: Dispatch<SetStateAction<boolean>>;
  setBulkMoveTarget: Dispatch<SetStateAction<string>>;
  setNewListName: Dispatch<SetStateAction<string>>;
  setCreateOpen: Dispatch<SetStateAction<boolean>>;
  setRenameOpen: Dispatch<SetStateAction<boolean>>;
  setDeleteListId: Dispatch<SetStateAction<string | null>>;
  setAddItemOpen: Dispatch<SetStateAction<boolean>>;
  setNewItem: Dispatch<SetStateAction<NewItemDraft>>;
  setEditingItem: Dispatch<SetStateAction<string | null>>;
  setImportData: Dispatch<SetStateAction<Record<string, string | number | boolean | null | undefined>[]>>;
  setImportHeaders: Dispatch<SetStateAction<string[]>>;
  setImportMapping: Dispatch<SetStateAction<ImportMapping>>;
  setImportPreview: Dispatch<SetStateAction<ImportPreviewRow[]>>;
  setImportStep: Dispatch<SetStateAction<ImportStep>>;
  setImportSummary: Dispatch<SetStateAction<ImportSummary | null>>;
  setImportOpen: Dispatch<SetStateAction<boolean>>;
  setNewListCategoryName: Dispatch<SetStateAction<string>>;
  setSubCategoryDialogOpen: Dispatch<SetStateAction<boolean>>;
  setSubCategoryParentId: Dispatch<SetStateAction<string | null>>;
  setSubCategoryName: Dispatch<SetStateAction<string>>;
  setSaveStatus: Dispatch<SetStateAction<SaveStatus>>;
  setEditSheetItem: Dispatch<SetStateAction<CatalogItem | null>>;
  setEditSheetSaving: Dispatch<SetStateAction<boolean>>;
  setDeleteItemId: Dispatch<SetStateAction<string | null>>;
  refreshLists: () => Promise<void>;
  loadListDetail: (list: InventoryListRow) => Promise<void>;
  resetImport: () => void;
};

export function useListManagementActions({
  restaurantId,
  userId,
  selectedList,
  setSelectedList,
  catalogItems,
  categorySets,
  listCategories,
  itemCategoryMaps,
  currentCategories,
  currentMappings,
  groupedItems,
  filteredItems,
  advancedListView,
  selectedItems,
  bulkMoveTarget,
  newListName,
  renameListId,
  renameValue,
  deleteListId,
  newItem,
  editValues,
  importData,
  importTargetList,
  importNewListName,
  importPreview,
  importMapping,
  newListCategoryName,
  subCategoryParentId,
  subCategoryName,
  editSheetItem,
  editSheetValues,
  setCategorySets,
  setListCategories,
  setItemCategoryMaps,
  setCatalogItems,
  setSelectedItems,
  setBulkMoveOpen,
  setBulkMoveTarget,
  setNewListName,
  setCreateOpen,
  setRenameOpen,
  setDeleteListId,
  setAddItemOpen,
  setNewItem,
  setEditingItem,
  setImportData,
  setImportHeaders,
  setImportMapping,
  setImportPreview,
  setImportStep,
  setImportSummary,
  setImportOpen,
  setNewListCategoryName,
  setSubCategoryDialogOpen,
  setSubCategoryParentId,
  setSubCategoryName,
  setSaveStatus,
  setEditSheetItem,
  setEditSheetSaving,
  setDeleteItemId,
  refreshLists,
  loadListDetail,
  resetImport,
}: UseListManagementActionsArgs) {
  const getOrCreateCategorySet = async (
    listId: string,
    setType: CategorySetType,
  ): Promise<CategorySet> => {
    const existing = categorySets.find(
      (categorySet) => categorySet.list_id === listId && categorySet.set_type === setType,
    );
    if (existing) return existing;

    const { data, error } = (await supabase
      .from("list_category_sets")
      .insert({
        list_id: listId,
        set_type: setType,
      })
      .select()
      .single()) as unknown as {
      data: CategorySet | null;
      error: { message?: string } | null;
    };

    if (error || !data) throw error ?? new Error("Failed to create category set");
    setCategorySets((previous) => [...previous, data]);
    return data;
  };

  const persistListCategoryModeToDb = async (nextView: AdvancedListView) => {
    if (!selectedList) return;

    let dbMode: string;
    if (nextView === "keyword-groups") {
      dbMode = "custom_ai";
    } else if (nextView === "recent") {
      dbMode = "recently_purchased";
    } else {
      const userManualSet = categorySets.find(
        (categorySet) =>
          categorySet.list_id === selectedList.id && categorySet.set_type === "user_manual",
      );
      const hasShelfData =
        !!userManualSet &&
        (listCategories.some((category) => category.category_set_id === userManualSet.id) ||
          itemCategoryMaps.some((mapping) => mapping.category_set_id === userManualSet.id));
      dbMode = hasShelfData ? "user_manual" : "list_order";
    }

    await supabase
      .from("inventory_lists")
      .update({ active_category_mode: dbMode })
      .eq("id", selectedList.id);
    setSelectedList({ ...selectedList, active_category_mode: dbMode });
  };

  const handleCreateList = async () => {
    if (!restaurantId || !userId || !newListName.trim()) return;

    const { error } = await supabase.from("inventory_lists").insert({
      restaurant_id: restaurantId,
      name: newListName.trim(),
      created_by: userId,
    });

    if (error) {
      toast.error(error.message);
      return;
    }

    toast.success("List created");
    setNewListName("");
    setCreateOpen(false);
    await refreshLists();
  };

  const handleRenameList = async () => {
    if (!renameListId || !renameValue.trim()) return;

    const { error } = await supabase
      .from("inventory_lists")
      .update({ name: renameValue.trim() })
      .eq("id", renameListId);

    if (error) {
      toast.error(error.message);
      return;
    }

    toast.success("List renamed");
    setRenameOpen(false);
    if (selectedList?.id === renameListId) {
      setSelectedList({ ...selectedList, name: renameValue.trim() });
    }
    await refreshLists();
  };

  const handleDuplicateList = async (list: InventoryListRow) => {
    if (!restaurantId || !userId) return;

    const { data: newList, error } = (await supabase
      .from("inventory_lists")
      .insert({
        restaurant_id: restaurantId,
        name: `${list.name} (Copy)`,
        created_by: userId,
        active_category_mode: list.active_category_mode,
        location_id: list.location_id ?? null,
      })
      .select()
      .single()) as unknown as {
      data: InventoryListRow | null;
      error: { message?: string } | null;
    };

    if (error || !newList) {
      toast.error("Failed to duplicate");
      return;
    }

    const catalogIdMap: Record<string, string> = {};

    const { data: sourceItems } = (await supabase
      .from("inventory_catalog_items")
      .select("*")
      .eq("inventory_list_id", list.id)) as unknown as {
      data: CatalogItem[] | null;
    };

    const sortedSourceItems = [...(sourceItems ?? [])].sort((a, b) => {
      const order = (a.sort_order ?? 0) - (b.sort_order ?? 0);
      return order !== 0 ? order : (a.item_name || "").localeCompare(b.item_name || "");
    });

    if (sortedSourceItems.length > 0) {
      const rows = sortedSourceItems.map(({ id: _id, created_at: _c, updated_at: _u, ...rest }) => ({
        ...rest,
        inventory_list_id: newList.id,
      }));
      const { data: insertedCatalog, error: catalogError } = (await supabase
        .from("inventory_catalog_items")
        .insert(rows)
        .select("id")) as unknown as {
        data: Array<{ id: string }> | null;
        error: { message?: string } | null;
      };
      if (catalogError || !insertedCatalog || insertedCatalog.length !== sortedSourceItems.length) {
        toast.error(catalogError?.message ?? "Failed to duplicate catalog items");
        return;
      }
      sortedSourceItems.forEach((old, idx) => {
        catalogIdMap[old.id] = insertedCatalog[idx].id;
      });
    }

    const setIdMap: Record<string, string> = {};
    const { data: sourceSets } = (await supabase
      .from("list_category_sets")
      .select("*")
      .eq("list_id", list.id)) as unknown as { data: CategorySet[] | null };

    for (const s of sourceSets ?? []) {
      const { data: newSet, error: setError } = (await supabase
        .from("list_category_sets")
        .insert({ list_id: newList.id, set_type: s.set_type })
        .select("id")
        .single()) as unknown as {
        data: { id: string } | null;
        error: { message?: string } | null;
      };
      if (setError || !newSet) {
        toast.error(setError?.message ?? "Failed to duplicate category sets");
        return;
      }
      setIdMap[s.id] = newSet.id;
    }

    const catIdMap: Record<string, string> = {};
    const { data: sourceCats } = (await supabase
      .from("list_categories")
      .select("*")
      .eq("list_id", list.id)
      .order("sort_order", { ascending: true })) as unknown as { data: ListCategory[] | null };

    for (const c of sourceCats ?? []) {
      const newSetId = c.category_set_id ? setIdMap[c.category_set_id] ?? null : null;
      const { data: newCat, error: catError } = (await supabase
        .from("list_categories")
        .insert({
          list_id: newList.id,
          name: c.name,
          sort_order: c.sort_order,
          category_set_id: newSetId,
        })
        .select("id")
        .single()) as unknown as {
        data: { id: string } | null;
        error: { message?: string } | null;
      };
      if (catError || !newCat) {
        toast.error(catError?.message ?? "Failed to duplicate shelves");
        return;
      }
      catIdMap[c.id] = newCat.id;
    }

    const { data: sourceMaps } = (await supabase
      .from("list_item_category_map")
      .select("*")
      .eq("list_id", list.id)) as unknown as { data: ItemCategoryMap[] | null };

    const newMapRows: Array<{
      list_id: string;
      catalog_item_id: string;
      category_set_id: string;
      category_id: string | null;
      item_sort_order: number;
    }> = [];

    for (const m of sourceMaps ?? []) {
      const newCatalogId = catalogIdMap[m.catalog_item_id];
      const newSetId = setIdMap[m.category_set_id];
      if (!newCatalogId || !newSetId) continue;
      const newCatId = m.category_id ? catIdMap[m.category_id] ?? null : null;
      newMapRows.push({
        list_id: newList.id,
        catalog_item_id: newCatalogId,
        category_set_id: newSetId,
        category_id: newCatId,
        item_sort_order: m.item_sort_order,
      });
    }

    if (newMapRows.length > 0) {
      const { error: mapError } = await supabase.from("list_item_category_map").insert(newMapRows);
      if (mapError) {
        toast.error(mapError.message);
        return;
      }
    }

    toast.success("List duplicated");
    await refreshLists();
  };

  const handleDeleteList = async () => {
    if (!deleteListId) return;

    const { error } = await supabase.rpc("delete_inventory_list", { list_id: deleteListId });
    if (error) {
      toast.error(`Failed to delete list: ${error.message}`);
      return;
    }

    toast.success("List deleted");
    setDeleteListId(null);
    if (selectedList?.id === deleteListId) setSelectedList(null);
    await refreshLists();
  };

  const handleAddItemToList = async (mode: "close" | "add_another" = "close"): Promise<boolean> => {
    if (!selectedList || !restaurantId || !newItem.item_name.trim()) return false;

    const newSku = newItem.vendor_sku.trim().toLowerCase();
    const isDuplicate = newSku
      ? catalogItems.some((item) => (item.vendor_sku || "").trim().toLowerCase() === newSku)
      : false;
    if (isDuplicate) {
      toast.error(`An item with item number "${newItem.vendor_sku.trim()}" already exists in this list`);
      return false;
    }

    const maxOrder =
      catalogItems.length > 0
        ? Math.max(...catalogItems.map((item) => item.sort_order || 0)) + 1
        : 0;

    const parParsed =
      newItem.par_level.trim() !== "" ? Number(newItem.par_level) : null;
    const defaultParLevel =
      parParsed != null && !Number.isNaN(parParsed) ? parParsed : null;

    const { data: newRow, error } = await supabase
      .from("inventory_catalog_items")
      .insert({
        restaurant_id: restaurantId,
        inventory_list_id: selectedList.id,
        item_name: newItem.item_name.trim(),
        category: newItem.category || null,
        unit: newItem.unit || null,
        pack_size: newItem.pack_size || null,
        vendor_sku: newItem.vendor_sku || null,
        vendor_name: newItem.vendor_name || null,
        default_unit_cost: newItem.default_unit_cost || null,
        cost_unit: "case",
        default_par_level: defaultParLevel,
        sort_order: maxOrder,
      })
      .select("id")
      .single();

    if (error || !newRow) {
      toast.error(error?.message ?? "Failed to add item");
      return false;
    }

    if (newItem.category?.trim()) {
      const { data: listCats } = await supabase
        .from("list_categories")
        .select("id, name, category_set_id")
        .eq("list_id", selectedList.id);
      const match = listCats?.find(
        (c) => c.name.trim().toLowerCase() === newItem.category.trim().toLowerCase(),
      );
      if (match?.category_set_id) {
        const { data: ordRows } = await supabase
          .from("list_item_category_map")
          .select("item_sort_order")
          .eq("list_id", selectedList.id)
          .eq("category_id", match.id);
        const nextOrder =
          ordRows && ordRows.length > 0
            ? Math.max(...ordRows.map((r) => r.item_sort_order), 0) + 1
            : 0;
        const { error: mapErr } = await supabase.from("list_item_category_map").insert({
          list_id: selectedList.id,
          catalog_item_id: newRow.id,
          category_set_id: match.category_set_id,
          category_id: match.id,
          item_sort_order: nextOrder,
        });
        if (mapErr) {
          console.error(mapErr);
        }
      }
    }

    const emptyDraft: NewItemDraft = {
      item_name: "",
      category: "",
      unit: "",
      pack_size: "",
      vendor_sku: "",
      vendor_name: "",
      default_unit_cost: 0,
      par_level: "",
    };

    if (mode === "add_another") {
      setNewItem({ ...emptyDraft, category: newItem.category });
      await loadListDetail(selectedList);
      return true;
    }

    toast.success("Item added");
    setNewItem(emptyDraft);
    setAddItemOpen(false);
    await loadListDetail(selectedList);
    return true;
  };

  const handleSaveInlineEdit = async (itemId: string) => {
    setSaveStatus("saving");
    if (editValues.vendor_sku !== undefined && editValues.vendor_sku) {
      const newSku = (editValues.vendor_sku ?? "").trim().toLowerCase();
      if (newSku) {
        const conflict = catalogItems.some(
          (item) => item.id !== itemId && (item.vendor_sku || "").trim().toLowerCase() === newSku,
        );
        if (conflict) {
          toast.error(`An item with item number "${editValues.vendor_sku}" already exists in this list`);
          setSaveStatus("idle");
          return;
        }
      }
    }
    const { error } = await supabase
      .from("inventory_catalog_items")
      .update({ ...editValues, cost_unit: "case" })
      .eq("id", itemId);

    if (error) {
      toast.error(error.message);
      setSaveStatus("idle");
      return;
    }

    setEditingItem(null);
    setSaveStatus("saved");
    setTimeout(() => setSaveStatus("idle"), 2000);
    if (selectedList) await loadListDetail(selectedList);
    await refreshLists();
  };

  const handleDuplicateItem = async (item: CatalogItem) => {
    if (!selectedList || !restaurantId) return;

    const maxOrder =
      catalogItems.length > 0
        ? Math.max(...catalogItems.map((catalogItem) => catalogItem.sort_order || 0)) + 1
        : 0;

    const { error } = await supabase.from("inventory_catalog_items").insert({
      restaurant_id: restaurantId,
      inventory_list_id: selectedList.id,
      item_name: `${item.item_name} (Copy)`,
      category: item.category,
      unit: item.unit,
      pack_size: item.pack_size,
      vendor_sku: item.vendor_sku,
      vendor_name: item.vendor_name,
      default_unit_cost: item.default_unit_cost,
      cost_unit: "case",
      sort_order: maxOrder,
    });

    if (error) {
      toast.error(error.message);
      return;
    }

    toast.success("Item duplicated");
    await loadListDetail(selectedList);
  };

  const handleQuickSaveIssue = async (id: string, updates: CatalogItemQuickUpdate) => {
    const { error } = await supabase.from("inventory_catalog_items").update(updates).eq("id", id);
    if (error) {
      toast.error(error.message);
      return;
    }

    toast.success("Updated");
    if (selectedList) await loadListDetail(selectedList);
  };

  const handleSaveEditSheet = async () => {
    if (!editSheetItem) return;

    if (editSheetValues.vendor_sku) {
      const newSku = editSheetValues.vendor_sku.trim().toLowerCase();
      if (newSku) {
        const conflict = catalogItems.some(
          (item) =>
            item.id !== editSheetItem.id && (item.vendor_sku || "").trim().toLowerCase() === newSku,
        );
        if (conflict) {
          toast.error(`An item with item number "${editSheetValues.vendor_sku}" already exists in this list`);
          return;
        }
      }
    }

    setEditSheetSaving(true);
    const { error } = await supabase
      .from("inventory_catalog_items")
      .update({
        item_name: editSheetValues.item_name,
        vendor_sku: editSheetValues.vendor_sku || null,
        default_unit_cost: editSheetValues.default_unit_cost,
        cost_unit: "case",
        unit: editSheetValues.unit || null,
        pack_size: editSheetValues.pack_size || null,
      })
      .eq("id", editSheetItem.id);

    setEditSheetSaving(false);

    if (error) {
      toast.error(error.message);
      return;
    }

    toast.success("✅ Item saved");
    setEditSheetItem(null);
    if (selectedList) await loadListDetail(selectedList);
  };

  const handleDeleteItemConfirmed = async (itemId: string | null) => {
    if (!itemId) return;

    await supabase.from("list_item_category_map").delete().eq("catalog_item_id", itemId);
    const { error } = await supabase.from("inventory_catalog_items").delete().eq("id", itemId).eq("restaurant_id", restaurantId);

    if (error) {
      toast.error(error.message);
      return;
    }

    toast.success("Item deleted");
    setDeleteItemId(null);
    if (selectedList) await loadListDetail(selectedList);
  };

  const handleDragEnd = async (result: DropResult) => {
    if (!result.destination || !selectedList) return;
    if (advancedListView === "recent") return;

    const { source, destination } = result;
    const isFlatSingleGroup =
      Object.keys(groupedItems).length === 1 && Object.prototype.hasOwnProperty.call(groupedItems, "All Items");

    if (result.draggableId.startsWith("shelf:")) {
      if (
        destination.droppableId !== DROPPABLE_SHELF_ORDER ||
        source.droppableId !== DROPPABLE_SHELF_ORDER
      ) {
        return;
      }

      const namedKeys = getOrderedNamedCategoryKeys(groupedItems, currentCategories);
      if (namedKeys.length < 2) return;

      const ids = namedKeys
        .map((name) => currentCategories.find((category) => category.name === name)?.id)
        .filter((id): id is string => Boolean(id));
      const reordered = [...ids];
      const [removed] = reordered.splice(source.index, 1);
      reordered.splice(destination.index, 0, removed);

      const visibleSet = new Set(reordered);
      const hiddenSorted = [...currentCategories]
        .sort((left, right) => left.sort_order - right.sort_order)
        .filter((category) => !visibleSet.has(category.id));

      let order = 0;
      const patches: Array<{ id: string; sort_order: number }> = [];
      for (const id of reordered) patches.push({ id, sort_order: order++ });
      for (const category of hiddenSorted) patches.push({ id: category.id, sort_order: order++ });

      setSaveStatus("saving");
      await Promise.all(
        patches.map((patch) =>
          supabase.from("list_categories").update({ sort_order: patch.sort_order }).eq("id", patch.id),
        ),
      );
      setListCategories((previous) =>
        previous.map((category) => {
          const patch = patches.find((entry) => entry.id === category.id);
          return patch ? { ...category, sort_order: patch.sort_order } : category;
        }),
      );
      setSaveStatus("saved");
      toast.success("Saved");
      setTimeout(() => setSaveStatus("idle"), 2000);
      return;
    }

    if (advancedListView === "keyword-groups" || (advancedListView === null && !isFlatSingleGroup)) {
      const set = await getOrCreateCategorySet(
        selectedList.id,
        getCategorySetTypeForView(advancedListView),
      );
      const sourceCategoryName = parseItemDroppableId(source.droppableId);
      const destinationCategoryName = parseItemDroppableId(destination.droppableId);

      const sourceItems = [...(groupedItems[sourceCategoryName] || [])];
      const destinationItems =
        sourceCategoryName === destinationCategoryName
          ? sourceItems
          : [...(groupedItems[destinationCategoryName] || [])];

      const [movedItem] = sourceItems.splice(source.index, 1);
      if (!movedItem) return;

      const targetCategory = currentCategories.find(
        (category) => category.name === destinationCategoryName,
      );
      const newCategoryId =
        destinationCategoryName === "Uncategorized" ? null : targetCategory?.id || null;

      if (sourceCategoryName === destinationCategoryName) {
        sourceItems.splice(destination.index, 0, movedItem);
        const updatedMaps = [...itemCategoryMaps];
        sourceItems.forEach((item, index) => {
          const mapIndex = updatedMaps.findIndex(
            (mapping) =>
              mapping.category_set_id === set.id && mapping.catalog_item_id === item.id,
          );
          if (mapIndex >= 0) {
            updatedMaps[mapIndex] = { ...updatedMaps[mapIndex], item_sort_order: index };
          }
        });
        setItemCategoryMaps(updatedMaps);
        setSaveStatus("saving");
        await Promise.all(
          sourceItems.map((item, index) =>
            supabase.from("list_item_category_map").upsert(
              {
                list_id: selectedList.id,
                category_set_id: set.id,
                catalog_item_id: item.id,
                category_id:
                  currentMappings.find((mapping) => mapping.catalog_item_id === item.id)?.category_id ||
                  null,
                item_sort_order: index,
              },
              { onConflict: "category_set_id,catalog_item_id" },
            ),
          ),
        );
      } else {
        destinationItems.splice(destination.index, 0, movedItem);
        const updatedMaps = [...itemCategoryMaps];
        const movedMapIndex = updatedMaps.findIndex(
          (mapping) =>
            mapping.category_set_id === set.id && mapping.catalog_item_id === movedItem.id,
        );
        if (movedMapIndex >= 0) {
          updatedMaps[movedMapIndex] = {
            ...updatedMaps[movedMapIndex],
            category_id: newCategoryId,
            item_sort_order: destination.index,
          };
        }
        sourceItems.forEach((item, index) => {
          const mapIndex = updatedMaps.findIndex(
            (mapping) =>
              mapping.category_set_id === set.id && mapping.catalog_item_id === item.id,
          );
          if (mapIndex >= 0) {
            updatedMaps[mapIndex] = { ...updatedMaps[mapIndex], item_sort_order: index };
          }
        });
        destinationItems.forEach((item, index) => {
          const mapIndex = updatedMaps.findIndex(
            (mapping) =>
              mapping.category_set_id === set.id && mapping.catalog_item_id === item.id,
          );
          if (mapIndex >= 0) {
            updatedMaps[mapIndex] = { ...updatedMaps[mapIndex], item_sort_order: index };
          }
        });
        setItemCategoryMaps(updatedMaps);
        setSaveStatus("saving");

        const updates: Array<Promise<unknown>> = [];
        updates.push(
          Promise.resolve(
            supabase
              .from("list_item_category_map")
              .upsert(
                {
                  list_id: selectedList.id,
                  category_set_id: set.id,
                  catalog_item_id: movedItem.id,
                  category_id: newCategoryId,
                  item_sort_order: destination.index,
                },
                { onConflict: "category_set_id,catalog_item_id" },
              )
              .select(),
          ),
        );
        sourceItems.forEach((item, index) => {
          updates.push(
            Promise.resolve(
              supabase
                .from("list_item_category_map")
                .upsert(
                  {
                    list_id: selectedList.id,
                    category_set_id: set.id,
                    catalog_item_id: item.id,
                    category_id:
                      currentMappings.find((mapping) => mapping.catalog_item_id === item.id)
                        ?.category_id || null,
                    item_sort_order: index,
                  },
                  { onConflict: "category_set_id,catalog_item_id" },
                )
                .select(),
            ),
          );
        });
        destinationItems.forEach((item, index) => {
          if (item.id === movedItem.id) return;
          const map = currentMappings.find((mapping) => mapping.catalog_item_id === item.id);
          updates.push(
            Promise.resolve(
              supabase
                .from("list_item_category_map")
                .upsert(
                  {
                    list_id: selectedList.id,
                    category_set_id: set.id,
                    catalog_item_id: item.id,
                    category_id: map?.category_id || newCategoryId,
                    item_sort_order: index,
                  },
                  { onConflict: "category_set_id,catalog_item_id" },
                )
                .select(),
            ),
          );
        });
        await Promise.all(updates);
      }

      setSaveStatus("saved");
      toast.success("Saved");
      setTimeout(() => setSaveStatus("idle"), 2000);
      return;
    }

    const reordered = Array.from(filteredItems);
    const [moved] = reordered.splice(source.index, 1);
    reordered.splice(destination.index, 0, moved);

    const updatedItems = catalogItems.map((catalogItem) => {
      const index = reordered.findIndex((item) => item.id === catalogItem.id);
      return index !== -1 ? { ...catalogItem, sort_order: index } : catalogItem;
    });
    setCatalogItems(updatedItems);
    setSaveStatus("saving");

    await Promise.all(
      reordered.map((item, index) =>
        supabase.from("inventory_catalog_items").update({ sort_order: index }).eq("id", item.id),
      ),
    );

    setSaveStatus("saved");
    toast.success("Saved");
    setTimeout(() => setSaveStatus("idle"), 2000);
  };

  const handleBulkMove = async () => {
    if (!selectedList || selectedItems.size === 0) return;

    const set = await getOrCreateCategorySet(
      selectedList.id,
      getCategorySetTypeForView(advancedListView),
    );
    const targetCategoryId = bulkMoveTarget === "__uncategorized" ? null : bulkMoveTarget;

    const existingInTarget = currentMappings
      .filter((mapping) => {
        if (targetCategoryId === null) return !mapping.category_id;
        return mapping.category_id === targetCategoryId;
      })
      .filter((mapping) => !selectedItems.has(mapping.catalog_item_id));

    let nextOrder =
      existingInTarget.length > 0
        ? Math.max(...existingInTarget.map((mapping) => mapping.item_sort_order || 0)) + 1
        : 0;

    const updatedMaps = [...itemCategoryMaps];
    const newMaps: ItemCategoryMap[] = [];
    for (const itemId of selectedItems) {
      const existingIndex = updatedMaps.findIndex(
        (mapping) => mapping.category_set_id === set.id && mapping.catalog_item_id === itemId,
      );
      if (existingIndex >= 0) {
        updatedMaps[existingIndex] = {
          ...updatedMaps[existingIndex],
          category_id: targetCategoryId,
          item_sort_order: nextOrder++,
        };
      } else {
        newMaps.push({
          id: crypto.randomUUID(),
          list_id: selectedList.id,
          category_set_id: set.id,
          catalog_item_id: itemId,
          category_id: targetCategoryId,
          item_sort_order: nextOrder++,
        });
      }
    }
    setItemCategoryMaps([...updatedMaps, ...newMaps]);
    setSaveStatus("saving");

    nextOrder =
      existingInTarget.length > 0
        ? Math.max(...existingInTarget.map((mapping) => mapping.item_sort_order || 0)) + 1
        : 0;
    const updates = Array.from(selectedItems).map((id) => {
      const order = nextOrder++;
      return supabase.from("list_item_category_map").upsert(
        {
          list_id: selectedList.id,
          category_set_id: set.id,
          catalog_item_id: id,
          category_id: targetCategoryId,
          item_sort_order: order,
        },
        { onConflict: "category_set_id,catalog_item_id" },
      );
    });
    await Promise.all(updates);

    setSaveStatus("saved");
    toast.success(`Moved ${selectedItems.size} items`);
    setTimeout(() => setSaveStatus("idle"), 2000);
    setSelectedItems(new Set());
    setBulkMoveOpen(false);
    setBulkMoveTarget("");

    const { data: refreshedMaps } = (await supabase
      .from("list_item_category_map")
      .select("*")
      .eq("list_id", selectedList.id)) as unknown as {
      data: ItemCategoryMap[] | null;
    };
    if (refreshedMaps) setItemCategoryMaps(refreshedMaps);
  };

  const handleSaveAICategories = async (): Promise<boolean> => {
    if (!selectedList) return false;

    setSaveStatus("saving");
    try {
      const set = await getOrCreateCategorySet(selectedList.id, "custom_ai");
      await supabase.from("list_item_category_map").delete().eq("category_set_id", set.id);
      await supabase.from("list_categories").delete().eq("category_set_id", set.id);

      const aiGroups = new Set<string>();
      catalogItems.forEach((item) => {
        aiGroups.add(getAICategory(item.item_name));
      });

      const categoryMap: Record<string, string> = {};
      let sortIndex = 0;
      for (const categoryName of aiGroups) {
        const { data } = (await supabase
          .from("list_categories")
          .insert({
            list_id: selectedList.id,
            name: categoryName,
            sort_order: sortIndex++,
            category_set_id: set.id,
          })
          .select()
          .single()) as unknown as {
          data: ListCategory | null;
        };
        if (data) categoryMap[categoryName] = data.id;
      }

      const mappings = catalogItems.map((item, index) => ({
        list_id: selectedList.id,
        category_set_id: set.id,
        catalog_item_id: item.id,
        category_id: categoryMap[getAICategory(item.item_name)] || null,
        item_sort_order: index,
      }));
      if (mappings.length > 0) {
        const { error: mapErr } = await supabase.from("list_item_category_map").insert(mappings);
        if (mapErr) throw new Error(mapErr.message);
      }

      await persistListCategoryModeToDb("keyword-groups");
      setSaveStatus("saved");
      setTimeout(() => setSaveStatus("idle"), 2000);
      toast.success(
        catalogItems.length > 0
          ? `Categories applied to ${catalogItems.length} item${catalogItems.length === 1 ? "" : "s"}`
          : "No category changes needed",
      );
      await loadListDetail(selectedList);
      return true;
    } catch {
      setSaveStatus("idle");
      toast.error("Failed to apply categories. Please try again.");
      return false;
    }
  };

  const handleImportFileUpload = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      const parsed = await parseFile(file);
      const headers = parsed.headers;
      const rows = parsed.rows as Record<string, string | number | boolean | null | undefined>[];

      if (rows.length === 0) {
        toast.error("No data found");
        return;
      }

      setImportData(rows);
      setImportHeaders(headers);

      if (restaurantId) {
        const { data: templates } = (await supabase
          .from("import_templates")
          .select("*")
          .eq("restaurant_id", restaurantId)
          .order("last_used_at", { ascending: false })
          .limit(5)) as unknown as {
          data: ImportTemplateRow[] | null;
        };

        if (templates?.length) {
          const headerSet = new Set(headers.map((header) => header.toLowerCase()));
          for (const template of templates) {
            const mapping = coerceImportTemplateMapping(template.mapping_json);
            if (!mapping) continue;
            const allMatch = Object.values(mapping).every((value) =>
              headerSet.has(value.toLowerCase()),
            );
            if (allMatch) {
              setImportMapping(mapping);
              toast.info(`Auto-applied mapping template: ${template.name}`);
              setImportStep("map");
              return;
            }
          }
        }
      }

      setImportMapping(buildImportAutoMapping(headers));
      setImportStep("map");
    } catch {
      toast.error("Failed to read file");
    }
  };

  const handleImportPreview = () => {
    if (!importMapping.item_name) {
      toast.error("Map required fields: item name");
      return;
    }

    const { preview, summary } = buildImportPreview({
      importData,
      importMapping,
    });
    setImportPreview(preview);
    setImportSummary(summary);
    setImportStep("preview");
  };

  const handleImportConfirm = async () => {
    if (!restaurantId || !userId) return;

    let targetListId = importTargetList;
    if (importTargetList === "new") {
      const name = importNewListName.trim() || `Import ${new Date().toLocaleDateString()}`;
      const { data, error } = (await supabase
        .from("inventory_lists")
        .insert({
          restaurant_id: restaurantId,
          name,
          created_by: userId,
        })
        .select()
        .single()) as unknown as {
        data: InventoryListRow | null;
        error: { message?: string } | null;
      };
      if (error || !data) {
        toast.error("Failed to create list");
        return;
      }
      targetListId = data.id;
    }

    const rowsPayload = importPreview.map((row, index) => ({
      restaurant_id: restaurantId,
      inventory_list_id: targetListId,
      item_name: row.item_name,
      unit: row.unit || null,
      pack_size: row.pack_size || null,
      vendor_sku: row.vendor_sku || null,
      product_number: row.vendor_sku || null,
      brand_name: row.brand_name || null,
      vendor_name: row.vendor_name || null,
      category: row.category?.trim() || null,
      default_unit_cost: row.default_unit_cost,
      sort_order: index,
    }));

    const insertedIds: (string | null)[] = [];
    let inserted = 0;
    let failed = 0;
    for (const chunk of chunkArray(rowsPayload, 200)) {
      const { data, error } = await supabase
        .from("inventory_catalog_items")
        .insert(chunk)
        .select("id");
      if (!error && data && data.length === chunk.length) {
        for (const r of data) insertedIds.push(r.id);
        inserted += data.length;
        continue;
      }
      for (const row of chunk) {
        const { data: rowData, error: rowError } = await supabase
          .from("inventory_catalog_items")
          .insert(row)
          .select("id")
          .single();
        if (rowError || !rowData) {
          insertedIds.push(null);
          failed += 1;
        } else {
          insertedIds.push(rowData.id);
          inserted += 1;
        }
      }
    }

    if (inserted > 0) {
      const { data: listCats } = await supabase
        .from("list_categories")
        .select("id, name, category_set_id")
        .eq("list_id", targetListId);
      const byName = new Map((listCats ?? []).map((c) => [c.name.trim().toLowerCase(), c]));
      const mapInserts: ItemCategoryMapInsert[] = [];
      for (let i = 0; i < importPreview.length; i++) {
        const cid = insertedIds[i];
        const previewRow = importPreview[i];
        if (!cid || !previewRow.category?.trim()) continue;
        const matched = byName.get(previewRow.category.trim().toLowerCase());
        if (!matched?.category_set_id) continue;
        mapInserts.push({
          list_id: targetListId,
          catalog_item_id: cid,
          category_set_id: matched.category_set_id,
          category_id: matched.id,
          item_sort_order: i,
        });
      }
      if (mapInserts.length > 0) {
        const { error: mapErr } = await supabase.from("list_item_category_map").insert(mapInserts);
        if (mapErr) console.error(mapErr);
      }
    }

    await supabase.from("import_templates").insert({
      restaurant_id: restaurantId,
      name: `Template ${new Date().toLocaleDateString()}`,
      mapping_json: importMapping,
      inventory_list_id: targetListId,
      last_used_at: new Date().toISOString(),
    });

    if (inserted === 0 && failed > 0) {
      toast.error(`Could not save imported rows (${failed} failed).`);
    } else {
      toast.success(
        failed > 0
          ? `Imported ${inserted} item${inserted === 1 ? "" : "s"} (${failed} row${
              failed === 1 ? "" : "s"
            } could not be saved)`
          : `Imported ${inserted} item${inserted === 1 ? "" : "s"}`,
      );
    }

    setImportOpen(false);
    resetImport();
    await refreshLists();
    if (selectedList?.id === targetListId) {
      await loadListDetail(selectedList);
    }
  };

  const handleAddListCategory = async () => {
    if (!selectedList || !newListCategoryName.trim()) return;
    if (currentCategories.some((category) => category.name === newListCategoryName.trim())) {
      toast.error("Category already exists");
      return;
    }

    const set = await getOrCreateCategorySet(
      selectedList.id,
      getCategorySetTypeForView(advancedListView),
    );

    const maxOrder =
      currentCategories.length > 0
        ? Math.max(...currentCategories.map((category) => category.sort_order)) + 1
        : 0;

    const payload: ListCategoryInsert = {
      list_id: selectedList.id,
      name: newListCategoryName.trim(),
      sort_order: maxOrder,
      category_set_id: set.id,
    };
    const { data, error } = (await supabase
      .from("list_categories")
      .insert(payload)
      .select()
      .single()) as unknown as {
      data: ListCategory | null;
      error: { message?: string } | null;
    };

    if (error) {
      toast.error(error.message);
      return;
    }

    toast.success(`Category "${newListCategoryName.trim()}" created`);
    setNewListCategoryName("");
    if (data) {
      setListCategories((previous) => [...previous, data]);
      if (advancedListView === "keyword-groups") {
        await persistListCategoryModeToDb("keyword-groups");
      } else {
        await supabase
          .from("inventory_lists")
          .update({ active_category_mode: "user_manual" })
          .eq("id", selectedList.id);
        setSelectedList({ ...selectedList, active_category_mode: "user_manual" });
      }
    }
  };

  const handleAddSubCategory = async () => {
    if (!selectedList || !subCategoryParentId || !subCategoryName.trim()) return;

    const set = await getOrCreateCategorySet(
      selectedList.id,
      getCategorySetTypeForView(advancedListView),
    );
    const payload: ListCategoryInsert = {
      list_id: selectedList.id,
      name: subCategoryName.trim(),
      sort_order: 0,
      category_set_id: set.id,
      parent_category_id: subCategoryParentId,
    };
    const { data, error } = (await supabase
      .from("list_categories")
      .insert(payload)
      .select()
      .single()) as unknown as {
      data: ListCategory | null;
      error: { message?: string } | null;
    };

    if (error) {
      toast.error(error.message);
      return;
    }

    toast.success(`Sub-category "${subCategoryName.trim()}" created`);
    if (data) setListCategories((previous) => [...previous, data]);
    setSubCategoryDialogOpen(false);
    setSubCategoryParentId(null);
    setSubCategoryName("");
    if (advancedListView === "keyword-groups") {
      await persistListCategoryModeToDb("keyword-groups");
    } else {
      await supabase
        .from("inventory_lists")
        .update({ active_category_mode: "user_manual" })
        .eq("id", selectedList.id);
      setSelectedList({ ...selectedList, active_category_mode: "user_manual" });
    }
  };

  const handleRenameCategory = async (category: ListCategory, newName: string) => {
    if (!selectedList) return;
    await supabase.from("list_categories").update({ name: newName }).eq("id", category.id);
    toast.success("Category renamed");
    await loadListDetail(selectedList);
  };

  const handleDeleteCategory = async (category: ListCategory) => {
    if (!selectedList) return;
    await supabase
      .from("list_item_category_map")
      .update({ category_id: null })
      .eq("category_id", category.id);
    await supabase.from("list_categories").delete().eq("id", category.id);
    toast.success("Category deleted, items uncategorized");
    await loadListDetail(selectedList);
  };

  const handleExportList = async (list: InventoryListRow, format: ExportFormat) => {
    const { data } = (await supabase
      .from("inventory_catalog_items")
      .select("*")
      .eq("inventory_list_id", list.id)) as unknown as {
      data: CatalogItem[] | null;
    };

    if (!data?.length) {
      toast.error("No items to export");
      return;
    }

    const fileName = `inventory-${list.name}`;
    const meta = { listName: list.name };
    if (format === "csv") exportToCSV(data, fileName, "inventory");
    else if (format === "xlsx") exportToExcel(data, fileName, "inventory", meta);
    else exportToPDF(data, fileName, "inventory", meta);
  };

  const handleAddFromPurchase = async (itemName: string) => {
    if (!selectedList || !restaurantId) return;
    const exists = catalogItems.some(
      (item) => item.item_name.toLowerCase() === itemName.toLowerCase(),
    );
    if (exists) {
      toast.info("Item already in list");
      return;
    }

    const maxOrder =
      catalogItems.length > 0
        ? Math.max(...catalogItems.map((item) => item.sort_order || 0)) + 1
        : 0;
    const { error } = await supabase.from("inventory_catalog_items").insert({
      restaurant_id: restaurantId,
      inventory_list_id: selectedList.id,
      item_name: itemName,
      sort_order: maxOrder,
    });

    if (error) {
      toast.error(error.message);
      return;
    }

    toast.success(`Added "${itemName}" to list`);
    await loadListDetail(selectedList);
  };

  return {
    persistListCategoryModeToDb,
    handleCreateList,
    handleRenameList,
    handleDuplicateList,
    handleDeleteList,
    handleAddItemToList,
    handleSaveInlineEdit,
    handleDuplicateItem,
    handleQuickSaveIssue,
    handleSaveEditSheet,
    handleDeleteItemConfirmed,
    handleDragEnd,
    handleBulkMove,
    handleSaveAICategories,
    handleImportFileUpload,
    handleImportPreview,
    handleImportConfirm,
    handleAddListCategory,
    handleAddSubCategory,
    handleRenameCategory,
    handleDeleteCategory,
    handleExportList,
    handleAddFromPurchase,
  };
}
