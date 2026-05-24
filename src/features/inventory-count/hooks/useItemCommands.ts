import { useRef, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { DEFAULT_CATEGORIES } from "@/lib/constants";
import {
  isInventorySessionItemsCatalogIdSchemaError,
} from "@/domain/inventory/items/itemSeeding";
import { normalizeItemName } from "@/domain/inventory/items/itemView";
import {
  deleteZoneCountAndReconcileParent,
  isZoneWriteFailure,
  upsertZoneCountAndReconcileParent,
  writeLegacySessionItemStockAndClearZones,
  type LegacyStockConversionMeta,
  type ZoneWriteResult,
} from "@/features/inventory-count/inventoryZoneWritePipeline";
import type {
  InventoryCatalogItemRow,
  InventorySessionItemRow,
  InventorySessionListRow,
} from "@/domain/inventory/enterInventoryTypes";

type SessionStatus = InventorySessionListRow["status"];

function sessionLocked(status: SessionStatus | null | undefined) {
  return status === "IN_REVIEW" || status === "APPROVED";
}

function clientOffline() {
  return typeof navigator !== "undefined" && !navigator.onLine;
}

export type UpsertZoneCountCommandPayload = {
  sessionItem: InventorySessionItemRow;
  catalogItem: InventoryCatalogItemRow;
  listCategoryId: string;
  enteredQty: number;
  enteredUnit: string;
  acknowledgeReplacesLegacyTotal?: boolean;
};

export type SaveStockWithConversionPayload = {
  cases: number | null;
  countedAs: "cases" | "units" | "weight" | null;
  rawValue: number | null;
  formula: string | null;
};

type ItemCommandDeps = {
  activeSession: InventorySessionListRow | null;
  approvedParMap: Record<string, number>;
  onItemAdded: (item: InventorySessionItemRow) => void;
  onItemUpdated: (id: string, patch: Partial<InventorySessionItemRow>) => void;
  onItemRemoved: (id: string) => void;
  /** Snapshot before optimistic row updates — used to roll back on network failure. */
  getSessionItem: (id: string) => InventorySessionItemRow | undefined;
};

export function useItemCommands(deps: ItemCommandDeps) {
  const [savingId, setSavingId] = useState<string | null>(null);
  const [savedId, setSavedId] = useState<string | null>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function markSaved(id: string) {
    setSavedId(id);
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      setSavedId((prev) => (prev === id ? null : prev));
    }, 1500);
  }

  async function handleSaveStock(id: string, stockVal: number | null) {
    if (sessionLocked(deps.activeSession?.status)) return;
    if (clientOffline()) return;
    const prev = deps.getSessionItem(id);
    const patch: Partial<InventorySessionItemRow> = {
      current_stock: stockVal ?? null,
      inventory_session_item_zones: [],
    };
    if (stockVal === null) {
      patch.counted_as = null;
      patch.counted_value = null;
      patch.conversion_formula = null;
    } else if (stockVal === 0) {
      patch.counted_as = "cases";
      patch.counted_value = 0;
      patch.conversion_formula = null;
    }
    deps.onItemUpdated(id, patch);
    setSavingId(id);
    const result = await writeLegacySessionItemStockAndClearZones(id, stockVal ?? null);
    setSavingId(null);
    if (!result.ok) {
      toast.error("Could not save — tap to retry");
      if (prev) {
        deps.onItemUpdated(id, {
          current_stock: prev.current_stock,
          inventory_session_item_zones: prev.inventory_session_item_zones ?? [],
        });
      }
    } else markSaved(id);
  }

  async function handleSaveStockWithConversion(id: string, payload: SaveStockWithConversionPayload) {
    if (sessionLocked(deps.activeSession?.status)) return;
    if (clientOffline()) return;
    const stockVal = payload.cases;
    setSavingId(id);
    const prev = deps.getSessionItem(id);

    if (stockVal == null) {
      deps.onItemUpdated(id, {
        current_stock: 0,
        inventory_session_item_zones: [],
        counted_as: null,
        counted_value: null,
        conversion_formula: null,
      });
      const result = await writeLegacySessionItemStockAndClearZones(id, null);
      setSavingId(null);
      if (!result.ok) {
        toast.error("Could not save — tap to retry");
        if (prev) {
          deps.onItemUpdated(id, {
            current_stock: prev.current_stock,
            inventory_session_item_zones: prev.inventory_session_item_zones ?? [],
            counted_as: prev.counted_as,
            counted_value: prev.counted_value,
            conversion_formula: prev.conversion_formula,
          });
        }
      } else markSaved(id);
      return;
    }

    const meta: LegacyStockConversionMeta = {
      counted_as: payload.countedAs ?? "cases",
      counted_value: payload.rawValue ?? stockVal,
      conversion_formula: payload.formula,
    };
    deps.onItemUpdated(id, {
      current_stock: stockVal,
      inventory_session_item_zones: [],
      counted_as: meta.counted_as,
      counted_value: meta.counted_value,
      conversion_formula: meta.conversion_formula,
    });
    const result = await writeLegacySessionItemStockAndClearZones(id, stockVal, meta);
    setSavingId(null);
    if (!result.ok) {
      toast.error("Could not save — tap to retry");
      if (prev) {
        deps.onItemUpdated(id, {
          current_stock: prev.current_stock,
          inventory_session_item_zones: prev.inventory_session_item_zones ?? [],
          counted_as: prev.counted_as,
          counted_value: prev.counted_value,
          conversion_formula: prev.conversion_formula,
        });
      }
    } else markSaved(id);
  }

  async function handleSavePrice(id: string, cost: number | null) {
    if (sessionLocked(deps.activeSession?.status)) return;
    if (clientOffline()) return;
    setSavingId(id);
    const { error } = await supabase
      .from("inventory_session_items")
      .update({ unit_cost: cost })
      .eq("id", id);
    setSavingId(null);
    if (error) {
      toast.error("Could not save price");
    } else {
      deps.onItemUpdated(id, { unit_cost: cost });
      markSaved(id);
    }
  }

  async function handleClearRow(id: string) {
    if (sessionLocked(deps.activeSession?.status)) return;
    if (clientOffline()) return;
    const prev = deps.getSessionItem(id);
    deps.onItemUpdated(id, {
      current_stock: null,
      inventory_session_item_zones: [],
      counted_as: null,
      counted_value: null,
      conversion_formula: null,
    });
    setSavingId(id);
    const result = await writeLegacySessionItemStockAndClearZones(id, null);
    setSavingId(null);
    if (!result.ok) {
      toast.error("Could not clear");
      if (prev) {
        deps.onItemUpdated(id, {
          current_stock: prev.current_stock,
          inventory_session_item_zones: prev.inventory_session_item_zones ?? [],
        });
      }
    } else markSaved(id);
  }

  async function handleClearEntries(sessionId: string | null): Promise<boolean> {
    if (!sessionId) return false;
    if (clientOffline()) {
      toast.error("Reconnect to the network to clear entries.");
      return false;
    }
    const { data: rows, error: selErr } = await supabase
      .from("inventory_session_items")
      .select("id")
      .eq("session_id", sessionId);
    if (selErr) {
      toast.error(selErr.message);
      return false;
    }
    const ids = rows?.map((r) => r.id) ?? [];
    if (ids.length > 0) {
      const { error: zErr } = await supabase
        .from("inventory_session_item_zones")
        .delete()
        .in("session_item_id", ids);
      if (zErr) {
        toast.error(zErr.message);
        return false;
      }
    }
    // current_stock is NOT NULL — write 0 to "clear" (counted predicate is `> 0`).
    const { error } = await supabase
      .from("inventory_session_items")
      .update({
        current_stock: 0,
        counted_as: null,
        counted_value: null,
        conversion_formula: null,
      })
      .eq("session_id", sessionId);
    if (error) {
      toast.error(error.message);
      return false;
    }
    toast.success("All counts cleared.");
    return true;
  }

  async function handleAddItem(draft: {
    item_name: string;
    category: string;
    unit: string;
    current_stock: number;
    unit_cost: number;
  }) {
    if (!deps.activeSession || sessionLocked(deps.activeSession.status)) return;
    if (clientOffline()) {
      toast.error("Reconnect to add items.");
      return;
    }

    const payload = {
      session_id: deps.activeSession.id,
      item_name: draft.item_name,
      category: draft.category,
      unit: draft.unit,
      current_stock: draft.current_stock,
      par_level: deps.approvedParMap[normalizeItemName(draft.item_name)] ?? 0,
      unit_cost: draft.unit_cost || null,
    };

    const { data, error } = (await supabase
      .from("inventory_session_items")
      .insert(payload)
      .select()
      .single()) as unknown as {
      data: InventorySessionItemRow | null;
      error: { message: string } | null;
    };

    if (error || !data) { toast.error(error?.message ?? "Could not add item."); return; }
    deps.onItemAdded(data);
  }

  async function handleAddFromCatalog(catalogItem: InventoryCatalogItemRow) {
    if (!deps.activeSession || sessionLocked(deps.activeSession.status)) return;
    if (clientOffline()) {
      toast.error("Reconnect to add from catalog.");
      return;
    }

    const payload = {
      session_id: deps.activeSession.id,
      catalog_item_id: catalogItem.id,
      item_name: catalogItem.item_name,
      category: catalogItem.category || DEFAULT_CATEGORIES[0],
      unit: catalogItem.unit || "",
      current_stock: 0,
      par_level:
        deps.approvedParMap[normalizeItemName(catalogItem.item_name)] ??
        catalogItem.default_par_level ??
        0,
      unit_cost: catalogItem.default_unit_cost || 0,
      vendor_sku: catalogItem.product_number || catalogItem.vendor_sku || null,
      pack_size: catalogItem.pack_size || null,
      vendor_name: catalogItem.vendor_name || null,
      brand_name: catalogItem.brand_name || null,
    };

    let { data, error } = (await supabase
      .from("inventory_session_items")
      .insert(payload)
      .select()
      .single()) as unknown as {
      data: InventorySessionItemRow | null;
      error: { message: string } | null;
    };

    if (error && isInventorySessionItemsCatalogIdSchemaError(error.message)) {
      const { catalog_item_id: _omitted, ...legacyPayload } = payload;
      ({ data, error } = (await supabase
        .from("inventory_session_items")
        .insert(legacyPayload)
        .select()
        .single()) as unknown as {
        data: InventorySessionItemRow | null;
        error: { message: string } | null;
      });
    }

    if (error || !data) { toast.error(error?.message ?? "Could not add from catalog."); return; }
    deps.onItemAdded(data);
    toast.success(`Added ${catalogItem.item_name}`);
  }

  async function handleDeleteItem(id: string) {
    if (sessionLocked(deps.activeSession?.status)) return;
    if (clientOffline()) return;
    const { error } = await supabase.from("inventory_session_items").delete().eq("id", id);
    if (error) { toast.error(error.message); return; }
    deps.onItemRemoved(id);
  }

  async function upsertZoneCountForItem(
    payload: UpsertZoneCountCommandPayload,
  ): Promise<ZoneWriteResult> {
    if (sessionLocked(deps.activeSession?.status)) {
      return { ok: false, error: "Session is locked." };
    }
    if (clientOffline()) {
      return { ok: false, error: "You're offline. Reconnect to save zone counts." };
    }
    setSavingId(payload.sessionItem.id);
    const result = await upsertZoneCountAndReconcileParent({
      catalogItem: payload.catalogItem,
      sessionItem: {
        id: payload.sessionItem.id,
        current_stock: payload.sessionItem.current_stock,
        unit: payload.sessionItem.unit,
        pack_size: payload.sessionItem.pack_size,
      },
      listCategoryId: payload.listCategoryId,
      enteredQty: payload.enteredQty,
      enteredUnit: payload.enteredUnit,
      acknowledgeReplacesLegacyTotal: payload.acknowledgeReplacesLegacyTotal,
    });
    setSavingId(null);
    if (result.ok) {
      deps.onItemUpdated(payload.sessionItem.id, {
        current_stock: result.currentStock,
        inventory_session_item_zones: result.zoneRows,
      });
      markSaved(payload.sessionItem.id);
    }
    return result;
  }

  async function handleUpsertZoneCount(payload: UpsertZoneCountCommandPayload) {
    const result = await upsertZoneCountForItem(payload);
    if (isZoneWriteFailure(result)) toast.error(result.error);
  }

  async function handleDeleteZoneCount(payload: {
    sessionItem: InventorySessionItemRow;
    catalogItem: InventoryCatalogItemRow;
    listCategoryId: string;
  }) {
    if (sessionLocked(deps.activeSession?.status)) return;
    if (clientOffline()) return;
    setSavingId(payload.sessionItem.id);
    const result = await deleteZoneCountAndReconcileParent({
      catalogItem: payload.catalogItem,
      sessionItem: {
        id: payload.sessionItem.id,
        current_stock: payload.sessionItem.current_stock,
        unit: payload.sessionItem.unit,
        pack_size: payload.sessionItem.pack_size,
      },
      listCategoryId: payload.listCategoryId,
    });
    setSavingId(null);
    if (isZoneWriteFailure(result)) {
      toast.error(result.error);
      return;
    }
    deps.onItemUpdated(payload.sessionItem.id, {
      current_stock: result.currentStock,
      inventory_session_item_zones: result.zoneRows,
    });
    markSaved(payload.sessionItem.id);
  }

  async function handleSaveEditItemDetails(
    sessionItem: InventorySessionItemRow,
    form: { item_name: string; unit: string; pack_size: string },
  ) {
    const trimmed = (form.item_name || "").trim();
    if (!trimmed) { toast.error("Item name is required"); return; }
    if (clientOffline()) {
      toast.error("Reconnect to save item details.");
      return;
    }

    const unit = form.unit || null;
    const packSize = form.pack_size || null;

    const { error } = await supabase
      .from("inventory_session_items")
      .update({ item_name: trimmed, unit, pack_size: packSize })
      .eq("id", sessionItem.id);

    if (error) { toast.error(error.message); return; }

    deps.onItemUpdated(sessionItem.id, { item_name: trimmed, unit, pack_size: packSize });
    toast.success("Item details updated");
  }

  return {
    savingId,
    savedId,
    handleSaveStock,
    handleSaveStockWithConversion,
    handleSavePrice,
    handleClearRow,
    handleClearEntries,
    handleAddItem,
    handleAddFromCatalog,
    handleDeleteItem,
    handleSaveEditItemDetails,
    handleUpsertZoneCount,
    handleDeleteZoneCount,
    upsertZoneCountForItem,
  };
}
