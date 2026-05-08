import { useRef, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useRestaurant } from "@/contexts/RestaurantContext";
import {
  approveInventorySession,
  createInventorySession,
  duplicateInventorySession,
  moveApprovedInventorySessionToReview,
  sendInventorySessionBackToInProgress,
  submitInventorySessionForReview,
} from "@/domain/inventory/sessionWorkflow";
import { createSmartOrderFromSession } from "@/domain/inventory/smartOrderFromSession";
import { buildParOnlySeedRows } from "@/domain/inventory/items/itemSeeding";
import {
  buildCatalogSeedRows,
  isInventorySessionItemsCatalogIdSchemaError,
} from "@/domain/inventory/items/itemSeeding";
import { dedupeSessionItemsByCatalogOrName, sessionRowsToItemState } from "@/domain/inventory/items/itemView";
import type {
  InventoryCatalogItemRow,
  InventorySessionItemRow,
  InventorySessionListRow,
  ParGuideItemRow,
  ParGuideRow,
} from "@/domain/inventory/enterInventoryTypes";
import type { RiskThresholds } from "@/lib/inventory-utils";

function clientOffline() {
  return typeof navigator !== "undefined" && !navigator.onLine;
}

type SessionCommandDeps = {
  currentRestaurantId: string | null | undefined;
  userId: string | null | undefined;
  activeSession: InventorySessionListRow | null;
  selectedList: string;
  parItems: ParGuideItemRow[];
  riskThresholds: RiskThresholds;
  navigateTo: (path: string) => void;
  refreshSessions: () => Promise<void>;
  loadCatalogItemsForList: (listId: string) => Promise<InventoryCatalogItemRow[]>;
  loadLatestParGuide: (listId: string) => Promise<{
    data: Pick<ParGuideRow, "id"> | null;
    error: { message: string } | null;
  }>;
  loadParGuideItems: (guideId: string) => Promise<ParGuideItemRow[]>;
  loadEditorSnapshot: (session: InventorySessionListRow) => Promise<{
    listId: string;
    resolvedCountingParId: string | null;
    sessionItems: InventorySessionItemRow[];
    itemsError: string | null;
    activeCategoryMode: string | null;
    catalogItems: InventoryCatalogItemRow[];
  }>;
  reloadSessionItems: (sessionId: string) => Promise<{
    data: InventorySessionItemRow[] | null;
    error: { message: string } | null;
  }>;
  hydrateCountingParMaps: (guideId: string | null) => Promise<void>;
  loadSmartOrderParGuides: (listId: string) => Promise<void>;
  // Callbacks to update editor state after mutations
  onSessionOpened: (args: {
    session: InventorySessionListRow;
    listId: string;
    items: InventorySessionItemRow[];
    catalogItems: InventoryCatalogItemRow[];
    categoryMode: string;
    countingParGuideId: string | null;
  }) => void;
  onSessionClosed: () => void;
  onListSelected: (listId: string) => void;
};

export function useSessionCommands(deps: SessionCommandDeps) {
  const { currentLocation } = useRestaurant();
  const isApprovingRef = useRef(false);
  const submitForReviewInFlight = useRef(false);
  const [startingListId, setStartingListId] = useState<string | null>(null);
  const [submittingForReview, setSubmittingForReview] = useState(false);

  async function seedSessionFromCatalog(
    sessionId: string,
    inventoryListId: string,
  ): Promise<{ ok: boolean; count: number; errorMessage?: string }> {
    const loadedCatalog = await deps.loadCatalogItemsForList(inventoryListId);
    const latestGuideResult = await deps.loadLatestParGuide(inventoryListId);
    if (latestGuideResult.error) toast.error(`Could not load PAR guide: ${latestGuideResult.error.message}`);

    const latestParItems = latestGuideResult.data
      ? await deps.loadParGuideItems(latestGuideResult.data.id)
      : [];

    const { withCatalog, withoutCatalog } = buildCatalogSeedRows({
      sessionId,
      catalogItems: loadedCatalog,
      parGuideItems: latestParItems,
    });

    if (withCatalog.length === 0) return { ok: true, count: 0 };

    let { data: inserted, error: insertError } = (await supabase
      .from("inventory_session_items")
      .insert(withCatalog)
      .select("id")) as unknown as {
      data: Array<{ id: string }> | null;
      error: { message: string } | null;
    };

    if (insertError && isInventorySessionItemsCatalogIdSchemaError(insertError.message)) {
      console.log("[SessionCommands] Retrying seed without catalog_item_id");
      ({ data: inserted, error: insertError } = (await supabase
        .from("inventory_session_items")
        .insert(withoutCatalog)
        .select("id")) as unknown as {
        data: Array<{ id: string }> | null;
        error: { message: string } | null;
      });
    }

    if (insertError) return { ok: false, count: 0, errorMessage: insertError.message };
    return { ok: true, count: inserted?.length ?? 0 };
  }

  async function openEditor(session: InventorySessionListRow) {
    if (session.status && session.status !== "IN_PROGRESS") {
      sessionStorage.removeItem("inv_active_session");
      toast.info("Only in-progress counts can be edited here. Use Review for submitted sessions.");
      return;
    }
    if (!session.id) {
      toast.error("Invalid session — could not open count.");
      return;
    }

    sessionStorage.setItem("inv_active_session", session.id);

    let resolvedCountingParId: string | null = null;
    try {
      resolvedCountingParId = sessionStorage.getItem(`inv_counting_par_guide_${session.id}`);
    } catch {
      // ignore
    }

    const snapshot = await deps.loadEditorSnapshot(session);
    const listId = snapshot.listId;
    resolvedCountingParId = snapshot.resolvedCountingParId ?? resolvedCountingParId;

    if (snapshot.itemsError) toast.error(snapshot.itemsError);

    let sessionItems = snapshot.sessionItems;
    const shouldTrySeed =
      !!deps.currentRestaurantId &&
      !!listId &&
      (!session.status || session.status === "IN_PROGRESS") &&
      sessionItems.length === 0;

    if (shouldTrySeed) {
      const seedResult = await seedSessionFromCatalog(session.id, listId);
      if (!seedResult.ok && seedResult.errorMessage) {
        toast.error(seedResult.errorMessage);
      } else if (seedResult.count > 0) {
        const reloadResult = await deps.reloadSessionItems(session.id);
        if (reloadResult.error) toast.error(reloadResult.error.message);
        else sessionItems = reloadResult.data ?? [];
      }
    }

    const itemState = sessionRowsToItemState(dedupeSessionItemsByCatalogOrName(sessionItems));

    let categoryMode = "list_order";
    if (snapshot.activeCategoryMode) {
      const dbMode = snapshot.activeCategoryMode;
      if (dbMode === "ai" || dbMode === "custom-categories" || dbMode === "custom_ai") {
        categoryMode = "custom-categories";
      } else if (dbMode === "user" || dbMode === "my-categories" || dbMode === "user_manual") {
        categoryMode = "my-categories";
      } else if (dbMode === "list_order") {
        categoryMode = "list_order";
      } else if (dbMode === "recently_purchased") {
        categoryMode = "recently_purchased";
      }
    }

    let guideIdForHydration = resolvedCountingParId;
    if (!guideIdForHydration && listId && deps.currentRestaurantId) {
      const latestGuide = await deps.loadLatestParGuide(listId);
      if (latestGuide.error) toast.error(`Could not load PAR guide: ${latestGuide.error.message}`);
      if (latestGuide.data?.id) guideIdForHydration = latestGuide.data.id;
    }

    await deps.hydrateCountingParMaps(guideIdForHydration);

    deps.onSessionOpened({
      session: { ...session, inventory_list_id: listId, counting_par_guide_id: guideIdForHydration },
      listId,
      items: itemState.itemOrder.map((id) => itemState.itemById[id]).filter(Boolean),
      catalogItems: snapshot.catalogItems,
      categoryMode,
      countingParGuideId: guideIdForHydration,
    });
  }

  async function createSessionForList(listId: string, name: string) {
    if (!deps.currentRestaurantId || !deps.userId || !listId || !name.trim()) return;
    const listIdTrimmed = listId.trim();
    setStartingListId(listIdTrimmed);

    try {
      const { data, error } = await createInventorySession({
        supabase,
        restaurantId: deps.currentRestaurantId,
        inventoryListId: listIdTrimmed,
        name: name.trim(),
        userId: deps.userId,
        locationId: currentLocation?.id ?? null,
      });

      if (error || !data) {
        toast.error(error?.message ?? "Could not create session.");
        return;
      }

      const catalogSeed = await seedSessionFromCatalog(data.id, listIdTrimmed);
      if (!catalogSeed.ok) toast.error(catalogSeed.errorMessage || "Could not copy list items.");

      if (catalogSeed.count === 0) {
        let resolvedParItems = deps.selectedList === listIdTrimmed ? deps.parItems : [];
        if (resolvedParItems.length === 0) {
          const latestGuide = await deps.loadLatestParGuide(listIdTrimmed);
          if (latestGuide.error) toast.error(`Could not load PAR guide: ${latestGuide.error.message}`);
          if (latestGuide.data) resolvedParItems = await deps.loadParGuideItems(latestGuide.data.id);
        }
        if (resolvedParItems.length > 0) {
          const { error: insertError } = await supabase
            .from("inventory_session_items")
            .insert(buildParOnlySeedRows(data.id, resolvedParItems));
          if (insertError) toast.error(insertError.message);
        }
      }

      toast.success("Session created — start entering counts");
      deps.onListSelected(listIdTrimmed);
      await openEditor(data);
    } finally {
      setStartingListId(null);
    }
  }

  async function handleSubmitForReview() {
    if (submittingForReview || submitForReviewInFlight.current) return;
    if (!deps.activeSession || deps.activeSession.status !== "IN_PROGRESS") return;
    if (clientOffline()) {
      toast.error("Connect to the network to submit for review.");
      return;
    }
    submitForReviewInFlight.current = true;
    setSubmittingForReview(true);
    try {
      // Server-side idempotency: submitInventorySessionForReview only updates rows still IN_PROGRESS
      // (see updateInventorySessionStatus + expectedCurrentStatus).
      const result = await submitInventorySessionForReview({ supabase, sessionId: deps.activeSession.id });
      if (!result.ok) {
        toast.error(result.errorMessage);
        return;
      }
      toast.success("Submitted for review!");
      sessionStorage.removeItem("inv_active_session");
      deps.onSessionClosed();
      void deps.refreshSessions();
    } finally {
      submitForReviewInFlight.current = false;
      setSubmittingForReview(false);
    }
  }

  async function handleApprove(sessionId: string) {
    if (!deps.currentRestaurantId || !deps.userId || isApprovingRef.current) return;
    isApprovingRef.current = true;
    try {
      const result = await approveInventorySession({
        supabase,
        sessionId,
        restaurantId: deps.currentRestaurantId,
        userId: deps.userId,
        riskThresholds: deps.riskThresholds,
      });
      if (!result.ok) { toast.error(result.errorMessage || "Approval failed. Please try again."); return; }
      if (result.smartOrderErrorMessage) toast.error(result.smartOrderErrorMessage);
      if (result.smartOrderRunId) {
        toast.success("Session approved", {
          description: "Smart order draft created.",
          action: {
            label: "Open Smart Order",
            onClick: () => deps.navigateTo(`/app/smart-order?viewRun=${result.smartOrderRunId}`),
          },
        });
      } else {
        toast.success("Session approved!");
      }
      if (result.catalogLinksStripped) {
        toast.info("Saved order lines; some catalog links were cleared due to invalid references.");
      }
      await deps.refreshSessions();
    } catch {
      toast.error("Could not approve count — check your connection and try again.");
    } finally {
      isApprovingRef.current = false;
    }
  }

  async function handleReject(sessionId: string) {
    const result = await sendInventorySessionBackToInProgress({ supabase, sessionId });
    if (!result.ok) toast.error(result.errorMessage);
    else { toast.success("Session sent back"); await deps.refreshSessions(); }
  }

  async function handleDeclineToReview(sessionId: string) {
    const result = await moveApprovedInventorySessionToReview({ supabase, sessionId });
    if (!result.ok) toast.error(result.errorMessage);
    else { toast.success("Session moved back to Review"); await deps.refreshSessions(); }
  }

  async function handleDeleteSession(sessionId: string | null) {
    if (!sessionId) return;
    await supabase.from("inventory_session_items").delete().eq("session_id", sessionId);
    const { error } = await supabase.from("inventory_sessions").delete().eq("id", sessionId).eq("restaurant_id", deps.currentRestaurantId);
    if (error) { toast.error(error.message); return; }
    toast.success("Session deleted");
    sessionStorage.removeItem("inv_active_session");
    if (deps.activeSession?.id === sessionId) deps.onSessionClosed();
    void deps.refreshSessions();
  }

  async function handleClearInProgressSession(sessionId: string | null) {
    if (!sessionId) return;
    await supabase.from("inventory_session_items").delete().eq("session_id", sessionId);
    const { error } = await supabase.from("inventory_sessions").delete().eq("id", sessionId);
    if (error) { toast.error(error.message); return; }
    toast.success("Cleared — start a fresh count when you're ready");
    sessionStorage.removeItem("inv_active_session");
    if (deps.activeSession?.id === sessionId) deps.onSessionClosed();
    void deps.refreshSessions();
  }

  async function handleDuplicate(session: InventorySessionListRow) {
    if (!deps.currentRestaurantId || !deps.userId) return;
    const result = await duplicateInventorySession({
      supabase,
      restaurantId: deps.currentRestaurantId,
      sourceSession: session,
      userId: deps.userId,
      fallbackLocationId: currentLocation?.id ?? null,
    });
    if (!result.ok || !result.data) { toast.error(result.errorMessage ?? "Could not duplicate."); return; }
    toast.success("Session duplicated");
    await deps.refreshSessions();
  }

  async function handleCreateSmartOrder(
    smartOrderSession: InventorySessionListRow,
    parGuideId: string,
  ) {
    if (!deps.currentRestaurantId || !deps.userId) return;
    const result = await createSmartOrderFromSession({
      supabase,
      sessionId: smartOrderSession.id,
      restaurantId: deps.currentRestaurantId,
      userId: deps.userId,
      riskThresholds: deps.riskThresholds,
      parGuideId,
      mode: "manual",
    });
    if (!result.runId) { toast.error(result.errorMessage ?? "Could not create smart order."); return; }
    if (result.catalogLinksStripped) {
      toast.info("Saved order lines; some catalog links were cleared due to invalid references.");
    }
    toast.success("Smart order created — submit from Smart Order to generate the purchase order.");
    deps.navigateTo(`/app/smart-order?viewRun=${result.runId}`);
  }

  return {
    startingListId,
    submittingForReview,
    openEditor,
    createSessionForList,
    handleSubmitForReview,
    handleApprove,
    handleReject,
    handleDeclineToReview,
    handleDeleteSession,
    handleClearInProgressSession,
    handleDuplicate,
    handleCreateSmartOrder,
  };
}
