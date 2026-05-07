/**
 * Builds a map of catalog_item_id → most recent confirmed
 * invoice unit_cost. Mirrors the buildCostMaps pattern in
 * useRecipeData.ts. Call with confirmed invoice lines
 * pre-sorted by confirmed_at DESC (most recent first).
 */
export type InvoiceCostMap = Map<string, number>;

export function buildInvoiceCostMap(
  lines: Array<{
    catalog_item_id: string | null;
    unit_cost: number | null;
    invoice_id: string;
  }>,
  invoiceOrder: string[],
): InvoiceCostMap {
  const map = new Map<string, number>();
  const idxOf = new Map(invoiceOrder.map((id, i) => [id, i] as [string, number]));
  const sorted = [...lines].sort(
    (a, b) => (idxOf.get(a.invoice_id) ?? 999) - (idxOf.get(b.invoice_id) ?? 999),
  );
  for (const line of sorted) {
    if (!line.catalog_item_id || line.unit_cost == null) continue;
    if (!map.has(line.catalog_item_id)) {
      map.set(line.catalog_item_id, Number(line.unit_cost));
    }
  }
  return map;
}
