import { useEffect, useState, useMemo, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useRestaurant } from "@/contexts/RestaurantContext";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { toast } from "sonner";
import { Plus, Trash2, TrendingDown, CalendarDays, Users, Star } from "lucide-react";
import { format, startOfDay, subDays, startOfMonth } from "date-fns";
import { formatCurrency } from "@/lib/inventory-utils";
import { getPackFromCatalogItem, convertInputToCasesSafe } from "@/lib/inventory-conversions";
import { computeLineInventoryValue } from "@/domain/inventory/casePlanningEngine";

// ─── Constants ───────────────────────────────────────────
const REASONS = [
  { value: "spoiled",        label: "Spoiled",        emoji: "🤢", badge: "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400" },
  { value: "dropped",        label: "Dropped",        emoji: "💥", badge: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400" },
  { value: "wrong_order",    label: "Wrong Order",    emoji: "❌", badge: "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400" },
  { value: "overproduction", label: "Overproduction", emoji: "🍳", badge: "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400" },
  { value: "theft",          label: "Theft",          emoji: "🔒", badge: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400" },
  { value: "expired",        label: "Expired",        emoji: "📦", badge: "bg-muted text-muted-foreground" },
  { value: "other",          label: "Other",          emoji: "❓", badge: "bg-muted text-muted-foreground" },
] as const;

type ReasonValue = typeof REASONS[number]["value"];
type DateRange = "today" | "week" | "month" | "all";
type CatalogWasteItem = {
  id: string;
  item_name: string;
  default_unit_cost: number | null;
  /** Catalog unit (CS, LB, EA, etc.) — determines how entered quantity is interpreted for cost. */
  unit: string | null;
  brand_name: string | null;
  vendor_name: string | null;
  // Pack fields — required to convert entered quantity to cases before computing cost
  units_per_case: number | null;
  unit_size: number | null;
  unit_type: string | null;
  total_per_case: number | null;
  pack_size: string | null;
  pack_parse_success: boolean | null;
};

// ─── Helpers ─────────────────────────────────────────────
function reasonInfo(value: string) {
  return REASONS.find(r => r.value === value) ?? REASONS[REASONS.length - 1];
}

function rangeStart(range: DateRange): Date | null {
  const now = new Date();
  if (range === "today") return startOfDay(now);
  if (range === "week")  return subDays(now, 7);
  if (range === "month") return startOfMonth(now);
  return null;
}

function normalizeItemName(value: string) {
  return value.trim().toLowerCase();
}

export default function WasteLogPage() {
  const { currentRestaurant, currentLocation } = useRestaurant();
  const { user } = useAuth();

  const isManagerOrOwner =
    currentRestaurant?.role === "OWNER" || currentRestaurant?.role === "MANAGER";

  // ── Data ──────────────────────────────────────────────
  const [entries, setEntries]       = useState<any[]>([]);
  const [employees, setEmployees]   = useState<{ id: string; name: string }[]>([]);
  const [catalogItems, setCatalogItems] = useState<CatalogWasteItem[]>([]);
  const [loading, setLoading]       = useState(true);

  // ── Filters ───────────────────────────────────────────
  const [dateRange, setDateRange]       = useState<DateRange>("week");
  const [employeeFilter, setEmployeeFilter] = useState("all");
  const [reasonFilter, setReasonFilter]   = useState("all");

  // ── Sheet / form ─────────────────────────────────────
  const [sheetOpen, setSheetOpen]       = useState(false);
  const [itemName, setItemName]         = useState("");
  const [itemSearch, setItemSearch]     = useState("");
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [selectedCatalogItemId, setSelectedCatalogItemId] = useState<string | null>(null);
  const [quantity, setQuantity]         = useState("");
  /** Unit the staff member is entering quantity in. Saved to waste_log.quantity_unit. */
  const [quantityUnit, setQuantityUnit] = useState<"case" | "lb" | "each">("case");
  const [selectedReason, setSelectedReason] = useState<ReasonValue | "">("");
  const [notes, setNotes]               = useState("");
  const [saving, setSaving]             = useState(false);

  // ── Delete ────────────────────────────────────────────
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const comboRef = useRef<HTMLDivElement>(null);

  // ─── Fetch entries ────────────────────────────────────
  const fetchEntries = async () => {
    if (!currentRestaurant) return;
    setLoading(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let query: any = supabase
      .from("waste_log")
      .select("*, profiles(full_name, email)")
      .eq("restaurant_id", currentRestaurant.id)
      .order("logged_at", { ascending: false })
      .limit(200);
    if (currentLocation?.id) query = query.eq("location_id", currentLocation.id);
    const { data } = await query;
    if (data) setEntries(data);
    setLoading(false);
  };

  // ─── Fetch employees for filter ───────────────────────
  const fetchEmployees = async () => {
    if (!currentRestaurant) return;
    const { data } = await supabase
      .from("restaurant_members")
      .select("user_id, profiles(full_name, email)")
      .eq("restaurant_id", currentRestaurant.id);
    if (data) {
      setEmployees(
        data.map((m: any) => ({
          id: m.user_id,
          name: m.profiles?.full_name || m.profiles?.email || m.user_id,
        }))
      );
    }
  };

  // ─── Fetch catalog items for combobox ─────────────────
  const fetchCatalog = async () => {
    if (!currentRestaurant) return;
    const { data } = await supabase
      .from("inventory_catalog_items")
      .select("id, item_name, default_unit_cost, unit, brand_name, vendor_name, units_per_case, unit_size, unit_type, total_per_case, pack_size, pack_parse_success")
      .eq("restaurant_id", currentRestaurant.id)
      .order("item_name");
    if (data) setCatalogItems(data as CatalogWasteItem[]);
  };

  useEffect(() => {
    if (!currentRestaurant) return;
    fetchEntries();
    fetchCatalog();
    if (isManagerOrOwner) fetchEmployees();
  }, [currentRestaurant, currentLocation?.id]);

  // ─── Close suggestions on outside click ──────────────
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (comboRef.current && !comboRef.current.contains(e.target as Node)) {
        setShowSuggestions(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  // ─── Filtered entries ─────────────────────────────────
  const filteredEntries = useMemo(() => {
    const cutoff = rangeStart(dateRange);
    return entries.filter(e => {
      if (cutoff && new Date(e.logged_at) < cutoff) return false;
      if (employeeFilter !== "all" && e.logged_by !== employeeFilter) return false;
      if (reasonFilter !== "all" && e.reason !== reasonFilter) return false;
      return true;
    });
  }, [entries, dateRange, employeeFilter, reasonFilter]);

  // ─── Summary stats ────────────────────────────────────
  const stats = useMemo(() => {
    const todayCutoff = startOfDay(new Date());
    const weekCutoff  = subDays(new Date(), 7);

    const todayEntries = entries.filter(e => new Date(e.logged_at) >= todayCutoff);
    const weekEntries  = entries.filter(e => new Date(e.logged_at) >= weekCutoff);
    const todayCost = todayEntries.reduce((sum, e) => sum + Number(e.total_cost || 0), 0);
    const weekCost  = weekEntries.reduce((sum, e) => sum + Number(e.total_cost || 0), 0);

    // Most wasted item this week (prefer cost, then quantity)
    const itemTotals: Record<string, { quantity: number; total_cost: number }> = {};
    weekEntries.forEach(e => {
      if (!itemTotals[e.item_name]) {
        itemTotals[e.item_name] = { quantity: 0, total_cost: 0 };
      }
      itemTotals[e.item_name].quantity += Number(e.quantity);
      itemTotals[e.item_name].total_cost += Number(e.total_cost || 0);
    });
    const mostWastedEntry = Object.entries(itemTotals).sort((a, b) => {
      if (b[1].total_cost !== a[1].total_cost) return b[1].total_cost - a[1].total_cost;
      return b[1].quantity - a[1].quantity;
    })[0];
    const mostWasted = mostWastedEntry?.[0] ?? "—";
    const mostWastedCost = mostWastedEntry?.[1].total_cost ?? 0;

    // Top reason this week (by count)
    const reasonCounts: Record<string, number> = {};
    weekEntries.forEach(e => {
      reasonCounts[e.reason] = (reasonCounts[e.reason] || 0) + 1;
    });
    const topReasonVal = Object.entries(reasonCounts).sort((a, b) => b[1] - a[1])[0]?.[0];
    const topReason = topReasonVal ? reasonInfo(topReasonVal).label : "—";

    return {
      todayCount: todayEntries.length,
      weekCount: weekEntries.length,
      todayCost,
      weekCost,
      mostWasted,
      mostWastedCost,
      topReason,
    };
  }, [entries]);

  // ─── Combobox suggestions ─────────────────────────────
  const suggestions = useMemo(() => {
    if (!itemSearch) return catalogItems.slice(0, 8);
    return catalogItems
      .filter(item => item.item_name.toLowerCase().includes(itemSearch.toLowerCase()))
      .slice(0, 8);
  }, [itemSearch, catalogItems]);

  const resolvedCatalogItem = useMemo(() => {
    if (selectedCatalogItemId) {
      return catalogItems.find(item => item.id === selectedCatalogItemId) ?? null;
    }

    const normalized = normalizeItemName(itemName);
    if (!normalized) return null;

    const exactMatches = catalogItems.filter(item => normalizeItemName(item.item_name) === normalized);
    return exactMatches.length === 1 ? exactMatches[0] : null;
  }, [catalogItems, itemName, selectedCatalogItemId]);

  const parsedQuantity = Number.parseFloat(quantity);
  const resolvedUnitCost = resolvedCatalogItem?.default_unit_cost != null
    ? Number(resolvedCatalogItem.default_unit_cost)
    : null;

  // Convert the explicitly-selected unit to CASES before computing cost.
  // unit_cost is always per-case; we must NOT multiply raw qty without conversion.
  const resolvedPack = resolvedCatalogItem ? getPackFromCatalogItem(resolvedCatalogItem) : null;

  const qtyConversion = useMemo(() => {
    if (!Number.isFinite(parsedQuantity) || parsedQuantity <= 0) return null;
    if (quantityUnit === "case") {
      // Direct entry in cases — no pack needed
      return { cases: Math.round(parsedQuantity * 100) / 100, ok: true as const };
    }
    // lb or each — requires pack structure from a matched catalog item
    if (!resolvedPack) {
      return { cases: 0, ok: false as const, reason: "Select a catalog item to convert lb/each to cases" };
    }
    const catalogUnitForConversion = quantityUnit === "lb" ? "LB" : "EA";
    return convertInputToCasesSafe(parsedQuantity, catalogUnitForConversion, resolvedPack);
  }, [parsedQuantity, quantityUnit, resolvedPack]);

  const estimatedWasteCost =
    qtyConversion?.ok && resolvedUnitCost != null
      ? computeLineInventoryValue({
          currentStockCases: qtyConversion.cases,
          parLevelCases: 0,
          unitCostPerCase: resolvedUnitCost,
        }).dollars
      : null;

  // ─── Save waste entry ─────────────────────────────────
  const handleSave = async () => {
    if (!currentRestaurant || !user || !itemName || !quantity || !selectedReason) return;
    const quantityValue = Number.parseFloat(quantity);
    if (!Number.isFinite(quantityValue) || quantityValue <= 0) return;

    const normalizedItemName = (resolvedCatalogItem?.item_name || itemName).trim();
    setSaving(true);
    const { error } = await supabase.from("waste_log").insert({
      restaurant_id: currentRestaurant.id,
      location_id:   currentLocation?.id ?? null,
      catalog_item_id: resolvedCatalogItem?.id ?? null,
      item_name:     normalizedItemName,
      quantity:      quantityValue,
      quantity_unit: quantityUnit,
      reason:        selectedReason,
      notes:         notes.trim() || null,
      unit_cost:     resolvedUnitCost,
      total_cost:    estimatedWasteCost,
      logged_by:     user.id,
      logged_at:     new Date().toISOString(),
    });
    setSaving(false);
    if (error) {
      toast.error(`Failed to log: ${error.message}`);
    } else {
      toast.success(
        `Waste logged — ${normalizedItemName} × ${quantityValue}${estimatedWasteCost != null ? ` (${formatCurrency(estimatedWasteCost)})` : ""}`,
      );
      // Reset form but keep sheet open
      setItemName("");
      setItemSearch("");
      setSelectedCatalogItemId(null);
      setQuantity("");
      setQuantityUnit("case");
      setSelectedReason("");
      setNotes("");
      fetchEntries();
    }
  };

  // ─── Delete waste entry ───────────────────────────────
  const handleDelete = async () => {
    if (!deleteId) return;
    const { error } = await supabase.from("waste_log").delete().eq("id", deleteId).eq("restaurant_id", currentRestaurant.id);
    if (error) toast.error(error.message);
    else {
      toast.success("Entry deleted");
      setEntries(prev => prev.filter(e => e.id !== deleteId));
    }
    setDeleteId(null);
  };

  // ─── Employee display helper ──────────────────────────
  const employeeName = (entry: any) =>
    entry.profiles?.full_name || entry.profiles?.email || "Unknown";

  const blockWasteWithoutLocation = !!currentRestaurant && !currentLocation;

  const canSave = !!itemName.trim() && !!quantity && parsedQuantity > 0 && !!selectedReason;

  // ─── Loading skeleton ─────────────────────────────────
  if (loading && entries.length === 0) {
    return (
      <div className="space-y-6 animate-fade-in">
        <div className="flex items-center justify-between">
          <Skeleton className="h-8 w-40" />
          <Skeleton className="h-10 w-32" />
        </div>
        <div className="grid gap-4 sm:grid-cols-4">
          {[1,2,3,4].map(i => <Skeleton key={i} className="h-24 rounded-xl" />)}
        </div>
        <Skeleton className="h-10 w-full" />
        {[1,2,3].map(i => <Skeleton key={i} className="h-14 rounded-xl" />)}
      </div>
    );
  }

  return (
    <div className="space-y-5 animate-fade-in">
      {blockWasteWithoutLocation ? (
        <p className="text-sm text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900/50 rounded-lg px-3 py-2">
          Select a specific location to log waste.
        </p>
      ) : null}
      {/* ═══ HEADER ═══ */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Waste Log</h1>
          <p className="text-sm text-muted-foreground">Track spoilage, drops and waste across all shifts</p>
        </div>
        <Button
          className="bg-gradient-amber shadow-amber gap-2"
          disabled={blockWasteWithoutLocation}
          onClick={() => setSheetOpen(true)}
        >
          <Plus className="h-4 w-4" /> Log Waste
        </Button>
      </div>

      {/* ═══ SUMMARY CARDS ═══ */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardContent className="flex items-center gap-3 p-4">
            <CalendarDays className="h-5 w-5 text-primary shrink-0" />
            <div>
              <p className="text-2xl font-bold tabular-nums">{formatCurrency(stats.todayCost)}</p>
              <p className="text-[11px] text-muted-foreground">{stats.todayCount} entr{stats.todayCount === 1 ? "y" : "ies"} today</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-3 p-4">
            <TrendingDown className="h-5 w-5 text-warning shrink-0" />
            <div>
              <p className="text-2xl font-bold tabular-nums">{formatCurrency(stats.weekCost)}</p>
              <p className="text-[11px] text-muted-foreground">{stats.weekCount} entr{stats.weekCount === 1 ? "y" : "ies"} this week</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-3 p-4">
            <Star className="h-5 w-5 text-destructive shrink-0" />
            <div>
              <p className="text-sm font-semibold truncate max-w-[120px]">{stats.mostWasted}</p>
              <p className="text-[11px] text-muted-foreground">
                {stats.mostWastedCost > 0 ? `Highest cost · ${formatCurrency(stats.mostWastedCost)}` : "Most wasted this week"}
              </p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-3 p-4">
            <Users className="h-5 w-5 text-muted-foreground shrink-0" />
            <div>
              <p className="text-sm font-semibold truncate max-w-[120px]">{stats.topReason}</p>
              <p className="text-[11px] text-muted-foreground">Top Reason</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* ═══ FILTER BAR ═══ */}
      <div className="flex items-center gap-3 flex-wrap">
        {/* Date tabs */}
        <div className="flex items-center gap-1 bg-muted/40 border rounded-lg p-1">
          {(["today","week","month","all"] as DateRange[]).map(r => (
            <button
              key={r}
              onClick={() => setDateRange(r)}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                dateRange === r
                  ? "bg-background shadow-sm text-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {r === "today" ? "Today" : r === "week" ? "This Week" : r === "month" ? "This Month" : "All"}
            </button>
          ))}
        </div>

        {/* Employee filter — managers/owners only */}
        {isManagerOrOwner && (
          <Select value={employeeFilter} onValueChange={setEmployeeFilter}>
            <SelectTrigger className="h-9 w-[180px] text-xs">
              <SelectValue placeholder="All Employees" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Employees</SelectItem>
              {employees.map(e => (
                <SelectItem key={e.id} value={e.id}>{e.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        {/* Reason filter */}
        <Select value={reasonFilter} onValueChange={setReasonFilter}>
          <SelectTrigger className="h-9 w-[160px] text-xs">
            <SelectValue placeholder="All Reasons" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Reasons</SelectItem>
            {REASONS.map(r => (
              <SelectItem key={r.value} value={r.value}>{r.emoji} {r.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* ═══ ENTRIES TABLE ═══ */}
      {filteredEntries.length === 0 ? (
        <Card>
          <CardContent className="py-16 text-center">
            <Trash2 className="mx-auto h-10 w-10 mb-3 opacity-20" />
            <p className="text-sm font-medium text-muted-foreground">No waste entries for this period</p>
            <p className="text-xs text-muted-foreground/60 mt-1">Adjust the filters or log a new entry.</p>
          </CardContent>
        </Card>
      ) : (
        <Card className="overflow-hidden border shadow-sm">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/30">
                <TableHead className="text-xs font-semibold">Date / Time</TableHead>
                <TableHead className="text-xs font-semibold">Employee</TableHead>
                <TableHead className="text-xs font-semibold">Item</TableHead>
                <TableHead className="text-xs font-semibold">Qty</TableHead>
                <TableHead className="text-xs font-semibold">Cost</TableHead>
                <TableHead className="text-xs font-semibold">Reason</TableHead>
                <TableHead className="text-xs font-semibold">Notes</TableHead>
                {isManagerOrOwner && <TableHead className="text-xs font-semibold w-12" />}
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredEntries.map(entry => {
                const info = reasonInfo(entry.reason);
                return (
                  <TableRow key={entry.id} className="hover:bg-muted/20 transition-colors">
                    <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                      {format(new Date(entry.logged_at), "EEE MMM d, h:mm a")}
                    </TableCell>
                    <TableCell className="text-xs">{employeeName(entry)}</TableCell>
                    <TableCell className="font-medium text-sm">{entry.item_name}</TableCell>
                    <TableCell className="font-mono text-sm">{entry.quantity}</TableCell>
                    <TableCell className="font-mono text-sm">
                      {entry.total_cost != null ? formatCurrency(Number(entry.total_cost)) : "—"}
                    </TableCell>
                    <TableCell>
                      <Badge className={`${info.badge} border-0 text-[10px] font-medium`}>
                        {info.emoji} {info.label}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground max-w-[180px]">
                      {entry.notes ? (
                        <TooltipProvider>
                          <Tooltip>
                            <TooltipTrigger className="truncate block max-w-[180px] text-left">
                              {entry.notes}
                            </TooltipTrigger>
                            <TooltipContent className="max-w-xs">
                              <p className="text-xs">{entry.notes}</p>
                            </TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                      ) : "—"}
                    </TableCell>
                    {isManagerOrOwner && (
                      <TableCell>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-muted-foreground hover:text-destructive"
                          onClick={() => setDeleteId(entry.id)}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </TableCell>
                    )}
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </Card>
      )}

      {/* ═══ LOG WASTE SHEET ═══ */}
      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetContent side="right" className="w-full sm:max-w-md flex flex-col gap-0 p-0">
          <SheetHeader className="px-6 py-4 border-b">
            <SheetTitle>Log Waste Entry</SheetTitle>
          </SheetHeader>

          <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
            {/* 1. Item Name — Combobox */}
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Item Name *</label>
              <div className="relative" ref={comboRef}>
                <Input
                  value={itemSearch || itemName}
                  onChange={e => {
                    setItemSearch(e.target.value);
                    setItemName(e.target.value);
                    setSelectedCatalogItemId(null);
                    setShowSuggestions(true);
                  }}
                  onFocus={() => setShowSuggestions(true)}
                  placeholder="Search or type an item…"
                  className="h-10"
                />
                {showSuggestions && suggestions.length > 0 && (
                  <div className="absolute z-50 top-full mt-1 w-full bg-background border rounded-lg shadow-lg overflow-hidden">
                    {suggestions.map(s => (
                      <button
                        key={s.id}
                        className="w-full text-left px-3 py-2 text-sm hover:bg-muted/50 transition-colors"
                        onMouseDown={e => {
                          e.preventDefault();
                          setItemName(s.item_name);
                          setItemSearch("");
                          setSelectedCatalogItemId(s.id);
                          setShowSuggestions(false);
                        }}
                      >
                        <div className="flex items-center justify-between gap-3">
                          <span>{s.item_name}</span>
                          <span className="text-xs font-mono text-muted-foreground">
                            {s.default_unit_cost != null ? formatCurrency(Number(s.default_unit_cost)) : "No cost"}
                          </span>
                        </div>
                        {(s.brand_name || s.vendor_name || s.unit) && (
                          <div className="text-[10px] text-muted-foreground mt-0.5">
                            {[s.brand_name, s.vendor_name, s.unit].filter(Boolean).join(" · ")}
                          </div>
                        )}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* 2. Quantity + Unit */}
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                How much was wasted? *
              </label>
              <div className="flex gap-2">
                <Input
                  type="number"
                  min={0.1}
                  step={0.1}
                  value={quantity}
                  onChange={e => setQuantity(e.target.value)}
                  placeholder="e.g. 2 or 0.5"
                  className="h-10 font-mono flex-1"
                />
                <Select value={quantityUnit} onValueChange={v => setQuantityUnit(v as "case" | "lb" | "each")}>
                  <SelectTrigger className="h-10 w-28">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="case">Cases</SelectItem>
                    <SelectItem value="lb">Lbs</SelectItem>
                    <SelectItem value="each">Each</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <p className="text-[11px] text-muted-foreground">
                Select the unit you counted in. Cost is always calculated per case.
              </p>
            </div>

            {/* 3. Cost snapshot */}
            <div className="rounded-lg bg-muted/40 px-4 py-3 space-y-1">
              <p className="text-[11px] text-muted-foreground font-semibold uppercase tracking-wider">Estimated Cost</p>
              <p className="text-sm font-medium">
                {estimatedWasteCost != null ? formatCurrency(estimatedWasteCost) : "Unavailable"}
              </p>
              {qtyConversion && !qtyConversion.ok && parsedQuantity > 0 && (
                <p className="text-[11px] text-amber-700 dark:text-amber-400">
                  ⚠ {qtyConversion.reason ?? "Cannot convert to cases — cost not calculated."}
                </p>
              )}
              <p className="text-[11px] text-muted-foreground">
                {resolvedCatalogItem
                  ? resolvedUnitCost != null
                    ? `${formatCurrency(resolvedUnitCost)} per case from the matched catalog item`
                    : "Matched catalog item has no default cost per case yet."
                  : "Select a catalog item or type an exact unique catalog item name to capture cost."}
              </p>
            </div>

            {/* 4. Reason — toggle grid */}
            <div className="space-y-2">
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Reason *</label>
              <div className="grid grid-cols-4 gap-2">
                {REASONS.map(r => (
                  <button
                    key={r.value}
                    type="button"
                    onClick={() => setSelectedReason(r.value)}
                    className={`flex flex-col items-center gap-1 rounded-lg border-2 py-2.5 px-1 text-[11px] font-medium transition-all ${
                      selectedReason === r.value
                        ? "border-primary bg-primary/10 text-primary"
                        : "border-border bg-muted/30 text-muted-foreground hover:border-border/60 hover:bg-muted/50"
                    }`}
                  >
                    <span className="text-base">{r.emoji}</span>
                    <span className="leading-tight text-center">{r.label}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* 5. Notes */}
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                Notes <span className="normal-case font-normal">(optional)</span>
              </label>
              <Textarea
                value={notes}
                onChange={e => setNotes(e.target.value.slice(0, 200))}
                placeholder="Any details… (optional)"
                className="resize-none h-20 text-sm"
              />
              <p className="text-[10px] text-muted-foreground text-right">{notes.length}/200</p>
            </div>

            {/* 6. Logged by — read only */}
            <div className="rounded-lg bg-muted/40 px-4 py-3 space-y-1">
              <p className="text-[11px] text-muted-foreground font-semibold uppercase tracking-wider">Logging as</p>
              <p className="text-sm font-medium">{user?.email ?? "—"}</p>
            </div>

            {/* 7. Date/time — read only */}
            <div className="rounded-lg bg-muted/40 px-4 py-3 space-y-1">
              <p className="text-[11px] text-muted-foreground font-semibold uppercase tracking-wider">Date / Time</p>
              <p className="text-sm font-medium">Today, {format(new Date(), "h:mm a")}</p>
            </div>
          </div>

          {/* Footer */}
          <div className="border-t px-6 py-4 flex gap-3">
            <Button variant="outline" className="flex-1" onClick={() => setSheetOpen(false)}>
              Cancel
            </Button>
            <Button
              className="flex-1 bg-gradient-amber shadow-amber"
              disabled={!canSave || saving || blockWasteWithoutLocation}
              onClick={handleSave}
            >
              {saving ? "Saving…" : "Log Waste Entry"}
            </Button>
          </div>
        </SheetContent>
      </Sheet>

      {/* ═══ DELETE CONFIRM ═══ */}
      <AlertDialog open={!!deleteId} onOpenChange={o => !o && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete waste entry?</AlertDialogTitle>
            <AlertDialogDescription>This action cannot be undone.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
