import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useRestaurant } from "@/contexts/RestaurantContext";
import { fetchInvoiceDocumentIdsForRestaurant } from "@/lib/procurement-dedupe";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList,
  BreadcrumbPage, BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Receipt, DollarSign, Search, Menu, ChevronDown, Check,
  LayoutList, Clock, Package as PackageIcon, Eye, ShoppingCart,
  AlertTriangle, ClipboardCheck, FileText, Link2,
} from "lucide-react";

type ViewMode = "all" | "by-list" | "by-date";
type SourceTab = "all" | "orders" | "invoices";

type RowKind = "purchase_order" | "invoice" | "legacy_ph";

/** One row in the list: real PO, real invoice, or legacy purchase_history only. */
type UnifiedProcurementRow = {
  id: string;
  rowKind: RowKind;
  created_at: string;
  vendor_name: string | null;
  po_number: string | null;
  inventory_lists: { name: string } | null;
  receipt_status: string | null;
  invoice_status: string | null;
  workflow_status: string | null;
  smart_order_run_id: string | null;
  legacy_source: string | null;
  po_workflow_status: string | null;
};

function listFromPoJoin(po: any): { name: string } | null {
  if (!po) return null;
  const il = po.inventory_lists;
  if (!il) return null;
  const row = Array.isArray(il) ? il[0] : il;
  return row?.name ? { name: row.name } : null;
}

function unifyPO(po: any): UnifiedProcurementRow {
  return {
    id: po.id,
    rowKind: "purchase_order",
    created_at: po.created_at,
    vendor_name: po.vendor_name,
    po_number: po.po_number,
    inventory_lists: listFromPoJoin(po),
    receipt_status: null,
    invoice_status: null,
    workflow_status: null,
    smart_order_run_id: po.smart_order_run_id,
    legacy_source: "smart_order",
    po_workflow_status: po.status,
  };
}

function unifyInvoice(inv: any): UnifiedProcurementRow {
  const rawPo = inv.purchase_orders;
  const po = Array.isArray(rawPo) ? rawPo[0] : rawPo;
  return {
    id: inv.id,
    rowKind: "invoice",
    created_at: inv.created_at,
    vendor_name: inv.vendor_name,
    po_number: po?.po_number ?? null,
    inventory_lists: listFromPoJoin(po),
    receipt_status: inv.receipt_status,
    invoice_status: null,
    workflow_status: inv.status,
    smart_order_run_id: po?.smart_order_run_id ?? null,
    legacy_source: po ? "smart_order" : "invoice_upload",
    po_workflow_status: null,
  };
}

function unifyLegacyPh(p: any): UnifiedProcurementRow {
  return {
    id: p.id,
    rowKind: "legacy_ph",
    created_at: p.created_at,
    vendor_name: p.vendor_name,
    po_number: p.po_number,
    inventory_lists: p.inventory_lists ?? null,
    receipt_status: p.receipt_status,
    invoice_status: p.invoice_status,
    workflow_status: null,
    smart_order_run_id: p.smart_order_run_id,
    legacy_source: p.source,
    po_workflow_status: null,
  };
}

function isOrderRow(p: UnifiedProcurementRow) {
  return p.rowKind === "purchase_order" || (p.rowKind === "legacy_ph" && p.legacy_source === "smart_order");
}

export default function PurchaseHistoryPage() {
  const { currentRestaurant, currentLocation } = useRestaurant();
  const navigate = useNavigate();
  const [purchases, setPurchases] = useState<UnifiedProcurementRow[]>([]);
  const [lineItemsByRow, setLineItemsByRow] = useState<Record<string, any[]>>({});
  const [issuesByRow, setIssuesByRow] = useState<Record<string, any[]>>({});
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [viewMode, setViewMode] = useState<ViewMode>("all");
  const [sourceTab, setSourceTab] = useState<SourceTab>("all");
  const [expandedId, setExpandedId] = useState<string | null>(null);

  /**
   * Previously: loaded only `purchase_history` and nested `purchase_history_items` / `delivery_issues`.
   * Now: loads `purchase_orders`, `invoices` (with optional PO join), and `purchase_history` rows whose
   * id is not in `invoices` (unmigrated legacy). Line items come from `purchase_order_items`, `invoice_items`,
   * or `purchase_history_items` respectively. IDs stay stable so `/app/invoices/:id/review` works for
   * both migrated and new invoice documents.
   */
  useEffect(() => {
    if (!currentRestaurant) return;
    let cancelled = false;
    setLoading(true);

    (async () => {
      const rid = currentRestaurant.id;
      const invoiceDocIds = await fetchInvoiceDocumentIdsForRestaurant(rid);

      const locId = currentLocation?.id;
      const [poRes, invRes, phRes] = await Promise.all([
        (locId
          ? supabase.from("purchase_orders").select("*, inventory_lists(name)").eq("restaurant_id", rid).eq("location_id", locId)
          : supabase.from("purchase_orders").select("*, inventory_lists(name)").eq("restaurant_id", rid)
        ).order("created_at", { ascending: false }),
        (locId
          ? supabase.from("invoices").select("*, purchase_orders(po_number, smart_order_run_id, id, status, inventory_lists(name))").eq("restaurant_id", rid).eq("location_id", locId)
          : supabase.from("invoices").select("*, purchase_orders(po_number, smart_order_run_id, id, status, inventory_lists(name))").eq("restaurant_id", rid)
        ).order("created_at", { ascending: false }),
        (locId
          ? supabase.from("purchase_history").select("*, inventory_lists(name), source, smart_order_run_id, po_number, receipt_status, invoice_status").eq("restaurant_id", rid).eq("location_id", locId)
          : supabase.from("purchase_history").select("*, inventory_lists(name), source, smart_order_run_id, po_number, receipt_status, invoice_status").eq("restaurant_id", rid)
        ).order("created_at", { ascending: false }),
      ]);

      if (cancelled) return;

      const legacyPh = (phRes.data ?? []).filter((p) => !invoiceDocIds.has(p.id));

      const unified: UnifiedProcurementRow[] = [
        ...(poRes.data ?? []).map(unifyPO),
        ...(invRes.data ?? []).map(unifyInvoice),
        ...legacyPh.map(unifyLegacyPh),
      ].sort(
        (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
      );

      setPurchases(unified);

      const itemMap: Record<string, any[]> = {};
      const issueMap: Record<string, any[]> = {};

      const poIds = unified.filter((u) => u.rowKind === "purchase_order").map((u) => u.id);
      if (poIds.length > 0) {
        const { data } = await supabase
          .from("purchase_order_items")
          .select("*")
          .in("purchase_order_id", poIds);
        for (const row of data ?? []) {
          const pid = row.purchase_order_id as string;
          if (!itemMap[pid]) itemMap[pid] = [];
          itemMap[pid].push(row);
        }
      }

      const invIds = unified.filter((u) => u.rowKind === "invoice").map((u) => u.id);
      if (invIds.length > 0) {
        const [{ data: invItems }, { data: invIssues }] = await Promise.all([
          supabase.from("invoice_items").select("*").in("invoice_id", invIds),
          supabase.from("delivery_issues").select("*").in("invoice_id", invIds),
        ]);
        for (const row of invItems ?? []) {
          const iid = row.invoice_id as string;
          if (!itemMap[iid]) itemMap[iid] = [];
          itemMap[iid].push(row);
        }
        for (const row of invIssues ?? []) {
          const iid = row.invoice_id as string | null;
          if (!iid) continue;
          if (!issueMap[iid]) issueMap[iid] = [];
          issueMap[iid].push(row);
        }
      }

      const legIds = unified.filter((u) => u.rowKind === "legacy_ph").map((u) => u.id);
      if (legIds.length > 0) {
        const [{ data: phi }, { data: dis }] = await Promise.all([
          supabase.from("purchase_history_items").select("*").in("purchase_history_id", legIds),
          supabase.from("delivery_issues").select("*").in("purchase_history_id", legIds),
        ]);
        for (const row of phi ?? []) {
          const pid = row.purchase_history_id as string;
          if (!itemMap[pid]) itemMap[pid] = [];
          itemMap[pid].push(row);
        }
        for (const row of dis ?? []) {
          const pid = row.purchase_history_id as string | null;
          if (!pid) continue;
          if (!issueMap[pid]) issueMap[pid] = [];
          issueMap[pid].push(row);
        }
      }

      if (!cancelled) {
        setLineItemsByRow(itemMap);
        setIssuesByRow(issueMap);
        setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [currentRestaurant, currentLocation]);

  const totalCost = (items: any[]) =>
    items.reduce((sum, i) => sum + (Number(i.total_cost) || 0), 0);

  const sourceFiltered = purchases.filter((p) => {
    const order = isOrderRow(p);
    if (sourceTab === "orders") return order;
    if (sourceTab === "invoices") return !order;
    return true;
  });

  const filteredPurchases = sourceFiltered.filter((p) => {
    if (!search) return true;
    const lower = search.toLowerCase();
    const listName = (p.inventory_lists?.name || "").toLowerCase();
    const vendor = (p.vendor_name || "").toLowerCase();
    const po = (p.po_number || "").toLowerCase();
    const items = lineItemsByRow[p.id] || [];
    const hasItem = items.some((i: any) => (i.item_name || "").toLowerCase().includes(lower));
    return listName.includes(lower) || vendor.includes(lower) || po.includes(lower) || hasItem;
  });

  const getGrouped = (): Record<string, UnifiedProcurementRow[]> => {
    if (viewMode === "by-list") {
      const groups: Record<string, UnifiedProcurementRow[]> = {};
      filteredPurchases.forEach((p) => {
        const key = p.inventory_lists?.name || p.vendor_name || "Unknown";
        if (!groups[key]) groups[key] = [];
        groups[key].push(p);
      });
      return Object.keys(groups).length ? groups : { All: filteredPurchases };
    }
    if (viewMode === "by-date") {
      const groups: Record<string, UnifiedProcurementRow[]> = {};
      filteredPurchases.forEach((p) => {
        const key = new Date(p.created_at).toLocaleDateString();
        if (!groups[key]) groups[key] = [];
        groups[key].push(p);
      });
      return Object.keys(groups).length ? groups : { All: filteredPurchases };
    }
    return { All: filteredPurchases };
  };

  const grouped = getGrouped();

  const viewModeLabel: Record<ViewMode, string> = {
    all: "All",
    "by-list": "Group by List",
    "by-date": "Group by Date",
  };

  const orderStatusBadge = (p: UnifiedProcurementRow) => {
    if (p.rowKind === "purchase_order" && p.po_workflow_status) {
      const s = p.po_workflow_status;
      if (s === "closed") {
        return <Badge className="bg-success/10 text-success border-0 text-[10px]">Closed</Badge>;
      }
      if (s === "partially_received") {
        return <Badge className="bg-warning/10 text-warning border-0 text-[10px]">Partially received</Badge>;
      }
      if (s === "cancelled") {
        return <Badge className="bg-muted/60 text-muted-foreground border-0 text-[10px]">Cancelled</Badge>;
      }
      if (s === "submitted") {
        return <Badge className="bg-blue-100 text-blue-800 border-0 text-[10px] dark:bg-blue-950/40 dark:text-blue-300">Submitted</Badge>;
      }
      if (s === "draft") {
        return <Badge className="bg-muted/60 text-muted-foreground border-0 text-[10px]">Draft</Badge>;
      }
    }
    if (p.rowKind === "legacy_ph" && p.legacy_source === "smart_order") {
      if (p.receipt_status === "confirmed") {
        return <Badge className="bg-success/10 text-success border-0 text-[10px]">Fully Received</Badge>;
      }
      if (p.receipt_status === "issues_reported") {
        return <Badge className="bg-orange-500/10 text-orange-600 border-0 text-[10px]">Issues Reported</Badge>;
      }
      if (p.invoice_status === "RECEIVED" || p.invoice_status === "COMPLETE") {
        return <Badge className="bg-muted/60 text-muted-foreground border-0 text-[10px]">Submitted</Badge>;
      }
    }
    return null;
  };

  const invoiceStatusBadge = (p: UnifiedProcurementRow) => {
    if (p.rowKind === "invoice" && p.workflow_status) {
      const s = p.workflow_status;
      if (s === "confirmed") {
        return <Badge className="bg-success/10 text-success border-0 text-[10px]">Posted ✓</Badge>;
      }
      if (s === "ready_to_receive") {
        return <Badge className="bg-primary/10 text-primary border-0 text-[10px]">Ready to receive</Badge>;
      }
      if (s === "review") {
        return <Badge className="bg-warning/10 text-warning border-0 text-[10px]">In review</Badge>;
      }
      if (s === "draft") {
        return <Badge className="bg-muted/60 text-muted-foreground border-0 text-[10px]">Draft</Badge>;
      }
    }
    const status = p.invoice_status;
    if (status === "COMPLETE") {
      return <Badge className="bg-success/10 text-success border-0 text-[10px]">Posted ✓</Badge>;
    }
    if (status === "RECEIVED") {
      return <Badge className="bg-warning/10 text-warning border-0 text-[10px]">Pending Review</Badge>;
    }
    if (status === "DRAFT") {
      return <Badge className="bg-muted/60 text-muted-foreground border-0 text-[10px]">Draft</Badge>;
    }
    return null;
  };

  const showReviewButton = (p: UnifiedProcurementRow) => {
    if (isOrderRow(p)) return false;
    if (p.rowKind === "invoice") {
      return !(p.workflow_status === "confirmed" && p.receipt_status === "confirmed");
    }
    if (p.invoice_status === "COMPLETE") return false;
    return (
      p.invoice_status === "RECEIVED"
      || p.receipt_status === "pending"
      || p.receipt_status === "reviewing"
    );
  };

  if (!currentRestaurant) {
    return (
      <div className="empty-state">
        <PackageIcon className="empty-state-icon" />
        <p className="empty-state-title">Select a restaurant to view purchase history</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="space-y-6 animate-fade-in">
        <Skeleton className="h-6 w-48" />
        <Skeleton className="h-10 w-64" />
        <div className="space-y-3">
          {[1, 2, 3].map((i) => <Skeleton key={i} className="h-20 rounded-xl" />)}
        </div>
      </div>
    );
  }

  const ordersCount = purchases.filter((p) => isOrderRow(p)).length;
  const invoicesCount = purchases.filter((p) => !isOrderRow(p)).length;

  return (
    <div className="space-y-5 animate-fade-in">
      <Breadcrumb>
        <BreadcrumbList>
          <BreadcrumbItem><BreadcrumbLink href="/app/dashboard">Home</BreadcrumbLink></BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem><BreadcrumbPage>Purchase History</BreadcrumbPage></BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>

      <div className="page-header">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Purchase History</h1>
          <p className="text-sm text-muted-foreground">Track purchase orders and received invoices</p>
        </div>
      </div>

      <Tabs value={sourceTab} onValueChange={(v) => setSourceTab(v as SourceTab)}>
        <TabsList className="h-9">
          <TabsTrigger value="all" className="text-xs gap-1.5">
            All
            <Badge variant="secondary" className="text-[10px] h-4 px-1.5">{purchases.length}</Badge>
          </TabsTrigger>
          <TabsTrigger value="orders" className="text-xs gap-1.5">
            <ShoppingCart className="h-3 w-3" /> Orders
            <Badge variant="secondary" className="text-[10px] h-4 px-1.5">{ordersCount}</Badge>
          </TabsTrigger>
          <TabsTrigger value="invoices" className="text-xs gap-1.5">
            <FileText className="h-3 w-3" /> Invoices
            <Badge variant="secondary" className="text-[10px] h-4 px-1.5">{invoicesCount}</Badge>
          </TabsTrigger>
        </TabsList>

        {(["all", "orders", "invoices"] as SourceTab[]).map((tab) => (
          <TabsContent key={tab} value={tab} className="mt-4 space-y-4">
            <div className="flex items-center gap-3 flex-wrap">
              <div className="relative flex-1 max-w-sm">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search orders, items, vendors, PO#..."
                  className="pl-9 h-9"
                />
              </div>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm" className="gap-2 h-9">
                    <Menu className="h-3.5 w-3.5" />
                    {viewModeLabel[viewMode]}
                    <ChevronDown className="h-3 w-3 opacity-50" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="w-48">
                  <DropdownMenuItem onClick={() => setViewMode("all")} className="gap-2">
                    <LayoutList className="h-4 w-4" /> All
                    {viewMode === "all" && <Check className="h-3.5 w-3.5 ml-auto" />}
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setViewMode("by-list")} className="gap-2">
                    <Receipt className="h-4 w-4" /> Group by List
                    {viewMode === "by-list" && <Check className="h-3.5 w-3.5 ml-auto" />}
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setViewMode("by-date")} className="gap-2">
                    <Clock className="h-4 w-4" /> Group by Date
                    {viewMode === "by-date" && <Check className="h-3.5 w-3.5 ml-auto" />}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>

            {filteredPurchases.length === 0 ? (
              <Card>
                <CardContent className="py-12 text-center text-muted-foreground">
                  <Receipt className="mx-auto h-10 w-10 mb-3 opacity-20" />
                  <p className="text-sm font-medium">
                    {tab === "orders" ? "No purchase orders yet" : tab === "invoices" ? "No invoices yet" : "No records yet"}
                  </p>
                  <p className="text-xs mt-1">
                    {tab === "orders"
                      ? "Submit a Smart Order to generate purchase orders."
                      : tab === "invoices"
                        ? "Upload an invoice from the Invoices page."
                        : "Submit a Smart Order or upload an invoice to get started."}
                  </p>
                </CardContent>
              </Card>
            ) : (
              Object.entries(grouped).map(([groupName, groupPurchases]) => (
                <div key={groupName} className="space-y-2">
                  {Object.keys(grouped).length > 1 && (
                    <div className="flex items-center gap-2 px-1">
                      <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{groupName}</h3>
                      <Badge variant="secondary" className="text-[10px]">{groupPurchases.length}</Badge>
                    </div>
                  )}
                  {groupPurchases.map((p) => {
                    const isOrder = isOrderRow(p);
                    const isLinked = !isOrder && Boolean(p.smart_order_run_id);
                    const items = lineItemsByRow[p.id] || [];
                    const issues = issuesByRow[p.id] || [];
                    return (
                      <Card key={`${p.rowKind}-${p.id}`} className="overflow-hidden border shadow-sm">
                        <CardContent className="p-0">
                          <div
                            className="flex items-center justify-between p-4 cursor-pointer hover:bg-muted/10 transition-colors"
                            onClick={() => setExpandedId(expandedId === p.id ? null : p.id)}
                          >
                            <div className="flex items-start gap-3 min-w-0">
                              <div className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md ${isOrder ? "bg-blue-500/10" : "bg-success/10"}`}>
                                {isOrder
                                  ? <ShoppingCart className="h-3.5 w-3.5 text-blue-600" />
                                  : <FileText className="h-3.5 w-3.5 text-success" />}
                              </div>
                              <div className="min-w-0">
                                <div className="flex items-center gap-2 flex-wrap">
                                  {isOrder && (
                                    <Badge className="bg-blue-500/10 text-blue-700 border-0 text-[10px] font-semibold">ORDER</Badge>
                                  )}
                                  {!isOrder && (
                                    <Badge className="bg-success/10 text-success border-0 text-[10px] font-semibold">INVOICE</Badge>
                                  )}
                                  <p className="font-semibold text-sm truncate">
                                    {p.inventory_lists?.name || p.vendor_name || "Unknown"}
                                  </p>
                                  {p.vendor_name && p.inventory_lists?.name && (
                                    <span className="text-[11px] text-muted-foreground">{p.vendor_name}</span>
                                  )}
                                </div>
                                <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                                  {p.po_number && (
                                    <Badge className="bg-primary/10 text-primary border-0 text-[10px] font-mono">
                                      {p.po_number}
                                    </Badge>
                                  )}
                                  {isLinked && (
                                    <span className="flex items-center gap-0.5 text-[11px] text-primary/70">
                                      <Link2 className="h-3 w-3" />
                                      {p.po_number ? `Linked to ${p.po_number}` : "Linked to PO"}
                                    </span>
                                  )}
                                  {isOrder && p.rowKind === "purchase_order" && !["closed", "cancelled"].includes(p.po_workflow_status || "") && (
                                    <span className="text-[11px] text-muted-foreground/60">Awaiting invoice / fulfillment</span>
                                  )}
                                  {isOrder && p.rowKind === "legacy_ph" && !p.receipt_status?.startsWith("confirmed") && (
                                    <span className="text-[11px] text-muted-foreground/60">Awaiting invoice</span>
                                  )}
                                  {isOrder ? orderStatusBadge(p) : invoiceStatusBadge(p)}
                                  {p.receipt_status === "issues_reported" && !isOrder && (
                                    <Badge className="bg-orange-500/10 text-orange-600 border-0 text-[10px]">Issues</Badge>
                                  )}
                                  <span className="text-[11px] text-muted-foreground">
                                    {new Date(p.created_at).toLocaleDateString()}
                                  </span>
                                </div>
                              </div>
                            </div>

                            <div className="flex items-center gap-2 ml-2 shrink-0">
                              <div className="text-right">
                                <p className="text-xs text-muted-foreground">{items.length} items</p>
                                <p className="text-sm font-mono font-semibold">${totalCost(items).toFixed(2)}</p>
                              </div>
                              {showReviewButton(p) && (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="h-8 px-2 gap-1 text-[11px]"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    navigate(`/app/invoices/${p.id}/review`);
                                  }}
                                >
                                  <ClipboardCheck className="h-3.5 w-3.5" /> Review
                                </Button>
                              )}
                              <Button size="sm" variant="ghost" className="h-8 w-8 p-0">
                                <Eye className="h-4 w-4" />
                              </Button>
                            </div>
                          </div>

                          {expandedId === p.id && (
                            <div className="border-t">
                              <Tabs defaultValue="items" className="w-full">
                                <div className="px-4 pt-3">
                                  <TabsList className="h-8">
                                    <TabsTrigger value="items" className="text-xs h-7 px-3">
                                      Items ({items.length})
                                    </TabsTrigger>
                                    <TabsTrigger value="discrepancies" className="text-xs h-7 px-3 gap-1">
                                      {issues.length > 0 && (
                                        <AlertTriangle className="h-3 w-3 text-orange-500" />
                                      )}
                                      Discrepancies ({issues.length})
                                    </TabsTrigger>
                                  </TabsList>
                                </div>
                                <TabsContent value="items" className="mt-0">
                                  <Table>
                                    <TableHeader>
                                      <TableRow className="bg-muted/30">
                                        <TableHead className="text-xs font-semibold">Item</TableHead>
                                        <TableHead className="text-xs font-semibold">Brand</TableHead>
                                        <TableHead className="text-xs font-semibold">Pack Size</TableHead>
                                        <TableHead className="text-xs font-semibold">Qty</TableHead>
                                        <TableHead className="text-xs font-semibold">Unit Cost</TableHead>
                                        <TableHead className="text-xs font-semibold">Total</TableHead>
                                      </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                      {items.map((item: any) => (
                                        <TableRow key={item.id}>
                                          <TableCell className="font-medium text-sm">{item.item_name}</TableCell>
                                          <TableCell className="text-xs text-muted-foreground">{item.brand_name || "—"}</TableCell>
                                          <TableCell className="text-xs text-muted-foreground">{item.pack_size || "—"}</TableCell>
                                          <TableCell className="font-mono text-sm">{item.quantity}</TableCell>
                                          <TableCell className="font-mono text-sm">{item.unit_cost ? `$${Number(item.unit_cost).toFixed(2)}` : "—"}</TableCell>
                                          <TableCell className="font-mono text-sm">{item.total_cost ? `$${Number(item.total_cost).toFixed(2)}` : "—"}</TableCell>
                                        </TableRow>
                                      ))}
                                    </TableBody>
                                  </Table>
                                  <div className="flex items-center justify-end gap-2 p-3 border-t bg-muted/10">
                                    <DollarSign className="h-4 w-4 text-primary" />
                                    <p className="text-sm font-semibold">
                                      Total: <span className="text-primary">${totalCost(items).toFixed(2)}</span>
                                    </p>
                                  </div>
                                </TabsContent>
                                <TabsContent value="discrepancies" className="mt-0">
                                  {issues.length === 0 ? (
                                    <div className="py-8 text-center text-muted-foreground text-sm">
                                      No issues reported for this delivery.
                                    </div>
                                  ) : (
                                    <Table>
                                      <TableHeader>
                                        <TableRow className="bg-muted/30">
                                          <TableHead className="text-xs font-semibold">Item</TableHead>
                                          <TableHead className="text-xs font-semibold">Issue</TableHead>
                                          <TableHead className="text-xs font-semibold">Notes</TableHead>
                                          <TableHead className="text-xs font-semibold">Reported</TableHead>
                                        </TableRow>
                                      </TableHeader>
                                      <TableBody>
                                        {issues.map((iss: any) => (
                                          <TableRow key={iss.id}>
                                            <TableCell className="text-sm font-medium">{iss.item_name}</TableCell>
                                            <TableCell>
                                              <Badge className="bg-orange-500/10 text-orange-600 border-0 text-[10px]">
                                                {iss.issue_type.replace(/_/g, " ")}
                                              </Badge>
                                            </TableCell>
                                            <TableCell className="text-xs text-muted-foreground">{iss.notes || "—"}</TableCell>
                                            <TableCell className="text-xs text-muted-foreground">
                                              {new Date(iss.reported_at).toLocaleDateString()}
                                            </TableCell>
                                          </TableRow>
                                        ))}
                                      </TableBody>
                                    </Table>
                                  )}
                                </TabsContent>
                              </Tabs>
                            </div>
                          )}
                        </CardContent>
                      </Card>
                    );
                  })}
                </div>
              ))
            )}
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}
