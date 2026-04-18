import { useEffect, useState, useRef, useCallback, useMemo, useLayoutEffect } from "react";
import { List, type ListImperativeAPI, type RowComponentProps } from "react-window";
import { format } from "date-fns";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { useRestaurant } from "@/contexts/RestaurantContext";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel,
  AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetFooter } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList,
  BreadcrumbPage, BreadcrumbSeparator } from "@/components/ui/breadcrumb";
import { toast } from "sonner";
import {
  Plus, Minus, Send, Package, BookOpen, Play, ArrowLeft, Eye, CheckCircle, ClipboardList, ExternalLink,
  XCircle, ShoppingCart, Copy, ClipboardCheck, Trash2, ChevronRight, Eraser,
  Search, EyeOff, Check, ListOrdered, MoreHorizontal, MoreVertical,
  CalendarClock, MapPin, Filter, Pencil, DollarSign, BarChart3 } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
} from "@/components/ui/dropdown-menu";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useIsCompact, useIsMobile } from "@/hooks/use-mobile";
import { useCategoryMapping } from "@/hooks/useCategoryMapping";
import { useEnterInventoryData } from "@/hooks/useEnterInventoryData";
import { useEnterInventoryActions } from "@/hooks/useEnterInventoryActions";

import {
  getRisk, getRowState, getRowBgClass, formatNum, parseInputValue,
  inputDisplayValue, computeOrderQty, formatCurrency, type RiskThresholds,
} from "@/lib/inventory-utils";
import ItemIdentityBlock from "@/components/ItemIdentityBlock";
import { useLastOrderDates } from "@/hooks/useLastOrderDates";
import {
  DESKTOP_CATEGORY_LIST_MAX_HEIGHT,
  DESKTOP_COUNT_ROW_HEIGHT,
  MOBILE_COUNT_CARD_HEIGHT,
  buildCatalogDefaultParById,
  buildCatalogDefaultParByName,
  buildCatalogLookup,
  buildInventoryView,
  buildLandingFocus,
  buildSubmitSummary,
  computeNextOccurrence,
  findNextSchedule,
  formatCountdown,
  formatLastOrdered as formatLastOrderedHelper,
  formatParColumnCell as formatParColumnCellHelper,
  formatSessionRowDate,
  getApprovedPar as getApprovedParHelper,
  getCatalogUnitCost as getCatalogUnitCostHelper,
  getDesktopSessionGridTemplate,
  getItemCategory as getItemCategoryHelper,
  getItemSortOrder as getItemSortOrderHelper,
  getProductNumber as getProductNumberHelper,
  getRiskBadgeLabel,
  getScheduleStatus,
  normalizeItemName,
  resolveCountingParDisplay as resolveCountingParDisplayHelper,
} from "@/domain/inventory/enterInventoryHelpers";
import type {
  InventoryCatalogItemRow,
  InventoryListRow,
  InventorySessionItemRow,
  InventorySessionListRow,
} from "@/domain/inventory/enterInventoryTypes";

const defaultCategories = ["Frozen", "Cooler", "Dry"];

/** react-window row for desktop session table — isolated from parent to limit re-renders. */
type SessionDesktopVirtualData = {
  catItems: InventorySessionItemRow[];
  globalIndexByItemId: Map<string, number>;
  getApprovedPar: (item: InventorySessionItemRow) => number;
  riskThresholds: RiskThresholds;
  parColumnVisible: boolean;
  /** Staff in counting mode: hide price, shorten row meta, emphasize qty. */
  simplifyCountingRow: boolean;
  isCountingEditable: boolean;
  onUpdateStock: (id: string, raw: string) => void;
  onSaveStock: (id: string, stock: number | null) => void | Promise<void>;
  onKeyDown: (e: React.KeyboardEvent, idx: number, field?: "stock") => void;
  inputRefs: React.MutableRefObject<Record<string, HTMLInputElement | null>>;
  formatParColumnCell: (item: InventorySessionItemRow) => string;
  getProductNumber: (item: InventorySessionItemRow) => string | null;
  formatLastOrdered: (d: string | null) => string;
  getLastOrderDate: (name: string) => string | null;
  renderRowActionsMenu: (item: InventorySessionItemRow) => React.ReactNode;
  savingId: string | null;
  savedId: string | null;
  lastEditedId: string | null;
};

/**
 * Desktop session count row (virtualized). Kept as a plain function because react-window v2's
 * `List` `rowComponent` prop is typed for a non-memo component; only visible rows mount anyway.
 */
function InventoryRow(props: RowComponentProps<SessionDesktopVirtualData>) {
  const { index, style, ariaAttributes, ...data } = props;
  const item = data.catItems[index];
  if (!item) return null;
  const globalIdx = data.globalIndexByItemId.get(item.id) ?? 0;
  const rowPar = data.getApprovedPar(item);
  const needQty = rowPar > 0 ? computeOrderQty(item.current_stock, rowPar, item.unit, item.pack_size) : null;
  const risk = getRisk(item.current_stock, rowPar, data.riskThresholds);
  const rowBg = getRowBgClass(item.current_stock);
  const isRecentlyEdited = data.lastEditedId === item.id;
  const gridTemplate = getDesktopSessionGridTemplate(data.parColumnVisible, data.simplifyCountingRow);
  const showMetaLine =
    !data.simplifyCountingRow
    || data.getProductNumber(item)
    || !!item.pack_size;

  return (
    <div
      {...ariaAttributes}
      style={{ ...style, display: "grid", gridTemplateColumns: gridTemplate }}
      className={`items-center gap-x-2 border-b border-border/10 px-2 transition-all duration-200 hover:bg-muted/20 ${rowBg} ${isRecentlyEdited ? "bg-primary/[0.03]" : ""}`}
    >
      <div className="pl-3 py-3 min-w-0">
        <p className={`font-medium leading-tight ${data.simplifyCountingRow ? "text-[15px]" : "text-sm"}`}>{item.item_name}</p>
        <ItemIdentityBlock brandName={item.brand_name} className="block mt-0.5" />
        {showMetaLine && (
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0 mt-0.5">
            {data.getProductNumber(item) && (
              <span className="text-[11px] text-muted-foreground/50 font-mono">#{data.getProductNumber(item)}</span>
            )}
            {item.pack_size && <span className="text-[11px] text-muted-foreground/50">{item.pack_size}</span>}
            {!data.simplifyCountingRow && (
              <span className="text-[11px] text-muted-foreground/40">
                {data.formatLastOrdered(data.getLastOrderDate(item.item_name)) !== "—"
                  ? `Last: ${data.formatLastOrdered(data.getLastOrderDate(item.item_name))}`
                  : null}
              </span>
            )}
          </div>
        )}
      </div>
      <div className="flex justify-center py-3">
        <div className="flex items-center justify-center gap-2">
          <Input
            ref={(el) => {
              data.inputRefs.current[item.id] = el;
            }}
            type="number"
            inputMode="decimal"
            min={0}
            step={0.1}
            readOnly={!data.isCountingEditable}
            value={inputDisplayValue(item.current_stock)}
            onFocus={(e) => e.target.select()}
            onChange={(e) => data.onUpdateStock(item.id, e.target.value)}
            onBlur={() => data.onSaveStock(item.id, item.current_stock)}
            onKeyDown={(e) => data.onKeyDown(e, globalIdx, "stock")}
            className={`w-24 text-base font-mono text-center font-semibold rounded-lg border-2 bg-background [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none ${
              data.simplifyCountingRow
                ? "h-11 border-primary/35 shadow-sm focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/25"
                : "h-10 border-border/50 focus:border-primary/50"
            }`}
          />
          <div className="w-5">
            {data.savingId === item.id && <span className="text-muted-foreground animate-pulse text-xs">…</span>}
            {data.savedId === item.id && <Check className="h-3.5 w-3.5 text-success" />}
          </div>
        </div>
      </div>
      {data.parColumnVisible && (
        <div className="text-right py-3">
          <span className="text-sm font-mono font-semibold tabular-nums text-foreground">
            {data.formatParColumnCell(item)}
          </span>
        </div>
      )}
      {!data.simplifyCountingRow && (
        <div className="text-right py-3">
          <span className="text-sm font-mono tabular-nums text-foreground">
            {item.unit_cost != null ? `$${Number(item.unit_cost).toFixed(2)}` : <span className="text-muted-foreground/30">—</span>}
          </span>
        </div>
      )}
      <div className="text-right py-3">
        {needQty !== null ? (
          <span
            className={`font-mono font-semibold ${data.simplifyCountingRow ? "text-xs" : "text-sm"} ${needQty > 0 ? "text-destructive" : "text-muted-foreground"}`}
          >
            {formatNum(needQty)}
          </span>
        ) : (
          <span className="text-muted-foreground/30 text-sm">—</span>
        )}
      </div>
      <div className="text-center py-3 pr-2">
        <Badge
          className={`${risk.bgClass} ${risk.textClass} border-0 font-medium ${data.simplifyCountingRow ? "text-[9px] px-1.5 py-0" : "text-[10px]"}`}
        >
          {getRiskBadgeLabel(risk)}
        </Badge>
      </div>
      <div className="py-3 pr-1 flex justify-end" onClick={(e) => e.stopPropagation()}>
        {data.renderRowActionsMenu(item)}
      </div>
    </div>
  );
}

type SessionDesktopCategoryListProps = {
  catItems: InventorySessionItemRow[];
  listWidth: number;
  globalIndexByItemId: Map<string, number>;
  riskThresholds: RiskThresholds;
  parColumnVisible: boolean;
  isCountingEditable: boolean;
  onUpdateStock: SessionDesktopVirtualData["onUpdateStock"];
  onSaveStock: SessionDesktopVirtualData["onSaveStock"];
  onKeyDown: SessionDesktopVirtualData["onKeyDown"];
  inputRefs: SessionDesktopVirtualData["inputRefs"];
  formatParColumnCell: SessionDesktopVirtualData["formatParColumnCell"];
  getProductNumber: SessionDesktopVirtualData["getProductNumber"];
  formatLastOrdered: SessionDesktopVirtualData["formatLastOrdered"];
  getLastOrderDate: SessionDesktopVirtualData["getLastOrderDate"];
  renderRowActionsMenu: SessionDesktopVirtualData["renderRowActionsMenu"];
  savingId: SessionDesktopVirtualData["savingId"];
  savedId: SessionDesktopVirtualData["savedId"];
  lastEditedId: SessionDesktopVirtualData["lastEditedId"];
  getApprovedPar: SessionDesktopVirtualData["getApprovedPar"];
  simplifyCountingRow: boolean;
  registerListRef: (instance: ListImperativeAPI | null) => void;
};

function SessionDesktopCategoryList({
  catItems,
  listWidth,
  globalIndexByItemId,
  riskThresholds,
  parColumnVisible,
  simplifyCountingRow,
  isCountingEditable,
  onUpdateStock,
  onSaveStock,
  onKeyDown,
  inputRefs,
  formatParColumnCell,
  getProductNumber,
  formatLastOrdered,
  getLastOrderDate,
  renderRowActionsMenu,
  savingId,
  savedId,
  lastEditedId,
  getApprovedPar,
  registerListRef,
}: SessionDesktopCategoryListProps) {
  const rowProps = useMemo<SessionDesktopVirtualData>(
    () => ({
      catItems,
      globalIndexByItemId,
      getApprovedPar,
      riskThresholds,
      parColumnVisible,
      simplifyCountingRow,
      isCountingEditable,
      onUpdateStock,
      onSaveStock,
      onKeyDown,
      inputRefs,
      formatParColumnCell,
      getProductNumber,
      formatLastOrdered,
      getLastOrderDate,
      renderRowActionsMenu,
      savingId,
      savedId,
      lastEditedId,
    }),
    [
      catItems,
      globalIndexByItemId,
      getApprovedPar,
      riskThresholds,
      parColumnVisible,
      simplifyCountingRow,
      isCountingEditable,
      onUpdateStock,
      onSaveStock,
      onKeyDown,
      inputRefs,
      formatParColumnCell,
      getProductNumber,
      formatLastOrdered,
      getLastOrderDate,
      renderRowActionsMenu,
      savingId,
      savedId,
      lastEditedId,
    ],
  );

  const headerGrid = getDesktopSessionGridTemplate(parColumnVisible, simplifyCountingRow);

  const safeWidth = Math.max(listWidth, 320);
  const listHeight = Math.min(
    Math.max(catItems.length * DESKTOP_COUNT_ROW_HEIGHT, catItems.length > 0 ? 80 : 0),
    DESKTOP_CATEGORY_LIST_MAX_HEIGHT,
  );

  return (
    <>
      <div
        className="grid items-center gap-x-2 border-b border-border/20 bg-muted/30 px-2"
        style={{ gridTemplateColumns: headerGrid }}
      >
        <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/60 pl-3 py-3">Item</div>
        <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/60 text-center py-3">On Hand</div>
        {parColumnVisible && (
          <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/60 text-right py-3">PAR</div>
        )}
        {!simplifyCountingRow && (
          <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/60 text-right py-3">Price</div>
        )}
        <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/60 text-right py-3">Need</div>
        <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/60 text-center py-3 pr-2">Status</div>
        <div className="w-10 py-3" aria-hidden />
      </div>
      {catItems.length > 0 && (
        <List
          listRef={registerListRef}
          rowCount={catItems.length}
          rowHeight={DESKTOP_COUNT_ROW_HEIGHT}
          rowComponent={InventoryRow}
          rowProps={rowProps}
          overscanCount={6}
          style={{ height: listHeight, width: safeWidth }}
        />
      )}
    </>
  );
}

export default function EnterInventoryPage() {
  const { currentRestaurant, locations, currentLocation, setCurrentLocation } = useRestaurant();
  const { user } = useAuth();
  const restaurantRole = (currentRestaurant?.role || "").toUpperCase();
  const isManagerOrOwner = restaurantRole === "MANAGER" || restaurantRole === "OWNER";
  const isStaffMenu = !isManagerOrOwner;
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const isCompact = useIsCompact();
  const isMobile = useIsMobile();
  const { lastOrderDates } = useLastOrderDates(currentRestaurant?.id, currentLocation?.id);

  const [selectedList, setSelectedList] = useState("");
  const [landingFocusListId, setLandingFocusListId] = useState<string | null>(null);
  const [approvedFilter, setApprovedFilter] = useState("30");

  const [activeSession, setActiveSession] = useState<InventorySessionListRow | null>(null);
  const [itemById, setItemById] = useState<Record<string, InventorySessionItemRow>>({});
  const [itemOrder, setItemOrder] = useState<string[]>([]);
  const items = useMemo(
    () => itemOrder.map((id) => itemById[id]).filter((x): x is InventorySessionItemRow => x != null),
    [itemOrder, itemById],
  );
  /** Staff in an editable count session — used for toolbar + row simplification (must match session editor). */
  const staffCountingFocus = useMemo(
    () =>
      !!activeSession &&
      isStaffMenu &&
      activeSession.status !== "IN_REVIEW" &&
      activeSession.status !== "APPROVED",
    [activeSession, isStaffMenu],
  );
  const [search, setSearch] = useState("");
  const [filterCategory, setFilterCategory] = useState("all");
  const [createOpen, setCreateOpen] = useState(false);
  const [newItem, setNewItem] = useState({ item_name: "", category: "Cooler", unit: "", current_stock: 0, unit_cost: 0 });
  const [catalogOpen, setCatalogOpen] = useState(false);

  const [selectedPar, setSelectedPar] = useState("");

  const [clearEntriesSessionId, setClearEntriesSessionId] = useState<string | null>(null);
  const [clearInProgressSessionId, setClearInProgressSessionId] = useState<string | null>(null);
  const [deleteSessionId, setDeleteSessionId] = useState<string | null>(null);

  const [smartOrderSession, setSmartOrderSession] = useState<InventorySessionListRow | null>(null);
  /** New count: require user-confirmed session name before inserting `inventory_sessions`. */
  const [newCountNameDialogOpen, setNewCountNameDialogOpen] = useState(false);
  const [pendingNewCountListId, setPendingNewCountListId] = useState<string | null>(null);
  const [newCountNameInput, setNewCountNameInput] = useState("");
  const [smartOrderSelectedPar, setSmartOrderSelectedPar] = useState("");

  // Counting mode state
  const [showOnlyEmpty, setShowOnlyEmpty] = useState(false);
  const [submitConfirmOpen, setSubmitConfirmOpen] = useState(false);
  const [categoryMode, setCategoryMode] = useState<string>("list_order");
  const [viewToggle] = useState<"table" | "compact">("table");
  const [statusFilter, setStatusFilter] = useState<"all" | "uncounted" | "low" | "critical">("all");
  const [lastEditedId, setLastEditedId] = useState<string | null>(null);
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

  /** Staff sessions only use list_order vs alphabetic; coerce AI / My categories. */
  useEffect(() => {
    if (!activeSession || !isStaffMenu) return;
    if (categoryMode !== "list_order" && categoryMode !== "alphabetic") {
      setCategoryMode("list_order");
    }
  }, [activeSession?.id, isStaffMenu, categoryMode]);

  const [, setCounterTick] = useState(0);

  // Active PAR guide data for read-only display during count entry
  const [approvedParMap] = useState<Record<string, number>>({});

  /** Optional read-only PAR column while counting */
  const [parColumnVisible, setParColumnVisible] = useState(false);
  const [parGuidePickerOpen, setParGuidePickerOpen] = useState(false);
  const [countingParGuideId, setCountingParGuideId] = useState<string | null>(null);

  // Row ⋮ menu sheets (item details, staff requests, manager PAR/price); see renderRowActionsMenu
  const [editItemDetailsSessionItem, setEditItemDetailsSessionItem] = useState<InventorySessionItemRow | null>(null);
  const [editItemDetailsForm, setEditItemDetailsForm] = useState({ item_name: "", unit: "", pack_size: "" });

  const [staffParRequestItem, setStaffParRequestItem] = useState<InventorySessionItemRow | null>(null);
  const [staffParSuggested, setStaffParSuggested] = useState("");
  const [staffParReason, setStaffParReason] = useState("");

  const [staffPriceRequestItem, setStaffPriceRequestItem] = useState<InventorySessionItemRow | null>(null);
  const [staffPriceSuggested, setStaffPriceSuggested] = useState("");
  const [staffPriceReason, setStaffPriceReason] = useState("");

  const [managerParEditItem, setManagerParEditItem] = useState<InventorySessionItemRow | null>(null);
  const [managerParInput, setManagerParInput] = useState("");

  const [managerPriceEditItem, setManagerPriceEditItem] = useState<InventorySessionItemRow | null>(null);
  const [managerPriceInput, setManagerPriceInput] = useState("");

  const {
    lists,
    loading,
    sessionsLoaded,
    listSelectorMeta,
    inProgressSessions,
    reviewSessions,
    approvedSessions,
    sessionStats,
    riskThresholds,
    catalogItems,
    parGuides,
    parItems,
    schedules,
    smartOrderParGuides,
    parGuidesPickerOptions,
    countingParGuideName,
    countingParByCatalogId,
    countingParByNormalizedName,
    setCatalogItems,
    refreshSessions,
    loadCatalogItemsForList,
    loadLatestParGuide,
    loadParGuideItems,
    loadEditorSnapshot,
    reloadSessionItems,
    hydrateCountingParMaps,
    loadParGuidePickerOptions,
    loadSmartOrderParGuides,
  } = useEnterInventoryData({
    currentRestaurantId: currentRestaurant?.id,
    approvedFilter,
    selectedList,
    selectedPar,
    setSelectedPar,
  });

  const requestedListId = useMemo(() => {
    const state = (location.state as { list_id?: string; listId?: string } | null) || null;
    return searchParams.get("list_id")
      || searchParams.get("listId")
      || state?.list_id
      || state?.listId
      || "";
  }, [location.state, searchParams]);

  useEffect(() => {
    if (!currentRestaurant) return;
    setSelectedList("");
    setLandingFocusListId(null);
  }, [currentRestaurant]);

  // Default landing list: deep-link wins; else keep user selection; else most recent session activity; else first list.
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
        if (t >= bestTime && s.inventory_list_id) {
          bestTime = t;
          bestListId = s.inventory_list_id;
        }
      }
      return bestListId || lists[0]?.id || null;
    });
  }, [
    currentRestaurant,
    sessionsLoaded,
    lists,
    requestedListId,
    inProgressSessions,
    reviewSessions,
    approvedSessions,
  ]);

  useEffect(() => {
    if (landingFocusListId && !activeSession) {
      setSelectedList(landingFocusListId);
    }
  }, [landingFocusListId, activeSession]);

  useEffect(() => {
    const timer = setInterval(() => setCounterTick(t => t + 1), 60000);
    return () => clearInterval(timer);
  }, []);

  // Restore active session from sessionStorage after a hard refresh (in-progress only)
  useEffect(() => {
    const savedId = sessionStorage.getItem('inv_active_session');
    if (!savedId || activeSession) return;
    const found = inProgressSessions.find(s => s.id === savedId);
    if (found) openEditor(found);
    else sessionStorage.removeItem('inv_active_session');
  }, [inProgressSessions, activeSession]);

  // Warn user before leaving page while a session is open
  useEffect(() => {
    if (!activeSession) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [activeSession]);

  const buildDefaultCountSessionName = (listName: string) => {
    const base = listName.trim() || "Inventory";
    return `${base} Count ${format(new Date(), "MMM d, yyyy")}`;
  };

  const openNewCountSessionNameDialog = (listId: string, listNameOverride?: string | null) => {
    const id = listId.trim();
    if (!id) return;
    const listName =
      (listNameOverride && String(listNameOverride).trim())
      || lists.find((list) => list.id === id)?.name
      || "Inventory";
    setPendingNewCountListId(id);
    setNewCountNameInput(buildDefaultCountSessionName(listName));
    setNewCountNameDialogOpen(true);
  };

  const createSessionForList = async (listId: string, name: string) => {
    await createSessionForListAction(listId, name);
  };

  const openEditor = async (session: InventorySessionListRow) => {
    await openEditorAction(session);
  };

  const fetchSessions = refreshSessions;

  const openParGuidePicker = async () => {
    if (!currentRestaurant || !activeSession) return;
    await loadParGuidePickerOptions(activeSession.inventory_list_id);
    setParGuidePickerOpen(true);
  };

  const applyParGuideSelection = async (guideId: string) => {
    await applyParGuideSelectionAction(guideId);
  };

  const handleLeaveEditorToHub = () => {
    const listId = activeSession?.inventory_list_id || "";
    sessionStorage.removeItem("inv_active_session");
    setActiveSession(null);
    setItemOrder([]);
    setItemById({});
    setSelectedPar("");
    setSearch("");
    setFilterCategory("all");
    setStatusFilter("all");
    setParColumnVisible(false);
    setParGuidePickerOpen(false);
    setCountingParGuideId(null);
    void hydrateCountingParMaps(null);
    setEditItemDetailsSessionItem(null);
    setStaffParRequestItem(null);
    setStaffPriceRequestItem(null);
    setManagerParEditItem(null);
    setManagerPriceEditItem(null);
    if (listId) {
      setLandingFocusListId(listId);
      setSelectedList(listId);
    }
    void fetchSessions();
  };

  // Keep counting PAR lookup in sync with catalog rows (e.g. after “Add from catalog”).
  useEffect(() => {
    if (!countingParGuideId || !activeSession?.inventory_list_id || !currentRestaurant?.id) return;
    let cancelled = false;
    (async () => {
      if (cancelled) return;
      await hydrateCountingParMaps(countingParGuideId);
    })();
    return () => {
      cancelled = true;
    };
  }, [countingParGuideId, activeSession?.id, activeSession?.inventory_list_id, currentRestaurant?.id, items.length]);

  const handleStartCountFromList = async (listId: string) => {
    const id = listId.trim();
    if (!id) return;
    const existing = inProgressSessions.find((s) => (s.inventory_list_id || "").trim() === id);
    if (existing) {
      setSelectedList(id);
      setLandingFocusListId(id);
      await openEditor(existing);
      return;
    }
    openNewCountSessionNameDialog(id);
  };

  const handleConfirmNewCountSessionName = async () => {
    const name = newCountNameInput.trim();
    const listId = pendingNewCountListId;
    if (!listId) {
      setNewCountNameDialogOpen(false);
      return;
    }
    if (!name) {
      toast.error("Enter a name for this count session.");
      return;
    }
    setNewCountNameDialogOpen(false);
    setPendingNewCountListId(null);
    await createSessionForList(listId, name);
  };

  const handleHeaderStartOrContinue = () => {
    const id =
      landingFocusListId && lists.some((l) => l.id === landingFocusListId)
        ? landingFocusListId
        : lists[0]?.id;
    if (!id) {
      toast.info("Create a list in List Management first.");
      return;
    }
    void handleStartCountFromList(id);
  };

  const handleAddItem = async () => {
    await handleAddItemAction();
  };

  const handleAddFromCatalog = async (catalogItem: InventoryCatalogItemRow) => {
    await handleAddFromCatalogAction(catalogItem);
  };

  const handleUpdateStock = useCallback((id: string, rawValue: string) => {
    const parsed = parseInputValue(rawValue);
    setItemById((prev) => {
      const row = prev[id];
      if (!row) return prev;
      return { ...prev, [id]: { ...row, current_stock: parsed } };
    });
    setLastEditedId(id);
  }, []);

  const handleClearRow = async (id: string) => {
    await handleClearRowAction(id);
  };

  const handleUpdatePrice = useCallback((id: string, rawValue: string) => {
    const parsed = parseInputValue(rawValue);
    setItemById((prev) => {
      const row = prev[id];
      if (!row) return prev;
      return { ...prev, [id]: { ...row, unit_cost: parsed } };
    });
  }, []);

  const handleSavePrice = useCallback(async (id: string, cost: number | null) => {
    await handleSavePriceAction(id, cost);
  }, [handleSavePriceAction]);

  const handleSaveStock = useCallback(async (id: string, stockVal: number | null) => {
    await handleSaveStockAction(id, stockVal);
  }, [handleSaveStockAction]);

  const handleSubmitForReview = async () => {
    await handleSubmitForReviewAction();
  };

  const handleDeleteSession = async () => {
    await handleDeleteSessionAction(deleteSessionId);
    setDeleteSessionId(null);
  };

  const handleClearInProgressSession = async () => {
    await handleClearInProgressSessionAction(clearInProgressSessionId);
    setClearInProgressSessionId(null);
  };

  const handleClearEntries = async () => {
    await handleClearEntriesAction(clearEntriesSessionId);
    setClearEntriesSessionId(null);
  };

  const handleApprove = async (sessionId: string) => {
    await handleApproveAction(sessionId);
  };

  const handleReject = async (sessionId: string) => {
    await handleRejectAction(sessionId);
  };

  const handleView = (session: InventorySessionListRow) => {
    if (session.status === "APPROVED") navigate("/app/inventory/approved");
    else navigate("/app/inventory/review?session=" + session.id);
  };

  const handleDeclineToReview = async (sessionId: string) => {
    await handleDeclineToReviewAction(sessionId);
  };

  const handleDuplicate = async (session: InventorySessionListRow) => {
    await handleDuplicateAction(session);
  };

  const openSmartOrderModal = async (session: InventorySessionListRow) => {
    setSmartOrderSelectedPar("");
    await openSmartOrderModalAction(session);
  };

  const handleCreateSmartOrder = async () => {
    await handleCreateSmartOrderAction();
  };

  const nextSchedule = useMemo(() => findNextSchedule(schedules), [schedules]);

  const landingFocus = useMemo(
    () =>
      buildLandingFocus({
        lists,
        landingFocusListId,
        inProgressSessions,
        reviewSessions,
        sessionStats,
        listSelectorMeta,
      }),
    [
      lists,
      landingFocusListId,
      inProgressSessions,
      reviewSessions,
      sessionStats,
      listSelectorMeta,
    ],
  );

  const mappingMode = categoryMode === "list_order" ? "list_order"
    : categoryMode === "custom-categories" ? "custom-categories"
    : categoryMode === "my-categories" ? "my-categories"
    : null;

  const { categories: mappedCategories, itemCategoryMap, hasMappings } = useCategoryMapping(
    activeSession?.inventory_list_id || selectedList || null,
    mappingMode === "list_order" ? "list_order" : mappingMode
  );

  const getItemCategoryForView = useCallback(
    (item: InventorySessionItemRow) =>
      getItemCategoryHelper({
        item,
        categoryMode,
        hasMappings,
        itemCategoryMap,
      }),
    [categoryMode, hasMappings, itemCategoryMap],
  );

  const getItemSortOrderForView = useCallback(
    (item: InventorySessionItemRow) =>
      getItemSortOrderHelper({
        item,
        hasMappings,
        itemCategoryMap,
      }),
    [hasMappings, itemCategoryMap],
  );
  const getItemCategory = getItemCategoryForView;
  const getItemSortOrder = getItemSortOrderForView;

  const catalogLookup = useMemo(() => buildCatalogLookup(catalogItems), [catalogItems]);
  const catalogDefaultParById = useMemo(
    () => buildCatalogDefaultParById(catalogItems),
    [catalogItems],
  );
  const catalogDefaultParByName = useMemo(
    () => buildCatalogDefaultParByName(catalogItems),
    [catalogItems],
  );

  const getApprovedParForView = useCallback(
    (item: InventorySessionItemRow) =>
      getApprovedParHelper(item, {
        countingParGuideId,
        countingParByCatalogId,
        countingParByNormalizedName,
        approvedParMap,
        catalogDefaultParById,
        catalogDefaultParByName,
      }),
    [
      countingParGuideId,
      countingParByCatalogId,
      countingParByNormalizedName,
      approvedParMap,
      catalogDefaultParById,
      catalogDefaultParByName,
    ],
  );

  const getCatalogUnitCostForView = useCallback(
    (catalogItemId: string | null | undefined) =>
      getCatalogUnitCostHelper(catalogItems, catalogItemId),
    [catalogItems],
  );
  const getApprovedPar = getApprovedParForView;
  const getCatalogUnitCost = getCatalogUnitCostForView;

  const {
    startingListId,
    savingId,
    savedId,
    smartOrderCreating,
    editItemDetailsSaving,
    staffParSending,
    staffPriceSending,
    managerParSaving,
    managerPriceSaving,
    openEditor: openEditorAction,
    createSessionForList: createSessionForListAction,
    applyParGuideSelection: applyParGuideSelectionAction,
    handleAddItem: handleAddItemAction,
    handleAddFromCatalog: handleAddFromCatalogAction,
    handleClearRow: handleClearRowAction,
    handleSavePrice: handleSavePriceAction,
    handleSaveStock: handleSaveStockAction,
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
  } = useEnterInventoryActions({
    currentRestaurantId: currentRestaurant?.id,
    userId: user?.id,
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
    setSmartOrderSession,
    setCatalogItems,
    setEditItemDetailsSessionItem,
    setStaffParRequestItem,
    setStaffPriceRequestItem,
    setManagerParEditItem,
    setManagerPriceEditItem,
  });

  const openEditItemDetails = useCallback((row: InventorySessionItemRow) => {
    setEditItemDetailsSessionItem(row);
    setEditItemDetailsForm({
      item_name: row.item_name || "",
      unit: row.unit || "",
      pack_size: row.pack_size || "",
    });
  }, []);

  const handleSaveEditItemDetails = useCallback(async () => {
    await handleSaveEditItemDetailsAction();
  }, [handleSaveEditItemDetailsAction]);

  const handleStaffParChangeRequestSubmit = useCallback(async () => {
    await handleStaffParChangeRequestSubmitAction();
  }, [handleStaffParChangeRequestSubmitAction]);

  const handleStaffPriceChangeRequestSubmit = useCallback(async () => {
    await handleStaffPriceChangeRequestSubmitAction();
  }, [handleStaffPriceChangeRequestSubmitAction]);

  const handleManagerParLevelSave = useCallback(async () => {
    await handleManagerParLevelSaveAction();
  }, [handleManagerParLevelSaveAction]);

  const handleManagerPriceSave = useCallback(async () => {
    await handleManagerPriceSaveAction();
  }, [handleManagerPriceSaveAction]);

  const getLastOrderDate = (itemName: string): string | null => {
    const cat = catalogLookup[itemName];
    if (!cat) return null;
    return lastOrderDates[cat.id] || null;
  };

  const getProductNumber = (item: InventorySessionItemRow): string | null =>
    getProductNumberHelper(item, catalogLookup);

  const formatLastOrdered = (date: string | null): string =>
    formatLastOrderedHelper(date);

  const { filteredItems, globalIndexByItemId, categories, groupedItems, sortedCategoryKeys } =
    useMemo(
      () =>
        buildInventoryView({
          items,
          filterCategory,
          search,
          showOnlyEmpty,
          statusFilter,
          categoryMode,
          hasMappings,
          mappedCategories,
          itemCategoryMap,
          approvedParArgs: {
            countingParGuideId,
            countingParByCatalogId,
            countingParByNormalizedName,
            approvedParMap,
            catalogDefaultParById,
            catalogDefaultParByName,
          },
          riskThresholds,
        }),
      [
        items,
        filterCategory,
        search,
        showOnlyEmpty,
        statusFilter,
        categoryMode,
        hasMappings,
        mappedCategories,
        itemCategoryMap,
        countingParGuideId,
        countingParByCatalogId,
        countingParByNormalizedName,
        approvedParMap,
        catalogDefaultParById,
        catalogDefaultParByName,
        riskThresholds,
      ],
    );

  const currentListId = activeSession?.inventory_list_id || selectedList || "";
  const selectedListName = lists.find((l) => l.id === currentListId)?.name || "";

  const jumpToNextEmpty = () => {
    const emptyItem = filteredItems.find(i => !i.current_stock || Number(i.current_stock) === 0);
    if (!emptyItem) {
      toast.info("All items have been counted!");
      return;
    }
    const cat = getItemCategory(emptyItem);
    const catItems = groupedItems[cat];
    const idx = catItems?.findIndex(i => i.id === emptyItem.id) ?? -1;
    const list = categoryVirtualListRefs.current[cat];
    if (list && idx >= 0) {
      list.scrollToRow({ align: "smart", index: idx });
    }
    requestAnimationFrame(() => {
      const input = inputRefs.current[emptyItem.id];
      input?.focus();
      if ((!list || idx < 0) && input) {
        input.scrollIntoView({ behavior: "smooth", block: "center" });
      }
    });
  };

  const handleKeyDown = (e: React.KeyboardEvent, currentIndex: number, field: "stock" = "stock") => {
    const getRef = (idx: number, f: string) => inputRefs.current[`${filteredItems[idx]?.id}_${f}`] || inputRefs.current[filteredItems[idx]?.id];

    if (e.key === "Enter" || e.key === "ArrowDown") {
      e.preventDefault();
      const next = getRef(currentIndex + 1, field);
      if (next) next.focus();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      const prev = getRef(currentIndex - 1, field);
      if (prev) prev.focus();
    } else if (e.key === "Tab") {
      if (!e.shiftKey && field === "stock") {
        e.preventDefault();
        const next = getRef(currentIndex + 1, "stock");
        if (next) next.focus();
      } else if (e.shiftKey && field === "stock") {
        e.preventDefault();
        const prev = getRef(currentIndex - 1, "stock");
        if (prev) prev.focus();
      }
    }
  };

  // Progress for active editor
  const countedItems = items.filter(i => i.current_stock !== null && Number(i.current_stock) > 0).length;
  const totalItems = items.length;
  const progressPct = totalItems > 0 ? Math.round((countedItems / totalItems) * 100) : 0;

  // Submit summary stats
  const submitSummary = useMemo(
    () =>
      buildSubmitSummary(
        items,
        {
          countingParGuideId,
          countingParByCatalogId,
          countingParByNormalizedName,
          approvedParMap,
          catalogDefaultParById,
          catalogDefaultParByName,
        },
        riskThresholds,
      ),
    [
      items,
      countingParGuideId,
      countingParByCatalogId,
      countingParByNormalizedName,
      approvedParMap,
      catalogDefaultParById,
      catalogDefaultParByName,
      riskThresholds,
    ],
  );

  if (!activeSession && loading && (lists.length === 0 || !sessionsLoaded)) {
    return (
      <div className="space-y-6 animate-fade-in">
        <Skeleton className="h-6 w-40" />
        <Skeleton className="h-10 w-64" />
        {[1, 2, 3].map((i) => <Skeleton key={i} className="h-40 rounded-xl" />)}
      </div>
    );
  }


  // ─── SESSION EDITOR ────────────────────────────
  if (activeSession) {
    const useCompactLayout = isCompact || viewToggle === "compact";
    const isCountingEditable =
      activeSession.status !== "IN_REVIEW" && activeSession.status !== "APPROVED";
    /** Category order + stock status filters — managers always; staff when not in active count edit. */
    const showAdvancedListControls = isManagerOrOwner || !isCountingEditable;
    const sessionModeBadge =
      activeSession.status === "IN_PROGRESS"
        ? { label: "Counting", className: "border-amber-500/40 bg-amber-500/12 text-amber-950 dark:text-amber-100" }
        : activeSession.status === "IN_REVIEW"
          ? { label: "In review", className: "border-sky-500/35 bg-sky-500/10 text-sky-950 dark:text-sky-100" }
          : activeSession.status === "APPROVED"
            ? { label: "Approved", className: "border-emerald-500/40 bg-emerald-500/10 text-emerald-950 dark:text-emerald-100" }
            : { label: activeSession.status, className: "border-border bg-muted/50 text-muted-foreground" };

    const resolveCountingParDisplay = (item: InventorySessionItemRow): number | null =>
      resolveCountingParDisplayHelper(
        item,
        parColumnVisible,
        countingParGuideId,
        countingParByCatalogId,
        countingParByNormalizedName,
      );

    const resolveStoredGuideParValue = (item: InventorySessionItemRow): number | null =>
      resolveCountingParDisplayHelper(
        item,
        true,
        countingParGuideId,
        countingParByCatalogId,
        countingParByNormalizedName,
      );

    const formatParColumnCell = (item: InventorySessionItemRow) =>
      formatParColumnCellHelper(
        item,
        parColumnVisible,
        countingParGuideId,
        countingParByCatalogId,
        countingParByNormalizedName,
      );

    const renderRowActionsMenu = (item: InventorySessionItemRow) => (
      <DropdownMenu>
        <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
          <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground shrink-0">
            <MoreVertical className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56" onClick={(e) => e.stopPropagation()}>
          <DropdownMenuItem
            disabled={!isCountingEditable}
            onClick={(e) => {
              e.stopPropagation();
              openEditItemDetails(item);
            }}
          >
            <Pencil className="h-4 w-4 mr-2" /> Edit item details
          </DropdownMenuItem>
          {isStaffMenu && (
            <>
              <DropdownMenuItem
                onClick={(e) => {
                  e.stopPropagation();
                  setStaffParRequestItem(item);
                  setStaffParSuggested("");
                  setStaffParReason("");
                }}
              >
                <ClipboardList className="h-4 w-4 mr-2" /> Request PAR change
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={(e) => {
                  e.stopPropagation();
                  setStaffPriceRequestItem(item);
                  setStaffPriceSuggested("");
                  setStaffPriceReason("");
                }}
              >
                <DollarSign className="h-4 w-4 mr-2" /> Request price change
              </DropdownMenuItem>
            </>
          )}
          {isManagerOrOwner && (
            <>
              <DropdownMenuItem
                disabled={!isCountingEditable}
                onClick={(e) => {
                  e.stopPropagation();
                  setManagerParEditItem(item);
                  setManagerParInput(String(getApprovedPar(item)));
                }}
              >
                <BarChart3 className="h-4 w-4 mr-2" /> Edit PAR level
              </DropdownMenuItem>
              <DropdownMenuItem
                disabled={!isCountingEditable}
                onClick={(e) => {
                  e.stopPropagation();
                  setManagerPriceEditItem(item);
                  const p = item.unit_cost;
                  setManagerPriceInput(p != null && p !== "" ? String(p) : "");
                }}
              >
                <DollarSign className="h-4 w-4 mr-2" /> Edit price
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    );

    return (
      <div className="space-y-0 animate-fade-in pb-28 lg:pb-4">
        {/* ═══ STICKY TOP CONTROL BAR ═══ */}
        <div className="sticky top-0 z-20 bg-background/95 backdrop-blur-sm -mx-4 px-4 lg:-mx-0 lg:px-0 border-b border-border/40">
          {/* Row 1: Identity + Location + Submit */}
          <div className="flex items-center gap-3 py-3">
            <Button variant="ghost" size="icon" className="h-9 w-9 shrink-0 rounded-lg" onClick={handleLeaveEditorToHub}>
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <div className="min-w-0 flex-1">
              <div className="flex items-start gap-2 min-w-0">
                <Badge
                  variant="outline"
                  className={`shrink-0 mt-0.5 text-[10px] font-semibold uppercase tracking-wide ${sessionModeBadge.className}`}
                >
                  {sessionModeBadge.label}
                </Badge>
                <h1 className="text-base lg:text-lg font-bold tracking-tight truncate min-w-0 flex-1">{activeSession.name}</h1>
              </div>
              <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                <span className="text-xs text-muted-foreground truncate">
                  {selectedListName ? `List: ${selectedListName}` : ""}
                </span>
                <button
                  type="button"
                  className="text-xs font-medium text-primary hover:underline shrink-0"
                  onClick={handleLeaveEditorToHub}
                >
                  Back to hub
                </button>
                {locations.length > 1 && currentLocation && (
                  <Badge variant="outline" className="text-[10px] gap-1 shrink-0 font-normal">
                    <MapPin className="h-2.5 w-2.5" />
                    {currentLocation.name}
                  </Badge>
                )}
              </div>
              {isManagerOrOwner ? (
                <p className="text-[11px] text-muted-foreground mt-1 truncate">
                  {parColumnVisible && countingParGuideName
                    ? `Showing PAR from “${countingParGuideName}” (read-only)`
                    : countingParGuideName
                      ? `PAR guide for this count: “${countingParGuideName}”. Open ⋯ → Show PAR to view the column.`
                      : "PAR is optional — ⋯ menu → Show PAR to pick a guide and view levels while counting."}
                </p>
              ) : parColumnVisible && countingParGuideName ? (
                <p className="text-[11px] text-muted-foreground mt-1 truncate">
                  PAR reference: “{countingParGuideName}”
                </p>
              ) : null}
            </div>

            {/* Save status */}
            <div className="shrink-0 min-w-[50px] text-right hidden lg:block">
              {savingId && <span className="text-xs text-muted-foreground animate-pulse">Saving…</span>}
              {!savingId && savedId && <span className="text-xs text-success flex items-center gap-1 justify-end"><Check className="h-3.5 w-3.5" /> Saved</span>}
            </div>

            {/* Submit — sticky visible on desktop */}
            <Button
              onClick={() => setSubmitConfirmOpen(true)}
              className="bg-gradient-amber shadow-amber gap-2 h-9 px-5 text-sm shrink-0 hidden lg:flex"
              disabled={!isCountingEditable || items.length === 0}
              aria-label={isCountingEditable ? "Submit count for manager review" : "Submit for review unavailable"}
              title={isCountingEditable ? "Send this count to a manager for review" : undefined}
            >
              <Send className="h-3.5 w-3.5" /> Submit for review
            </Button>
          </div>

          {/* Row 2: Search + Category pills + Progress + Filters */}
          <div className="flex items-center gap-3 pb-3 flex-wrap lg:flex-nowrap">
            {/* LEFT: Search */}
            <div className="relative min-w-[180px] lg:min-w-[240px] lg:max-w-xs">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground/60" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search items…"
                className="pl-9 h-10 text-sm bg-card border-border/50"
              />
            </div>

            {/* Staff: shelf order vs A–Z only (list management / shelf order = list_order) */}
            {isStaffMenu && (
              <ToggleGroup
                type="single"
                value={categoryMode === "alphabetic" ? "alphabetic" : "list_order"}
                onValueChange={(v) => {
                  if (v === "list_order" || v === "alphabetic") {
                    setCategoryMode(v);
                    setFilterCategory("all");
                  }
                }}
                className="inline-flex h-10 shrink-0 rounded-lg border border-border/50 bg-muted/40 p-0.5"
                aria-label="Item order"
              >
                <ToggleGroupItem
                  value="list_order"
                  aria-label="Shelf order"
                  className="h-9 px-2.5 text-xs data-[state=on]:bg-background data-[state=on]:shadow-sm"
                >
                  Shelf order
                </ToggleGroupItem>
                <ToggleGroupItem
                  value="alphabetic"
                  aria-label="Alphabetical A to Z"
                  className="h-9 px-2.5 text-xs data-[state=on]:bg-background data-[state=on]:shadow-sm"
                >
                  A–Z
                </ToggleGroupItem>
              </ToggleGroup>
            )}

            {/* Category grouping — managers only (full options); staff use toggle above */}
            {showAdvancedListControls && !isStaffMenu && (
              <Select value={categoryMode} onValueChange={(v) => { setCategoryMode(v); setFilterCategory("all"); }}>
                <SelectTrigger className="h-10 w-[170px] text-xs">
                  <ListOrdered className="h-3.5 w-3.5 mr-1.5 shrink-0" />
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="list_order">List Order</SelectItem>
                  <SelectItem value="custom-categories">AI Categories</SelectItem>
                  <SelectItem value="my-categories">My Categories</SelectItem>
                  <SelectItem value="alphabetic">Alphabetic</SelectItem>
                </SelectContent>
              </Select>
            )}

            {/* CENTER: Progress — desktop */}
            <div className="hidden lg:flex items-center gap-3 mx-auto shrink-0">
              <div className="text-center">
                <p className="text-sm font-bold tabular-nums">{countedItems} <span className="text-muted-foreground font-normal">/ {totalItems}</span></p>
                <p className="text-[10px] text-muted-foreground uppercase tracking-wide">counted</p>
              </div>
              <div className="w-32 h-2 rounded-full bg-muted/60 overflow-hidden">
                <div
                  className="h-full rounded-full bg-gradient-amber transition-all duration-500"
                  style={{ width: `${progressPct}%` }}
                />
              </div>
              <span className="text-xs font-medium tabular-nums text-muted-foreground">{progressPct}%</span>
            </div>

            {/* RIGHT: Filters + Actions */}
            <div className="hidden lg:flex items-center gap-2 ml-auto shrink-0">
              {showAdvancedListControls && (
                <Select
                  value={statusFilter}
                  onValueChange={(v) => setStatusFilter(v as typeof statusFilter)}
                >
                  <SelectTrigger className="h-9 w-[130px] text-xs">
                    <Filter className="h-3.5 w-3.5 mr-1.5" />
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Show All</SelectItem>
                    <SelectItem value="uncounted">Uncounted</SelectItem>
                    <SelectItem value="low">Low Stock</SelectItem>
                    <SelectItem value="critical">Critical</SelectItem>
                  </SelectContent>
                </Select>
              )}

              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="icon" className="h-9 w-9">
                    <MoreHorizontal className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem
                    onClick={() => {
                      if (parColumnVisible) setParColumnVisible(false);
                      else if (!countingParGuideId) void openParGuidePicker();
                      else setParColumnVisible(true);
                    }}
                  >
                    {parColumnVisible ? (
                      <><EyeOff className="h-3.5 w-3.5 mr-2" /> Hide PAR</>
                    ) : (
                      <><Eye className="h-3.5 w-3.5 mr-2" /> Show PAR</>
                    )}
                  </DropdownMenuItem>
                  {!parColumnVisible && countingParGuideId && (
                    <DropdownMenuItem onClick={() => void openParGuidePicker()}>
                      <BookOpen className="h-3.5 w-3.5 mr-2" /> Change PAR guide…
                    </DropdownMenuItem>
                  )}
                  {staffCountingFocus && (
                    <>
                      <DropdownMenuSeparator />
                      <DropdownMenuLabel>Stock filter</DropdownMenuLabel>
                      <DropdownMenuRadioGroup
                        value={statusFilter}
                        onValueChange={(v) => setStatusFilter(v as typeof statusFilter)}
                      >
                        <DropdownMenuRadioItem value="all">All items</DropdownMenuRadioItem>
                        <DropdownMenuRadioItem value="uncounted">Uncounted only</DropdownMenuRadioItem>
                        <DropdownMenuRadioItem value="low">Low stock</DropdownMenuRadioItem>
                        <DropdownMenuRadioItem value="critical">Critical</DropdownMenuRadioItem>
                      </DropdownMenuRadioGroup>
                    </>
                  )}
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    disabled={!isCountingEditable}
                    onClick={() => isCountingEditable && setClearEntriesSessionId(activeSession.id)}
                  >
                    <Eraser className="h-3.5 w-3.5 mr-2" /> Clear entries
                  </DropdownMenuItem>
                  <Dialog open={createOpen} onOpenChange={setCreateOpen}>
                    <DialogTrigger asChild>
                      <DropdownMenuItem onSelect={(e) => e.preventDefault()} disabled={!isCountingEditable}>
                        <Plus className="h-3.5 w-3.5 mr-2" /> Add item
                      </DropdownMenuItem>
                    </DialogTrigger>
                  </Dialog>
                  {catalogItems.length > 0 && (
                    <DropdownMenuItem disabled={!isCountingEditable} onClick={() => isCountingEditable && setCatalogOpen(true)}>
                      <BookOpen className="h-3.5 w-3.5 mr-2" /> Add from catalog
                    </DropdownMenuItem>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>

            {/* Same ⋯ actions on small screens (toolbar row is wrapped) */}
            <div className="flex lg:hidden items-center gap-2 w-full justify-end">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="icon" className="h-9 w-9">
                    <MoreHorizontal className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem
                    onClick={() => {
                      if (parColumnVisible) setParColumnVisible(false);
                      else if (!countingParGuideId) void openParGuidePicker();
                      else setParColumnVisible(true);
                    }}
                  >
                    {parColumnVisible ? (
                      <><EyeOff className="h-3.5 w-3.5 mr-2" /> Hide PAR</>
                    ) : (
                      <><Eye className="h-3.5 w-3.5 mr-2" /> Show PAR</>
                    )}
                  </DropdownMenuItem>
                  {!parColumnVisible && countingParGuideId && (
                    <DropdownMenuItem onClick={() => void openParGuidePicker()}>
                      <BookOpen className="h-3.5 w-3.5 mr-2" /> Change PAR guide…
                    </DropdownMenuItem>
                  )}
                  {staffCountingFocus && (
                    <>
                      <DropdownMenuSeparator />
                      <DropdownMenuLabel>Stock filter</DropdownMenuLabel>
                      <DropdownMenuRadioGroup
                        value={statusFilter}
                        onValueChange={(v) => setStatusFilter(v as typeof statusFilter)}
                      >
                        <DropdownMenuRadioItem value="all">All items</DropdownMenuRadioItem>
                        <DropdownMenuRadioItem value="uncounted">Uncounted only</DropdownMenuRadioItem>
                        <DropdownMenuRadioItem value="low">Low stock</DropdownMenuRadioItem>
                        <DropdownMenuRadioItem value="critical">Critical</DropdownMenuRadioItem>
                      </DropdownMenuRadioGroup>
                    </>
                  )}
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    disabled={!isCountingEditable}
                    onClick={() => isCountingEditable && setClearEntriesSessionId(activeSession.id)}
                  >
                    <Eraser className="h-3.5 w-3.5 mr-2" /> Clear entries
                  </DropdownMenuItem>
                  <Dialog open={createOpen} onOpenChange={setCreateOpen}>
                    <DialogTrigger asChild>
                      <DropdownMenuItem onSelect={(e) => e.preventDefault()} disabled={!isCountingEditable}>
                        <Plus className="h-3.5 w-3.5 mr-2" /> Add item
                      </DropdownMenuItem>
                    </DialogTrigger>
                  </Dialog>
                  {catalogItems.length > 0 && (
                    <DropdownMenuItem disabled={!isCountingEditable} onClick={() => isCountingEditable && setCatalogOpen(true)}>
                      <BookOpen className="h-3.5 w-3.5 mr-2" /> Add from catalog
                    </DropdownMenuItem>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
        </div>

        {!isCountingEditable && (
          <div className="rounded-lg border border-border/50 bg-muted/30 px-4 py-3">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline" className={`text-[10px] font-semibold uppercase tracking-wide ${sessionModeBadge.className}`}>
                {sessionModeBadge.label}
              </Badge>
              <span className="text-sm font-medium text-foreground">View only</span>
            </div>
            <p className="text-sm text-muted-foreground mt-1.5">
              This count is locked. Open it from Inventory Review or Approved Inventory for full detail and actions.
            </p>
          </div>
        )}

        {/* ═══ MOBILE PROGRESS BAR ═══ */}
        {isCompact && totalItems > 0 && (
          <div className="py-3 px-1">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-sm font-bold tabular-nums">{countedItems} / {totalItems} <span className="font-normal text-muted-foreground">counted</span></span>
              <span className="text-xs font-medium text-muted-foreground tabular-nums">{progressPct}%</span>
            </div>
            <div className="h-2 rounded-full bg-muted/60 overflow-hidden">
              <div className="h-full rounded-full bg-gradient-amber transition-all duration-500" style={{ width: `${progressPct}%` }} />
            </div>
          </div>
        )}

        {/* ═══ MAIN CONTENT ═══ */}
        {filteredItems.length === 0 ? (
          <div className="rounded-xl border border-border/40 bg-card mt-4">
            <div className="py-16 text-center">
              <Package className="h-12 w-12 text-muted-foreground/20 mx-auto mb-4" />
              <p className="text-sm font-medium text-muted-foreground">No items match your filters</p>
              <p className="text-xs text-muted-foreground/70 mt-1 max-w-xs mx-auto">Try adjusting your search or category filter, or add new items.</p>
              <Button variant="outline" className="mt-4 gap-1.5" onClick={() => { setSearch(""); setFilterCategory("all"); setStatusFilter("all"); }}>
                Clear Filters
              </Button>
            </div>
          </div>
        ) : useCompactLayout ? (
          /* ─── CARD LAYOUT (tablet/mobile or compact toggle) ─── */
          <div className="space-y-6 mt-2">
            {sortedCategoryKeys.map((category) => {
              const catItems = groupedItems[category];
              return (
                <div key={category}>
                  <div className="flex items-center gap-2 mb-3 px-1">
                    <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground/60">{category}</p>
                    <span className="text-[10px] text-muted-foreground/40 tabular-nums">({catItems.length})</span>
                  </div>
                  <div className="space-y-2.5">
                    {catItems.map((item) => {
                      const globalIdx = filteredItems.indexOf(item);
                      const rowPar = getApprovedPar(item);
                      const needQty = rowPar > 0 ? computeOrderQty(item.current_stock, rowPar, item.unit, item.pack_size) : null;
                      const risk = getRisk(item.current_stock, rowPar, riskThresholds);
                      const rowState = getRowState(item.current_stock);
                      const isRecentlyEdited = lastEditedId === item.id;

                      return (
                        <div
                          key={item.id}
                          className={`relative rounded-xl border transition-all duration-200 ${
                            rowState === "counted" ? "border-success/20 bg-success/[0.03]" :
                            rowState === "zero" ? "border-border/30 bg-muted/10" :
                            "border-border/40 bg-card"
                          } ${isRecentlyEdited ? "ring-2 ring-primary/20" : ""}`}
                        >
                          {/* Green checkmark overlay badge when counted */}
                          {rowState === "counted" && (
                            <div className="absolute top-3 right-3 z-10 pointer-events-none">
                              <CheckCircle className="h-4 w-4 text-success opacity-60" />
                            </div>
                          )}

                          <div className="p-4 space-y-3">
                            {/* Item identity */}
                            <div className="flex items-start justify-between gap-3">
                              <div className="min-w-0 flex-1">
                                <p className="font-semibold text-sm leading-tight">{item.item_name}</p>
                                <ItemIdentityBlock
                                  brandName={item.brand_name}
                                  className="block mt-0.5"
                                />
                                <div className="flex flex-wrap gap-x-2 gap-y-0.5 mt-1">
                                  {getProductNumber(item) && <span className="text-[10px] text-muted-foreground/50">#{getProductNumber(item)}</span>}
                                  {item.pack_size && <span className="text-[10px] text-muted-foreground/50">{item.pack_size}</span>}
                                  {!(isStaffMenu && isCountingEditable) && (
                                    <span className="text-[10px] text-muted-foreground/50">
                                      Last: {formatLastOrdered(getLastOrderDate(item.item_name))}
                                    </span>
                                  )}
                                </div>
                              </div>
                              <div className="flex items-center gap-1 shrink-0">
                                {renderRowActionsMenu(item)}
                                <Badge className={`${risk.bgClass} ${risk.textClass} border-0 text-[10px] font-medium shrink-0`}>
                                  {getRiskBadgeLabel(risk)}
                                </Badge>
                              </div>
                            </div>

                            {/* Count input area — large targets for tablet */}
                            <div className="flex items-end gap-4">
                              <div className="flex-1">
                                <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1.5 block">On Hand</label>
                                <div className="flex items-center gap-1.5">
                                  <Button
                                    type="button"
                                    variant="outline"
                                    size="icon"
                                    className="h-16 w-12 shrink-0 rounded-lg text-lg"
                                    disabled={!isCountingEditable}
                                    onClick={() => {
                                      const newVal = Math.max(0, Number(item.current_stock ?? 0) - 1);
                                      handleUpdateStock(item.id, String(newVal));
                                      handleSaveStock(item.id, newVal);
                                    }}
                                  >
                                    <Minus className="h-4 w-4" />
                                  </Button>
                                  <Input
                                    ref={el => { inputRefs.current[item.id] = el; }}
                                    inputMode="decimal"
                                    type="number"
                                    min={0}
                                    step={0.1}
                                    readOnly={!isCountingEditable}
                                    value={inputDisplayValue(item.current_stock)}
                                    onFocus={(e) => e.target.select()}
                                    onChange={(e) => handleUpdateStock(item.id, e.target.value)}
                                    onBlur={async () => { await handleSaveStock(item.id, item.current_stock); jumpToNextEmpty(); }}
                                    onKeyDown={(e) => handleKeyDown(e, globalIdx, "stock")}
                                    className="h-16 text-xl font-mono text-center font-semibold rounded-lg border-2 border-border/60 focus:border-primary/50 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                                  />
                                  <Button
                                    type="button"
                                    variant="outline"
                                    size="icon"
                                    className="h-16 w-12 shrink-0 rounded-lg text-lg"
                                    disabled={!isCountingEditable}
                                    onClick={() => {
                                      const newVal = Number(item.current_stock ?? 0) + 1;
                                      handleUpdateStock(item.id, String(newVal));
                                      handleSaveStock(item.id, newVal);
                                    }}
                                  >
                                    <Plus className="h-4 w-4" />
                                  </Button>
                                </div>
                              </div>
                              {parColumnVisible && (
                                <div className="shrink-0 text-center w-16">
                                  <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1.5 block">PAR</label>
                                  <p className="h-16 flex items-center justify-center text-lg font-mono text-muted-foreground/70">
                                    {formatParColumnCell(item)}
                                  </p>
                                </div>
                              )}
                              {needQty !== null && (
                                <div className="shrink-0 text-center w-16">
                                  <label className="text-[10px] font-semibold text-warning uppercase tracking-wider mb-1.5 block">Need</label>
                                  <p className={`h-16 flex items-center justify-center text-lg font-mono font-bold ${needQty > 0 ? "text-warning" : "text-muted-foreground/60"}`}>
                                    {formatNum(needQty)}
                                  </p>
                                </div>
                              )}
                            </div>

                            {/* Save indicator */}
                            {(savingId === item.id || savedId === item.id) && (
                              <div className="flex items-center gap-1.5">
                                {savingId === item.id && <span className="text-[10px] text-muted-foreground animate-pulse">Saving…</span>}
                                {savedId === item.id && <span className="text-[10px] text-success flex items-center gap-0.5"><Check className="h-3 w-3" /> Saved</span>}
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          /* ─── TABLE LAYOUT (desktop standard) — virtualized ─── */
          <div ref={sessionListWidthRef} className="mt-4 space-y-6">
            {sortedCategoryKeys.map((category) => {
              const catItems = groupedItems[category];
              return (
                <div key={category} className="rounded-xl border border-border/40 overflow-hidden bg-card">
                  {/* Category header */}
                  <div className="px-5 py-3 bg-muted/30 border-b border-border/30">
                    <div className="flex items-center gap-2">
                      <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground/70">{category}</p>
                      <span className="text-[10px] text-muted-foreground/40 tabular-nums">({catItems.length})</span>
                    </div>
                  </div>
                  <SessionDesktopCategoryList
                    catItems={catItems}
                    listWidth={sessionListWidth}
                    globalIndexByItemId={globalIndexByItemId}
                    riskThresholds={riskThresholds}
                    parColumnVisible={parColumnVisible}
                    simplifyCountingRow={staffCountingFocus}
                    isCountingEditable={isCountingEditable}
                    onUpdateStock={handleUpdateStock}
                    onSaveStock={handleSaveStock}
                    onKeyDown={handleKeyDown}
                    inputRefs={inputRefs}
                    formatParColumnCell={formatParColumnCell}
                    getProductNumber={getProductNumber}
                    formatLastOrdered={formatLastOrdered}
                    getLastOrderDate={getLastOrderDate}
                    renderRowActionsMenu={renderRowActionsMenu}
                    savingId={savingId}
                    savedId={savedId}
                    lastEditedId={lastEditedId}
                    getApprovedPar={getApprovedPar}
                    registerListRef={(instance) => {
                      categoryVirtualListRefs.current[category] = instance;
                    }}
                  />
                </div>
              );
            })}
          </div>
        )}

        {/* ═══ TABLET/MOBILE STICKY BOTTOM BAR ═══ */}
        {isCompact && (
          <div className="fixed bottom-0 left-0 right-0 z-30 bg-background/95 backdrop-blur-md border-t border-border/40 safe-area-bottom">
            <div className="flex items-center gap-3 px-4 py-3">
              {/* Progress mini */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <div className="h-1.5 flex-1 rounded-full bg-muted/60 overflow-hidden">
                    <div className="h-full rounded-full bg-gradient-amber transition-all" style={{ width: `${progressPct}%` }} />
                  </div>
                  <span className="text-[10px] font-medium text-muted-foreground tabular-nums shrink-0">{countedItems}/{totalItems}</span>
                </div>
              </div>

              {/* Quick filter */}
              <Button
                variant={showOnlyEmpty ? "default" : "outline"}
                size="sm"
                className={`h-10 text-xs shrink-0 ${showOnlyEmpty ? "bg-foreground text-background" : ""}`}
                onClick={() => setShowOnlyEmpty(!showOnlyEmpty)}
              >
                Uncounted
              </Button>

              {/* Submit */}
              <Button
                className="bg-gradient-amber shadow-amber h-11 px-5 text-sm font-medium shrink-0"
                onClick={() => setSubmitConfirmOpen(true)}
                disabled={!isCountingEditable || items.length === 0}
                aria-label={isCountingEditable ? "Submit count for manager review" : "Submit unavailable"}
                title={isCountingEditable ? "Send this count to a manager for review" : undefined}
              >
                <Send className="h-4 w-4 mr-1.5" /> Submit
              </Button>
            </div>
          </div>
        )}

        {/* ═══ SUBMIT CONFIRMATION MODAL ═══ */}
        <AlertDialog open={submitConfirmOpen} onOpenChange={setSubmitConfirmOpen}>
          <AlertDialogContent className="max-w-md">
            <AlertDialogHeader>
              <AlertDialogTitle className="text-lg">Submit for Review?</AlertDialogTitle>
              <AlertDialogDescription className="text-sm">
                This will send the inventory count to a manager for review.
              </AlertDialogDescription>
            </AlertDialogHeader>

            {/* Summary cards */}
            <div className="grid grid-cols-2 gap-3 my-2">
              <div className="rounded-lg bg-muted/30 p-3 text-center">
                <p className="text-2xl font-bold tabular-nums">{submitSummary.counted}</p>
                <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">Items Counted</p>
              </div>
              <div className="rounded-lg bg-muted/30 p-3 text-center">
                <p className="text-2xl font-bold tabular-nums">{submitSummary.total - submitSummary.counted}</p>
                <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">Uncounted</p>
              </div>
              <div className="rounded-lg bg-warning/10 p-3 text-center">
                <p className="text-2xl font-bold text-warning tabular-nums">{submitSummary.lowCount}</p>
                <p className="text-[10px] font-medium text-warning uppercase tracking-wide">Low Stock</p>
              </div>
              <div className="rounded-lg bg-destructive/10 p-3 text-center">
                <p className="text-2xl font-bold text-destructive tabular-nums">{submitSummary.criticalCount}</p>
                <p className="text-[10px] font-medium text-destructive uppercase tracking-wide">Critical</p>
              </div>
            </div>

            {submitSummary.estimatedValue > 0 && (
              <div className="rounded-lg border border-border/40 p-3 text-center">
                <p className="text-xs text-muted-foreground">Estimated Reorder Value</p>
                <p className="text-lg font-bold tabular-nums">${submitSummary.estimatedValue.toFixed(2)}</p>
              </div>
            )}

            <AlertDialogFooter className="mt-2">
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={() => { setSubmitConfirmOpen(false); handleSubmitForReview(); }} className="bg-gradient-amber">
                Confirm Submit
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {/* Add Item Dialog */}
        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <DialogContent>
            <DialogHeader><DialogTitle>Add Item</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div className="space-y-1"><Label>Item Name</Label><Input value={newItem.item_name} onChange={(e) => setNewItem({ ...newItem, item_name: e.target.value })} className="h-10" /></div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1"><Label>Category</Label>
                  <Select value={newItem.category} onValueChange={(v) => setNewItem({ ...newItem, category: v })}>
                    <SelectTrigger className="h-10"><SelectValue /></SelectTrigger>
                    <SelectContent>{defaultCategories.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div className="space-y-1"><Label>Unit</Label><Input value={newItem.unit} onChange={(e) => setNewItem({ ...newItem, unit: e.target.value })} placeholder="lbs, packs..." className="h-10" /></div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1"><Label>On hand</Label><Input type="number" value={newItem.current_stock} onChange={(e) => setNewItem({ ...newItem, current_stock: +e.target.value })} className="h-10" /></div>
                <div className="space-y-1"><Label>Unit cost</Label><Input type="number" value={newItem.unit_cost} onChange={(e) => setNewItem({ ...newItem, unit_cost: +e.target.value })} className="h-10" /></div>
              </div>
              <p className="text-[11px] text-muted-foreground">PAR comes from the linked PAR guide (or defaults) and is not edited during counting.</p>
              <Button onClick={handleAddItem} className="w-full bg-gradient-amber" disabled={!isCountingEditable}>Add</Button>
            </div>
          </DialogContent>
        </Dialog>

        {/* Catalog Dialog */}
        {catalogItems.length > 0 && (
          <Dialog open={catalogOpen} onOpenChange={setCatalogOpen}>
            <DialogContent className="max-w-lg">
              <DialogHeader><DialogTitle>Add from Catalog</DialogTitle></DialogHeader>
              <div className="max-h-80 overflow-y-auto space-y-0.5">
                {catalogItems.map((ci) =>
                  <div key={ci.id} className="flex items-center justify-between py-2.5 px-3 rounded-lg hover:bg-muted/50 transition-colors">
                    <div>
                      <p className="text-sm font-medium">{ci.item_name}</p>
                      <p className="text-[11px] text-muted-foreground">{[ci.category, ci.unit, ci.vendor_name].filter(Boolean).join(" · ")}</p>
                    </div>
                    <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => handleAddFromCatalog(ci)}><Plus className="h-4 w-4" /></Button>
                  </div>
                )}
              </div>
            </DialogContent>
          </Dialog>
        )}

        {/* PAR guide picker (Show PAR when no guide chosen yet, or Change PAR guide) */}
        <Dialog open={parGuidePickerOpen} onOpenChange={setParGuidePickerOpen}>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>Which PAR guide do you want to use?</DialogTitle>
              <DialogDescription>
                Guides for this restaurant are shown below. Guides linked to this inventory list are listed first.
              </DialogDescription>
            </DialogHeader>
            {parGuidesPickerOptions.length === 0 ? (
              <p className="text-sm text-muted-foreground py-2">
                No PAR guides were found. Create and edit guides in PAR Management, then return here to show PAR while counting.
              </p>
            ) : (
              <div className="max-h-80 overflow-y-auto space-y-0.5 pr-1">
                {parGuidesPickerOptions.map((g) => {
                  const forThisList = g.inventory_list_id === activeSession.inventory_list_id;
                  return (
                    <button
                      key={g.id}
                      type="button"
                      className="w-full flex items-center justify-between gap-2 py-2.5 px-3 rounded-lg hover:bg-muted/50 text-left text-sm transition-colors border border-transparent hover:border-border/50"
                      onClick={() => void applyParGuideSelection(g.id)}
                    >
                      <span className="font-medium truncate">{g.name?.trim() || "Untitled guide"}</span>
                      {forThisList ? (
                        <Badge variant="secondary" className="shrink-0 text-[10px] font-normal">
                          This list
                        </Badge>
                      ) : g.inventory_list_id ? (
                        <span className="text-[11px] text-muted-foreground shrink-0">Other list</span>
                      ) : null}
                    </button>
                  );
                })}
              </div>
            )}
            <DialogFooter className="gap-2 sm:gap-0">
              <Button type="button" variant="outline" onClick={() => setParGuidePickerOpen(false)}>
                Cancel
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Clear Entries Confirm */}
        <AlertDialog open={!!clearEntriesSessionId} onOpenChange={(o) => !o && setClearEntriesSessionId(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Clear all entries?</AlertDialogTitle>
              <AlertDialogDescription>This will reset all current stock values to 0 for this session. The item rows will be kept so you can recount.</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={handleClearEntries} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">Clear Entries</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {/* Row ⋮ sheets: item details, staff requests, manager PAR/price */}
        <Sheet
          open={!!editItemDetailsSessionItem}
          onOpenChange={(o) => {
            if (!o) setEditItemDetailsSessionItem(null);
          }}
        >
          <SheetContent side="right" className="w-full sm:max-w-sm flex flex-col">
            <SheetHeader>
              <SheetTitle>Edit item details</SheetTitle>
              {editItemDetailsSessionItem && (
                <p className="text-xs text-muted-foreground">Session line — name, unit, and pack size</p>
              )}
            </SheetHeader>
            <div className="flex-1 py-6 space-y-4">
              <div className="space-y-1"><Label>Item name</Label><Input className="h-10" value={editItemDetailsForm.item_name} onChange={(e) => setEditItemDetailsForm((f) => ({ ...f, item_name: e.target.value }))} /></div>
              <div className="space-y-1"><Label>Unit</Label><Input className="h-10" placeholder="lb, case…" value={editItemDetailsForm.unit} onChange={(e) => setEditItemDetailsForm((f) => ({ ...f, unit: e.target.value }))} /></div>
              <div className="space-y-1"><Label>Pack size</Label><Input className="h-10" value={editItemDetailsForm.pack_size} onChange={(e) => setEditItemDetailsForm((f) => ({ ...f, pack_size: e.target.value }))} /></div>
            </div>
            <SheetFooter className="flex flex-col gap-2 pt-2">
              <Button className="w-full bg-gradient-amber" disabled={editItemDetailsSaving || !isCountingEditable} onClick={() => void handleSaveEditItemDetails()}>
                {editItemDetailsSaving ? "Saving…" : "Save"}
              </Button>
              <Button variant="outline" className="w-full" onClick={() => setEditItemDetailsSessionItem(null)}>Cancel</Button>
            </SheetFooter>
          </SheetContent>
        </Sheet>

        <Sheet open={!!staffParRequestItem} onOpenChange={(o) => { if (!o) setStaffParRequestItem(null); }}>
          <SheetContent side="right" className="w-full sm:max-w-sm flex flex-col">
            <SheetHeader>
              <SheetTitle>Request PAR change</SheetTitle>
              {staffParRequestItem && <p className="text-sm text-muted-foreground truncate">{staffParRequestItem.item_name}</p>}
            </SheetHeader>
            <div className="flex-1 py-6 space-y-4">
              <div className="rounded-lg border border-border/50 bg-muted/30 px-3 py-2 text-sm">
                <span className="text-muted-foreground">Current PAR: </span>
                <span className="font-mono font-semibold tabular-nums">
                  {staffParRequestItem ? formatNum(getApprovedPar(staffParRequestItem)) : "—"}
                </span>
              </div>
              <div className="space-y-1"><Label>Suggested PAR</Label><Input type="number" min={0} step={0.1} className="h-10" value={staffParSuggested} onChange={(e) => setStaffParSuggested(e.target.value)} /></div>
              <div className="space-y-1"><Label>Reason <span className="text-muted-foreground font-normal">(optional)</span></Label><Textarea className="min-h-[72px]" value={staffParReason} onChange={(e) => setStaffParReason(e.target.value)} placeholder="e.g. sales increased…" /></div>
            </div>
            <SheetFooter className="flex flex-col gap-2 pt-2">
              <Button className="w-full bg-gradient-amber" disabled={staffParSending} onClick={() => void handleStaffParChangeRequestSubmit()}>{staffParSending ? "Sending…" : "Submit request"}</Button>
              <Button variant="outline" className="w-full" onClick={() => setStaffParRequestItem(null)}>Cancel</Button>
            </SheetFooter>
          </SheetContent>
        </Sheet>

        <Sheet open={!!staffPriceRequestItem} onOpenChange={(o) => { if (!o) setStaffPriceRequestItem(null); }}>
          <SheetContent side="right" className="w-full sm:max-w-sm flex flex-col">
            <SheetHeader>
              <SheetTitle>Request price change</SheetTitle>
              {staffPriceRequestItem && <p className="text-sm text-muted-foreground truncate">{staffPriceRequestItem.item_name}</p>}
            </SheetHeader>
            <div className="flex-1 py-6 space-y-4">
              <div className="rounded-lg border border-border/50 bg-muted/30 px-3 py-2 text-sm">
                <span className="text-muted-foreground">Current price: </span>
                <span className="font-mono font-semibold tabular-nums">
                  {staffPriceRequestItem
                    ? (() => {
                        const p = staffPriceRequestItem.unit_cost;
                        if (p != null && p !== "" && Number.isFinite(Number(p))) return `$${Number(p).toFixed(2)}`;
                        const d = getCatalogUnitCost(staffPriceRequestItem.catalog_item_id);
                        return d != null ? `$${d.toFixed(2)}` : "—";
                      })()
                    : "—"}
                </span>
              </div>
              <div className="space-y-1"><Label>Suggested price ($)</Label><Input type="number" min={0} step={0.01} className="h-10" value={staffPriceSuggested} onChange={(e) => setStaffPriceSuggested(e.target.value)} /></div>
              <div className="space-y-1"><Label>Reason <span className="text-muted-foreground font-normal">(optional)</span></Label><Textarea className="min-h-[72px]" value={staffPriceReason} onChange={(e) => setStaffPriceReason(e.target.value)} /></div>
            </div>
            <SheetFooter className="flex flex-col gap-2 pt-2">
              <Button className="w-full bg-gradient-amber" disabled={staffPriceSending} onClick={() => void handleStaffPriceChangeRequestSubmit()}>{staffPriceSending ? "Sending…" : "Submit request"}</Button>
              <Button variant="outline" className="w-full" onClick={() => setStaffPriceRequestItem(null)}>Cancel</Button>
            </SheetFooter>
          </SheetContent>
        </Sheet>

        <Sheet open={!!managerParEditItem} onOpenChange={(o) => { if (!o) setManagerParEditItem(null); }}>
          <SheetContent side="right" className="w-full sm:max-w-sm flex flex-col">
            <SheetHeader>
              <SheetTitle>Edit PAR level</SheetTitle>
              {managerParEditItem && <p className="text-sm text-muted-foreground truncate">{managerParEditItem.item_name}</p>}
            </SheetHeader>
            <p className="text-xs text-muted-foreground">Updates the linked PAR guide and catalog default PAR.</p>
            {isManagerOrOwner && countingParGuideId && activeSession?.inventory_list_id && managerParEditItem && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="w-full gap-2 mt-2 text-xs"
                onClick={() => {
                  const q = new URLSearchParams({
                    guide: countingParGuideId,
                    list: activeSession.inventory_list_id!,
                  });
                  if (managerParEditItem.item_name) q.set("focus", managerParEditItem.item_name);
                  navigate(`/app/par?${q.toString()}`);
                  setManagerParEditItem(null);
                }}
              >
                <ExternalLink className="h-3.5 w-3.5 shrink-0" />
                Fix PAR in guide
              </Button>
            )}
            <div className="flex-1 py-6 space-y-4">
              <div className="space-y-1"><Label>New PAR level</Label><Input type="number" min={0} step={0.1} className="h-10" value={managerParInput} onChange={(e) => setManagerParInput(e.target.value)} /></div>
            </div>
            <SheetFooter className="flex flex-col gap-2 pt-2">
              <Button className="w-full bg-gradient-amber" disabled={managerParSaving || !isCountingEditable} onClick={() => void handleManagerParLevelSave()}>{managerParSaving ? "Saving…" : "Save"}</Button>
              <Button variant="outline" className="w-full" onClick={() => setManagerParEditItem(null)}>Cancel</Button>
            </SheetFooter>
          </SheetContent>
        </Sheet>

        <Sheet open={!!managerPriceEditItem} onOpenChange={(o) => { if (!o) setManagerPriceEditItem(null); }}>
          <SheetContent side="right" className="w-full sm:max-w-sm flex flex-col">
            <SheetHeader>
              <SheetTitle>Edit price</SheetTitle>
              {managerPriceEditItem && <p className="text-sm text-muted-foreground truncate">{managerPriceEditItem.item_name}</p>}
            </SheetHeader>
            <p className="text-xs text-muted-foreground">Updates unit cost on this count and catalog default unit cost.</p>
            <div className="flex-1 py-6 space-y-4">
              <div className="space-y-1">
                <Label>Unit cost ($)</Label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">$</span>
                  <Input type="number" step="0.01" min={0} className="pl-7 h-10" value={managerPriceInput} onChange={(e) => setManagerPriceInput(e.target.value)} placeholder="0.00" />
                </div>
              </div>
            </div>
            <SheetFooter className="flex flex-col gap-2 pt-2">
              <Button className="w-full bg-orange-500 hover:bg-orange-600 text-white" disabled={managerPriceSaving || !isCountingEditable} onClick={() => void handleManagerPriceSave()}>{managerPriceSaving ? "Saving…" : "Save"}</Button>
              <Button variant="outline" className="w-full" onClick={() => setManagerPriceEditItem(null)}>Cancel</Button>
            </SheetFooter>
          </SheetContent>
        </Sheet>
      </div>
    );
  }


  // ─── MAIN DASHBOARD: COMMAND CENTER ──────────
  return (
    <div className="space-y-5 animate-fade-in">
      <Breadcrumb>
        <BreadcrumbList>
          <BreadcrumbItem><BreadcrumbLink href="/app/dashboard">Home</BreadcrumbLink></BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem><BreadcrumbPage>Inventory Management</BreadcrumbPage></BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>

      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <h1 className="text-xl lg:text-2xl font-bold tracking-tight">Inventory Management</h1>
          <p className="text-sm text-muted-foreground mt-1 max-w-xl">
            Manage counts, reviews, and history.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 shrink-0">
          {locations.length > 1 && (
            <Select value={currentLocation?.id || "all"} onValueChange={(v) => {
              if (v === "all") setCurrentLocation(null);
              else {
                const loc = locations.find(l => l.id === v);
                if (loc) setCurrentLocation(loc);
              }
            }}>
              <SelectTrigger className="h-10 w-44 text-xs gap-1.5">
                <MapPin className="h-3.5 w-3.5 shrink-0" />
                <SelectValue placeholder="All locations" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All locations</SelectItem>
                {locations.map(l => <SelectItem key={l.id} value={l.id}>{l.name}</SelectItem>)}
              </SelectContent>
            </Select>
          )}
          <Button className="bg-gradient-amber shadow-amber gap-2 h-10" onClick={handleHeaderStartOrContinue}>
            {landingFocus.focusInProgressSession ? (
              <><ChevronRight className="h-4 w-4" /> Continue count</>
            ) : (
              <><Play className="h-4 w-4" /> Start new count</>
            )}
          </Button>
        </div>
      </div>

      {/* ── NEXT SCHEDULED COUNT PANEL ── */}
      {nextSchedule && (() => {
        const status = getScheduleStatus(nextSchedule.nextDate);
        const statusConfig = {
          upcoming: { label: "Upcoming", cls: "bg-primary/10 text-primary border-primary/20" },
          ready:    { label: "Ready to Start", cls: "bg-success/10 text-success border-success/30" },
          overdue:  { label: "Overdue", cls: "bg-destructive/10 text-destructive border-destructive/30" },
        }[status];
        const existingSession = inProgressSessions.find(s => s.inventory_list_id === nextSchedule.inventory_list_id);
        return (
          <div className={`rounded-lg border p-4 ${status === "overdue" ? "border-destructive/30 bg-destructive/5" : status === "ready" ? "border-success/30 bg-success/5" : "border-border bg-card"}`}>
            <div className="flex items-start justify-between gap-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <CalendarClock className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Next Scheduled Count</p>
                  <Badge className={`text-[10px] border ${statusConfig.cls}`}>{statusConfig.label}</Badge>
                </div>
                <p className="font-semibold text-sm">{nextSchedule.name}</p>
                <p className="text-[11px] text-muted-foreground mt-0.5">
                  {nextSchedule.inventory_lists?.name}
                  {nextSchedule.locations?.name ? ` · ${nextSchedule.locations.name}` : ""}
                  {" · "}
                  {nextSchedule.nextDate.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" })}
                  {" at "}
                  {nextSchedule.nextDate.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                </p>
                <p className="text-[11px] text-muted-foreground mt-0.5">
                  {status === "overdue" ? "This count is past due" : `Starts in ${formatCountdown(nextSchedule.nextDate)}`}
                </p>
              </div>
              <Button
                size="sm"
                className="shrink-0 h-8 text-xs gap-1.5 bg-gradient-amber shadow-amber"
                onClick={() => {
                  if (existingSession) openEditor(existingSession);
                  else                   if (nextSchedule.inventory_list_id) {
                    openNewCountSessionNameDialog(
                      nextSchedule.inventory_list_id,
                      nextSchedule.inventory_lists?.name ?? null,
                    );
                  }
                }}
              >
                {existingSession ? <><ChevronRight className="h-3.5 w-3.5" />Continue</> : <><Play className="h-3.5 w-3.5" />Start now</>}
              </Button>
            </div>
          </div>
        );
      })()}

      {/* ── In progress (list + session command center) ── */}
      <section className="space-y-2">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-sm font-semibold tracking-tight">In progress</h2>
          {inProgressSessions.length > 0 && (
            <Badge variant="secondary" className="text-[10px] font-normal tabular-nums">{inProgressSessions.length}</Badge>
          )}
        </div>
        <Card className="border shadow-sm overflow-hidden">
          {lists.length === 0 ? (
            <CardContent className="py-12 text-center px-4">
              <Package className="h-10 w-10 text-muted-foreground/20 mb-3 mx-auto" />
              <p className="text-sm font-medium text-muted-foreground">No inventory lists yet</p>
              <p className="text-xs text-muted-foreground/80 mt-1 max-w-sm mx-auto">
                Create a list in List Management, then count it from here without leaving this page.
              </p>
              <Button variant="outline" className="mt-5 gap-1.5" onClick={() => navigate("/app/inventory/lists")}>
                <ClipboardList className="h-4 w-4" /> Go to List Management
              </Button>
            </CardContent>
          ) : landingFocus.focusList ? (
            <CardContent className="p-4 sm:p-5 space-y-4">
              <div className="space-y-2 max-w-md">
                <Label className="text-[11px] font-medium text-muted-foreground">View by</Label>
                <Select
                  value={landingFocus.effectiveLandingListId || undefined}
                  onValueChange={(id) => {
                    setLandingFocusListId(id);
                    setSelectedList(id);
                  }}
                >
                  <SelectTrigger className="h-10 w-full sm:w-[min(100%,320px)]">
                    <SelectValue placeholder="Select a list" />
                  </SelectTrigger>
                  <SelectContent>
                    {lists.map((l) => (
                      <SelectItem key={l.id} value={l.id}>{l.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {(() => {
                const { focusList, focusInProgressSession, focusReviewSession, meta, stats } = landingFocus;
                const total = stats?.total ?? 0;
                const counted = stats?.counted ?? 0;
                let statusText = "No active count in progress for this list.";
                let lastLine: string;
                if (focusInProgressSession) {
                  statusText = "Count in progress — continue or clear to start over.";
                  lastLine = [
                    focusInProgressSession.locations?.name,
                    `Updated ${formatSessionRowDate(focusInProgressSession.updated_at)}`,
                  ].filter(Boolean).join(" · ");
                } else if (focusReviewSession) {
                  statusText = "A count for this list is in review.";
                  lastLine = `Submitted ${formatSessionRowDate(focusReviewSession.updated_at)}`;
                } else if (meta.lastCountedAt) {
                  lastLine = `Last approved count ${format(new Date(meta.lastCountedAt), "MMM d, yyyy")}`;
                } else {
                  lastLine = "No approved count yet for this list";
                }
                const catalogCount = meta.itemCount;
                const itemLine =
                  focusInProgressSession && total > 0
                    ? `${counted}/${total} lines with quantity · ${total} rows in session`
                    : `${catalogCount} items on list`;

                return (
                  <div className="space-y-3 rounded-lg border border-border/60 bg-muted/25 p-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-semibold text-sm truncate">
                        {focusInProgressSession?.name || focusList.name}
                      </p>
                      {focusInProgressSession && (
                        <Badge className="bg-warning/15 text-warning border-0 text-[10px] shrink-0">In progress</Badge>
                      )}
                      {focusReviewSession && !focusInProgressSession && (
                        <Badge className="bg-primary/10 text-primary border-0 text-[10px] shrink-0">In review</Badge>
                      )}
                    </div>
                    {focusInProgressSession && (
                      <p className="text-[11px] text-muted-foreground truncate">List: {focusList.name}</p>
                    )}
                    <p className="text-xs text-muted-foreground">{statusText}</p>
                    <p className="text-[11px] text-muted-foreground">{lastLine}</p>
                    <p className="text-[11px] text-muted-foreground tabular-nums">{itemLine}</p>
                    <div className="flex flex-wrap items-center gap-2 pt-1">
                      <Button
                        size="sm"
                        className="bg-gradient-amber shadow-amber gap-1.5 h-9"
                        disabled={!!startingListId}
                        onClick={() =>
                          focusInProgressSession
                            ? void openEditor(focusInProgressSession)
                            : void handleStartCountFromList(focusList.id)
                        }
                      >
                        {focusInProgressSession ? (
                          <><ChevronRight className="h-3.5 w-3.5" /> Continue count</>
                        ) : (
                          <><Play className="h-3.5 w-3.5" /> Start new count</>
                        )}
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-9"
                        disabled={!focusInProgressSession}
                        onClick={() =>
                          focusInProgressSession && setClearInProgressSessionId(focusInProgressSession.id)
                        }
                      >
                        Clear
                      </Button>
                    </div>
                  </div>
                );
              })()}
            </CardContent>
          ) : null}
        </Card>
      </section>

      {/* ── Review (managers / owners only) ── */}
      {isManagerOrOwner && (
        <section className="space-y-2">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-sm font-semibold tracking-tight">Review</h2>
            {reviewSessions.length > 0 && (
              <Badge variant="secondary" className="text-[10px] font-normal tabular-nums">{reviewSessions.length}</Badge>
            )}
          </div>
          <Card className="border shadow-sm overflow-hidden">
            {reviewSessions.length === 0 ? (
              <CardContent className="py-10 text-center px-4">
                <ClipboardCheck className="h-9 w-9 text-muted-foreground/25 mb-2 mx-auto" />
                <p className="text-sm text-muted-foreground">Nothing waiting for review</p>
                <p className="text-xs text-muted-foreground/80 mt-1">Submitted counts will appear here for approval.</p>
              </CardContent>
            ) : (
              <div className="divide-y divide-border/60">
                {reviewSessions.map((s) => {
                  const stats = sessionStats[s.id];
                  const total = stats?.total ?? 0;
                  return (
                    <div
                      key={s.id}
                      className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between sm:gap-4 hover:bg-muted/20 transition-colors"
                    >
                      <div className="min-w-0 flex-1 space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="font-semibold text-sm truncate">{s.name || "Count session"}</p>
                          <Badge className="bg-primary/10 text-primary border-0 text-[10px] shrink-0">In review</Badge>
                        </div>
                        <p className="text-xs text-muted-foreground truncate">
                          List: {s.inventory_lists?.name || "—"}
                        </p>
                        <p className="text-[11px] text-muted-foreground">
                          {s.locations?.name ? <span>{s.locations.name} · </span> : null}
                          Submitted {formatSessionRowDate(s.updated_at)}
                        </p>
                      </div>
                      <div className="flex flex-wrap items-center gap-3 sm:justify-end shrink-0">
                        <span className="text-xs text-muted-foreground tabular-nums">{total} items</span>
                        <Button size="sm" variant="default" className="h-9 gap-1.5" onClick={() => handleView(s)}>
                          <Eye className="h-3.5 w-3.5" /> Review
                        </Button>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="outline" size="icon" className="h-9 w-9 shrink-0">
                              <MoreHorizontal className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => handleApprove(s.id)}>
                              <CheckCircle className="h-3.5 w-3.5 mr-2 text-success" /> Approve
                            </DropdownMenuItem>
                            <DropdownMenuItem className="text-destructive" onClick={() => handleReject(s.id)}>
                              <XCircle className="h-3.5 w-3.5 mr-2" /> Send back
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </Card>
        </section>
      )}

      {/* ── Approved ── */}
      <section className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-sm font-semibold tracking-tight">Approved</h2>
          <Select value={approvedFilter} onValueChange={setApprovedFilter}>
            <SelectTrigger className="h-8 w-[8.5rem] text-xs">
              <SelectValue placeholder="Range" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="7">Last 7 days</SelectItem>
              <SelectItem value="30">Last 30 days</SelectItem>
              <SelectItem value="60">Last 60 days</SelectItem>
              <SelectItem value="90">Last 90 days</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <Card className="border shadow-sm overflow-hidden">
          {approvedSessions.length === 0 ? (
            <CardContent className="py-10 text-center px-4">
              <CheckCircle className="h-9 w-9 text-muted-foreground/25 mb-2 mx-auto" />
              <p className="text-sm text-muted-foreground">No approved sessions in this range</p>
            </CardContent>
          ) : (
            <div className="divide-y divide-border/60">
              {approvedSessions.map((s) => {
                const stats = sessionStats[s.id];
                const total = stats?.total ?? 0;
                const value = stats?.totalValue ?? 0;
                return (
                  <div
                    key={s.id}
                    className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between sm:gap-4 hover:bg-muted/20 transition-colors"
                  >
                    <div className="min-w-0 flex-1 space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="font-semibold text-sm truncate">{s.name || "Count session"}</p>
                          <Badge className="bg-success/15 text-success border-0 text-[10px] shrink-0">Approved</Badge>
                        </div>
                        <p className="text-xs text-muted-foreground truncate">
                          List: {s.inventory_lists?.name || "—"}
                        </p>
                      <p className="text-[11px] text-muted-foreground">
                        {s.locations?.name ? <span>{s.locations.name} · </span> : null}
                        Approved {formatSessionRowDate(s.approved_at || s.updated_at)}
                        {value > 0 && (
                          <span className="text-foreground font-medium"> · {formatCurrency(value)}</span>
                        )}
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-3 sm:justify-end shrink-0">
                      <span className="text-xs text-muted-foreground tabular-nums">{total} items</span>
                      <Button size="sm" variant="outline" className="h-9 gap-1.5" onClick={() => handleView(s)}>
                        <Eye className="h-3.5 w-3.5" /> View
                      </Button>
                      {isManagerOrOwner && (
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-9 w-9 shrink-0">
                              <MoreHorizontal className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => handleDuplicate(s)}>
                              <Copy className="h-3.5 w-3.5 mr-2" /> Duplicate
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => openSmartOrderModal(s)}>
                              <ShoppingCart className="h-3.5 w-3.5 mr-2" /> Smart order
                            </DropdownMenuItem>
                            <DropdownMenuItem className="text-destructive" onClick={() => handleDeclineToReview(s.id)}>
                              <XCircle className="h-3.5 w-3.5 mr-2" /> Decline to review
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem className="text-destructive" onClick={() => setDeleteSessionId(s.id)}>
                              <Trash2 className="h-3.5 w-3.5 mr-2" /> Delete
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Card>
      </section>

      {/* Name new count session (operational title — not the saved list name) */}
      <Dialog
        open={newCountNameDialogOpen}
        onOpenChange={(o) => {
          if (!o) {
            setNewCountNameDialogOpen(false);
            setPendingNewCountListId(null);
          }
        }}
      >
        <DialogContent className="sm:max-w-md" onOpenAutoFocus={(e) => e.preventDefault()}>
          <DialogHeader>
            <DialogTitle>Name this count</DialogTitle>
            <DialogDescription>
              This names the specific count you are starting. Your saved list stays the master item list; this title is only for this run.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 py-1">
            <Label htmlFor="new-count-session-name">Count session name</Label>
            <Input
              id="new-count-session-name"
              value={newCountNameInput}
              onChange={(e) => setNewCountNameInput(e.target.value)}
              placeholder="e.g. Monday morning count"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void handleConfirmNewCountSessionName();
                }
              }}
            />
          </div>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setNewCountNameDialogOpen(false);
                setPendingNewCountListId(null);
              }}
            >
              Cancel
            </Button>
            <Button
              type="button"
              className="bg-gradient-amber shadow-amber"
              disabled={!newCountNameInput.trim() || !!startingListId}
              onClick={() => void handleConfirmNewCountSessionName()}
            >
              Start count
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Create Smart Order Modal */}
      <Dialog open={!!smartOrderSession} onOpenChange={(o) => !o && setSmartOrderSession(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Create Smart Order</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1">
              <p className="text-sm text-muted-foreground">Session: <span className="font-medium text-foreground">{smartOrderSession?.name}</span></p>
              <p className="text-sm text-muted-foreground">List: <span className="font-medium text-foreground">{smartOrderSession?.inventory_lists?.name}</span></p>
            </div>
            <div className="space-y-2">
              <Label>Select PAR Guide</Label>
              <Select value={smartOrderSelectedPar} onValueChange={setSmartOrderSelectedPar}>
                <SelectTrigger className="h-10"><SelectValue placeholder="Choose PAR guide" /></SelectTrigger>
                <SelectContent>
                  {smartOrderParGuides.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                </SelectContent>
              </Select>
              {smartOrderParGuides.length === 0 && (
                <p className="text-xs text-muted-foreground">No PAR guides found for this list. Create one in PAR Management first.</p>
              )}
            </div>
            <Button
              onClick={handleCreateSmartOrder}
              className="w-full bg-gradient-amber"
              disabled={!smartOrderSelectedPar || smartOrderCreating}
            >
              {smartOrderCreating ? "Creating..." : "Create Smart Order"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Clear Entries Confirm */}
      <AlertDialog open={!!clearEntriesSessionId} onOpenChange={(o) => !o && setClearEntriesSessionId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Clear all entries?</AlertDialogTitle>
            <AlertDialogDescription>This will reset all current stock values to 0 for this session. The item rows will be kept so you can recount.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleClearEntries} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">Clear Entries</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Clear in-progress session (saved list is kept) */}
      <AlertDialog open={!!clearInProgressSessionId} onOpenChange={(o) => !o && setClearInProgressSessionId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Clear this count?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes the in-progress session and its entered quantities for this list. Your saved list in List Management is not deleted. You can start a fresh count afterward.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => void handleClearInProgressSession()} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Clear count
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Delete Session Confirm */}
      <AlertDialog open={!!deleteSessionId} onOpenChange={(o) => !o && setDeleteSessionId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this session?</AlertDialogTitle>
            <AlertDialogDescription>This will permanently delete this session and all its items. This action cannot be undone.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>No, keep it</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteSession} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">Yes, delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

    </div>
  );
}