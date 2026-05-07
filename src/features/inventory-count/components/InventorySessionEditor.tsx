import { useCallback, useMemo, useRef, useState } from "react";
import type { ListImperativeAPI } from "react-window";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { toast } from "sonner";
import {
  ArrowLeft,
  BarChart3,
  BookOpen,
  Check,
  ClipboardList,
  DollarSign,
  Eraser,
  ExternalLink,
  Eye,
  EyeOff,
  Filter,
  ListOrdered,
  Lock,
  MapPin,
  MoreHorizontal,
  MoreVertical,
  Package,
  Pencil,
  Plus,
  RefreshCw,
  Send,
  Search,
} from "lucide-react";
import ItemIdentityBlock from "@/components/ItemIdentityBlock";
import { InventorySessionDesktopCategoryList } from "@/features/inventory-count/components/InventorySessionDesktopCategoryList";
import { InventorySessionUnitedDesktopTable } from "@/features/inventory-count/components/InventorySessionUnitedDesktopTable";
import { CountSheetItemStockField } from "@/features/inventory-count/components/CountSheetItemStockField";
import { SessionItemZoneCountStrip } from "@/features/inventory-count/components/SessionItemZoneCountStrip";
import type { SessionEditorState } from "@/features/inventory-count/hooks/useSessionEditor";
import type {
  SaveStockWithConversionPayload,
  UpsertZoneCountCommandPayload,
} from "@/features/inventory-count/hooks/useItemCommands";
import {
  isZoneWriteFailure,
  type ZoneWriteResult,
} from "@/features/inventory-count/inventoryZoneWritePipeline";
import { catalogIdFromSessionItem } from "@/domain/inventory/sessionItemCatalogLink";
import type { ParGuidePickerOption } from "@/features/inventory-count/types";
import {
  formatLastOrdered as formatLastOrderedHelper,
  formatParColumnCell as formatParColumnCellHelper,
  resolveCountingParDisplay as resolveCountingParDisplayHelper,
} from "@/domain/inventory/enterInventoryHelpers";
import type { InventoryCatalogItemRow, InventorySessionItemRow } from "@/domain/inventory/enterInventoryTypes";
import {
  parseUnitsPerPlanningUnitFromPackSize,
  resolvePlanningUnitMetaFromCatalogItem,
  zoneEntryUnitOptions,
} from "@/domain/inventory/planningUnitMeta";
import { listCategoryIdForZoneStrip } from "@/domain/inventory/zoneCountUi";
import type { CategoryMappingResult } from "@/hooks/useCategoryMapping";
import { ZONE_UPSERT_LEGACY_STOCK_REQUIRES_ACK } from "@/domain/inventory/zoneReconcile";
import { resolveSessionItemUnitPrice } from "@/domain/inventory/display/itemUnitPrice";
import {
  computeOrderQty,
  formatNum,
  getRisk,
  getRowState,
  type RiskThresholds,
} from "@/lib/inventory-utils";
import { formatCurrency } from "@/lib/format";

const defaultCategories = ["Frozen", "Cooler", "Dry"];

type LocationLike = { id: string; name: string };

type SessionViewData = {
  filteredItems: InventorySessionItemRow[];
  globalIndexByItemId: Map<string, number>;
  groupedItems: Record<string, InventorySessionItemRow[]>;
  sortedCategoryKeys: string[];
  /** All category keys before filterCategory is applied — used to populate the filter dropdown. */
  allCategoryKeys: string[];
  countedItems: number;
  totalItems: number;
  progressPct: number;
  submitSummary: {
    counted: number;
    total: number;
    lowCount: number;
    criticalCount: number;
    estimatedValue: number;
  };
};

type SessionCountData = {
  catalogItems: InventoryCatalogItemRow[];
  parGuidesPickerOptions: ParGuidePickerOption[];
  riskThresholds: RiskThresholds;
  countingParByCatalogId: Record<string, number>;
  countingParByNormalizedName: Record<string, number>;
  countingParGuideName: string | null;
};

type SessionLoadingStates = {
  savingId: string | null;
  savedId: string | null;
  editItemDetailsSaving: boolean;
  staffParSending: boolean;
  staffPriceSending: boolean;
  managerParSaving: boolean;
  managerPriceSaving: boolean;
  /** True while submit-for-review mutation is in flight (idempotency / no double submit). */
  submittingForReview?: boolean;
};

type SessionHandlers = {
  onLeave: () => void;
  onOpenParGuidePicker: () => Promise<void>;
  onApplyParGuideSelection: (guideId: string) => Promise<void>;
  onUpdateStock: (id: string, rawValue: string) => void;
  onSaveStock: (id: string, stockVal: number | null) => Promise<void>;
  onSaveStockWithConversion: (id: string, payload: SaveStockWithConversionPayload) => Promise<void>;
  onUpdatePrice: (id: string, rawValue: string) => void;
  onSavePrice: (id: string, cost: number | null) => Promise<void>;
  onClearRow: (id: string) => Promise<void>;
  onAddItem: () => Promise<void>;
  onAddFromCatalog: (item: InventoryCatalogItemRow) => Promise<void>;
  onSubmitForReview: () => Promise<void>;
  onClearEntries: () => Promise<void>;
  onReloadFromServer: () => Promise<void>;
  onSaveEditItemDetails: () => Promise<void>;
  onStaffParChangeRequestSubmit: () => Promise<void>;
  onStaffPriceChangeRequestSubmit: () => Promise<void>;
  onManagerParLevelSave: () => Promise<void>;
  onManagerPriceSave: () => Promise<void>;
  navigate: (path: string) => void;
};

type SessionFns = {
  getApprovedPar: (item: InventorySessionItemRow) => number;
  getCatalogUnitCost: (id: string | null | undefined) => number | null;
  getItemCategory: (item: InventorySessionItemRow) => string;
  getLastOrderDate: (itemName: string) => string | null;
  getProductNumber: (item: InventorySessionItemRow) => string | null;
};

type SessionMeta = {
  isCompact: boolean;
  isManagerOrOwner: boolean;
  isStaffMenu: boolean;
  selectedListName: string;
  locations: LocationLike[];
  currentLocation: LocationLike | null | undefined;
  sessionUserId: string | null;
  /** false when the browser reports offline. */
  networkOnline: boolean;
  /** When false, managers cannot edit PAR levels at this location. */
  canEditPar?: boolean;
};

export type InventoryZoneCountContext = {
  hasZoneSections: boolean;
  /** catalog_item_id and item_name indexes from list_item_category_map (stable category_id per item) */
  categoryMapping: CategoryMappingResult;
  catalogById: Record<string, InventoryCatalogItemRow>;
  upsertZoneCountForItem: (payload: UpsertZoneCountCommandPayload) => Promise<ZoneWriteResult>;
};

export type InventorySessionEditorProps = {
  editor: SessionEditorState;
  meta: SessionMeta;
  view: SessionViewData;
  countData: SessionCountData;
  loadingStates: SessionLoadingStates;
  handlers: SessionHandlers;
  fns: SessionFns;
  zoneCount?: InventoryZoneCountContext | null;
};

export function InventorySessionEditor({
  editor,
  meta,
  view,
  countData,
  loadingStates,
  handlers,
  fns,
  zoneCount = null,
}: InventorySessionEditorProps) {
  const { activeSession, items } = editor;
  const {
    isCompact,
    isManagerOrOwner,
    isStaffMenu,
    selectedListName,
    locations,
    currentLocation,
    sessionUserId,
    networkOnline,
    canEditPar = true,
  } = meta;
  const {
    filteredItems,
    globalIndexByItemId,
    groupedItems,
    sortedCategoryKeys,
    allCategoryKeys,
    countedItems,
    totalItems,
    progressPct,
    submitSummary,
  } = view;
  const {
    catalogItems,
    parGuidesPickerOptions,
    riskThresholds,
    countingParByCatalogId,
    countingParByNormalizedName,
    countingParGuideName,
  } = countData;
  const {
    savingId,
    savedId,
    editItemDetailsSaving,
    staffParSending,
    staffPriceSending,
    managerParSaving,
    managerPriceSaving,
    submittingForReview = false,
  } = loadingStates;

  if (!activeSession) return null;

  const pendingLegacyZone = useRef<UpsertZoneCountCommandPayload | null>(null);
  const suppressLegacyAckStripResetRef = useRef(false);
  const [legacyZoneAckOpen, setLegacyZoneAckOpen] = useState(false);
  const [zoneStripResetNonceByItemId, setZoneStripResetNonceByItemId] = useState<Record<string, number>>(
    {},
  );
  const [reloadFromServerOpen, setReloadFromServerOpen] = useState(false);

  const getZoneStripDraftResetNonce = useCallback(
    (itemId: string) => zoneStripResetNonceByItemId[itemId] ?? 0,
    [zoneStripResetNonceByItemId],
  );

  const getZoneStripConfig = useCallback(
    (item: InventorySessionItemRow) => {
      if (!zoneCount?.hasZoneSections) return null;
      const listCatId = listCategoryIdForZoneStrip(
        item,
        zoneCount.categoryMapping,
        zoneCount.hasZoneSections,
      );
      const cid = catalogIdFromSessionItem(item);
      if (!listCatId || !cid) return null;
      const cat = zoneCount.catalogById[cid];
      if (!cat) return null;
      const meta = resolvePlanningUnitMetaFromCatalogItem(cat, item);
      if (!meta) return null;
      return { listCategoryId: listCatId, unitOptions: zoneEntryUnitOptions(meta) };
    },
    [zoneCount],
  );

  const onCommitZoneCount = useCallback(
    async (item: InventorySessionItemRow, listCategoryId: string, qty: number, unit: string) => {
      const cid = catalogIdFromSessionItem(item);
      if (!zoneCount || !cid) return;
      const cat = zoneCount.catalogById[cid];
      if (!cat) return;
      const r = await zoneCount.upsertZoneCountForItem({
        sessionItem: item,
        catalogItem: cat,
        listCategoryId,
        enteredQty: qty,
        enteredUnit: unit,
      });
      if (isZoneWriteFailure(r)) {
        if (r.code === "legacy_ack_required") {
          pendingLegacyZone.current = {
            sessionItem: item,
            catalogItem: cat,
            listCategoryId,
            enteredQty: qty,
            enteredUnit: unit,
          };
          setLegacyZoneAckOpen(true);
          return;
        }
        toast.error(r.error);
      }
    },
    [zoneCount],
  );

  const confirmLegacyZoneAck = useCallback(async () => {
    suppressLegacyAckStripResetRef.current = true;
    const p = pendingLegacyZone.current;
    pendingLegacyZone.current = null;
    setLegacyZoneAckOpen(false);
    if (!p || !zoneCount) return;
    const r = await zoneCount.upsertZoneCountForItem({
      ...p,
      acknowledgeReplacesLegacyTotal: true,
    });
    if (isZoneWriteFailure(r)) toast.error(r.error);
  }, [zoneCount]);

  const useCompactLayout = isCompact;
  /** Single desktop table: only when no category is large enough to require react-window. */
  const VIRTUAL_LIST_ROW_THRESHOLD = 80;
  const useUnitedSessionDesktopTable = useMemo(
    () =>
      sortedCategoryKeys.length > 0 &&
      sortedCategoryKeys.every(
        (k) => (groupedItems[k]?.length ?? 0) < VIRTUAL_LIST_ROW_THRESHOLD,
      ),
    [sortedCategoryKeys, groupedItems],
  );
  const isCountingEditable =
    activeSession.status !== "IN_REVIEW" && activeSession.status !== "APPROVED";
  const canCloudActions = isCountingEditable && networkOnline;
  const showAdvancedListControls = isManagerOrOwner || !isCountingEditable;

  const sessionModeBadge =
    activeSession.status === "IN_PROGRESS"
      ? { label: "Counting", className: "border-blue-500/40 bg-blue-500/10 text-blue-950 dark:text-blue-100" }
      : activeSession.status === "IN_REVIEW"
      ? { label: "In review", className: "border-sky-500/35 bg-sky-500/10 text-sky-950 dark:text-sky-100" }
      : activeSession.status === "APPROVED"
      ? { label: "Approved", className: "border-emerald-500/40 bg-emerald-500/10 text-emerald-950 dark:text-emerald-100" }
      : { label: activeSession.status, className: "border-border bg-muted/50 text-muted-foreground" };

  const resolveCountingParDisplay = (item: InventorySessionItemRow): number | null =>
    resolveCountingParDisplayHelper(
      item,
      editor.parColumnVisible,
      editor.countingParGuideId,
      countingParByCatalogId,
      countingParByNormalizedName,
    );

  const formatParColumnCell = (item: InventorySessionItemRow) =>
    formatParColumnCellHelper(
      item,
      editor.parColumnVisible,
      editor.countingParGuideId,
      countingParByCatalogId,
      countingParByNormalizedName,
    );

  const openEditItemDetails = (row: InventorySessionItemRow) => {
    editor.setEditItemDetailsSessionItem(row);
    editor.setEditItemDetailsForm({
      item_name: row.item_name || "",
      unit: row.unit || "",
      pack_size: row.pack_size || "",
    });
  };

  const jumpToNextEmpty = () => {
    const emptyItem = filteredItems.find(
      (i) => !i.current_stock || Number(i.current_stock) === 0,
    );
    if (!emptyItem) {
      toast.info("All items have been counted!");
      return;
    }
    requestAnimationFrame(() => {
      const input = editor.inputRefs.current[emptyItem.id];
      input?.focus();
      input?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
  };

  const scrollVirtualRowIntoView = useCallback(
    (item: InventorySessionItemRow | undefined) => {
      if (!item) return;
      for (const cat of sortedCategoryKeys) {
        const list = groupedItems[cat];
        const rowIdx = list.findIndex((i) => i.id === item.id);
        if (rowIdx < 0) continue;
        const listRef: ListImperativeAPI | null = editor.categoryVirtualListRefs.current[cat] ?? null;
        listRef?.scrollToRow({ index: rowIdx, align: "center", behavior: "auto" });
        return;
      }
    },
    [sortedCategoryKeys, groupedItems, editor.categoryVirtualListRefs],
  );

  const handleKeyDown = (
    e: React.KeyboardEvent,
    currentIndex: number,
    field: "stock" = "stock",
  ) => {
    const getRef = (idx: number, f: string) =>
      editor.inputRefs.current[`${filteredItems[idx]?.id}_${f}`] ||
      editor.inputRefs.current[filteredItems[idx]?.id];
    const go = (delta: number) => {
      const nextItem = filteredItems[currentIndex + delta];
      scrollVirtualRowIntoView(nextItem);
      requestAnimationFrame(() => {
        getRef(currentIndex + delta, field)?.focus();
      });
    };
    if (e.key === "Enter" || e.key === "ArrowDown") {
      e.preventDefault();
      go(1);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      go(-1);
    } else if (e.key === "Tab") {
      e.preventDefault();
      go(e.shiftKey ? -1 : 1);
    }
  };

  const renderRowActionsMenu = (item: InventorySessionItemRow) => (
    <DropdownMenu>
      <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 max-lg:min-h-11 max-lg:min-w-11 max-lg:h-11 max-lg:w-11 text-muted-foreground shrink-0"
        >
          <MoreVertical className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56" onClick={(e) => e.stopPropagation()}>
        <DropdownMenuItem
          disabled={!isCountingEditable}
          onClick={(e) => { e.stopPropagation(); openEditItemDetails(item); }}
        >
          <Pencil className="h-4 w-4 mr-2" /> Edit item details
        </DropdownMenuItem>
        {isStaffMenu && (
          <>
            <DropdownMenuItem
              onClick={(e) => {
                e.stopPropagation();
                editor.setStaffParRequestItem(item);
                editor.setStaffParSuggested("");
                editor.setStaffParReason("");
              }}
            >
              <ClipboardList className="h-4 w-4 mr-2" /> Request PAR change
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={(e) => {
                e.stopPropagation();
                editor.setStaffPriceRequestItem(item);
                editor.setStaffPriceSuggested("");
                editor.setStaffPriceReason("");
              }}
            >
              <DollarSign className="h-4 w-4 mr-2" /> Request price change
            </DropdownMenuItem>
          </>
        )}
        {isManagerOrOwner && (
          <>
            {canEditPar && (
              <DropdownMenuItem
                disabled={!isCountingEditable}
                onClick={(e) => {
                  e.stopPropagation();
                  editor.setManagerParEditItem(item);
                  editor.setManagerParInput(String(fns.getApprovedPar(item)));
                }}
              >
                <BarChart3 className="h-4 w-4 mr-2" /> Edit PAR level
              </DropdownMenuItem>
            )}
            <DropdownMenuItem
              disabled={!isCountingEditable}
              onClick={(e) => {
                e.stopPropagation();
                editor.setManagerPriceEditItem(item);
                const p = item.unit_cost;
                editor.setManagerPriceInput(p != null && Number.isFinite(Number(p)) ? String(p) : "");
              }}
            >
              <DollarSign className="h-4 w-4 mr-2" /> Edit price
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );

  const parActionsMenu = (
    <>
      <DropdownMenuItem
        onClick={() => {
          if (editor.parColumnVisible) editor.setParColumnVisible(false);
          else if (!editor.countingParGuideId) void handlers.onOpenParGuidePicker();
          else editor.setParColumnVisible(true);
        }}
      >
        {editor.parColumnVisible ? (
          <><EyeOff className="h-3.5 w-3.5 mr-2" /> Hide PAR</>
        ) : (
          <><Eye className="h-3.5 w-3.5 mr-2" /> Show PAR</>
        )}
      </DropdownMenuItem>
      {!editor.parColumnVisible && editor.countingParGuideId && (
        <DropdownMenuItem onClick={() => void handlers.onOpenParGuidePicker()}>
          <BookOpen className="h-3.5 w-3.5 mr-2" /> Change PAR guide…
        </DropdownMenuItem>
      )}
    </>
  );

  const stockFilterMenu = editor.staffCountingFocus && (
    <>
      <DropdownMenuSeparator />
      <DropdownMenuLabel>Stock filter</DropdownMenuLabel>
      <DropdownMenuRadioGroup
        value={editor.statusFilter}
        onValueChange={(v) => editor.setStatusFilter(v as typeof editor.statusFilter)}
      >
        <DropdownMenuRadioItem value="all">All items</DropdownMenuRadioItem>
        <DropdownMenuRadioItem value="uncounted">Uncounted only</DropdownMenuRadioItem>
        <DropdownMenuRadioItem value="low">Low stock</DropdownMenuRadioItem>
        <DropdownMenuRadioItem value="critical">Critical</DropdownMenuRadioItem>
      </DropdownMenuRadioGroup>
    </>
  );

  const addItemsMenu = (
    <>
      <DropdownMenuSeparator />
      <DropdownMenuItem
        disabled={!canCloudActions}
        onClick={() => canCloudActions && editor.setClearEntriesSessionId(activeSession.id)}
      >
        <Eraser className="h-3.5 w-3.5 mr-2" /> Clear all counts
      </DropdownMenuItem>
      <DropdownMenuItem
        disabled={!canCloudActions}
        onClick={() => canCloudActions && setReloadFromServerOpen(true)}
      >
        <RefreshCw className="h-3.5 w-3.5 mr-2" /> Reload from server
      </DropdownMenuItem>
      <Dialog open={editor.createOpen} onOpenChange={editor.setCreateOpen}>
        <DialogTrigger asChild>
          <DropdownMenuItem onSelect={(e) => e.preventDefault()} disabled={!isCountingEditable}>
            <Plus className="h-3.5 w-3.5 mr-2" /> Add item
          </DropdownMenuItem>
        </DialogTrigger>
      </Dialog>
      {catalogItems.length > 0 && (
        <DropdownMenuItem
          disabled={!isCountingEditable}
          onClick={() => isCountingEditable && editor.setCatalogOpen(true)}
        >
          <BookOpen className="h-3.5 w-3.5 mr-2" /> Add from catalog
        </DropdownMenuItem>
      )}
    </>
  );

  return (
    <div className="space-y-0 animate-fade-in pb-28 lg:pb-4">
      {/* ═══ STICKY TOP CONTROL BAR ═══ */}
      <div className="sticky top-0 z-20 bg-background/95 backdrop-blur-sm -mx-4 px-4 lg:-mx-0 lg:px-0 border-b border-border/40">
        {/* Row 1: Identity + Location + Submit */}
        <div className="flex items-center gap-3 py-3">
          <Button
            variant="ghost"
            size="icon"
            className="h-9 w-9 shrink-0 rounded-lg"
            onClick={handlers.onLeave}
          >
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
              <h1 className="text-base lg:text-lg font-bold tracking-tight truncate min-w-0 flex-1">
                {activeSession.name}
              </h1>
            </div>
            <div className="flex items-center gap-2 mt-0.5 flex-wrap">
              <span className="text-xs text-muted-foreground truncate">
                {selectedListName ? `List: ${selectedListName}` : ""}
              </span>
              <button
                type="button"
                className="text-xs font-medium text-primary hover:underline shrink-0"
                onClick={handlers.onLeave}
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
            {editor.parColumnVisible && countingParGuideName ? (
              <p className="text-[11px] text-muted-foreground mt-1 truncate">
                PAR: {countingParGuideName}
              </p>
            ) : null}
          </div>

          <div className="shrink-0 min-w-[50px] text-right hidden lg:block">
            {savingId && <span className="text-xs text-muted-foreground animate-pulse">Saving…</span>}
            {!savingId && savedId && (
              <span className="text-xs text-success flex items-center gap-1 justify-end">
                <Check className="h-3.5 w-3.5" /> Saved
              </span>
            )}
          </div>

          <Button
            onClick={() => editor.setSubmitConfirmOpen(true)}
            className="bg-blue-600 text-white shadow-md shadow-blue-600/20 hover:bg-blue-700 gap-2 h-9 px-5 text-sm shrink-0 hidden lg:flex"
            disabled={!canCloudActions || items.length === 0}
          >
            <Send className="h-3.5 w-3.5" /> Submit for review
          </Button>
        </div>

        {/* Row 2: Search + Category pills + Filters */}
        <div className="flex items-center gap-3 pb-3 flex-wrap lg:flex-nowrap">
          <div className="relative min-w-[180px] lg:min-w-[240px] lg:max-w-xs">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground/60" />
            <Input
              value={editor.search}
              onChange={(e) => editor.setSearch(e.target.value)}
              placeholder="Search items…"
              className="pl-9 h-10 text-sm bg-card border-border/50"
            />
          </div>

          {isStaffMenu && (
            <ToggleGroup
              type="single"
              value={editor.categoryMode === "alphabetic" ? "alphabetic" : "list_order"}
              onValueChange={(v) => {
                if (v === "list_order" || v === "alphabetic") {
                  editor.setCategoryMode(v);
                  editor.setFilterCategory("all");
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

          {showAdvancedListControls && !isStaffMenu && (
            <Select
              value={editor.categoryMode}
              onValueChange={(v) => {
                editor.setCategoryMode(v);
                editor.setFilterCategory("all");
              }}
            >
              <SelectTrigger className="h-10 w-[170px] text-xs">
                <ListOrdered className="h-3.5 w-3.5 mr-1.5 shrink-0" />
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="list_order">List Order</SelectItem>
                <SelectItem value="custom-categories">AI Categories</SelectItem>
                <SelectItem value="my-categories">My Categories</SelectItem>
                <SelectItem value="recently_purchased">Recently purchased</SelectItem>
                <SelectItem value="alphabetic">Alphabetic</SelectItem>
              </SelectContent>
            </Select>
          )}

          {showAdvancedListControls && !isStaffMenu && allCategoryKeys.length > 1 && (
            <Select
              value={editor.filterCategory}
              onValueChange={editor.setFilterCategory}
            >
              <SelectTrigger className="h-10 w-[150px] text-xs">
                <Filter className="h-3.5 w-3.5 mr-1.5 shrink-0" />
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Show All</SelectItem>
                {allCategoryKeys.map((cat) => (
                  <SelectItem key={cat} value={cat}>
                    {cat.replace(/\w+/g, (w) => w.charAt(0) + w.slice(1).toLowerCase())}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}

          {/* RIGHT: Filters + Actions — desktop */}
          <div className="hidden lg:flex items-center gap-2 ml-auto shrink-0">
            {showAdvancedListControls && (
              <Select
                value={editor.statusFilter}
                onValueChange={(v) => editor.setStatusFilter(v as typeof editor.statusFilter)}
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
            {isManagerOrOwner && isCountingEditable && (
              <Button
                type="button"
                variant="outline"
                className="h-9 text-xs"
                disabled={!canCloudActions}
                onClick={() => canCloudActions && editor.setClearEntriesSessionId(activeSession.id)}
              >
                Clear all counts
              </Button>
            )}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="icon" className="h-9 w-9">
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {parActionsMenu}
                {stockFilterMenu}
                {addItemsMenu}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          {/* Same ⋯ actions on small screens */}
          <div className="flex lg:hidden items-center gap-2 w-full justify-end">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="icon" className="h-9 w-9">
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {parActionsMenu}
                {stockFilterMenu}
                {addItemsMenu}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </div>

      {isCountingEditable && !networkOnline && (
        <div
          className="mt-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-2.5 text-sm text-amber-950 dark:text-amber-100"
          role="status"
        >
          You are offline. Counts and other changes will not save until you are back online.
        </div>
      )}

      {!isCountingEditable && (
        <div className="rounded-lg border border-border/50 bg-muted/30 px-4 py-3">
          <div className="flex flex-wrap items-center gap-2">
            <Badge
              variant="outline"
              className={`text-[10px] font-semibold uppercase tracking-wide ${sessionModeBadge.className}`}
            >
              {sessionModeBadge.label}
            </Badge>
            <span className="text-sm font-medium text-foreground">View only</span>
          </div>
          <p className="text-sm text-muted-foreground mt-1.5">
            This count is locked. Open it from Inventory Review or Approved Inventory for full
            detail and actions.
          </p>
        </div>
      )}

      {/* ═══ MOBILE PROGRESS BAR ═══ */}
      {isCompact && totalItems > 0 && (
        <div className="pt-2 pb-1 px-1">
          <div className="h-1.5 rounded-full bg-muted/60 overflow-hidden">
            <div
              className="h-full rounded-full bg-blue-600 transition-all duration-500"
              style={{ width: `${progressPct}%` }}
            />
          </div>
        </div>
      )}

      {/* ═══ MAIN CONTENT ═══ */}
      {filteredItems.length === 0 ? (
        <div className="rounded-xl border border-border/40 bg-card mt-4">
          <div className="py-16 text-center">
            <Package className="h-12 w-12 text-muted-foreground/20 mx-auto mb-4" />
            <p className="text-sm font-medium text-muted-foreground">
              No items match your filters
            </p>
            <p className="text-xs text-muted-foreground/70 mt-1 max-w-xs mx-auto">
              Try adjusting your search or category filter, or add new items.
            </p>
            <Button
              variant="outline"
              className="mt-4 gap-1.5"
              onClick={() => {
                editor.setSearch("");
                editor.setFilterCategory("all");
                editor.setStatusFilter("all");
              }}
            >
              Clear Filters
            </Button>
          </div>
        </div>
      ) : useCompactLayout ? (
        /* ─── CARD LAYOUT (mobile/tablet) ─── */
        <div className="space-y-6 mt-2">
          {sortedCategoryKeys.map((category) => {
            const catItems = groupedItems[category];
            const countedMobile = catItems.filter(
              (i) => i.current_stock != null && Number(i.current_stock) > 0,
            ).length;
            return (
              <div key={category}>
                <div className="sticky top-24 z-10 -mx-1 mb-3 flex flex-wrap items-center justify-between gap-2 bg-background/95 px-1 py-1.5 backdrop-blur-sm">
                  <div className="flex min-w-0 items-center gap-2">
                    <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground/60">
                      {category}
                    </p>
                    <span className="text-[10px] text-muted-foreground/40 tabular-nums">
                      ({catItems.length})
                    </span>
                  </div>
                  <span className="shrink-0 font-mono text-[10px] tabular-nums text-muted-foreground">
                    {countedMobile}/{catItems.length} counted
                  </span>
                </div>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 sm:gap-4">
                  {catItems.map((item) => {
                    const globalIdx = filteredItems.indexOf(item);
                    const onHandLineDual = parseUnitsPerPlanningUnitFromPackSize(item.pack_size) != null;
                    const stripCfg = getZoneStripConfig(item);
                    const zoneLine =
                      stripCfg &&
                      item.inventory_session_item_zones?.find(
                        (z) => z.list_category_id === stripCfg.listCategoryId,
                      );
                    const rowPar = fns.getApprovedPar(item);
                    const needQty =
                      rowPar > 0
                        ? computeOrderQty(item.current_stock, rowPar, item.unit, item.pack_size)
                        : null;
                    const risk = getRisk(item.current_stock, rowPar, riskThresholds);
                    const rowState = getRowState(item.current_stock);
                    const isRecentlyEdited = editor.lastEditedId === item.id;
                    const packRaw = item.pack_size?.trim();
                    const cid = catalogIdFromSessionItem(item);
                    const cat = cid ? (zoneCount?.catalogById[cid] ?? null) : null;
                    const unitPrice = resolveSessionItemUnitPrice(item, cat);

                    return (
                      <div
                        key={item.id}
                        className={`relative rounded-xl border transition-all duration-200 ${
                          rowState === "counted"
                            ? "border-success/20 bg-success/[0.03]"
                            : rowState === "zero"
                            ? "border-border/30 bg-muted/10"
                            : "border-border/40 bg-card"
                        } ${isRecentlyEdited ? "ring-2 ring-primary/20" : ""}`}
                      >
                        <div className="space-y-4 p-4">
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0 flex-1">
                              <p className="text-base font-bold leading-tight text-foreground">{item.item_name}</p>
                              <ItemIdentityBlock brandName={item.brand_name} className="block mt-0.5" />
                              {unitPrice != null ? (
                                <p className="text-sm font-medium text-gray-600 tabular-nums dark:text-gray-300 mt-1">
                                  {formatCurrency(unitPrice)}
                                </p>
                              ) : null}
                              <div className="flex flex-wrap gap-x-2 gap-y-0.5 mt-1">
                                {fns.getProductNumber(item) && (
                                  <span className="text-[10px] text-muted-foreground/50">
                                    #{fns.getProductNumber(item)}
                                  </span>
                                )}
                                {packRaw ? (
                                  <span className="font-mono text-[10px] text-muted-foreground/50">{packRaw}</span>
                                ) : null}
                                {!(isStaffMenu && isCountingEditable) && (
                                  <span className="text-[10px] text-muted-foreground/50">
                                    Last: {formatLastOrderedHelper(fns.getLastOrderDate(item.item_name))}
                                  </span>
                                )}
                              </div>
                            </div>
                            <div className="flex items-center gap-1 shrink-0">
                              {renderRowActionsMenu(item)}
                              {risk.level === "NO_PAR" ? (
                                <span className="text-[10px] text-muted-foreground/40">—</span>
                              ) : (
                                <Badge
                                  className={`${risk.bgClass} ${risk.textClass} border-0 text-[10px] font-medium shrink-0`}
                                >
                                  {risk.level === "RED"
                                    ? (needQty != null && needQty > 0 ? `Need ${needQty}` : "Critical")
                                    : risk.level === "YELLOW"
                                      ? "Low"
                                      : "OK"}
                                </Badge>
                              )}
                            </div>
                          </div>

                          <div className="flex items-end gap-4">
                            <div className="min-w-0 flex-1">
                              <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                                Count on hand
                              </label>
                              {onHandLineDual ? (
                                <CountSheetItemStockField
                                  item={item}
                                  variant="card"
                                  isCountingEditable={isCountingEditable}
                                  simplifyCountingRow={false}
                                  onUpdateStock={handlers.onUpdateStock}
                                  onSaveStock={async (id, v) => {
                                    await handlers.onSaveStock(id, v);
                                  }}
                                  onKeyDown={(e) => handleKeyDown(e, globalIdx, "stock")}
                                  globalIndex={globalIdx}
                                  inputRef={(el) => {
                                    editor.inputRefs.current[item.id] = el;
                                  }}
                                  savingId={savingId}
                                  savedId={savedId}
                                  userId={sessionUserId}
                                  categoryKey={category}
                                  catalogItem={cat}
                                  zoneCountingActive={false}
                                  onSaveStockWithConversion={handlers.onSaveStockWithConversion}
                                  rowPar={rowPar}
                                />
                              ) : (
                                <div className="flex items-center gap-1.5">
                                  <Button
                                    type="button"
                                    variant="outline"
                                    size="icon"
                                    className="h-16 w-12 shrink-0 rounded-lg text-lg"
                                    disabled={!isCountingEditable}
                                    onClick={() => {
                                      const newVal = Math.max(0, Number(item.current_stock ?? 0) - 1);
                                      handlers.onUpdateStock(item.id, String(newVal));
                                      void handlers.onSaveStock(item.id, newVal);
                                    }}
                                  >
                                    –
                                  </Button>
                                  <CountSheetItemStockField
                                    item={item}
                                    variant="card"
                                    isCountingEditable={isCountingEditable}
                                    simplifyCountingRow={false}
                                    onUpdateStock={handlers.onUpdateStock}
                                    onSaveStock={async (id, v) => {
                                      await handlers.onSaveStock(id, v);
                                      jumpToNextEmpty();
                                    }}
                                    onKeyDown={(e) => handleKeyDown(e, globalIdx, "stock")}
                                    globalIndex={globalIdx}
                                    inputRef={(el) => {
                                      editor.inputRefs.current[item.id] = el;
                                    }}
                                    savingId={savingId}
                                    savedId={savedId}
                                    userId={sessionUserId}
                                    categoryKey={category}
                                    catalogItem={cat}
                                    zoneCountingActive={false}
                                    onSaveStockWithConversion={async (id, p) => {
                                      await handlers.onSaveStockWithConversion(id, p);
                                    }}
                                    rowPar={rowPar}
                                  />
                                  <Button
                                    type="button"
                                    variant="outline"
                                    size="icon"
                                    className="h-16 w-12 shrink-0 rounded-lg text-lg"
                                    disabled={!isCountingEditable}
                                    onClick={() => {
                                      const newVal = Number(item.current_stock ?? 0) + 1;
                                      handlers.onUpdateStock(item.id, String(newVal));
                                      void handlers.onSaveStock(item.id, newVal);
                                    }}
                                  >
                                    +
                                  </Button>
                                </div>
                              )}
                            </div>
                            {editor.parColumnVisible && (
                              <div className="shrink-0 text-center w-16">
                                <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1.5 block">
                                  PAR
                                </label>
                                <p className="h-16 flex items-center justify-center gap-1 text-lg font-mono text-muted-foreground/70">
                                  {formatParColumnCell(item)}
                                  {!canEditPar ? (
                                    <Lock className="h-4 w-4 shrink-0 text-muted-foreground" aria-label="PAR locked by owner" />
                                  ) : null}
                                </p>
                              </div>
                            )}
                            {needQty !== null && (
                              <div className="shrink-0 text-center w-16">
                                <label className="text-[10px] font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-wider mb-1.5 block">
                                  Need
                                </label>
                                <p
                                  className={`h-16 flex items-center justify-center text-lg font-mono font-bold ${
                                    needQty > 0 ? "text-blue-800 dark:text-blue-300" : "text-muted-foreground/60"
                                  }`}
                                >
                                  {formatNum(needQty)}
                                </p>
                              </div>
                            )}
                          </div>


                          {(savingId === item.id || savedId === item.id) && (
                            <div className="flex items-center gap-1.5">
                              {savingId === item.id && (
                                <span className="text-[10px] text-muted-foreground animate-pulse">
                                  Saving…
                                </span>
                              )}
                              {savedId === item.id && (
                                <span className="text-[10px] text-success flex items-center gap-0.5">
                                  <Check className="h-3 w-3" /> Saved
                                </span>
                              )}
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
        /* ─── TABLE LAYOUT: one unified table, or one block per large category (virtual list) ─── */
        <div ref={editor.sessionListWidthRef} className="mt-4 space-y-6">
          {useUnitedSessionDesktopTable ? (
            <div className="overflow-hidden rounded-xl border border-border/40 bg-card">
              <InventorySessionUnitedDesktopTable
                sortedCategoryKeys={sortedCategoryKeys}
                groupedItems={groupedItems}
                globalIndexByItemId={globalIndexByItemId}
                riskThresholds={riskThresholds}
                parColumnVisible={editor.parColumnVisible}
                simplifyCountingRow={editor.staffCountingFocus}
                isCountingEditable={isCountingEditable}
                zoneStripEnabled={false}
                getZoneStripConfig={getZoneStripConfig}
                getZoneStripDraftResetNonce={getZoneStripDraftResetNonce}
                onCommitZoneCount={onCommitZoneCount}
                onUpdateStock={handlers.onUpdateStock}
                onSaveStock={handlers.onSaveStock}
                onSaveStockWithConversion={handlers.onSaveStockWithConversion}
                sessionUserId={sessionUserId}
                catalogById={zoneCount?.catalogById ?? {}}
                onKeyDown={handleKeyDown}
                inputRefs={editor.inputRefs}
                formatParColumnCell={formatParColumnCell}
                getProductNumber={fns.getProductNumber}
                getLastOrderDate={fns.getLastOrderDate}
                renderRowActionsMenu={renderRowActionsMenu}
                savingId={savingId}
                savedId={savedId}
                lastEditedId={editor.lastEditedId}
                getApprovedPar={fns.getApprovedPar}
                canEditPar={canEditPar}
              />
            </div>
          ) : (
            sortedCategoryKeys.map((category) => {
              const catItems = groupedItems[category];
              return (
                <div key={category} className="overflow-hidden rounded-xl border border-border/40 bg-card">
                  <InventorySessionDesktopCategoryList
                    categoryLabel={category}
                    catItems={catItems}
                    globalIndexByItemId={globalIndexByItemId}
                    riskThresholds={riskThresholds}
                    parColumnVisible={editor.parColumnVisible}
                    simplifyCountingRow={editor.staffCountingFocus}
                    isCountingEditable={isCountingEditable}
                    zoneStripEnabled={false}
                    getZoneStripConfig={getZoneStripConfig}
                    getZoneStripDraftResetNonce={getZoneStripDraftResetNonce}
                    onCommitZoneCount={onCommitZoneCount}
                    onUpdateStock={handlers.onUpdateStock}
                    onSaveStock={handlers.onSaveStock}
                    onSaveStockWithConversion={handlers.onSaveStockWithConversion}
                    sessionUserId={sessionUserId}
                    catalogById={zoneCount?.catalogById ?? {}}
                    onKeyDown={handleKeyDown}
                    inputRefs={editor.inputRefs}
                    formatParColumnCell={formatParColumnCell}
                    getProductNumber={fns.getProductNumber}
                    getLastOrderDate={fns.getLastOrderDate}
                    renderRowActionsMenu={renderRowActionsMenu}
                    savingId={savingId}
                    savedId={savedId}
                    lastEditedId={editor.lastEditedId}
                    getApprovedPar={fns.getApprovedPar}
                    canEditPar={canEditPar}
                    virtualListRef={(api) => {
                      if (api) {
                        editor.categoryVirtualListRefs.current[category] = api;
                      } else {
                        delete editor.categoryVirtualListRefs.current[category];
                      }
                    }}
                  />
                </div>
              );
            })
          )}
        </div>
      )}

      {/* ═══ TABLET/MOBILE STICKY BOTTOM BAR ═══ */}
      {isCompact && (
        <div className="fixed bottom-0 left-0 right-0 z-30 bg-background/95 backdrop-blur-md border-t border-border/40 safe-area-bottom">
          <div className="flex items-center gap-3 px-4 py-3">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <div className="h-1.5 flex-1 rounded-full bg-muted/60 overflow-hidden">
                  <div
                    className="h-full rounded-full bg-blue-600 transition-all"
                    style={{ width: `${progressPct}%` }}
                  />
                </div>
                <span className="text-[10px] font-medium text-muted-foreground tabular-nums shrink-0">
                  {countedItems}/{totalItems}
                </span>
              </div>
            </div>
            <Button
              variant={editor.showOnlyEmpty ? "default" : "outline"}
              size="sm"
              className={`h-10 text-xs shrink-0 ${editor.showOnlyEmpty ? "bg-foreground text-background" : ""}`}
              onClick={() => editor.setShowOnlyEmpty(!editor.showOnlyEmpty)}
            >
              Uncounted
            </Button>
            <Button
              className="bg-blue-600 text-white shadow-md shadow-blue-600/20 hover:bg-blue-700 h-11 px-5 text-sm font-medium shrink-0"
              onClick={() => editor.setSubmitConfirmOpen(true)}
              disabled={!canCloudActions || items.length === 0 || submittingForReview}
            >
              <Send className="h-4 w-4 mr-1.5" /> Submit
            </Button>
          </div>
        </div>
      )}

      {/* ═══ SUBMIT CONFIRMATION ═══ */}
      <AlertDialog open={editor.submitConfirmOpen} onOpenChange={editor.setSubmitConfirmOpen}>
        <AlertDialogContent className="max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-lg">Submit for Review?</AlertDialogTitle>
            <AlertDialogDescription className="text-sm">
              This will send the inventory count to a manager for review.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="grid grid-cols-2 gap-3 my-2">
            <div className="rounded-lg bg-muted/30 p-3 text-center">
              <p className="text-2xl font-bold tabular-nums">{submitSummary.counted}</p>
              <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">
                Items Counted
              </p>
            </div>
            <div className="rounded-lg bg-muted/30 p-3 text-center">
              <p className="text-2xl font-bold tabular-nums">
                {submitSummary.total - submitSummary.counted}
              </p>
              <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">
                Uncounted
              </p>
            </div>
            <div className="rounded-lg bg-warning/10 p-3 text-center">
              <p className="text-2xl font-bold text-warning tabular-nums">
                {submitSummary.lowCount}
              </p>
              <p className="text-[10px] font-medium text-warning uppercase tracking-wide">
                Low Stock
              </p>
            </div>
            <div className="rounded-lg bg-destructive/10 p-3 text-center">
              <p className="text-2xl font-bold text-destructive tabular-nums">
                {submitSummary.criticalCount}
              </p>
              <p className="text-[10px] font-medium text-destructive uppercase tracking-wide">
                Critical
              </p>
            </div>
          </div>
          {submitSummary.estimatedValue > 0 && (
            <div className="rounded-lg border border-border/40 p-3 text-center">
              <p className="text-xs text-muted-foreground">Estimated Reorder Value</p>
              <p className="text-lg font-bold tabular-nums">
                ${submitSummary.estimatedValue.toFixed(2)}
              </p>
            </div>
          )}
          <AlertDialogFooter className="mt-2">
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={submittingForReview}
              onClick={() => {
                if (submittingForReview) return;
                editor.setSubmitConfirmOpen(false);
                void handlers.onSubmitForReview();
              }}
              className="bg-blue-600 text-white hover:bg-blue-700"
            >
              {submittingForReview ? "Submitting…" : "Confirm Submit"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={legacyZoneAckOpen}
        onOpenChange={(open) => {
          if (!open) {
            if (suppressLegacyAckStripResetRef.current) {
              suppressLegacyAckStripResetRef.current = false;
              pendingLegacyZone.current = null;
              setLegacyZoneAckOpen(false);
              return;
            }
            const pending = pendingLegacyZone.current;
            pendingLegacyZone.current = null;
            setLegacyZoneAckOpen(false);
            const itemId = pending?.sessionItem?.id;
            if (itemId) {
              setZoneStripResetNonceByItemId((prev) => ({
                ...prev,
                [itemId]: (prev[itemId] ?? 0) + 1,
              }));
            }
          }
        }}
      >
        <AlertDialogContent className="max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-lg">Replace stock total?</AlertDialogTitle>
            <AlertDialogDescription className="text-sm">{ZONE_UPSERT_LEGACY_STOCK_REQUIRES_ACK}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="mt-2">
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                void confirmLegacyZoneAck();
              }}
            >
              Confirm
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Clear all counts confirmation */}
      <AlertDialog
        open={!!editor.clearEntriesSessionId}
        onOpenChange={(open) => { if (!open) editor.setClearEntriesSessionId(null); }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Clear all entries?</AlertDialogTitle>
            <AlertDialogDescription>
              This will reset all current stock values to 0 for this session. Item rows are kept so you can recount.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => void handlers.onClearEntries()}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Clear Entries
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Add Item Dialog */}
      <Dialog open={editor.createOpen} onOpenChange={editor.setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Item</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label>Item Name</Label>
              <Input
                value={editor.newItem.item_name}
                onChange={(e) => editor.setNewItem({ ...editor.newItem, item_name: e.target.value })}
                className="h-10"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>Category</Label>
                <Select
                  value={editor.newItem.category}
                  onValueChange={(v) => editor.setNewItem({ ...editor.newItem, category: v })}
                >
                  <SelectTrigger className="h-10">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {defaultCategories.map((c) => (
                      <SelectItem key={c} value={c}>
                        {c}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label>Unit</Label>
                <Input
                  value={editor.newItem.unit}
                  onChange={(e) => editor.setNewItem({ ...editor.newItem, unit: e.target.value })}
                  placeholder="lbs, packs..."
                  className="h-10"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>On hand</Label>
                <Input
                  type="number"
                  value={editor.newItem.current_stock}
                  onChange={(e) => editor.setNewItem({ ...editor.newItem, current_stock: +e.target.value })}
                  className="h-10"
                />
              </div>
              <div className="space-y-1">
                <Label>Unit cost</Label>
                <Input
                  type="number"
                  value={editor.newItem.unit_cost}
                  onChange={(e) => editor.setNewItem({ ...editor.newItem, unit_cost: +e.target.value })}
                  className="h-10"
                />
              </div>
            </div>
            <p className="text-[11px] text-muted-foreground">
              PAR comes from the linked PAR guide (or defaults) and is not edited during counting.
            </p>
            <Button
              onClick={() => void handlers.onAddItem()}
              className="w-full bg-blue-600 text-white hover:bg-blue-700"
              disabled={!isCountingEditable}
            >
              Add
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Catalog Dialog */}
      {catalogItems.length > 0 && (
        <Dialog open={editor.catalogOpen} onOpenChange={editor.setCatalogOpen}>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>Add from Catalog</DialogTitle>
            </DialogHeader>
            <div className="max-h-80 overflow-y-auto space-y-0.5">
              {catalogItems.map((ci) => (
                <div
                  key={ci.id}
                  className="flex items-center justify-between py-2.5 px-3 rounded-lg hover:bg-muted/50 transition-colors"
                >
                  <div>
                    <p className="text-sm font-medium">{ci.item_name}</p>
                    <p className="text-[11px] text-muted-foreground">
                      {[ci.category, ci.unit, ci.vendor_name].filter(Boolean).join(" · ")}
                    </p>
                  </div>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 w-7 p-0"
                    onClick={() => void handlers.onAddFromCatalog(ci)}
                  >
                    <Plus className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>
          </DialogContent>
        </Dialog>
      )}

      {/* PAR Guide Picker */}
      <Dialog open={editor.parGuidePickerOpen} onOpenChange={editor.setParGuidePickerOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Which PAR guide do you want to use?</DialogTitle>
            <DialogDescription>
              Guides for this restaurant are shown below. Guides linked to this inventory list are
              listed first.
            </DialogDescription>
          </DialogHeader>
          {parGuidesPickerOptions.length === 0 ? (
            <p className="text-sm text-muted-foreground py-2">
              No PAR guides were found. Create and edit guides in PAR Management, then return here
              to show PAR while counting.
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
                    onClick={() => void handlers.onApplyParGuideSelection(g.id)}
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
            <Button
              type="button"
              variant="outline"
              onClick={() => editor.setParGuidePickerOpen(false)}
            >
              Cancel
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Clear Entries Confirm */}
      <AlertDialog
        open={!!editor.clearEntriesSessionId}
        onOpenChange={(o) => !o && editor.setClearEntriesSessionId(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Clear all counts?</AlertDialogTitle>
            <AlertDialogDescription>
              This will reset all current stock values to 0 for this session. The item rows will be
              kept so you can recount.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => void handlers.onClearEntries()}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Clear all counts
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={reloadFromServerOpen} onOpenChange={setReloadFromServerOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Reload counts from the server?</AlertDialogTitle>
            <AlertDialogDescription>
              This discards any unsaved changes in this view and loads the last saved data from the
              server.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                void handlers.onReloadFromServer().finally(() => setReloadFromServerOpen(false));
              }}
            >
              Reload
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Edit Item Details Sheet */}
      <Sheet
        open={!!editor.editItemDetailsSessionItem}
        onOpenChange={(o) => { if (!o) editor.setEditItemDetailsSessionItem(null); }}
      >
        <SheetContent side="right" className="w-full sm:max-w-sm flex flex-col">
          <SheetHeader>
            <SheetTitle>Edit item details</SheetTitle>
            {editor.editItemDetailsSessionItem && (
              <p className="text-xs text-muted-foreground">Session line — name, unit, and pack size</p>
            )}
          </SheetHeader>
          <div className="flex-1 py-6 space-y-4">
            <div className="space-y-1">
              <Label>Item name</Label>
              <Input
                className="h-10"
                value={editor.editItemDetailsForm.item_name}
                onChange={(e) =>
                  editor.setEditItemDetailsForm((f) => ({ ...f, item_name: e.target.value }))
                }
              />
            </div>
            <div className="space-y-1">
              <Label>Unit</Label>
              <Input
                className="h-10"
                placeholder="lb, case…"
                value={editor.editItemDetailsForm.unit}
                onChange={(e) =>
                  editor.setEditItemDetailsForm((f) => ({ ...f, unit: e.target.value }))
                }
              />
            </div>
            <div className="space-y-1">
              <Label>Pack size</Label>
              <Input
                className="h-10"
                value={editor.editItemDetailsForm.pack_size}
                onChange={(e) =>
                  editor.setEditItemDetailsForm((f) => ({ ...f, pack_size: e.target.value }))
                }
              />
            </div>
          </div>
          <SheetFooter className="flex flex-col gap-2 pt-2">
            <Button
              className="w-full bg-blue-600 text-white hover:bg-blue-700"
              disabled={editItemDetailsSaving || !isCountingEditable}
              onClick={() => void handlers.onSaveEditItemDetails()}
            >
              {editItemDetailsSaving ? "Saving…" : "Save"}
            </Button>
            <Button
              variant="outline"
              className="w-full"
              onClick={() => editor.setEditItemDetailsSessionItem(null)}
            >
              Cancel
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>

      {/* Staff PAR Request Sheet */}
      <Sheet
        open={!!editor.staffParRequestItem}
        onOpenChange={(o) => { if (!o) editor.setStaffParRequestItem(null); }}
      >
        <SheetContent side="right" className="w-full sm:max-w-sm flex flex-col">
          <SheetHeader>
            <SheetTitle>Request PAR change</SheetTitle>
            {editor.staffParRequestItem && (
              <p className="text-sm text-muted-foreground truncate">
                {editor.staffParRequestItem.item_name}
              </p>
            )}
          </SheetHeader>
          <div className="flex-1 py-6 space-y-4">
            <div className="rounded-lg border border-border/50 bg-muted/30 px-3 py-2 text-sm">
              <span className="text-muted-foreground">Current PAR: </span>
              <span className="font-mono font-semibold tabular-nums">
                {editor.staffParRequestItem
                  ? formatNum(fns.getApprovedPar(editor.staffParRequestItem))
                  : "—"}
              </span>
            </div>
            <div className="space-y-1">
              <Label>Suggested PAR</Label>
              <Input
                type="number"
                min={0}
                step={0.1}
                className="h-10"
                value={editor.staffParSuggested}
                onChange={(e) => editor.setStaffParSuggested(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label>
                Reason <span className="text-muted-foreground font-normal">(optional)</span>
              </Label>
              <Textarea
                className="min-h-[72px]"
                value={editor.staffParReason}
                onChange={(e) => editor.setStaffParReason(e.target.value)}
                placeholder="e.g. sales increased…"
              />
            </div>
          </div>
          <SheetFooter className="flex flex-col gap-2 pt-2">
            <Button
              className="w-full bg-blue-600 text-white hover:bg-blue-700"
              disabled={staffParSending}
              onClick={() => void handlers.onStaffParChangeRequestSubmit()}
            >
              {staffParSending ? "Sending…" : "Submit request"}
            </Button>
            <Button
              variant="outline"
              className="w-full"
              onClick={() => editor.setStaffParRequestItem(null)}
            >
              Cancel
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>

      {/* Staff Price Request Sheet */}
      <Sheet
        open={!!editor.staffPriceRequestItem}
        onOpenChange={(o) => { if (!o) editor.setStaffPriceRequestItem(null); }}
      >
        <SheetContent side="right" className="w-full sm:max-w-sm flex flex-col">
          <SheetHeader>
            <SheetTitle>Request price change</SheetTitle>
            {editor.staffPriceRequestItem && (
              <p className="text-sm text-muted-foreground truncate">
                {editor.staffPriceRequestItem.item_name}
              </p>
            )}
          </SheetHeader>
          <div className="flex-1 py-6 space-y-4">
            <div className="rounded-lg border border-border/50 bg-muted/30 px-3 py-2 text-sm">
              <span className="text-muted-foreground">Current price: </span>
              <span className="font-mono font-semibold tabular-nums">
                {editor.staffPriceRequestItem
                  ? (() => {
                      const p = editor.staffPriceRequestItem.unit_cost;
                      if (p != null && Number.isFinite(Number(p)))
                        return `$${Number(p).toFixed(2)}`;
                      const d = fns.getCatalogUnitCost(catalogIdFromSessionItem(editor.staffPriceRequestItem));
                      return d != null ? `$${d.toFixed(2)}` : "—";
                    })()
                  : "—"}
              </span>
            </div>
            <div className="space-y-1">
              <Label>Suggested price ($)</Label>
              <Input
                type="number"
                min={0}
                step={0.01}
                className="h-10"
                value={editor.staffPriceSuggested}
                onChange={(e) => editor.setStaffPriceSuggested(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label>
                Reason <span className="text-muted-foreground font-normal">(optional)</span>
              </Label>
              <Textarea
                className="min-h-[72px]"
                value={editor.staffPriceReason}
                onChange={(e) => editor.setStaffPriceReason(e.target.value)}
              />
            </div>
          </div>
          <SheetFooter className="flex flex-col gap-2 pt-2">
            <Button
              className="w-full bg-blue-600 text-white hover:bg-blue-700"
              disabled={staffPriceSending}
              onClick={() => void handlers.onStaffPriceChangeRequestSubmit()}
            >
              {staffPriceSending ? "Sending…" : "Submit request"}
            </Button>
            <Button
              variant="outline"
              className="w-full"
              onClick={() => editor.setStaffPriceRequestItem(null)}
            >
              Cancel
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>

      {/* Manager PAR Edit Sheet */}
      <Sheet
        open={!!editor.managerParEditItem}
        onOpenChange={(o) => { if (!o) editor.setManagerParEditItem(null); }}
      >
        <SheetContent side="right" className="w-full sm:max-w-sm flex flex-col">
          <SheetHeader>
            <SheetTitle className="flex items-center gap-2">
              Edit PAR level
              {!canEditPar ? <Lock className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden /> : null}
            </SheetTitle>
            {editor.managerParEditItem && (
              <p className="text-sm text-muted-foreground truncate">
                {editor.managerParEditItem.item_name}
              </p>
            )}
          </SheetHeader>
          <p className="text-xs text-muted-foreground">
            Updates the linked PAR guide and catalog default PAR.
          </p>
          {!canEditPar ? (
            <p className="text-xs text-amber-800 dark:text-amber-200/90">
              PAR editing is disabled for your role at this location. Ask the owner to enable “Edit PAR levels” in Locations & Team.
            </p>
          ) : null}
          {isManagerOrOwner &&
            canEditPar &&
            editor.countingParGuideId &&
            activeSession?.inventory_list_id &&
            editor.managerParEditItem && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="w-full gap-2 mt-2 text-xs"
                onClick={() => {
                  const q = new URLSearchParams({
                    guide: editor.countingParGuideId!,
                    list: activeSession.inventory_list_id!,
                  });
                  if (editor.managerParEditItem?.item_name)
                    q.set("focus", editor.managerParEditItem.item_name);
                  handlers.navigate(`/app/par?${q.toString()}`);
                  editor.setManagerParEditItem(null);
                }}
              >
                <ExternalLink className="h-3.5 w-3.5 shrink-0" />
                Fix PAR in guide
              </Button>
            )}
          <div className="flex-1 py-6 space-y-4">
            <div className="space-y-1">
              <Label>New PAR level</Label>
              <Input
                type="number"
                min={0}
                step={0.1}
                className="h-10"
                value={editor.managerParInput}
                readOnly={!canEditPar}
                onChange={(e) => editor.setManagerParInput(e.target.value)}
              />
            </div>
          </div>
          <SheetFooter className="flex flex-col gap-2 pt-2">
            <Button
              className="w-full bg-blue-600 text-white hover:bg-blue-700"
              disabled={managerParSaving || !isCountingEditable || !canEditPar}
              onClick={() => void handlers.onManagerParLevelSave()}
            >
              {managerParSaving ? "Saving…" : "Save"}
            </Button>
            <Button
              variant="outline"
              className="w-full"
              onClick={() => editor.setManagerParEditItem(null)}
            >
              Cancel
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>

      {/* Manager Price Edit Sheet */}
      <Sheet
        open={!!editor.managerPriceEditItem}
        onOpenChange={(o) => { if (!o) editor.setManagerPriceEditItem(null); }}
      >
        <SheetContent side="right" className="w-full sm:max-w-sm flex flex-col">
          <SheetHeader>
            <SheetTitle>Edit price</SheetTitle>
            {editor.managerPriceEditItem && (
              <p className="text-sm text-muted-foreground truncate">
                {editor.managerPriceEditItem.item_name}
              </p>
            )}
          </SheetHeader>
          <p className="text-xs text-muted-foreground">
            Updates unit cost on this count and catalog default unit cost.
          </p>
          <div className="flex-1 py-6 space-y-4">
            <div className="space-y-1">
              <Label>Unit cost ($)</Label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">
                  $
                </span>
                <Input
                  type="number"
                  step="0.01"
                  min={0}
                  className="pl-7 h-10"
                  value={editor.managerPriceInput}
                  onChange={(e) => editor.setManagerPriceInput(e.target.value)}
                  placeholder="0.00"
                />
              </div>
            </div>
          </div>
          <SheetFooter className="flex flex-col gap-2 pt-2">
            <Button
              className="w-full bg-blue-600 text-white hover:bg-blue-700"
              disabled={managerPriceSaving || !isCountingEditable}
              onClick={() => void handlers.onManagerPriceSave()}
            >
              {managerPriceSaving ? "Saving…" : "Save"}
            </Button>
            <Button
              variant="outline"
              className="w-full"
              onClick={() => editor.setManagerPriceEditItem(null)}
            >
              Cancel
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </div>
  );
}
