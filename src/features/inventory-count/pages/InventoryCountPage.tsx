import { useEffect, useState, useCallback, useMemo } from "react";
import { format } from "date-fns";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { useRestaurant } from "@/contexts/RestaurantContext";
import { useAuth } from "@/contexts/AuthContext";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { useIsCompact } from "@/hooks/use-mobile";
import { useOnlineStatus } from "@/hooks/use-online-status";
import { useLocationPermissions } from "@/hooks/useLocationPermissions";
import { useCategoryMapping } from "@/hooks/useCategoryMapping";
import { useLastOrderDates } from "@/hooks/useLastOrderDates";
import { useInventoryCountActions } from "@/features/inventory-count/commands/useInventoryCountActions";
import { useSessionEditor } from "@/features/inventory-count/hooks/useSessionEditor";
import { useInventoryCountData } from "@/features/inventory-count/hooks/useInventoryCountData";
import { InventorySessionEditor } from "@/features/inventory-count/components/InventorySessionEditor";
import { InventoryHubHeader } from "@/features/inventory-count/components/InventoryHubHeader";
import { InventoryHubSessions } from "@/features/inventory-count/components/InventoryHubSessions";
import { InventoryCountHubApprovedSection } from "@/features/inventory-count/components/InventoryCountHubApprovedSection";
import { InventoryCountHubModals } from "@/features/inventory-count/components/InventoryCountHubModals";
import { InventoryCountHubReviewSection } from "@/features/inventory-count/components/InventoryCountHubReviewSection";
import { parseInputValue } from "@/lib/inventory-utils";
import { normalizeSessionItemForUi } from "@/domain/inventory/display/sessionItemStockUi";
import {
  buildCatalogDefaultParById,
  buildCatalogDefaultParByName,
  buildCatalogLookup,
  buildInventoryView,
  buildLandingFocus,
  buildSubmitSummary,
  findNextSchedule,
  formatLastOrdered as formatLastOrderedHelper,
  getApprovedPar as getApprovedParHelper,
  getCatalogUnitCost as getCatalogUnitCostHelper,
  getItemCategory as getItemCategoryHelper,
  getProductNumber as getProductNumberHelper,
} from "@/domain/inventory/enterInventoryHelpers";
import type {
  InventoryCatalogItemRow,
  InventorySessionItemRow,
  InventorySessionListRow,
} from "@/domain/inventory/enterInventoryTypes";
import type { SaveStockWithConversionPayload } from "@/features/inventory-count/hooks/useItemCommands";

export default function InventoryCountPage() {
  const { currentRestaurant, locations, currentLocation } = useRestaurant();
  const { user } = useAuth();
  const restaurantRole = (currentRestaurant?.role || "").toUpperCase();
  const isManagerOrOwner = restaurantRole === "MANAGER" || restaurantRole === "OWNER";
  const isStaffMenu = !isManagerOrOwner;
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const isCompact = useIsCompact();
  const networkOnline = useOnlineStatus();
  const locationPerms = useLocationPermissions();
  const { lastOrderDates, lastOrderDatesByItemName } = useLastOrderDates(currentRestaurant?.id, currentLocation?.id);

  // ── Page-level state (not owned by session editor) ──────────────────────
  const [selectedList, setSelectedList] = useState("");
  const [landingFocusListId, setLandingFocusListId] = useState<string | null>(null);
  const [approvedFilter, setApprovedFilter] = useState("30");
  const [selectedPar, setSelectedPar] = useState("");
  const [viewToggle] = useState<"table" | "compact">("table");
  const [, setCounterTick] = useState(0);
  const [approvedParMap] = useState<Record<string, number>>({});

  // ── Session editor state ─────────────────────────────────────────────────
  const editor = useSessionEditor({ isStaffMenu });
  const {
    activeSession, setActiveSession,
    items, setItemById, setItemOrder,
    staffCountingFocus,
    search, filterCategory, showOnlyEmpty, statusFilter,
    categoryMode, sortMode, setCategoryMode, setSortMode,
    lastEditedId, setLastEditedId,
    submitConfirmOpen,
    parColumnVisible, setParColumnVisible,
    parGuidePickerOpen, setParGuidePickerOpen,
    countingParGuideId, setCountingParGuideId,
    inputRefs, sessionListWidthRef, sessionListWidth, categoryVirtualListRefs,
    editItemDetailsSessionItem, editItemDetailsForm,
    staffParRequestItem, staffParSuggested, staffParReason,
    staffPriceRequestItem, staffPriceSuggested, staffPriceReason,
    managerParEditItem, managerParInput,
    managerPriceEditItem, managerPriceInput,
    createOpen, setCreateOpen,
    catalogOpen, newItem, setNewItem,
    smartOrderSession, smartOrderSelectedPar, setSmartOrderSelectedPar,
    clearEntriesSessionId, setClearEntriesSessionId,
    clearInProgressSessionId, setClearInProgressSessionId,
    deleteSessionId, setDeleteSessionId,
    newCountNameDialogOpen, newCountNameInput,
    setPendingNewCountListId, setNewCountNameInput,
    onSessionClosed, clearAllItemEntries,
  } = editor;

  // ── Data hook ────────────────────────────────────────────────────────────
  const {
    lists, loading, sessionsLoaded, listSelectorMeta,
    inProgressSessions, reviewSessions, approvedSessions,
    sessionStats, riskThresholds, catalogItems, parGuides, parItems,
    schedules, smartOrderParGuides, parGuidesPickerOptions,
    countingParGuideName, countingParByCatalogId, countingParByNormalizedName,
    setCatalogItems, refreshSessions,
    loadCatalogItemsForList, loadLatestParGuide, loadParGuideItems,
    loadEditorSnapshot, reloadSessionItems, hydrateCountingParMaps,
    loadParGuidePickerOptions, loadSmartOrderParGuides,
  } = useInventoryCountData({
    currentRestaurantId: currentRestaurant?.id,
    currentLocationId: currentLocation?.id,
    approvedFilter,
    selectedList,
    selectedPar,
    setSelectedPar,
  });

  // ── Effects ──────────────────────────────────────────────────────────────
  const requestedListId = useMemo(() => {
    const state = (location.state as { list_id?: string; listId?: string } | null) || null;
    return searchParams.get("list_id") || searchParams.get("listId") || state?.list_id || state?.listId || "";
  }, [location.state, searchParams]);

  useEffect(() => {
    if (!currentRestaurant) return;
    setSelectedList("");
    setLandingFocusListId(null);
  }, [currentRestaurant]);

  useEffect(() => {
    if (!currentRestaurant || !sessionsLoaded || lists.length === 0) return;
    if (requestedListId && lists.some((l) => l.id === requestedListId)) {
      setLandingFocusListId(requestedListId);
      setSelectedList(requestedListId);
      return;
    }
    setLandingFocusListId((prev) => {
      if (prev && lists.some((l) => l.id === prev)) return prev;
      const allSessions = [...inProgressSessions, ...reviewSessions, ...approvedSessions];
      let bestListId: string | null = null;
      let bestTime = -1;
      for (const s of allSessions) {
        const t = new Date(s.updated_at || s.approved_at || 0).getTime();
        if (t >= bestTime && s.inventory_list_id) { bestTime = t; bestListId = s.inventory_list_id; }
      }
      return bestListId || lists[0]?.id || null;
    });
  }, [currentRestaurant, sessionsLoaded, lists, requestedListId, inProgressSessions, reviewSessions, approvedSessions]);

  useEffect(() => {
    if (landingFocusListId && !activeSession) setSelectedList(landingFocusListId);
  }, [landingFocusListId, activeSession]);

  useEffect(() => {
    const timer = setInterval(() => setCounterTick((t) => t + 1), 60000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    const savedId = sessionStorage.getItem("inv_active_session");
    if (!savedId || activeSession) return;
    const found = inProgressSessions.find((s) => s.id === savedId);
    if (found) {
      void openEditor(found);
      toast.info(`Count session restored: "${found.name || "Untitled"}". Your progress was saved.`);
    } else {
      sessionStorage.removeItem("inv_active_session");
    }
  }, [inProgressSessions, activeSession]);

  useEffect(() => {
    if (!countingParGuideId || !activeSession?.inventory_list_id || !currentRestaurant?.id) return;
    let cancelled = false;
    void (async () => { if (!cancelled) await hydrateCountingParMaps(countingParGuideId); })();
    return () => { cancelled = true; };
  }, [countingParGuideId, activeSession?.id, activeSession?.inventory_list_id, currentRestaurant?.id, items.length]);

  // ── Derived / computed ───────────────────────────────────────────────────
  const catalogLookup = useMemo(() => buildCatalogLookup(catalogItems), [catalogItems]);
  const catalogDefaultParById = useMemo(() => buildCatalogDefaultParById(catalogItems), [catalogItems]);
  const catalogDefaultParByName = useMemo(() => buildCatalogDefaultParByName(catalogItems), [catalogItems]);

  const getApprovedPar = useCallback(
    (item: Parameters<typeof getApprovedParHelper>[0]) =>
      getApprovedParHelper(item, {
        countingParGuideId, countingParByCatalogId, countingParByNormalizedName,
        approvedParMap, catalogDefaultParById, catalogDefaultParByName,
      }),
    [countingParGuideId, countingParByCatalogId, countingParByNormalizedName, approvedParMap, catalogDefaultParById, catalogDefaultParByName],
  );

  const getCatalogUnitCost = useCallback(
    (catalogItemId: string | null | undefined) => getCatalogUnitCostHelper(catalogItems, catalogItemId),
    [catalogItems],
  );

  const mappingMode = categoryMode === "list_order" ? "list_order"
    : categoryMode === "custom-categories" ? "custom-categories"
    : categoryMode === "my-categories" ? "my-categories"
    : categoryMode === "recently_purchased" ? "recently_purchased"
    : null;

  const { categories: mappedCategories, categoryMapping, hasMappings } = useCategoryMapping(
    activeSession?.inventory_list_id || selectedList || null,
    mappingMode,
  );

  const getItemCategory = useCallback(
    (item: InventorySessionItemRow) =>
      getItemCategoryHelper({ item, categoryMode, hasMappings, categoryMapping }),
    [categoryMode, hasMappings, categoryMapping],
  );

  const getProductNumber = useCallback(
    (item: Parameters<typeof getProductNumberHelper>[0]) => getProductNumberHelper(item, catalogLookup),
    [catalogLookup],
  );

  const getLastOrderDate = useCallback(
    (itemName: string): string | null => {
      const cat = catalogLookup[itemName];
      if (cat?.id && lastOrderDates[cat.id]) return lastOrderDates[cat.id];
      const key = itemName?.trim().toLowerCase();
      if (key && lastOrderDatesByItemName[key]) return lastOrderDatesByItemName[key];
      return null;
    },
    [catalogLookup, lastOrderDates, lastOrderDatesByItemName],
  );

  const { filteredItems, globalIndexByItemId, groupedItems, sortedCategoryKeys } = useMemo(
    () => buildInventoryView({
      items, filterCategory, search, showOnlyEmpty, statusFilter, categoryMode,
      inventorySortMode: sortMode,
      hasMappings, mappedCategories, categoryMapping,
      approvedParArgs: { countingParGuideId, countingParByCatalogId, countingParByNormalizedName, approvedParMap, catalogDefaultParById, catalogDefaultParByName },
      riskThresholds,
    }),
    [items, filterCategory, search, showOnlyEmpty, statusFilter, categoryMode, sortMode, hasMappings, mappedCategories, categoryMapping, countingParGuideId, countingParByCatalogId, countingParByNormalizedName, approvedParMap, catalogDefaultParById, catalogDefaultParByName, riskThresholds],
  );

  // Unfiltered keys so the category filter dropdown always shows all options.
  const { sortedCategoryKeys: allCategoryKeys } = useMemo(
    () => buildInventoryView({
      items, filterCategory: "all", search: "", showOnlyEmpty: false, statusFilter: "all", categoryMode,
      inventorySortMode: sortMode,
      hasMappings, mappedCategories, categoryMapping,
      approvedParArgs: { countingParGuideId, countingParByCatalogId, countingParByNormalizedName, approvedParMap, catalogDefaultParById, catalogDefaultParByName },
      riskThresholds,
    }),
    [items, categoryMode, sortMode, hasMappings, mappedCategories, categoryMapping, countingParGuideId, countingParByCatalogId, countingParByNormalizedName, approvedParMap, catalogDefaultParById, catalogDefaultParByName, riskThresholds],
  );

  // Counted = current_stock entered AND > 0. Matches per-category header logic so
  // the top-level progress and category headers always agree. (Seeded items default to 0.)
  const countedItems = items.filter(
    (i) => i.current_stock != null && Number(i.current_stock) > 0,
  ).length;
  const totalItems = items.length;
  const progressPct = totalItems > 0 ? Math.round((countedItems / totalItems) * 100) : 0;

  const submitSummary = useMemo(
    () => buildSubmitSummary(items, { countingParGuideId, countingParByCatalogId, countingParByNormalizedName, approvedParMap, catalogDefaultParById, catalogDefaultParByName }, riskThresholds),
    [items, countingParGuideId, countingParByCatalogId, countingParByNormalizedName, approvedParMap, catalogDefaultParById, catalogDefaultParByName, riskThresholds],
  );

  const nextSchedule = useMemo(() => findNextSchedule(schedules), [schedules]);

  const landingFocus = useMemo(
    () => buildLandingFocus({ lists, landingFocusListId, inProgressSessions, reviewSessions, sessionStats, listSelectorMeta }),
    [lists, landingFocusListId, inProgressSessions, reviewSessions, sessionStats, listSelectorMeta],
  );

  // Only block when there are multiple locations and the owner hasn't selected one yet.
  // Single-location (or zero-location) accounts should not be blocked — sessions
  // are created with a null location_id which is valid.
  const blockCountWithoutLocation = !!currentRestaurant && !currentLocation && locations.length > 1;

  const currentListId = activeSession?.inventory_list_id || selectedList || "";
  const selectedListName = lists.find((l) => l.id === currentListId)?.name || "";

  // ── Actions ──────────────────────────────────────────────────────────────
  const {
    startingListId, submittingForReview, savingId, savedId, smartOrderCreating,
    editItemDetailsSaving, staffParSending, staffPriceSending, managerParSaving, managerPriceSaving,
    openEditor: openEditorAction,
    createSessionForList: createSessionForListAction,
    applyParGuideSelection: applyParGuideSelectionAction,
    handleAddItem: handleAddItemAction,
    handleAddFromCatalog: handleAddFromCatalogAction,
    handleClearRow: handleClearRowAction,
    handleSavePrice: handleSavePriceAction,
    handleSaveStock: handleSaveStockAction,
    handleSaveStockWithConversion: handleSaveStockWithConversionAction,
    handleSubmitForReview: handleSubmitForReviewAction,
    handleDeleteSession: handleDeleteSessionAction,
    handleClearInProgressSession: handleClearInProgressSessionAction,
    handleClearEntries: handleClearEntriesAction,
    handleApprove: handleApproveAction,
    handleReject: handleRejectAction,
    handleDeclineToReview: handleDeclineToReviewAction,
    handleDuplicate: handleDuplicateAction,
    openSmartOrderModal: openSmartOrderModalAction,
    handleCreateSmartOrder: handleCreateSmartOrderAction,
    handleSaveEditItemDetails: handleSaveEditItemDetailsAction,
    handleStaffParChangeRequestSubmit: handleStaffParChangeRequestSubmitAction,
    handleStaffPriceChangeRequestSubmit: handleStaffPriceChangeRequestSubmitAction,
    handleManagerParLevelSave: handleManagerParLevelSaveAction,
    handleManagerPriceSave: handleManagerPriceSaveAction,
    upsertZoneCountForItem: upsertZoneCountForItemAction,
  } = useInventoryCountActions({
    currentRestaurantId: currentRestaurant?.id,
    userId: user?.id,
    activeSession,
    itemById: editor.itemById,
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
    navigateTo: navigate,
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
    setSmartOrderSession: editor.setSmartOrderSession,
    setCatalogItems,
    setEditItemDetailsSessionItem: editor.setEditItemDetailsSessionItem,
    setStaffParRequestItem: editor.setStaffParRequestItem,
    setStaffPriceRequestItem: editor.setStaffPriceRequestItem,
    setManagerParEditItem: editor.setManagerParEditItem,
    setManagerPriceEditItem: editor.setManagerPriceEditItem,
  });

  // Only warn on actual page-unload (tab close / hard reload) when an in-progress
  // count edit has not been flushed to the server. React Router navigation does
  // NOT fire beforeunload, so SPA sidebar clicks no longer surface a dialog.
  // `lastEditedId` is cleared by handleSaveStock/handleSavePrice once the write
  // round-trips, so this flips back to "clean" after every successful save.
  useEffect(() => {
    if (!activeSession) return;
    const hasUnsavedEdits = !!lastEditedId && !!savingId;
    if (!hasUnsavedEdits) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [activeSession, lastEditedId, savingId]);

  const zoneCount = useMemo(
    () => ({
      hasZoneSections: hasMappings && mappedCategories.length > 0,
      categoryMapping,
      catalogById: Object.fromEntries(catalogItems.map((c) => [c.id, c])) as Record<string, InventoryCatalogItemRow>,
      upsertZoneCountForItem: upsertZoneCountForItemAction,
    }),
    [hasMappings, mappedCategories, categoryMapping, catalogItems, upsertZoneCountForItemAction],
  );

  // ── Handlers ─────────────────────────────────────────────────────────────
  const openEditor = async (session: InventorySessionListRow) => openEditorAction(session);

  const buildDefaultCountSessionName = (listName: string) =>
    `${(listName.trim() || "Inventory")} Count ${format(new Date(), "MMM d, yyyy")}`;

  const openNewCountSessionNameDialog = (listId: string, listNameOverride?: string | null) => {
    const id = listId.trim();
    if (!id) return;
    const listName = (listNameOverride && String(listNameOverride).trim()) || lists.find((l) => l.id === id)?.name || "Inventory";
    setPendingNewCountListId(id);
    setNewCountNameInput(buildDefaultCountSessionName(listName));
    editor.setNewCountNameDialogOpen(true);
  };

  const handleStartCountFromList = async (listId: string) => {
    const id = listId.trim();
    if (!id) return;
    const existing = inProgressSessions.find((s) => (s.inventory_list_id || "").trim() === id);
    if (existing) { setSelectedList(id); setLandingFocusListId(id); await openEditor(existing); return; }
    openNewCountSessionNameDialog(id);
  };

  const handleConfirmNewCountSessionName = async () => {
    const name = newCountNameInput.trim();
    const listId = editor.pendingNewCountListId;
    if (!listId) { editor.setNewCountNameDialogOpen(false); return; }
    if (!name) { toast.error("Enter a name for this count session."); return; }
    editor.setNewCountNameDialogOpen(false);
    setPendingNewCountListId(null);
    await createSessionForListAction(listId, name);
  };

  const handleHeaderStartOrContinue = () => {
    const id = landingFocusListId && lists.some((l) => l.id === landingFocusListId)
      ? landingFocusListId : lists[0]?.id;
    if (!id) { toast.info("Create a list in List Management first."); return; }
    void handleStartCountFromList(id);
  };

  const handleLeaveEditorToHub = () => {
    const listId = activeSession?.inventory_list_id || "";
    sessionStorage.removeItem("inv_active_session");
    onSessionClosed();
    setSelectedPar("");
    void hydrateCountingParMaps(null);
    if (listId) { setLandingFocusListId(listId); setSelectedList(listId); }
    void refreshSessions();
  };

  const handleUpdateStock = useCallback((id: string, rawValue: string) => {
    const parsed = parseInputValue(rawValue);
    setItemById((prev) => {
      const row = prev[id];
      if (!row) return prev;
      const patch: Partial<InventorySessionItemRow> = { current_stock: parsed };
      if (rawValue.trim() === "") {
        patch.counted_as = null;
        patch.counted_value = null;
        patch.conversion_formula = null;
      } else if (parsed === 0) {
        patch.counted_as = "cases";
        patch.counted_value = 0;
      }
      return { ...prev, [id]: { ...row, ...patch } };
    });
    setLastEditedId(id);
  }, [setItemById, setLastEditedId]);

  const handleUpdatePrice = useCallback((id: string, rawValue: string) => {
    const parsed = parseInputValue(rawValue);
    setItemById((prev) => {
      const row = prev[id];
      if (!row) return prev;
      return { ...prev, [id]: { ...row, unit_cost: parsed } };
    });
    setLastEditedId(id);
  }, []);

  const handleSaveStock = useCallback(async (id: string, stockVal: number | null) => {
    await handleSaveStockAction(id, stockVal);
  }, [handleSaveStockAction]);

  const handleSaveStockWithConversion = useCallback(
    async (id: string, payload: SaveStockWithConversionPayload) => {
      await handleSaveStockWithConversionAction(id, payload);
    },
    [handleSaveStockWithConversionAction],
  );

  const handleSavePrice = useCallback(async (id: string, cost: number | null) => {
    await handleSavePriceAction(id, cost);
  }, [handleSavePriceAction]);

  const openParGuidePicker = async () => {
    if (!currentRestaurant || !activeSession) return;
    await loadParGuidePickerOptions(activeSession.inventory_list_id);
    setParGuidePickerOpen(true);
  };

  const handleClearEntries = async () => {
    const sessionId = clearEntriesSessionId;
    const ok = await handleClearEntriesAction(sessionId);
    setClearEntriesSessionId(null);
    if (ok) clearAllItemEntries();
  };

  const handleReloadFromServer = useCallback(async () => {
    if (!activeSession?.id) return;
    if (typeof navigator !== "undefined" && !navigator.onLine) {
      toast.error("Connect to the network to reload counts.");
      return;
    }
    const r = await reloadSessionItems(activeSession.id);
    if (r.error) {
      toast.error(r.error.message);
      return;
    }
    if (r.data) {
      setItemOrder(r.data.map((i) => i.id));
      setItemById(
        Object.fromEntries(r.data.map((i) => [i.id, normalizeSessionItemForUi(i)])),
      );
      toast.success("Counts reloaded from server.");
    }
  }, [activeSession?.id, reloadSessionItems, setItemOrder, setItemById]);

  const handleView = (session: InventorySessionListRow) => {
    if (session.status === "APPROVED") navigate("/app/inventory/approved");
    else navigate("/app/inventory/review?session=" + session.id);
  };

  const handleOpenSmartOrderModal = async (session: InventorySessionListRow) => {
    setSmartOrderSelectedPar("");
    await openSmartOrderModalAction(session);
  };

  // ── Render ───────────────────────────────────────────────────────────────
  if (!activeSession && loading && (lists.length === 0 || !sessionsLoaded)) {
    return (
      <div className="space-y-6 animate-fade-in">
        <Skeleton className="h-6 w-40" />
        <Skeleton className="h-10 w-64" />
        {[1, 2, 3].map((i) => <Skeleton key={i} className="h-40 rounded-xl" />)}
      </div>
    );
  }

  if (activeSession) {
    return (
      <InventorySessionEditor
        editor={editor}
        meta={{
          isCompact,
          isManagerOrOwner,
          isStaffMenu,
          selectedListName,
          locations,
          currentLocation,
          sessionUserId: user?.id ?? null,
          networkOnline,
          canEditPar: locationPerms.can_edit_par,
        }}
        view={{ filteredItems, globalIndexByItemId, groupedItems, sortedCategoryKeys, allCategoryKeys, countedItems, totalItems, progressPct, submitSummary }}
        countData={{ catalogItems, parGuidesPickerOptions, riskThresholds, countingParByCatalogId, countingParByNormalizedName, countingParGuideName }}
        loadingStates={{ savingId, savedId, editItemDetailsSaving, staffParSending, staffPriceSending, managerParSaving, managerPriceSaving, submittingForReview }}
        zoneCount={zoneCount}
        handlers={{
          onLeave: handleLeaveEditorToHub,
          onOpenParGuidePicker: openParGuidePicker,
          onApplyParGuideSelection: applyParGuideSelectionAction,
          onUpdateStock: handleUpdateStock,
          onSaveStock: handleSaveStock,
          onSaveStockWithConversion: handleSaveStockWithConversion,
          onUpdatePrice: handleUpdatePrice,
          onSavePrice: handleSavePrice,
          onClearRow: handleClearRowAction,
          onAddItem: async () => { await handleAddItemAction(); },
          onAddFromCatalog: async (ci: InventoryCatalogItemRow) => { await handleAddFromCatalogAction(ci); },
          onSubmitForReview: async () => { await handleSubmitForReviewAction(); },
          onClearEntries: handleClearEntries,
          onReloadFromServer: handleReloadFromServer,
          onSaveEditItemDetails: async () => { await handleSaveEditItemDetailsAction(); },
          onStaffParChangeRequestSubmit: async () => { await handleStaffParChangeRequestSubmitAction(); },
          onStaffPriceChangeRequestSubmit: async () => { await handleStaffPriceChangeRequestSubmitAction(); },
          onManagerParLevelSave: async () => { await handleManagerParLevelSaveAction(); },
          onManagerPriceSave: async () => { await handleManagerPriceSaveAction(); },
          navigate,
        }}
        fns={{ getApprovedPar, getCatalogUnitCost, getItemCategory, getLastOrderDate, getProductNumber }}
      />
    );
  }

  return (
    <div className="space-y-5 animate-fade-in">
      {blockCountWithoutLocation ? (
        <div className="rounded-lg border border-amber-200 dark:border-amber-900/50 bg-amber-50 dark:bg-amber-950/30 px-3 py-2 text-sm text-amber-700 dark:text-amber-400">
          {isStaffMenu
            ? "Your account isn't assigned to a location yet. Ask a manager or owner to assign you to a location before you can start a count."
            : "No active location is available. Add one in Settings to start a count."}
        </div>
      ) : null}
      <InventoryHubHeader
        hasInProgressSession={!!landingFocus.focusInProgressSession}
        onStartOrContinue={handleHeaderStartOrContinue}
        startActionDisabled={blockCountWithoutLocation}
      />

      <InventoryHubSessions
        nextSchedule={nextSchedule}
        landingFocus={landingFocus}
        lists={lists}
        inProgressSessions={inProgressSessions}
        startingListId={startingListId}
        onSelectLandingList={(id) => { setLandingFocusListId(id); setSelectedList(id); }}
        onOpenEditor={openEditor}
        onStartCountFromList={handleStartCountFromList}
        onOpenNewCountNameDialog={openNewCountSessionNameDialog}
        onRequestClearInProgress={setClearInProgressSessionId}
        navigate={navigate}
        blockNewCountWithoutLocation={blockCountWithoutLocation}
      />

      {reviewSessions.length > 0 && (
        <InventoryCountHubReviewSection
          reviewSessions={reviewSessions}
          sessionStats={sessionStats}
          isManagerOrOwner={isManagerOrOwner}
          onView={handleView}
          onApprove={(id) => void handleApproveAction(id)}
          onReject={(id) => void handleRejectAction(id)}
        />
      )}

      <InventoryCountHubApprovedSection
        approvedSessions={approvedSessions}
        sessionStats={sessionStats}
        approvedFilter={approvedFilter}
        onApprovedFilterChange={setApprovedFilter}
        isManagerOrOwner={isManagerOrOwner}
        onView={handleView}
        onDuplicate={(s) => void handleDuplicateAction(s)}
        onOpenSmartOrderModal={handleOpenSmartOrderModal}
        onDeclineToReview={(id) => void handleDeclineToReviewAction(id)}
        onRequestDeleteSession={setDeleteSessionId}
      />

      <InventoryCountHubModals
        newCountNameDialogOpen={newCountNameDialogOpen}
        onNewCountNameDialogOpenChange={(open) => {
          editor.setNewCountNameDialogOpen(open);
          if (!open) setPendingNewCountListId(null);
        }}
        newCountNameInput={newCountNameInput}
        onNewCountNameInputChange={setNewCountNameInput}
        startingListId={startingListId}
        onConfirmNewCountSessionName={handleConfirmNewCountSessionName}
        smartOrderSession={smartOrderSession}
        onSmartOrderDialogOpenChange={(open) => { if (!open) editor.setSmartOrderSession(null); }}
        smartOrderSelectedPar={smartOrderSelectedPar}
        onSmartOrderSelectedParChange={setSmartOrderSelectedPar}
        smartOrderParGuides={smartOrderParGuides}
        onCreateSmartOrder={() => void handleCreateSmartOrderAction()}
        smartOrderCreating={smartOrderCreating}
        clearEntriesSessionId={clearEntriesSessionId}
        onClearEntriesOpenChange={(open) => { if (!open) setClearEntriesSessionId(null); }}
        onConfirmClearEntries={handleClearEntries}
        clearInProgressSessionId={clearInProgressSessionId}
        onClearInProgressOpenChange={(open) => { if (!open) setClearInProgressSessionId(null); }}
        onConfirmClearInProgressSession={async () => { await handleClearInProgressSessionAction(clearInProgressSessionId); setClearInProgressSessionId(null); }}
        deleteSessionId={deleteSessionId}
        onDeleteSessionOpenChange={(open) => { if (!open) setDeleteSessionId(null); }}
        onConfirmDeleteSession={async () => { await handleDeleteSessionAction(deleteSessionId); setDeleteSessionId(null); }}
      />
    </div>
  );
}
