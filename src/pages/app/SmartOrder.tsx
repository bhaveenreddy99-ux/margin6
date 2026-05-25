import { Fragment, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import type { Tables } from "@/integrations/supabase/types";
import { withLocationOrNull } from "@/domain/locations/locationQueryScope";
import { useRestaurant } from "@/contexts/RestaurantContext";
import { useLocationPermissions } from "@/hooks/useLocationPermissions";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel,
  AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { toast } from "sonner";
import { ShoppingCart, DollarSign, AlertTriangle, Eye, ArrowLeft, Trash2, ExternalLink, Info, Pencil } from "lucide-react";
import { ExportButtons } from "@/components/ExportButtons";
import {
  getRisk,
  computeRiskLevel,
  computeOrderQtyCases,
  formatNum,
  formatCurrency,
  type RiskThresholds,
} from "@/lib/inventory-utils";
import { computeOrderDollars } from "@/domain/inventory/casePlanningEngine";
import { riskThresholdsFromSettings } from "@/domain/inventory/riskThresholds";
import ItemIdentityBlock from "@/components/ItemIdentityBlock";
import { useLastOrderDates } from "@/hooks/useLastOrderDates";
import { format } from "date-fns";
import { STOCK_TRUTH_MESSAGE } from "@/lib/stockTruthCopy";
import {
  analyzeMultiVendorBlockForSubmit,
  analyzeVendorBlockForSubmit,
  type CatalogItemVendorFields,
} from "@/domain/ordering/smartOrderVendor";
import { SmartOrderRunItemCards } from "@/components/ordering/SmartOrderRunItemCards";
import { buildInvoiceCostMap, type InvoiceCostMap } from "@/domain/ordering/invoiceCostLookup";
import { cn } from "@/lib/utils";

const normalizeItemName = (value: string | null | undefined) => (value || "").trim().toLowerCase();

function SmartOrderEmptyState() {
  const { currentRestaurant, currentLocation } = useRestaurant();
  const [hasParGuide, setHasParGuide] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!currentRestaurant?.id) {
      setHasParGuide(null);
      return;
    }
    (async () => {
      let q = supabase
        .from("par_guides")
        .select("id", { count: "exact", head: true })
        .eq("restaurant_id", currentRestaurant.id);
      if (currentLocation?.id) {
        q = q.or(`location_id.eq.${currentLocation.id},location_id.is.null`);
      }
      const { count } = await q;
      if (cancelled) return;
      setHasParGuide((count ?? 0) > 0);
    })();
    return () => {
      cancelled = true;
    };
  }, [currentRestaurant?.id, currentLocation?.id]);

  // Until we know whether PAR exists, default to the PAR CTA — a no-op count
  // can still be created even without PAR, so the missing-PAR message is the
  // higher-leverage default.
  const showParCta = hasParGuide !== true;

  return (
    <Card>
      <CardContent className="empty-state">
        <ShoppingCart className="empty-state-icon" />
        <p className="empty-state-title">No smart orders yet</p>
        {showParCta ? (
          <>
            <p className="empty-state-description">
              Set PAR levels to unlock Smart Orders. PAR tells us when each item needs reordering.
            </p>
            <Button
              asChild
              className="mt-4 bg-gradient-orange text-white shadow-orange hover:opacity-90 h-10 min-h-11 text-xs font-semibold"
            >
              <Link to="/app/par">Set PAR Levels</Link>
            </Button>
          </>
        ) : (
          <>
            <p className="empty-state-description">
              Approve an inventory count in Inventory Management to generate your first Smart Order.
            </p>
            <Button
              asChild
              className="mt-4 bg-gradient-orange text-white shadow-orange hover:opacity-90 h-10 min-h-11 text-xs font-semibold"
            >
              <Link to="/app/inventory/enter">Open Inventory Management</Link>
            </Button>
          </>
        )}
      </CardContent>
    </Card>
  );
}

type CatalogRowForUom = Pick<
  Tables<"inventory_catalog_items">,
  "id" | "item_name" | "product_number" | "vendor_sku" | "vendor_name" | "inventory_list_id" | "unit"
>;

/** List/table fetch embeds related rows for display (names only). */
type SmartOrderRunWithEmbed = Tables<"smart_order_runs"> & {
  inventory_lists?: { name: string } | null;
  inventory_sessions?: { name: string; approved_at: string | null } | null;
  par_guides?: { name: string } | null;
  smart_order_run_items?: { id: string }[] | null;
};

/**
 * UOM for Smart Order lines: `smart_order_run_items` has no `unit`; use catalog `unit`
 * (id match, then normalized item name). Normalized to lowercase for grouping.
 */
function getLineUom(
  i: Tables<"smart_order_run_items">,
  catalogById: Record<string, CatalogRowForUom | undefined>,
  catalogLookup: Record<string, CatalogRowForUom | undefined>,
): string {
  const fromId = i.catalog_item_id ? catalogById[i.catalog_item_id]?.unit : undefined;
  const fromName = catalogLookup[normalizeItemName(i.item_name)]?.unit;
  const raw = (fromId ?? fromName ?? "").trim();
  if (!raw) return "other";
  return raw.toLowerCase();
}

function resolveDisplayCost(
  item: Tables<"smart_order_run_items">,
  invoiceCostMap: InvoiceCostMap,
): { cost: number | null; source: "invoice" | "count" | "none" } {
  if (item.catalog_item_id) {
    const invoiceCost = invoiceCostMap.get(item.catalog_item_id);
    if (invoiceCost != null) {
      return { cost: invoiceCost, source: "invoice" };
    }
  }
  if (item.unit_cost != null) {
    return { cost: item.unit_cost, source: "count" };
  }
  return { cost: null, source: "none" };
}

/** Multi-vendor block UX (logic unchanged — copy only). */
const MULTI_VENDOR_SUBMIT_MESSAGE =
  "This order includes items from multiple vendors. Create separate orders per vendor.";
const MULTI_VENDOR_TIP = "Tip: Keep one vendor per list for faster ordering.";

/** User-facing message for failed `submit_smart_order` RPC (avoids raw Postgres strings in toasts). */
function formatSmartOrderSubmitError(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  const low = raw.toLowerCase();
  if (low.includes("network") || low.includes("failed to fetch") || low.includes("load failed")) {
    return "Connection problem. Check your network and try again.";
  }
  if (low.includes("jwt") || low.includes("session") || low.includes("auth")) {
    return "Your session may have expired. Sign in again, then retry.";
  }
  if (low.includes("permission") || low.includes("rls") || low.includes("policy") || low.includes("not authorized")) {
    return "You don’t have permission to submit this order. Ask a manager or owner.";
  }
  return `Couldn’t submit the order. Try again. If it keeps failing, share this with support: ${raw.length > 180 ? `${raw.slice(0, 180)}…` : raw}`;
}

export default function SmartOrderPage() {
  const { currentRestaurant, currentLocation, locations } = useRestaurant();
  const perms = useLocationPermissions();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const [runs, setRuns] = useState<SmartOrderRunWithEmbed[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedRun, setSelectedRun] = useState<SmartOrderRunWithEmbed | null>(null);
  const [runItems, setRunItems] = useState<Tables<'smart_order_run_items'>[]>([]);
  const [deleteRunId, setDeleteRunId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [editingRunItem, setEditingRunItem] = useState<string | null>(null);
  const [editRunValues, setEditRunValues] = useState<{ par_level: string; unit_cost: string }>({ par_level: "", unit_cost: "" });

  // Filters
  const [dateFilter, setDateFilter] = useState("30");
  const [listFilter, setListFilter] = useState("all");
  const [lists, setLists] = useState<Pick<Tables<'inventory_lists'>, 'id' | 'name'>[]>([]);
  const [catalogItems, setCatalogItems] = useState<CatalogRowForUom[]>([]);
  const [invoiceCostMap, setInvoiceCostMap] = useState<InvoiceCostMap>(() => new Map());

  // Detail view toggles — persisted across opens within the session
  const [showGreen, setShowGreen] = useState(() => sessionStorage.getItem("so_showGreen") === "1");
  const [showNoPar, setShowNoPar] = useState(() => sessionStorage.getItem("so_showNoPar") === "1");

  const toggleShowGreen = (v: boolean) => { setShowGreen(v); sessionStorage.setItem("so_showGreen", v ? "1" : "0"); };
  const toggleShowNoPar = (v: boolean) => { setShowNoPar(v); sessionStorage.setItem("so_showNoPar", v ? "1" : "0"); };
  const [riskThresholds, setRiskThresholds] = useState<RiskThresholds>({
    redThresholdPercent: 50,
    yellowThresholdPercent: 100,
  });

  const { lastOrderDates } = useLastOrderDates(currentRestaurant?.id);

  useEffect(() => {
    if (!currentRestaurant) return;
    let cancelled = false;
    supabase.from("inventory_lists").select("id, name").eq("restaurant_id", currentRestaurant.id)
      .then(({ data }) => { if (!cancelled && data) setLists(data); });
    supabase.from("inventory_catalog_items").select("id, item_name, product_number, vendor_sku, vendor_name, inventory_list_id, unit").eq("restaurant_id", currentRestaurant.id)
      .then(({ data }) => { if (!cancelled && data) setCatalogItems(data); });
    supabase.from("smart_order_settings").select("red_threshold, yellow_threshold").eq("restaurant_id", currentRestaurant.id).maybeSingle()
      .then(({ data }) => { if (!cancelled) setRiskThresholds(riskThresholdsFromSettings(data)); });
    return () => { cancelled = true; };
  }, [currentRestaurant]);

  const catalogLookup = catalogItems.reduce<Record<string, any>>((acc, ci) => {
    const normalizedName = normalizeItemName(ci.item_name);
    if (!normalizedName || acc[normalizedName]) return acc;
    acc[normalizedName] = ci;
    return acc;
  }, {});

  const catalogById = catalogItems.reduce<Record<string, any>>((acc, ci) => {
    acc[ci.id] = ci;
    return acc;
  }, {});

  const vendorSubmitAnalysis = useMemo(() => {
    if (!selectedRun) return { blocked: false as const };
    const byId = catalogItems.reduce<Record<string, CatalogItemVendorFields>>((acc, ci) => {
      acc[ci.id] = ci;
      return acc;
    }, {});
    const multi = analyzeMultiVendorBlockForSubmit(runItems, byId);
    if (multi.blocked) {
      return { blocked: true as const, reason: "multi_vendor" as const, sampleVendors: multi.sampleVendors };
    }
    const rest = analyzeVendorBlockForSubmit(
      runItems,
      selectedRun.inventory_list_id ?? null,
      byId,
    );
    if (rest.blocked) {
      return {
        blocked: true as const,
        reason: "no_vendor" as const,
        listLevelOnly: rest.listLevelOnly,
        sampleNames: rest.sampleNames,
        problemLineCount: rest.problemLineCount,
      };
    }
    return { blocked: false as const };
  }, [selectedRun, runItems, catalogItems]);

  const smartOrderDetailMetrics = useMemo(() => {
    if (!selectedRun) {
      return {
        totalEstCost: 0,
        thresholdExceeded: false,
        orderItemsCosted: 0,
        orderItemsLen: 0,
      };
    }
    const orderItems = runItems.filter(
      (i) =>
        i.suggested_order > 0 &&
        computeRiskLevel(i.current_stock, i.par_level, riskThresholds) !== "NO_PAR",
    );
    const lineEstCostFn = (item: Tables<"smart_order_run_items">) => {
      const { cost } = resolveDisplayCost(item, invoiceCostMap);
      return computeOrderDollars(item.suggested_order, cost).dollars;
    };
    const totalEstCost = orderItems.reduce((sum, i) => sum + lineEstCostFn(i), 0);
    const orderItemsCosted = orderItems.filter(
      (i) => resolveDisplayCost(i, invoiceCostMap).source !== "none",
    ).length;
    const thr = perms.order_approval_threshold;
    const thresholdExceeded = thr != null && totalEstCost > thr;
    return {
      totalEstCost,
      thresholdExceeded,
      orderItemsCosted,
      orderItemsLen: orderItems.length,
    };
  }, [selectedRun, runItems, invoiceCostMap, riskThresholds, perms.order_approval_threshold]);

  const fetchRuns = async () => {
    if (!currentRestaurant) return;
    setLoading(true);
    try {
      const daysAgo = new Date();
      daysAgo.setDate(daysAgo.getDate() - parseInt(dateFilter));

      let query = supabase.from("smart_order_runs")
        .select("*, inventory_lists(name), inventory_sessions(name, approved_at), par_guides(name), smart_order_run_items(id)")
        .eq("restaurant_id", currentRestaurant.id)
        .gte("created_at", daysAgo.toISOString())
        .order("created_at", { ascending: false });

      if (currentLocation?.id) {
        query = withLocationOrNull(query, currentLocation.id);
      }

      if (listFilter !== "all") {
        query = query.eq("inventory_list_id", listFilter);
      }

      const { data } = await query;
      if (data) setRuns(data as SmartOrderRunWithEmbed[]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchRuns(); }, [currentRestaurant, currentLocation, dateFilter, listFilter]);

  // Auto-open a run if viewRun param is set
  useEffect(() => {
    const viewRunId = searchParams.get("viewRun");
    if (viewRunId && runs.length > 0) {
      const run = runs.find(r => r.id === viewRunId);
      if (run) {
        openRunDetail(run);
        searchParams.delete("viewRun");
        setSearchParams(searchParams, { replace: true });
      }
    }
  }, [runs, searchParams]);

  const openRunDetail = async (run: SmartOrderRunWithEmbed) => {
    setSelectedRun(run);
    if (!currentRestaurant?.id) {
      setRunItems([]);
      setInvoiceCostMap(new Map());
      return;
    }
    const restaurantId = currentRestaurant.id;
    const locationId = run.location_id ?? currentLocation?.id ?? null;

    const [runItemsRes, costFetch] = await Promise.all([
      supabase.from("smart_order_run_items").select("*").eq("run_id", run.id),
      (async () => {
        let invQuery = supabase
          .from("invoices")
          .select("id, confirmed_at")
          .eq("restaurant_id", restaurantId)
          .eq("status", "confirmed")
          .not("confirmed_at", "is", null)
          .order("confirmed_at", { ascending: false })
          .limit(100);
        if (locationId) {
          invQuery = invQuery.eq("location_id", locationId);
        }
        const { data: confirmedInvoices, error: invErr } = await invQuery;
        if (invErr) {
          console.error("[SmartOrder] confirmed invoices for cost", invErr);
          return {
            lines: [] as Array<{
              invoice_id: string;
              catalog_item_id: string | null;
              unit_cost: number | null;
            }>,
            order: [] as string[],
          };
        }
        const ids = (confirmedInvoices ?? []).map((r) => r.id);
        if (ids.length === 0) {
          return { lines: [], order: [] };
        }
        const { data: invoiceLines, error: itemsErr } = await supabase
          .from("invoice_items")
          .select("invoice_id, catalog_item_id, unit_cost")
          .in("invoice_id", ids)
          .not("catalog_item_id", "is", null)
          .not("unit_cost", "is", null);
        if (itemsErr) {
          console.error("[SmartOrder] invoice_items for cost", itemsErr);
          return { lines: [], order: ids };
        }
        return { lines: invoiceLines ?? [], order: ids };
      })(),
    ]);

    if (runItemsRes.error) {
      console.error("[SmartOrder] smart_order_run_items", runItemsRes.error);
    }
    if (runItemsRes.data) {
      setRunItems(runItemsRes.data.sort((a, b) => b.suggested_order - a.suggested_order));
    } else {
      setRunItems([]);
    }
    setInvoiceCostMap(buildInvoiceCostMap(costFetch.lines, costFetch.order));
  };

  const handleDeleteRun = async (idToDelete: string) => {
    if (!idToDelete) return;

    // Close dialog + optimistic UI update immediately
    setDeleteRunId(null);
    setRuns(prev => prev.filter(r => r.id !== idToDelete));
    if (selectedRun?.id === idToDelete) { setSelectedRun(null); setRunItems([]); setInvoiceCostMap(new Map()); }

    // Delete child items first (FK safety)
    await supabase.from("smart_order_run_items").delete().eq("run_id", idToDelete);

    const { data: poRow } = await supabase.from("purchase_orders").select("id").eq("smart_order_run_id", idToDelete).maybeSingle();
    if (poRow?.id) {
      const { data: invs } = await supabase.from("invoices").select("id").eq("purchase_order_id", poRow.id);
      if (invs?.length) {
        const invIds = invs.map((r: { id: string }) => r.id);
        await supabase.from("invoice_items").delete().in("invoice_id", invIds);
        await supabase.from("invoices").delete().in("id", invIds);
      }
      await supabase.from("purchase_order_items").delete().eq("purchase_order_id", poRow.id);
      await supabase.from("purchase_orders").delete().eq("id", poRow.id);
    }

    const { data: phRows } = await supabase.from("purchase_history").select("id").eq("smart_order_run_id", idToDelete);
    if (phRows && phRows.length > 0) {
      const phIds = phRows.map(p => p.id);
      await supabase.from("purchase_history_items").delete().in("purchase_history_id", phIds);
      await supabase.from("purchase_history").delete().in("id", phIds);
    }

    const { error } = await supabase.from("smart_order_runs").delete().eq("id", idToDelete).eq("restaurant_id", currentRestaurant.id);
    if (error) {
      toast.error(`Delete failed: ${error.message}`);
      fetchRuns();
    } else {
      toast.success("Smart order deleted");
      fetchRuns();
    }
  };

  const handleSubmitOrder = async () => {
    if (!selectedRun || !user) return;
    if (vendorSubmitAnalysis.blocked) {
      if (vendorSubmitAnalysis.reason === "multi_vendor") {
        toast.error(MULTI_VENDOR_SUBMIT_MESSAGE, { description: MULTI_VENDOR_TIP });
        return;
      }
      if (vendorSubmitAnalysis.listLevelOnly) {
        toast.error(
          "Cannot submit order: no vendor on catalog for this list. Add vendor names in List Management before submitting this order.",
        );
        return;
      }
      const { sampleNames, problemLineCount } = vendorSubmitAnalysis;
      const namesPart =
        sampleNames.length > 0
          ? ` Examples: ${sampleNames.join(", ")}${problemLineCount > sampleNames.length ? "…" : ""}.`
          : "";
      toast.error(
        `Cannot submit order: no vendor on catalog for this list (${problemLineCount} line${problemLineCount === 1 ? "" : "s"} affected).${namesPart} Add vendor names in List Management before submitting this order.`,
      );
      return;
    }
    if (perms.order_approval_threshold != null) {
      const orderItemsForThreshold = runItems.filter(
        (i) =>
          i.suggested_order > 0 &&
          computeRiskLevel(i.current_stock, i.par_level, riskThresholds) !== "NO_PAR",
      );
      const lineEstForThreshold = (item: Tables<"smart_order_run_items">) => {
        const { cost } = resolveDisplayCost(item, invoiceCostMap);
        return computeOrderDollars(item.suggested_order, cost).dollars;
      };
      const totalEst = orderItemsForThreshold.reduce((sum, i) => sum + lineEstForThreshold(i), 0);
      if (totalEst > perms.order_approval_threshold) {
        toast.error(
          `This order total (${formatCurrency(totalEst)}) exceeds your approval limit (${formatCurrency(perms.order_approval_threshold)}). Owner approval required.`,
        );
        return;
      }
    }
    // Capture pre-submit status from the closure so the toast is correct
    // even after state updates happen asynchronously.
    const isFirstSubmit = selectedRun.status !== 'submitted';
    setSubmitting(true);
    try {
      // PO number generation and assignment is handled entirely by the RPC.
      const { data: rpcResult, error } = await supabase.rpc('submit_smart_order', { p_run_id: selectedRun.id });
      if (error) throw error;

      // Re-fetch the updated row so we always have the DB-authoritative
      // po_number and status, regardless of what the RPC return value looks
      // like under different PostgREST schema-cache states.
      const { data: freshRun } = await supabase
        .from('smart_order_runs')
        .select('id, status, po_number')
        .eq('id', selectedRun.id)
        .single();

      // Primary: re-fetched row. Fallback: RPC JSONB payload. Never null.
      const poNumber: string | null =
        freshRun?.po_number ??
        (rpcResult as any)?.po_number ??
        null;

      setSelectedRun((prev: any) => ({
        ...prev,
        status: freshRun?.status ?? 'submitted',
        po_number: poNumber,
      }));
      setRuns(prev =>
        prev.map(r =>
          r.id === selectedRun.id
            ? { ...r, status: freshRun?.status ?? 'submitted', po_number: poNumber }
            : r
        )
      );

      if (isFirstSubmit) {
        toast.success(poNumber ? `Order submitted — ${poNumber} created` : 'Order submitted');
      } else {
        toast.success(poNumber ? `PO updated — ${poNumber}` : 'PO updated');
      }
    } catch (e: unknown) {
      toast.error(formatSmartOrderSubmitError(e));
    } finally {
      setSubmitting(false);
    }
  };

  const riskBadge = (currentStock?: number, parLevel?: number, options?: { minTouch?: boolean }) => {
    const riskInfo = getRisk(currentStock, parLevel, riskThresholds);
    const risk = riskInfo.level;
    const badgeClass = risk === "RED" ? "bg-destructive/10 text-destructive"
      : risk === "YELLOW" ? "bg-warning text-warning-foreground"
      : risk === "NO_PAR" ? "bg-muted/60 text-muted-foreground"
      : "bg-success text-success-foreground";
    const label = risk === "RED" ? "Critical" : risk === "YELLOW" ? "Low" : risk === "NO_PAR" ? "No PAR" : "OK";

    return (
      <Popover>
        <PopoverTrigger asChild>
          <button
            type="button"
            className={cn(
              "inline-flex rounded-md ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
              options?.minTouch && "min-h-11 min-w-11 items-center justify-center",
            )}
            aria-label={riskInfo.tooltip}
          >
            <Badge className={`${badgeClass} text-[10px] font-medium border-0`}>{label}</Badge>
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-64 p-3 text-xs" side="top" align="start">
          <p className="leading-snug text-popover-foreground">{riskInfo.tooltip}</p>
        </PopoverContent>
      </Popover>
    );
  };

  // Detail view
  if (selectedRun) {
    const canSeeCosts = perms.can_see_costs;
    const orderItems = runItems.filter(
      i => i.suggested_order > 0 && computeRiskLevel(i.current_stock, i.par_level, riskThresholds) !== "NO_PAR",
    );
    const greenItems = runItems.filter(
      i => computeRiskLevel(i.current_stock, i.par_level, riskThresholds) === "GREEN" && i.suggested_order <= 0,
    );
    const noParItems = runItems.filter(
      (i) => computeRiskLevel(i.current_stock, i.par_level, riskThresholds) === "NO_PAR",
    );
    const redCount = runItems.filter(
      (i) => computeRiskLevel(i.current_stock, i.par_level, riskThresholds) === "RED",
    ).length;
    const yellowCount = runItems.filter(
      (i) => computeRiskLevel(i.current_stock, i.par_level, riskThresholds) === "YELLOW",
    ).length;
    const lineEstCost = (item: Tables<"smart_order_run_items">) => {
      const { cost } = resolveDisplayCost(item, invoiceCostMap);
      return computeOrderDollars(item.suggested_order, cost).dollars;
    };

    type UomPair = { uom: string; inStock: number; toOrder: number };
    const uomBuckets = new Map<string, UomPair>();
    for (const i of orderItems) {
      const uom = getLineUom(i, catalogById, catalogLookup);
      if (!uomBuckets.has(uom)) uomBuckets.set(uom, { uom, inStock: 0, toOrder: 0 });
      const b = uomBuckets.get(uom)!;
      b.inStock += Number(i.current_stock);
      b.toOrder += Number(i.suggested_order);
    }
    const uomRows = [...uomBuckets.values()].sort((a, b) => b.toOrder - a.toOrder);
    const uomTop = uomRows.slice(0, 4);
    const uomRest = uomRows.length - uomTop.length;

    const selectedGuideName = selectedRun.par_guides?.name || null;

    // Build display list based on toggles
    const displayItems = [
      ...orderItems,
      ...(showGreen ? greenItems : []),
      ...(showNoPar ? noParItems : []),
    ];

    return (
      <div className="space-y-5 animate-fade-in">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="flex items-start gap-3 min-w-0">
            <Button variant="ghost" size="icon" className="min-h-11 min-w-11 shrink-0" onClick={() => { setSelectedRun(null); setRunItems([]); setInvoiceCostMap(new Map()); }}>
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <div className="min-w-0">
              <h1 className="text-2xl font-bold tracking-tight">Smart Order Detail</h1>
              <p className="text-sm text-muted-foreground">
                {selectedRun.inventory_sessions?.name || "Count session"}
                {" · "}
                List: {selectedRun.inventory_lists?.name || "—"}
                {" · "}
                {new Date(selectedRun.created_at).toLocaleDateString()}
              </p>
              {selectedGuideName && (
                <p className="text-xs text-muted-foreground">
                  Based on PAR guide: <span className="font-medium text-foreground">{selectedGuideName}</span>
                </p>
              )}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2 lg:justify-end">
            {selectedRun.status === 'submitted' && (
              <Badge className="bg-primary/10 text-primary border-0 text-[11px]">
                {selectedRun.po_number ? selectedRun.po_number : 'Submitted'}
              </Badge>
            )}
            <ExportButtons
              items={displayItems.map(i => ({ ...i, suggestedOrder: i.suggested_order, pack_size: i.pack_size }))}
              filename="smart-order"
              type="smartorder"
              vendorName={(() => {
                const first = runItems.find(i => i.catalog_item_id ? catalogById[i.catalog_item_id]?.vendor_name : null);
                return (first?.catalog_item_id ? catalogById[first.catalog_item_id]?.vendor_name : null) ?? undefined;
              })()}
              restaurantName={currentRestaurant?.name ?? undefined}
              totalEstCost={smartOrderDetailMetrics.totalEstCost}
              meta={{
                listName: selectedRun.inventory_lists?.name ?? undefined,
                sessionName: selectedRun.inventory_sessions?.name ?? undefined,
                date: new Date().toLocaleDateString(),
              }}
            />
            <Button
              size="sm"
              variant={selectedRun.status === 'submitted' ? 'outline' : 'default'}
              className={`gap-1.5 min-h-10 ${selectedRun.status !== "submitted" ? "bg-gradient-orange text-white shadow-orange hover:opacity-90" : ""}`}
              disabled={
                submitting ||
                vendorSubmitAnalysis.blocked ||
                !perms.can_approve_orders ||
                smartOrderDetailMetrics.thresholdExceeded
              }
              onClick={handleSubmitOrder}
            >
              <ShoppingCart className="h-3.5 w-3.5" />
              {submitting ? 'Submitting…' : selectedRun.status === 'submitted' ? 'Update PO' : 'Submit Order'}
            </Button>
            <Button variant="outline" size="sm" className="gap-1.5 min-h-10" onClick={() => navigate("/app/purchase-history")}>
              <ExternalLink className="h-3.5 w-3.5" /> View orders & receipts
            </Button>
          </div>
        </div>
        {!perms.can_approve_orders ? (
          <p className="text-sm text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900/50 rounded-lg px-3 py-2">
            Requires owner approval to submit
          </p>
        ) : null}
        {smartOrderDetailMetrics.thresholdExceeded && perms.order_approval_threshold != null ? (
          <p className="text-sm text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900/50 rounded-lg px-3 py-2">
            This order total ({formatCurrency(smartOrderDetailMetrics.totalEstCost)}) exceeds your approval limit (
            {formatCurrency(perms.order_approval_threshold)}). Owner approval required.
          </p>
        ) : null}

        {!selectedRun.par_guide_id && (
          <Card className="border-warning/30 bg-warning/5">
            <CardContent className="flex items-start gap-3 p-4">
              <AlertTriangle className="h-5 w-5 text-warning shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-medium text-warning">
                  No PAR guide was linked to this count — order quantities may be inaccurate.
                </p>
                <p className="text-xs text-warning mt-1">
                  Link a PAR guide in PAR Management and run a new count for accurate suggestions.
                </p>
              </div>
            </CardContent>
          </Card>
        )}

        {vendorSubmitAnalysis.blocked && vendorSubmitAnalysis.reason === "multi_vendor" && (
          <Card className="border-destructive/30 bg-destructive/5">
            <CardContent className="flex items-start gap-3 p-4">
              <AlertTriangle className="h-5 w-5 text-destructive shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-medium text-destructive leading-snug">
                  {MULTI_VENDOR_SUBMIT_MESSAGE}
                </p>
                <p className="text-xs text-muted-foreground mt-1.5 leading-snug">
                  {MULTI_VENDOR_TIP}
                </p>
              </div>
            </CardContent>
          </Card>
        )}
        {vendorSubmitAnalysis.blocked && vendorSubmitAnalysis.reason === "no_vendor" && (
          <Card className="border-destructive/30 bg-destructive/5">
            <CardContent className="flex items-start gap-3 p-4">
              <AlertTriangle className="h-5 w-5 text-destructive shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-medium text-destructive">
                  Cannot submit — no vendor on catalog for this list
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  {vendorSubmitAnalysis.listLevelOnly
                    ? "Add vendor names to catalog items on this list in List Management, then submit again."
                    : `${vendorSubmitAnalysis.problemLineCount} order line${vendorSubmitAnalysis.problemLineCount === 1 ? "" : "s"} cannot resolve a PO vendor. Add vendor names in List Management, then submit again.`}
                </p>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Sticky Summary Bar */}
        <div className="sticky top-0 z-10 bg-background/95 backdrop-blur-sm -mx-4 px-4 py-3 border-b border-border/40">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            <Card className="border-destructive/15">
              <CardContent className="flex items-center gap-3 p-3">
                <AlertTriangle className="h-5 w-5 text-destructive" />
                <div>
                  <p className="stat-value text-lg">{redCount}</p>
                  <p className="text-[10px] text-muted-foreground">Critical</p>
                </div>
              </CardContent>
            </Card>
            <Card className="border-warning/15">
              <CardContent className="flex items-center gap-3 p-3">
                <AlertTriangle className="h-5 w-5 text-warning" />
                <div>
                  <p className="stat-value text-lg">{yellowCount}</p>
                  <p className="text-[10px] text-muted-foreground">Warning</p>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="flex items-center gap-3 p-3">
                <ShoppingCart className="h-5 w-5 text-primary" />
                <div>
                  <p className="stat-value text-lg">{orderItems.length}</p>
                  <p className="text-[10px] text-muted-foreground">Items to order</p>
                  <p className="text-[9px] text-muted-foreground/80 leading-tight mt-0.5">Need restocking based on PAR</p>
                </div>
              </CardContent>
            </Card>
            <Card className="border-primary/20">
              <CardContent className="p-3">
                <p className="text-[10px] text-muted-foreground font-medium mb-2">In stock vs to order (by UOM)</p>
                <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-[11px]">
                  <div className="text-muted-foreground font-medium">In stock</div>
                  <div className="text-muted-foreground font-medium">To order</div>
                  {uomTop.map((row) => (
                    <Fragment key={row.uom}>
                      <div className="font-mono tabular-nums text-foreground">
                        {formatNum(row.inStock)} {row.uom}
                      </div>
                      <div className="font-mono tabular-nums text-foreground">
                        {formatNum(row.toOrder)} {row.uom}
                      </div>
                    </Fragment>
                  ))}
                </div>
                {uomRest > 0 && (
                  <p className="text-[9px] text-muted-foreground mt-1.5">+ {uomRest} more</p>
                )}
              </CardContent>
            </Card>
            <Card className="border-primary/15">
              <CardContent className="flex items-start gap-3 p-3">
                <DollarSign className="h-5 w-5 text-primary shrink-0" />
                <div className="min-w-0">
                  <p className="stat-value text-lg">
                    {canSeeCosts ? formatCurrency(smartOrderDetailMetrics.totalEstCost) : "—"}
                  </p>
                  <p className="text-[10px] text-muted-foreground">Est. order cost</p>
                  {smartOrderDetailMetrics.orderItemsCosted === smartOrderDetailMetrics.orderItemsLen ? (
                    <p className="text-[9px] text-muted-foreground/80 mt-0.5">
                      All {smartOrderDetailMetrics.orderItemsLen} items costed
                    </p>
                  ) : (
                    <p className="text-[9px] text-amber-600 mt-0.5">
                      {smartOrderDetailMetrics.orderItemsCosted} of {smartOrderDetailMetrics.orderItemsLen} items
                      costed — may be understated
                    </p>
                  )}
                </div>
              </CardContent>
            </Card>
          </div>
          <p className="text-[11px] text-muted-foreground leading-snug px-1 pt-2 max-w-4xl">
            {STOCK_TRUTH_MESSAGE}
          </p>
        </div>

        {/* Toggles */}
        <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
          <div className="flex items-center gap-2 min-h-10">
            <Switch id="show-green" checked={showGreen} onCheckedChange={toggleShowGreen} />
            <Label htmlFor="show-green" className="text-xs text-muted-foreground">Show OK items</Label>
          </div>
          <div className="flex items-center gap-2 min-h-10">
            <Switch id="show-nopar" checked={showNoPar} onCheckedChange={toggleShowNoPar} />
            <Label htmlFor="show-nopar" className="text-xs text-muted-foreground">Show Missing PAR</Label>
          </div>
          {noParItems.length > 0 && (
            <Badge variant="outline" className="text-[10px] gap-1">
              <Info className="h-3 w-3" /> {noParItems.length} items missing PAR
            </Badge>
          )}
        </div>

        <div className="w-full min-w-0 max-w-full">
          <div className="w-full min-w-0 max-w-full overflow-x-hidden lg:hidden">
            <div className="animate-fade-in">
              <SmartOrderRunItemCards
                items={displayItems}
                catalogById={catalogById}
                catalogLookup={catalogLookup}
                lastOrderDates={lastOrderDates}
                riskBadge={riskBadge}
                editingRunItem={editingRunItem}
                setEditingRunItem={setEditingRunItem}
                editRunValues={editRunValues}
                setEditRunValues={setEditRunValues}
                setRunItems={setRunItems}
                lineEstCost={canSeeCosts ? lineEstCost : () => 0}
                getLineUom={(i) => getLineUom(i, catalogById, catalogLookup)}
                getUnitCostDisplay={(i) =>
                  canSeeCosts ? resolveDisplayCost(i, invoiceCostMap) : { cost: null, source: "none" as const }
                }
              />
            </div>
          </div>
          <Card className="max-lg:hidden overflow-hidden">
            <Table>
                <TableHeader>
                <TableRow className="bg-muted/30">
                  <TableHead className="text-xs font-semibold">Risk</TableHead>
                  <TableHead className="text-xs font-semibold">Item</TableHead>
                  <TableHead className="text-xs font-semibold">Product #</TableHead>
                  <TableHead className="text-xs font-semibold">Pack Size</TableHead>
                  <TableHead className="text-xs font-semibold">Last Ordered</TableHead>
                  <TableHead className="text-xs font-semibold">In Stock</TableHead>
                  <TableHead className="text-xs font-semibold">
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger className="flex items-center gap-1">
                          PAR <Info className="h-3 w-3 text-muted-foreground" /> <Pencil className="h-3 w-3 text-muted-foreground/40" />
                        </TooltipTrigger>
                        <TooltipContent><p className="text-xs max-w-xs">Target stock level. Click a value to edit.</p></TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  </TableHead>
                  <TableHead className="text-xs font-semibold">Unit Cost</TableHead>
                   <TableHead className="text-xs font-semibold">
                     <TooltipProvider>
                       <Tooltip>
                         <TooltipTrigger className="flex items-center gap-1">
                           Order Qty <Info className="h-3 w-3 text-muted-foreground" />
                         </TooltipTrigger>
                         <TooltipContent><p className="text-xs max-w-xs">Full-case rounding is applied. Case items always order in whole cases.</p></TooltipContent>
                       </Tooltip>
                     </TooltipProvider>
                   </TableHead>
                   <TableHead className="text-xs font-semibold">
                     <span className="flex items-center gap-1">Est. Cost <Pencil className="h-3 w-3 text-muted-foreground/40" /></span>
                   </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {displayItems.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={10} className="text-center py-8 px-4 text-sm text-muted-foreground max-w-prose mx-auto">
                      <p>No lines match the current view.</p>
                      <p className="mt-2 text-xs text-muted-foreground/90">
                        Try turning on <span className="font-medium text-foreground">Show OK items</span> or{" "}
                        <span className="font-medium text-foreground">Show Missing PAR</span> above, or check that this run has lines with suggested order quantities.
                      </p>
                    </TableCell>
                  </TableRow>
                ) : displayItems.map(i => (
                  <TableRow key={i.id} className="hover:bg-muted/30 transition-colors">
                    <TableCell>{riskBadge(i.current_stock, i.par_level)}</TableCell>
                    <TableCell>
                      <span className="font-medium text-sm">{i.item_name}</span>
                      <ItemIdentityBlock
                        brandName={i.brand_name}
                        className="block mt-0.5"
                      />
                    </TableCell>
                    <TableCell className="text-xs font-mono text-muted-foreground/60">
                      {(() => {
                        const ci = i.catalog_item_id ? catalogById[i.catalog_item_id] : catalogLookup[normalizeItemName(i.item_name)];
                        return ci?.product_number || ci?.vendor_sku || "—";
                      })()}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">{i.pack_size || "—"}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {(() => {
                        const catalogItem = i.catalog_item_id ? catalogById[i.catalog_item_id] : catalogLookup[normalizeItemName(i.item_name)];
                        const d = catalogItem?.id ? lastOrderDates[catalogItem.id] : null;
                        return d ? format(new Date(d), "MM/dd/yy") : "—";
                      })()}
                    </TableCell>
                    <TableCell className="font-mono text-sm">{formatNum(i.current_stock)}</TableCell>
                    <TableCell className="font-mono text-sm text-muted-foreground">
                      {editingRunItem === `${i.id}_par` ? (
                        <Input
                          autoFocus
                          type="number"
                          inputMode="decimal"
                          min={0}
                          step={0.1}
                          className="w-20 h-10 min-h-10 text-sm font-mono text-right [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                          value={editRunValues.par_level}
                          onFocus={e => e.target.select()}
                          onChange={e => setEditRunValues(prev => ({ ...prev, par_level: e.target.value }))}
                          onBlur={async () => {
                            const parsed = Math.max(0, parseFloat(editRunValues.par_level) || 0);
                            // current_stock and parsed PAR are in CASES — use canonical engine
                            const newSuggested = computeOrderQtyCases(i.current_stock, parsed);
                            setRunItems(prev => prev.map(r =>
                              r.id === i.id ? { ...r, par_level: parsed, suggested_order: newSuggested } : r
                            ));
                            const { error } = await supabase.from("smart_order_run_items")
                              .update({ par_level: parsed, suggested_order: newSuggested })
                              .eq("id", i.id);
                            if (error) toast.error("Could not save PAR — check your connection and try again.");
                            setEditingRunItem(null);
                          }}
                          onKeyDown={e => { if (e.key === "Escape") setEditingRunItem(null); if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
                        />
                      ) : (
                        <button
                          className="font-mono text-sm text-muted-foreground hover:text-foreground hover:underline decoration-dashed underline-offset-2 cursor-pointer"
                          onClick={() => { setEditingRunItem(`${i.id}_par`); setEditRunValues({ par_level: String(i.par_level ?? ""), unit_cost: String(i.unit_cost ?? "") }); }}
                          title="Click to edit PAR"
                        >
                          {formatNum(i.par_level)}
                        </button>
                      )}
                    </TableCell>
                    <TableCell className="font-mono text-sm text-muted-foreground">
                      {(() => {
                        if (!canSeeCosts) {
                          return <span className="text-muted-foreground">—</span>;
                        }
                        const { cost, source } = resolveDisplayCost(i, invoiceCostMap);
                        const uom = getLineUom(i, catalogById, catalogLookup);
                        if (cost == null) {
                          return <span className="text-muted-foreground">—</span>;
                        }
                        return (
                          <span className={source === "count" ? "text-amber-600" : ""}>
                            {formatCurrency(cost)}/{uom}
                            {source === "count" && (
                              <span
                                className="ml-0.5 text-[10px] text-amber-500 cursor-help"
                                title="Based on catalog default — no recent invoice found"
                              >
                                †
                              </span>
                            )}
                          </span>
                        );
                      })()}
                    </TableCell>
                    <TableCell className="font-mono text-sm font-bold">
                      {editingRunItem === `${i.id}_qty` ? (
                        <Input
                          autoFocus
                          type="number"
                          inputMode="decimal"
                          min={0}
                          step={1}
                          className="w-20 h-10 min-h-10 text-sm font-mono text-right font-bold [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                          value={editRunValues.par_level}
                          onFocus={e => e.target.select()}
                          onChange={e => setEditRunValues(prev => ({ ...prev, par_level: e.target.value }))}
                          onBlur={async () => {
                            const parsed = Math.max(0, parseFloat(editRunValues.par_level) || 0);
                            setRunItems(prev => prev.map(r =>
                              r.id === i.id ? { ...r, suggested_order: parsed } : r
                            ));
                            const { error } = await supabase.from("smart_order_run_items")
                              .update({ suggested_order: parsed })
                              .eq("id", i.id);
                            if (error) toast.error("Could not save order qty — check your connection and try again.");
                            setEditingRunItem(null);
                          }}
                          onKeyDown={e => { if (e.key === "Escape") setEditingRunItem(null); if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
                        />
                      ) : (
                        <button
                          className="font-mono text-sm font-bold hover:underline decoration-dashed underline-offset-2 cursor-pointer"
                          onClick={() => {
                            setEditingRunItem(`${i.id}_qty`);
                            setEditRunValues({ par_level: String(i.suggested_order > 0 ? i.suggested_order : ""), unit_cost: String(i.unit_cost ?? "") });
                          }}
                          title="Click to override order quantity"
                        >
                          {i.suggested_order > 0 ? formatNum(i.suggested_order) : "—"}
                        </button>
                      )}
                    </TableCell>
                    <TableCell className="font-mono text-sm">
                      {!canSeeCosts ? (
                        <span className="text-muted-foreground">—</span>
                      ) : editingRunItem === `${i.id}_cost` ? (
                        <Input
                          autoFocus
                          type="number"
                          inputMode="decimal"
                          min={0}
                          step={0.01}
                          className="w-24 h-10 min-h-10 text-sm font-mono text-right [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                          value={editRunValues.unit_cost}
                          placeholder="Unit price"
                          onFocus={e => e.target.select()}
                          onChange={e => setEditRunValues(prev => ({ ...prev, unit_cost: e.target.value }))}
                          onBlur={async () => {
                            const rawCost = parseFloat(editRunValues.unit_cost);
                            const parsed = Number.isFinite(rawCost) && rawCost >= 0 ? rawCost : null;
                            setRunItems(prev => prev.map(r => r.id === i.id ? { ...r, unit_cost: parsed } : r));
                            const { error } = await supabase.from("smart_order_run_items").update({ unit_cost: parsed }).eq("id", i.id);
                            if (error) toast.error("Could not save unit cost — check your connection and try again.");
                            setEditingRunItem(null);
                          }}
                          onKeyDown={e => { if (e.key === "Escape") setEditingRunItem(null); if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
                        />
                      ) : (
                        <button
                          className="font-mono text-sm hover:underline decoration-dashed underline-offset-2 cursor-pointer"
                          onClick={() => { setEditingRunItem(`${i.id}_cost`); setEditRunValues({ par_level: String(i.par_level ?? ""), unit_cost: String(i.unit_cost ?? "") }); }}
                          title="Click to edit unit price"
                        >
                          {resolveDisplayCost(i, invoiceCostMap).source === "none" ? (
                            <span className="text-muted-foreground">—</span>
                          ) : (
                            formatCurrency(lineEstCost(i))
                          )}
                        </button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
        </div>
      </div>
    );
  }

  // ─── LIST VIEW ────────────────────────
  return (
    <div className="space-y-5 animate-fade-in">
      <div className="page-header">
        <div>
          <h1 className="page-title">Smart Orders</h1>
          <p className="page-description">View and manage your saved smart order runs</p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <Select value={dateFilter} onValueChange={setDateFilter}>
          <SelectTrigger className="h-10 min-h-10 w-40 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="7">Last 7 days</SelectItem>
            <SelectItem value="30">Last 30 days</SelectItem>
            <SelectItem value="90">Last 90 days</SelectItem>
            <SelectItem value="365">Last year</SelectItem>
          </SelectContent>
        </Select>
        <Select value={listFilter} onValueChange={setListFilter}>
          <SelectTrigger className="h-10 min-h-10 w-48 text-xs"><SelectValue placeholder="All lists" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All lists</SelectItem>
            {lists.map(l => <SelectItem key={l.id} value={l.id}>{l.name}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3].map(i => <Skeleton key={i} className="h-16 rounded-xl" />)}
        </div>
      ) : runs.length === 0 ? (
        <SmartOrderEmptyState />
      ) : (
        <Card className="overflow-hidden border shadow-sm">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/30">
                <TableHead className="text-xs font-semibold">Date</TableHead>
                <TableHead className="text-xs font-semibold">Count session</TableHead>
                <TableHead className="text-xs font-semibold">Location</TableHead>
                <TableHead className="text-xs font-semibold">List</TableHead>
                <TableHead className="text-xs font-semibold">PAR Guide</TableHead>
                <TableHead className="text-xs font-semibold text-right">Items</TableHead>
                <TableHead className="text-xs font-semibold w-28">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {runs.map(run => (
                <TableRow key={run.id} className="hover:bg-muted/20 transition-colors cursor-pointer" onClick={() => openRunDetail(run)}>
                  <TableCell className="text-xs text-muted-foreground">{new Date(run.created_at).toLocaleDateString()}</TableCell>
                  <TableCell className="text-sm font-medium">
                    <div>{run.inventory_sessions?.name || "—"}</div>
                    {run.inventory_sessions?.approved_at && (
                      <div className="text-[10px] text-muted-foreground font-normal tabular-nums">
                        Approved {new Date(run.inventory_sessions.approved_at).toLocaleDateString()}
                      </div>
                    )}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {run.location_id
                      ? (locations.find(l => l.id === run.location_id)?.name ?? "—")
                      : "—"}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">{run.inventory_lists?.name || "—"}</TableCell>
                  <TableCell className="text-xs">
                    {run.par_guides?.name || (
                      run.par_guide_id
                        ? "—"
                        : <span className="text-warning">No linked PAR guide</span>
                    )}
                  </TableCell>
                  <TableCell className="text-xs font-mono text-right">{run.smart_order_run_items?.length || 0}</TableCell>
                  <TableCell onClick={(e) => e.stopPropagation()}>
                    <div className="flex flex-wrap items-center gap-1">
                      <Button size="sm" variant="outline" className="min-h-10 h-10 text-xs px-3" onClick={() => openRunDetail(run)}>
                        <Eye className="h-3.5 w-3.5 mr-1.5" /> View
                      </Button>
                      <Button size="icon" variant="ghost" className="min-h-10 min-w-10 h-10 w-10 text-muted-foreground hover:text-destructive" aria-label="Delete smart order" onClick={() => setDeleteRunId(run.id)}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}

      {/* Delete confirmation */}
      <AlertDialog open={!!deleteRunId} onOpenChange={(o) => !o && setDeleteRunId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete smart order?</AlertDialogTitle>
            <AlertDialogDescription>This will permanently delete this smart order run and any linked PO or receipt records. This cannot be undone.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteRunId && handleDeleteRun(deleteRunId)}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
