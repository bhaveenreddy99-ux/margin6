import { useCallback, useEffect, useState } from "react";
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
  ReminderWithListLocation,
  SessionStats,
} from "@/domain/inventory/enterInventoryTypes";
import type { RiskThresholds } from "@/lib/inventory-utils";
import type { SmartOrderSettingsRow, UseInventoryCountDataArgs } from "@/features/inventory-count/types";
import {
  fetchApprovedSessionDates,
  fetchCatalogItemsForList,
  fetchInventoryCatalogListLinks,
  fetchInventoryListMode,
  fetchInventoryLists,
  fetchInventorySchedules,
  fetchInventorySessionStats,
  fetchInventorySessionsByStatus,
  fetchLatestParGuide,
  fetchParGuideItems,
  fetchParGuideLevelRows,
  fetchParGuideListLinks,
  fetchParGuideName,
  fetchParGuidePickerOptions,
  fetchSessionItems,
  fetchSessionItemsByName,
  fetchSessionMeta,
  fetchSmartOrderParGuides,
  fetchSmartOrderSettings,
} from "@/features/inventory-count/queries/inventoryCountQueries";

import { useInventoryCountParListState } from "@/features/inventory-count/hooks/useInventoryCountParListState";

export function useInventoryCountData({
  currentRestaurantId,
  approvedFilter,
  selectedList,
  selectedPar,
  setSelectedPar,
}: UseInventoryCountDataArgs) {
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
  const { parGuides, parItems } = useInventoryCountParListState({
    currentRestaurantId,
    selectedList,
    selectedPar,
    setSelectedPar,
  });
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
    const { data } = await fetchInventorySchedules(currentRestaurantId);
    if (data) setSchedules(data);
  }, [currentRestaurantId]);

  const refreshLists = useCallback(async () => {
    if (!currentRestaurantId) return;

    setLoading(true);
    const [{ data: listData }, { data: catalogData }, { data: guideData }, { data: approvedData }] =
      await Promise.all([
        fetchInventoryLists(currentRestaurantId),
        fetchInventoryCatalogListLinks(currentRestaurantId),
        fetchParGuideListLinks(currentRestaurantId),
        fetchApprovedSessionDates(currentRestaurantId),
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

    const [{ data: ip }, { data: rv }, { data: ap }] = await Promise.all([
      fetchInventorySessionsByStatus(currentRestaurantId, "IN_PROGRESS"),
      fetchInventorySessionsByStatus(currentRestaurantId, "IN_REVIEW"),
      fetchInventorySessionsByStatus(currentRestaurantId, "APPROVED", daysAgo.toISOString()),
    ]);

    const nextInProgress = ip ?? [];
    const nextReview = rv ?? [];
    const nextApproved = ap ?? [];

    setInProgressSessions(nextInProgress);
    setReviewSessions(nextReview);
    setApprovedSessions(nextApproved);

    const allSessions = [...nextInProgress, ...nextReview, ...nextApproved];
    if (allSessions.length > 0) {
      const { data: statsRaw } = await fetchInventorySessionStats(
        allSessions.map((session) => session.id),
      );
      setSessionStats(buildSessionStats(statsRaw ?? []));
    } else {
      setSessionStats({});
    }

    setLoading(false);
    setSessionsLoaded(true);
  }, [approvedFilter, currentRestaurantId]);

  const loadLatestParGuide = useCallback(async (inventoryListId: string) => {
    return fetchLatestParGuide(inventoryListId);
  }, []);

  const loadCatalogItemsForList = useCallback(
    async (inventoryListId: string) => {
      if (!currentRestaurantId) return [];
      const { data } = await fetchCatalogItemsForList(currentRestaurantId, inventoryListId);
      return data ?? [];
    },
    [currentRestaurantId],
  );

  const loadParGuideItems = useCallback(async (parGuideId: string) => {
    const { data } = await fetchParGuideItems(parGuideId);
    return data ?? [];
  }, []);

  const loadEditorSnapshot = useCallback(
    async (session: InventorySessionListRow) => {
      const { data: sessionMeta } = await fetchSessionMeta(session.id);

      const listId = (session.inventory_list_id || sessionMeta?.inventory_list_id || "").trim();
      const resolvedCountingParId =
        sessionMeta?.counting_par_guide_id ?? session.counting_par_guide_id ?? null;

      const listPromise = listId
        ? fetchInventoryListMode(listId)
        : Promise.resolve({ data: null });
      const catalogPromise =
        currentRestaurantId && listId
          ? fetchCatalogItemsForList(currentRestaurantId, listId)
          : Promise.resolve({ data: null });

      const [{ data: sessionItems, error: itemsError }, listResult, catalogResult] =
        await Promise.all([fetchSessionItems(session.id), listPromise, catalogPromise]);

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
    return fetchSessionItemsByName(sessionId);
  }, []);

  const hydrateCountingParMaps = useCallback(async (guideId: string | null) => {
    if (!guideId) {
      setCountingParGuideName(null);
      setCountingParByCatalogId({});
      setCountingParByNormalizedName({});
      return;
    }

    const [{ data: guideMeta }, { data: guideItems }] = await Promise.all([
      fetchParGuideName(guideId),
      fetchParGuideLevelRows(guideId),
    ]);
    setCountingParGuideName(guideMeta?.name ?? null);

    const maps = buildParGuideLevelMaps(guideItems ?? []);
    setCountingParByCatalogId(maps.byCatalogId);
    setCountingParByNormalizedName(maps.byNormalizedName);
  }, []);

  const loadParGuidePickerOptions = useCallback(
    async (sessionListId: string | null | undefined) => {
      if (!currentRestaurantId) return;
      const { data } = await fetchParGuidePickerOptions(currentRestaurantId);
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
      const { data } = await fetchSmartOrderParGuides(currentRestaurantId, inventoryListId);
      setSmartOrderParGuides(data ?? []);
    },
    [currentRestaurantId],
  );

  useEffect(() => {
    if (!currentRestaurantId) return;
    let cancelled = false;
    fetchSmartOrderSettings(currentRestaurantId).then(({ data }) => {
      if (!cancelled) {
        setRiskThresholds(riskThresholdsFromSettings(data as SmartOrderSettingsRow | null));
      }
    });
    return () => {
      cancelled = true;
    };
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
