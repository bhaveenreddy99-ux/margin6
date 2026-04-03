import { useEffect, useState, useRef, useCallback, useMemo } from "react";
import { format } from "date-fns";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
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
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetFooter } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList,
  BreadcrumbPage, BreadcrumbSeparator } from "@/components/ui/breadcrumb";
import { toast } from "sonner";
import {
  Plus, Minus, Send, Package, BookOpen, Play, ArrowLeft, Eye, CheckCircle, ClipboardList,
  XCircle, ShoppingCart, Copy, ClipboardCheck, Trash2, ChevronRight, Eraser,
  Search, SkipForward, EyeOff, Check, ListOrdered, AlertTriangle, MoreHorizontal, MoreVertical,
  LayoutGrid, List as ListIcon, TrendingDown, CalendarClock, MapPin, Filter, Pencil, DollarSign, BarChart3 } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import { useIsCompact, useIsMobile } from "@/hooks/use-mobile";
import { useCategoryMapping } from "@/hooks/useCategoryMapping";

import {
  getRisk, getRowState, getRowBgClass, formatNum, parseInputValue,
  inputDisplayValue, computeOrderQty, computeRiskLevel, formatCurrency,
} from "@/lib/inventory-utils";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import ItemIdentityBlock from "@/components/ItemIdentityBlock";
import { useLastOrderDates } from "@/hooks/useLastOrderDates";

const defaultCategories = ["Frozen", "Cooler", "Dry"];

function normalizeItemName(itemName: string | null | undefined): string {
  return itemName?.trim().toLowerCase() ?? "";
}

/** Map PAR guide rows to session/catalog keys: prefer catalog_item_id via name bridge; only real guide rows included. */
function buildCountingParLookup(
  guideItems: Array<{ item_name: string | null; par_level: number | string | null | undefined }>,
  catalogRows: Array<{ id: string; item_name: string | null }>,
): { byCatalogId: Record<string, number>; byNormalizedName: Record<string, number> } {
  const byNormalizedName: Record<string, number> = {};
  const byCatalogId: Record<string, number> = {};
  const catalogIdByNorm: Record<string, string> = {};
  catalogRows.forEach((c) => {
    const k = normalizeItemName(c.item_name);
    if (k && catalogIdByNorm[k] === undefined) catalogIdByNorm[k] = c.id;
  });
  guideItems.forEach((gi) => {
    const k = normalizeItemName(gi.item_name);
    if (!k) return;
    const parsed = Number(gi.par_level ?? 0);
    const val = Number.isFinite(parsed) ? parsed : 0;
    byNormalizedName[k] = val;
    const cid = catalogIdByNorm[k];
    if (cid) byCatalogId[cid] = val;
  });
  return { byCatalogId, byNormalizedName };
}

function buildParLevelMap(
  guideItems: Array<{ item_name: string | null; par_level: number | string | null | undefined }>,
): Record<string, number> {
  const map: Record<string, number> = {};
  guideItems.forEach((item) => {
    const key = normalizeItemName(item.item_name);
    if (!key) return;
    const parsed = Number(item.par_level ?? 0);
    map[key] = Number.isFinite(parsed) ? parsed : 0;
  });
  return map;
}

function getRiskBadgeLabel(risk: ReturnType<typeof getRisk>): string {
  return risk.level === "NO_PAR" ? "NO PAR" : risk.level;
}

// ── Schedule helpers ──────────────────────────────────
function computeNextOccurrence(schedule: any): Date | null {
  const dayMap: Record<string, number> = { SUN: 0, MON: 1, TUE: 2, WED: 3, THU: 4, FRI: 5, SAT: 6 };
  const tzOffsets: Record<string, number> = {
    "America/New_York": -5, "America/Chicago": -6,
    "America/Denver": -7, "America/Los_Angeles": -8,
  };
  const days: string[] = schedule.days_of_week || [];
  const [h, m] = (schedule.time_of_day || "09:00").split(":").map(Number);
  const offset = tzOffsets[schedule.timezone] ?? -5;
  const now = new Date();

  const monthlyDay = days.find(d => d.startsWith("MONTHLY_"));
  if (monthlyDay) {
    const day = parseInt(monthlyDay.split("_")[1]);
    const candidate = new Date(now.getFullYear(), now.getMonth(), day, h, m, 0, 0);
    if (candidate <= now) candidate.setMonth(candidate.getMonth() + 1);
    return candidate;
  }

  for (let i = 0; i <= 7; i++) {
    const candidate = new Date(now);
    candidate.setDate(now.getDate() + i);
    const candidateDay = Object.keys(dayMap).find(k => dayMap[k] === candidate.getDay());
    if (candidateDay && days.includes(candidateDay)) {
      candidate.setHours(h, m, 0, 0);
      if (candidate > now) return candidate;
    }
  }
  return null;
}

function getScheduleStatus(nextDate: Date): "upcoming" | "ready" | "overdue" {
  const diffMs = nextDate.getTime() - Date.now();
  if (diffMs < 0) return "overdue";
  if (diffMs < 60 * 60 * 1000) return "ready";
  return "upcoming";
}

function formatCountdown(nextDate: Date): string {
  const diffMs = nextDate.getTime() - Date.now();
  if (diffMs <= 0) return "Now";
  const h = Math.floor(diffMs / 3600000);
  const m = Math.floor((diffMs % 3600000) / 60000);
  if (h >= 24) return `${Math.floor(h / 24)}d ${h % 24}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function formatSessionRowDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  try {
    return format(new Date(iso), "EEE, MM/dd/yy");
  } catch {
    return "—";
  }
}

/** True when PostgREST reports missing `catalog_item_id` on inventory_session_items (DB not migrated). */
function isInventorySessionItemsCatalogIdSchemaError(message: string | undefined): boolean {
  if (!message) return false;
  return /inventory_session_items.*catalog_item_id|catalog_item_id.*inventory_session_items|schema cache/i.test(message);
}

/** Seed session lines from inventory_catalog_items (+ PAR guide levels). Returns inserted row count. */
async function insertInventorySessionLinesFromCatalog(
  sessionId: string,
  inventoryListId: string,
  restaurantId: string,
): Promise<{ ok: boolean; count: number; errorMessage?: string }> {
  const { data: catItems, error: catFetchError } = await supabase
    .from("inventory_catalog_items")
    .select("*")
    .eq("restaurant_id", restaurantId)
    .eq("inventory_list_id", inventoryListId);

  if (catFetchError) {
    console.log("[EnterInventory] catalog fetch (seed) error:", catFetchError.message);
    return { ok: false, count: 0, errorMessage: catFetchError.message };
  }

  const validCatalog = (catItems || []).filter((ci) => (ci.item_name || "").trim().length > 0);
  if (validCatalog.length === 0) {
    return { ok: true, count: 0 };
  }

  let resolvedParItems: any[] = [];
  const { data: latestGuide, error: guideSeedErr } = await supabase
    .from("par_guides")
    .select("id")
    .eq("inventory_list_id", inventoryListId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (guideSeedErr) {
    console.log("[EnterInventory] par_guide (seed) error:", guideSeedErr.message);
  }
  if (latestGuide) {
    const { data: latestItems } = await supabase
      .from("par_guide_items")
      .select("*")
      .eq("par_guide_id", latestGuide.id);
    if (latestItems) resolvedParItems = latestItems;
  }

  const parMap = buildParLevelMap(resolvedParItems);
  const parFromGuideOrCatalog = (itemName: string, defaultPar: number | null | undefined) => {
    const key = normalizeItemName(itemName);
    if (key && key in parMap) return parMap[key];
    if (defaultPar != null) {
      const n = Number(defaultPar);
      return Number.isFinite(n) ? n : 0;
    }
    return 0;
  };

  const mapRowWithCatalog = (ci: (typeof validCatalog)[0]) => ({
    session_id: sessionId,
    catalog_item_id: ci.id,
    item_name: ci.item_name.trim(),
    category: ci.category || "Dry",
    unit: ci.unit || "",
    pack_size: ci.pack_size ?? null,
    brand_name: ci.brand_name ?? null,
    vendor_name: ci.vendor_name ?? null,
    vendor_sku: ci.vendor_sku ?? null,
    current_stock: 0,
    par_level: parFromGuideOrCatalog(ci.item_name, ci.default_par_level),
    unit_cost: ci.default_unit_cost ?? null,
  });

  const mapRowLegacy = (ci: (typeof validCatalog)[0]) => {
    const { catalog_item_id: _c, ...rest } = mapRowWithCatalog(ci);
    return rest;
  };

  const preItemsWithCatalog = validCatalog.map(mapRowWithCatalog);
  let { data: insertedSessionItems, error: sessionItemsInsertError } = await supabase
    .from("inventory_session_items")
    .insert(preItemsWithCatalog)
    .select("id");

  if (sessionItemsInsertError && isInventorySessionItemsCatalogIdSchemaError(sessionItemsInsertError.message)) {
    console.log("[EnterInventory] Retrying session seed without catalog_item_id (DB column missing).");
    const preItemsLegacy = validCatalog.map(mapRowLegacy);
    ({ data: insertedSessionItems, error: sessionItemsInsertError } = await supabase
      .from("inventory_session_items")
      .insert(preItemsLegacy)
      .select("id"));
  }

  if (sessionItemsInsertError) {
    console.log("[EnterInventory] inventory_session_items insert (seed) error:", sessionItemsInsertError.message);
    return { ok: false, count: 0, errorMessage: sessionItemsInsertError.message };
  }

  return { ok: true, count: insertedSessionItems?.length ?? 0 };
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

  const [lists, setLists] = useState<any[]>([]);
  const [selectedList, setSelectedList] = useState("");
  const [landingFocusListId, setLandingFocusListId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [sessionsLoaded, setSessionsLoaded] = useState(false);
  const [startingListId, setStartingListId] = useState<string | null>(null);
  const [listSelectorMeta, setListSelectorMeta] = useState<Record<string, { itemCount: number; lastCountedAt: string | null; hasParGuide: boolean }>>({});

  const [inProgressSessions, setInProgressSessions] = useState<any[]>([]);
  const [reviewSessions, setReviewSessions] = useState<any[]>([]);
  const [approvedSessions, setApprovedSessions] = useState<any[]>([]);
  const [sessionStats, setSessionStats] = useState<Record<string, { qty: number; totalValue: number; counted: number; total: number }>>({});
  const [approvedFilter, setApprovedFilter] = useState("30");

  const [activeSession, setActiveSession] = useState<any>(null);
  const [items, setItems] = useState<any[]>([]);
  const [search, setSearch] = useState("");
  const [filterCategory, setFilterCategory] = useState("all");
  const [createOpen, setCreateOpen] = useState(false);
  const [newItem, setNewItem] = useState({ item_name: "", category: "Cooler", unit: "", current_stock: 0, unit_cost: 0 });
  const [catalogItems, setCatalogItems] = useState<any[]>([]);
  const [catalogOpen, setCatalogOpen] = useState(false);

  const [selectedPar, setSelectedPar] = useState("");
  const [parGuides, setParGuides] = useState<any[]>([]);
  const [parItems, setParItems] = useState<any[]>([]);

  const [viewItems, setViewItems] = useState<any[] | null>(null);
  const [viewSession, setViewSession] = useState<any>(null);

  const [clearEntriesSessionId, setClearEntriesSessionId] = useState<string | null>(null);
  const [clearInProgressSessionId, setClearInProgressSessionId] = useState<string | null>(null);
  const [deleteSessionId, setDeleteSessionId] = useState<string | null>(null);

  const [smartOrderSession, setSmartOrderSession] = useState<any>(null);
  /** New count: require user-confirmed session name before inserting `inventory_sessions`. */
  const [newCountNameDialogOpen, setNewCountNameDialogOpen] = useState(false);
  const [pendingNewCountListId, setPendingNewCountListId] = useState<string | null>(null);
  const [newCountNameInput, setNewCountNameInput] = useState("");
  const [smartOrderParGuides, setSmartOrderParGuides] = useState<any[]>([]);
  const [smartOrderSelectedPar, setSmartOrderSelectedPar] = useState("");
  const [smartOrderCreating, setSmartOrderCreating] = useState(false);

  // Counting mode state
  const [showOnlyEmpty, setShowOnlyEmpty] = useState(false);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [savedId, setSavedId] = useState<string | null>(null);
  const [submitConfirmOpen, setSubmitConfirmOpen] = useState(false);
  const [categoryMode, setCategoryMode] = useState<string>("list_order");
  const [viewToggle] = useState<"table" | "compact">("table");
  const [statusFilter, setStatusFilter] = useState<"all" | "uncounted" | "low" | "critical">("all");
  const [lastEditedId, setLastEditedId] = useState<string | null>(null);
  const inputRefs = useRef<Record<string, HTMLInputElement | null>>({});

  // Inventory schedules
  const [schedules, setSchedules] = useState<any[]>([]);
  const [, setCounterTick] = useState(0);

  // Active PAR guide data for read-only display during count entry
  const [approvedParMap, setApprovedParMap] = useState<Record<string, number>>({});

  /** Optional read-only PAR column while counting */
  const [parColumnVisible, setParColumnVisible] = useState(false);
  const [parGuidePickerOpen, setParGuidePickerOpen] = useState(false);
  const [parGuidesPickerOptions, setParGuidesPickerOptions] = useState<Array<{ id: string; name: string; inventory_list_id: string | null }>>([]);
  const [countingParGuideId, setCountingParGuideId] = useState<string | null>(null);
  const [countingParGuideName, setCountingParGuideName] = useState<string | null>(null);
  const [countingParByCatalogId, setCountingParByCatalogId] = useState<Record<string, number>>({});
  const [countingParByNormalizedName, setCountingParByNormalizedName] = useState<Record<string, number>>({});

  // Row ⋮ menu sheets (item details, staff requests, manager PAR/price); see renderRowActionsMenu
  const [editItemDetailsSessionItem, setEditItemDetailsSessionItem] = useState<any>(null);
  const [editItemDetailsForm, setEditItemDetailsForm] = useState({ item_name: "", unit: "", pack_size: "" });
  const [editItemDetailsSaving, setEditItemDetailsSaving] = useState(false);

  const [staffParRequestItem, setStaffParRequestItem] = useState<any>(null);
  const [staffParSuggested, setStaffParSuggested] = useState("");
  const [staffParReason, setStaffParReason] = useState("");
  const [staffParSending, setStaffParSending] = useState(false);

  const [staffPriceRequestItem, setStaffPriceRequestItem] = useState<any>(null);
  const [staffPriceSuggested, setStaffPriceSuggested] = useState("");
  const [staffPriceReason, setStaffPriceReason] = useState("");
  const [staffPriceSending, setStaffPriceSending] = useState(false);

  const [managerParEditItem, setManagerParEditItem] = useState<any>(null);
  const [managerParInput, setManagerParInput] = useState("");
  const [managerParSaving, setManagerParSaving] = useState(false);

  const [managerPriceEditItem, setManagerPriceEditItem] = useState<any>(null);
  const [managerPriceInput, setManagerPriceInput] = useState("");
  const [managerPriceSaving, setManagerPriceSaving] = useState(false);

  const requestedListId = useMemo(() => {
    const state = (location.state as { list_id?: string; listId?: string } | null) || null;
    return searchParams.get("list_id")
      || searchParams.get("listId")
      || state?.list_id
      || state?.listId
      || "";
  }, [location.state, searchParams]);

  const fetchSchedules = useCallback(async () => {
    if (!currentRestaurant) return;
    const { data } = await supabase
      .from("reminders")
      .select("*, inventory_lists(name), locations(name)")
      .eq("restaurant_id", currentRestaurant.id)
      .eq("is_enabled", true)
      .not("inventory_list_id", "is", null);
    if (data) setSchedules(data);
  }, [currentRestaurant]);

  useEffect(() => {
    if (!currentRestaurant) return;
    setLoading(true);
    setSessionsLoaded(false);
    setSelectedList("");
    setLandingFocusListId(null);
    setListSelectorMeta({});

    const loadLists = async () => {
      const [{ data: listData }, { data: catalogData }, { data: guideData }, { data: approvedData }] = await Promise.all([
        supabase.from("inventory_lists").select("*").eq("restaurant_id", currentRestaurant.id),
        supabase.from("inventory_catalog_items").select("id, inventory_list_id").eq("restaurant_id", currentRestaurant.id),
        supabase.from("par_guides").select("id, inventory_list_id").eq("restaurant_id", currentRestaurant.id),
        supabase.from("inventory_sessions").select("inventory_list_id, approved_at")
          .eq("restaurant_id", currentRestaurant.id)
          .eq("status", "APPROVED")
          .not("approved_at", "is", null)
          .order("approved_at", { ascending: false }),
      ]);

      const nextLists = listData || [];
      setLists(nextLists);

      const nextMeta: Record<string, { itemCount: number; lastCountedAt: string | null; hasParGuide: boolean }> = {};
      nextLists.forEach((list) => {
        nextMeta[list.id] = { itemCount: 0, lastCountedAt: null, hasParGuide: false };
      });

      (catalogData || []).forEach((item: any) => {
        if (!item.inventory_list_id) return;
        if (!nextMeta[item.inventory_list_id]) {
          nextMeta[item.inventory_list_id] = { itemCount: 0, lastCountedAt: null, hasParGuide: false };
        }
        nextMeta[item.inventory_list_id].itemCount += 1;
      });

      (guideData || []).forEach((guide: any) => {
        if (!guide.inventory_list_id) return;
        if (!nextMeta[guide.inventory_list_id]) {
          nextMeta[guide.inventory_list_id] = { itemCount: 0, lastCountedAt: null, hasParGuide: false };
        }
        nextMeta[guide.inventory_list_id].hasParGuide = true;
      });

      (approvedData || []).forEach((session: any) => {
        if (!session.inventory_list_id || !session.approved_at) return;
        if (!nextMeta[session.inventory_list_id]) {
          nextMeta[session.inventory_list_id] = { itemCount: 0, lastCountedAt: null, hasParGuide: false };
        }
        const existingDate = nextMeta[session.inventory_list_id].lastCountedAt;
        if (!existingDate || new Date(session.approved_at) > new Date(existingDate)) {
          nextMeta[session.inventory_list_id].lastCountedAt = session.approved_at;
        }
      });

      setListSelectorMeta(nextMeta);
    };

    loadLists();
    fetchSchedules();
  }, [currentRestaurant, fetchSchedules]);

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

  useEffect(() => {
    if (!currentRestaurant) return;
    fetchSessions();
  }, [currentRestaurant, approvedFilter]);

  const fetchSessions = async () => {
    if (!currentRestaurant) return;
    setLoading(true);
    setSessionsLoaded(false);

    const daysAgo = new Date();
    daysAgo.setDate(daysAgo.getDate() - parseInt(approvedFilter));

    const sessionSelect = "*, inventory_lists(name), locations(name)";

    const [{ data: ip }, { data: rv }, { data: ap }] = await Promise.all([
      supabase.from("inventory_sessions").select(sessionSelect).eq("restaurant_id", currentRestaurant.id).eq("status", "IN_PROGRESS").order("updated_at", { ascending: false }),
      supabase.from("inventory_sessions").select(sessionSelect).eq("restaurant_id", currentRestaurant.id).eq("status", "IN_REVIEW").order("updated_at", { ascending: false }),
      supabase.from("inventory_sessions").select(sessionSelect).eq("restaurant_id", currentRestaurant.id).eq("status", "APPROVED").gte("approved_at", daysAgo.toISOString()).order("approved_at", { ascending: false }),
    ]);

    setInProgressSessions(ip || []);
    setReviewSessions(rv || []);
    setApprovedSessions(ap || []);

    // Fetch item counts + total values + progress for all sessions
    const allSessions = [...(ip || []), ...(rv || []), ...(ap || [])];
    if (allSessions.length > 0) {
      const sessionIds = allSessions.map((s) => s.id);
      const { data: statsRaw } = await supabase
        .from("inventory_session_items")
        .select("session_id, current_stock, unit_cost")
        .in("session_id", sessionIds);

      const statsMap: Record<string, { qty: number; totalValue: number; counted: number; total: number }> = {};
      (statsRaw || []).forEach((row) => {
        if (!statsMap[row.session_id]) statsMap[row.session_id] = { qty: 0, totalValue: 0, counted: 0, total: 0 };
        statsMap[row.session_id].qty += Number(row.current_stock ?? 0);
        statsMap[row.session_id].total += 1;
        if (row.current_stock !== null && Number(row.current_stock) > 0) {
          statsMap[row.session_id].counted += 1;
        }
        if (row.current_stock != null && row.unit_cost != null) {
          statsMap[row.session_id].totalValue += Number(row.current_stock) * Number(row.unit_cost);
        }
      });
      setSessionStats(statsMap);
    }

    setLoading(false);
    setSessionsLoaded(true);
  };

  useEffect(() => {
    if (!currentRestaurant || !selectedList) {
      setParGuides([]);
      setSelectedPar("");
      return;
    }

    supabase
      .from("par_guides")
      .select("*")
      .eq("restaurant_id", currentRestaurant.id)
      .eq("inventory_list_id", selectedList)
      .order("updated_at", { ascending: false })
      .then(({ data }) => {
        const guides = data || [];
        setParGuides(guides);
        setSelectedPar(guides[0]?.id || "");
      });
  }, [currentRestaurant, selectedList]);

  useEffect(() => {
    if (!selectedPar || selectedPar === "none") { setParItems([]); return; }
    supabase.from("par_guide_items").select("*").eq("par_guide_id", selectedPar).then(({ data }) => { if (data) setParItems(data); });
  }, [selectedPar]);

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

  const persistSessionCountingParGuide = async (sessionId: string, guideId: string | null) => {
    try {
      if (guideId) sessionStorage.setItem(`inv_counting_par_guide_${sessionId}`, guideId);
      else sessionStorage.removeItem(`inv_counting_par_guide_${sessionId}`);
    } catch (_) { /* ignore */ }
    const { error } = await supabase
      .from("inventory_sessions")
      .update({
        counting_par_guide_id: guideId,
        updated_at: new Date().toISOString(),
      } as any)
      .eq("id", sessionId);
    if (error && /counting_par_guide|schema cache|column/i.test(error.message)) {
      console.log("[EnterInventory] counting_par_guide_id update skipped:", error.message);
    }
  };

  const hydrateCountingParMaps = async (guideId: string | null, catRows: Array<{ id: string; item_name: string | null }>) => {
    setCountingParGuideId(guideId);
    if (!guideId) {
      setCountingParGuideName(null);
      setCountingParByCatalogId({});
      setCountingParByNormalizedName({});
      return;
    }
    const { data: gMeta } = await supabase.from("par_guides").select("name").eq("id", guideId).maybeSingle();
    setCountingParGuideName(gMeta?.name ?? null);
    const { data: gItems } = await supabase
      .from("par_guide_items")
      .select("item_name, par_level")
      .eq("par_guide_id", guideId);
    const lookup = buildCountingParLookup(gItems || [], catRows);
    setCountingParByCatalogId(lookup.byCatalogId);
    setCountingParByNormalizedName(lookup.byNormalizedName);
  };

  const openParGuidePicker = async () => {
    if (!currentRestaurant || !activeSession) return;
    const { data } = await supabase
      .from("par_guides")
      .select("id, name, inventory_list_id")
      .eq("restaurant_id", currentRestaurant.id);
    const sessionListId = activeSession.inventory_list_id;
    const sorted = [...(data || [])].sort((a, b) => {
      const am = a.inventory_list_id === sessionListId ? 0 : 1;
      const bm = b.inventory_list_id === sessionListId ? 0 : 1;
      if (am !== bm) return am - bm;
      return (a.name || "").localeCompare(b.name || "");
    });
    setParGuidesPickerOptions(sorted);
    setParGuidePickerOpen(true);
  };

  const applyParGuideSelection = async (guideId: string) => {
    if (!activeSession?.id || !currentRestaurant) return;
    await persistSessionCountingParGuide(activeSession.id, guideId);
    setActiveSession((s: any) => (s ? { ...s, counting_par_guide_id: guideId } : s));
    const slim = (catalogItems || []).map((c: any) => ({ id: c.id, item_name: c.item_name }));
    await hydrateCountingParMaps(guideId, slim);
    setParColumnVisible(true);
    setParGuidePickerOpen(false);
    toast.success("PAR guide applied for this count");
  };

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
    if (!currentRestaurant || !user || !listId || !name.trim()) return;

    const listIdTrimmed = listId.trim();
    setStartingListId(listIdTrimmed);

    try {
      const { data, error } = await supabase.from("inventory_sessions").insert({
        restaurant_id: currentRestaurant.id,
        inventory_list_id: listIdTrimmed,
        name: name.trim(),
        created_by: user.id
      }).select().single();
      if (error) { toast.error(error.message); return; }

      const catalogSeed = await insertInventorySessionLinesFromCatalog(
        data.id,
        listIdTrimmed,
        currentRestaurant.id,
      );
      if (!catalogSeed.ok) {
        toast.error(catalogSeed.errorMessage || "Could not copy list items into this count.");
      }

      if (catalogSeed.count === 0) {
        let resolvedParItems = selectedList === listIdTrimmed ? parItems : [];
        if (resolvedParItems.length === 0 && listIdTrimmed) {
          const { data: latestGuide, error: guideSeedErr } = await supabase
            .from("par_guides")
            .select("id")
            .eq("inventory_list_id", listIdTrimmed)
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle();
          if (guideSeedErr) {
            console.log("[EnterInventory] par_guide (PAR-only seed) error:", guideSeedErr.message);
          }
          if (latestGuide) {
            const { data: latestItems } = await supabase
              .from("par_guide_items")
              .select("*")
              .eq("par_guide_id", latestGuide.id);
            if (latestItems) resolvedParItems = latestItems;
          }
        }

        if (resolvedParItems.length > 0) {
          const validPar = resolvedParItems.filter((p) => (p.item_name || "").trim().length > 0);
          const preItems = validPar.map((p) => ({
            session_id: data.id,
            item_name: p.item_name.trim(),
            category: p.category || "Dry",
            unit: p.unit || "",
            current_stock: 0,
            par_level: Number(p.par_level ?? 0),
          }));
          const { error: sessionItemsInsertError } = await supabase
            .from("inventory_session_items")
            .insert(preItems);
          if (sessionItemsInsertError) {
            toast.error(sessionItemsInsertError.message);
            console.log("[EnterInventory] PAR-only session items insert:", sessionItemsInsertError.message);
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

  const openEditor = async (session: any) => {
    if (session.status && session.status !== "IN_PROGRESS") {
      sessionStorage.removeItem('inv_active_session');
      toast.info("Only in-progress counts can be edited here. Use Review for submitted sessions.");
      return;
    }
    if (!session?.id) {
      toast.error("Invalid session — could not open count.");
      return;
    }

    sessionStorage.setItem('inv_active_session', session.id);

    const { data: sessMeta } = await supabase
      .from("inventory_sessions")
      .select("inventory_list_id, counting_par_guide_id")
      .eq("id", session.id)
      .maybeSingle();

    let listId = (session.inventory_list_id || sessMeta?.inventory_list_id || "").trim();
    let resolvedCountingParId: string | null =
      sessMeta?.counting_par_guide_id ?? (session as any).counting_par_guide_id ?? null;
    if (!resolvedCountingParId) {
      try {
        const raw = sessionStorage.getItem(`inv_counting_par_guide_${session.id}`);
        if (raw) resolvedCountingParId = raw;
      } catch (_) { /* ignore */ }
    }

    setSelectedList(listId);
    setActiveSession({ ...session, inventory_list_id: listId, counting_par_guide_id: resolvedCountingParId });

    const listPromise = listId
      ? supabase.from("inventory_lists").select("active_category_mode").eq("id", listId).maybeSingle()
      : Promise.resolve({ data: null });

    const catalogPromise =
      currentRestaurant && listId
        ? supabase
          .from("inventory_catalog_items")
          .select("*")
          .eq("restaurant_id", currentRestaurant.id)
          .eq("inventory_list_id", listId)
        : Promise.resolve({ data: null });

    const [{ data: loadedItems, error: itemsError }, listResult, catalogResult] = await Promise.all([
      supabase.from("inventory_session_items").select("*").eq("session_id", session.id),
      listPromise,
      catalogPromise,
    ]);

    if (itemsError) {
      toast.error(itemsError.message);
    }

    let sessionItems = loadedItems ?? [];
    const shouldTrySeed =
      currentRestaurant?.id &&
      !!listId &&
      (!session.status || session.status === "IN_PROGRESS") &&
      sessionItems.length === 0;

    if (shouldTrySeed) {
      const seedResult = await insertInventorySessionLinesFromCatalog(
        session.id,
        listId,
        currentRestaurant.id,
      );
      if (!seedResult.ok && seedResult.errorMessage) {
        toast.error(seedResult.errorMessage);
      } else if (seedResult.count > 0) {
        const { data: reloaded, error: reloadErr } = await supabase
          .from("inventory_session_items")
          .select("*")
          .eq("session_id", session.id)
          .order("item_name", { ascending: true });
        if (reloadErr) {
          toast.error(reloadErr.message);
        } else {
          sessionItems = reloaded ?? [];
        }
      }
    }

    setItems(sessionItems);
    const catRowsRaw = catalogResult.data ?? [];
    if (catalogResult.data) setCatalogItems(catalogResult.data);
    if (listResult.data?.active_category_mode) {
      const dbMode = listResult.data.active_category_mode;
      if (dbMode === "ai" || dbMode === "custom-categories") setCategoryMode("custom-categories");
      else if (dbMode === "user" || dbMode === "my-categories") setCategoryMode("my-categories");
      else setCategoryMode("list_order");
    }

    setParColumnVisible(false);
    const slimCat = catRowsRaw.map((c: any) => ({ id: c.id, item_name: c.item_name }));
    let guideIdForHydration: string | null = resolvedCountingParId;
    if (!guideIdForHydration && listId && currentRestaurant?.id) {
      const { data: latestGuide, error: parGuideDisplayFallbackErr } = await supabase
        .from("par_guides")
        .select("id")
        .eq("restaurant_id", currentRestaurant.id)
        .eq("inventory_list_id", listId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (parGuideDisplayFallbackErr) {
        console.log("[EnterInventory] par_guide (display fallback) error:", parGuideDisplayFallbackErr.message);
      }
      if (latestGuide?.id) guideIdForHydration = latestGuide.id;
    }
    await hydrateCountingParMaps(guideIdForHydration, slimCat);
  };

  const handleLeaveEditorToHub = () => {
    const listId = activeSession?.inventory_list_id || "";
    sessionStorage.removeItem("inv_active_session");
    setActiveSession(null);
    setItems([]);
    setSelectedPar("");
    setSearch("");
    setFilterCategory("all");
    setStatusFilter("all");
    setParColumnVisible(false);
    setParGuidePickerOpen(false);
    setParGuidesPickerOptions([]);
    setCountingParGuideId(null);
    setCountingParGuideName(null);
    setCountingParByCatalogId({});
    setCountingParByNormalizedName({});
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
      const [{ data: gItems }, { data: cat }] = await Promise.all([
        supabase.from("par_guide_items").select("item_name, par_level").eq("par_guide_id", countingParGuideId),
        supabase
          .from("inventory_catalog_items")
          .select("id, item_name")
          .eq("restaurant_id", currentRestaurant.id)
          .eq("inventory_list_id", activeSession.inventory_list_id),
      ]);
      if (cancelled) return;
      const lookup = buildCountingParLookup(gItems || [], cat || []);
      setCountingParByCatalogId(lookup.byCatalogId);
      setCountingParByNormalizedName(lookup.byNormalizedName);
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
    if (!activeSession) return;
    if (activeSession.status === "IN_REVIEW" || activeSession.status === "APPROVED") return;
    const parLevel = approvedParMap[normalizeItemName(newItem.item_name)] ?? 0;
    const payload = {
      session_id: activeSession.id,
      item_name: newItem.item_name,
      category: newItem.category,
      unit: newItem.unit,
      current_stock: newItem.current_stock,
      par_level: parLevel,
      unit_cost: newItem.unit_cost || null,
    };
    const { data, error } = await supabase.from("inventory_session_items").insert(payload).select().single();
    if (error) { toast.error(error.message); return; }
    setItems([...items, data]);
    setNewItem({ item_name: "", category: "Cooler", unit: "", current_stock: 0, unit_cost: 0 });
    setCreateOpen(false);
  };

  const handleAddFromCatalog = async (catalogItem: any) => {
    if (!activeSession) return;
    if (activeSession.status === "IN_REVIEW" || activeSession.status === "APPROVED") return;
    const payload = {
      session_id: activeSession.id,
      catalog_item_id: catalogItem.id,
      item_name: catalogItem.item_name,
      category: catalogItem.category || "Dry",
      unit: catalogItem.unit || "",
      current_stock: 0,
      par_level: approvedParMap[normalizeItemName(catalogItem.item_name)] ?? catalogItem.default_par_level ?? 0,
      unit_cost: catalogItem.default_unit_cost || 0,
      vendor_sku: catalogItem.product_number || catalogItem.vendor_sku || null,
      pack_size: catalogItem.pack_size || null,
      vendor_name: catalogItem.vendor_name || null,
      brand_name: catalogItem.brand_name || null
    };
    let { data, error } = await supabase.from("inventory_session_items").insert(payload).select().single();
    if (error && isInventorySessionItemsCatalogIdSchemaError(error.message)) {
      const { catalog_item_id: _omit, ...legacy } = payload;
      ({ data, error } = await supabase.from("inventory_session_items").insert(legacy).select().single());
    }
    if (error) { toast.error(error.message); return; }
    setItems([...items, data]);
    toast.success(`Added ${catalogItem.item_name}`);
  };

  const handleUpdateStock = async (id: string, rawValue: string) => {
    const parsed = parseInputValue(rawValue);
    setItems(items.map((i) => i.id === id ? { ...i, current_stock: parsed } : i));
    setLastEditedId(id);
  };

  const handleClearRow = async (id: string) => {
    if (activeSession?.status === "IN_REVIEW" || activeSession?.status === "APPROVED") return;
    setItems(items.map((i) => i.id === id ? { ...i, current_stock: null } : i));
    setSavingId(id);
    const { error } = await supabase.from("inventory_session_items").update({ current_stock: null } as any).eq("id", id);
    setSavingId(null);
    if (error) toast.error("Could not clear");
    else {
      setSavedId(id);
      setTimeout(() => setSavedId(prev => prev === id ? null : prev), 1500);
    }
  };

  const handleUpdatePrice = (id: string, rawValue: string) => {
    const parsed = parseInputValue(rawValue);
    setItems(items.map((i) => i.id === id ? { ...i, unit_cost: parsed } : i));
  };

  const handleSavePrice = useCallback(async (id: string, cost: number | null) => {
    if (activeSession?.status === "IN_REVIEW" || activeSession?.status === "APPROVED") return;
    setSavingId(id);
    const { error } = await supabase.from("inventory_session_items").update({ unit_cost: cost }).eq("id", id);
    setSavingId(null);
    if (error) toast.error("Could not save price");
    else {
      setSavedId(id);
      setTimeout(() => setSavedId(prev => prev === id ? null : prev), 1500);
    }
  }, [activeSession?.status]);

  const handleSaveStock = useCallback(async (id: string, stockVal: number | null) => {
    if (activeSession?.status === "IN_REVIEW" || activeSession?.status === "APPROVED") return;
    setSavingId(id);
    const { error } = await supabase.from("inventory_session_items").update({ current_stock: stockVal ?? null } as any).eq("id", id);
    setSavingId(null);
    if (error) {
      toast.error("Could not save — tap to retry");
    } else {
      setSavedId(id);
      setTimeout(() => setSavedId(prev => prev === id ? null : prev), 1500);
    }
  }, [activeSession?.status]);

  const handleSubmitForReview = async () => {
    if (!activeSession) return;
    if (activeSession.status !== "IN_PROGRESS") return;
    const { error } = await supabase.from("inventory_sessions").update({ status: "IN_REVIEW", updated_at: new Date().toISOString() }).eq("id", activeSession.id);
    if (error) toast.error(error.message);
    else { toast.success("Submitted for review!"); sessionStorage.removeItem('inv_active_session'); setActiveSession(null); setItems([]); fetchSessions(); }
  };

  const handleDeleteSession = async () => {
    if (!deleteSessionId) return;
    await supabase.from("inventory_session_items").delete().eq("session_id", deleteSessionId);
    const { error } = await supabase.from("inventory_sessions").delete().eq("id", deleteSessionId);
    if (error) toast.error(error.message);
    else {
      toast.success("Session deleted");
      setDeleteSessionId(null);
      sessionStorage.removeItem("inv_active_session");
      if (activeSession?.id === deleteSessionId) {
        setActiveSession(null);
        setItems([]);
      }
      fetchSessions();
    }
  };

  const handleClearInProgressSession = async () => {
    if (!clearInProgressSessionId) return;
    await supabase.from("inventory_session_items").delete().eq("session_id", clearInProgressSessionId);
    const { error } = await supabase.from("inventory_sessions").delete().eq("id", clearInProgressSessionId);
    if (error) toast.error(error.message);
    else {
      toast.success("Cleared — start a fresh count when you're ready");
      setClearInProgressSessionId(null);
      sessionStorage.removeItem("inv_active_session");
      if (activeSession?.id === clearInProgressSessionId) {
        setActiveSession(null);
        setItems([]);
      }
      fetchSessions();
    }
  };

  const handleClearEntries = async () => {
    if (!clearEntriesSessionId) return;
    const { error } = await supabase.from("inventory_session_items")
      .update({ current_stock: null } as any)
      .eq("session_id", clearEntriesSessionId);
    if (error) toast.error(error.message);
    else {
      toast.success("Entries cleared — ready for recount");
      setClearEntriesSessionId(null);
      if (activeSession?.id === clearEntriesSessionId) {
        setItems(items.map(i => ({ ...i, current_stock: null })));
      }
    }
  };

  const autoCreateSmartOrder = async (sessionId: string) => {
    if (!currentRestaurant || !user) return;
    try {
      const { data: session } = await supabase.from("inventory_sessions").select("*").eq("id", sessionId).single();
      if (!session) return;

      const { data: sessionItems } = await supabase.from("inventory_session_items").select("*").eq("session_id", sessionId);
      if (!sessionItems || sessionItems.length === 0) return;

      const { data: latestGuide } = await supabase.from("par_guides").select("id")
        .eq("restaurant_id", currentRestaurant.id)
        .eq("inventory_list_id", session.inventory_list_id)
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      const parMap = latestGuide
        ? buildParLevelMap(
            (await supabase
              .from("par_guide_items")
              .select("item_name, par_level")
              .eq("par_guide_id", latestGuide.id)).data || [],
          )
        : {};

      const computed = sessionItems.map(i => {
        const key = normalizeItemName(i.item_name);
        const sessionPar = Number(i.par_level ?? 0);
        const parLevel = latestGuide
          ? (key in parMap ? parMap[key] : sessionPar)
          : sessionPar;
        const currentStock = Number(i.current_stock ?? 0);
        const risk = computeRiskLevel(currentStock, parLevel);
        const suggestedOrder = computeOrderQty(currentStock, parLevel, i.unit, i.pack_size);
        return { ...i, parLevel, currentStock, risk, suggestedOrder };
      });

      const redCount = computed.filter(i => i.risk === "RED").length;
      const yellowCount = computed.filter(i => i.risk === "YELLOW").length;

      const { data: run, error: runError } = await supabase.from("smart_order_runs").insert({
        restaurant_id: currentRestaurant.id,
        session_id: sessionId,
        inventory_list_id: session.inventory_list_id,
        par_guide_id: latestGuide?.id || null,
        created_by: user.id,
      }).select().single();
      if (runError || !run) return;

      const runItems = computed.map(i => ({
        run_id: run.id,
        catalog_item_id: i.catalog_item_id || null,
        item_name: i.item_name,
        suggested_order: i.suggestedOrder,
        risk: i.risk,
        current_stock: i.currentStock,
        par_level: i.parLevel,
        unit_cost: i.unit_cost || null,
        pack_size: i.pack_size || null,
      }));
      let itemsErr = (await supabase.from("smart_order_run_items").insert(runItems)).error;
      if (itemsErr) {
        console.error("[autoCreateSmartOrder] smart_order_run_items insert:", itemsErr.message);
        const withoutCatalog = runItems.map(({ catalog_item_id: _c, ...rest }) => rest);
        itemsErr = (await supabase.from("smart_order_run_items").insert(withoutCatalog)).error;
        if (itemsErr) {
          console.error("[autoCreateSmartOrder] retry insert:", itemsErr.message);
          toast.error(`Smart order lines could not be saved: ${itemsErr.message}`);
        }
      }

      if (redCount > 0 || yellowCount > 0) {
        const { data: prefs } = await supabase.from("notification_preferences")
          .select("*, alert_recipients(user_id)")
          .eq("restaurant_id", currentRestaurant.id)
          .eq("channel_in_app", true)
          .limit(1)
          .single();

        if (prefs) {
          const { data: members } = await supabase.from("restaurant_members")
            .select("user_id, role")
            .eq("restaurant_id", currentRestaurant.id);

          let targetUserIds: string[] = [];
          if (prefs.recipients_mode === "OWNERS_MANAGERS") {
            targetUserIds = (members || []).filter(m => m.role === "OWNER" || m.role === "MANAGER").map(m => m.user_id);
          } else if (prefs.recipients_mode === "ALL") {
            targetUserIds = (members || []).map(m => m.user_id);
          } else if (prefs.recipients_mode === "CUSTOM") {
            targetUserIds = (prefs.alert_recipients || []).map((r: any) => r.user_id);
          }

          if (targetUserIds.length > 0) {
            const notifications = targetUserIds.map(uid => ({
              restaurant_id: currentRestaurant.id,
              user_id: uid,
              type: "LOW_STOCK",
              severity: redCount > 0 ? "CRITICAL" : "WARNING" as "CRITICAL" | "WARNING",
              title: `Inventory Approved — ${redCount + yellowCount} item${redCount + yellowCount > 1 ? "s" : ""} need attention`,
              message: `${redCount} high risk, ${yellowCount} medium risk items detected`,
              data: { session_id: sessionId, run_id: run.id, red: redCount, yellow: yellowCount } as any,
            }));
            await supabase.from("notifications").insert(notifications);
          }
        }
      }
    } catch (err) {
      console.error("Auto smart order error:", err);
    }
  };

  const handleApprove = async (sessionId: string) => {
    if (!currentRestaurant || !user) return;
    const { error } = await supabase.from("inventory_sessions").update({
      status: "APPROVED", approved_at: new Date().toISOString(), approved_by: user.id, updated_at: new Date().toISOString()
    }).eq("id", sessionId);
    if (error) { toast.error(error.message); return; }
    await autoCreateSmartOrder(sessionId);
    toast.success("Session approved!");
    fetchSessions();
  };

  const handleReject = async (sessionId: string) => {
    const { error } = await supabase.from("inventory_sessions").update({ status: "IN_PROGRESS", updated_at: new Date().toISOString() }).eq("id", sessionId);
    if (error) toast.error(error.message);
    else { toast.success("Session sent back"); fetchSessions(); }
  };

  const handleView = (session: any) => {
    if (session.status === "APPROVED") navigate("/app/inventory/approved");
    else navigate("/app/inventory/review?session=" + session.id);
  };

  const handleDeclineToReview = async (sessionId: string) => {
    const { error } = await supabase.from("inventory_sessions").update({ status: "IN_REVIEW", updated_at: new Date().toISOString() }).eq("id", sessionId);
    if (error) toast.error(error.message);
    else { toast.success("Session moved back to Review"); fetchSessions(); }
  };

  const handleDuplicate = async (session: any) => {
    if (!currentRestaurant || !user) return;
    const { data: newSess, error } = await supabase.from("inventory_sessions").insert({
      restaurant_id: currentRestaurant.id,
      inventory_list_id: session.inventory_list_id,
      name: `${session.name} (copy)`,
      created_by: user.id
    }).select().single();
    if (error) { toast.error(error.message); return; }
    const { data: srcItems } = await supabase.from("inventory_session_items").select("*").eq("session_id", session.id);
    if (srcItems && srcItems.length > 0) {
      const duped = srcItems.map(({ id, session_id, ...rest }) => ({ ...rest, session_id: newSess.id }));
      await supabase.from("inventory_session_items").insert(duped);
    }
    toast.success("Session duplicated");
    fetchSessions();
  };

  const openSmartOrderModal = async (session: any) => {
    setSmartOrderSession(session);
    setSmartOrderSelectedPar("");
    if (!currentRestaurant) return;
    const { data } = await supabase.from("par_guides").select("*")
      .eq("restaurant_id", currentRestaurant.id)
      .eq("inventory_list_id", session.inventory_list_id);
    setSmartOrderParGuides(data || []);
  };

  const handleCreateSmartOrder = async () => {
    if (!smartOrderSession || !smartOrderSelectedPar || !currentRestaurant || !user) return;
    setSmartOrderCreating(true);

    const { data: sessionItems } = await supabase.from("inventory_session_items").select("*").eq("session_id", smartOrderSession.id);
    const { data: parItemsData } = await supabase.from("par_guide_items").select("*").eq("par_guide_id", smartOrderSelectedPar);

    if (!sessionItems) { toast.error("No session items found"); setSmartOrderCreating(false); return; }

    const parMap = buildParLevelMap(parItemsData || []);

    const computed = sessionItems.map(i => {
      const key = normalizeItemName(i.item_name);
      const sessionPar = Number(i.par_level ?? 0);
      const parLevel = key in parMap ? parMap[key] : sessionPar;
      const currentStock = Number(i.current_stock ?? 0);
      const risk = computeRiskLevel(currentStock, parLevel);
      const suggestedOrder = computeOrderQty(currentStock, parLevel, i.unit, i.pack_size);
      return {
        ...i,
        par_level: parLevel,
        suggestedOrder,
        risk,
      };
    });

    const { data: run, error } = await supabase.from("smart_order_runs").insert({
      restaurant_id: currentRestaurant.id,
      session_id: smartOrderSession.id,
      inventory_list_id: smartOrderSession.inventory_list_id,
      par_guide_id: smartOrderSelectedPar,
      created_by: user.id,
    }).select().single();
    if (error) { toast.error(error.message); setSmartOrderCreating(false); return; }

    const runItems = computed.map(i => ({
      run_id: run.id,
      catalog_item_id: i.catalog_item_id || null,
      item_name: i.item_name,
      suggested_order: i.suggestedOrder,
      risk: i.risk,
      current_stock: i.current_stock,
      par_level: i.par_level,
      unit_cost: i.unit_cost || null,
      pack_size: i.pack_size || null,
    }));
    let manualItemsErr = (await supabase.from("smart_order_run_items").insert(runItems)).error;
    if (manualItemsErr) {
      console.error("[handleCreateSmartOrder] insert:", manualItemsErr.message);
      const withoutCatalog = runItems.map(({ catalog_item_id: _c, ...rest }) => rest);
      manualItemsErr = (await supabase.from("smart_order_run_items").insert(withoutCatalog)).error;
      if (manualItemsErr) {
        toast.error(`Could not save order lines: ${manualItemsErr.message}`);
        setSmartOrderCreating(false);
        return;
      }
      toast.info("Saved order lines; some catalog links were cleared due to invalid references.");
    }

    toast.success("Smart order created — submit from Smart Order to generate the purchase order.");
    setSmartOrderSession(null);
    setSmartOrderCreating(false);
    navigate(`/app/smart-order?viewRun=${run.id}`);
  };

  const nextSchedule = useMemo(() => {
    if (!schedules.length) return null;
    let closest: any = null;
    let closestDate: Date | null = null;
    for (const s of schedules) {
      const d = computeNextOccurrence(s);
      if (d && (!closestDate || d < closestDate)) {
        closestDate = d;
        closest = { ...s, nextDate: d };
      }
    }
    return closest;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [schedules]);

  const landingFocus = useMemo(() => {
    const effectiveLandingListId =
      landingFocusListId && lists.some((l) => l.id === landingFocusListId)
        ? landingFocusListId
        : lists[0]?.id ?? null;
    const focusList = lists.find((l) => l.id === effectiveLandingListId) || null;
    const focusInProgressSession = effectiveLandingListId
      ? inProgressSessions.find((s) => s.inventory_list_id === effectiveLandingListId) ?? null
      : null;
    const focusReviewSession =
      !focusInProgressSession && effectiveLandingListId
        ? reviewSessions.find((s) => s.inventory_list_id === effectiveLandingListId) ?? null
        : null;
    const meta = effectiveLandingListId
      ? listSelectorMeta[effectiveLandingListId]
      : { itemCount: 0, lastCountedAt: null, hasParGuide: false };
    const stats = focusInProgressSession ? sessionStats[focusInProgressSession.id] : undefined;
    return {
      effectiveLandingListId,
      focusList,
      focusInProgressSession,
      focusReviewSession,
      meta: meta || { itemCount: 0, lastCountedAt: null, hasParGuide: false },
      stats,
    };
  }, [
    lists,
    landingFocusListId,
    inProgressSessions,
    reviewSessions,
    sessionStats,
    listSelectorMeta,
  ]);

  const mappingMode = categoryMode === "list_order" ? "list_order"
    : categoryMode === "custom-categories" ? "custom-categories"
    : categoryMode === "my-categories" ? "my-categories"
    : null;

  const { categories: mappedCategories, itemCategoryMap, hasMappings } = useCategoryMapping(
    activeSession?.inventory_list_id || selectedList || null,
    mappingMode === "list_order" ? "list_order" : mappingMode
  );

  const getItemCategory = (item: any): string => {
    if (categoryMode === "alphabetic") {
      return item.item_name.charAt(0).toUpperCase();
    }
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

  // Build catalog lookup: item_name -> { catalog_item_id, product_number }
  const catalogLookup = useMemo(() => {
    const map: Record<string, { id: string; product_number: string | null }> = {};
    catalogItems.forEach((ci: any) => {
      map[ci.item_name] = { id: ci.id, product_number: ci.product_number || ci.vendor_sku || null };
    });
    return map;
  }, [catalogItems]);

  const catalogDefaultParById = useMemo(() => {
    const map: Record<string, number> = {};
    catalogItems.forEach((ci: any) => {
      if (!ci.id) return;
      const parsed = Number(ci.default_par_level ?? 0);
      map[ci.id] = Number.isFinite(parsed) ? parsed : 0;
    });
    return map;
  }, [catalogItems]);

  const catalogDefaultParByName = useMemo(() => {
    const map: Record<string, number> = {};
    catalogItems.forEach((ci: any) => {
      const key = normalizeItemName(ci.item_name);
      if (!key) return;
      const parsed = Number(ci.default_par_level ?? 0);
      map[key] = Number.isFinite(parsed) ? parsed : 0;
    });
    return map;
  }, [catalogItems]);

  /** Single PAR source for STATUS, NEED, filters, and summary while counting with a selected PAR guide. */
  const getApprovedPar = useCallback((item: any): number => {
    if (countingParGuideId) {
      if (item.catalog_item_id && countingParByCatalogId[item.catalog_item_id] !== undefined) {
        return countingParByCatalogId[item.catalog_item_id];
      }
      const kn = normalizeItemName(item.item_name);
      if (kn && countingParByNormalizedName[kn] !== undefined) {
        return countingParByNormalizedName[kn];
      }
      const sessionPar = Number(item.par_level);
      if (item.par_level !== null && item.par_level !== undefined && Number.isFinite(sessionPar)) {
        return sessionPar;
      }
      return 0;
    }

    const key = normalizeItemName(item.item_name);
    const guidePar = approvedParMap[key];
    if (guidePar !== undefined) return guidePar;

    const sessionPar = Number(item.par_level);
    if (item.par_level !== null && item.par_level !== undefined && Number.isFinite(sessionPar)) {
      return sessionPar;
    }

    if (item.catalog_item_id && item.catalog_item_id in catalogDefaultParById) {
      return catalogDefaultParById[item.catalog_item_id];
    }

    return catalogDefaultParByName[key] ?? 0;
  }, [
    countingParGuideId,
    countingParByCatalogId,
    countingParByNormalizedName,
    approvedParMap,
    catalogDefaultParById,
    catalogDefaultParByName,
  ]);

  const getCatalogUnitCost = useCallback((catalogItemId: string | null | undefined): number | null => {
    if (!catalogItemId) return null;
    const cat = catalogItems.find((c: any) => c.id === catalogItemId);
    if (cat?.default_unit_cost == null) return null;
    const n = Number(cat.default_unit_cost);
    return Number.isFinite(n) ? n : null;
  }, [catalogItems]);

  const fetchOwnerManagerRecipientIds = useCallback(async (): Promise<string[]> => {
    if (!currentRestaurant?.id) return [];
    const { data: members } = await supabase.from("restaurant_members").select("user_id, role").eq("restaurant_id", currentRestaurant.id);
    const ids = (members || []).filter((m: any) => m.role === "OWNER" || m.role === "MANAGER").map((m: any) => m.user_id);
    return [...new Set(ids)];
  }, [currentRestaurant?.id]);

  const resolveParGuideIdForManagerEdits = useCallback(async (): Promise<string | null> => {
    if (countingParGuideId) return countingParGuideId;
    const listId = activeSession?.inventory_list_id;
    if (!listId || !currentRestaurant?.id) return null;
    const { data } = await supabase
      .from("par_guides")
      .select("id")
      .eq("restaurant_id", currentRestaurant.id)
      .eq("inventory_list_id", listId)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    return data?.id ?? null;
  }, [countingParGuideId, activeSession?.inventory_list_id, currentRestaurant?.id]);

  const openEditItemDetails = useCallback((row: any) => {
    setEditItemDetailsSessionItem(row);
    setEditItemDetailsForm({
      item_name: row.item_name || "",
      unit: row.unit || "",
      pack_size: row.pack_size || "",
    });
  }, []);

  const handleSaveEditItemDetails = useCallback(async () => {
    if (!editItemDetailsSessionItem || !currentRestaurant) return;
    const trimmed = (editItemDetailsForm.item_name || "").trim();
    if (!trimmed) {
      toast.error("Item name is required");
      return;
    }
    setEditItemDetailsSaving(true);
    const unit = editItemDetailsForm.unit || null;
    const pack_size = editItemDetailsForm.pack_size || null;
    const { error: e1 } = await supabase
      .from("inventory_session_items")
      .update({ item_name: trimmed, unit, pack_size })
      .eq("id", editItemDetailsSessionItem.id);
    if (e1) {
      toast.error(e1.message);
      setEditItemDetailsSaving(false);
      return;
    }
    if (editItemDetailsSessionItem.catalog_item_id) {
      const { error: e2 } = await supabase
        .from("inventory_catalog_items")
        .update({
          item_name: trimmed,
          unit,
          pack_size,
          updated_at: new Date().toISOString(),
        })
        .eq("id", editItemDetailsSessionItem.catalog_item_id);
      if (e2) {
        toast.error(e2.message);
        setEditItemDetailsSaving(false);
        return;
      }
      setCatalogItems((prev) =>
        prev.map((c: any) =>
          c.id === editItemDetailsSessionItem.catalog_item_id ? { ...c, item_name: trimmed, unit, pack_size } : c,
        ),
      );
    }
    setItems((prev) =>
      prev.map((i) =>
        i.id === editItemDetailsSessionItem.id ? { ...i, item_name: trimmed, unit, pack_size } : i,
      ),
    );
    if (countingParGuideId) {
      const slim = catalogItems.map((c: any) =>
        c.id === editItemDetailsSessionItem.catalog_item_id ? { id: c.id, item_name: trimmed } : { id: c.id, item_name: c.item_name },
      );
      await hydrateCountingParMaps(countingParGuideId, slim);
    }
    toast.success("Item details updated");
    setEditItemDetailsSessionItem(null);
    setEditItemDetailsSaving(false);
  }, [
    editItemDetailsSessionItem,
    editItemDetailsForm,
    currentRestaurant,
    countingParGuideId,
    catalogItems,
  ]);

  const handleStaffParChangeRequestSubmit = useCallback(async () => {
    if (!staffParRequestItem || !user || !currentRestaurant?.id || !activeSession?.id) return;
    const suggested = parseFloat(staffParSuggested);
    if (!Number.isFinite(suggested) || suggested < 0) {
      toast.error("Enter a valid suggested PAR");
      return;
    }
    setStaffParSending(true);
    const recipientIds = await fetchOwnerManagerRecipientIds();
    if (recipientIds.length === 0) {
      toast.error("No managers or owners found to notify");
      setStaffParSending(false);
      return;
    }
    const { data: profile } = await supabase.from("profiles").select("full_name, email").eq("id", user.id).maybeSingle();
    const staffName = profile?.full_name || profile?.email || "A team member";
    const currentPar = getApprovedPar(staffParRequestItem);
    const reasonText = staffParReason.trim() || "—";
    const message = `${staffName} suggested changing ${staffParRequestItem.item_name} PAR from ${currentPar} to ${suggested}. Reason: ${reasonText}`;
    const dataPayload = {
      item_name: staffParRequestItem.item_name,
      current_par: currentPar,
      suggested_par: suggested,
      reason: staffParReason.trim() || null,
      session_id: activeSession.id,
      requested_by: user.id,
    };
    const notifications = recipientIds.map((uid) => ({
      restaurant_id: currentRestaurant.id,
      user_id: uid,
      type: "PAR_CHANGE_REQUEST",
      title: "PAR change requested",
      message,
      severity: "INFO" as const,
      data: dataPayload as unknown as Record<string, unknown>,
    }));
    const { error } = await supabase.from("notifications").insert(notifications);
    setStaffParSending(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("PAR change request sent to your manager");
    setStaffParRequestItem(null);
  }, [
    staffParRequestItem,
    staffParSuggested,
    staffParReason,
    user,
    currentRestaurant,
    activeSession,
    fetchOwnerManagerRecipientIds,
    getApprovedPar,
  ]);

  const handleStaffPriceChangeRequestSubmit = useCallback(async () => {
    if (!staffPriceRequestItem || !user || !currentRestaurant?.id || !activeSession?.id) return;
    const suggested = parseFloat(staffPriceSuggested);
    if (!Number.isFinite(suggested) || suggested < 0) {
      toast.error("Enter a valid suggested price");
      return;
    }
    setStaffPriceSending(true);
    const recipientIds = await fetchOwnerManagerRecipientIds();
    if (recipientIds.length === 0) {
      toast.error("No managers or owners found to notify");
      setStaffPriceSending(false);
      return;
    }
    const { data: profile } = await supabase.from("profiles").select("full_name, email").eq("id", user.id).maybeSingle();
    const staffName = profile?.full_name || profile?.email || "A team member";
    const sessionPrice = staffPriceRequestItem.unit_cost;
    const currentPrice =
      sessionPrice != null && Number.isFinite(Number(sessionPrice))
        ? Number(sessionPrice)
        : getCatalogUnitCost(staffPriceRequestItem.catalog_item_id);
    const currentLabel = currentPrice != null ? `$${currentPrice.toFixed(2)}` : "—";
    const reasonText = staffPriceReason.trim() || "—";
    const message = `${staffName} suggested changing ${staffPriceRequestItem.item_name} unit price from ${currentLabel} to $${suggested.toFixed(2)}. Reason: ${reasonText}`;
    const dataPayload = {
      item_name: staffPriceRequestItem.item_name,
      current_price: currentPrice,
      suggested_price: suggested,
      reason: staffPriceReason.trim() || null,
      session_id: activeSession.id,
      requested_by: user.id,
    };
    const notifications = recipientIds.map((uid) => ({
      restaurant_id: currentRestaurant.id,
      user_id: uid,
      type: "PRICE_CHANGE_REQUEST",
      title: "Price change requested",
      message,
      severity: "INFO" as const,
      data: dataPayload as unknown as Record<string, unknown>,
    }));
    const { error } = await supabase.from("notifications").insert(notifications);
    setStaffPriceSending(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Price change request sent to your manager");
    setStaffPriceRequestItem(null);
  }, [
    staffPriceRequestItem,
    staffPriceSuggested,
    staffPriceReason,
    user,
    currentRestaurant,
    activeSession,
    fetchOwnerManagerRecipientIds,
    getCatalogUnitCost,
  ]);

  const handleManagerParLevelSave = useCallback(async () => {
    if (!managerParEditItem || !currentRestaurant) return;
    const n = parseFloat(managerParInput);
    if (!Number.isFinite(n) || n < 0) {
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
    const { data: guideRows } = await supabase
      .from("par_guide_items")
      .select("id, item_name")
      .eq("par_guide_id", guideId);
    const key = normalizeItemName(managerParEditItem.item_name);
    const match = (guideRows || []).find((r) => normalizeItemName(r.item_name) === key);
    if (!match) {
      toast.error("No PAR line for this item in the linked guide");
      setManagerParSaving(false);
      return;
    }
    const { error: e1 } = await supabase.from("par_guide_items").update({ par_level: n }).eq("id", match.id);
    if (e1) {
      toast.error(e1.message);
      setManagerParSaving(false);
      return;
    }
    if (managerParEditItem.catalog_item_id) {
      const { error: e2 } = await supabase
        .from("inventory_catalog_items")
        .update({ default_par_level: n, updated_at: new Date().toISOString() })
        .eq("id", managerParEditItem.catalog_item_id);
      if (e2) {
        toast.error(e2.message);
        setManagerParSaving(false);
        return;
      }
      setCatalogItems((prev) =>
        prev.map((c: any) => (c.id === managerParEditItem.catalog_item_id ? { ...c, default_par_level: n } : c)),
      );
    }
    if (countingParGuideId === guideId) {
      const slim = catalogItems.map((c: any) => ({ id: c.id, item_name: c.item_name }));
      await hydrateCountingParMaps(countingParGuideId, slim);
    }
    toast.success("PAR level updated");
    setManagerParEditItem(null);
    setManagerParSaving(false);
  }, [
    managerParEditItem,
    managerParInput,
    currentRestaurant,
    resolveParGuideIdForManagerEdits,
    countingParGuideId,
    catalogItems,
  ]);

  const handleManagerPriceSave = useCallback(async () => {
    if (!managerPriceEditItem) return;
    const price = managerPriceInput === "" ? null : parseFloat(managerPriceInput);
    if (price != null && (!Number.isFinite(price) || price < 0)) {
      toast.error("Enter a valid price");
      return;
    }
    setManagerPriceSaving(true);
    const { error: e1 } = await supabase.from("inventory_session_items").update({ unit_cost: price }).eq("id", managerPriceEditItem.id);
    if (e1) {
      toast.error(e1.message);
      setManagerPriceSaving(false);
      return;
    }
    if (managerPriceEditItem.catalog_item_id) {
      const { error: e2 } = await supabase
        .from("inventory_catalog_items")
        .update({ default_unit_cost: price, updated_at: new Date().toISOString() })
        .eq("id", managerPriceEditItem.catalog_item_id);
      if (e2) {
        toast.error(e2.message);
        setManagerPriceSaving(false);
        return;
      }
      setCatalogItems((prev) =>
        prev.map((c: any) =>
          c.id === managerPriceEditItem.catalog_item_id ? { ...c, default_unit_cost: price } : c,
        ),
      );
    }
    setItems((prev) => prev.map((i) => (i.id === managerPriceEditItem.id ? { ...i, unit_cost: price } : i)));
    toast.success("Price updated");
    setManagerPriceEditItem(null);
    setManagerPriceSaving(false);
  }, [managerPriceEditItem, managerPriceInput]);

  const getLastOrderDate = (itemName: string): string | null => {
    const cat = catalogLookup[itemName];
    if (!cat) return null;
    return lastOrderDates[cat.id] || null;
  };

  const getProductNumber = (item: any): string | null => {
    return item.vendor_sku || catalogLookup[item.item_name]?.product_number || null;
  };

  const formatLastOrdered = (date: string | null): string => {
    if (!date) return "—";
    try { return format(new Date(date), "MM/dd/yy"); } catch { return "—"; }
  };

  // Apply status filter in addition to category/search filters
  const filteredItems = items.filter((i) => {
    const cat = getItemCategory(i);
    if (filterCategory !== "all" && cat !== filterCategory) return false;
    if (search && !i.item_name.toLowerCase().includes(search.toLowerCase())) return false;
    if (showOnlyEmpty && Number(i.current_stock) > 0) return false;
    // Status filter
    if (statusFilter === "uncounted" && getRowState(i) !== "uncounted") return false;
    if (statusFilter === "low") {
      const par = getApprovedPar(i);
      const risk = getRisk(Number(i.current_stock ?? 0), par);
      if (risk.label !== "Low") return false;
    }
    if (statusFilter === "critical") {
      const par = getApprovedPar(i);
      const risk = getRisk(Number(i.current_stock ?? 0), par);
      if (risk.label !== "Critical") return false;
    }
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

  if (categoryMode === "alphabetic") {
    filteredItems.sort((a, b) => a.item_name.localeCompare(b.item_name));
  }

  const categories = hasMappings
    ? mappedCategories.map(c => c.name)
    : [...new Set(items.map((i) => i.category).filter(Boolean))];
  const currentListId = activeSession?.inventory_list_id || selectedList || "";
  const selectedListName = lists.find((l) => l.id === currentListId)?.name || "";

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
    : categoryMode === "alphabetic"
      ? Object.keys(groupedItems).sort()
      : Object.keys(groupedItems);

  const jumpToNextEmpty = () => {
    const emptyItem = filteredItems.find(i => !i.current_stock || Number(i.current_stock) === 0);
    if (emptyItem && inputRefs.current[emptyItem.id]) {
      inputRefs.current[emptyItem.id]?.focus();
      inputRefs.current[emptyItem.id]?.scrollIntoView({ behavior: "smooth", block: "center" });
    } else {
      toast.info("All items have been counted!");
    }
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
  const submitSummary = useMemo(() => {
    let lowCount = 0;
    let criticalCount = 0;
    let estimatedValue = 0;
    items.forEach(i => {
      const par = getApprovedPar(i);
      const risk = getRisk(Number(i.current_stock ?? 0), par);
      if (risk.label === "Low") lowCount++;
      if (risk.label === "Critical") criticalCount++;
      if (par && par > 0) {
        const need = Math.ceil(Math.max(0, par - Number(i.current_stock ?? 0)));
        if (need > 0 && i.unit_cost) estimatedValue += need * Number(i.unit_cost);
      }
    });
    return { counted: countedItems, total: totalItems, lowCount, criticalCount, estimatedValue };
  }, [
    items,
    countedItems,
    totalItems,
    getApprovedPar,
  ]);

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

    const resolveCountingParDisplay = (item: any): number | null => {
      if (!parColumnVisible || !countingParGuideId) return null;
      if (item.catalog_item_id && countingParByCatalogId[item.catalog_item_id] !== undefined) {
        return countingParByCatalogId[item.catalog_item_id];
      }
      const kn = normalizeItemName(item.item_name);
      if (kn && countingParByNormalizedName[kn] !== undefined) return countingParByNormalizedName[kn];
      return null;
    };

    const resolveStoredGuideParValue = (item: any): number | null => {
      if (!countingParGuideId) return null;
      if (item.catalog_item_id && countingParByCatalogId[item.catalog_item_id] !== undefined) {
        return countingParByCatalogId[item.catalog_item_id];
      }
      const kn = normalizeItemName(item.item_name);
      if (kn && countingParByNormalizedName[kn] !== undefined) return countingParByNormalizedName[kn];
      return null;
    };

    const formatParColumnCell = (item: any) => {
      const v = resolveCountingParDisplay(item);
      return v === null ? "—" : formatNum(v);
    };

    const renderRowActionsMenu = (item: any) => (
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
              <h1 className="text-base lg:text-lg font-bold tracking-tight truncate">{activeSession.name}</h1>
              <div className="flex items-center gap-2 mt-0.5">
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
              <p className="text-[11px] text-muted-foreground mt-1 truncate">
                {parColumnVisible && countingParGuideName
                  ? `Showing PAR from “${countingParGuideName}” (read-only)`
                  : countingParGuideName
                    ? `PAR guide for this count: “${countingParGuideName}”. Open ⋯ → Show PAR to view the column.`
                    : "PAR is optional — ⋯ menu → Show PAR to pick a guide and view levels while counting."}
              </p>
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
            >
              <Send className="h-3.5 w-3.5" /> Submit for Review
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

            {/* Category grouping dropdown */}
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
              {/* Status filter dropdown */}
              <Select value={statusFilter} onValueChange={(v: any) => setStatusFilter(v)}>
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
          <div className="rounded-lg border border-border/50 bg-muted/40 px-4 py-2.5 text-sm text-muted-foreground">
            This session is submitted or approved and cannot be edited here. Use Review or Approved Inventory to view it.
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
                      const risk = getRisk(item.current_stock, rowPar);
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
                                  <span className="text-[10px] text-muted-foreground/50">Last: {formatLastOrdered(getLastOrderDate(item.item_name))}</span>
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
          /* ─── TABLE LAYOUT (desktop standard) ─── */
          <div className="mt-4 space-y-6">
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
                  <Table>
                    <TableHeader>
                      <TableRow className="border-b border-border/20 hover:bg-transparent">
                        <TableHead className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/60 pl-5">Item</TableHead>
                        <TableHead className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/60 w-36 text-center">On Hand</TableHead>
                        {parColumnVisible && (
                          <TableHead className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/60 w-24 text-right">PAR</TableHead>
                        )}
                        <TableHead className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/60 w-24 text-right">Price</TableHead>
                        <TableHead className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/60 w-20 text-right">Need</TableHead>
                        <TableHead className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/60 w-24 text-center pr-5">Status</TableHead>
                        <TableHead className="w-10"></TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {catItems.map((item) => {
                        const globalIdx = filteredItems.indexOf(item);
                        const rowPar = getApprovedPar(item);
                        const needQty = rowPar > 0 ? computeOrderQty(item.current_stock, rowPar, item.unit, item.pack_size) : null;
                        const risk = getRisk(item.current_stock, rowPar);
                        const rowState = getRowState(item.current_stock);
                        const rowBg = getRowBgClass(item.current_stock);
                        const isRecentlyEdited = lastEditedId === item.id;

                        return (
                          <TableRow
                            key={item.id}
                            className={`border-b border-border/10 transition-all duration-200 hover:bg-muted/20 ${rowBg} ${isRecentlyEdited ? "bg-primary/[0.03]" : ""}`}
                          >
                            <TableCell className="pl-5 py-3">
                              <p className="font-medium text-sm leading-tight">{item.item_name}</p>
                              <ItemIdentityBlock brandName={item.brand_name} className="block mt-0.5" />
                              <div className="flex flex-wrap items-center gap-x-2 gap-y-0 mt-0.5">
                                {getProductNumber(item) && (
                                  <span className="text-[11px] text-muted-foreground/50 font-mono">#{getProductNumber(item)}</span>
                                )}
                                {item.pack_size && (
                                  <span className="text-[11px] text-muted-foreground/50">{item.pack_size}</span>
                                )}
                                <span className="text-[11px] text-muted-foreground/40">
                                  {formatLastOrdered(getLastOrderDate(item.item_name)) !== "—"
                                    ? `Last: ${formatLastOrdered(getLastOrderDate(item.item_name))}`
                                    : null}
                                </span>
                              </div>
                            </TableCell>
                            <TableCell className="text-center py-3">
                              <div className="flex items-center justify-center gap-2">
                                <Input
                                  ref={el => { inputRefs.current[item.id] = el; }}
                                  type="number"
                                  inputMode="decimal"
                                  min={0}
                                  step={0.1}
                                  readOnly={!isCountingEditable}
                                  value={inputDisplayValue(item.current_stock)}
                                  onFocus={(e) => e.target.select()}
                                  onChange={(e) => handleUpdateStock(item.id, e.target.value)}
                                  onBlur={() => handleSaveStock(item.id, item.current_stock)}
                                  onKeyDown={(e) => handleKeyDown(e, globalIdx, "stock")}
                                  className="w-24 h-10 text-base font-mono text-center font-semibold rounded-lg border-2 border-border/50 focus:border-primary/50 bg-background [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                                />
                                <div className="w-5">
                                  {savingId === item.id && <span className="text-muted-foreground animate-pulse text-xs">…</span>}
                                  {savedId === item.id && <Check className="h-3.5 w-3.5 text-success" />}
                                </div>
                              </div>
                            </TableCell>
                            {parColumnVisible && (
                              <TableCell className="text-right py-3">
                                <span className="text-sm font-mono font-semibold tabular-nums text-foreground">
                                  {formatParColumnCell(item)}
                                </span>
                              </TableCell>
                            )}
                            <TableCell className="text-right py-3">
                              <span className="text-sm font-mono tabular-nums text-foreground">
                                {item.unit_cost != null ? `$${Number(item.unit_cost).toFixed(2)}` : <span className="text-muted-foreground/30">—</span>}
                              </span>
                            </TableCell>
                            <TableCell className="text-right py-3">
                              {needQty !== null ? (
                                <span className={`font-mono text-sm font-semibold ${needQty > 0 ? "text-destructive" : "text-muted-foreground"}`}>
                                  {formatNum(needQty)}
                                </span>
                              ) : (
                                <span className="text-muted-foreground/30 text-sm">—</span>
                              )}
                            </TableCell>
                            <TableCell className="text-center pr-5 py-3">
                              <Badge className={`${risk.bgClass} ${risk.textClass} border-0 text-[10px] font-medium`}>
                                {getRiskBadgeLabel(risk)}
                              </Badge>
                            </TableCell>
                            <TableCell className="py-3 pr-3" onClick={e => e.stopPropagation()}>
                              {renderRowActionsMenu(item)}
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
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