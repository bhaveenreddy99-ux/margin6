/**
 * PostgREST `.or()` filter: rows that look like supplier invoices (not bare PO placeholders).
 * Use together with `invoice_status` filters where needed.
 */
export const INVOICE_DOCUMENT_FILTER =
  "invoice_number.not.is.null,pdf_url.not.is.null";

type PurchaseHistoryDateLike = {
  invoice_date?: string | null;
  created_at?: string | null;
};

/**
 * Prefer the business-facing invoice date when available. Date-only values are
 * interpreted at local noon to avoid timezone shifts around midnight.
 */
export function resolvePurchaseHistoryBusinessDate(
  row: PurchaseHistoryDateLike,
): Date {
  if (row.invoice_date) {
    const parsed = new Date(`${row.invoice_date}T12:00:00`);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }

  return new Date(row.created_at ?? 0);
}

export function isPurchaseHistoryInBusinessWindow(
  row: PurchaseHistoryDateLike,
  start: Date,
  end: Date,
): boolean {
  const businessDate = resolvePurchaseHistoryBusinessDate(row).getTime();
  return businessDate >= start.getTime() && businessDate <= end.getTime();
}
