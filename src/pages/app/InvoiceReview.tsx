import { useMemo, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useRestaurant } from "@/contexts/RestaurantContext";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { AlertTriangle, ArrowLeft, CheckCircle, DollarSign, Flag, Loader2, Package } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { formatNum } from "@/lib/inventory-utils";
import {
  buildCatalogById,
  buildDerivedComparisonRows,
  buildLineItemById,
  findFirstIncompleteComparisonId,
  summarizeInvoiceReview,
} from "@/domain/invoices/invoiceReviewSelectors";
import type { InvoiceReviewComparison } from "@/domain/invoices/invoiceReviewTypes";
import { useInvoiceReviewActions } from "@/hooks/useInvoiceReviewActions";
import { useInvoiceReviewData } from "@/hooks/useInvoiceReviewData";
import { ComparisonTable } from "@/features/invoice-review/components/ComparisonTable";
import { ConfirmReceiptDialog } from "@/features/invoice-review/components/ConfirmReceiptDialog";
import { ReportIssueSheet } from "@/features/invoice-review/components/ReportIssueSheet";

function receiptStatusBadge(status: string) {
  switch (status) {
    case "pending": return <Badge className="bg-warning/10 text-warning border-0 text-xs">Pending Review</Badge>;
    case "reviewing": return <Badge className="bg-blue-500/10 text-blue-600 border-0 text-xs">Reviewing</Badge>;
    case "confirmed": return <Badge className="bg-success/10 text-success border-0 text-xs">Confirmed</Badge>;
    case "issues_reported": return <Badge className="bg-orange-500/10 text-orange-600 border-0 text-xs">Issues Reported</Badge>;
    default: return null;
  }
}

export default function InvoiceReviewPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { currentRestaurant } = useRestaurant();

  const [catalogOverrides, setCatalogOverrides] = useState<Record<string, string>>({});
  const [confirmPostOpen, setConfirmPostOpen] = useState(false);
  const [reportSheetOpen, setReportSheetOpen] = useState(false);
  const [reportItem, setReportItem] = useState<InvoiceReviewComparison | null>(null);
  const [reportIssueType, setReportIssueType] = useState("short_shipped");
  const [reportNotes, setReportNotes] = useState("");

  const {
    invoice, setInvoice,
    invoiceItems, setInvoiceItems,
    poItems,
    comparisons, setComparisons,
    issues, setIssues,
    catalogItems,
    setVendorMappings,
    loading,
    reviewDocKind,
  } = useInvoiceReviewData({ id, currentRestaurantId: currentRestaurant?.id, navigate });

  const catalogById = useMemo(() => buildCatalogById(catalogItems), [catalogItems]);
  const lineItemById = useMemo(() => buildLineItemById(invoiceItems), [invoiceItems]);
  const comparisonRows = useMemo(() => buildDerivedComparisonRows(comparisons), [comparisons]);
  const firstIncompleteComparisonId = useMemo(
    () => findFirstIncompleteComparisonId(comparisons),
    [comparisons],
  );
  const { issueCount, invoiceTotal, reportedIssueCount, poLinked, poNum } = useMemo(
    () => summarizeInvoiceReview(invoice, invoiceItems, comparisonRows, issues),
    [comparisonRows, invoice, invoiceItems, issues],
  );

  const {
    confirmResult, setConfirmResult,
    confirming,
    handleConfirmReceipt,
    receivedMissingCount,
    receivedUnconfirmedCount,
    handleConfirmAllReceivedQty,
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

  const openReportIssue = (comp: InvoiceReviewComparison) => {
    setReportItem(comp);
    setReportIssueType("short_shipped");
    setReportNotes("");
    setTimeout(() => setReportSheetOpen(true), 0);
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
              <p className="text-xs text-warning font-medium">
                {receivedMissingCount} line{receivedMissingCount === 1 ? "" : "s"} still need a received quantity.
              </p>
              <p className="text-xs text-warning/80 mt-0.5">
                Type the amount delivered in the <span className="font-semibold">Received</span> column.
                {" "}If an item wasn't delivered at all, enter <span className="font-semibold">0</span> — leaving it blank counts as missing.
              </p>
              {firstIncompleteComparisonId && (
                <a
                  href={`#${firstIncompleteComparisonId}`}
                  className="mt-1 inline-block text-[11px] font-medium text-warning underline underline-offset-2"
                >
                  Jump to first incomplete line →
                </a>
              )}
            </div>
          )}
          <div className="flex items-center gap-2">
            {receiptStatusBadge(invoice?.receipt_status || "pending")}
            <Tooltip>
              <TooltipTrigger asChild>
                <span tabIndex={confirming || invoice?.receipt_status === "confirmed" || receivedMissingCount > 0 || receivedUnconfirmedCount > 0 ? 0 : undefined}>
                  <Button
                    size="sm"
                    variant="default"
                    className="gap-1.5"
                    disabled={confirming || invoice?.receipt_status === "confirmed" || receivedMissingCount > 0 || receivedUnconfirmedCount > 0}
                    onClick={() => setConfirmPostOpen(true)}
                  >
                    {confirming ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <CheckCircle className="h-3.5 w-3.5" />
                    )}
                    Post Invoice
                  </Button>
                </span>
              </TooltipTrigger>
              <TooltipContent side="left" className="max-w-xs text-xs">
                {confirming
                  ? "Saving…"
                  : invoice?.receipt_status === "confirmed"
                  ? "This invoice has already been posted."
                  : receivedMissingCount > 0
                  ? `Enter received quantities for all ${receivedMissingCount} remaining line${receivedMissingCount === 1 ? "" : "s"} before posting. Use 0 for items not delivered.`
                  : receivedUnconfirmedCount > 0
                  ? `${receivedUnconfirmedCount} received quantity${receivedUnconfirmedCount === 1 ? "" : "s"} are auto-filled and must be confirmed by a manager before posting.`
                  : "Post this invoice to confirm receipt."}
              </TooltipContent>
            </Tooltip>
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

      <ComparisonTable
        comparisonRows={comparisonRows}
        comparisons={comparisons}
        poItems={poItems}
        issues={issues}
        catalogItems={catalogItems}
        catalogById={catalogById}
        catalogOverrides={catalogOverrides}
        setCatalogOverrides={setCatalogOverrides}
        savingMappings={savingMappings}
        handleSaveMapping={handleSaveMapping}
        persistReceivedQty={persistReceivedQty}
        setComparisons={setComparisons}
        onReportIssue={openReportIssue}
        receivedUnconfirmedCount={receivedUnconfirmedCount}
        onConfirmAllReceived={handleConfirmAllReceivedQty}
      />

      <ReportIssueSheet
        open={reportSheetOpen}
        onOpenChange={setReportSheetOpen}
        reportItem={reportItem}
        issueType={reportIssueType}
        onIssueTypeChange={setReportIssueType}
        notes={reportNotes}
        onNotesChange={setReportNotes}
        saving={reportSaving}
        onSave={handleSaveIssue}
      />

      <ConfirmReceiptDialog
        alertOpen={confirmPostOpen}
        onAlertOpenChange={setConfirmPostOpen}
        lineItemCount={comparisons.length}
        issueCount={issueCount}
        onConfirm={() => { setConfirmPostOpen(false); void handleConfirmReceipt(); }}
        confirmResult={confirmResult}
        onResultClose={() => setConfirmResult(null)}
        onNavigateInventory={() => { setConfirmResult(null); navigate("/app/inventory"); }}
        onDone={() => { setConfirmResult(null); navigate("/app/invoices"); }}
      />
    </div>
  );
}
