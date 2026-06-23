import { useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { createMemberNotifications } from "@/domain/notifications/createMemberNotifications";
import { normalizeItemName } from "@/domain/inventory/items/itemView";
import type {
  InventoryCatalogItemRow,
  InventorySessionItemRow,
  InventorySessionListRow,
  ParGuideItemRow,
  ParGuideRow,
  ProfileRow,
} from "@/domain/inventory/enterInventoryTypes";
import type { Json } from "@/integrations/supabase/types";

type ManagerCommandDeps = {
  currentRestaurantId: string | null | undefined;
  userId: string | null | undefined;
  activeSession: InventorySessionListRow | null;
  countingParGuideId: string | null;
  getApprovedPar: (item: InventorySessionItemRow) => number;
  getCatalogUnitCost: (catalogItemId: string | null | undefined) => number | null;
  hydrateCountingParMaps: (guideId: string | null) => Promise<void>;
  loadSmartOrderParGuides: (listId: string) => Promise<void>;
  // Form state passed in (read-only)
  editItemDetailsSessionItem: InventorySessionItemRow | null;
  editItemDetailsForm: { item_name: string; unit: string; pack_size: string };
  staffParRequestItem: InventorySessionItemRow | null;
  staffParSuggested: string;
  staffParReason: string;
  staffPriceRequestItem: InventorySessionItemRow | null;
  staffPriceSuggested: string;
  staffPriceReason: string;
  managerParEditItem: InventorySessionItemRow | null;
  managerParInput: string;
  managerPriceEditItem: InventorySessionItemRow | null;
  managerPriceInput: string;
  // Callbacks — keep state ownership in useSessionEditor / useInventoryCountData
  onItemUpdated: (id: string, patch: Partial<InventorySessionItemRow>) => void;
  onCatalogItemsUpdated: (
    updater: (prev: InventoryCatalogItemRow[]) => InventoryCatalogItemRow[],
  ) => void;
  onParGuideApplied: (guideId: string) => void;
  onSmartOrderModalOpened: (session: InventorySessionListRow) => void;
  onEditItemDetailsClosed: () => void;
  onStaffParRequestClosed: () => void;
  onStaffPriceRequestClosed: () => void;
  onManagerParEditClosed: () => void;
  onManagerPriceEditClosed: () => void;
};

export function useManagerCommands(deps: ManagerCommandDeps) {
  const [editItemDetailsSaving, setEditItemDetailsSaving] = useState(false);
  const [staffParSending, setStaffParSending] = useState(false);
  const [staffPriceSending, setStaffPriceSending] = useState(false);
  const [managerParSaving, setManagerParSaving] = useState(false);
  const [managerPriceSaving, setManagerPriceSaving] = useState(false);

  async function buildOwnerManagerRecipientIds(): Promise<string[]> {
    if (!deps.currentRestaurantId) return [];
    const { data: members } = (await supabase
      .from("restaurant_members")
      .select("user_id, role")
      .eq("restaurant_id", deps.currentRestaurantId)) as unknown as {
      data: Array<{ user_id: string; role: string }> | null;
    };
    const ids = (members ?? [])
      .filter((m) => m.role === "OWNER" || m.role === "MANAGER")
      .map((m) => m.user_id);
    return [...new Set(ids)];
  }

  async function resolveParGuideIdForManagerEdits(): Promise<string | null> {
    if (deps.countingParGuideId) return deps.countingParGuideId;
    const listId = deps.activeSession?.inventory_list_id;
    if (!listId || !deps.currentRestaurantId) return null;
    const { data } = (await supabase
      .from("par_guides")
      .select("id")
      .eq("restaurant_id", deps.currentRestaurantId)
      .eq("inventory_list_id", listId)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle()) as unknown as { data: Pick<ParGuideRow, "id"> | null };
    return data?.id ?? null;
  }

  async function persistSessionCountingParGuide(
    sessionId: string,
    guideId: string | null,
  ) {
    try {
      if (guideId) sessionStorage.setItem(`inv_counting_par_guide_${sessionId}`, guideId);
      else sessionStorage.removeItem(`inv_counting_par_guide_${sessionId}`);
    } catch {
      // ignore
    }
    const { error } = await supabase
      .from("inventory_sessions")
      .update({ counting_par_guide_id: guideId, updated_at: new Date().toISOString() })
      .eq("id", sessionId);
    if (error && /counting_par_guide|schema cache|column/i.test(error.message)) {
      console.log("[ManagerCommands] counting_par_guide_id update skipped:", error.message);
    }
  }

  async function applyParGuideSelection(guideId: string) {
    if (!deps.activeSession?.id || !deps.currentRestaurantId) return;
    await persistSessionCountingParGuide(deps.activeSession.id, guideId);
    deps.onParGuideApplied(guideId);
    await deps.hydrateCountingParMaps(guideId);
    toast.success("PAR guide applied for this count");
  }

  function openSmartOrderModal(session: InventorySessionListRow) {
    deps.onSmartOrderModalOpened(session);
    void deps.loadSmartOrderParGuides(session.inventory_list_id);
  }

  async function handleSaveEditItemDetails() {
    if (!deps.editItemDetailsSessionItem || !deps.currentRestaurantId) return;
    const trimmed = (deps.editItemDetailsForm.item_name || "").trim();
    if (!trimmed) { toast.error("Item name is required"); return; }

    setEditItemDetailsSaving(true);
    const unit = deps.editItemDetailsForm.unit || null;
    const packSize = deps.editItemDetailsForm.pack_size || null;

    const { error: sessionError } = await supabase
      .from("inventory_session_items")
      .update({ item_name: trimmed, unit, pack_size: packSize })
      .eq("id", deps.editItemDetailsSessionItem.id);
    if (sessionError) {
      toast.error(sessionError.message);
      setEditItemDetailsSaving(false);
      return;
    }

    if (deps.editItemDetailsSessionItem.catalog_item_id) {
      const { error: catalogError } = await supabase
        .from("inventory_catalog_items")
        .update({ item_name: trimmed, unit, pack_size: packSize, updated_at: new Date().toISOString() })
        .eq("id", deps.editItemDetailsSessionItem.catalog_item_id);
      if (catalogError) {
        toast.error(catalogError.message);
        setEditItemDetailsSaving(false);
        return;
      }
      const catalogId = deps.editItemDetailsSessionItem.catalog_item_id;
      deps.onCatalogItemsUpdated((prev) =>
        prev.map((item) =>
          item.id === catalogId ? { ...item, item_name: trimmed, unit, pack_size: packSize } : item,
        ),
      );
    }

    deps.onItemUpdated(deps.editItemDetailsSessionItem.id, { item_name: trimmed, unit, pack_size: packSize });

    if (deps.countingParGuideId) {
      await deps.hydrateCountingParMaps(deps.countingParGuideId);
    }

    toast.success("Item details updated");
    deps.onEditItemDetailsClosed();
    setEditItemDetailsSaving(false);
  }

  async function handleStaffParChangeRequestSubmit() {
    if (!deps.staffParRequestItem || !deps.userId || !deps.currentRestaurantId || !deps.activeSession?.id) return;
    const suggested = parseFloat(deps.staffParSuggested);
    if (!Number.isFinite(suggested) || suggested < 0) {
      toast.error("Enter a valid suggested PAR");
      return;
    }

    setStaffParSending(true);
    const recipientIds = await buildOwnerManagerRecipientIds();
    if (recipientIds.length === 0) {
      toast.error("No managers or owners found to notify");
      setStaffParSending(false);
      return;
    }

    const { data: profile } = (await supabase
      .from("profiles")
      .select("full_name, email")
      .eq("id", deps.userId)
      .maybeSingle()) as unknown as { data: Pick<ProfileRow, "full_name" | "email"> | null };
    const staffName = profile?.full_name || profile?.email || "A team member";
    const currentPar = deps.getApprovedPar(deps.staffParRequestItem);
    const reasonText = deps.staffParReason.trim() || "—";

    const { error } = await createMemberNotifications(supabase, {
      restaurantId: deps.currentRestaurantId!,
      recipientIds,
      type: "PAR_CHANGE_REQUEST",
      severity: "INFO",
      title: "PAR change requested",
      message: `${staffName} suggested changing ${deps.staffParRequestItem!.item_name} PAR from ${currentPar} to ${suggested}. Reason: ${reasonText}`,
      data: {
        item_name: deps.staffParRequestItem!.item_name,
        current_par: currentPar,
        suggested_par: suggested,
        reason: deps.staffParReason.trim() || null,
        session_id: deps.activeSession!.id,
        requested_by: deps.userId,
      } as Json,
    });
    setStaffParSending(false);
    if (error) { toast.error(error.message); return; }
    toast.success("PAR change request sent to your manager");
    deps.onStaffParRequestClosed();
  }

  async function handleStaffPriceChangeRequestSubmit() {
    if (!deps.staffPriceRequestItem || !deps.userId || !deps.currentRestaurantId || !deps.activeSession?.id) return;
    const suggested = parseFloat(deps.staffPriceSuggested);
    if (!Number.isFinite(suggested) || suggested < 0) {
      toast.error("Enter a valid suggested price");
      return;
    }

    setStaffPriceSending(true);
    const recipientIds = await buildOwnerManagerRecipientIds();
    if (recipientIds.length === 0) {
      toast.error("No managers or owners found to notify");
      setStaffPriceSending(false);
      return;
    }

    const { data: profile } = (await supabase
      .from("profiles")
      .select("full_name, email")
      .eq("id", deps.userId)
      .maybeSingle()) as unknown as { data: Pick<ProfileRow, "full_name" | "email"> | null };
    const staffName = profile?.full_name || profile?.email || "A team member";
    const sessionPrice = deps.staffPriceRequestItem.unit_cost;
    const currentPrice =
      sessionPrice != null && Number.isFinite(Number(sessionPrice))
        ? Number(sessionPrice)
        : deps.getCatalogUnitCost(deps.staffPriceRequestItem.catalog_item_id);
    const currentLabel = currentPrice != null ? `$${currentPrice.toFixed(2)}` : "—";
    const reasonText = deps.staffPriceReason.trim() || "—";

    const { error } = await createMemberNotifications(supabase, {
      restaurantId: deps.currentRestaurantId!,
      recipientIds,
      type: "PRICE_CHANGE_REQUEST",
      severity: "INFO",
      title: "Price change requested",
      message: `${staffName} suggested changing ${deps.staffPriceRequestItem!.item_name} unit price from ${currentLabel} to $${suggested.toFixed(2)}. Reason: ${reasonText}`,
      data: {
        item_name: deps.staffPriceRequestItem!.item_name,
        current_price: currentPrice,
        suggested_price: suggested,
        reason: deps.staffPriceReason.trim() || null,
        session_id: deps.activeSession!.id,
        requested_by: deps.userId,
      } as Json,
    });
    setStaffPriceSending(false);
    if (error) { toast.error(error.message); return; }
    toast.success("Price change request sent to your manager");
    deps.onStaffPriceRequestClosed();
  }

  async function handleManagerParLevelSave() {
    if (!deps.managerParEditItem || !deps.currentRestaurantId) return;
    const nextPar = parseFloat(deps.managerParInput);
    if (!Number.isFinite(nextPar) || nextPar < 0) {
      toast.error("Enter a valid PAR level");
      return;
    }

    setManagerParSaving(true);
    const guideId = await resolveParGuideIdForManagerEdits();
    if (!guideId) {
      toast.error("No PAR guide linked to this list");
      setManagerParSaving(false);
      return;
    }

    const { data: guideRows } = (await supabase
      .from("par_guide_items")
      .select("id, item_name, catalog_item_id")
      .eq("par_guide_id", guideId)) as unknown as {
      data: Array<Pick<ParGuideItemRow, "id" | "item_name" | "catalog_item_id">> | null;
    };
    const key = normalizeItemName(deps.managerParEditItem.item_name);
    const match =
      (deps.managerParEditItem.catalog_item_id
        ? (guideRows ?? []).find(
            (r) => r.catalog_item_id === deps.managerParEditItem!.catalog_item_id,
          )
        : undefined) ??
      (guideRows ?? []).find((r) => normalizeItemName(r.item_name) === key);
    if (!match) {
      toast.error("No PAR line for this item in the linked guide");
      setManagerParSaving(false);
      return;
    }

    const { error: guideError } = await supabase
      .from("par_guide_items")
      .update({
        par_level: nextPar,
        ...(deps.managerParEditItem.catalog_item_id
          ? { catalog_item_id: deps.managerParEditItem.catalog_item_id }
          : {}),
      })
      .eq("id", match.id);
    if (guideError) {
      toast.error(guideError.message);
      setManagerParSaving(false);
      return;
    }

    if (deps.managerParEditItem.catalog_item_id) {
      const { error: catalogError } = await supabase
        .from("inventory_catalog_items")
        .update({ default_par_level: nextPar, updated_at: new Date().toISOString() })
        .eq("id", deps.managerParEditItem.catalog_item_id);
      if (catalogError) {
        toast.error(catalogError.message);
        setManagerParSaving(false);
        return;
      }
      const catalogId = deps.managerParEditItem.catalog_item_id;
      deps.onCatalogItemsUpdated((prev) =>
        prev.map((item) =>
          item.id === catalogId ? { ...item, default_par_level: nextPar } : item,
        ),
      );
    }

    if (deps.countingParGuideId === guideId) {
      await deps.hydrateCountingParMaps(deps.countingParGuideId);
    }

    toast.success("PAR level updated");
    deps.onManagerParEditClosed();
    setManagerParSaving(false);
  }

  async function handleManagerPriceSave() {
    if (!deps.managerPriceEditItem) return;
    const price =
      deps.managerPriceInput === "" ? null : parseFloat(deps.managerPriceInput);
    if (price != null && (!Number.isFinite(price) || price < 0)) {
      toast.error("Enter a valid price");
      return;
    }

    setManagerPriceSaving(true);
    const { error: sessionError } = await supabase
      .from("inventory_session_items")
      .update({ unit_cost: price })
      .eq("id", deps.managerPriceEditItem.id);
    if (sessionError) {
      toast.error(sessionError.message);
      setManagerPriceSaving(false);
      return;
    }

    if (deps.managerPriceEditItem.catalog_item_id) {
      const { error: catalogError } = await supabase
        .from("inventory_catalog_items")
        .update({ default_unit_cost: price, updated_at: new Date().toISOString() })
        .eq("id", deps.managerPriceEditItem.catalog_item_id);
      if (catalogError) {
        toast.error(catalogError.message);
        setManagerPriceSaving(false);
        return;
      }
      const catalogId = deps.managerPriceEditItem.catalog_item_id;
      deps.onCatalogItemsUpdated((prev) =>
        prev.map((item) =>
          item.id === catalogId ? { ...item, default_unit_cost: price } : item,
        ),
      );
    }

    deps.onItemUpdated(deps.managerPriceEditItem.id, { unit_cost: price });
    toast.success("Price updated");
    deps.onManagerPriceEditClosed();
    setManagerPriceSaving(false);
  }

  return {
    editItemDetailsSaving,
    staffParSending,
    staffPriceSending,
    managerParSaving,
    managerPriceSaving,
    applyParGuideSelection,
    openSmartOrderModal,
    handleSaveEditItemDetails,
    handleStaffParChangeRequestSubmit,
    handleStaffPriceChangeRequestSubmit,
    handleManagerParLevelSave,
    handleManagerPriceSave,
  };
}
