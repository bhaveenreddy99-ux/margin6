import type { PlanningUnitMeta } from "@/domain/inventory/zoneCounting";
import { buildReconciledSessionItemStock, type ZoneRowEntered } from "@/domain/inventory/zoneCounting";

/** User-visible copy when first zone upsert would replace an existing legacy total (Phase 3 must confirm). */
export const ZONE_UPSERT_LEGACY_STOCK_REQUIRES_ACK =
  "This line already has a stock total. Zone counts will replace that total. Confirm to continue.";

/**
 * First zone write on a line that still has a non-zero legacy `current_stock` needs an explicit ack
 * so operators do not silently drop the prior total.
 */
export function zoneUpsertRequiresLegacyAck(
  zoneRowCountBefore: number,
  currentStock: number | null | undefined,
): boolean {
  if (zoneRowCountBefore > 0) return false;
  if (currentStock == null) return false;
  const n = Number(currentStock);
  if (!Number.isFinite(n)) return false;
  return n !== 0;
}

/**
 * Parent `current_stock` in planning units from zone rows (entered fields) or legacy single qty.
 * All arithmetic is delegated to {@link buildReconciledSessionItemStock}.
 */
export function reconciledParentStockFromZoneRows(
  zoneRows: ReadonlyArray<{ entered_qty: number | string; entered_unit: string }>,
  meta: PlanningUnitMeta,
  parentCurrentStockWhenNoZones: number | null | undefined,
): number {
  const mapped: ZoneRowEntered[] = zoneRows.map((r) => ({
    entered_qty: Number(r.entered_qty),
    entered_unit: r.entered_unit,
  }));
  return buildReconciledSessionItemStock({
    zoneRows: mapped,
    itemMeta: meta,
    legacyCurrentStock: parentCurrentStockWhenNoZones,
  });
}

/**
 * Catalog ids that appear on more than one session parent row.
 * Phase 2 does not merge these: each `inventory_session_items` row has its own zones and
 * `current_stock`; smart order / totals may double-count until the session layout is fixed.
 */
export function catalogItemIdsWithDuplicateParentRows(
  sessionItems: ReadonlyArray<{ catalog_item_id?: string | null }>,
): string[] {
  const byCat = new Map<string, number>();
  for (const row of sessionItems) {
    const cid = row.catalog_item_id;
    if (!cid) continue;
    byCat.set(cid, (byCat.get(cid) ?? 0) + 1);
  }
  return [...byCat.entries()].filter(([, n]) => n > 1).map(([cid]) => cid);
}
