/**
 * Single write path for zone counts: Supabase I/O + domain reconciliation only.
 *
 * Duplicate `inventory_session_items` rows sharing the same `catalog_item_id` are not merged.
 * Each parent row owns its zone lines and `current_stock`; callers should fix duplicate session
 * rows at the source or accept independent totals per row.
 */

import { supabase } from "@/integrations/supabase/client";
import type {
  InventoryCatalogItemRow,
  InventorySessionItemRow,
  InventorySessionItemZoneRow,
} from "@/domain/inventory/enterInventoryTypes";
import { resolvePlanningUnitMetaFromCatalogItem } from "@/domain/inventory/planningUnitMeta";
import {
  reconciledParentStockFromZoneRows,
  zoneUpsertRequiresLegacyAck,
  ZONE_UPSERT_LEGACY_STOCK_REQUIRES_ACK,
} from "@/domain/inventory/zoneReconcile";
import { normalizedQtyForZoneRow, type PlanningUnitMeta } from "@/domain/inventory/zoneCounting";
import {
  fetchSessionItemStock,
  fetchSessionItemZonesForSessionItem,
} from "@/features/inventory-count/queries/inventoryCountQueries";

export type ZoneCountSessionItemRef = Pick<
  InventorySessionItemRow,
  "id" | "current_stock" | "unit" | "pack_size"
>;

export type UpsertZoneCountPayload = {
  catalogItem: InventoryCatalogItemRow;
  sessionItem: ZoneCountSessionItemRef;
  listCategoryId: string;
  enteredQty: number;
  enteredUnit: string;
  /** Required when adding the first zone row while `current_stock` is non-zero (see {@link zoneUpsertRequiresLegacyAck}). */
  acknowledgeReplacesLegacyTotal?: boolean;
};

export type DeleteZoneCountPayload = {
  catalogItem: InventoryCatalogItemRow;
  sessionItem: ZoneCountSessionItemRef;
  listCategoryId: string;
};

type ZoneWriteOk = {
  ok: true;
  currentStock?: number;
  zoneRows?: InventorySessionItemZoneRow[];
};

export type ZoneWriteErrorCode = "legacy_ack_required";

type ZoneWriteErr = { ok: false; error: string; code?: ZoneWriteErrorCode };

export type ZoneWriteResult = ZoneWriteOk | ZoneWriteErr;

export type ZoneWriteFailure = Extract<ZoneWriteResult, { ok: false }>;

export function isZoneWriteFailure(r: ZoneWriteResult): r is ZoneWriteFailure {
  return r.ok === false;
}

export type LegacyStockConversionMeta = {
  counted_as: string | null;
  counted_value: number | null;
  conversion_formula: string | null;
};

/**
 * Legacy single-field stock write: clears all zone rows for the line, then sets `current_stock`.
 * Keeps one authoritative total (no zones + parent stock).
 * Optional `meta` sets conversion audit columns; omit for legacy stock-only updates.
 * Clearing stock (`null`) also clears conversion audit when `meta` is omitted.
 */
export async function writeLegacySessionItemStockAndClearZones(
  sessionItemId: string,
  stockVal: number | null,
  meta?: LegacyStockConversionMeta | null,
): Promise<{ ok: true } | ZoneWriteErr> {
  const { error: deleteError } = await supabase
    .from("inventory_session_item_zones")
    .delete()
    .eq("session_item_id", sessionItemId);

  if (deleteError) return { ok: false, error: deleteError.message };

  const patch: Record<string, number | string | null> = { current_stock: stockVal };
  if (meta !== undefined && meta !== null) {
    patch.counted_as = meta.counted_as;
    patch.counted_value = meta.counted_value;
    patch.conversion_formula = meta.conversion_formula;
  } else if (stockVal === null) {
    patch.counted_as = null;
    patch.counted_value = null;
    patch.conversion_formula = null;
  }

  const { error: updateError } = await supabase
    .from("inventory_session_items")
    .update(patch)
    .eq("id", sessionItemId);

  if (updateError) return { ok: false, error: updateError.message };

  return { ok: true };
}

async function reconcileParentAfterZoneMutation(
  sessionItemId: string,
  meta: PlanningUnitMeta,
): Promise<ZoneWriteResult> {
  const [{ data: zones, error: zonesError }, { data: parent, error: parentError }] =
    await Promise.all([
      fetchSessionItemZonesForSessionItem(sessionItemId),
      fetchSessionItemStock(sessionItemId),
    ]);

  if (zonesError) return { ok: false, error: zonesError.message };
  if (parentError) return { ok: false, error: parentError.message };
  if (!parent) return { ok: false, error: "Session item not found." };

  const newStock = reconciledParentStockFromZoneRows(
    zones ?? [],
    meta,
    parent.current_stock ?? null,
  );

  const { error: updateError } = await supabase
    .from("inventory_session_items")
    .update({ current_stock: newStock })
    .eq("id", sessionItemId);

  if (updateError) return { ok: false, error: updateError.message };

  return { ok: true, currentStock: newStock, zoneRows: zones ?? [] };
}

/** Avoid PostgREST `.upsert` + `onConflict` (often 400 if the unique index is missing or not in the API cache). */
async function insertOrUpdateZoneRow(args: {
  session_item_id: string;
  list_category_id: string;
  entered_qty: number;
  entered_unit: string;
  normalized_qty: number;
  updated_at: string;
}): Promise<{ error: { message: string; code?: string } | null }> {
  const { data: existing, error: findErr } = await supabase
    .from("inventory_session_item_zones")
    .select("id")
    .eq("session_item_id", args.session_item_id)
    .eq("list_category_id", args.list_category_id)
    .maybeSingle();

  if (findErr) {
    return { error: findErr };
  }

  if (existing) {
    const { error: updateErr } = await supabase
      .from("inventory_session_item_zones")
      .update({
        entered_qty: args.entered_qty,
        entered_unit: args.entered_unit,
        normalized_qty: args.normalized_qty,
        updated_at: args.updated_at,
      })
      .eq("id", existing.id);
    return { error: updateErr };
  }

  const { error: insertErr } = await supabase.from("inventory_session_item_zones").insert({
    session_item_id: args.session_item_id,
    list_category_id: args.list_category_id,
    entered_qty: args.entered_qty,
    entered_unit: args.entered_unit,
    normalized_qty: args.normalized_qty,
    updated_at: args.updated_at,
  });

  if (insertErr && insertErr.code === "23505") {
    const { error: afterRace } = await supabase
      .from("inventory_session_item_zones")
      .update({
        entered_qty: args.entered_qty,
        entered_unit: args.entered_unit,
        normalized_qty: args.normalized_qty,
        updated_at: args.updated_at,
      })
      .eq("session_item_id", args.session_item_id)
      .eq("list_category_id", args.list_category_id);
    return { error: afterRace };
  }

  return { error: insertErr };
}

export async function upsertZoneCountAndReconcileParent(
  payload: UpsertZoneCountPayload,
): Promise<ZoneWriteResult> {
  const [{ data: existingZones, error: zonesReadError }, { data: parentRow, error: parentReadError }] =
    await Promise.all([
      fetchSessionItemZonesForSessionItem(payload.sessionItem.id),
      fetchSessionItemStock(payload.sessionItem.id),
    ]);

  if (zonesReadError) return { ok: false, error: zonesReadError.message };
  if (parentReadError) return { ok: false, error: parentReadError.message };

  const zoneCountBefore = existingZones?.length ?? 0;
  const stockForAck = parentRow?.current_stock ?? payload.sessionItem.current_stock;

  if (
    zoneUpsertRequiresLegacyAck(zoneCountBefore, stockForAck) &&
    !payload.acknowledgeReplacesLegacyTotal
  ) {
    return {
      ok: false,
      error: ZONE_UPSERT_LEGACY_STOCK_REQUIRES_ACK,
      code: "legacy_ack_required",
    };
  }

  const meta = resolvePlanningUnitMetaFromCatalogItem(payload.catalogItem, payload.sessionItem);
  if (!meta) {
    return {
      ok: false,
      error: "Missing unit or pack size — cannot convert zone counts to cases.",
    };
  }

  const normalized_qty = normalizedQtyForZoneRow(
    payload.enteredQty,
    payload.enteredUnit,
    meta,
  );
  const nowIso = new Date().toISOString();

  const { error: writeErr } = await insertOrUpdateZoneRow({
    session_item_id: payload.sessionItem.id,
    list_category_id: payload.listCategoryId,
    entered_qty: payload.enteredQty,
    entered_unit: payload.enteredUnit.trim(),
    normalized_qty,
    updated_at: nowIso,
  });

  if (writeErr) return { ok: false, error: writeErr.message };

  return reconcileParentAfterZoneMutation(payload.sessionItem.id, meta);
}

export async function deleteZoneCountAndReconcileParent(
  payload: DeleteZoneCountPayload,
): Promise<ZoneWriteResult> {
  const meta = resolvePlanningUnitMetaFromCatalogItem(payload.catalogItem, payload.sessionItem);
  if (!meta) {
    return {
      ok: false,
      error: "Missing unit or pack size — cannot reconcile after zone delete.",
    };
  }

  const { error: deleteError } = await supabase
    .from("inventory_session_item_zones")
    .delete()
    .eq("session_item_id", payload.sessionItem.id)
    .eq("list_category_id", payload.listCategoryId);

  if (deleteError) return { ok: false, error: deleteError.message };

  return reconcileParentAfterZoneMutation(payload.sessionItem.id, meta);
}
