import { useCallback, useEffect, useState, type Dispatch, type SetStateAction } from "react";
import { supabase } from "@/integrations/supabase/client";
import { buildParGuideLevelMaps } from "@/domain/inventory/parGuideLevels";
import { riskThresholdsFromSettings } from "@/domain/inventory/riskThresholds";
import {
  buildListSelectorMeta,
  buildSessionStats,
} from "@/domain/inventory/enterInventoryHelpers";
import type {
  InventoryCatalogItemRow,
  InventoryListRow,
  InventorySessionItemRow,
  InventorySessionListRow,
  ListSelectorMeta,
  ParGuideItemRow,
  ParGuideRow,
  ReminderWithListLocation,
  SessionStats,
} from "@/domain/inventory/enterInventoryTypes";
import type { RiskThresholds } from "@/lib/inventory-utils";

type UseEnterInventoryDataArgs = {
  currentRestaurantId: string | null | undefined;
  approvedFilter: string;
  selectedList: string;
  selectedPar: string;
  setSelectedPar: Dispatch<SetStateAction<string>>;
};

type SessionMetaRow = Pick<
  InventorySessionListRow,
  "inventory_list_id" | "counting_par_guide_id"
>;
type ListModeRow = Pick<InventoryListRow, "active_category_mode">;
type SmartOrderSettingsRow = {
  red_threshold: number | null;
  yellow_threshold: number | null;
};

export function useEnterInventoryData({
  currentRestaurantId,
  approvedFilter,
  selectedList,
  selectedPar,
  setSelectedPar,
}: UseEnterInventoryDataArgs) {
  const [lists, setLists] = useState<InventoryListRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [sessionsLoaded, setSessionsLoaded] = useState(false);
  const [listSelectorMeta, setListSelectorMeta] = useState<ListSelectorMeta>({});
  const [inProgressSessions, setInProgressSessions] = useState<InventorySessionListRow[]>([]);
  const [reviewSessions, setReviewSessions] = useState<InventorySessionListRow[]>([]);
  const [approvedSessions, setApprovedSessions] = useState<InventorySessionListRow[]>([]);
  const [sessionStats, setSessionStats] = useState<SessionStats>({});
  const [riskThresholds, setRiskThresholds] = useState<RiskThresholds>({
    redThresholdPercent: 50,
    yellowThresholdPercent: 100,
  });
  const [catalogItems, setCatalogItems] = useState<InventoryCatalogItemRow[]>([]);
  const [parGuides, setParGuides] = useState<ParGuideRow[]>([]);
  const [parItems, setParItems] = useState<ParGuideItemRow[]>([]);
  const [schedules, setSchedules] = useState<ReminderWithListLocation[]>([]);
  const [smartOrderParGuides, setSmartOrderParGuides] = useState<ParGuideRow[]>([]);
  const [parGuidesPickerOptions, setParGuidesPickerOptions] = useState<
    Array<Pick<ParGuideRow, "id" | "name" | "inventory_list_id">>
  >([]);
  const [countingParGuideName, setCountingParGuideName] = useState<string | null>(null);
  const [countingParByCatalogId, setCountingParByCatalogId] = useState<Record<string, number>>(
    {},
  );
  const [countingParByNormalizedName, setCountingParByNormalizedName] = useState<
    Record<string, number>
  >({});

  const fetchSchedules = useCallback(async () => {
    if (!currentRestaurantId) return;
    const { data } = (await supabase
      .from("reminders")
      .select("*, inventory_lists(name), locations(name)")
      .eq("restaurant_id", currentRestaurantId)
      .eq("is_enabled", true)
      .not("inventory_list_id", "is", null)) as unknown as {
      data: ReminderWithListLocation[] | null;
    };
    if (data) setSchedules(data);
  }, [currentRestaurantId]);

  const refreshLists = useCallback(async () => {
    if (!currentRestaurantId) return;

    setLoading(true);
    const [{ data: listData }, { data: catalogData }, { data: guideData }, { data: approvedData }] =
      await Promise.all([
        (supabase
          .from("inventory_lists")
          .select("*")
          .eq("restaurant_id", currentRestaurantId)) as unknown as Promise<{
          data: InventoryListRow[] | null;
        }>,
        (supabase
          .from("inventory_catalog_items")
          .select("id, inventory_list_id")
          .eq("restaurant_id", currentRestaurantId)) as unknown as Promise<{
          data: Array<Pick<InventoryCatalogItemRow, "id" | "inventory_list_id">> | null;
        }>,
        (supabase
          .from("par_guides")
          .select("id, inventory_list_id")
          .eq("restaurant_id", currentRestaurantId)) as unknown as Promise<{
          data: Array<Pick<ParGuideRow, "id" | "inventory_list_id">> | null;
        }>,
        (supabase
          .from("inventory_sessions")
          .select("inventory_list_id, approved_at")
          .eq("restaurant_id", currentRestaurantId)
          .eq("status", "APPROVED")
          .not("approved_at", "is", null)
          .order("approved_at", { ascending: false })) as unknown as Promise<{
          data: Array<Pick<InventorySessionListRow, "inventory_list_id" | "approved_at">> | null;
        }>,
      ]);

    setLists(listData ?? []);
    setListSelectorMeta(
      buildListSelectorMeta(listData ?? [], catalogData ?? [], guideData ?? [], approvedData ?? []),
    );
    setLoading(false);
  }, [currentRestaurantId]);

  const refreshSessions = useCallback(async () => {
    if (!currentRestaurantId) return;

    setLoading(true);
    setSessionsLoaded(false);

    const daysAgo = new Date();
    daysAgo.setDate(daysAgo.getDate() - parseInt(approvedFilter, 10));

    const sessionSelect = "*, inventory_lists(name), locations(name)";
    const [{ data: ip }, { data: rv }, { data: ap }] = await Promise.all([
      (supabase
        .from("inventory_sessions")
        .select(sessionSelect)
        .eq("restaurant_id", currentRestaurantId)
        .eq("status", "IN_PROGRESS")
        .order("updated_at", { ascending: false })) as unknown as Promise<{
        data: InventorySessionListRow[] | null;
      }>,
      (supabase
        .from("inventory_sessions")
        .select(sessionSelect)
        .eq("restaurant_id", currentRestaurantId)
        .eq("status", "IN_REVIEW")
        .order("updated_at", { ascending: false })) as unknown as Promise<{
        data: InventorySessionListRow[] | null;
      }>,
      (supabase
        .from("inventory_sessions")
        .select(sessionSelect)
        .eq("restaurant_id", currentRestaurantId)
        .eq("status", "APPROVED")
        .gte("approved_at", daysAgo.toISOString())
        .order("approved_at", { ascending: false })) as unknown as Promise<{
        data: InventorySessionListRow[] | null;
      }>,
    ]);

    const nextInProgress = ip ?? [];
    const nextReview = rv ?? [];
    const nextApproved = ap ?? [];

    setInProgressSessions(nextInProgress);
    setReviewSessions(nextReview);
    setApprovedSessions(nextApproved);

    const allSessions = [...nextInProgress, ...nextReview, ...nextApproved];
    if (allSessions.length > 0) {
      const { data: statsRaw } = (await supabase
        .from("inventory_session_items")
        .select("session_id, current_stock, unit_cost")
        .in(
          "session_id",
          allSessions.map((session) => session.id),
        )) as unknown as {
        data: Array<Pick<InventorySessionItemRow, "session_id" | "current_stock" | "unit_cost">> | null;
      };
      setSessionStats(buildSessionStats(statsRaw ?? []));
    } else {
      setSessionStats({});
    }

    setLoading(false);
    setSessionsLoaded(true);
  }, [approvedFilter, currentRestaurantId]);

  const loadLatestParGuide = useCallback(async (inventoryListId: string) => {
    const result = (await supabase
      .from("par_guides")
      .select("id")
      .eq("inventory_list_id", inventoryListId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle()) as unknown as {
      data: Pick<ParGuideRow, "id"> | null;
      error: { message: string } | null;
    };
    return result;
  }, []);

  const loadCatalogItemsForList = useCallback(
    async (inventoryListId: string) => {
      if (!currentRestaurantId) return [];
      const { data } = (await supabase
        .from("inventory_catalog_items")
        .select("*")
        .eq("restaurant_id", currentRestaurantId)
        .eq("inventory_list_id", inventoryListId)) as unknown as {
        data: InventoryCatalogItemRow[] | null;
      };
      return data ?? [];
    },
    [currentRestaurantId],
  );

  const loadParGuideItems = useCallback(async (parGuideId: string) => {
    const { data } = (await supabase
      .from("par_guide_items")
      .select("*")
      .eq("par_guide_id", parGuideId)) as unknown as {
      data: ParGuideItemRow[] | null;
    };
    return data ?? [];
  }, []);

  const loadEditorSnapshot = useCallback(
    async (session: InventorySessionListRow) => {
      const { data: sessionMeta } = (await supabase
        .from("inventory_sessions")
        .select("inventory_list_id, counting_par_guide_id")
        .eq("id", session.id)
        .maybeSingle()) as unknown as {
        data: SessionMetaRow | null;
      };

      const listId = (session.inventory_list_id || sessionMeta?.inventory_list_id || "").trim();
      const resolvedCountingParId =
        sessionMeta?.counting_par_guide_id ?? session.counting_par_guide_id ?? null;

      const listPromise = listId
        ? ((supabase
            .from("inventory_lists")
            .select("active_category_mode")
            .eq("id", listId)
            .maybeSingle()) as unknown as Promise<{ data: ListModeRow | null }>)
        : Promise.resolve({ data: null });
      const catalogPromise =
        currentRestaurantId && listId
          ? ((supabase
              .from("inventory_catalog_items")
              .select("*")
              .eq("restaurant_id", currentRestaurantId)
              .eq("inventory_list_id", listId)) as unknown as Promise<{
              data: InventoryCatalogItemRow[] | null;
            }>)
          : Promise.resolve({ data: null });

      const [{ data: sessionItems, error: itemsError }, listResult, catalogResult] =
        await Promise.all([
          (supabase
            .from("inventory_session_items")
            .select("*")
            .eq("session_id", session.id)) as unknown as Promise<{
            data: InventorySessionItemRow[] | null;
            error: { message: string } | null;
          }>,
          listPromise,
          catalogPromise,
        ]);

      return {
        listId,
        resolvedCountingParId,
        sessionItems: sessionItems ?? [],
        itemsError: itemsError?.message ?? null,
        activeCategoryMode: listResult.data?.active_category_mode ?? null,
        catalogItems: catalogResult.data ?? [],
      };
    },
    [currentRestaurantId],
  );

  const reloadSessionItems = useCallback(async (sessionId: string) => {
    const result = (await supabase
      .from("inventory_session_items")
      .select("*")
      .eq("session_id", sessionId)
      .order("item_name", { ascending: true })) as unknown as {
      data: InventorySessionItemRow[] | null;
      error: { message: string } | null;
    };
    return result;
  }, []);

  const hydrateCountingParMaps = useCallback(async (guideId: string | null) => {
    if (!guideId) {
      setCountingParGuideName(null);
      setCountingParByCatalogId({});
      setCountingParByNormalizedName({});
      return;
    }

    const { data: guideMeta } = (await supabase
      .from("par_guides")
      .select("name")
      .eq("id", guideId)
      .maybeSingle()) as unknown as {
      data: Pick<ParGuideRow, "name"> | null;
    };
    setCountingParGuideName(guideMeta?.name ?? null);

    const { data: guideItems } = (await supabase
      .from("par_guide_items")
      .select("item_name, par_level, catalog_item_id")
      .eq("par_guide_id", guideId)) as unknown as {
      data: Array<Pick<ParGuideItemRow, "item_name" | "par_level" | "catalog_item_id">> | null;
    };
    const maps = buildParGuideLevelMaps(guideItems ?? []);
    setCountingParByCatalogId(maps.byCatalogId);
    setCountingParByNormalizedName(maps.byNormalizedName);
  }, []);

  const loadParGuidePickerOptions = useCallback(
    async (sessionListId: string | null | undefined) => {
      if (!currentRestaurantId) return;
      const { data } = (await supabase
        .from("par_guides")
        .select("id, name, inventory_list_id")
        .eq("restaurant_id", currentRestaurantId)) as unknown as {
        data: Array<Pick<ParGuideRow, "id" | "name" | "inventory_list_id">> | null;
      };
      const sorted = [...(data ?? [])].sort((left, right) => {
        const leftMatch = left.inventory_list_id === sessionListId ? 0 : 1;
        const rightMatch = right.inventory_list_id === sessionListId ? 0 : 1;
        if (leftMatch !== rightMatch) return leftMatch - rightMatch;
        return (left.name || "").localeCompare(right.name || "");
      });
      setParGuidesPickerOptions(sorted);
    },
    [currentRestaurantId],
  );

  const loadSmartOrderParGuides = useCallback(
    async (inventoryListId: string) => {
      if (!currentRestaurantId) {
        setSmartOrderParGuides([]);
        return;
      }
      const { data } = (await supabase
        .from("par_guides")
        .select("*")
        .eq("restaurant_id", currentRestaurantId)
        .eq("inventory_list_id", inventoryListId)) as unknown as {
        data: ParGuideRow[] | null;
      };
      setSmartOrderParGuides(data ?? []);
    },
    [currentRestaurantId],
  );

  useEffect(() => {
    if (!currentRestaurantId) return;
    let cancelled = false;
    supabase
      .from("smart_order_settings")
      .select("red_threshold, yellow_threshold")
      .eq("restaurant_id", currentRestaurantId)
      .maybeSingle()
      .then(({ data }) => {
        if (!cancelled) setRiskThresholds(riskThresholdsFromSettings(data as SmartOrderSettingsRow | null));
      });
    return () => { cancelled = true; };
  }, [currentRestaurantId]);

  useEffect(() => {
    if (!currentRestaurantId) return;
    void refreshLists();
    void fetchSchedules();
  }, [currentRestaurantId, refreshLists, fetchSchedules]);

  useEffect(() => {
    if (!currentRestaurantId) return;
    void refreshSessions();
  }, [currentRestaurantId, refreshSessions]);

  useEffect(() => {
    if (!currentRestaurantId || !selectedList) {
      setParGuides([]);
      setSelectedPar("");
      return;
    }
    let cancelled = false;
    supabase
      .from("par_guides")
      .select("*")
      .eq("restaurant_id", currentRestaurantId)
      .eq("inventory_list_id", selectedList)
      .order("updated_at", { ascending: false })
      .then(({ data }) => {
        if (cancelled) return;
        const nextGuides = (data ?? []) as ParGuideRow[];
        setParGuides(nextGuides);
        setSelectedPar(nextGuides[0]?.id || "");
      });
    return () => { cancelled = true; };
  }, [currentRestaurantId, selectedList, setSelectedPar]);

  useEffect(() => {
    if (!selectedPar || selectedPar === "none") {
      setParItems([]);
      return;
    }

    supabase
      .from("par_guide_items")
      .select("*")
      .eq("par_guide_id", selectedPar)
      .then(({ data }) => {
        setParItems((data ?? []) as ParGuideItemRow[]);
      });
  }, [selectedPar]);

  return {
    lists,
    loading,
    sessionsLoaded,
    listSelectorMeta,
    inProgressSessions,
    reviewSessions,
    approvedSessions,
    sessionStats,
    riskThresholds,
    catalogItems,
    parGuides,
    parItems,
    schedules,
    smartOrderParGuides,
    parGuidesPickerOptions,
    countingParGuideName,
    countingParByCatalogId,
    countingParByNormalizedName,
    setCatalogItems,
    refreshLists,
    refreshSessions,
    loadCatalogItemsForList,
    loadLatestParGuide,
    loadParGuideItems,
    loadEditorSnapshot,
    reloadSessionItems,
    hydrateCountingParMaps,
    loadParGuidePickerOptions,
    loadSmartOrderParGuides,
  };
}
