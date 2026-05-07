import { analyzeInvoiceComparison } from "@/lib/invoice-comparison";
import { resolveDocumentTotal } from "@/lib/invoice-totals";
import type {
  ConfirmInvoiceReceiptItem,
  ConfirmInvoiceReceiptResult,
  InvoiceReviewCatalogItem,
  InvoiceReviewComparison,
  InvoiceReviewDocument,
  InvoiceReviewIssue,
  InvoiceReviewLineItem,
} from "@/domain/invoices/invoiceReviewTypes";

type ComparisonAnalysis = ReturnType<typeof analyzeInvoiceComparison>;

export type InvoiceReviewDerivedComparisonRow = InvoiceReviewComparison & {
  derived_status: ComparisonAnalysis["status"];
  qtyAnalysis: ComparisonAnalysis["qty"];
  priceAnalysis: ComparisonAnalysis["price"];
  totalAnalysis: ComparisonAnalysis["total"];
  receivedVsBilled: ComparisonAnalysis["receivedVsBilled"];
  receivedDollar: ComparisonAnalysis["receivedDollar"];
};

export function buildCatalogById(
  catalogItems: InvoiceReviewCatalogItem[],
): Record<string, InvoiceReviewCatalogItem> {
  return catalogItems.reduce<Record<string, InvoiceReviewCatalogItem>>((acc, catalogItem) => {
    acc[catalogItem.id] = catalogItem;
    return acc;
  }, {});
}

export function buildLineItemById(
  invoiceItems: InvoiceReviewLineItem[],
): Record<string, InvoiceReviewLineItem> {
  return invoiceItems.reduce<Record<string, InvoiceReviewLineItem>>((acc, item) => {
    acc[item.id] = item;
    return acc;
  }, {});
}

export function buildDerivedComparisonRows(
  comparisons: InvoiceReviewComparison[],
): InvoiceReviewDerivedComparisonRow[] {
  return comparisons.map((comparison) => {
    const analysis = analyzeInvoiceComparison(comparison);
    return {
      ...comparison,
      derived_status: analysis.status,
      qtyAnalysis: analysis.qty,
      priceAnalysis: analysis.price,
      totalAnalysis: analysis.total,
      receivedVsBilled: analysis.receivedVsBilled,
      receivedDollar: analysis.receivedDollar,
    };
  });
}

export function summarizeInvoiceReview(
  invoice: InvoiceReviewDocument | null,
  invoiceItems: InvoiceReviewLineItem[],
  comparisonRows: InvoiceReviewDerivedComparisonRow[],
  issues: InvoiceReviewIssue[],
) {
  return {
    issueCount: comparisonRows.filter((comparison) => comparison.derived_status !== "ok").length,
    invoiceTotal: resolveDocumentTotal(invoice as { total?: number | null } | null, invoiceItems),
    reportedIssueCount: issues.length,
    poLinked: Boolean(invoice?.purchase_order_id),
    poNum: invoice?.purchase_orders?.po_number?.trim() || "",
  };
}

export function countMissingReceivedQty(comparisons: InvoiceReviewComparison[]): number {
  return comparisons.filter((c) => {
    const invoicedQty = Number(c.invoiced_qty);
    return c.received_qty == null && Number.isFinite(invoicedQty) && invoicedQty > 0;
  }).length;
}

/**
 * Rows where received_qty was auto-filled from invoiced_qty and has not yet been
 * explicitly confirmed by a manager. These block receipt confirmation (Phase 4).
 */
export function countUnconfirmedReceivedQty(comparisons: InvoiceReviewComparison[]): number {
  return comparisons.filter((c) => {
    const invoicedQty = Number(c.invoiced_qty);
    if (!Number.isFinite(invoicedQty) || invoicedQty <= 0) return false;
    if (c.status === "missing_from_invoice") return false;
    return c.received_qty_confirmed === false || c.received_qty_confirmed == null;
  }).length;
}

export function findFirstIncompleteComparisonId(
  comparisons: InvoiceReviewComparison[],
): string | null {
  return (
    comparisons.find((c) => {
      const invoicedQty = Number(c.invoiced_qty);
      return c.received_qty == null && Number.isFinite(invoicedQty) && invoicedQty > 0;
    })?.id ?? null
  );
}

/**
 * Groups `confirm_invoice_receipt` RPC line items by status.
 * RPC stock-movement path emits: confirmed | already_confirmed | unit_conversion_failed | no_catalog_match.
 */
export function groupConfirmResultItems(confirmResult: ConfirmInvoiceReceiptResult | null) {
  const items = confirmResult?.items ?? [];

  return {
    postedStockItems: items.filter(
      (item): item is ConfirmInvoiceReceiptItem => item.status === "confirmed",
    ),
    conversionFailedItems: items.filter(
      (item): item is ConfirmInvoiceReceiptItem => item.status === "unit_conversion_failed",
    ),
  };
}
