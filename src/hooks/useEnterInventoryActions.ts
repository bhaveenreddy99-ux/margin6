import { useState, useRef, type Dispatch, type SetStateAction } from "react";
import { DEFAULT_CATEGORIES } from "@/lib/constants";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useRestaurant } from "@/contexts/RestaurantContext";
import {
  buildCatalogSeedRows,
  buildParOnlySeedRows,
  isInventorySessionItemsCatalogIdSchemaError,
  normalizeItemName,
  sessionRowsToItemState,
} from "@/domain/inventory/enterInventoryHelpers";
import type {
  InventoryCatalogItemRow,
  InventorySessionItemRow,
  InventorySessionListRow,
  ParGuideItemRow,
  ParGuideRow,
  ProfileRow,
  SessionStatus,
} from "@/domain/inventory/enterInventoryTypes";
import type { RiskThresholds } from "@/lib/inventory-utils";
import {
  approveInventorySession,
  createInventorySession,
  duplicateInventorySession,
  moveApprovedInventorySessionToReview,
  sendInventorySessionBackToInProgress,
  submitInventorySessionForReview,
} from "@/domain/inventory/sessionWorkflow";
import { createSmartOrderFromSession } from "@/domain/inventory/smartOrderFromSession";

type StateSetter<T> = Dispatch<SetStateAction<T>>;

type NewItemDraft = {
  item_name: string;
  category: string;
  unit: string;
  current_stock: number;
  unit_cost: number;
};

type EditItemDetailsForm = {
  item_name: string;
  unit: string;
  pack_size: string;
};

type UseEnterInventoryActionsArgs = {
  currentRestaurantId: string | null | undefined;
  userId: string | null | undefined;
  activeSession: InventorySessionListRow | null;
  selectedList: string;
  parItems: ParGuideItemRow[];
  approvedParMap: Record<string, number>;
  countingParGuideId: string | null;
  riskThresholds: RiskThresholds;
  smartOrderSession: InventorySessionListRow | null;
  smartOrderSelectedPar: string;
  newItem: NewItemDraft;
  editItemDetailsSessionItem: InventorySessionItemRow | null;
  editItemDetailsForm: EditItemDetailsForm;
  staffParRequestItem: InventorySessionItemRow | null;
  staffParSuggested: string;
  staffParReason: string;
  staffPriceRequestItem: InventorySessionItemRow | null;
  staffPriceSuggested: string;
  staffPriceReason: string;
  managerParEditItem: InventorySessionItemRow | null;
  managerParInput: string;
  managerPriceEditItem: InventorySessionItemRow | null;
  managerPriceInput: string;
  getApprovedPar: (item: InventorySessionItemRow) => number;
  getCatalogUnitCost: (catalogItemId: string | null | undefined) => number | null;
  navigateTo: (path: string) => void;
  refreshSessions: () => Promise<void>;
  loadCatalogItemsForList: (inventoryListId: string) => Promise<InventoryCatalogItemRow[]>;
  loadLatestParGuide: (inventoryListId: string) => Promise<{
    data: Pick<ParGuideRow, "id"> | null;
    error: { message: string } | null;
  }>;
  loadParGuideItems: (parGuideId: string) => Promise<ParGuideItemRow[]>;
  loadEditorSnapshot: (session: InventorySessionListRow) => Promise<{
    listId: string;
    resolvedCountingParId: string | null;
    sessionItems: InventorySessionItemRow[];
    itemsError: string | null;
    activeCategoryMode: string | null;
    catalogItems: InventoryCatalogItemRow[];
  }>;
  reloadSessionItems: (sessionId: string) => Promise<{
    data: InventorySessionItemRow[] | null;
    error: { message: string } | null;
  }>;
  hydrateCountingParMaps: (guideId: string | null) => Promise<void>;
  loadSmartOrderParGuides: (inventoryListId: string) => Promise<void>;
  setSelectedPar: StateSetter<string>;
  setSelectedList: StateSetter<string>;
  setLandingFocusListId: StateSetter<string | null>;
  setActiveSession: StateSetter<InventorySessionListRow | null>;
  setItemOrder: StateSetter<string[]>;
  setItemById: StateSetter<Record<string, InventorySessionItemRow>>;
  setCategoryMode: StateSetter<string>;
  setParColumnVisible: StateSetter<boolean>;
  setParGuidePickerOpen: StateSetter<boolean>;
  setCountingParGuideId: StateSetter<string | null>;
  setCreateOpen: StateSetter<boolean>;
  setNewItem: StateSetter<NewItemDraft>;
  setSmartOrderSession: StateSetter<InventorySessionListRow | null>;
  setCatalogItems: StateSetter<InventoryCatalogItemRow[]>;
  setEditItemDetailsSessionItem: StateSetter<InventorySessionItemRow | null>;
  setStaffParRequestItem: StateSetter<InventorySessionItemRow | null>;
  setStaffPriceRequestItem: StateSetter<InventorySessionItemRow | null>;
  setManagerParEditItem: StateSetter<InventorySessionItemRow | null>;
  setManagerPriceEditItem: StateSetter<InventorySessionItemRow | null>;
};

type NotificationMemberRow = {
  user_id: string;
  role: string;
};

function sessionLocked(status: SessionStatus | null | undefined) {
  return status === "IN_REVIEW" || status === "APPROVED";
}

export function useEnterInventoryActions({
  currentRestaurantId,
  userId,
  activeSession,
  selectedList,
  parItems,
  approvedParMap,
  countingParGuideId,
  riskThresholds,
  smartOrderSession,
  smartOrderSelectedPar,
  newItem,
  editItemDetailsSessionItem,
  editItemDetailsForm,
  staffParRequestItem,
  staffParSuggested,
  staffParReason,
  staffPriceRequestItem,
  staffPriceSuggested,
  staffPriceReason,
  managerParEditItem,
  managerParInput,
  managerPriceEditItem,
  managerPriceInput,
  getApprovedPar,
  getCatalogUnitCost,
  navigateTo,
  refreshSessions,
  loadCatalogItemsForList,
  loadLatestParGuide,
  loadParGuideItems,
  loadEditorSnapshot,
  reloadSessionItems,
  hydrateCountingParMaps,
  loadSmartOrderParGuides,
  setSelectedPar,
  setSelectedList,
  setLandingFocusListId,
  setActiveSession,
  setItemOrder,
  setItemById,
  setCategoryMode,
  setParColumnVisible,
  setParGuidePickerOpen,
  setCountingParGuideId,
  setCreateOpen,
  setNewItem,
  setSmartOrderSession,
  setCatalogItems,
  setEditItemDetailsSessionItem,
  setStaffParRequestItem,
  setStaffPriceRequestItem,
  setManagerParEditItem,
  setManagerPriceEditItem,
}: UseEnterInventoryActionsArgs) {
  const { currentLocation } = useRestaurant();
  const isApprovingRef = useRef(false);

  const [startingListId, setStartingListId] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [savedId, setSavedId] = useState<string | null>(null);
  const [smartOrderCreating, setSmartOrderCreating] = useState(false);
  const [editItemDetailsSaving, setEditItemDetailsSaving] = useState(false);
  const [staffParSending, setStaffParSending] = useState(false);
  const [staffPriceSending, setStaffPriceSending] = useState(false);
  const [managerParSaving, setManagerParSaving] = useState(false);
  const [managerPriceSaving, setManagerPriceSaving] = useState(false);

  const markSaved = (id: string) => {
    setSavedId(id);
    setTimeout(() => {
      setSavedId((previous) => (previous === id ? null : previous));
    }, 1500);
  };

  const persistSessionCountingParGuide = async (
    sessionId: string,
    guideId: string | null,
  ) => {
    try {
      if (guideId) sessionStorage.setItem(`inv_counting_par_guide_${sessionId}`, guideId);
      else sessionStorage.removeItem(`inv_counting_par_guide_${sessionId}`);
    } catch {
      // ignore
    }

    const { error } = await supabase
      .from("inventory_sessions")
      .update({
        counting_par_guide_id: guideId,
        updated_at: new Date().toISOString(),
      })
      .eq("id", sessionId);

    if (error && /counting_par_guide|schema cache|column/i.test(error.message)) {
      console.log("[EnterInventory] counting_par_guide_id update skipped:", error.message);
    }
  };

  const insertInventorySessionLinesFromCatalog = async (
    sessionId: string,
    inventoryListId: string,
  ): Promise<{ ok: boolean; count: number; errorMessage?: string }> => {
    const loadedCatalog = await loadCatalogItemsForList(inventoryListId);
    const latestGuideResult = await loadLatestParGuide(inventoryListId);
    if (latestGuideResult.error) {
      toast.error(`Could not load PAR guide: ${latestGuideResult.error.message}`);
    }
    const latestParItems = latestGuideResult.data
      ? await loadParGuideItems(latestGuideResult.data.id)
      : [];

    const { withCatalog, withoutCatalog } = buildCatalogSeedRows({
      sessionId,
      catalogItems: loadedCatalog,
      parGuideItems: latestParItems,
    });

    if (withCatalog.length === 0) {
      return { ok: true, count: 0 };
    }

    let { data: insertedSessionItems, error: insertError } = (await supabase
      .from("inventory_session_items")
      .insert(withCatalog)
      .select("id")) as unknown as {
      data: Array<{ id: string }> | null;
      error: { message: string } | null;
    };

    if (insertError && isInventorySessionItemsCatalogIdSchemaError(insertError.message)) {
      console.log(
        "[EnterInventory] Retrying session seed without catalog_item_id (DB column missing).",
      );
      ({ data: insertedSessionItems, error: insertError } = (await supabase
        .from("inventory_session_items")
        .insert(withoutCatalog)
        .select("id")) as unknown as {
        data: Array<{ id: string }> | null;
        error: { message: string } | null;
      });
    }

    if (insertError) {
      console.log(
        "[EnterInventory] inventory_session_items insert (seed) error:",
        insertError.message,
      );
      return { ok: false, count: 0, errorMessage: insertError.message };
    }

    return { ok: true, count: insertedSessionItems?.length ?? 0 };
  };

  const openEditor = async (session: InventorySessionListRow) => {
    if (session.status && session.status !== "IN_PROGRESS") {
      sessionStorage.removeItem("inv_active_session");
      toast.info("Only in-progress counts can be edited here. Use Review for submitted sessions.");
      return;
    }
    if (!session.id) {
      toast.error("Invalid session — could not open count.");
      return;
    }

    sessionStorage.setItem("inv_active_session", session.id);

    let resolvedCountingParId: string | null = null;
    try {
      resolvedCountingParId = sessionStorage.getItem(`inv_counting_par_guide_${session.id}`);
    } catch {
      // ignore
    }

    const snapshot = await loadEditorSnapshot(session);
    const listId = snapshot.listId;
    resolvedCountingParId = snapshot.resolvedCountingParId ?? resolvedCountingParId;

    setSelectedList(listId);
    setActiveSession({
      ...session,
      inventory_list_id: listId,
      counting_par_guide_id: resolvedCountingParId,
    });

    if (snapshot.itemsError) {
      toast.error(snapshot.itemsError);
    }

    let sessionItems = snapshot.sessionItems;
    const shouldTrySeed =
      !!currentRestaurantId &&
      !!listId &&
      (!session.status || session.status === "IN_PROGRESS") &&
      sessionItems.length === 0;

    if (shouldTrySeed) {
      const seedResult = await insertInventorySessionLinesFromCatalog(session.id, listId);
      if (!seedResult.ok && seedResult.errorMessage) {
        toast.error(seedResult.errorMessage);
      } else if (seedResult.count > 0) {
        const reloadResult = await reloadSessionItems(session.id);
        if (reloadResult.error) {
          toast.error(reloadResult.error.message);
        } else {
          sessionItems = reloadResult.data ?? [];
        }
      }
    }

    const itemState = sessionRowsToItemState(sessionItems);
    setItemOrder(itemState.itemOrder);
    setItemById(itemState.itemById);
    setCatalogItems(snapshot.catalogItems);

    if (snapshot.activeCategoryMode) {
      const dbMode = snapshot.activeCategoryMode;
      if (dbMode === "ai" || dbMode === "custom-categories") {
        setCategoryMode("custom-categories");
      } else if (dbMode === "user" || dbMode === "my-categories") {
        setCategoryMode("my-categories");
      } else {
        setCategoryMode("list_order");
      }
    }

    setParColumnVisible(false);
    let guideIdForHydration = resolvedCountingParId;
    if (!guideIdForHydration && listId && currentRestaurantId) {
      const latestGuide = await loadLatestParGuide(listId);
      if (latestGuide.error) {
        toast.error(`Could not load PAR guide: ${latestGuide.error.message}`);
      }
      if (latestGuide.data?.id) guideIdForHydration = latestGuide.data.id;
    }

    setCountingParGuideId(guideIdForHydration);
    await hydrateCountingParMaps(guideIdForHydration);
  };

  const createSessionForList = async (listId: string, name: string) => {
    if (!currentRestaurantId || !userId || !listId || !name.trim()) return;

    const listIdTrimmed = listId.trim();
    setStartingListId(listIdTrimmed);

    try {
      const { data, error } = await createInventorySession({
        supabase,
        restaurantId: currentRestaurantId,
        inventoryListId: listIdTrimmed,
        name: name.trim(),
        userId,
        locationId: currentLocation?.id ?? null,
      });

      if (error || !data) {
        toast.error(error?.message ?? "Could not create session.");
        return;
      }

      const catalogSeed = await insertInventorySessionLinesFromCatalog(data.id, listIdTrimmed);
      if (!catalogSeed.ok) {
        toast.error(catalogSeed.errorMessage || "Could not copy list items into this count.");
      }

      if (catalogSeed.count === 0) {
        let resolvedParItems = selectedList === listIdTrimmed ? parItems : [];
        if (resolvedParItems.length === 0 && listIdTrimmed) {
          const latestGuide = await loadLatestParGuide(listIdTrimmed);
          if (latestGuide.error) {
            toast.error(`Could not load PAR guide: ${latestGuide.error.message}`);
          }
          if (latestGuide.data) {
            resolvedParItems = await loadParGuideItems(latestGuide.data.id);
          }
        }

        if (resolvedParItems.length > 0) {
          const { error: sessionItemsInsertError } = await supabase
            .from("inventory_session_items")
            .insert(buildParOnlySeedRows(data.id, resolvedParItems));
          if (sessionItemsInsertError) {
            toast.error(sessionItemsInsertError.message);
            console.log(
              "[EnterInventory] PAR-only session items insert:",
              sessionItemsInsertError.message,
            );
          }
        }
      }

      toast.success("Session created — start entering counts");
      setSelectedPar("");
      setSelectedList(listIdTrimmed);
      setLandingFocusListId(listIdTrimmed);
      await openEditor(data);
    } finally {
      setStartingListId(null);
    }
  };

  const applyParGuideSelection = async (guideId: string) => {
    if (!activeSession?.id || !currentRestaurantId) return;
    await persistSessionCountingParGuide(activeSession.id, guideId);
    setCountingParGuideId(guideId);
    setActiveSession((session) =>
      session ? { ...session, counting_par_guide_id: guideId } : session,
    );
    await hydrateCountingParMaps(guideId);
    setParColumnVisible(true);
    setParGuidePickerOpen(false);
    toast.success("PAR guide applied for this count");
  };

  const handleAddItem = async () => {
    if (!activeSession || sessionLocked(activeSession.status)) return;

    const payload = {
      session_id: activeSession.id,
      item_name: newItem.item_name,
      category: newItem.category,
      unit: newItem.unit,
      current_stock: newItem.current_stock,
      par_level: approvedParMap[normalizeItemName(newItem.item_name)] ?? 0,
      unit_cost: newItem.unit_cost || null,
    };

    const { data, error } = (await supabase
      .from("inventory_session_items")
      .insert(payload)
      .select()
      .single()) as unknown as {
      data: InventorySessionItemRow | null;
      error: { message: string } | null;
    };

    if (error || !data) {
      toast.error(error?.message ?? "Could not add item.");
      return;
    }

    setItemOrder((previous) => [...previous, data.id]);
    setItemById((previous) => ({ ...previous, [data.id]: data }));
    setNewItem({ item_name: "", category: DEFAULT_CATEGORIES[1], unit: "", current_stock: 0, unit_cost: 0 });
    setCreateOpen(false);
  };

  const handleAddFromCatalog = async (catalogItem: InventoryCatalogItemRow) => {
    if (!activeSession || sessionLocked(activeSession.status)) return;

    const payload = {
      session_id: activeSession.id,
      catalog_item_id: catalogItem.id,
      item_name: catalogItem.item_name,
      category: catalogItem.category || DEFAULT_CATEGORIES[0],
      unit: catalogItem.unit || "",
      current_stock: 0,
      par_level:
        approvedParMap[normalizeItemName(catalogItem.item_name)] ??
        catalogItem.default_par_level ??
        0,
      unit_cost: catalogItem.default_unit_cost || 0,
      vendor_sku: catalogItem.product_number || catalogItem.vendor_sku || null,
      pack_size: catalogItem.pack_size || null,
      vendor_name: catalogItem.vendor_name || null,
      brand_name: catalogItem.brand_name || null,
    };

    let { data, error } = (await supabase
      .from("inventory_session_items")
      .insert(payload)
      .select()
      .single()) as unknown as {
      data: InventorySessionItemRow | null;
      error: { message: string } | null;
    };

    if (error && isInventorySessionItemsCatalogIdSchemaError(error.message)) {
      const { catalog_item_id: _omitted, ...legacyPayload } = payload;
      ({ data, error } = (await supabase
        .from("inventory_session_items")
        .insert(legacyPayload)
        .select()
        .single()) as unknown as {
        data: InventorySessionItemRow | null;
        error: { message: string } | null;
      });
    }

    if (error || !data) {
      toast.error(error?.message ?? "Could not add from catalog.");
      return;
    }

    setItemOrder((previous) => [...previous, data.id]);
    setItemById((previous) => ({ ...previous, [data.id]: data }));
    toast.success(`Added ${catalogItem.item_name}`);
  };

  const handleClearRow = async (id: string) => {
    if (sessionLocked(activeSession?.status)) return;
    setItemById((previous) => {
      const row = previous[id];
      if (!row) return previous;
      return { ...previous, [id]: { ...row, current_stock: null } };
    });
    setSavingId(id);
    const { error } = await supabase
      .from("inventory_session_items")
      .update({ current_stock: null })
      .eq("id", id);
    setSavingId(null);
    if (error) toast.error("Could not clear");
    else markSaved(id);
  };

  const handleSavePrice = async (id: string, cost: number | null) => {
    if (sessionLocked(activeSession?.status)) return;
    setSavingId(id);
    const { error } = await supabase
      .from("inventory_session_items")
      .update({ unit_cost: cost })
      .eq("id", id);
    setSavingId(null);
    if (error) toast.error("Could not save price");
    else markSaved(id);
  };

  const handleSaveStock = async (id: string, stockVal: number | null) => {
    if (sessionLocked(activeSession?.status)) return;
    setSavingId(id);
    const { error } = await supabase
      .from("inventory_session_items")
      .update({ current_stock: stockVal ?? null })
      .eq("id", id);
    setSavingId(null);
    if (error) {
      toast.error("Could not save — tap to retry");
    } else {
      markSaved(id);
    }
  };

  const handleSubmitForReview = async () => {
    if (!activeSession || activeSession.status !== "IN_PROGRESS") return;
    const result = await submitInventorySessionForReview({
      supabase,
      sessionId: activeSession.id,
    });
    if (!result.ok) {
      toast.error(result.errorMessage);
      return;
    }

    toast.success("Submitted for review!");
    sessionStorage.removeItem("inv_active_session");
    setActiveSession(null);
    setItemOrder([]);
    setItemById({});
    void refreshSessions();
  };

  const handleDeleteSession = async (deleteSessionId: string | null) => {
    if (!deleteSessionId) return;
    await supabase.from("inventory_session_items").delete().eq("session_id", deleteSessionId);
    const { error } = await supabase
      .from("inventory_sessions")
      .delete()
      .eq("id", deleteSessionId);
    if (error) {
      toast.error(error.message);
      return;
    }

    toast.success("Session deleted");
    sessionStorage.removeItem("inv_active_session");
    if (activeSession?.id === deleteSessionId) {
      setActiveSession(null);
      setItemOrder([]);
      setItemById({});
    }
    void refreshSessions();
  };

  const handleClearInProgressSession = async (
    clearInProgressSessionId: string | null,
  ) => {
    if (!clearInProgressSessionId) return;
    await supabase
      .from("inventory_session_items")
      .delete()
      .eq("session_id", clearInProgressSessionId);
    const { error } = await supabase
      .from("inventory_sessions")
      .delete()
      .eq("id", clearInProgressSessionId);
    if (error) {
      toast.error(error.message);
      return;
    }

    toast.success("Cleared — start a fresh count when you're ready");
    sessionStorage.removeItem("inv_active_session");
    if (activeSession?.id === clearInProgressSessionId) {
      setActiveSession(null);
      setItemOrder([]);
      setItemById({});
    }
    void refreshSessions();
  };

  const handleClearEntries = async (clearEntriesSessionId: string | null) => {
    if (!clearEntriesSessionId) return;
    const { error } = await supabase
      .from("inventory_session_items")
      .update({ current_stock: null })
      .eq("session_id", clearEntriesSessionId);
    if (error) {
      toast.error(error.message);
      return;
    }

    toast.success("Entries cleared — ready for recount");
    if (activeSession?.id === clearEntriesSessionId) {
      setItemById((previous) => {
        const next = { ...previous };
        for (const id of Object.keys(next)) {
          next[id] = { ...next[id], current_stock: null };
        }
        return next;
      });
    }
  };

  const buildOwnerManagerRecipientIds = async (): Promise<string[]> => {
    if (!currentRestaurantId) return [];
    const { data: members } = (await supabase
      .from("restaurant_members")
      .select("user_id, role")
      .eq("restaurant_id", currentRestaurantId)) as unknown as {
      data: Array<Pick<NotificationMemberRow, "user_id" | "role">> | null;
    };
    const ids = (members ?? [])
      .filter((member) => member.role === "OWNER" || member.role === "MANAGER")
      .map((member) => member.user_id);
    return [...new Set(ids)];
  };

  const resolveParGuideIdForManagerEdits = async (): Promise<string | null> => {
    if (countingParGuideId) return countingParGuideId;
    const listId = activeSession?.inventory_list_id;
    if (!listId || !currentRestaurantId) return null;
    const { data } = (await supabase
      .from("par_guides")
      .select("id")
      .eq("restaurant_id", currentRestaurantId)
      .eq("inventory_list_id", listId)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle()) as unknown as {
      data: Pick<ParGuideRow, "id"> | null;
    };
    return data?.id ?? null;
  };

  const handleApprove = async (sessionId: string) => {
    if (!currentRestaurantId || !userId) return;
    if (isApprovingRef.current) return;
    isApprovingRef.current = true;

    try {
      const result = await approveInventorySession({
        supabase,
        sessionId,
        restaurantId: currentRestaurantId,
        userId,
        riskThresholds,
      });

      if (!result.ok) {
        toast.error(result.errorMessage);
        return;
      }

      if (result.smartOrderErrorMessage) {
        toast.error(result.smartOrderErrorMessage);
      }
      if (result.smartOrderRunId) {
        toast.success("Session approved", {
          description: "Smart order draft created.",
          action: {
            label: "Open Smart Order",
            onClick: () => navigateTo(`/app/smart-order?viewRun=${result.smartOrderRunId}`),
          },
        });
      } else {
        toast.success("Session approved!");
      }
      if (result.catalogLinksStripped) {
        toast.info("Saved order lines; some catalog links were cleared due to invalid references.");
      }
      await refreshSessions();
    } finally {
      isApprovingRef.current = false;
    }
  };

  const handleReject = async (sessionId: string) => {
    const result = await sendInventorySessionBackToInProgress({
      supabase,
      sessionId,
    });
    if (!result.ok) toast.error(result.errorMessage);
    else {
      toast.success("Session sent back");
      await refreshSessions();
    }
  };

  const handleDeclineToReview = async (sessionId: string) => {
    const result = await moveApprovedInventorySessionToReview({
      supabase,
      sessionId,
    });
    if (!result.ok) toast.error(result.errorMessage);
    else {
      toast.success("Session moved back to Review");
      await refreshSessions();
    }
  };

  const handleDuplicate = async (session: InventorySessionListRow) => {
    if (!currentRestaurantId || !userId) return;
    const result = await duplicateInventorySession({
      supabase,
      restaurantId: currentRestaurantId,
      sourceSession: session,
      userId,
      fallbackLocationId: currentLocation?.id ?? null,
    });
    if (!result.ok || !result.data) {
      toast.error(result.errorMessage ?? "Could not duplicate session.");
      return;
    }
    toast.success("Session duplicated");
    await refreshSessions();
  };

  const openSmartOrderModal = async (session: InventorySessionListRow) => {
    setSmartOrderSession(session);
    await loadSmartOrderParGuides(session.inventory_list_id);
  };

  const handleCreateSmartOrder = async () => {
    if (!smartOrderSession || !smartOrderSelectedPar || !currentRestaurantId || !userId) return;
    setSmartOrderCreating(true);

    const result = await createSmartOrderFromSession({
      supabase,
      sessionId: smartOrderSession.id,
      restaurantId: currentRestaurantId,
      userId,
      riskThresholds,
      parGuideId: smartOrderSelectedPar,
      mode: "manual",
    });

    setSmartOrderCreating(false);
    if (!result.runId) {
      toast.error(result.errorMessage ?? "Could not create smart order.");
      return;
    }

    if (result.catalogLinksStripped) {
      toast.info("Saved order lines; some catalog links were cleared due to invalid references.");
    }
    toast.success("Smart order created — submit from Smart Order to generate the purchase order.");
    setSmartOrderSession(null);
    navigateTo(`/app/smart-order?viewRun=${result.runId}`);
  };

  const handleSaveEditItemDetails = async () => {
    if (!editItemDetailsSessionItem || !currentRestaurantId) return;
    const trimmed = (editItemDetailsForm.item_name || "").trim();
    if (!trimmed) {
      toast.error("Item name is required");
      return;
    }

    setEditItemDetailsSaving(true);
    const unit = editItemDetailsForm.unit || null;
    const packSize = editItemDetailsForm.pack_size || null;

    const { error: sessionError } = await supabase
      .from("inventory_session_items")
      .update({ item_name: trimmed, unit, pack_size: packSize })
      .eq("id", editItemDetailsSessionItem.id);
    if (sessionError) {
      toast.error(sessionError.message);
      setEditItemDetailsSaving(false);
      return;
    }

    if (editItemDetailsSessionItem.catalog_item_id) {
      const { error: catalogError } = await supabase
        .from("inventory_catalog_items")
        .update({
          item_name: trimmed,
          unit,
          pack_size: packSize,
          updated_at: new Date().toISOString(),
        })
        .eq("id", editItemDetailsSessionItem.catalog_item_id);
      if (catalogError) {
        toast.error(catalogError.message);
        setEditItemDetailsSaving(false);
        return;
      }

      setCatalogItems((previous) =>
        previous.map((item) =>
          item.id === editItemDetailsSessionItem.catalog_item_id
            ? { ...item, item_name: trimmed, unit, pack_size: packSize }
            : item,
        ),
      );
    }

    setItemById((previous) => {
      const row = previous[editItemDetailsSessionItem.id];
      if (!row) return previous;
      return {
        ...previous,
        [editItemDetailsSessionItem.id]: {
          ...row,
          item_name: trimmed,
          unit,
          pack_size: packSize,
        },
      };
    });

    if (countingParGuideId) {
      await hydrateCountingParMaps(countingParGuideId);
    }

    toast.success("Item details updated");
    setEditItemDetailsSessionItem(null);
    setEditItemDetailsSaving(false);
  };

  const handleStaffParChangeRequestSubmit = async () => {
    if (!staffParRequestItem || !userId || !currentRestaurantId || !activeSession?.id) return;
    const suggested = parseFloat(staffParSuggested);
    if (!Number.isFinite(suggested) || suggested < 0) {
      toast.error("Enter a valid suggested PAR");
      return;
    }

    setStaffParSending(true);
    const recipientIds = await buildOwnerManagerRecipientIds();
    if (recipientIds.length === 0) {
      toast.error("No managers or owners found to notify");
      setStaffParSending(false);
      return;
    }

    const { data: profile } = (await supabase
      .from("profiles")
      .select("full_name, email")
      .eq("id", userId)
      .maybeSingle()) as unknown as {
      data: Pick<ProfileRow, "full_name" | "email"> | null;
    };
    const staffName = profile?.full_name || profile?.email || "A team member";
    const currentPar = getApprovedPar(staffParRequestItem);
    const reasonText = staffParReason.trim() || "—";

    const notifications = recipientIds.map((recipientId) => ({
      restaurant_id: currentRestaurantId,
      user_id: recipientId,
      type: "PAR_CHANGE_REQUEST",
      title: "PAR change requested",
      message: `${staffName} suggested changing ${staffParRequestItem.item_name} PAR from ${currentPar} to ${suggested}. Reason: ${reasonText}`,
      severity: "INFO" as const,
      data: {
        item_name: staffParRequestItem.item_name,
        current_par: currentPar,
        suggested_par: suggested,
        reason: staffParReason.trim() || null,
        session_id: activeSession.id,
        requested_by: userId,
      } as Record<string, unknown>,
    }));

    const { error } = await supabase.from("notifications").insert(notifications);
    setStaffParSending(false);
    if (error) {
      toast.error(error.message);
      return;
    }

    toast.success("PAR change request sent to your manager");
    setStaffParRequestItem(null);
  };

  const handleStaffPriceChangeRequestSubmit = async () => {
    if (!staffPriceRequestItem || !userId || !currentRestaurantId || !activeSession?.id) return;
    const suggested = parseFloat(staffPriceSuggested);
    if (!Number.isFinite(suggested) || suggested < 0) {
      toast.error("Enter a valid suggested price");
      return;
    }

    setStaffPriceSending(true);
    const recipientIds = await buildOwnerManagerRecipientIds();
    if (recipientIds.length === 0) {
      toast.error("No managers or owners found to notify");
      setStaffPriceSending(false);
      return;
    }

    const { data: profile } = (await supabase
      .from("profiles")
      .select("full_name, email")
      .eq("id", userId)
      .maybeSingle()) as unknown as {
      data: Pick<ProfileRow, "full_name" | "email"> | null;
    };
    const staffName = profile?.full_name || profile?.email || "A team member";
    const sessionPrice = staffPriceRequestItem.unit_cost;
    const currentPrice =
      sessionPrice != null && Number.isFinite(Number(sessionPrice))
        ? Number(sessionPrice)
        : getCatalogUnitCost(staffPriceRequestItem.catalog_item_id);
    const currentLabel = currentPrice != null ? `$${currentPrice.toFixed(2)}` : "—";
    const reasonText = staffPriceReason.trim() || "—";

    const notifications = recipientIds.map((recipientId) => ({
      restaurant_id: currentRestaurantId,
      user_id: recipientId,
      type: "PRICE_CHANGE_REQUEST",
      title: "Price change requested",
      message: `${staffName} suggested changing ${staffPriceRequestItem.item_name} unit price from ${currentLabel} to $${suggested.toFixed(2)}. Reason: ${reasonText}`,
      severity: "INFO" as const,
      data: {
        item_name: staffPriceRequestItem.item_name,
        current_price: currentPrice,
        suggested_price: suggested,
        reason: staffPriceReason.trim() || null,
        session_id: activeSession.id,
        requested_by: userId,
      } as Record<string, unknown>,
    }));

    const { error } = await supabase.from("notifications").insert(notifications);
    setStaffPriceSending(false);
    if (error) {
      toast.error(error.message);
      return;
    }

    toast.success("Price change request sent to your manager");
    setStaffPriceRequestItem(null);
  };

  const handleManagerParLevelSave = async () => {
    if (!managerParEditItem || !currentRestaurantId) return;
    const nextPar = parseFloat(managerParInput);
    if (!Number.isFinite(nextPar) || nextPar < 0) {
      toast.error("Enter a valid PAR level");
      return;
    }

    setManagerParSaving(true);
    const guideId = await resolveParGuideIdForManagerEdits();
    if (!guideId) {
      toast.error("No PAR guide linked to this list");
      setManagerParSaving(false);
      return;
    }

    const { data: guideRows } = (await supabase
      .from("par_guide_items")
      .select("id, item_name, catalog_item_id")
      .eq("par_guide_id", guideId)) as unknown as {
      data: Array<Pick<ParGuideItemRow, "id" | "item_name" | "catalog_item_id">> | null;
    };
    const key = normalizeItemName(managerParEditItem.item_name);
    const match =
      (managerParEditItem.catalog_item_id
        ? (guideRows ?? []).find((row) => row.catalog_item_id === managerParEditItem.catalog_item_id)
        : undefined) ??
      (guideRows ?? []).find((row) => normalizeItemName(row.item_name) === key);
    if (!match) {
      toast.error("No PAR line for this item in the linked guide");
      setManagerParSaving(false);
      return;
    }

    const { error: guideError } = await supabase
      .from("par_guide_items")
      .update({
        par_level: nextPar,
        ...(managerParEditItem.catalog_item_id
          ? { catalog_item_id: managerParEditItem.catalog_item_id }
          : {}),
      })
      .eq("id", match.id);
    if (guideError) {
      toast.error(guideError.message);
      setManagerParSaving(false);
      return;
    }

    if (managerParEditItem.catalog_item_id) {
      const { error: catalogError } = await supabase
        .from("inventory_catalog_items")
        .update({ default_par_level: nextPar, updated_at: new Date().toISOString() })
        .eq("id", managerParEditItem.catalog_item_id);
      if (catalogError) {
        toast.error(catalogError.message);
        setManagerParSaving(false);
        return;
      }

      setCatalogItems((previous) =>
        previous.map((item) =>
          item.id === managerParEditItem.catalog_item_id
            ? { ...item, default_par_level: nextPar }
            : item,
        ),
      );
    }

    if (countingParGuideId === guideId) {
      await hydrateCountingParMaps(countingParGuideId);
    }

    toast.success("PAR level updated");
    setManagerParEditItem(null);
    setManagerParSaving(false);
  };

  const handleManagerPriceSave = async () => {
    if (!managerPriceEditItem) return;
    const price = managerPriceInput === "" ? null : parseFloat(managerPriceInput);
    if (price != null && (!Number.isFinite(price) || price < 0)) {
      toast.error("Enter a valid price");
      return;
    }

    setManagerPriceSaving(true);
    const { error: sessionError } = await supabase
      .from("inventory_session_items")
      .update({ unit_cost: price })
      .eq("id", managerPriceEditItem.id);
    if (sessionError) {
      toast.error(sessionError.message);
      setManagerPriceSaving(false);
      return;
    }

    if (managerPriceEditItem.catalog_item_id) {
      const { error: catalogError } = await supabase
        .from("inventory_catalog_items")
        .update({ default_unit_cost: price, updated_at: new Date().toISOString() })
        .eq("id", managerPriceEditItem.catalog_item_id);
      if (catalogError) {
        toast.error(catalogError.message);
        setManagerPriceSaving(false);
        return;
      }

      setCatalogItems((previous) =>
        previous.map((item) =>
          item.id === managerPriceEditItem.catalog_item_id
            ? { ...item, default_unit_cost: price }
            : item,
        ),
      );
    }

    setItemById((previous) => {
      const row = previous[managerPriceEditItem.id];
      if (!row) return previous;
      return { ...previous, [managerPriceEditItem.id]: { ...row, unit_cost: price } };
    });

    toast.success("Price updated");
    setManagerPriceEditItem(null);
    setManagerPriceSaving(false);
  };

  return {
    startingListId,
    savingId,
    savedId,
    smartOrderCreating,
    editItemDetailsSaving,
    staffParSending,
    staffPriceSending,
    managerParSaving,
    managerPriceSaving,
    openEditor,
    createSessionForList,
    applyParGuideSelection,
    handleAddItem,
    handleAddFromCatalog,
    handleClearRow,
    handleSavePrice,
    handleSaveStock,
    handleSubmitForReview,
    handleDeleteSession,
    handleClearInProgressSession,
    handleClearEntries,
    handleApprove,
    handleReject,
    handleDeclineToReview,
    handleDuplicate,
    openSmartOrderModal,
    handleCreateSmartOrder,
    handleSaveEditItemDetails,
    handleStaffParChangeRequestSubmit,
    handleStaffPriceChangeRequestSubmit,
    handleManagerParLevelSave,
    handleManagerPriceSave,
  };
}
