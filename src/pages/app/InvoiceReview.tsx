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
import { Input } from "@/components/ui/input";
import {
  ArrowLeft, BookmarkPlus, CheckCircle, AlertTriangle, Package, DollarSign,
  Loader2, Flag, TrendingUp,
} from "lucide-react";
import { formatNum } from "@/lib/inventory-utils";
import { STOCK_TRUTH_MESSAGE } from "@/lib/stockTruthCopy";
import {
  DEFAULT_PRICE_TOLERANCE,
  DEFAULT_QTY_TOLERANCE,
  DEFAULT_TOTAL_TOLERANCE,
  threeWayQtyAllDivergent,
} from "@/lib/invoice-comparison";
import {
  buildCatalogById,
  buildDerivedComparisonRows,
  buildLineItemById,
  groupConfirmResultItems,
  summarizeInvoiceReview,
} from "@/domain/invoices/invoiceReviewSelectors";
import type { InvoiceReviewComparison } from "@/domain/invoices/invoiceReviewTypes";
import { useInvoiceReviewActions } from "@/hooks/useInvoiceReviewActions";
import { useInvoiceReviewData } from "@/hooks/useInvoiceReviewData";

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
  const [catalogOverrides, setCatalogOverrides] = useState<Record<string, string>>({});
  const {
    invoice,
    setInvoice,
    invoiceItems,
    setInvoiceItems,
    poItems,
    comparisons,
    setComparisons,
    issues,
    setIssues,
    catalogItems,
    setVendorMappings,
    loading,
    reviewDocKind,
  } = useInvoiceReviewData({
    id,
    currentRestaurantId: currentRestaurant?.id,
    navigate,
  });

  const catalogById = useMemo(
    () => buildCatalogById(catalogItems),
    [catalogItems],
  );

  const lineItemById = useMemo(
    () => buildLineItemById(invoiceItems),
    [invoiceItems],
  );

  const comparisonRows = useMemo(
    () => buildDerivedComparisonRows(comparisons),
    [comparisons],
  );
  const firstIncompleteComparisonId = useMemo(() => {
    const incomplete = comparisons.find((comparison) => {
      const invoicedQty = Number(comparison.invoiced_qty);
      return comparison.received_qty == null && Number.isFinite(invoicedQty) && invoicedQty > 0;
    });
    return incomplete?.id ?? null;
  }, [comparisons]);

  // Report issue sheet
  const [reportSheetOpen, setReportSheetOpen] = useState(false);
  const [reportItem, setReportItem] = useState<InvoiceReviewComparison | null>(null);
  const [reportIssueType, setReportIssueType] = useState("short_shipped");
  const [reportNotes, setReportNotes] = useState("");
  const {
    confirmResult,
    setConfirmResult,
    confirming,
    handleConfirmReceipt,
    receivedMissingCount,
    reportSaving,
    handleSaveIssue,
    savingMappings,
    handleSaveMapping,
    persistReceivedQty,
  } = useInvoiceReviewActions({
    id,
    currentRestaurantId: currentRestaurant?.id,
    reviewDocKind,
    invoice,
    comparisons,
    lineItemById,
    catalogOverrides,
    reportItem,
    reportIssueType,
    reportNotes,
    setInvoice,
    setInvoiceItems,
    setComparisons,
    setIssues,
    setVendorMappings,
    setCatalogOverrides,
    setReportSheetOpen,
  });

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

  const openReportIssue = (comp: InvoiceReviewComparison) => {
    setReportItem(comp);
    setReportIssueType("short_shipped");
    setReportNotes("");
    setTimeout(() => setReportSheetOpen(true), 0);
  };

  const {
    issueCount,
    invoiceTotal,
    reportedIssueCount,
    poLinked,
    poNum,
  } = useMemo(
    () => summarizeInvoiceReview(invoice, invoiceItems, comparisonRows, issues),
    [comparisonRows, invoice, invoiceItems, issues],
  );

  const { updatedReceiptItems, skippedReceiptItems } = useMemo(
    () => groupConfirmResultItems(confirmResult),
    [confirmResult],
  );

  const statusBadge = (status: string) => {
    switch (status) {
      case "ok": return <Badge className="bg-success/10 text-success border-0 text-[10px]">OK</Badge>;
      case "qty_mismatch": return <Badge className="bg-warning/10 text-warning border-0 text-[10px]">Qty Mismatch</Badge>;
      case "price_mismatch": return <Badge className="bg-orange-500/10 text-orange-600 border-0 text-[10px]">Price Mismatch</Badge>;
      case "total_mismatch": return <Badge className="bg-destructive/10 text-destructive border-0 text-[10px]">Total Mismatch</Badge>;
      case "missing_from_invoice": return <Badge className="bg-destructive/10 text-destructive border-0 text-[10px]">Missing</Badge>;
      case "extra_on_invoice": return <Badge className="bg-blue-500/10 text-blue-600 border-0 text-[10px]">Extra</Badge>;
      case "unmatched": return <Badge className="bg-muted/60 text-muted-foreground border-0 text-[10px]">Unmatched</Badge>;
      case "received_short": return <Badge className="bg-amber-500/15 text-amber-800 dark:text-amber-200 border-0 text-[10px]">Short delivery</Badge>;
      case "received_over": return <Badge className="bg-violet-500/15 text-violet-700 border-0 text-[10px]">Over-received</Badge>;
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
              {" · "}
              {poLinked ? (
                <span className="font-mono text-foreground/90">PO: {poNum || "—"}</span>
              ) : (
                <span className="text-muted-foreground/50">No purchase order linked</span>
              )}
            </p>
          </div>
        </div>
        <div className="flex flex-col items-end gap-2">
          {receivedMissingCount > 0 && (
            <div className="max-w-md rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-right">
              <p className="text-xs text-warning">
                {receivedMissingCount} line{receivedMissingCount === 1 ? "" : "s"} are missing received quantity. Enter 0 for items you did not receive, or fill in the actual delivered amount before confirming.
              </p>
              {firstIncompleteComparisonId && (
                <a
                  href={`#${firstIncompleteComparisonId}`}
                  className="mt-1 inline-block text-[11px] font-medium text-warning underline underline-offset-2"
                >
                  Jump to first incomplete line
                </a>
              )}
            </div>
          )}
          <div className="flex items-center gap-2">
          {receiptStatusBadge(invoice?.receipt_status || "pending")}
          <Button
            size="sm"
            variant="default"
            className="gap-1.5"
            disabled={confirming || invoice?.receipt_status === "confirmed" || receivedMissingCount > 0}
            onClick={handleConfirmReceipt}
          >
            {confirming ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle className="h-3.5 w-3.5" />}
            Post Invoice
          </Button>
          </div>
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
            Three-way: ordered (PO) vs billed (invoice) vs received (actual delivery). Edit Received to record physical counts. Flags short/over delivery, PO vs invoice qty/price/total above {DEFAULT_QTY_TOLERANCE.percent}% / {DEFAULT_PRICE_TOLERANCE.percent}% / {DEFAULT_TOTAL_TOLERANCE.percent}% (totals after ${formatNum(DEFAULT_TOTAL_TOLERANCE.minAbsolute)}).
          </p>
          <p className="text-xs font-medium text-foreground mt-3 pt-3 border-t border-border/50">
            Review all lines before posting.
          </p>
        </CardHeader>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/30">
                <TableHead className="text-xs font-semibold">Item</TableHead>
                <TableHead className="text-xs font-semibold text-right">Ordered</TableHead>
                <TableHead className="text-xs font-semibold text-right">Billed</TableHead>
                <TableHead className="text-xs font-semibold text-right">Received</TableHead>
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
                  <TableCell colSpan={10} className="text-center text-muted-foreground text-sm py-8">
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
                  const recvDiff = comp.receivedVsBilled?.difference;
                  const recvPct = comp.receivedVsBilled?.percentDifference;
                  const poTotal = resolveComparisonLineTotal(comp.po_total_cost, comp.po_qty, comp.po_unit_cost);
                  const invoicedTotal = resolveComparisonLineTotal(
                    comp.invoiced_total_cost,
                    comp.invoiced_qty,
                    comp.invoiced_unit_cost,
                  );
                  const totalDiff = comp.totalAnalysis.difference;
                  const totalPctDiff = comp.totalAnalysis.percentDifference;
                  const threeWay = threeWayQtyAllDivergent(comp);
                  return (
                    <TableRow
                      key={comp.id}
                      id={comp.id}
                      className={`${comp.derived_status !== "ok" ? "bg-warning/3" : ""} ${threeWay ? "ring-1 ring-destructive/40 bg-destructive/[0.06]" : ""}`}
                    >
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
                          {comp.derived_status === "unmatched" && (
                            <p className="text-[10px] text-muted-foreground mt-1.5 leading-snug max-w-[15rem]">
                              Unmatched = no safe catalog match. Select item manually.
                            </p>
                          )}
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
                      <TableCell className="text-sm text-right align-top">
                        <Input
                          type="number"
                          step="any"
                          min={0}
                          className={`h-8 w-[5.5rem] text-right font-mono text-xs px-2 ${comp.receivedVsBilled?.exceedsTolerance ? "border-amber-500/60" : ""}`}
                          value={comp.received_qty ?? ""}
                          onChange={(e) => {
                            const v = e.target.value;
                            const n = v === "" ? null : Number(v);
                            setComparisons((prev) =>
                              prev.map((c) =>
                                c.id === comp.id ? { ...c, received_qty: n != null && Number.isFinite(n) ? n : null } : c,
                              ),
                            );
                          }}
                          onBlur={(e) => void persistReceivedQty(comp, e.target.value)}
                        />
                        {recvDiff != null && comp.receivedVsBilled?.exceedsTolerance && (
                          <div className="text-[10px] text-muted-foreground mt-0.5">
                            ({recvDiff > 0 ? "+" : ""}{formatNum(recvDiff)}
                            {recvPct != null ? ` · ${recvPct.toFixed(1)}%` : ""})
                          </div>
                        )}
                        {comp.receivedDollar != null &&
                          comp.receivedVsBilled?.exceedsTolerance &&
                          Math.abs(comp.receivedDollar) > 0.005 && (
                            <div className="text-[10px] font-mono text-amber-700 dark:text-amber-300">
                              {comp.receivedDollar > 0 ? "Short " : "Over "}${formatNum(Math.abs(comp.receivedDollar))} at invoice price
                            </div>
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

      {/* Post Invoice result dialog (confirm_invoice_receipt) */}
      <Dialog open={!!confirmResult} onOpenChange={() => setConfirmResult(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-success">
              <CheckCircle className="h-5 w-5" />
              Invoice posted
            </DialogTitle>
          </DialogHeader>
          {confirmResult && (
            <div className="space-y-4">
              {confirmResult.already_confirmed ? (
                <div className="rounded-lg border bg-muted/20 px-3 py-2">
                  <p className="text-sm text-muted-foreground">
                    This invoice was already posted. No additional stock movements were applied.
                  </p>
                </div>
              ) : (
                <div className="rounded-lg border bg-muted/20 px-3 py-3 space-y-1.5">
                  <p className="text-sm text-muted-foreground">
                    {confirmResult.target_session_name ? (
                      <>
                        Posted quantities were synced to{" "}
                        <span className="font-semibold text-foreground">{confirmResult.target_session_name}</span>.
                      </>
                    ) : (
                      <>
                        Invoice posted. No mutable inventory session was available for in-session stock updates.
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
                    {updatedReceiptItems.map((i, idx) => (
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
                    {skippedReceiptItems.map((i, idx) => (
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
                      .filter(i => i.status === "no_catalog_match")
                      .map((i, idx) => (
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
          <p className="text-[11px] text-muted-foreground pt-3 border-t border-border/60 leading-relaxed">
            {STOCK_TRUTH_MESSAGE}
          </p>
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
