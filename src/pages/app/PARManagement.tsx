import { useEffect, useState, useRef, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useRestaurant } from "@/contexts/RestaurantContext";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { Plus, BookOpen, Trash2, Save, Check, Search, Upload, MoreVertical, FileSpreadsheet, Copy, Download, MapPin, Package, Clock, Pencil } from "lucide-react";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { ExportButtons } from "@/components/ExportButtons";
import { exportToCSV, exportToExcel, exportToPDF } from "@/lib/export-utils";
import { useIsCompact } from "@/hooks/use-mobile";
import { useCategoryMapping } from "@/hooks/useCategoryMapping";
import { PARImportDialog } from "@/components/par/PARImportDialog";
import ItemIdentityBlock from "@/components/ItemIdentityBlock";
import { useLastOrderDates } from "@/hooks/useLastOrderDates";
import { format } from "date-fns";

const normalizeItemName = (value: string | null | undefined) => (value || "").trim().toLowerCase();

export default function PARManagementPage() {
  const { currentRestaurant, locations } = useRestaurant();
  const { user } = useAuth();
  const navigate = useNavigate();
  const isCompact = useIsCompact();
  const [lists, setLists] = useState<any[]>([]);
  const [selectedList, setSelectedList] = useState("");
  const [guides, setGuides] = useState<any[]>([]);
  const [selectedGuide, setSelectedGuide] = useState<any>(null);
  const [items, setItems] = useState<any[]>([]);
  const [catalogItems, setCatalogItems] = useState<any[]>([]);
  const [newGuide, setNewGuide] = useState("");
  const [newGuideListId, setNewGuideListId] = useState("");
  const [newGuideListError, setNewGuideListError] = useState("");
  const [guideOpen, setGuideOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [savingId, setSavingId] = useState<string | null>(null);
  const [savedId, setSavedId] = useState<string | null>(null);
  const [linkingGuideId, setLinkingGuideId] = useState<string | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [importExistingOpen, setImportExistingOpen] = useState(false);
  const [deleteGuide, setDeleteGuide] = useState<any>(null);
  const [renameOpen, setRenameOpen] = useState(false);
  const [renameTarget, setRenameTarget] = useState<any>(null);
  const [renameName, setRenameName] = useState("");
  const [renameSaving, setRenameSaving] = useState(false);
  const [guideCoverage, setGuideCoverage] = useState<Record<string, { total: number; covered: number }>>({});
  /** Display names for par_guides.created_by (when profiles are readable) */
  const [guideCreatorNames, setGuideCreatorNames] = useState<Record<string, string>>({});
  const inputRefs = useRef<Record<string, HTMLInputElement | null>>({});

  useEffect(() => {
    if (!currentRestaurant) return;
    setSelectedList("");
    setSelectedGuide(null);
    setGuides([]);
    setItems([]);
    setCatalogItems([]);
    setSearch("");
    setLoading(true);
    (async () => {
      const { data: listData } = await supabase.from("inventory_lists").select("*").eq("restaurant_id", currentRestaurant.id);
      if (listData) setLists(listData);
      const { data: guideData } = await supabase
        .from("par_guides")
        .select("*")
        .eq("restaurant_id", currentRestaurant.id)
        .order("created_at", { ascending: false });
      if (guideData?.length) {
        setGuides(guideData);
        void hydrateGuideCreators(guideData);
        fetchGuideCoverage(guideData);
      } else {
        setGuides([]);
        setGuideCoverage({});
        setGuideCreatorNames({});
      }
      setLoading(false);
    })();
  }, [currentRestaurant]);

  useEffect(() => {
    if (!guideOpen) {
      setNewGuideListError("");
      return;
    }
    setNewGuideListId(selectedList || "");
    setNewGuideListError("");
  }, [guideOpen, selectedList]);

  const hydrateGuideCreators = useCallback(async (guideList: any[]) => {
    const ids = [...new Set(guideList.map((g) => g.created_by).filter(Boolean))] as string[];
    if (ids.length === 0) {
      setGuideCreatorNames({});
      return;
    }
    const { data, error } = await supabase.from("profiles").select("id, full_name, email").in("id", ids);
    if (error || !data) {
      setGuideCreatorNames({});
      return;
    }
    const map: Record<string, string> = {};
    for (const p of data) {
      map[p.id] = (p.full_name && p.full_name.trim()) || p.email || "Team member";
    }
    setGuideCreatorNames(map);
  }, []);

  useEffect(() => {
    if (!currentRestaurant) return;
    if (!selectedGuide?.inventory_list_id) {
      setCatalogItems([]);
      return;
    }
    supabase
      .from("inventory_catalog_items")
      .select("*")
      .eq("restaurant_id", currentRestaurant.id)
      .eq("inventory_list_id", selectedGuide.inventory_list_id)
      .then(({ data }) => {
        if (data) setCatalogItems(data);
      });
  }, [currentRestaurant, selectedGuide?.id, selectedGuide?.inventory_list_id]);

  const fetchGuideCoverage = async (guideList: any[]) => {
    const coverage: Record<string, { total: number; covered: number }> = {};
    for (const g of guideList) {
      if (!g.inventory_list_id) {
        coverage[g.id] = { total: 0, covered: 0 };
        continue;
      }
      const { count: catalogCount } = await supabase
        .from("inventory_catalog_items")
        .select("id", { count: "exact", head: true })
        .eq("inventory_list_id", g.inventory_list_id);
      const { count: parCount } = await supabase
        .from("par_guide_items")
        .select("id", { count: "exact", head: true })
        .eq("par_guide_id", g.id);
      coverage[g.id] = { total: catalogCount || 0, covered: parCount || 0 };
    }
    setGuideCoverage(coverage);
  };

  const fetchItems = useCallback(async (guideId: string) => {
    const { data } = await supabase.from("par_guide_items").select("*").eq("par_guide_id", guideId);
    if (data) setItems(data);
  }, []);

  const refreshGuides = async () => {
    if (!currentRestaurant) return;
    const { data } = await supabase
      .from("par_guides")
      .select("*")
      .eq("restaurant_id", currentRestaurant.id)
      .order("created_at", { ascending: false });
    if (data) {
      setGuides(data);
      void hydrateGuideCreators(data);
      fetchGuideCoverage(data);
      if (selectedGuide) {
        const refreshedSelectedGuide = data.find(g => g.id === selectedGuide.id);
        if (refreshedSelectedGuide) {
          setSelectedGuide(refreshedSelectedGuide);
        } else {
          setSelectedGuide(null);
          setItems([]);
        }
      }
    }
  };

  const syncCatalogParLevels = useCallback(async (
    guide: any,
    guideItemsToSync: Array<{ item_name: string; par_level: number | null }>
  ) => {
    if (!currentRestaurant || !guide?.inventory_list_id || guideItemsToSync.length === 0) return null;

    let linkedCatalogItems = selectedList === guide.inventory_list_id && catalogItems.length > 0 ? catalogItems : null;
    if (!linkedCatalogItems) {
      const { data, error } = await supabase
        .from("inventory_catalog_items")
        .select("id, item_name")
        .eq("restaurant_id", currentRestaurant.id)
        .eq("inventory_list_id", guide.inventory_list_id);
      if (error) throw error;
      linkedCatalogItems = data || [];
    }

    const catalogIdsByName = new Map<string, string[]>();
    linkedCatalogItems.forEach((catalogItem: any) => {
      const normalizedName = normalizeItemName(catalogItem.item_name);
      if (!normalizedName) return;
      const ids = catalogIdsByName.get(normalizedName) || [];
      ids.push(catalogItem.id);
      catalogIdsByName.set(normalizedName, ids);
    });

    const syncedParLevels = new Map<string, number>();
    const syncUpdates: Promise<any>[] = [];

    guideItemsToSync.forEach((guideItem) => {
      const normalizedName = normalizeItemName(guideItem.item_name);
      if (!normalizedName) return;
      const parLevel = guideItem.par_level ?? 0;
      syncedParLevels.set(normalizedName, parLevel);
      (catalogIdsByName.get(normalizedName) || []).forEach((catalogItemId) => {
        syncUpdates.push(
          supabase
            .from("inventory_catalog_items")
            .update({ default_par_level: parLevel })
            .eq("id", catalogItemId)
        );
      });
    });

    if (syncUpdates.length > 0) {
      const syncResults = await Promise.all(syncUpdates);
      const syncError = syncResults.find(result => result.error)?.error;
      if (syncError) throw syncError;
    }

    if (selectedList === guide.inventory_list_id) {
      setCatalogItems(prev => prev.map((catalogItem) => {
        const nextParLevel = syncedParLevels.get(normalizeItemName(catalogItem.item_name));
        return nextParLevel == null ? catalogItem : { ...catalogItem, default_par_level: nextParLevel };
      }));
    }

    return lists.find(list => list.id === guide.inventory_list_id)?.name || "selected list";
  }, [catalogItems, currentRestaurant, lists, selectedList]);

  const handleCreateGuide = async () => {
    if (!currentRestaurant || !user || !newGuide.trim()) return;
    if (!newGuideListId) {
      setNewGuideListError("Please select an inventory list to link this guide to");
      return;
    }

    const { data: sourceCatalogItems, error: catalogError } = await supabase
      .from("inventory_catalog_items")
      .select("*")
      .eq("restaurant_id", currentRestaurant.id)
      .eq("inventory_list_id", newGuideListId);
    if (catalogError) { toast.error(catalogError.message); return; }

    const { data, error } = await supabase.from("par_guides").insert({
      restaurant_id: currentRestaurant.id,
      inventory_list_id: newGuideListId,
      name: newGuide.trim(),
      created_by: user.id,
    }).select().single();
    if (error) { toast.error(error.message); return; }

    if ((sourceCatalogItems || []).length > 0) {
      const parItems = (sourceCatalogItems || []).map(ci => ({
        par_guide_id: data.id,
        item_name: ci.item_name,
        category: ci.category,
        unit: ci.unit,
        par_level: ci.default_par_level || 0,
      }));
      await supabase.from("par_guide_items").insert(parItems);
    }

    toast.success("PAR guide created");
    setNewGuide("");
    setNewGuideListId("");
    setNewGuideListError("");
    setGuideOpen(false);
    setSelectedList(newGuideListId);
    setCatalogItems(sourceCatalogItems || []);
    await refreshGuides();
    setSelectedGuide(data);
    fetchItems(data.id);
  };

  const handleParLevelChange = (itemId: string, value: string) => {
    if (value === "") {
      setItems(prev => prev.map(i => i.id === itemId ? { ...i, par_level: null } : i));
      return;
    }
    const numVal = parseFloat(value);
    if (!isNaN(numVal) && numVal >= 0) {
      setItems(prev => prev.map(i => i.id === itemId ? { ...i, par_level: numVal } : i));
    }
  };

  const handleSaveParLevel = useCallback(async (itemId: string, level: number) => {
    setSavingId(itemId);
    const normalizedLevel = Number.isFinite(level) && level >= 0 ? level : 0;
    const { error } = await supabase.from("par_guide_items").update({ par_level: normalizedLevel }).eq("id", itemId);
    if (error) {
      setSavingId(null);
      toast.error("Could not save");
    } else {
      const currentItem = items.find(item => item.id === itemId);
      if (currentItem && selectedGuide?.inventory_list_id) {
        try {
          await syncCatalogParLevels(selectedGuide, [{ item_name: currentItem.item_name, par_level: normalizedLevel }]);
        } catch (syncError: any) {
          setSavingId(null);
          toast.error(syncError?.message || "PAR level saved but could not sync linked list");
          return;
        }
      }
      setSavingId(null);
      setItems(prev => prev.map(item => item.id === itemId ? { ...item, par_level: normalizedLevel } : item));
      setSavedId(itemId);
      setTimeout(() => setSavedId(prev => prev === itemId ? null : prev), 1500);
    }
  }, [items, selectedGuide, syncCatalogParLevels]);

  const handleSaveParLevels = async () => {
    const normalizedItems = items.map(item => ({
      ...item,
      par_level: item.par_level ?? 0,
    }));
    const saveResults = await Promise.all(
      normalizedItems.map(item =>
        supabase.from("par_guide_items").update({ par_level: item.par_level }).eq("id", item.id)
      )
    );
    const saveError = saveResults.find(result => result.error)?.error;
    if (saveError) {
      toast.error(saveError.message || "Could not save PAR levels");
      return;
    }
    setItems(normalizedItems);
    if (selectedGuide?.inventory_list_id) {
      try {
        const linkedListName = await syncCatalogParLevels(selectedGuide, normalizedItems);
        toast.success(`PAR levels saved and synced to ${linkedListName}`);
      } catch (syncError: any) {
        toast.error(syncError?.message || "PAR levels saved but could not sync linked list");
      }
      return;
    }
    toast.success("PAR levels saved");
  };

  const handleLinkGuideToList = async (guide: any, listId: string) => {
    const linkedListName = lists.find(list => list.id === listId)?.name || "selected list";
    const { data, error } = await supabase
      .from("par_guides")
      .update({ inventory_list_id: listId })
      .eq("id", guide.id)
      .select()
      .single();

    if (error) {
      toast.error(error.message);
      return;
    }

    setLinkingGuideId(null);
    setSelectedList(listId);
    if (selectedGuide?.id === guide.id) {
      setSelectedGuide(data || { ...guide, inventory_list_id: listId });
    }
    await refreshGuides();
    toast.success(`Guide linked to ${linkedListName}`);
  };

  const handleDeleteItem = async (id: string) => {
    await supabase.from("par_guide_items").delete().eq("id", id);
    if (selectedGuide) fetchItems(selectedGuide.id);
  };

  const handleDeleteGuide = async (guide: any) => {
    if (!currentRestaurant) return;
    await supabase.from("par_guide_items").delete().eq("par_guide_id", guide.id);
    await supabase.from("par_guides").delete().eq("id", guide.id);
    toast.success("PAR guide deleted");
    setDeleteGuide(null);
    if (selectedGuide?.id === guide.id) { setSelectedGuide(null); setItems([]); }
    void refreshGuides();
  };

  const openRenameGuide = (g: any) => {
    setRenameTarget(g);
    setRenameName(g.name || "");
    setRenameOpen(true);
  };

  const handleSaveRename = async () => {
    if (!renameTarget || !renameName.trim()) return;
    const targetId = renameTarget.id;
    setRenameSaving(true);
    const { data, error } = await supabase
      .from("par_guides")
      .update({ name: renameName.trim() })
      .eq("id", targetId)
      .select()
      .single();
    setRenameSaving(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Guide renamed");
    setRenameOpen(false);
    setRenameTarget(null);
    setRenameName("");
    await refreshGuides();
    if (data && selectedGuide?.id === targetId) setSelectedGuide(data);
  };

  const handleExportGuide = async (g: any, exportFormat: "csv" | "excel" | "pdf") => {
    const { data, error } = await supabase.from("par_guide_items").select("*").eq("par_guide_id", g.id);
    if (error) {
      toast.error("Could not load items for export");
      return;
    }
    const rows = (data || []).map(i => ({
      item_name: i.item_name,
      category: i.category,
      unit: i.unit,
      par_level: i.par_level,
    }));
    if (rows.length === 0) {
      toast.error("No items to export");
      return;
    }
    const safeName = (g.name || "par-guide").replace(/[^a-z0-9-_]+/gi, "_").replace(/^_+|_+$/g, "") || "par-guide";
    const filename = `par-${safeName}`;
    const meta = { listName: g.name };
    if (exportFormat === "csv") exportToCSV(rows, filename, "inventory");
    else if (exportFormat === "excel") exportToExcel(rows, filename, "inventory", meta);
    else exportToPDF(rows, filename, "inventory", meta);
  };

  const handleKeyDown = (e: React.KeyboardEvent, currentIndex: number) => {
    if (e.key === "Enter" || e.key === "ArrowDown") {
      e.preventDefault();
      const currentItem = filteredItems[currentIndex];
      if (currentItem) handleSaveParLevel(currentItem.id, Number(currentItem.par_level));
      const nextItem = filteredItems[currentIndex + 1];
      if (nextItem && inputRefs.current[nextItem.id]) {
        inputRefs.current[nextItem.id]?.focus();
        inputRefs.current[nextItem.id]?.select();
      }
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      const currentItem = filteredItems[currentIndex];
      if (currentItem) handleSaveParLevel(currentItem.id, Number(currentItem.par_level));
      const prevItem = filteredItems[currentIndex - 1];
      if (prevItem && inputRefs.current[prevItem.id]) {
        inputRefs.current[prevItem.id]?.focus();
        inputRefs.current[prevItem.id]?.select();
      }
    }
  };

  const isManagerOrOwner = currentRestaurant?.role === "OWNER" || currentRestaurant?.role === "MANAGER";
  const { lastOrderDates } = useLastOrderDates(currentRestaurant?.id);

  // Catalog lookup for product number and last order dates
  const catalogLookup = catalogItems.reduce<Record<string, any>>((acc, ci) => {
    const normalizedName = normalizeItemName(ci.item_name);
    if (!normalizedName || acc[normalizedName]) return acc;
    acc[normalizedName] = ci;
    return acc;
  }, {});

  const getItemProductNumber = (itemName: string): string | null => {
    const ci = catalogLookup[normalizeItemName(itemName)];
    return ci?.product_number || ci?.vendor_sku || null;
  };

  const getItemLastOrdered = (itemName: string): string | null => {
    const ci = catalogLookup[normalizeItemName(itemName)];
    return ci ? lastOrderDates[ci.id] || null : null;
  };

  const { categories: mappedCategories, itemCategoryMap, hasMappings } = useCategoryMapping(selectedList);

  const getItemCategory = (item: any): string => {
    if (hasMappings && itemCategoryMap[item.item_name]) {
      return itemCategoryMap[item.item_name].category_name;
    }
    return item.category || "Uncategorized";
  };

  const getItemSortOrder = (item: any): number => {
    if (hasMappings && itemCategoryMap[item.item_name]) {
      return itemCategoryMap[item.item_name].item_sort_order;
    }
    return 0;
  };

  const filteredItems = items.filter(i => {
    if (search && !i.item_name.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  if (hasMappings) {
    filteredItems.sort((a, b) => {
      const catA = getItemCategory(a);
      const catB = getItemCategory(b);
      const catSortA = mappedCategories.find(c => c.name === catA)?.sort_order ?? 999;
      const catSortB = mappedCategories.find(c => c.name === catB)?.sort_order ?? 999;
      if (catSortA !== catSortB) return catSortA - catSortB;
      return getItemSortOrder(a) - getItemSortOrder(b);
    });
  }

  const groupedItems = filteredItems.reduce<Record<string, any[]>>((acc, item) => {
    const cat = getItemCategory(item);
    if (!acc[cat]) acc[cat] = [];
    acc[cat].push(item);
    return acc;
  }, {});

  const sortedCategoryKeys = hasMappings
    ? Object.keys(groupedItems).sort((a, b) => {
        const sortA = mappedCategories.find(c => c.name === a)?.sort_order ?? 999;
        const sortB = mappedCategories.find(c => c.name === b)?.sort_order ?? 999;
        return sortA - sortB;
      })
    : Object.keys(groupedItems);

  const getListName = (listId: string | null | undefined) => lists.find(l => l.id === listId)?.name || "";
  const getLocationName = (locId: string | null) => {
    if (!locId) return null;
    return locations.find(l => l.id === locId)?.name || null;
  };

  if (loading) {
    return (
      <div className="space-y-6 animate-fade-in">
        <Skeleton className="h-6 w-40" />
        <Skeleton className="h-10 w-64" />
        {[1, 2, 3].map(i => <Skeleton key={i} className="h-24 rounded-xl" />)}
      </div>
    );
  }

  if (!loading && lists.length === 0) {
    return (
      <div className="space-y-5 animate-fade-in">
        <div className="page-header">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-foreground">PAR management</h1>
            <p className="text-sm text-muted-foreground mt-1">Set target stock levels for each inventory list</p>
          </div>
        </div>
        <Card>
          <CardContent className="empty-state py-16">
            <BookOpen className="empty-state-icon" />
            <p className="empty-state-title">No inventory lists yet</p>
            <p className="empty-state-description">Create an inventory list first to start managing PAR levels.</p>
            <Button className="bg-gradient-amber shadow-amber gap-2 mt-4" onClick={() => navigate("/app/inventory/lists")}>
              Go to List Management
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-5 animate-fade-in pb-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">PAR management</h1>
          <p className="text-sm text-muted-foreground mt-1 max-w-xl">Set target stock levels per guide — open a guide from the grid or create a new one.</p>
        </div>
        {isManagerOrOwner && (
          <div className="flex flex-wrap gap-2 justify-end shrink-0">
            <Button
              type="button"
              size="sm"
              className="gap-1.5 bg-slate-700 text-white hover:bg-slate-800 shadow-sm dark:bg-slate-600 dark:hover:bg-slate-500"
              onClick={() => setGuideOpen(true)}
            >
              <Plus className="h-4 w-4 shrink-0" /> Create par guide
            </Button>
            <Button type="button" variant="outline" size="sm" className="gap-1.5 bg-background shadow-sm" onClick={() => setImportOpen(true)}>
              <Upload className="h-3.5 w-3.5 shrink-0" /> Import PAR list
            </Button>
          </div>
        )}
      </div>

      <Dialog open={guideOpen} onOpenChange={setGuideOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Create PAR guide</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Guide name</Label>
              <Input value={newGuide} onChange={e => setNewGuide(e.target.value)} placeholder="e.g. Weekday PAR" className="h-10" />
            </div>
            <div className="space-y-2">
              <Label>Link to inventory list</Label>
              <Select value={newGuideListId} onValueChange={value => { setNewGuideListId(value); setNewGuideListError(""); }}>
                <SelectTrigger className="h-10">
                  <SelectValue placeholder="Select inventory list" />
                </SelectTrigger>
                <SelectContent>
                  {lists.map(list => (
                    <SelectItem key={list.id} value={list.id}>{list.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {newGuideListError && (
                <p className="text-xs text-destructive">{newGuideListError}</p>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              {newGuideListId
                ? `Items from "${getListName(newGuideListId)}" will be pre-populated with default PAR levels.`
                : "Select an inventory list to pre-populate this guide with current item defaults."}
            </p>
            <Button onClick={handleCreateGuide} className="w-full bg-gradient-amber">Create</Button>
          </div>
        </DialogContent>
      </Dialog>

      {!selectedGuide && (
        <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {guides.map(g => {
            const cov = guideCoverage[g.id];
            const locName = getLocationName(g.location_id);
            const updatedBy = g.created_by && guideCreatorNames[g.created_by];
            return (
              <Card
                key={g.id}
                className="cursor-pointer border-border/80 bg-card shadow-sm transition-all duration-200 hover:border-slate-400/50 dark:hover:border-border"
                onClick={() => {
                  setSelectedGuide(g);
                  setSelectedList(g.inventory_list_id ?? "");
                  void fetchItems(g.id);
                }}
              >
                <CardContent className="p-4 space-y-3">
                  <div className="flex items-start justify-between gap-2">
                    <h4 className="font-bold text-sm uppercase tracking-wide text-foreground leading-snug line-clamp-2 pr-1 flex-1 min-w-0">{g.name}</h4>
                    {isManagerOrOwner && (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0 -mr-1 text-muted-foreground hover:text-foreground" onClick={e => e.stopPropagation()}>
                            <MoreVertical className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={e => { e.stopPropagation(); openRenameGuide(g); }}>
                            <Pencil className="h-3.5 w-3.5 mr-2" /> Rename
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={e => { e.stopPropagation(); void handleExportGuide(g, "csv"); }}>
                            <Download className="h-3.5 w-3.5 mr-2" /> Export CSV
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={e => { e.stopPropagation(); void handleExportGuide(g, "excel"); }}>
                            <FileSpreadsheet className="h-3.5 w-3.5 mr-2" /> Export Excel
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={e => { e.stopPropagation(); void handleExportGuide(g, "pdf"); }}>
                            <Download className="h-3.5 w-3.5 mr-2" /> Export PDF
                          </DropdownMenuItem>
                          <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={e => { e.stopPropagation(); setDeleteGuide(g); }}>
                            <Trash2 className="h-3.5 w-3.5 mr-2" /> Delete
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    Last updated {format(new Date(g.updated_at || g.created_at), "MM/dd/yy")}
                    {updatedBy ? ` · ${updatedBy}` : ""}
                  </p>
                  {g.inventory_list_id ? (
                    <p className="text-[11px] text-muted-foreground">List: {getListName(g.inventory_list_id) || "—"}</p>
                  ) : (
                    <p className="text-[11px] text-amber-700/90 dark:text-warning/90">Not linked to a list</p>
                  )}
                  {locName && (
                    <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
                      <MapPin className="h-3 w-3 shrink-0" />
                      {locName}
                    </div>
                  )}
                  <div className="flex items-center justify-between pt-1 border-t border-border/50">
                    {g.inventory_list_id && cov && (
                      <div className="flex items-center gap-2 min-w-0">
                        <div className="h-1.5 w-14 rounded-full bg-muted overflow-hidden shrink-0">
                          <div
                            className="h-full rounded-full bg-slate-600 dark:bg-primary transition-all"
                            style={{ width: `${cov.total > 0 ? Math.round((cov.covered / cov.total) * 100) : 0}%` }}
                          />
                        </div>
                        <span className="text-[10px] text-muted-foreground tabular-nums">{cov.covered}/{cov.total}</span>
                      </div>
                    )}
                  </div>
                  {!g.inventory_list_id && isManagerOrOwner && (
                    <div className="pt-1" onClick={e => e.stopPropagation()}>
                      {linkingGuideId === g.id ? (
                        <Select onValueChange={value => handleLinkGuideToList(g, value)}>
                          <SelectTrigger className="h-8 text-xs">
                            <SelectValue placeholder="Select list to link" />
                          </SelectTrigger>
                          <SelectContent>
                            {lists.map(list => (
                              <SelectItem key={list.id} value={list.id}>{list.name}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      ) : (
                        <Button size="sm" variant="outline" className="h-8 text-xs" onClick={() => setLinkingGuideId(g.id)}>
                          Link to List
                        </Button>
                      )}
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
          {guides.length === 0 && (
            <Card className="col-span-full sm:col-span-2 lg:col-span-3 xl:col-span-4">
              <CardContent className="empty-state py-10">
                <BookOpen className="empty-state-icon" />
                <p className="empty-state-title">No PAR guides yet</p>
                <p className="empty-state-description">Create a PAR guide or import one from a file.</p>
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {selectedGuide && (
        <div className="rounded-2xl border border-border/70 bg-muted/10 shadow-sm p-4 md:p-6 space-y-5">
        <>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between border-b border-border/60 pb-4">
            <div className="min-w-0">
              <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">PAR management</p>
              <h2 className="text-xl font-bold tracking-tight text-foreground mt-1">{selectedGuide.name}</h2>
              {selectedGuide.inventory_list_id ? (
                <p className="mt-1 text-xs text-muted-foreground">List: {getListName(selectedGuide.inventory_list_id) || "—"}</p>
              ) : (
                <p className="mt-1 text-xs text-amber-700/90 dark:text-warning/90">Not linked to any list</p>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              {!selectedGuide.inventory_list_id && isManagerOrOwner && (
                linkingGuideId === selectedGuide.id ? (
                  <Select onValueChange={value => handleLinkGuideToList(selectedGuide, value)}>
                    <SelectTrigger className="h-8 text-xs w-44">
                      <SelectValue placeholder="Select list to link" />
                    </SelectTrigger>
                    <SelectContent>
                      {lists.map(list => (
                        <SelectItem key={list.id} value={list.id}>{list.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <Button size="sm" variant="outline" className="gap-1.5 h-8 text-xs" onClick={() => setLinkingGuideId(selectedGuide.id)}>
                    Link to List
                  </Button>
                )
              )}
              {isManagerOrOwner && (
                <Button size="sm" variant="outline" className="gap-1.5 h-8 text-xs" onClick={() => setImportExistingOpen(true)}>
                  <Upload className="h-3.5 w-3.5" /> Import
                </Button>
              )}
              <ExportButtons
                items={items.map(i => ({ item_name: i.item_name, category: i.category, unit: i.unit, par_level: i.par_level }))}
                filename={`par-${selectedGuide.name}`}
                type="inventory"
                meta={{ listName: selectedGuide.name }}
              />
              {isManagerOrOwner && items.length > 0 && !isCompact && (
                <Button size="sm" variant="outline" className="gap-1.5 h-8 text-xs" onClick={handleSaveParLevels}>
                  <Save className="h-3.5 w-3.5" /> Save Levels
                </Button>
              )}
            </div>
          </div>

          {/* Search */}
          <div className="relative max-w-sm">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search items..." className="pl-8 h-9 text-sm" />
          </div>

          {isCompact ? (
            <div className="space-y-5">
              {sortedCategoryKeys.map((category) => {
                const catItems = groupedItems[category];
                return (
                <div key={category}>
                  <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground/70 mb-2 px-1">{category}</p>
                  <div className="space-y-2">
                    {catItems.map((item, idx) => {
                      const globalIdx = filteredItems.indexOf(item);
                      return (
                        <Card key={item.id} className="border shadow-sm">
                          <CardContent className="p-3 space-y-2">
                            <div className="flex items-start justify-between gap-2">
                              <div className="min-w-0 flex-1">
                                <p className="font-semibold text-sm truncate">{item.item_name}</p>
                                <p className="text-[11px] text-muted-foreground">
                                  {[item.unit, item.pack_size].filter(Boolean).join(" · ") || "—"}
                                </p>
                              </div>
                              <div className="flex items-center gap-1.5 shrink-0">
                                {savingId === item.id && <span className="text-[10px] text-muted-foreground animate-pulse">Saving…</span>}
                                {savedId === item.id && <Check className="h-3.5 w-3.5 text-success" />}
                                {isManagerOrOwner && (
                                  <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => handleDeleteItem(item.id)}>
                                    <Trash2 className="h-3.5 w-3.5 text-destructive" />
                                  </Button>
                                )}
                              </div>
                            </div>
                            {isManagerOrOwner ? (
                              <div>
                                <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">PAR Level</label>
                                <Input
                                  ref={el => { inputRefs.current[item.id] = el; }}
                                  inputMode="decimal"
                                  type="number"
                                  step="0.1"
                                  min="0"
                                  value={item.par_level ?? ""}
                                  onChange={e => handleParLevelChange(item.id, e.target.value)}
                                  onBlur={() => handleSaveParLevel(item.id, Number(item.par_level))}
                                  onKeyDown={e => handleKeyDown(e, globalIdx)}
                                  className="h-12 text-lg font-mono text-center mt-1 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                                />
                              </div>
                            ) : (
                              <div className="flex items-center justify-between">
                                <span className="text-xs text-muted-foreground">PAR Level</span>
                                <span className="font-mono text-lg">{item.par_level}</span>
                              </div>
                            )}
                          </CardContent>
                        </Card>
                      );
                    })}
                  </div>
                </div>
                );
              })}
              {filteredItems.length === 0 && (
                <Card>
                  <CardContent className="text-center text-muted-foreground py-8 text-sm">
                    No items in this PAR guide.
                  </CardContent>
                </Card>
              )}
            </div>
          ) : (
            filteredItems.length === 0 ? (
              <Card className="border-border/80 shadow-sm">
                <CardContent className="text-center text-muted-foreground py-10 text-sm">
                  No items in this PAR guide.
                </CardContent>
              </Card>
            ) : (
              <Card className="overflow-hidden border-border/80 bg-card shadow-sm">
                <div className="divide-y divide-border/60">
                  {sortedCategoryKeys.map((category) => (
                    <div key={category}>
                      <div className="bg-muted/50 px-4 py-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground border-b border-border/40">
                        {category}
                      </div>
                      {groupedItems[category].map((item) => {
                        const globalIdx = filteredItems.indexOf(item);
                        const ciRow = catalogLookup[normalizeItemName(item.item_name)];
                        const packSize = (item as { pack_size?: string }).pack_size || ciRow?.pack_size || "—";
                        const prod = getItemProductNumber(item.item_name) || "—";
                        const lo = getItemLastOrdered(item.item_name);
                        return (
                          <div
                            key={item.id}
                            className="flex flex-col lg:flex-row lg:items-center gap-3 px-4 py-3 hover:bg-muted/20 transition-colors"
                          >
                            <div className="flex items-start gap-3 min-w-0 flex-1">
                              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-muted/80 border border-border/70">
                                <Package className="h-5 w-5 text-muted-foreground" />
                              </div>
                              <div className="min-w-0">
                                <p className="font-semibold text-sm text-foreground leading-snug">{item.item_name}</p>
                                <ItemIdentityBlock brandName={item.brand_name} className="mt-0.5" />
                                <div className="mt-1 flex items-center gap-1.5 text-[11px] text-muted-foreground">
                                  <Clock className="h-3 w-3 shrink-0 opacity-70" />
                                  <span>Last ordered {lo ? format(new Date(lo), "MM/dd/yy") : "—"}</span>
                                </div>
                              </div>
                            </div>
                            <div className="flex flex-wrap items-center gap-4 lg:gap-6 lg:justify-end shrink-0 pl-14 lg:pl-0">
                              <div className="min-w-[3.5rem]">
                                <p className="text-[10px] uppercase tracking-wide text-muted-foreground">SKU</p>
                                <p className="text-xs font-mono font-medium text-foreground">{prod}</p>
                              </div>
                              <div className="min-w-[4rem] max-w-[8rem]">
                                <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Pack size</p>
                                <p className="text-xs text-muted-foreground truncate" title={String(packSize)}>{packSize}</p>
                              </div>
                              <div className="flex items-center gap-2 flex-wrap">
                                {isManagerOrOwner ? (
                                  <Input
                                    ref={el => { inputRefs.current[item.id] = el; }}
                                    inputMode="decimal"
                                    type="number"
                                    step="0.1"
                                    min="0"
                                    value={item.par_level ?? ""}
                                    onChange={e => handleParLevelChange(item.id, e.target.value)}
                                    onBlur={() => handleSaveParLevel(item.id, Number(item.par_level))}
                                    onKeyDown={e => handleKeyDown(e, globalIdx)}
                                    className="h-9 w-16 text-sm font-mono text-center [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                                  />
                                ) : (
                                  <span className="inline-flex h-9 min-w-[4rem] items-center justify-center font-mono text-sm border rounded-md bg-muted/30 px-2">
                                    {item.par_level}
                                  </span>
                                )}
                                {isManagerOrOwner && (
                                  <Button size="sm" variant="ghost" className="h-8 w-8 p-0" onClick={() => handleDeleteItem(item.id)}>
                                    <Trash2 className="h-3.5 w-3.5 text-destructive" />
                                  </Button>
                                )}
                                {savingId === item.id && <span className="text-[10px] text-muted-foreground">Saving…</span>}
                                {savedId === item.id && <Check className="h-4 w-4 text-success shrink-0" />}
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ))}
                </div>
              </Card>
            )
          )}
        </>
        </div>
      )}

      {/* Standalone Import PAR Guide dialog (creates new guide) */}
      <PARImportDialog
        open={importOpen}
        onOpenChange={setImportOpen}
        onImportComplete={() => { void refreshGuides(); }}
      />

      {/* Import into existing guide */}
      {selectedGuide && (
        <PARImportDialog
          open={importExistingOpen}
          onOpenChange={setImportExistingOpen}
          existingGuideId={selectedGuide.id}
          existingGuideName={selectedGuide.name}
          preselectedListId={selectedList}
          onImportComplete={() => fetchItems(selectedGuide.id)}
        />
      )}

      <Dialog open={renameOpen} onOpenChange={open => { setRenameOpen(open); if (!open) { setRenameTarget(null); setRenameName(""); } }}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Rename PAR guide</DialogTitle></DialogHeader>
          <div className="space-y-4 pt-1">
            <div className="space-y-2">
              <Label>Guide name</Label>
              <Input
                value={renameName}
                onChange={e => setRenameName(e.target.value)}
                className="h-10"
                autoFocus
                onKeyDown={e => { if (e.key === "Enter") void handleSaveRename(); }}
              />
            </div>
            <div className="flex gap-2 justify-end">
              <Button type="button" variant="outline" onClick={() => { setRenameOpen(false); setRenameTarget(null); setRenameName(""); }}>Cancel</Button>
              <Button type="button" onClick={() => void handleSaveRename()} disabled={renameSaving || !renameName.trim()}>
                {renameSaving ? "Saving…" : "Save"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteGuide} onOpenChange={open => { if (!open) setDeleteGuide(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete PAR Guide</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete "{deleteGuide?.name}" and all its PAR levels. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={() => handleDeleteGuide(deleteGuide)}>
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
