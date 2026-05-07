import { useCallback, useRef } from "react";
import { DEFAULT_CATEGORIES } from "@/lib/constants";
import { useRestaurant } from "@/contexts/RestaurantContext";
import { useSessionCommands } from "@/features/inventory-count/hooks/useSessionCommands";
import { useItemCommands } from "@/features/inventory-count/hooks/useItemCommands";
import { useManagerCommands } from "@/features/inventory-count/hooks/useManagerCommands";
import type {
  InventoryCatalogItemRow,
  InventorySessionItemRow,
  InventorySessionListRow,
  ParGuideItemRow,
  ParGuideRow,
} from "@/domain/inventory/enterInventoryTypes";
import type { RiskThresholds } from "@/lib/inventory-utils";
import type { Dispatch, SetStateAction } from "react";

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
  setSmartOrderSelectedPar?: StateSetter<string>;
  setCatalogItems: StateSetter<InventoryCatalogItemRow[]>;
  setEditItemDetailsSessionItem: StateSetter<InventorySessionItemRow | null>;
  setStaffParRequestItem: StateSetter<InventorySessionItemRow | null>;
  setStaffPriceRequestItem: StateSetter<InventorySessionItemRow | null>;
  setManagerParEditItem: StateSetter<InventorySessionItemRow | null>;
  setManagerPriceEditItem: StateSetter<InventorySessionItemRow | null>;
  /** Current session items (for save rollback). */
  itemById: Record<string, InventorySessionItemRow>;
};

export function useEnterInventoryActions(args: UseEnterInventoryActionsArgs) {
  const { currentLocation } = useRestaurant();

  // ── Adapter callbacks: bridge setter props → sub-hook callback API ──────

  const onSessionOpened = useCallback(
    (data: {
      session: InventorySessionListRow;
      listId: string;
      items: InventorySessionItemRow[];
      catalogItems: InventoryCatalogItemRow[];
      categoryMode: string;
      countingParGuideId: string | null;
    }) => {
      args.setActiveSession(data.session);
      args.setItemOrder(data.items.map((i) => i.id));
      args.setItemById(Object.fromEntries(data.items.map((i) => [i.id, i])));
      args.setCatalogItems(data.catalogItems);
      args.setCategoryMode(data.categoryMode);
      args.setCountingParGuideId(data.countingParGuideId);
      args.setParColumnVisible(false);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const onSessionClosed = useCallback(() => {
    args.setActiveSession(null);
    args.setItemOrder([]);
    args.setItemById({});
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const onListSelected = useCallback((listId: string) => {
    args.setSelectedList(listId);
    args.setLandingFocusListId(listId);
    args.setSelectedPar("");
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const onItemAdded = useCallback((item: InventorySessionItemRow) => {
    args.setItemOrder((prev) => [...prev, item.id]);
    args.setItemById((prev) => ({ ...prev, [item.id]: item }));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const onItemUpdated = useCallback(
    (id: string, patch: Partial<InventorySessionItemRow>) => {
      args.setItemById((prev) => {
        if (!prev[id]) return prev;
        return { ...prev, [id]: { ...prev[id], ...patch } };
      });
    },
    [], // eslint-disable-line react-hooks/exhaustive-deps
  );

  const onItemRemoved = useCallback((id: string) => {
    args.setItemOrder((prev) => prev.filter((x) => x !== id));
    args.setItemById((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Sub-hooks ─────────────────────────────────────────────────────────────

  const sessionCmds = useSessionCommands({
    currentRestaurantId: args.currentRestaurantId,
    userId: args.userId,
    activeSession: args.activeSession,
    selectedList: args.selectedList,
    parItems: args.parItems,
    riskThresholds: args.riskThresholds,
    navigateTo: args.navigateTo,
    refreshSessions: args.refreshSessions,
    loadCatalogItemsForList: args.loadCatalogItemsForList,
    loadLatestParGuide: args.loadLatestParGuide,
    loadParGuideItems: args.loadParGuideItems,
    loadEditorSnapshot: args.loadEditorSnapshot,
    reloadSessionItems: args.reloadSessionItems,
    hydrateCountingParMaps: args.hydrateCountingParMaps,
    loadSmartOrderParGuides: args.loadSmartOrderParGuides,
    onSessionOpened,
    onSessionClosed,
    onListSelected,
  });

  const itemCmds = useItemCommands({
    activeSession: args.activeSession,
    approvedParMap: args.approvedParMap,
    onItemAdded,
    onItemUpdated,
    onItemRemoved,
    getSessionItem: (id) => args.itemById[id],
  });

  const onParGuideApplied = useCallback(
    (guideId: string) => {
      args.setCountingParGuideId(guideId);
      args.setActiveSession((s) => (s ? { ...s, counting_par_guide_id: guideId } : s));
      args.setParColumnVisible(true);
      args.setParGuidePickerOpen(false);
    },
    [], // eslint-disable-line react-hooks/exhaustive-deps
  );

  const onSmartOrderModalOpened = useCallback((session: InventorySessionListRow) => {
    args.setSmartOrderSession(session);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const managerCmds = useManagerCommands({
    currentRestaurantId: args.currentRestaurantId,
    userId: args.userId,
    activeSession: args.activeSession,
    countingParGuideId: args.countingParGuideId,
    getApprovedPar: args.getApprovedPar,
    getCatalogUnitCost: args.getCatalogUnitCost,
    hydrateCountingParMaps: args.hydrateCountingParMaps,
    loadSmartOrderParGuides: args.loadSmartOrderParGuides,
    editItemDetailsSessionItem: args.editItemDetailsSessionItem,
    editItemDetailsForm: args.editItemDetailsForm,
    staffParRequestItem: args.staffParRequestItem,
    staffParSuggested: args.staffParSuggested,
    staffParReason: args.staffParReason,
    staffPriceRequestItem: args.staffPriceRequestItem,
    staffPriceSuggested: args.staffPriceSuggested,
    staffPriceReason: args.staffPriceReason,
    managerParEditItem: args.managerParEditItem,
    managerParInput: args.managerParInput,
    managerPriceEditItem: args.managerPriceEditItem,
    managerPriceInput: args.managerPriceInput,
    onItemUpdated,
    onCatalogItemsUpdated: args.setCatalogItems,
    onParGuideApplied,
    onSmartOrderModalOpened,
    onEditItemDetailsClosed: () => args.setEditItemDetailsSessionItem(null),
    onStaffParRequestClosed: () => args.setStaffParRequestItem(null),
    onStaffPriceRequestClosed: () => args.setStaffPriceRequestItem(null),
    onManagerParEditClosed: () => args.setManagerParEditItem(null),
    onManagerPriceEditClosed: () => args.setManagerPriceEditItem(null),
  });

  // ── Thin wrappers that handle form reset after add ────────────────────────

  const handleAddItem = async () => {
    await itemCmds.handleAddItem(args.newItem);
    args.setNewItem({
      item_name: "",
      category: DEFAULT_CATEGORIES[1],
      unit: "",
      current_stock: 0,
      unit_cost: 0,
    });
    args.setCreateOpen(false);
  };

  const handleAddFromCatalog = async (catalogItem: InventoryCatalogItemRow) => {
    await itemCmds.handleAddFromCatalog(catalogItem);
  };

  const handleCreateSmartOrder = async () => {
    if (!args.smartOrderSession || !args.smartOrderSelectedPar) return;
    await sessionCmds.handleCreateSmartOrder(
      args.smartOrderSession,
      args.smartOrderSelectedPar,
    );
    args.setSmartOrderSession(null);
  };

  const openSmartOrderModal = async (session: InventorySessionListRow) => {
    args.setSmartOrderSelectedPar?.("");
    managerCmds.openSmartOrderModal(session);
  };

  // ── Return: same public interface as before ───────────────────────────────

  return {
    // Loading states
    startingListId: sessionCmds.startingListId,
    submittingForReview: sessionCmds.submittingForReview,
    savingId: itemCmds.savingId,
    savedId: itemCmds.savedId,
    smartOrderCreating: false, // handled internally by sessionCmds now
    editItemDetailsSaving: managerCmds.editItemDetailsSaving,
    staffParSending: managerCmds.staffParSending,
    staffPriceSending: managerCmds.staffPriceSending,
    managerParSaving: managerCmds.managerParSaving,
    managerPriceSaving: managerCmds.managerPriceSaving,
    // Session commands
    openEditor: sessionCmds.openEditor,
    createSessionForList: sessionCmds.createSessionForList,
    applyParGuideSelection: managerCmds.applyParGuideSelection,
    handleSubmitForReview: sessionCmds.handleSubmitForReview,
    handleDeleteSession: sessionCmds.handleDeleteSession,
    handleClearInProgressSession: sessionCmds.handleClearInProgressSession,
    handleApprove: sessionCmds.handleApprove,
    handleReject: sessionCmds.handleReject,
    handleDeclineToReview: sessionCmds.handleDeclineToReview,
    handleDuplicate: sessionCmds.handleDuplicate,
    // Item commands
    handleAddItem,
    handleAddFromCatalog,
    handleClearRow: itemCmds.handleClearRow,
    handleSavePrice: itemCmds.handleSavePrice,
    handleSaveStock: itemCmds.handleSaveStock,
    handleSaveStockWithConversion: itemCmds.handleSaveStockWithConversion,
    upsertZoneCountForItem: itemCmds.upsertZoneCountForItem,
    handleClearEntries: (sessionId: string | null) => itemCmds.handleClearEntries(sessionId),
    // Manager commands
    openSmartOrderModal,
    handleCreateSmartOrder,
    handleSaveEditItemDetails: managerCmds.handleSaveEditItemDetails,
    handleStaffParChangeRequestSubmit: managerCmds.handleStaffParChangeRequestSubmit,
    handleStaffPriceChangeRequestSubmit: managerCmds.handleStaffPriceChangeRequestSubmit,
    handleManagerParLevelSave: managerCmds.handleManagerParLevelSave,
    handleManagerPriceSave: managerCmds.handleManagerPriceSave,
  };
}
