import { useEffect, useMemo, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useRestaurant } from "@/contexts/RestaurantContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetFooter } from "@/components/ui/sheet";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import {
  ArrowLeft, BookmarkPlus, CheckCircle, AlertTriangle, Package, DollarSign,
  Loader2, Flag, TrendingUp, ExternalLink,
} from "lucide-react";
import { formatNum } from "@/lib/inventory-utils";
import {
  analyzeInvoiceComparison,
  DEFAULT_PRICE_TOLERANCE,
  DEFAULT_QTY_TOLERANCE,
  DEFAULT_TOTAL_TOLERANCE,
  deriveInvoiceComparisonStatus,
} from "@/lib/invoice-comparison";
import { resolveDocumentTotal } from "@/lib/invoice-totals";

// Returns the catalog_item_id for a purchase_history_item by checking:
// 1. Already set on the item, 2. SKU match in vendor mappings, 3. Exact learned vendor-item mapping
function resolveItemMapping(phItem: any, mappings: any[]): string | null {
  if (phItem.catalog_item_id) return phItem.catalog_item_id;
  if (phItem.vendor_sku) {
    const m = mappings.find(m => m.vendor_sku?.toLowerCase() === phItem.vendor_sku?.toLowerCase());
    if (m) return m.catalog_item_id;
  }
  const m = mappings.find(m => m.vendor_item_name?.toLowerCase() === phItem.item_name?.toLowerCase().trim());
  return m?.catalog_item_id ?? null;
}

function resolveComparisonLineTotal(
  explicitTotal: unknown,
  quantity: unknown,
  unitCost: unknown,
): number | null {
  const total = Number(explicitTotal);
  if (explicitTotal != null && Number.isFinite(total)) return total;

  const qty = Number(quantity);
  const cost = Number(unitCost);
  if (!Number.isFinite(qty) || !Number.isFinite(cost)) return null;

  return qty * cost;
}

const ISSUE_TYPES = [
  { value: "short_shipped", label: "Short Shipped" },
  { value: "damaged", label: "Damaged" },
  { value: "wrong_item", label: "Wrong Item" },
  { value: "price_discrepancy", label: "Price Discrepancy" },
  { value: "other", label: "Other" },
];

export default function InvoiceReviewPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { currentRestaurant } = useRestaurant();

  const [invoice, setInvoice] = useState<any>(null);
  const [invoiceItems, setInvoiceItems] = useState<any[]>([]);
  const [poItems, setPoItems] = useState<any[]>([]);
  const [comparisons, setComparisons] = useState<any[]>([]);
  const [issues, setIssues] = useState<any[]>([]);
  const [catalogItems, setCatalogItems] = useState<any[]>([]);
  const [vendorMappings, setVendorMappings] = useState<any[]>([]);
  const [catalogOverrides, setCatalogOverrides] = useState<Record<string, string>>({});
  const [savingMappings, setSavingMappings] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);
  const [confirming, setConfirming] = useState(false);
  /** Whether this page was loaded from `invoices` or legacy `purchase_history`. */
  const [reviewDocKind, setReviewDocKind] = useState<"invoice" | "purchase_history">("invoice");

  const catalogById = useMemo(
    () => Object.fromEntries(catalogItems.map(c => [c.id, c])),
    [catalogItems],
  );

  const lineItemById = useMemo(
    () => Object.fromEntries(invoiceItems.map(i => [i.id, i])),
    [invoiceItems],
  );

  const comparisonRows = useMemo(
    () => comparisons.map((comp) => {
      const analysis = analyzeInvoiceComparison(comp);
      return {
        ...comp,
        derived_status: analysis.status,
        qtyAnalysis: analysis.qty,
        priceAnalysis: analysis.price,
        totalAnalysis: analysis.total,
      };
    }),
    [comparisons],
  );

  // Confirmation result dialog
  const [confirmResult, setConfirmResult] = useState<any>(null);

  // Report issue sheet
  const [reportSheetOpen, setReportSheetOpen] = useState(false);
  const [reportItem, setReportItem] = useState<any>(null);
  const [reportIssueType, setReportIssueType] = useState("short_shipped");
  const [reportNotes, setReportNotes] = useState("");
  const [reportSaving, setReportSaving] = useState(false);

  useEffect(() => {
    if (!id || !currentRestaurant) return;
    loadData();
  }, [id, currentRestaurant]);

  useEffect(() => {
    const changedRows = comparisonRows.filter((comp) => comp.status !== comp.derived_status);
    if (changedRows.length === 0) return;

    const changedStatusById = Object.fromEntries(
      changedRows.map((comp) => [comp.id, comp.derived_status]),
    );

    setComparisons((prev) =>
      prev.map((comp) =>
        changedStatusById[comp.id] ? { ...comp, status: changedStatusById[comp.id] } : comp,
      ),
    );

    void Promise.all(
      changedRows.map((comp) =>
        supabase
          .from("invoice_line_comparisons")
          .update({ status: comp.derived_status })
          .eq("id", comp.id),
      ),
    ).catch((error) => {
      console.warn("[invoice comparison status sync]", error);
    });
  }, [comparisonRows]);

  const loadData = async () => {
    setLoading(true);
    try {
      const { data: invNew, error: invNewErr } = await supabase
        .from("invoices")
        .select("*, purchase_orders(id, po_number, smart_order_run_id, purchase_order_items(*))")
        .eq("id", id!)
        .eq("restaurant_id", currentRestaurant!.id)
        .maybeSingle();

      if (invNew && !invNewErr) {
        setReviewDocKind("invoice");
        setInvoice(invNew);
        const [
          { data: items },
          { data: cats },
          { data: comps },
          { data: issuesList },
        ] = await Promise.all([
          supabase.from("invoice_items").select("*").eq("invoice_id", id),
          supabase.from("inventory_catalog_items").select("id, item_name, vendor_sku, product_number").eq("restaurant_id", currentRestaurant!.id),
          supabase.from("invoice_line_comparisons").select("*").eq("invoice_id", id!),
          supabase.from("delivery_issues").select("*").eq("invoice_id", id!),
        ]);
        const poItemsList = invNew.purchase_orders?.purchase_order_items || [];
        setPoItems(poItemsList);
        setInvoiceItems(items || []);
        setCatalogItems(cats || []);
        setIssues(issuesList || []);
        let mappings: any[] = [];
        if (invNew.vendor_name) {
          const { data: mappingsData } = await supabase
            .from("vendor_item_mappings")
            .select("*")
            .eq("restaurant_id", currentRestaurant!.id)
            .eq("vendor_name", invNew.vendor_name);
          mappings = mappingsData || [];
        }
        setVendorMappings(mappings);
        setComparisons(comps || []);
        if ((!comps || comps.length === 0) && items && items.length > 0) {
          await generateComparisons(invNew, items, poItemsList, mappings, cats || [], "invoice");
          supabase
            .rpc("notify_delivery_issues", { p_purchase_history_id: id! })
            .then(({ error }) => {
              if (error) console.warn("[notify_delivery_issues]", error.message);
            });
        }
        return;
      }

      const { data: inv } = await supabase
        .from("purchase_history")
        .select("*, smart_order_runs(id, po_number, smart_order_run_items(*))")
        .eq("id", id)
        .single();
      if (!inv) { toast.error("Invoice not found"); navigate(-1); return; }
      setReviewDocKind("purchase_history");
      setInvoice(inv);

      const [
        { data: items },
        { data: cats },
        { data: comps },
        { data: issuesList },
      ] = await Promise.all([
        supabase.from("purchase_history_items").select("*").eq("purchase_history_id", id),
        supabase.from("inventory_catalog_items").select("id, item_name, vendor_sku, product_number").eq("restaurant_id", currentRestaurant!.id),
        supabase.from("invoice_line_comparisons").select("*").eq("purchase_history_id", id!),
        supabase.from("delivery_issues").select("*").eq("purchase_history_id", id!),
      ]);

      const poItemsList = inv.smart_order_runs?.smart_order_run_items || [];
      setPoItems(poItemsList);
      setInvoiceItems(items || []);
      setCatalogItems(cats || []);
      setIssues(issuesList || []);

      let mappings: any[] = [];
      if (inv.vendor_name) {
        const { data: mappingsData } = await supabase
          .from("vendor_item_mappings")
          .select("*")
          .eq("restaurant_id", currentRestaurant!.id)
          .eq("vendor_name", inv.vendor_name);
        mappings = mappingsData || [];
      }
      setVendorMappings(mappings);
      setComparisons(comps || []);

      if ((!comps || comps.length === 0) && items && items.length > 0) {
        await generateComparisons(inv, items, poItemsList, mappings, cats || [], "purchase_history");
        supabase
          .rpc("notify_delivery_issues", { p_purchase_history_id: id! })
          .then(({ error }) => {
            if (error) console.warn("[notify_delivery_issues]", error.message);
          });
      }
    } finally {
      setLoading(false);
    }
  };

  const generateComparisons = async (
    inv: any,
    items: any[],
    poItemsList: any[],
    mappings: any[],
    catalogItemsList: any[],
    doc: "invoice" | "purchase_history",
  ) => {
    const sorId = doc === "invoice" ? inv.purchase_orders?.smart_order_run_id ?? null : inv.smart_order_run_id;

    const lineKeysForItem = (item: any) =>
      doc === "invoice"
        ? {
            invoice_id: inv.id,
            invoice_item_id: item.id,
            purchase_history_id: null as string | null,
            purchase_history_item_id: null as string | null,
            smart_order_run_id: sorId,
          }
        : {
            purchase_history_id: inv.id,
            purchase_history_item_id: item.id,
            invoice_id: null as string | null,
            invoice_item_id: null as string | null,
            smart_order_run_id: sorId,
          };

    const lineKeysSynthetic = () =>
      doc === "invoice"
        ? {
            invoice_id: inv.id,
            invoice_item_id: null as string | null,
            purchase_history_id: null as string | null,
            purchase_history_item_id: null as string | null,
            smart_order_run_id: sorId,
          }
        : {
            purchase_history_id: inv.id,
            purchase_history_item_id: null as string | null,
            invoice_id: null as string | null,
            invoice_item_id: null as string | null,
            smart_order_run_id: sorId,
          };

    const poOrderedQty = (poi: any) => Number(poi.quantity_ordered ?? poi.suggested_order) || 0;

    const resolvedPoItems = poItemsList.map((poi: any) => ({
      ...poi,
      resolved_catalog_id: poi.catalog_item_id || null,
    }));

    const poByCatalogId: Record<string, any> = {};
    resolvedPoItems.forEach((poi: any) => {
      if (poi.resolved_catalog_id) poByCatalogId[poi.resolved_catalog_id] = poi;
    });

    const matchedPoCatalogIds = new Set<string>();

    const rows = items.map(item => {
      const catalogId = resolveItemMapping(item, mappings);
      const invoicedQty = Number(item.quantity) || 0;
      const invoicedCost = item.unit_cost != null ? Number(item.unit_cost) : null;
      const invoicedTotal = resolveComparisonLineTotal(item.total_cost, invoicedQty, invoicedCost);

      if (!catalogId) {
        return {
          ...lineKeysForItem(item),
          catalog_item_id: null,
          item_name: item.item_name,
          purchase_order_item_id: null,
          po_qty: null,
          po_unit_cost: null,
          po_total_cost: null,
          invoiced_qty: invoicedQty,
          invoiced_unit_cost: invoicedCost,
          invoiced_total_cost: invoicedTotal,
          status: "unmatched",
        };
      }

      const po = poByCatalogId[catalogId];
      if (po) matchedPoCatalogIds.add(catalogId);

      const poQty = po ? poOrderedQty(po) : null;
      const poCost = po?.unit_cost != null ? Number(po.unit_cost) : null;
      const poTotal = resolveComparisonLineTotal(null, poQty, poCost);

      let status: string = "ok";
      if (!po) {
        status = "extra_on_invoice";
      } else {
        status = deriveInvoiceComparisonStatus({
          po_qty: poQty,
          invoiced_qty: invoicedQty,
          po_unit_cost: poCost,
          invoiced_unit_cost: invoicedCost,
          po_total_cost: poTotal,
          invoiced_total_cost: invoicedTotal,
        });
      }

      return {
        ...lineKeysForItem(item),
        purchase_order_item_id: doc === "invoice" && po ? po.id : null,
        catalog_item_id: catalogId,
        item_name: item.item_name,
        po_qty: poQty,
        po_unit_cost: poCost,
        po_total_cost: poTotal,
        invoiced_qty: invoicedQty,
        invoiced_unit_cost: invoicedCost,
        invoiced_total_cost: invoicedTotal,
        status,
      };
    });

    resolvedPoItems.forEach((poi: any) => {
      if (poOrderedQty(poi) <= 0) return;
      const catalogId = poi.resolved_catalog_id;
      if (catalogId && matchedPoCatalogIds.has(catalogId)) return;
      const pq = poOrderedQty(poi);
      rows.push({
        ...lineKeysSynthetic(),
        purchase_order_item_id: doc === "invoice" ? poi.id : null,
        catalog_item_id: catalogId || null,
        item_name: poi.item_name,
        po_qty: pq,
        po_unit_cost: poi.unit_cost != null ? Number(poi.unit_cost) : null,
        po_total_cost: resolveComparisonLineTotal(
          null,
          pq,
          poi.unit_cost != null ? Number(poi.unit_cost) : null,
        ),
        invoiced_qty: 0,
        invoiced_unit_cost: 0,
        invoiced_total_cost: 0,
        status: "missing_from_invoice",
      });
    });

    if (rows.length > 0) {
      const { data: inserted } = await supabase
        .from("invoice_line_comparisons")
        .insert(rows)
        .select();
      if (inserted) setComparisons(inserted);
    }
  };

  const handleConfirmReceipt = async () => {
    if (!id || !currentRestaurant) return;
    setConfirming(true);
    try {
      const { data, error } = await supabase.rpc("confirm_invoice_receipt", {
        p_invoice_id: id,
        p_restaurant_id: currentRestaurant.id,
      });
      if (error) throw error;

      setInvoice((prev: any) =>
        reviewDocKind === "invoice"
          ? { ...prev, receipt_status: "confirmed", status: "confirmed" }
          : { ...prev, receipt_status: "confirmed", invoice_status: "COMPLETE" },
      );

      setConfirmResult(data);
    } catch (e: any) {
      toast.error(`Failed: ${e.message}`);
    } finally {
      setConfirming(false);
    }
  };

  const openReportIssue = (comp: any) => {
    setReportItem(comp);
    setReportIssueType("short_shipped");
    setReportNotes("");
    setTimeout(() => setReportSheetOpen(true), 0);
  };

  const handleSaveIssue = async () => {
    if (!reportItem || !id) return;
    setReportSaving(true);
    try {
      const issueRow =
        reviewDocKind === "invoice"
          ? {
              invoice_id: id,
              purchase_history_id: null as string | null,
              invoice_line_comparison_id: reportItem.id,
              catalog_item_id: reportItem.catalog_item_id || null,
              item_name: reportItem.item_name,
              issue_type: reportIssueType,
              notes: reportNotes.trim() || null,
            }
          : {
              purchase_history_id: id,
              invoice_id: null as string | null,
              invoice_line_comparison_id: reportItem.id,
              catalog_item_id: reportItem.catalog_item_id || null,
              item_name: reportItem.item_name,
              issue_type: reportIssueType,
              notes: reportNotes.trim() || null,
            };
      const { data, error } = await supabase.from("delivery_issues").insert(issueRow).select().single();
      if (error) throw error;
      setIssues(prev => [...prev, data]);
      setReportSheetOpen(false);

      if (reviewDocKind === "invoice") {
        await supabase.from("invoices").update({ receipt_status: "issues_reported" }).eq("id", id);
      } else {
        await supabase.from("purchase_history").update({ receipt_status: "issues_reported" }).eq("id", id);
      }
      setInvoice((prev: any) => ({ ...prev, receipt_status: "issues_reported" }));
      toast.success("Issue reported");
    } catch (e: any) {
      toast.error(`Failed: ${e.message}`);
    } finally {
      setReportSaving(false);
    }
  };

  const handleSaveMapping = async (comp: any) => {
    const selectedCatalogId = catalogOverrides[comp.id];
    if (!selectedCatalogId || !currentRestaurant || !invoice) return;
    setSavingMappings(prev => ({ ...prev, [comp.id]: true }));
    try {
      const lineId = comp.invoice_item_id || comp.purchase_history_item_id;
      const lineItem = lineId ? lineItemById[lineId] : null;

      await supabase.from("vendor_item_mappings").upsert(
        {
          restaurant_id: currentRestaurant.id,
          vendor_name: invoice.vendor_name,
          vendor_sku: lineItem?.vendor_sku || null,
          vendor_item_name: comp.item_name,
          catalog_item_id: selectedCatalogId,
        },
        { onConflict: "restaurant_id,vendor_name,vendor_item_name" },
      );

      if (comp.invoice_item_id) {
        await supabase
          .from("invoice_items")
          .update({ catalog_item_id: selectedCatalogId, match_status: "MAPPED" })
          .eq("id", comp.invoice_item_id);
        setInvoiceItems(prev =>
          prev.map(i =>
            i.id === comp.invoice_item_id
              ? { ...i, catalog_item_id: selectedCatalogId, match_status: "MAPPED" }
              : i,
          ),
        );
      } else if (comp.purchase_history_item_id) {
        await supabase
          .from("purchase_history_items")
          .update({ catalog_item_id: selectedCatalogId, match_status: "MAPPED" })
          .eq("id", comp.purchase_history_item_id);
        setInvoiceItems(prev =>
          prev.map(i =>
            i.id === comp.purchase_history_item_id
              ? { ...i, catalog_item_id: selectedCatalogId, match_status: "MAPPED" }
              : i,
          ),
        );
      }

      await supabase
        .from("invoice_line_comparisons")
        .update({ catalog_item_id: selectedCatalogId })
        .eq("id", comp.id);

      setComparisons(prev =>
        prev.map(c => c.id === comp.id ? { ...c, catalog_item_id: selectedCatalogId } : c),
      );
      setVendorMappings(prev => {
        const idx = prev.findIndex(
          m => m.vendor_item_name?.toLowerCase() === comp.item_name?.toLowerCase(),
        );
        const entry = {
          restaurant_id: currentRestaurant.id,
          vendor_name: invoice.vendor_name,
          vendor_item_name: comp.item_name,
          vendor_sku: lineItem?.vendor_sku || null,
          catalog_item_id: selectedCatalogId,
        };
        if (idx >= 0) { const next = [...prev]; next[idx] = entry; return next; }
        return [...prev, entry];
      });
      setCatalogOverrides(prev => { const next = { ...prev }; delete next[comp.id]; return next; });
      toast.success("Mapping saved");
    } catch (e: any) {
      toast.error(`Failed: ${e.message}`);
    } finally {
      setSavingMappings(prev => ({ ...prev, [comp.id]: false }));
    }
  };

  const statusBadge = (status: string) => {
    switch (status) {
      case "ok": return <Badge className="bg-success/10 text-success border-0 text-[10px]">OK</Badge>;
      case "qty_mismatch": return <Badge className="bg-warning/10 text-warning border-0 text-[10px]">Qty Mismatch</Badge>;
      case "price_mismatch": return <Badge className="bg-orange-500/10 text-orange-600 border-0 text-[10px]">Price Mismatch</Badge>;
      case "total_mismatch": return <Badge className="bg-destructive/10 text-destructive border-0 text-[10px]">Total Mismatch</Badge>;
      case "missing_from_invoice": return <Badge className="bg-destructive/10 text-destructive border-0 text-[10px]">Missing</Badge>;
      case "extra_on_invoice": return <Badge className="bg-blue-500/10 text-blue-600 border-0 text-[10px]">Extra</Badge>;
      case "unmatched": return <Badge className="bg-muted/60 text-muted-foreground border-0 text-[10px]">Unmatched</Badge>;
      default: return null;
    }
  };

  const receiptStatusBadge = (status: string) => {
    switch (status) {
      case "pending": return <Badge className="bg-warning/10 text-warning border-0 text-xs">Pending Review</Badge>;
      case "reviewing": return <Badge className="bg-blue-500/10 text-blue-600 border-0 text-xs">Reviewing</Badge>;
      case "confirmed": return <Badge className="bg-success/10 text-success border-0 text-xs">Confirmed</Badge>;
      case "issues_reported": return <Badge className="bg-orange-500/10 text-orange-600 border-0 text-xs">Issues Reported</Badge>;
      default: return null;
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const issueCount = comparisonRows.filter(c => c.derived_status !== "ok").length;
  const invoiceTotal = resolveDocumentTotal(invoice, invoiceItems);
  const reportedIssueCount = issues.length;
  const poNumber = invoice?.purchase_orders?.po_number || invoice?.po_number || invoice?.smart_order_runs?.po_number;
  const updatedReceiptItems = confirmResult?.items?.filter((i: any) => i.status === "updated") ?? [];
  const skippedReceiptItems = confirmResult?.items?.filter(
    (i: any) => i.status === "not_in_session" || i.status === "no_session",
  ) ?? [];

  return (
    <div className="space-y-5 animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => navigate(-1)}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Invoice Review</h1>
            <p className="text-sm text-muted-foreground">
              {invoice?.vendor_name}
              {invoice?.invoice_number && ` · #${invoice.invoice_number}`}
              {poNumber && ` · PO: ${poNumber}`}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {receiptStatusBadge(invoice?.receipt_status || "pending")}
          <Button
            size="sm"
            variant="default"
            className="gap-1.5"
            disabled={confirming || invoice?.receipt_status === "confirmed"}
            onClick={handleConfirmReceipt}
          >
            {confirming ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle className="h-3.5 w-3.5" />}
            Confirm Receipt
          </Button>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid gap-3 sm:grid-cols-4">
        <Card>
          <CardContent className="flex items-center gap-3 p-3">
            <Package className="h-5 w-5 text-primary" />
            <div>
              <p className="stat-value text-lg">{comparisons.length}</p>
              <p className="text-[10px] text-muted-foreground">Line Items</p>
            </div>
          </CardContent>
        </Card>
        <Card className={issueCount > 0 ? "border-warning/30" : ""}>
          <CardContent className="flex items-center gap-3 p-3">
            <AlertTriangle className={`h-5 w-5 ${issueCount > 0 ? "text-warning" : "text-muted-foreground"}`} />
            <div>
              <p className="stat-value text-lg">{issueCount}</p>
              <p className="text-[10px] text-muted-foreground">Discrepancies</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-3 p-3">
            <DollarSign className="h-5 w-5 text-primary" />
            <div>
              <p className="stat-value text-lg">${formatNum(invoiceTotal)}</p>
              <p className="text-[10px] text-muted-foreground">Invoice Total</p>
            </div>
          </CardContent>
        </Card>
        <Card className={reportedIssueCount > 0 ? "border-orange-500/30" : ""}>
          <CardContent className="flex items-center gap-3 p-3">
            <Flag className={`h-5 w-5 ${reportedIssueCount > 0 ? "text-orange-500" : "text-muted-foreground"}`} />
            <div>
              <p className="stat-value text-lg">{reportedIssueCount}</p>
              <p className="text-[10px] text-muted-foreground">Issues Reported</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Comparison Table */}
      <Card className="overflow-hidden">
        <CardHeader className="pb-3 pt-4 px-4">
          <CardTitle className="text-sm font-semibold">Line Item Comparison</CardTitle>
          <p className="text-[11px] text-muted-foreground">
            Flags quantity variances above {DEFAULT_QTY_TOLERANCE.percent}%, unit-price variances above {DEFAULT_PRICE_TOLERANCE.percent}%, and line-total variances above {DEFAULT_TOTAL_TOLERANCE.percent}% once the total gap exceeds ${formatNum(DEFAULT_TOTAL_TOLERANCE.minAbsolute)}.
          </p>
        </CardHeader>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/30">
                <TableHead className="text-xs font-semibold">Item</TableHead>
                <TableHead className="text-xs font-semibold text-right">PO Qty</TableHead>
                <TableHead className="text-xs font-semibold text-right">Invoice Qty</TableHead>
                <TableHead className="text-xs font-semibold text-right">PO Price</TableHead>
                <TableHead className="text-xs font-semibold text-right">Invoice Price</TableHead>
                <TableHead className="text-xs font-semibold text-right">PO Total</TableHead>
                <TableHead className="text-xs font-semibold text-right">Invoice Total</TableHead>
                <TableHead className="text-xs font-semibold text-center">Status</TableHead>
                <TableHead className="text-xs font-semibold w-20"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {comparisons.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={9} className="text-center text-muted-foreground text-sm py-8">
                    {poItems.length === 0
                      ? "No linked Smart Order — comparison not available"
                      : "No line items to compare"}
                  </TableCell>
                </TableRow>
              ) : (
                comparisonRows.map(comp => {
                  const reported = issues.some(iss => iss.invoice_line_comparison_id === comp.id);
                  const qtyDiff = comp.qtyAnalysis.difference;
                  const qtyPctDiff = comp.qtyAnalysis.percentDifference;
                  const costDiff = comp.priceAnalysis.difference;
                  const costPctDiff = comp.priceAnalysis.percentDifference;
                  const poTotal = resolveComparisonLineTotal(comp.po_total_cost, comp.po_qty, comp.po_unit_cost);
                  const invoicedTotal = resolveComparisonLineTotal(
                    comp.invoiced_total_cost,
                    comp.invoiced_qty,
                    comp.invoiced_unit_cost,
                  );
                  const totalDiff = comp.totalAnalysis.difference;
                  const totalPctDiff = comp.totalAnalysis.percentDifference;
                  return (
                    <TableRow key={comp.id} className={comp.derived_status !== "ok" ? "bg-warning/3" : ""}>
                      <TableCell className="text-sm font-medium">
                        <div>
                          <span>{comp.item_name}</span>
                          {/* Catalog matching — invoice line or legacy purchase_history line */}
                          {(comp.invoice_item_id != null || comp.purchase_history_item_id != null) && (() => {
                            const override = catalogOverrides[comp.id];
                            if (override !== undefined) {
                              // User is actively selecting a catalog item
                              return (
                                <div className="flex items-center gap-1 mt-1">
                                  <Select
                                    value={override}
                                    onValueChange={val => setCatalogOverrides(prev => ({ ...prev, [comp.id]: val }))}
                                  >
                                    <SelectTrigger className="h-6 text-[11px] w-44 border-dashed">
                                      <SelectValue placeholder="Match catalog…" />
                                    </SelectTrigger>
                                    <SelectContent>
                                      {catalogItems.map(c => (
                                        <SelectItem key={c.id} value={c.id} className="text-xs">{c.item_name}</SelectItem>
                                      ))}
                                    </SelectContent>
                                  </Select>
                                  {override && (
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      className="h-6 px-1.5 text-primary"
                                      disabled={savingMappings[comp.id]}
                                      onClick={() => handleSaveMapping(comp)}
                                    >
                                      {savingMappings[comp.id]
                                        ? <Loader2 className="h-3 w-3 animate-spin" />
                                        : <BookmarkPlus className="h-3 w-3" />}
                                    </Button>
                                  )}
                                </div>
                              );
                            }
                            if (comp.catalog_item_id) {
                              // Auto-matched — show name badge with a change link
                              const catalogItem = catalogById[comp.catalog_item_id];
                              return (
                                <div className="flex items-center gap-1.5 mt-1">
                                  <Badge className="bg-primary/10 text-primary border-0 text-[10px] font-normal">
                                    {catalogItem?.item_name ?? comp.catalog_item_id}
                                  </Badge>
                                  <button
                                    className="text-[10px] text-muted-foreground hover:text-foreground underline-offset-2 hover:underline"
                                    onClick={() => setCatalogOverrides(prev => ({ ...prev, [comp.id]: comp.catalog_item_id }))}
                                  >
                                    change
                                  </button>
                                </div>
                              );
                            }
                            // No match yet — show empty picker
                            return (
                              <div className="mt-1">
                                <Select
                                  value=""
                                  onValueChange={val => setCatalogOverrides(prev => ({ ...prev, [comp.id]: val }))}
                                >
                                  <SelectTrigger className="h-6 text-[11px] w-44 border-dashed text-muted-foreground">
                                    <SelectValue placeholder="Match catalog…" />
                                  </SelectTrigger>
                                  <SelectContent>
                                    {catalogItems.map(c => (
                                      <SelectItem key={c.id} value={c.id} className="text-xs">{c.item_name}</SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                              </div>
                            );
                          })()}
                        </div>
                      </TableCell>
                      <TableCell className="text-sm text-right font-mono text-muted-foreground">
                        {comp.po_qty != null ? formatNum(comp.po_qty) : "—"}
                      </TableCell>
                      <TableCell className={`text-sm text-right font-mono font-semibold ${comp.qtyAnalysis.exceedsTolerance ? "text-warning" : ""}`}>
                        {comp.invoiced_qty != null ? formatNum(comp.invoiced_qty) : "—"}
                        {qtyDiff != null && comp.qtyAnalysis.exceedsTolerance && (
                          <span className="ml-1 text-[10px]">
                            ({qtyDiff > 0 ? "+" : ""}{formatNum(qtyDiff)}
                            {qtyPctDiff != null ? ` · ${qtyPctDiff.toFixed(1)}%` : ""})
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="text-sm text-right font-mono text-muted-foreground">
                        {comp.po_unit_cost != null ? `$${formatNum(comp.po_unit_cost)}` : "—"}
                      </TableCell>
                      <TableCell className={`text-sm text-right font-mono font-semibold ${comp.priceAnalysis.exceedsTolerance ? "text-orange-600" : ""}`}>
                        {comp.invoiced_unit_cost != null ? `$${formatNum(comp.invoiced_unit_cost)}` : "—"}
                        {costDiff != null && comp.priceAnalysis.exceedsTolerance && (
                          <span className="ml-1 text-[10px]">
                            ({costDiff > 0 ? "+" : "-"}${formatNum(Math.abs(costDiff))}
                            {costPctDiff != null ? ` · ${costPctDiff.toFixed(1)}%` : ""})
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="text-sm text-right font-mono text-muted-foreground">
                        {poTotal != null ? `$${formatNum(poTotal)}` : "—"}
                      </TableCell>
                      <TableCell className={`text-sm text-right font-mono font-semibold ${comp.totalAnalysis.exceedsTolerance ? "text-destructive" : ""}`}>
                        {invoicedTotal != null ? `$${formatNum(invoicedTotal)}` : "—"}
                        {totalDiff != null && comp.totalAnalysis.exceedsTolerance && (
                          <span className="ml-1 text-[10px]">
                            ({totalDiff > 0 ? "+" : "-"}${formatNum(Math.abs(totalDiff))}
                            {totalPctDiff != null ? ` · ${totalPctDiff.toFixed(1)}%` : ""})
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="text-center">{statusBadge(comp.derived_status)}</TableCell>
                      <TableCell className="text-right">
                        {comp.derived_status !== "ok" && !reported ? (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 px-2 text-[11px] text-orange-600 hover:text-orange-700"
                            onClick={() => openReportIssue(comp)}
                          >
                            <Flag className="h-3 w-3 mr-1" /> Report
                          </Button>
                        ) : reported ? (
                          <Badge className="bg-orange-500/10 text-orange-600 border-0 text-[10px]">Reported</Badge>
                        ) : null}
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </div>
      </Card>

      {/* Reported Issues */}
      {issues.length > 0 && (
        <Card className="overflow-hidden border-orange-500/20">
          <CardHeader className="pb-3 pt-4 px-4">
            <CardTitle className="text-sm font-semibold text-orange-600">Reported Issues</CardTitle>
          </CardHeader>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/30">
                  <TableHead className="text-xs font-semibold">Item</TableHead>
                  <TableHead className="text-xs font-semibold">Issue Type</TableHead>
                  <TableHead className="text-xs font-semibold">Notes</TableHead>
                  <TableHead className="text-xs font-semibold">Reported</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {issues.map(iss => (
                  <TableRow key={iss.id}>
                    <TableCell className="text-sm font-medium">{iss.item_name}</TableCell>
                    <TableCell className="text-sm">
                      {ISSUE_TYPES.find(t => t.value === iss.issue_type)?.label || iss.issue_type}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">{iss.notes || "—"}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {new Date(iss.reported_at).toLocaleDateString()}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </Card>
      )}

      {/* Report Issue Sheet */}
      <Sheet open={reportSheetOpen} onOpenChange={setReportSheetOpen}>
        <SheetContent side="right" className="w-[380px] sm:max-w-[380px]">
          <SheetHeader>
            <SheetTitle>Report Issue</SheetTitle>
          </SheetHeader>
          <div className="space-y-4 mt-4">
            <div>
              <Label className="text-xs text-muted-foreground">Item</Label>
              <p className="text-sm font-medium mt-1">{reportItem?.item_name}</p>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Issue Type</Label>
              <Select value={reportIssueType} onValueChange={setReportIssueType}>
                <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {ISSUE_TYPES.map(t => (
                    <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Notes (optional)</Label>
              <Textarea
                placeholder="Describe the issue..."
                value={reportNotes}
                onChange={e => setReportNotes(e.target.value)}
                className="text-sm min-h-[80px]"
              />
            </div>
          </div>
          <SheetFooter className="mt-6 flex gap-2">
            <Button variant="outline" className="flex-1" onClick={() => setReportSheetOpen(false)}>Cancel</Button>
            <Button className="flex-1" disabled={reportSaving} onClick={handleSaveIssue}>
              {reportSaving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Flag className="h-4 w-4 mr-2" />}
              Report Issue
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>

      {/* Confirm Receipt Result Dialog */}
      <Dialog open={!!confirmResult} onOpenChange={() => setConfirmResult(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-success">
              <CheckCircle className="h-5 w-5" />
              Delivery Confirmed
            </DialogTitle>
          </DialogHeader>
          {confirmResult && (
            <div className="space-y-4">
              {confirmResult.already_confirmed ? (
                <div className="rounded-lg border bg-muted/20 px-3 py-2">
                  <p className="text-sm text-muted-foreground">
                    This receipt was already confirmed earlier. No additional inventory changes were applied.
                  </p>
                </div>
              ) : (
                <div className="rounded-lg border bg-muted/20 px-3 py-3 space-y-1.5">
                  <p className="text-sm text-muted-foreground">
                    {confirmResult.target_session_name ? (
                      <>
                        Confirmed quantities were posted to{" "}
                        <span className="font-semibold text-foreground">{confirmResult.target_session_name}</span>.
                      </>
                    ) : (
                      <>
                        Receipt confirmed, but no mutable inventory session was available for stock updates.
                      </>
                    )}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {confirmResult.target_session_name
                      ? confirmResult.created_session
                        ? "A new in-progress session was created so the approved inventory snapshot stays unchanged."
                        : "The approved inventory snapshot was preserved; only the mutable in-progress session changed."
                      : "The approved inventory snapshot was preserved and no approved count was rewritten."}
                  </p>
                  {confirmResult.target_session_name && (
                    <p className="text-xs text-muted-foreground">
                      Updated{" "}
                      <span className="font-semibold text-foreground">
                        {confirmResult.updated} item{confirmResult.updated !== 1 ? "s" : ""}
                      </span>
                      .
                    </p>
                  )}
                </div>
              )}

              {/* Updated items */}
              {updatedReceiptItems.length > 0 && (
                <div className="rounded-lg border overflow-hidden">
                  <div className="bg-success/5 px-3 py-2 border-b">
                    <p className="text-xs font-semibold text-success">In-Progress Session Updated</p>
                  </div>
                  <div className="divide-y">
                    {updatedReceiptItems.map((i: any, idx: number) => (
                        <div key={idx} className="flex items-center justify-between px-3 py-2">
                          <span className="text-sm font-medium">{i.item_name}</span>
                          <div className="flex items-center gap-2 text-xs text-muted-foreground font-mono">
                            <span className="text-success font-semibold">+{formatNum(i.quantity_added)}</span>
                            {i.new_stock != null && (
                              <span>→ now {formatNum(i.new_stock)}</span>
                            )}
                          </div>
                        </div>
                      ))}
                  </div>
                </div>
              )}

              {/* Skipped / not in session */}
              {skippedReceiptItems.length > 0 && (
                <div className="rounded-lg border border-warning/20 overflow-hidden">
                  <div className="bg-warning/5 px-3 py-2 border-b border-warning/20">
                    <p className="text-xs font-semibold text-warning">Not Posted to Mutable Session</p>
                  </div>
                  <div className="divide-y divide-warning/10">
                    {skippedReceiptItems.map((i: any, idx: number) => (
                        <div key={idx} className="flex items-center justify-between px-3 py-2">
                          <span className="text-sm text-muted-foreground">{i.item_name}</span>
                          <span className="text-xs text-warning font-mono">+{formatNum(i.quantity_added)} (skipped)</span>
                        </div>
                      ))}
                  </div>
                  <div className="px-3 py-2 bg-warning/5 border-t border-warning/20">
                    <p className="text-[11px] text-muted-foreground">
                      Approved inventory snapshots were left untouched. Open Inventory to review the receiving session or add missing items before recounting.
                    </p>
                  </div>
                </div>
              )}

              {/* No catalog match */}
              {confirmResult.no_catalog > 0 && (
                <div className="rounded-lg border border-muted overflow-hidden">
                  <div className="bg-muted/30 px-3 py-2 border-b">
                    <p className="text-xs font-semibold text-muted-foreground">
                      {confirmResult.no_catalog} item{confirmResult.no_catalog !== 1 ? "s" : ""} not matched to catalog
                    </p>
                  </div>
                  <div className="divide-y">
                    {confirmResult.items
                      .filter((i: any) => i.status === "no_catalog_match")
                      .map((i: any, idx: number) => (
                        <div key={idx} className="flex items-center justify-between px-3 py-2">
                          <span className="text-sm text-muted-foreground">{i.item_name}</span>
                          <span className="text-xs text-muted-foreground">no SKU match</span>
                        </div>
                      ))}
                  </div>
                  <div className="px-3 py-2 bg-muted/10 border-t">
                    <p className="text-[11px] text-muted-foreground">
                      These items were <strong>not</strong> added to stock. Go to List Management to match them.
                    </p>
                  </div>
                </div>
              )}
            </div>
          )}
          <DialogFooter className="gap-2 mt-2">
            <Button
              variant="outline"
              className="gap-1.5"
              onClick={() => { setConfirmResult(null); navigate("/app/inventory"); }}
            >
              <TrendingUp className="h-4 w-4" /> View Inventory
            </Button>
            <Button onClick={() => { setConfirmResult(null); navigate("/app/invoices"); }}>
              Done
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
