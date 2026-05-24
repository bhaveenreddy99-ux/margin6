import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { ListImperativeAPI } from "react-window";
import type {
  InventorySessionItemRow,
  InventorySessionListRow,
} from "@/domain/inventory/enterInventoryTypes";
import {
  type InventorySortMode,
  persistInventorySortMode,
  readInventorySortMode,
} from "@/features/inventory-count/types/inventorySortMode";

export type FilterStatus = "all" | "uncounted" | "below_par" | "low" | "critical";

export type SessionEditorState = ReturnType<typeof useSessionEditor>;

export function useSessionEditor(args: { isStaffMenu: boolean }) {
  // ── Active session + item state ───────────────────────────────────────────
  const [activeSession, setActiveSession] = useState<InventorySessionListRow | null>(null);
  const [itemById, setItemById] = useState<Record<string, InventorySessionItemRow>>({});
  const [itemOrder, setItemOrder] = useState<string[]>([]);

  const items = useMemo(
    () =>
      itemOrder
        .map((id) => itemById[id])
        .filter((x): x is InventorySessionItemRow => x != null),
    [itemOrder, itemById],
  );

  const staffCountingFocus = useMemo(
    () =>
      !!activeSession &&
      args.isStaffMenu &&
      activeSession.status !== "IN_REVIEW" &&
      activeSession.status !== "APPROVED",
    [activeSession, args.isStaffMenu],
  );

  // ── Display + filtering ───────────────────────────────────────────────────
  const [search, setSearch] = useState("");
  const [filterCategory, setFilterCategory] = useState("all");
  const [showOnlyEmpty, setShowOnlyEmpty] = useState(false);
  const [statusFilter, setStatusFilter] = useState<FilterStatus>("all");
  const [categoryMode, setCategoryMode] = useState<string>("list_order");
  const [sortMode, setSortModeState] = useState<InventorySortMode>(() => readInventorySortMode());
  const setSortMode = useCallback((mode: InventorySortMode) => {
    setSortModeState(mode);
    persistInventorySortMode(mode);
  }, []);
  const [lastEditedId, setLastEditedId] = useState<string | null>(null);
  const [submitConfirmOpen, setSubmitConfirmOpen] = useState(false);

  // ── PAR guide ─────────────────────────────────────────────────────────────
  const [parColumnVisible, setParColumnVisible] = useState(false);
  const [parGuidePickerOpen, setParGuidePickerOpen] = useState(false);
  const [countingParGuideId, setCountingParGuideId] = useState<string | null>(null);

  // ── DOM refs ──────────────────────────────────────────────────────────────
  const inputRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const sessionListWidthRef = useRef<HTMLDivElement>(null);
  const [sessionListWidth, setSessionListWidth] = useState(800);
  const categoryVirtualListRefs = useRef<Record<string, ListImperativeAPI | null>>({});

  useLayoutEffect(() => {
    if (!activeSession) return;
    const el = sessionListWidthRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width;
      if (w && w > 0) setSessionListWidth(Math.floor(w));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [activeSession?.id]);

  useEffect(() => {
    categoryVirtualListRefs.current = {};
  }, [activeSession?.id]);

  // Staff sessions restricted to list_order or alphabetic
  useEffect(() => {
    if (!activeSession || !args.isStaffMenu) return;
    if (categoryMode !== "list_order" && categoryMode !== "alphabetic") {
      setCategoryMode("list_order");
    }
  }, [activeSession?.id, args.isStaffMenu, categoryMode]);

  // ── Row-level sheets ──────────────────────────────────────────────────────
  const [editItemDetailsSessionItem, setEditItemDetailsSessionItem] =
    useState<InventorySessionItemRow | null>(null);
  const [editItemDetailsForm, setEditItemDetailsForm] = useState({
    item_name: "",
    unit: "",
    pack_size: "",
  });

  const [staffParRequestItem, setStaffParRequestItem] =
    useState<InventorySessionItemRow | null>(null);
  const [staffParSuggested, setStaffParSuggested] = useState("");
  const [staffParReason, setStaffParReason] = useState("");

  const [staffPriceRequestItem, setStaffPriceRequestItem] =
    useState<InventorySessionItemRow | null>(null);
  const [staffPriceSuggested, setStaffPriceSuggested] = useState("");
  const [staffPriceReason, setStaffPriceReason] = useState("");

  const [managerParEditItem, setManagerParEditItem] =
    useState<InventorySessionItemRow | null>(null);
  const [managerParInput, setManagerParInput] = useState("");

  const [managerPriceEditItem, setManagerPriceEditItem] =
    useState<InventorySessionItemRow | null>(null);
  const [managerPriceInput, setManagerPriceInput] = useState("");

  // ── Add-item forms ────────────────────────────────────────────────────────
  const [createOpen, setCreateOpen] = useState(false);
  const [catalogOpen, setCatalogOpen] = useState(false);
  const [newItem, setNewItem] = useState({
    item_name: "",
    category: "Cooler",
    unit: "",
    current_stock: 0,
    unit_cost: 0,
  });

  // ── Modal triggers ────────────────────────────────────────────────────────
  const [smartOrderSession, setSmartOrderSession] = useState<InventorySessionListRow | null>(null);
  const [smartOrderSelectedPar, setSmartOrderSelectedPar] = useState("");
  const [clearEntriesSessionId, setClearEntriesSessionId] = useState<string | null>(null);
  const [clearInProgressSessionId, setClearInProgressSessionId] = useState<string | null>(null);
  const [deleteSessionId, setDeleteSessionId] = useState<string | null>(null);
  const [newCountNameDialogOpen, setNewCountNameDialogOpen] = useState(false);
  const [pendingNewCountListId, setPendingNewCountListId] = useState<string | null>(null);
  const [newCountNameInput, setNewCountNameInput] = useState("");

  // ── Stable callbacks for command hooks ───────────────────────────────────

  const onItemAdded = useCallback((item: InventorySessionItemRow) => {
    setItemOrder((prev) => [...prev, item.id]);
    setItemById((prev) => ({ ...prev, [item.id]: item }));
  }, []);

  const onItemUpdated = useCallback(
    (id: string, patch: Partial<InventorySessionItemRow>) => {
      setItemById((prev) => {
        if (!prev[id]) return prev;
        return { ...prev, [id]: { ...prev[id], ...patch } };
      });
    },
    [],
  );

  const onItemRemoved = useCallback((id: string) => {
    setItemOrder((prev) => prev.filter((itemId) => itemId !== id));
    setItemById((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
  }, []);

  // Called by useSessionCommands / useEnterInventoryActions after a session opens.
  // catalogItems is NOT owned here — it lives in useInventoryCountData.
  const onSessionOpened = useCallback(
    (openArgs: {
      session: InventorySessionListRow;
      listId: string;
      items: InventorySessionItemRow[];
      categoryMode: string;
      countingParGuideId: string | null;
    }) => {
      setActiveSession(openArgs.session);
      setItemOrder(openArgs.items.map((item) => item.id));
      setItemById(Object.fromEntries(openArgs.items.map((item) => [item.id, item])));
      setCategoryMode(openArgs.categoryMode);
      setCountingParGuideId(openArgs.countingParGuideId);
      setParColumnVisible(false);
    },
    [],
  );

  // Called when session ends (submit, delete, clear, navigate away).
  const onSessionClosed = useCallback(() => {
    setActiveSession(null);
    setItemOrder([]);
    setItemById({});
    setCountingParGuideId(null);
    setParColumnVisible(false);
    setParGuidePickerOpen(false);
    setSearch("");
    setFilterCategory("all");
    setStatusFilter("all");
    setEditItemDetailsSessionItem(null);
    setStaffParRequestItem(null);
    setStaffPriceRequestItem(null);
    setManagerParEditItem(null);
    setManagerPriceEditItem(null);
  }, []);

  // Local row clear (called from the page only after a successful handleClearEntries DB write).
  // current_stock is NOT NULL in the schema, so we mirror the DB by writing 0 (counted predicate is `> 0`).
  const clearAllItemEntries = useCallback(() => {
    setItemById((prev) => {
      const next = { ...prev };
      for (const id of Object.keys(next)) {
        next[id] = { ...next[id], current_stock: 0, inventory_session_item_zones: [] };
      }
      return next;
    });
  }, []);

  return {
    // Session
    activeSession,
    setActiveSession,
    items,
    itemById,
    setItemById,
    itemOrder,
    setItemOrder,
    staffCountingFocus,

    // Display filters
    search,
    setSearch,
    filterCategory,
    setFilterCategory,
    showOnlyEmpty,
    setShowOnlyEmpty,
    statusFilter,
    setStatusFilter,
    categoryMode,
    setCategoryMode,
    sortMode,
    setSortMode,
    lastEditedId,
    setLastEditedId,
    submitConfirmOpen,
    setSubmitConfirmOpen,

    // PAR guide
    parColumnVisible,
    setParColumnVisible,
    parGuidePickerOpen,
    setParGuidePickerOpen,
    countingParGuideId,
    setCountingParGuideId,

    // DOM refs
    inputRefs,
    sessionListWidthRef,
    sessionListWidth,
    categoryVirtualListRefs,

    // Row sheets
    editItemDetailsSessionItem,
    setEditItemDetailsSessionItem,
    editItemDetailsForm,
    setEditItemDetailsForm,
    staffParRequestItem,
    setStaffParRequestItem,
    staffParSuggested,
    setStaffParSuggested,
    staffParReason,
    setStaffParReason,
    staffPriceRequestItem,
    setStaffPriceRequestItem,
    staffPriceSuggested,
    setStaffPriceSuggested,
    staffPriceReason,
    setStaffPriceReason,
    managerParEditItem,
    setManagerParEditItem,
    managerParInput,
    setManagerParInput,
    managerPriceEditItem,
    setManagerPriceEditItem,
    managerPriceInput,
    setManagerPriceInput,

    // Add-item
    createOpen,
    setCreateOpen,
    catalogOpen,
    setCatalogOpen,
    newItem,
    setNewItem,

    // Smart order modal
    smartOrderSession,
    setSmartOrderSession,
    smartOrderSelectedPar,
    setSmartOrderSelectedPar,

    // Modal triggers
    clearEntriesSessionId,
    setClearEntriesSessionId,
    clearInProgressSessionId,
    setClearInProgressSessionId,
    deleteSessionId,
    setDeleteSessionId,
    newCountNameDialogOpen,
    setNewCountNameDialogOpen,
    pendingNewCountListId,
    setPendingNewCountListId,
    newCountNameInput,
    setNewCountNameInput,

    // Stable callbacks
    onItemAdded,
    onItemUpdated,
    onItemRemoved,
    onSessionOpened,
    onSessionClosed,
    clearAllItemEntries,
  };
}
