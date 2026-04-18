import type { InvoiceListRow, InvoiceStatusFilter } from "@/domain/invoices/invoicesPageTypes";

export const MAIN_INVOICE_STATUS_UI: Record<
  "DRAFT" | "PENDING_REVIEW" | "POSTED",
  { label: string; color: string; bgColor: string }
> = {
  DRAFT: { label: "Draft", color: "text-warning", bgColor: "bg-warning/10 border-warning/20" },
  PENDING_REVIEW: { label: "Pending Review", color: "text-primary", bgColor: "bg-primary/10 border-primary/20" },
  POSTED: { label: "Posted", color: "text-success", bgColor: "bg-success/10 border-success/20" },
};

export function matchesInvoiceStatusFilter(
  invoice: InvoiceListRow,
  statusFilter: InvoiceStatusFilter,
): boolean {
  if (statusFilter === "all") return true;
  const status = invoice.status || "review";
  if (statusFilter === "draft") return status === "draft";
  if (statusFilter === "pending_review") return status === "review" || status === "ready_to_receive";
  if (statusFilter === "posted") return status === "confirmed" || status === "COMPLETE";
  return false;
}

export function filterInvoices(
  purchases: InvoiceListRow[],
  searchFilter: string,
  statusFilter: InvoiceStatusFilter,
) {
  let filtered = purchases;
  if (searchFilter) {
    const lower = searchFilter.toLowerCase();
    filtered = filtered.filter(
      (purchase) =>
        (purchase.vendor_name || "").toLowerCase().includes(lower) ||
        (purchase.invoice_number || "").toLowerCase().includes(lower),
    );
  }
  return filtered.filter((purchase) => matchesInvoiceStatusFilter(purchase, statusFilter));
}

export function summarizeInvoices(purchases: InvoiceListRow[]) {
  const draftCount = purchases.filter((purchase) => purchase.status === "draft").length;
  const receivedCount = purchases.filter(
    (purchase) => purchase.status === "review" || purchase.status === "ready_to_receive",
  ).length;
  const pendingReviewCount = purchases.filter(
    (purchase) =>
      purchase.status !== "confirmed" &&
      (!purchase.receipt_status ||
        purchase.receipt_status === "pending" ||
        purchase.receipt_status === "reviewing"),
  ).length;

  return {
    draftCount,
    receivedCount,
    pendingReviewCount,
    activeVendors: new Set(purchases.map((purchase) => purchase.vendor_name).filter(Boolean)).size,
    lastInvoiceDate: purchases.length > 0 ? purchases[0].created_at : null,
  };
}

export function resolveMainInvoiceStatusKey(status: string | null | undefined) {
  const value = status || "";
  if (value === "draft") return "DRAFT" as const;
  if (value === "review" || value === "ready_to_receive") return "PENDING_REVIEW" as const;
  if (value === "confirmed" || value === "COMPLETE") return "POSTED" as const;
  return "POSTED" as const;
}
