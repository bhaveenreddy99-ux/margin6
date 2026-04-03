export type InvoiceHeaderTotals = {
  subtotal?: number | null;
  tax?: number | null;
  total?: number | null;
};

type LineLike = {
  quantity?: number | null;
  unit_cost?: number | null;
  total_cost?: number | null;
};

/**
 * Prefer persisted header total when present; otherwise sum line totals (or qty × unit_cost).
 */
export function resolveDocumentTotal(
  header: Partial<InvoiceHeaderTotals> | null | undefined,
  lineItems: LineLike[],
): number {
  const headerTotal = header?.total != null ? Number(header.total) : NaN;
  if (!Number.isNaN(headerTotal)) return headerTotal;

  return lineItems.reduce((sum, i) => {
    const line = i.total_cost != null ? Number(i.total_cost) : NaN;
    if (!Number.isNaN(line)) return sum + line;
    const q = Number(i.quantity) || 0;
    const u = Number(i.unit_cost) || 0;
    return sum + q * u;
  }, 0);
}
