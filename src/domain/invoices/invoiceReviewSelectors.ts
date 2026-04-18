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

export function groupConfirmResultItems(confirmResult: ConfirmInvoiceReceiptResult | null) {
  const items = confirmResult?.items ?? [];

  return {
    updatedReceiptItems: items.filter(
      (item): item is ConfirmInvoiceReceiptItem =>
        item.status === "updated",
    ),
    skippedReceiptItems: items.filter(
      (item): item is ConfirmInvoiceReceiptItem =>
        item.status === "not_in_session" || item.status === "no_session",
    ),
  };
}
