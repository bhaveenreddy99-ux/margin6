import { Fragment, useCallback, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useRestaurant } from "@/contexts/RestaurantContext";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuSub, DropdownMenuSubContent, DropdownMenuSubTrigger,
  DropdownMenuTrigger, DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel,
  AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList,
  BreadcrumbPage, BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetFooter } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Plus, Upload, Download, MoreVertical, Pencil, Trash2,
  Search, ArrowLeft, AlertTriangle, ShoppingCart, ChevronRight,
  GripVertical, Copy, LayoutList, FolderPlus, Check, X,
  Package, FolderOpen, ClipboardList, Sparkles, Clock,
  ChevronDown, MoveRight, Settings, Link2,
} from "lucide-react";
import { DragDropContext, Droppable, Draggable } from "@hello-pangea/dnd";
import type { DraggableProvided } from "@hello-pangea/dnd";
import { useLastOrderDates } from "@/hooks/useLastOrderDates";
import {
  DROPPABLE_SHELF_ORDER,
  filterCatalogItems,
  getCurrentCategories,
  getCurrentMappings,
  getImportFieldLabel,
  getOrderedFullGroupKeys,
  getOrderedNamedCategoryKeys,
  groupCatalogItems,
  itemDroppableId,
  RESERVED_GROUP_NAMES,
  buildSortedLists,
} from "@/domain/catalog/listManagementHelpers";
import {
  OPTIONAL_IMPORT_FIELDS,
  REQUIRED_IMPORT_FIELDS,
} from "@/domain/catalog/listManagementTypes";
import type {
  AdvancedListView,
  CatalogItem,
  CatalogItemQuickUpdate,
  EditSheetValues,
  GridSort,
  ImportMapping,
  ImportPreviewRow,
  ImportStep,
  ImportSummary,
  InventoryListRow,
  ItemCategoryMap,
  ItemEditDraft,
  IssueItem,
  ListCategory,
  NewItemDraft,
} from "@/domain/catalog/listManagementTypes";
import { useListManagementData } from "@/hooks/useListManagementData";
import { useListManagementActions } from "@/hooks/useListManagementActions";

// ─── ISSUE ROW WITH INLINE QUICK FIX ────────────
function IssueRow({ item, onFix, onQuickSave }: {
  item: IssueItem;
  onFix: (item: IssueItem) => void;
  onQuickSave: (id: string, updates: CatalogItemQuickUpdate) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [itemName, setItemName] = useState(item.item_name || "");
  const [vendorSku, setVendorSku] = useState(item.vendor_sku || "");
  const [unit, setUnit] = useState(item.unit || "");

  if (editing) {
    return (
      <TableRow>
        <TableCell><Input className="h-7 text-xs" value={itemName} onChange={e => setItemName(e.target.value)} placeholder="Item name" /></TableCell>
        <TableCell>
          <div className="flex flex-wrap gap-1">
            {item.reasons.map(r => (
              <Badge key={r} variant={r.includes("Duplicate") ? "destructive" : "secondary"} className="text-[10px]">{r}</Badge>
            ))}
          </div>
        </TableCell>
        <TableCell><Input className="h-7 text-xs w-24" value={vendorSku} onChange={e => setVendorSku(e.target.value)} placeholder="Product #" /></TableCell>
        <TableCell className="text-xs">{item.vendor_name || <span className="text-muted-foreground/50">—</span>}</TableCell>
        <TableCell><Input className="h-7 text-xs w-24" value={unit} onChange={e => setUnit(e.target.value)} placeholder="Unit" /></TableCell>
        <TableCell className="text-xs">{item.pack_size || <span className="text-destructive">Missing</span>}</TableCell>
        <TableCell className="text-xs font-mono">{item.default_unit_cost != null ? `$${Number(item.default_unit_cost).toFixed(2)}` : <span className="text-muted-foreground/50">—</span>}</TableCell>
        <TableCell>
          <div className="flex gap-1">
            <Button size="sm" variant="default" className="h-7 text-xs px-2 bg-gradient-amber" onClick={async () => {
              const updates: CatalogItemQuickUpdate = {};
              updates.item_name = itemName.trim();
              updates.vendor_sku = vendorSku.trim() || null;
              updates.unit = unit.trim() || null;
              if (Object.keys(updates).length > 0) await onQuickSave(item.id, updates);
              setEditing(false);
            }}>
              <Check className="h-3 w-3" />
            </Button>
            <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => setEditing(false)}>
              <X className="h-3 w-3" />
            </Button>
          </div>
        </TableCell>
      </TableRow>
    );
  }

  return (
    <TableRow>
      <TableCell className="font-medium text-sm">{item.item_name || <span className="text-destructive">Missing</span>}</TableCell>
      <TableCell>
        <div className="flex flex-wrap gap-1">
          {item.reasons.map(r => (
            <Badge key={r} variant={r.includes("Duplicate") ? "destructive" : "secondary"} className="text-[10px]">{r}</Badge>
          ))}
        </div>
      </TableCell>
      <TableCell className="text-xs">{item.vendor_sku || <span className="text-destructive">Missing</span>}</TableCell>
      <TableCell className="text-xs">{item.vendor_name || <span className="text-destructive">Missing</span>}</TableCell>
      <TableCell className="text-xs">{item.unit || <span className="text-destructive">Missing</span>}</TableCell>
      <TableCell className="text-xs">{item.pack_size || <span className="text-destructive">Missing</span>}</TableCell>
      <TableCell className="text-xs font-mono">{item.default_unit_cost != null ? `$${Number(item.default_unit_cost).toFixed(2)}` : <span className="text-destructive">Missing</span>}</TableCell>
      <TableCell>
        <div className="flex gap-1">
          <Button size="sm" variant="outline" className="h-7 text-xs px-2" onClick={() => setEditing(true)}>
            <Pencil className="h-3 w-3 mr-1" /> Quick Fix
          </Button>
          <Button size="sm" variant="ghost" className="h-7 text-xs px-2" onClick={() => onFix(item)}>
            Full Edit
          </Button>
        </div>
      </TableCell>
    </TableRow>
  );
}

// ─── COMPONENT ──────────────────────────────────

export default function ListManagementPage() {
  const { currentRestaurant, currentLocation } = useRestaurant();
  const { user } = useAuth();
  const navigate = useNavigate();
  const restaurantId = currentRestaurant?.id;
  const { lastOrderDates } = useLastOrderDates(restaurantId, currentLocation?.id);

  const {
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
  } = useListManagementData({ restaurantId });

  // ── Grid state
  const [gridSearch, setGridSearch] = useState("");
  const [gridSort, setGridSort] = useState<GridSort>("date");
  const [createOpen, setCreateOpen] = useState(false);
  const [newListName, setNewListName] = useState("");

  // ── Detail state
  const [selectedList, setSelectedList] = useState<InventoryListRow | null>(null);
  const [detailSearch, setDetailSearch] = useState("");
  const [activeTab, setActiveTab] = useState("items");

  /** Primary = null (shelves + list order). Keyword groups / recent are secondary. */
  const [advancedListView, setAdvancedListView] = useState<AdvancedListView>(null);

  // ── List categories (per-list, per-set)
  const [newListCategoryName, setNewListCategoryName] = useState("");

  // ── Category sets & mappings
  // ── Bulk select
  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set());
  const [bulkMoveOpen, setBulkMoveOpen] = useState(false);
  const [bulkMoveTarget, setBulkMoveTarget] = useState("");

  // ── Inline edit
  const [editingItem, setEditingItem] = useState<string | null>(null);
  const [editValues, setEditValues] = useState<ItemEditDraft>({});

  // ── Edit sheet (three-dot menu)
  const [editSheetItem, setEditSheetItem] = useState<CatalogItem | null>(null);
  const [editSheetValues, setEditSheetValues] = useState<EditSheetValues>({
    item_name: "",
    vendor_sku: "",
    default_unit_cost: null,
    unit: "",
    pack_size: "",
  });
  const [editSheetSaving, setEditSheetSaving] = useState(false);

  // ── Delete item confirm
  const [deleteItemId, setDeleteItemId] = useState<string | null>(null);
  const [deleteItemName, setDeleteItemName] = useState("");

  // ── Add item
  const [addItemOpen, setAddItemOpen] = useState(false);
  const [newItem, setNewItem] = useState<NewItemDraft>({
    item_name: "",
    category: "",
    unit: "",
    pack_size: "",
    vendor_sku: "",
    vendor_name: "",
    default_unit_cost: 0,
  });

  // ── Rename/Delete
  const [renameOpen, setRenameOpen] = useState(false);
  const [renameListId, setRenameListId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [deleteListId, setDeleteListId] = useState<string | null>(null);

  // ── Import
  const [importOpen, setImportOpen] = useState(false);
  const [importStep, setImportStep] = useState<ImportStep>("upload");
  const [importData, setImportData] = useState<Record<string, string | number | boolean | null | undefined>[]>([]);
  const [importHeaders, setImportHeaders] = useState<string[]>([]);
  const [importMapping, setImportMapping] = useState<ImportMapping>({});
  const [importPreview, setImportPreview] = useState<ImportPreviewRow[]>([]);
  const [importTargetList, setImportTargetList] = useState<string>("new");
  const [importNewListName, setImportNewListName] = useState("");
  const [importSummary, setImportSummary] = useState<ImportSummary | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const [renamingCategoryId, setRenamingCategoryId] = useState<string | null>(null);
  const [renameCategoryValue, setRenameCategoryValue] = useState("");
  const [subCategoryDialogOpen, setSubCategoryDialogOpen] = useState(false);
  const [subCategoryParentId, setSubCategoryParentId] = useState<string | null>(null);
  const [subCategoryName, setSubCategoryName] = useState("");

  // ── Auto-save
  const [saveStatus, setSaveStatus] = useState<"saved" | "saving" | "idle">("idle");

  // ── Collapsible categories
  const [collapsedCategories, setCollapsedCategories] = useState<Set<string>>(new Set());
  const toggleCategoryCollapse = (catName: string) => {
    setCollapsedCategories(prev => {
      const next = new Set(prev);
      if (next.has(catName)) next.delete(catName); else next.add(catName);
      return next;
    });
  };

  const openListDetail = useCallback(async (list: InventoryListRow) => {
    setSelectedList(list);
    setDetailSearch("");
    setActiveTab("items");
    setEditingItem(null);
    setSelectedItems(new Set());

    if (list.active_category_mode === "custom_ai") setAdvancedListView("keyword-groups");
    else if (list.active_category_mode === "recently_purchased") setAdvancedListView("recent");
    else setAdvancedListView(null);
    await loadListDetail(list);
  }, [loadListDetail]);

  const toggleSelectItem = (id: string) => {
    setSelectedItems(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const resetImport = () => {
    setImportStep("upload");
    setImportData([]);
    setImportHeaders([]);
    setImportMapping({});
    setImportPreview([]);
    setImportSummary(null);
    setImportTargetList("new");
    setImportNewListName("");
    if (fileRef.current) fileRef.current.value = "";
  };

  const currentCategoriesForView = useMemo(
    () =>
      getCurrentCategories({
        selectedListId: selectedList?.id,
        advancedListView,
        categorySets,
        listCategories,
        itemCategoryMaps,
      }),
    [selectedList?.id, advancedListView, categorySets, listCategories, itemCategoryMaps],
  );

  const currentMappingsForView = useMemo(
    () =>
      getCurrentMappings({
        selectedListId: selectedList?.id,
        advancedListView,
        categorySets,
        listCategories,
        itemCategoryMaps,
      }),
    [selectedList?.id, advancedListView, categorySets, listCategories, itemCategoryMaps],
  );

  const filteredItems = useMemo(
    () => filterCatalogItems(catalogItems, detailSearch),
    [catalogItems, detailSearch],
  );

  const groupedItems = useMemo(
    () =>
      groupCatalogItems({
        items: filteredItems,
        selectedListId: selectedList?.id,
        advancedListView,
        categorySets,
        listCategories,
        itemCategoryMaps,
        recentPurchasedItems,
      }),
    [
      filteredItems,
      selectedList?.id,
      advancedListView,
      categorySets,
      listCategories,
      itemCategoryMaps,
      recentPurchasedItems,
    ],
  );

  const sortedLists = useMemo(
    () => buildSortedLists(lists, gridSearch, gridSort),
    [lists, gridSearch, gridSort],
  );

  const {
    persistListCategoryModeToDb,
    handleCreateList,
    handleRenameList: handleRename,
    handleDuplicateList: handleDuplicate,
    handleDeleteList: handleDelete,
    handleAddItemToList,
    handleSaveInlineEdit: handleSaveEdit,
    handleDuplicateItem,
    handleQuickSaveIssue,
    handleSaveEditSheet,
    handleDeleteItemConfirmed,
    handleDragEnd,
    handleBulkMove,
    handleSaveAICategories,
    handleImportFileUpload: handleFileUpload,
    handleImportPreview,
    handleImportConfirm,
    handleAddListCategory,
    handleAddSubCategory,
    handleRenameCategory,
    handleDeleteCategory,
    handleExportList,
    handleAddFromPurchase,
  } = useListManagementActions({
    restaurantId,
    userId: user?.id,
    selectedList,
    setSelectedList,
    catalogItems,
    categorySets,
    listCategories,
    itemCategoryMaps,
    currentCategories: currentCategoriesForView,
    currentMappings: currentMappingsForView,
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
  });

  // ─── LOADING STATE ────────────────────────────
  if (!currentRestaurant) {
    return (
      <div className="empty-state">
        <Package className="empty-state-icon" />
        <p className="empty-state-title">Select a restaurant to manage lists</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="space-y-6 animate-fade-in">
        <Skeleton className="h-6 w-40" />
        <Skeleton className="h-10 w-64" />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3].map(i => <Skeleton key={i} className="h-32 rounded-xl" />)}
        </div>
      </div>
    );
  }

  // ═══════════════════════════════════════════════
  // ─── LIST DETAIL VIEW ─────────────────────────
  // ═══════════════════════════════════════════════
  if (selectedList) {
    const grouped = groupedItems;
    const currentCats = currentCategoriesForView;
    const isFlatSingleGroup = Object.keys(grouped).length === 1 && "All Items" in grouped;
    const showShelfChrome = advancedListView === "keyword-groups" || (advancedListView === null && !isFlatSingleGroup);
    const listFreshnessLabel =
      catalogItems.length > 0
        ? new Date(Math.max(...catalogItems.map(i => new Date(i.updated_at).getTime()))).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
        : new Date(selectedList.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

    const orderedGroupKeys = getOrderedFullGroupKeys(grouped, currentCats);
    const namedGroupKeys = getOrderedNamedCategoryKeys(grouped, currentCats);
    const canReorderShelves = namedGroupKeys.length >= 2 && showShelfChrome && advancedListView !== "recent";
    const multiGroupHeader = Object.keys(grouped).length > 1;

    function renderCategoryBlock(catName: string, catItems: CatalogItem[], draggableProvided?: DraggableProvided) {
      const catRecordForHeader = currentCats.find(c => c.name === catName);
      const canManageShelfHeader = !!catRecordForHeader && !RESERVED_GROUP_NAMES.has(catName);
      const itemDropId = itemDroppableId(catName, isFlatSingleGroup && catName === "All Items");
      return (
        <div
          ref={draggableProvided?.innerRef}
          {...(draggableProvided?.draggableProps ?? {})}
          className="rounded-lg border overflow-hidden"
        >
          {multiGroupHeader && (
            <div className="flex items-center justify-between gap-2 px-4 py-3 bg-muted/40 border-b border-border/40">
              <div className="flex flex-1 items-center gap-2 min-w-0">
                {draggableProvided && (
                  <div
                    {...draggableProvided.dragHandleProps}
                    className="cursor-grab active:cursor-grabbing shrink-0 p-1.5 rounded-md hover:bg-muted/60 touch-none text-muted-foreground/80"
                    aria-label="Reorder shelf"
                  >
                    <GripVertical className="h-4 w-4" />
                  </div>
                )}
                <button
                  type="button"
                  className="flex flex-1 items-center gap-2.5 min-w-0 text-left hover:bg-muted/50 rounded-md -m-1 p-1 transition-colors"
                  onClick={() => toggleCategoryCollapse(catName)}
                >
                  <ChevronDown className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200 ${collapsedCategories.has(catName) ? "-rotate-90" : ""}`} />
                  {renamingCategoryId && catRecordForHeader && renamingCategoryId === catRecordForHeader.id ? (
                    <Input
                      autoFocus
                      className="h-8 text-sm max-w-xs"
                      value={renameCategoryValue}
                      onChange={e => setRenameCategoryValue(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === "Enter" && catRecordForHeader && renameCategoryValue.trim()) {
                          void handleRenameCategory(catRecordForHeader, renameCategoryValue.trim());
                          setRenamingCategoryId(null);
                        }
                        if (e.key === "Escape") setRenamingCategoryId(null);
                      }}
                      onClick={ev => ev.stopPropagation()}
                    />
                  ) : (
                    <h3 className="text-xs font-bold uppercase tracking-wider text-foreground truncate">{catName}</h3>
                  )}
                  <Badge variant="secondary" className="text-[10px] font-mono shrink-0">{catItems.length}</Badge>
                </button>
              </div>
              {canManageShelfHeader && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" onClick={e => e.stopPropagation()}>
                      <MoreVertical className="h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" onClick={e => e.stopPropagation()}>
                    <DropdownMenuItem onClick={() => {
                      if (catRecordForHeader) {
                        setRenamingCategoryId(catRecordForHeader.id);
                        setRenameCategoryValue(catRecordForHeader.name);
                      }
                    }}>
                      <Pencil className="h-3.5 w-3.5 mr-2" /> Rename shelf
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => {
                      if (catRecordForHeader) {
                        setSubCategoryParentId(catRecordForHeader.id);
                        setSubCategoryName("");
                        setSubCategoryDialogOpen(true);
                      }
                    }}>
                      <FolderPlus className="h-3.5 w-3.5 mr-2" /> Add sub-category
                    </DropdownMenuItem>
                    <DropdownMenuItem className="text-destructive" onClick={() => { if (catRecordForHeader) void handleDeleteCategory(catRecordForHeader); }}>
                      <Trash2 className="h-3.5 w-3.5 mr-2" /> Delete shelf
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </div>
          )}

          {!collapsedCategories.has(catName) && (
            catItems.length === 0 ? (
              <div className="py-10 text-center text-muted-foreground">
                <p className="text-sm">No items in this category</p>
                <Button variant="ghost" size="sm" className="mt-2 gap-1 text-xs" onClick={() => setAddItemOpen(true)}>
                  <Plus className="h-3 w-3" /> Add Item
                </Button>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/20 border-b border-border/40">
                    {showShelfChrome && (
                      <TableHead className="w-10">
                        <Checkbox
                          checked={catItems.length > 0 && catItems.every(i => selectedItems.has(i.id))}
                          onCheckedChange={() => {
                            const allSelected = catItems.every(i => selectedItems.has(i.id));
                            setSelectedItems(prev => {
                              const next = new Set(prev);
                              catItems.forEach(i => allSelected ? next.delete(i.id) : next.add(i.id));
                              return next;
                            });
                          }}
                        />
                      </TableHead>
                    )}
                    <TableHead className="w-8"></TableHead>
                    <TableHead className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground min-w-[220px]">Item</TableHead>
                    <TableHead className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground w-20">Unit</TableHead>
                    <TableHead className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground w-24">Pack</TableHead>
                    <TableHead className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground w-28">SKU</TableHead>
                    <TableHead className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground w-28">Last Order</TableHead>
                    <TableHead className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground text-right w-24">Cost</TableHead>
                    <TableHead className="w-28"></TableHead>
                  </TableRow>
                </TableHeader>
                <Droppable droppableId={itemDropId} type="ITEM">
                  {(provided) => (
                    <TableBody ref={provided.innerRef} {...provided.droppableProps}>
                      {catItems.map((item, idx) => (
                        <Draggable key={item.id} draggableId={item.id} index={idx} isDragDisabled={advancedListView === "recent"}>
                          {(dragProvided, snapshot) => (
                            <TableRow
                              ref={dragProvided.innerRef}
                              {...dragProvided.draggableProps}
                              className={`group/row border-b border-border/40 transition-colors ${snapshot.isDragging ? "bg-accent shadow-md" : "hover:bg-muted/30"} ${selectedItems.has(item.id) ? "bg-primary/5" : ""}`}
                            >
                              {editingItem === item.id ? (
                                <>
                                  {showShelfChrome && <TableCell />}
                                  <TableCell><div {...dragProvided.dragHandleProps}><GripVertical className="h-4 w-4 text-muted-foreground/70" /></div></TableCell>
                                  <TableCell><Input className="h-8 text-sm" value={editValues.item_name || ""} onChange={e => setEditValues({ ...editValues, item_name: e.target.value })} /></TableCell>
                                  <TableCell><Input className="h-8 text-sm" value={editValues.unit || ""} onChange={e => setEditValues({ ...editValues, unit: e.target.value })} /></TableCell>
                                  <TableCell><Input className="h-8 text-sm" value={editValues.pack_size || ""} onChange={e => setEditValues({ ...editValues, pack_size: e.target.value })} /></TableCell>
                                  <TableCell><Input className="h-8 text-sm" value={editValues.vendor_sku || ""} onChange={e => setEditValues({ ...editValues, vendor_sku: e.target.value })} /></TableCell>
                                  <TableCell className="text-xs text-muted-foreground">—</TableCell>
                                  <TableCell><Input className="h-8 text-sm w-20" type="number" step="0.01" value={editValues.default_unit_cost ?? ""} onChange={e => setEditValues({ ...editValues, default_unit_cost: e.target.value === "" ? null : +e.target.value })} placeholder="Cost" /></TableCell>
                                  <TableCell>
                                    <div className="flex gap-1">
                                      <Button size="sm" variant="ghost" className="h-7 text-xs px-2" onClick={() => handleSaveEdit(item.id)}>Save</Button>
                                      <Button size="sm" variant="ghost" className="h-7 text-xs px-2" onClick={() => setEditingItem(null)}><X className="h-3 w-3" /></Button>
                                    </div>
                                  </TableCell>
                                </>
                              ) : (
                                <>
                                  {showShelfChrome && (
                                    <TableCell>
                                      <Checkbox
                                        checked={selectedItems.has(item.id)}
                                        onCheckedChange={() => toggleSelectItem(item.id)}
                                      />
                                    </TableCell>
                                  )}
                                  <TableCell className="w-8">
                                    <div {...dragProvided.dragHandleProps} className="cursor-grab active:cursor-grabbing touch-none">
                                      <GripVertical className="h-4 w-4 text-muted-foreground/70" />
                                    </div>
                                  </TableCell>
                                  <TableCell className="text-sm font-medium text-foreground min-w-[220px]">
                                    <div className="flex flex-col gap-0.5">
                                      <span className="font-semibold text-foreground leading-snug">{item.item_name}</span>
                                      <div className="flex items-center gap-2 flex-wrap">
                                        {item.brand_name && (
                                          <span className="text-[11px] text-muted-foreground italic">{item.brand_name}</span>
                                        )}
                                        {(!item.pack_size || !item.vendor_sku || item.default_unit_cost == null) ? (
                                          <span className="inline-flex items-center gap-1 text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-warning/10 text-warning border border-warning/20 uppercase tracking-wide">
                                            ⚠ missing fields
                                          </span>
                                        ) : (
                                          <span className="inline-flex items-center gap-1 text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-success/10 text-success border border-success/20 uppercase tracking-wide">
                                            ✓ complete
                                          </span>
                                        )}
                                      </div>
                                    </div>
                                  </TableCell>
                                  <TableCell className="w-20">
                                    {item.unit
                                      ? <span className="inline-flex items-center justify-center text-[10px] font-bold px-2 py-1 rounded-full bg-muted border border-border font-mono">{item.unit}</span>
                                      : <span className="text-destructive/40 text-xs">—</span>}
                                  </TableCell>
                                  <TableCell className="text-xs text-muted-foreground w-24 font-mono">
                                    {item.pack_size || (
                                      <button
                                        className="text-[10px] font-semibold text-primary/70 hover:text-primary bg-primary/5 hover:bg-primary/10 px-1.5 py-0.5 rounded transition-colors border border-primary/20"
                                        onClick={() => { setEditingItem(item.id); setEditValues({ item_name: item.item_name || "", category: item.category, unit: item.unit, pack_size: item.pack_size, vendor_sku: item.vendor_sku, default_unit_cost: item.default_unit_cost, default_par_level: item.default_par_level }); }}
                                      >+ add</button>
                                    )}
                                  </TableCell>
                                  <TableCell className="text-xs font-mono text-muted-foreground w-28">
                                    {item.vendor_sku || (
                                      <button
                                        className="text-[10px] font-semibold text-primary/70 hover:text-primary bg-primary/5 hover:bg-primary/10 px-1.5 py-0.5 rounded transition-colors border border-primary/20"
                                        onClick={() => { setEditingItem(item.id); setEditValues({ item_name: item.item_name || "", category: item.category, unit: item.unit, pack_size: item.pack_size, vendor_sku: item.vendor_sku, default_unit_cost: item.default_unit_cost, default_par_level: item.default_par_level }); }}
                                      >+ add</button>
                                    )}
                                  </TableCell>
                                  <TableCell className="text-xs text-muted-foreground w-28">
                                    {lastOrderDates[item.id]
                                      ? new Date(lastOrderDates[item.id]).toLocaleDateString("en-US", { month: "2-digit", day: "2-digit", year: "2-digit" })
                                      : <span className="text-muted-foreground/40">—</span>}
                                  </TableCell>
                                  <TableCell className="w-24 text-right">
                                    {item.default_unit_cost != null
                                      ? <span className={`text-sm font-bold font-mono tabular-nums ${item.default_unit_cost > 80 ? "text-success" : "text-foreground"}`}>
                                          ${Number(item.default_unit_cost).toFixed(2)}
                                        </span>
                                      : <button
                                          className="text-[10px] font-semibold text-warning hover:text-warning/80 bg-warning/10 hover:bg-warning/15 px-1.5 py-0.5 rounded transition-colors border border-warning/20"
                                          onClick={() => { setEditingItem(item.id); setEditValues({ item_name: item.item_name || "", category: item.category, unit: item.unit, pack_size: item.pack_size, vendor_sku: item.vendor_sku, default_unit_cost: item.default_unit_cost, default_par_level: item.default_par_level }); }}
                                        >+ add cost</button>}
                                  </TableCell>
                                  <TableCell className="w-10" onClick={e => e.stopPropagation()}>
                                    <DropdownMenu>
                                      <DropdownMenuTrigger asChild onClick={e => e.stopPropagation()}>
                                        <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground">
                                          <MoreVertical className="h-4 w-4" />
                                        </Button>
                                      </DropdownMenuTrigger>
                                      <DropdownMenuContent align="end">
                                        <DropdownMenuItem onClick={e => { e.stopPropagation(); const snap = item; setTimeout(() => { setEditSheetItem(snap); setEditSheetValues({ item_name: snap.item_name, vendor_sku: snap.vendor_sku || "", default_unit_cost: snap.default_unit_cost, unit: snap.unit || "", pack_size: snap.pack_size || "" }); }, 0); }}>
                                          <Pencil className="h-4 w-4 mr-2" /> Edit Item
                                        </DropdownMenuItem>
                                        <DropdownMenuItem onClick={e => { e.stopPropagation(); handleDuplicateItem(item); }}>
                                          <Copy className="h-4 w-4 mr-2" /> Duplicate Item
                                        </DropdownMenuItem>
                                        <DropdownMenuSeparator />
                                        <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={e => { e.stopPropagation(); const id = item.id; const name = item.item_name; setTimeout(() => { setDeleteItemId(id); setDeleteItemName(name); }, 0); }}>
                                          <Trash2 className="h-4 w-4 mr-2" /> Delete Item
                                        </DropdownMenuItem>
                                      </DropdownMenuContent>
                                    </DropdownMenu>
                                  </TableCell>
                                </>
                              )}
                            </TableRow>
                          )}
                        </Draggable>
                      ))}
                      {provided.placeholder}
                    </TableBody>
                  )}
                </Droppable>
              </Table>
            )
          )}
        </div>
      );
    }

    return (
      <div className="space-y-5 animate-fade-in">
        {/* Breadcrumb */}
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem><BreadcrumbLink href="/app/dashboard">Home</BreadcrumbLink></BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbLink className="cursor-pointer" onClick={() => setSelectedList(null)}>List Management</BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem><BreadcrumbPage>{selectedList.name}</BreadcrumbPage></BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>

        {/* Header */}
        <div className="flex items-center justify-between gap-4 pb-2">
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="icon" className="h-9 w-9 shrink-0" onClick={() => setSelectedList(null)}>
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-gradient-amber text-primary-foreground font-bold text-lg">
              {selectedList.name.charAt(0).toUpperCase()}
            </div>
            <div>
              <h1 className="text-2xl font-bold tracking-tight">{selectedList.name}</h1>
              <p className="text-sm text-muted-foreground">
                {catalogItems.length} items • Updated {listFreshnessLabel}
              </p>
              <div className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
                {linkedParGuide ? (
                  <>
                    <Link2 className="h-3.5 w-3.5" />
                    <span>PAR Guide: {linkedParGuide.name} • {linkedParGuide.itemCount} items</span>
                    <button
                      type="button"
                      className="font-medium text-primary hover:underline"
                      onClick={() => navigate("/app/par")}
                    >
                      Open PAR Management
                    </button>
                  </>
                ) : (
                  <>
                    <span>No PAR guide linked</span>
                    <button
                      type="button"
                      className="font-medium text-primary hover:underline"
                      onClick={() => navigate("/app/par")}
                    >
                      Set up in PAR Management →
                    </button>
                  </>
                )}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2.5">
            {saveStatus === "saving" && <span className="text-xs text-muted-foreground animate-pulse">Saving...</span>}
            {saveStatus === "saved" && <span className="text-xs text-success flex items-center gap-1"><Check className="h-3 w-3" /> Saved</span>}

            <Button variant="outline" size="sm" className="gap-1.5 h-9" onClick={() => { setImportTargetList(selectedList.id); setImportOpen(true); }}>
              <Upload className="h-3.5 w-3.5" /> Import
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className="gap-1.5 h-9"><Download className="h-3.5 w-3.5" /> Export</Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                <DropdownMenuItem onClick={() => handleExportList(selectedList, "csv")}>CSV</DropdownMenuItem>
                <DropdownMenuItem onClick={() => handleExportList(selectedList, "xlsx")}>Excel (.xlsx)</DropdownMenuItem>
                <DropdownMenuItem onClick={() => handleExportList(selectedList, "pdf")}>PDF</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            {/* Manage List Menu */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className="gap-1.5 h-9"><Settings className="h-3.5 w-3.5" /> Manage list</Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => { setRenameListId(selectedList.id); setRenameValue(selectedList.name); setRenameOpen(true); }}>
                  <Pencil className="h-3.5 w-3.5 mr-2" /> Rename list
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => handleDuplicate(selectedList)}>
                  <Copy className="h-3.5 w-3.5 mr-2" /> Duplicate list
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuSub>
                  <DropdownMenuSubTrigger><Download className="h-3.5 w-3.5 mr-2" /> Export list</DropdownMenuSubTrigger>
                  <DropdownMenuSubContent>
                    <DropdownMenuItem onClick={() => handleExportList(selectedList, "csv")}>CSV</DropdownMenuItem>
                    <DropdownMenuItem onClick={() => handleExportList(selectedList, "xlsx")}>Excel (.xlsx)</DropdownMenuItem>
                    <DropdownMenuItem onClick={() => handleExportList(selectedList, "pdf")}>PDF</DropdownMenuItem>
                  </DropdownMenuSubContent>
                </DropdownMenuSub>
                <DropdownMenuSeparator />
                <DropdownMenuItem className="text-destructive" onClick={() => setDeleteListId(selectedList.id)}>
                  <Trash2 className="h-3.5 w-3.5 mr-2" /> Delete list
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        {/* Tabs: Items | Issues */}
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList>
            <TabsTrigger value="items" className="gap-1.5">
              <LayoutList className="h-3.5 w-3.5" /> Items
            </TabsTrigger>
            <TabsTrigger value="issues" className="gap-1.5">
              <AlertTriangle className="h-3.5 w-3.5" /> Issues
              {issues.length > 0 && <Badge variant="destructive" className="ml-1 h-5 px-1.5 text-[10px]">{issues.length}</Badge>}
            </TabsTrigger>
          </TabsList>

          {/* ── ITEMS TAB ── */}
          <TabsContent value="items" className="space-y-4">
            {/* Toolbar */}
            <div className="flex items-center gap-4 flex-wrap">
              <div className="relative min-w-[240px] max-w-md flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input value={detailSearch} onChange={e => setDetailSearch(e.target.value)} placeholder="Search items..." className="pl-10 h-10" />
              </div>

              <div className="flex items-center gap-3 ml-auto flex-wrap justify-end">
                {advancedListView !== null && (
                  <Badge variant="outline" className="text-[10px] font-normal shrink-0">
                    {advancedListView === "keyword-groups" ? "Keyword groups" : "Recently purchased"}
                  </Badge>
                )}
                {advancedListView !== "recent" && (
                  <div className="flex items-center gap-2 bg-muted/40 rounded-lg p-1.5 border min-w-[200px] max-w-md flex-1">
                    <Input
                      value={newListCategoryName}
                      onChange={e => setNewListCategoryName(e.target.value)}
                      placeholder="New shelf name..."
                      className="h-9 text-sm border-0 bg-transparent focus-visible:ring-0 px-2"
                      onKeyDown={e => e.key === "Enter" && void handleAddListCategory()}
                    />
                    <Button size="sm" onClick={() => void handleAddListCategory()} disabled={!newListCategoryName.trim()} className="h-9 px-3 bg-gradient-amber gap-1.5 text-xs shrink-0">
                      <FolderPlus className="h-3.5 w-3.5" /> Add shelf
                    </Button>
                  </div>
                )}
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="outline" size="sm" className="h-10 gap-1.5">
                      More views <ChevronDown className="h-3.5 w-3.5" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    {advancedListView !== null && (
                      <DropdownMenuItem onClick={() => { setAdvancedListView(null); setSelectedItems(new Set()); void persistListCategoryModeToDb(null); }}>
                        <LayoutList className="h-3.5 w-3.5 mr-2" /> Shelf list (default)
                      </DropdownMenuItem>
                    )}
                    {advancedListView !== "keyword-groups" && (
                      <DropdownMenuItem onClick={() => { setAdvancedListView("keyword-groups"); setSelectedItems(new Set()); void persistListCategoryModeToDb("keyword-groups"); }}>
                        <Sparkles className="h-3.5 w-3.5 mr-2" /> Keyword groups (auto)
                      </DropdownMenuItem>
                    )}
                    {advancedListView !== "recent" && (
                      <DropdownMenuItem onClick={() => { setAdvancedListView("recent"); setSelectedItems(new Set()); void persistListCategoryModeToDb("recent"); }}>
                        <Clock className="h-3.5 w-3.5 mr-2" /> Recently purchased
                      </DropdownMenuItem>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>

                <Dialog open={addItemOpen} onOpenChange={setAddItemOpen}>
                  <DialogTrigger asChild>
                    <Button className="bg-gradient-amber gap-1.5 h-10 px-5"><Plus className="h-4 w-4" /> Add Item</Button>
                  </DialogTrigger>
                  <DialogContent>
                    <DialogHeader><DialogTitle>Add Item</DialogTitle></DialogHeader>
                    <div className="space-y-3">
                      <div className="space-y-1"><Label className="text-xs">Item Name *</Label><Input value={newItem.item_name} onChange={e => setNewItem({ ...newItem, item_name: e.target.value })} /></div>
                      <div className="grid grid-cols-2 gap-3">
                        <div className="space-y-1"><Label className="text-xs">Unit *</Label><Input value={newItem.unit} onChange={e => setNewItem({ ...newItem, unit: e.target.value })} placeholder="e.g. lbs, each" /></div>
                        <div className="space-y-1"><Label className="text-xs">Pack Size *</Label><Input value={newItem.pack_size} onChange={e => setNewItem({ ...newItem, pack_size: e.target.value })} placeholder="e.g. 12 oz" /></div>
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <div className="space-y-1"><Label className="text-xs">Category</Label>
                          <Select value={newItem.category} onValueChange={v => setNewItem({ ...newItem, category: v })}>
                            <SelectTrigger className="h-9"><SelectValue placeholder="Select..." /></SelectTrigger>
                            <SelectContent>
                              {currentCats.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-1"><Label className="text-xs">Product Number</Label><Input value={newItem.vendor_sku} onChange={e => setNewItem({ ...newItem, vendor_sku: e.target.value })} placeholder="Vendor item number used for ordering" /></div>
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <div className="space-y-1"><Label className="text-xs">Vendor Name</Label><Input value={newItem.vendor_name} onChange={e => setNewItem({ ...newItem, vendor_name: e.target.value })} placeholder="e.g. Sysco, US Foods" /></div>
                        <div className="space-y-1"><Label className="text-xs">Unit Cost</Label><Input type="number" step="0.01" value={newItem.default_unit_cost || ""} onChange={e => setNewItem({ ...newItem, default_unit_cost: parseFloat(e.target.value) || 0 })} /></div>
                      </div>
                      <Button onClick={handleAddItemToList} className="w-full bg-gradient-amber" disabled={!newItem.item_name || !newItem.unit || !newItem.pack_size}>Add Item</Button>
                    </div>
                  </DialogContent>
                </Dialog>
              </div>
            </div>

            {/* Bulk action bar */}
            {selectedItems.size > 0 && (
              <div className="flex items-center gap-3 p-3 rounded-lg border bg-muted/30">
                <Badge variant="secondary" className="text-xs">{selectedItems.size} selected</Badge>
                <Dialog open={bulkMoveOpen} onOpenChange={setBulkMoveOpen}>
                  <DialogTrigger asChild>
                    <Button size="sm" variant="outline" className="gap-1.5 h-8 text-xs">
                      <MoveRight className="h-3.5 w-3.5" /> Move to category
                    </Button>
                  </DialogTrigger>
                  <DialogContent className="max-w-sm">
                    <DialogHeader><DialogTitle>Move {selectedItems.size} items</DialogTitle></DialogHeader>
                    <div className="space-y-3">
                      <Select value={bulkMoveTarget} onValueChange={setBulkMoveTarget}>
                        <SelectTrigger className="h-9"><SelectValue placeholder="Select category..." /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__uncategorized">Uncategorized</SelectItem>
                          {currentCats.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                        </SelectContent>
                      </Select>
                      <Button onClick={handleBulkMove} className="w-full bg-gradient-amber" disabled={!bulkMoveTarget}>Move Items</Button>
                    </div>
                  </DialogContent>
                </Dialog>
                <Button size="sm" variant="ghost" className="h-8 text-xs" onClick={() => setSelectedItems(new Set())}>
                  <X className="h-3.5 w-3.5 mr-1" /> Clear
                </Button>
              </div>
            )}

            {/* Keyword groups: Auto-create + Save button */}
            {advancedListView === "keyword-groups" && (
              <div className="flex items-center gap-3 p-3 rounded-lg border border-primary/20 bg-primary/5">
                <Sparkles className="h-4 w-4 text-primary" />
                <p className="text-xs text-muted-foreground flex-1">Auto-generated categories based on item names. Click "Save" to persist to this list.</p>
                <Button size="sm" variant="outline" className="h-8 text-xs gap-1.5" onClick={handleSaveAICategories}>
                  <Check className="h-3 w-3" /> Save categories to list
                </Button>
              </div>
            )}

            {/* ── Stats Summary Strip ── */}
            <div className="flex items-center gap-4 px-4 py-2.5 rounded-lg border bg-card flex-wrap">
              <div className="flex items-center gap-1.5">
                <span className="text-base font-bold font-mono text-foreground">{filteredItems.length}</span>
                <span className="text-xs text-muted-foreground">items</span>
              </div>
              <div className="w-px h-5 bg-border" />
              <div className="flex items-center gap-1.5">
                <span className="text-base font-bold font-mono text-success">
                  ${catalogItems.reduce((sum, i) => sum + (i.default_unit_cost || 0), 0).toFixed(2)}
                </span>
                <span className="text-xs text-muted-foreground">total value</span>
              </div>
              <div className="w-px h-5 bg-border" />
              <div className="flex items-center gap-1.5">
                <span className={`text-base font-bold font-mono ${issues.length > 0 ? "text-warning" : "text-success"}`}>{issues.length}</span>
                <span className="text-xs text-muted-foreground">issues</span>
              </div>
              {issues.length > 0 && (
                <>
                  <div className="w-px h-5 bg-border" />
                  <button
                    className="flex items-center gap-1.5 text-xs font-semibold text-warning hover:underline"
                    onClick={() => setActiveTab("issues")}
                  >
                    <AlertTriangle className="h-3.5 w-3.5" /> Fix {issues.length} issues →
                  </button>
                </>
              )}
            </div>

            {/* Items Table with Groups */}
            <DragDropContext onDragEnd={handleDragEnd}>
              {filteredItems.length === 0 ? (
                <div className="border rounded-lg py-16 text-center text-muted-foreground">
                  <FolderOpen className="mx-auto h-12 w-12 mb-4 opacity-20" />
                  <p className="text-sm font-medium">No items found</p>
                  <p className="text-xs mt-1 mb-4">Add items or import from a file to get started.</p>
                  <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setAddItemOpen(true)}>
                    <Plus className="h-3.5 w-3.5" /> Add Item
                  </Button>
                </div>
              ) : (
                <div className="space-y-4">
                  {isFlatSingleGroup ? (
                    renderCategoryBlock("All Items", grouped["All Items"] ?? [])
                  ) : canReorderShelves ? (
                    <>
                      {orderedGroupKeys.includes("Uncategorized") &&
                        renderCategoryBlock("Uncategorized", grouped["Uncategorized"] ?? [])}
                      <Droppable droppableId={DROPPABLE_SHELF_ORDER} type="SHELF" direction="vertical">
                        {(shelfProvided) => (
                          <div ref={shelfProvided.innerRef} {...shelfProvided.droppableProps} className="space-y-4">
                            {namedGroupKeys.map((catName, shelfIndex) => {
                              const catRecord = currentCats.find(c => c.name === catName);
                              const catItems = grouped[catName] ?? [];
                              if (!catRecord) return null;
                              return (
                                <Draggable key={catRecord.id} draggableId={`shelf:${catRecord.id}`} index={shelfIndex}>
                                  {(dp) => renderCategoryBlock(catName, catItems, dp)}
                                </Draggable>
                              );
                            })}
                            {shelfProvided.placeholder}
                          </div>
                        )}
                      </Droppable>
                    </>
                  ) : (
                    orderedGroupKeys.map(catName => (
                      <Fragment key={catName}>{renderCategoryBlock(catName, grouped[catName] ?? [])}</Fragment>
                    ))
                  )}
                </div>
              )}
            </DragDropContext>
            {/* ── Summary bar at bottom ── */}
            <div className="flex items-center justify-between px-4 py-2.5 rounded-lg border bg-muted/20 text-xs text-muted-foreground">
              <div className="flex items-center gap-4">
                <span className="font-medium text-foreground">{filteredItems.length} items</span>
                {detailSearch && <span>filtered from {catalogItems.length} total</span>}
                {issues.length > 0 && (
                  <button
                    className="flex items-center gap-1.5 text-warning font-semibold hover:underline"
                    onClick={() => setActiveTab("issues")}
                  >
                    ⚠ {issues.length} items need attention
                  </button>
                )}
              </div>
              <div className="flex items-center gap-3">
                {catalogItems.filter(i => i.default_unit_cost != null).length > 0 && (
                  <span>
                    Total value: <span className="font-semibold text-foreground font-mono">
                      ${catalogItems.reduce((sum, i) => sum + (i.default_unit_cost || 0), 0).toFixed(2)}
                    </span>
                  </span>
                )}
                <span>{catalogItems.filter(i => !i.pack_size || !i.vendor_sku).length} missing fields</span>
              </div>
            </div>
          </TabsContent>

          {/* ── ISSUES TAB ── */}
          <TabsContent value="issues" className="space-y-4">
            {issues.length === 0 ? (
              <div className="border rounded-lg py-16 text-center text-muted-foreground">
                <Check className="mx-auto h-12 w-12 mb-4 text-success opacity-40" />
                <p className="text-sm font-medium">No issues found</p>
                <p className="text-xs text-muted-foreground mt-1">All items have valid names, units, and non-duplicate product numbers.</p>
              </div>
            ) : (
              <div className="overflow-hidden border rounded-lg">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-muted/30">
                      <TableHead className="text-xs font-semibold">Item Name</TableHead>
                      <TableHead className="text-xs font-semibold">Issues</TableHead>
                      <TableHead className="text-xs font-semibold">Product #</TableHead>
                      <TableHead className="text-xs font-semibold">Vendor</TableHead>
                      <TableHead className="text-xs font-semibold">Unit</TableHead>
                      <TableHead className="text-xs font-semibold">Pack Size</TableHead>
                      <TableHead className="text-xs font-semibold">Cost</TableHead>
                      <TableHead className="text-xs font-semibold w-20">Action</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {issues.map(item => (
                      <IssueRow key={item.id} item={item} onFix={(item) => {
                        setEditingItem(item.id);
                        setEditValues({ item_name: item.item_name || "", category: item.category, unit: item.unit, pack_size: item.pack_size, vendor_sku: item.vendor_sku, vendor_name: item.vendor_name, default_unit_cost: item.default_unit_cost });
                        setActiveTab("items");
                      }} onQuickSave={handleQuickSaveIssue} />
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </TabsContent>

        </Tabs>

        <Dialog open={subCategoryDialogOpen} onOpenChange={(o) => { setSubCategoryDialogOpen(o); if (!o) { setSubCategoryParentId(null); setSubCategoryName(""); } }}>
          <DialogContent className="max-w-sm">
            <DialogHeader><DialogTitle>Add sub-category</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <Input
                autoFocus
                value={subCategoryName}
                onChange={e => setSubCategoryName(e.target.value)}
                placeholder="Sub-category name"
                onKeyDown={e => e.key === "Enter" && void handleAddSubCategory()}
              />
              <Button className="w-full bg-gradient-amber" onClick={() => void handleAddSubCategory()} disabled={!subCategoryName.trim()}>
                Add sub-category
              </Button>
            </div>
          </DialogContent>
        </Dialog>

        {/* Rename Dialog */}
        <Dialog open={renameOpen} onOpenChange={setRenameOpen}>
          <DialogContent>
            <DialogHeader><DialogTitle>Rename List</DialogTitle></DialogHeader>
            <div className="space-y-4">
              <div className="space-y-2"><Label>New Name</Label><Input value={renameValue} onChange={e => setRenameValue(e.target.value)} /></div>
              <Button onClick={handleRename} className="w-full bg-gradient-amber">Rename</Button>
            </div>
          </DialogContent>
        </Dialog>

        {/* Delete Confirmation */}
        <AlertDialog open={!!deleteListId} onOpenChange={(o) => !o && setDeleteListId(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete list?</AlertDialogTitle>
              <AlertDialogDescription>This will permanently delete the list and all related data. This cannot be undone.</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={handleDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">Delete</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {/* Import Dialog (shared) */}
        {renderImportDialog()}

        {/* ── Edit Item Sheet ── */}
        <Sheet open={!!editSheetItem} onOpenChange={(o) => { if (!o) setEditSheetItem(null); }}>
          <SheetContent side="right" className="w-full sm:max-w-md flex flex-col">
            <SheetHeader>
              <SheetTitle>Edit Item</SheetTitle>
            </SheetHeader>
            <div className="flex-1 overflow-y-auto py-4 space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="sheet-item-name">Item Name</Label>
                <Input
                  id="sheet-item-name"
                  value={editSheetValues.item_name}
                  onChange={e => setEditSheetValues(v => ({ ...v, item_name: e.target.value }))}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="sheet-sku">SKU / Item Number</Label>
                <Input
                  id="sheet-sku"
                  value={editSheetValues.vendor_sku}
                  onChange={e => setEditSheetValues(v => ({ ...v, vendor_sku: e.target.value }))}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="sheet-cost">Cost / Price</Label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">$</span>
                  <Input
                    id="sheet-cost"
                    type="number"
                    step="0.01"
                    min="0"
                    className="pl-7"
                    value={editSheetValues.default_unit_cost ?? ""}
                    onChange={e => setEditSheetValues(v => ({ ...v, default_unit_cost: e.target.value === "" ? null : +e.target.value }))}
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="sheet-unit">Unit</Label>
                <Input
                  id="sheet-unit"
                  value={editSheetValues.unit}
                  onChange={e => setEditSheetValues(v => ({ ...v, unit: e.target.value }))}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="sheet-pack">Pack Size</Label>
                <Input
                  id="sheet-pack"
                  value={editSheetValues.pack_size}
                  onChange={e => setEditSheetValues(v => ({ ...v, pack_size: e.target.value }))}
                />
              </div>
            </div>
            <SheetFooter className="flex flex-col gap-2 pt-2">
              <Button
                className="w-full bg-orange-500 hover:bg-orange-600 text-white"
                disabled={editSheetSaving}
                onClick={handleSaveEditSheet}
              >
                {editSheetSaving ? "Saving…" : "Save Changes"}
              </Button>
              <Button variant="outline" className="w-full" onClick={() => setEditSheetItem(null)}>
                Cancel
              </Button>
            </SheetFooter>
          </SheetContent>
        </Sheet>

        {/* ── Delete Item Confirm ── */}
        <AlertDialog open={!!deleteItemId} onOpenChange={(o) => { if (!o) setDeleteItemId(null); }}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete {deleteItemName}?</AlertDialogTitle>
              <AlertDialogDescription>This cannot be undone.</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                onClick={() => void handleDeleteItemConfirmed(deleteItemId)}
              >
                Delete
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    );
  }

  // ═══════════════════════════════════════════════
  // ─── IMPORT DIALOG RENDERER ───────────────────
  // ═══════════════════════════════════════════════
  function renderImportDialog() {
    return (
      <Dialog open={importOpen} onOpenChange={(o) => { setImportOpen(o); if (!o) resetImport(); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>Import Items</DialogTitle></DialogHeader>

          {importStep === "upload" && (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">Upload a CSV or Excel file with your inventory items.</p>
              <div className="space-y-2">
                <Label className="text-xs">Import into</Label>
                <Select value={importTargetList} onValueChange={setImportTargetList}>
                  <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="new">Create new list</SelectItem>
                    {lists.map(l => <SelectItem key={l.id} value={l.id}>{l.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              {importTargetList === "new" && (
                <div className="space-y-2">
                  <Label className="text-xs">New List Name</Label>
                  <Input value={importNewListName} onChange={e => setImportNewListName(e.target.value)} placeholder="e.g. Main Kitchen" className="h-9" />
                </div>
              )}
              <input ref={fileRef} type="file" accept=".csv,.xlsx,.xls" onChange={handleFileUpload} className="block w-full text-sm file:mr-3 file:py-2 file:px-4 file:rounded-md file:border-0 file:text-sm file:bg-primary file:text-primary-foreground hover:file:bg-primary/90" />
            </div>
          )}

          {importStep === "map" && (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">Map columns to fields. Only item name is required; unit and pack size are optional.</p>
              {[...REQUIRED_IMPORT_FIELDS, ...OPTIONAL_IMPORT_FIELDS].map(field => {
                const displayLabel = getImportFieldLabel(field);
                return (
                <div key={field} className="flex items-center gap-3">
                  <Label className="w-28 text-xs capitalize">{displayLabel}{field === "item_name" && " *"}</Label>
                  <Select value={importMapping[field] || ""} onValueChange={v => setImportMapping(prev => ({ ...prev, [field]: v }))}>
                    <SelectTrigger className="flex-1 h-8 text-xs"><SelectValue placeholder="Select column" /></SelectTrigger>
                    <SelectContent>
                      {importHeaders.map(h => <SelectItem key={h} value={h}>{h}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  {importMapping[field] && <Check className="h-4 w-4 text-success shrink-0" />}
                </div>
                );
              })}
              <div className="flex gap-2">
                <Button variant="outline" onClick={() => { setImportStep("upload"); }} className="flex-1">Back</Button>
                <Button onClick={handleImportPreview} className="flex-1 bg-gradient-amber">Preview</Button>
              </div>
            </div>
          )}

          {importStep === "preview" && (
            <div className="space-y-4">
              {importSummary && (
                <div className="space-y-2 rounded-lg border p-3 text-sm">
                  <p>
                    <span className="font-semibold text-foreground">{importSummary.itemsReady}</span>{" "}
                    item{importSummary.itemsReady === 1 ? "" : "s"} ready to import
                  </p>
                  <p className="text-muted-foreground">
                    {importSummary.missingUnit} row{importSummary.missingUnit === 1 ? "" : "s"} missing unit
                  </p>
                  <p className="text-muted-foreground">
                    {importSummary.missingPackSize} row{importSummary.missingPackSize === 1 ? "" : "s"} missing pack size
                  </p>
                  {importSummary.duplicates > 0 && (
                    <p className="text-warning text-xs">{importSummary.duplicates} duplicate name{importSummary.duplicates === 1 ? "" : "s"} in file (still imported)</p>
                  )}
                  {importSummary.emptyNameRows > 0 && (
                    <p className="text-muted-foreground text-xs">{importSummary.emptyNameRows} row{importSummary.emptyNameRows === 1 ? "" : "s"} skipped (no item name)</p>
                  )}
                </div>
              )}
              <div className="max-h-60 overflow-auto border rounded-md">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-xs">Sr#</TableHead>
                      <TableHead className="text-xs">Item Name</TableHead>
                      <TableHead className="text-xs">Unit</TableHead>
                      <TableHead className="text-xs">Pack Size</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {importPreview.slice(0, 20).map((row, i) => (
                      <TableRow key={i}>
                        <TableCell className="text-xs font-mono">{row.sr_no}</TableCell>
                        <TableCell className="text-xs">{row.item_name}</TableCell>
                        <TableCell className="text-xs">{row.unit || <span className="text-destructive">—</span>}</TableCell>
                        <TableCell className="text-xs">{row.pack_size || <span className="text-destructive">—</span>}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              {importPreview.length > 20 && <p className="text-xs text-muted-foreground">...and {importPreview.length - 20} more</p>}
              <div className="flex gap-2">
                <Button variant="outline" onClick={() => setImportStep("map")} className="flex-1">Back</Button>
                <Button onClick={handleImportConfirm} className="flex-1 bg-gradient-amber">Confirm Import</Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    );
  }

  // ═══════════════════════════════════════════════
  // ─── MY LISTS GRID VIEW ───────────────────────
  // ═══════════════════════════════════════════════
  return (
    <div className="space-y-8 animate-fade-in">
      <Breadcrumb>
        <BreadcrumbList>
          <BreadcrumbItem><BreadcrumbLink href="/app/dashboard">Home</BreadcrumbLink></BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem><BreadcrumbPage>List Management</BreadcrumbPage></BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">List Management</h1>
          <p className="text-sm text-muted-foreground">
            Build lists, categories, and item master data. Stock counts happen in Inventory Management.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" className="gap-1.5" onClick={() => { setImportTargetList("new"); setImportOpen(true); }}>
            <Upload className="h-4 w-4" /> Import
          </Button>
          <Dialog open={createOpen} onOpenChange={setCreateOpen}>
            <DialogTrigger asChild>
              <Button className="bg-gradient-amber gap-2 shadow-amber" size="sm"><Plus className="h-4 w-4" /> Create List</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>Create Inventory List</DialogTitle></DialogHeader>
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label>List Name</Label>
                  <Input value={newListName} onChange={e => setNewListName(e.target.value)} placeholder="e.g. Main Kitchen" className="h-10" />
                </div>
                <Button onClick={handleCreateList} className="w-full bg-gradient-amber" disabled={!newListName.trim()}>Create</Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {/* Search & Sort */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input value={gridSearch} onChange={e => setGridSearch(e.target.value)} placeholder="Search lists..." className="pl-9 h-10" />
        </div>
        <Select value={gridSort} onValueChange={(v: "date" | "name") => setGridSort(v)}>
          <SelectTrigger className="w-36 h-9"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="date">Sort by Date</SelectItem>
            <SelectItem value="name">Sort by Name</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Lists Grid */}
      <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {/* Create card */}
        <Card className="border-dashed border-2 rounded-xl hover:border-primary/30 hover:bg-muted/30 transition-all cursor-pointer" onClick={() => setCreateOpen(true)}>
          <CardContent className="flex flex-col items-center justify-center py-12 text-muted-foreground">
            <div className="flex h-10 w-10 items-center justify-center rounded-full border-2 border-dashed border-muted-foreground/30 mb-3">
              <Plus className="h-5 w-5 opacity-40" />
            </div>
            <span className="text-sm font-medium">Create new list</span>
          </CardContent>
        </Card>

        {/* Purchase History card */}
        <Card className="rounded-xl hover:shadow-md transition-all cursor-pointer border shadow-sm group" onClick={() => navigate("/app/purchase-history")}>
          <CardContent className="p-5 space-y-3">
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10">
                <ShoppingCart className="h-4 w-4 text-primary" />
              </div>
              <h3 className="font-semibold text-sm">Purchase History</h3>
            </div>
            <p className="text-xs text-muted-foreground">View all saved orders and procurement costs</p>
            <Button variant="outline" size="sm" className="w-full gap-1 text-xs">
              Open <ChevronRight className="h-3 w-3" />
            </Button>
          </CardContent>
        </Card>

        {sortedLists.map(list => (
          <Card key={list.id} className="rounded-xl hover:shadow-md transition-all cursor-pointer border shadow-sm group" onClick={() => openListDetail(list)}>
            <CardContent className="p-5 space-y-3">
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-3">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-gradient-amber text-primary-foreground font-bold text-sm">
                    {list.name.charAt(0).toUpperCase()}
                  </div>
                  <h3 className="font-semibold text-sm">{list.name}</h3>
                </div>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
                    <Button variant="ghost" size="icon" className="h-7 w-7 opacity-0 group-hover:opacity-100 transition-opacity">
                      <MoreVertical className="h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
                    <DropdownMenuItem onClick={() => openListDetail(list)}>
                      <FolderOpen className="h-3.5 w-3.5 mr-2" /> Open
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => { setImportTargetList(list.id); setImportOpen(true); }}>
                      <Upload className="h-3.5 w-3.5 mr-2" /> Import to list
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => { setRenameListId(list.id); setRenameValue(list.name); setRenameOpen(true); }}>
                      <Pencil className="h-3.5 w-3.5 mr-2" /> Rename
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => handleDuplicate(list)}>
                      <Copy className="h-3.5 w-3.5 mr-2" /> Duplicate
                    </DropdownMenuItem>
                    <DropdownMenuSub>
                      <DropdownMenuSubTrigger><Download className="h-3.5 w-3.5 mr-2" /> Export</DropdownMenuSubTrigger>
                      <DropdownMenuSubContent>
                        <DropdownMenuItem onClick={() => handleExportList(list, "csv")}>CSV</DropdownMenuItem>
                        <DropdownMenuItem onClick={() => handleExportList(list, "xlsx")}>Excel (.xlsx)</DropdownMenuItem>
                        <DropdownMenuItem onClick={() => handleExportList(list, "pdf")}>PDF</DropdownMenuItem>
                      </DropdownMenuSubContent>
                    </DropdownMenuSub>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem className="text-destructive" onClick={() => setDeleteListId(list.id)}>
                      <Trash2 className="h-3.5 w-3.5 mr-2" /> Delete
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
              <div className="flex items-center gap-2">
                <Badge variant="secondary" className="text-[10px] font-mono">{itemCounts[list.id] || 0} items</Badge>
                <span className="text-[11px] text-muted-foreground">{new Date(list.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</span>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <Button variant="outline" size="sm" className="text-xs" onClick={(e) => { e.stopPropagation(); openListDetail(list); }}>
                  Open
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="text-xs gap-1"
                  onClick={(e) => {
                    e.stopPropagation();
                    setImportTargetList(list.id);
                    setImportOpen(true);
                  }}
                >
                  <Upload className="h-3.5 w-3.5 shrink-0" /> Import
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {sortedLists.length === 0 && !gridSearch && (
        <div className="border rounded-lg py-16 text-center text-muted-foreground">
          <ClipboardList className="mx-auto h-12 w-12 mb-4 opacity-20" />
          <p className="text-sm font-medium">No lists yet</p>
          <p className="text-xs mt-1 mb-4">Create your first inventory list or import from a file.</p>
          <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setCreateOpen(true)}>
            <Plus className="h-3.5 w-3.5" /> Create List
          </Button>
        </div>
      )}

      {/* Rename Dialog */}
      <Dialog open={renameOpen} onOpenChange={setRenameOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Rename List</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2"><Label>New Name</Label><Input value={renameValue} onChange={e => setRenameValue(e.target.value)} /></div>
            <Button onClick={handleRename} className="w-full bg-gradient-amber">Rename</Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <AlertDialog open={!!deleteListId} onOpenChange={(o) => !o && setDeleteListId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete list?</AlertDialogTitle>
            <AlertDialogDescription>This will permanently delete the list and all related data. This cannot be undone.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Import Dialog */}
      {renderImportDialog()}
    </div>
  );
}