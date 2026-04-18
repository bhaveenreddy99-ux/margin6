import { useEffect, useRef, useState } from "react";
import { startOfDay } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import { riskThresholdsFromSettings } from "@/domain/inventory/riskThresholds";
import {
  buildInventoryTrendData,
  buildLatestInventorySnapshot,
  countPendingInvoices,
  dashboardSpendRangeFromFilter,
  invoiceBusinessDateInRange,
  isInvoiceLineComparisonProblem,
  linePriceIncreaseImpact,
  sumPeriodInvoiceSpend,
} from "@/domain/dashboard/dashboardSelectors";
import type {
  DashboardInvoiceStatusRow,
  DashboardTimeFilter,
  InventoryCatalogDefaultCostRow,
  InventorySessionItemRow,
  InventorySessionRow,
  InventoryTrendSessionRow,
  InvoiceLineComparisonRow,
  PortfolioDashboardResponse,
  SingleDashboardData,
  SmartOrderSettingsRow,
  SpendInvoiceItemCostRow,
  SpendInvoiceRow,
  SpendOverviewData,
  SpendPurchaseHistoryItemCostRow,
  SpendPurchaseHistoryRow,
  WasteLogPeriodRow,
  WasteLogSnapshotRow,
} from "@/domain/dashboard/dashboardTypes";
import { computePARRecommendations, computeUsageAnalytics } from "@/lib/usage-analytics";
import { resolvePurchaseHistoryBusinessDate } from "@/lib/purchase-history-source";
import { fetchInvoiceDocumentIdsForRestaurant } from "@/lib/procurement-dedupe";
import { dollarsForWasteRow, hasReliableWasteCost } from "@/domain/waste/recordedWasteValue";

type UseDashboardDataArgs = {
  currentRestaurantId: string | null | undefined;
  currentLocationId: string | null | undefined;
  timeFilter: DashboardTimeFilter;
};

async function fetchSpendOverviewData(
  restaurantId: string,
  locationId: string | undefined,
  timeFilter: DashboardTimeFilter,
): Promise<SpendOverviewData> {
  const { startDate, endDate } = dashboardSpendRangeFromFilter(timeFilter);
  const rangeStart = new Date(startDate);
  const rangeEnd = new Date(endDate);

  const inSpendWindow = (row: { invoice_date?: string | null; created_at?: string | null }) => {
    const businessDate = resolvePurchaseHistoryBusinessDate(row);
    return businessDate >= rangeStart && businessDate <= rangeEnd;
  };

  const invoiceDocIds = await fetchInvoiceDocumentIdsForRestaurant(restaurantId);

  let invoiceQuery = supabase
    .from("invoices")
    .select("id, vendor_name, created_at, invoice_date")
    .eq("restaurant_id", restaurantId)
    .eq("status", "confirmed");

  if (locationId) {
    invoiceQuery = invoiceQuery.eq("location_id", locationId);
  }

  const { data: invoiceSpendRows } = (await invoiceQuery) as unknown as {
    data: SpendInvoiceRow[] | null;
  };
  const invoicesInPeriod = (invoiceSpendRows ?? []).filter(inSpendWindow);
  const invoiceIdsInPeriod = invoicesInPeriod.map((row) => row.id);

  const costByDocumentId: Record<string, number> = {};
  if (invoiceIdsInPeriod.length > 0) {
    const { data: invoiceLineCosts } = (await supabase
      .from("invoice_items")
      .select("invoice_id, total_cost")
      .in("invoice_id", invoiceIdsInPeriod)) as unknown as {
      data: SpendInvoiceItemCostRow[] | null;
    };
    (invoiceLineCosts ?? []).forEach((row) => {
      costByDocumentId[row.invoice_id] = (costByDocumentId[row.invoice_id] || 0) + Number(row.total_cost || 0);
    });
  }

  let purchaseHistoryQuery = supabase
    .from("purchase_history")
    .select("id, vendor_name, created_at, invoice_date")
    .eq("restaurant_id", restaurantId)
    .in("invoice_status", ["COMPLETE", "POSTED"]);

  if (locationId) {
    purchaseHistoryQuery = purchaseHistoryQuery.eq("location_id", locationId);
  }

  const { data: purchaseHistoryRows } = (await purchaseHistoryQuery) as unknown as {
    data: SpendPurchaseHistoryRow[] | null;
  };
  const filteredPurchaseHistory = (purchaseHistoryRows ?? [])
    .filter((row) => !invoiceDocIds.has(row.id))
    .filter(inSpendWindow);

  if (filteredPurchaseHistory.length > 0) {
    const purchaseHistoryIds = filteredPurchaseHistory.map((row) => row.id);
    const { data: purchaseHistoryItemCosts } = (await supabase
      .from("purchase_history_items")
      .select("purchase_history_id, total_cost")
      .in("purchase_history_id", purchaseHistoryIds)) as unknown as {
      data: SpendPurchaseHistoryItemCostRow[] | null;
    };
    (purchaseHistoryItemCosts ?? []).forEach((row) => {
      costByDocumentId[row.purchase_history_id] =
        (costByDocumentId[row.purchase_history_id] || 0) + Number(row.total_cost || 0);
    });
  }

  if (!invoicesInPeriod.length && !filteredPurchaseHistory.length) {
    return { periodSpend: 0, vendors: [] };
  }

  let periodSpend = 0;
  const vendorMap: Record<string, number> = {};

  invoicesInPeriod.forEach((row) => {
    const cost = costByDocumentId[row.id] || 0;
    periodSpend += cost;
    const vendorName = row.vendor_name || "Unknown";
    vendorMap[vendorName] = (vendorMap[vendorName] || 0) + cost;
  });

  filteredPurchaseHistory.forEach((row) => {
    const cost = costByDocumentId[row.id] || 0;
    periodSpend += cost;
    const vendorName = row.vendor_name || "Unknown";
    vendorMap[vendorName] = (vendorMap[vendorName] || 0) + cost;
  });

  const vendors = Object.entries(vendorMap)
    .map(([name, total]) => ({ name, total }))
    .sort((a, b) => b.total - a.total)
    .slice(0, 5);

  return { periodSpend, vendors };
}

function isPortfolioDashboardResponse(value: unknown): value is PortfolioDashboardResponse {
  if (!value || typeof value !== "object") return false;
  return "restaurants" in value && "totals" in value;
}

export function usePortfolioDashboardData(timeFilter: DashboardTimeFilter) {
  const [data, setData] = useState<PortfolioDashboardResponse | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchPortfolio = async () => {
      setLoading(true);
      const { data: session } = await supabase.auth.getSession();
      const token = session?.session?.access_token;
      if (!token) {
        setLoading(false);
        return;
      }

      const { startDate, endDate } = dashboardSpendRangeFromFilter(timeFilter);
      try {
        const response = await supabase.functions.invoke("portfolio-dashboard", {
          body: { startDate, endDate },
        });
        if (isPortfolioDashboardResponse(response.data)) {
          setData(response.data);
        }
      } catch (error) {
        console.error("Portfolio fetch error:", error);
      }
      setLoading(false);
    };

    fetchPortfolio();
  }, [timeFilter]);

  return { data, loading };
}

export function useDashboardData({
  currentRestaurantId,
  currentLocationId,
  timeFilter,
}: UseDashboardDataArgs): SingleDashboardData {
  const [stockStatus, setStockStatus] = useState({ red: 0, yellow: 0, green: 0 });
  const [topReorder, setTopReorder] = useState<SingleDashboardData["topReorder"]>([]);
  const [reorderSummary, setReorderSummary] = useState<SingleDashboardData["reorderSummary"]>(null);
  const [highUsage, setHighUsage] = useState<SingleDashboardData["highUsage"]>([]);
  const [recommendations, setRecommendations] = useState<SingleDashboardData["recommendations"]>([]);
  const [loading, setLoading] = useState(true);
  const [inventoryValue, setInventoryValue] = useState(0);
  const [missingCostCount, setMissingCostCount] = useState(0);
  const [trendData, setTrendData] = useState<SingleDashboardData["trendData"]>([]);
  const [pendingInvoices, setPendingInvoices] = useState(0);
  const [overstockValue, setOverstockValue] = useState(0);
  const [lastSessionDate, setLastSessionDate] = useState<Date | null>(null);
  const [lastSessionName, setLastSessionName] = useState<string | null>(null);
  const [todayWasteEntries, setTodayWasteEntries] = useState<WasteLogSnapshotRow[]>([]);
  const [spendOverviewData, setSpendOverviewData] = useState<SpendOverviewData | null>(null);
  const [missingParCount, setMissingParCount] = useState(0);
  const [periodSpend, setPeriodSpend] = useState(0);
  const [deliveryIssuesCount, setDeliveryIssuesCount] = useState(0);
  const [priceIncreaseImpact, setPriceIncreaseImpact] = useState(0);
  const [recordedWasteValue, setRecordedWasteValue] = useState(0);
  const [recordedWasteCount, setRecordedWasteCount] = useState(0);
  const [wasteItemsMissingCost, setWasteItemsMissingCost] = useState(0);

  const latestSessionUnitCostByCatalogIdRef = useRef<Record<string, number>>({});
  const previousFetchRef = useRef<{ locKey: string; timeFilter: DashboardTimeFilter }>({
    locKey: "",
    timeFilter: "this_week",
  });

  useEffect(() => {
    if (!currentRestaurantId) return;

    const restaurantId = currentRestaurantId;
    const locationId = currentLocationId ?? undefined;
    const locKey = `${restaurantId}:${locationId ?? ""}`;
    const onlyTimeFilterChanged =
      previousFetchRef.current.locKey === locKey &&
      previousFetchRef.current.timeFilter !== timeFilter;

    let cancelled = false;

    const run = async () => {
      try {
        if (!onlyTimeFilterChanged) {
          setSpendOverviewData(null);
          setLoading(true);
          latestSessionUnitCostByCatalogIdRef.current = {};

          const invoiceDocIds = await fetchInvoiceDocumentIdsForRestaurant(restaurantId);
          const [invoicePendingResult, purchaseHistoryPendingResult] = await Promise.all([
            (supabase
              .from("invoices")
              .select("id", { count: "exact", head: true })
              .eq("restaurant_id", restaurantId)
              .in("status", ["draft", "review", "ready_to_receive"])) as unknown as Promise<{
              count: number | null;
            }>,
            (supabase
              .from("purchase_history")
              .select("id")
              .eq("restaurant_id", restaurantId)
              .in("invoice_status", ["DRAFT", "RECEIVED"])) as unknown as Promise<{
              data: { id: string }[] | null;
            }>,
          ]);

          if (!cancelled) {
            setPendingInvoices(
              countPendingInvoices(
                invoicePendingResult.count ?? 0,
                purchaseHistoryPendingResult.data ?? [],
                invoiceDocIds,
              ),
            );
          }

          let sessionQuery = supabase
            .from("inventory_sessions")
            .select("id, approved_at, name")
            .eq("restaurant_id", restaurantId)
            .eq("status", "APPROVED")
            .order("approved_at", { ascending: false })
            .limit(1);

          if (locationId) {
            sessionQuery = sessionQuery.eq("location_id", locationId);
          }

          const [sessionsResult, riskSettingsResult] = await Promise.all([
            sessionQuery as unknown as Promise<{ data: InventorySessionRow[] | null }>,
            (supabase
              .from("smart_order_settings")
              .select("red_threshold, yellow_threshold")
              .eq("restaurant_id", restaurantId)
              .maybeSingle()) as unknown as Promise<{
              data: SmartOrderSettingsRow | null;
            }>,
          ]);

          const sessions = sessionsResult.data;
          const riskThresholds = riskThresholdsFromSettings(riskSettingsResult.data);

          if (sessions && sessions.length > 0) {
            if (sessions[0].approved_at) {
              setLastSessionDate(new Date(sessions[0].approved_at));
            }
            if (sessions[0].name) {
              setLastSessionName(sessions[0].name);
            }

            const { data: items } = (await supabase
              .from("inventory_session_items")
              .select("*")
              .eq("session_id", sessions[0].id)) as unknown as {
              data: InventorySessionItemRow[] | null;
            };

            if (items) {
              const snapshot = buildLatestInventorySnapshot(items, riskThresholds);
              latestSessionUnitCostByCatalogIdRef.current = snapshot.latestSessionUnitCostByCatalogId;
              setReorderSummary(snapshot.reorderSummary);
              setStockStatus(snapshot.stockStatus);
              setOverstockValue(snapshot.overstockValue);
              setTopReorder(snapshot.topReorder);
              setInventoryValue(snapshot.inventoryValue);
              setMissingCostCount(snapshot.missingCostCount);
              setMissingParCount(snapshot.missingParCount);
            } else {
              setMissingParCount(0);
              latestSessionUnitCostByCatalogIdRef.current = {};
            }
          } else {
            setStockStatus({ red: 0, yellow: 0, green: 0 });
            setTopReorder([]);
            setReorderSummary(null);
            setInventoryValue(0);
            setMissingCostCount(0);
            setOverstockValue(0);
            setLastSessionDate(null);
            setLastSessionName(null);
            setMissingParCount(0);
            latestSessionUnitCostByCatalogIdRef.current = {};
          }

          let trendQuery = supabase
            .from("inventory_sessions")
            .select("id, approved_at")
            .eq("restaurant_id", restaurantId)
            .eq("status", "APPROVED")
            .order("approved_at", { ascending: false })
            .limit(8);

          if (locationId) {
            trendQuery = trendQuery.eq("location_id", locationId);
          }

          const { data: trendSessions } = (await trendQuery) as unknown as {
            data: InventoryTrendSessionRow[] | null;
          };

          if (trendSessions && trendSessions.length > 0) {
            const sessionIds = trendSessions.map((session) => session.id);
            const { data: trendLines } = (await supabase
              .from("inventory_session_items")
              .select("session_id, current_stock, unit_cost")
              .in("session_id", sessionIds)) as unknown as {
              data:
                | {
                    session_id: string;
                    current_stock: number | null;
                    unit_cost: number | null;
                  }[]
                | null;
            };

            const trendLinesBySessionId = new Map<
              string,
              { current_stock: number | null; unit_cost: number | null }[]
            >();
            for (const row of trendLines ?? []) {
              if (!row.session_id) continue;
              if (!trendLinesBySessionId.has(row.session_id)) {
                trendLinesBySessionId.set(row.session_id, []);
              }
              trendLinesBySessionId.get(row.session_id)?.push(row);
            }

            setTrendData(buildInventoryTrendData(trendSessions, trendLinesBySessionId));
          } else {
            setTrendData([]);
          }

          const computedUsage = await computeUsageAnalytics(restaurantId, locationId);
          setHighUsage(computedUsage);

          const recommendationsResult = await computePARRecommendations(restaurantId, locationId);
          setRecommendations(recommendationsResult);

          try {
            const todayStart = startOfDay(new Date());
            const { data: wasteToday } = (await supabase
              .from("waste_log")
              .select("item_name, quantity, reason, logged_at")
              .eq("restaurant_id", restaurantId)
              .gte("logged_at", todayStart.toISOString())
              .order("logged_at", { ascending: false })
              .limit(20)) as unknown as {
              data: WasteLogSnapshotRow[] | null;
            };
            setTodayWasteEntries(wasteToday ?? []);
          } catch {
            setTodayWasteEntries([]);
          }
        }

        if (cancelled) return;

        const { startDate, endDate } = dashboardSpendRangeFromFilter(timeFilter);
        const rangeStart = new Date(startDate);
        const rangeEnd = new Date(endDate);

        let invoiceQuery = supabase
          .from("invoices")
          .select("id, invoice_total, invoice_date, status, receipt_status")
          .eq("restaurant_id", restaurantId);
        if (locationId) {
          invoiceQuery = invoiceQuery.eq("location_id", locationId);
        }

        const [invoiceStatusResult, spendOverview] = await Promise.all([
          invoiceQuery as unknown as Promise<{ data: DashboardInvoiceStatusRow[] | null }>,
          fetchSpendOverviewData(restaurantId, locationId, timeFilter),
        ]);
        if (cancelled) return;

        setSpendOverviewData(spendOverview.periodSpend > 0 ? spendOverview : null);

        const invoiceStatusRows = invoiceStatusResult.data ?? [];
        const invoicePeriodSummary = sumPeriodInvoiceSpend(invoiceStatusRows, rangeStart, rangeEnd);
        const periodInvoiceIds = invoiceStatusRows
          .filter((row) => invoiceBusinessDateInRange(row.invoice_date, rangeStart, rangeEnd))
          .map((row) => row.id);

        let priceImpact = 0;
        if (periodInvoiceIds.length > 0) {
          const { data: comparisons } = (await supabase
            .from("invoice_line_comparisons")
            .select("invoice_id, status, received_qty, po_qty, invoiced_unit_cost, po_unit_cost, invoiced_qty")
            .in("invoice_id", periodInvoiceIds)) as unknown as {
            data: InvoiceLineComparisonRow[] | null;
          };

          if (cancelled) return;

          for (const comparison of comparisons ?? []) {
            if (!comparison.invoice_id) continue;
            if (isInvoiceLineComparisonProblem(comparison)) {
              invoicePeriodSummary.issueInvoiceIds.add(comparison.invoice_id);
            }
            priceImpact += linePriceIncreaseImpact(comparison);
          }
        }

        const { data: wasteRows } = (await supabase
          .from("waste_log")
          .select("quantity, total_cost, unit_cost, catalog_item_id, logged_at")
          .eq("restaurant_id", restaurantId)
          .gte("logged_at", rangeStart.toISOString())
          .lte("logged_at", rangeEnd.toISOString())) as unknown as {
          data: WasteLogPeriodRow[] | null;
        };

        if (cancelled) return;

        const wasteList = wasteRows ?? [];
        const catalogIds = [
          ...new Set(
            wasteList
              .map((row) => row.catalog_item_id)
              .filter((catalogId): catalogId is string => typeof catalogId === "string" && catalogId.length > 0),
          ),
        ];

        const catalogDefaultById = new Map<string, number>();
        if (catalogIds.length > 0) {
          const { data: catalogRows } = (await supabase
            .from("inventory_catalog_items")
            .select("id, default_unit_cost")
            .eq("restaurant_id", restaurantId)
            .in("id", catalogIds)) as unknown as {
            data: InventoryCatalogDefaultCostRow[] | null;
          };
          for (const row of catalogRows ?? []) {
            const value = Number(row.default_unit_cost);
            if (Number.isFinite(value) && value >= 0) {
              catalogDefaultById.set(row.id, value);
            }
          }
        }

        const sessionUnitByCatalogId = new Map<string, number>(
          Object.entries(latestSessionUnitCostByCatalogIdRef.current),
        );
        let wasteDollars = 0;
        let wasteMissingCost = 0;
        for (const wasteRow of wasteList) {
          wasteDollars += dollarsForWasteRow(wasteRow, catalogDefaultById, sessionUnitByCatalogId);
          if (!hasReliableWasteCost(wasteRow, catalogDefaultById, sessionUnitByCatalogId)) {
            wasteMissingCost += 1;
          }
        }

        setPeriodSpend(invoicePeriodSummary.periodSpend);
        setDeliveryIssuesCount(invoicePeriodSummary.issueInvoiceIds.size);
        setPriceIncreaseImpact(priceImpact);
        setRecordedWasteValue(wasteDollars);
        setRecordedWasteCount(wasteList.length);
        setWasteItemsMissingCost(wasteMissingCost);

        if (!cancelled) {
          previousFetchRef.current = { locKey, timeFilter };
        }
      } finally {
        if (!onlyTimeFilterChanged) setLoading(false);
      }
    };

    run();
    return () => {
      cancelled = true;
    };
  }, [currentLocationId, currentRestaurantId, timeFilter]);

  return {
    stockStatus,
    topReorder,
    reorderSummary,
    highUsage,
    recommendations,
    loading,
    inventoryValue,
    missingCostCount,
    trendData,
    pendingInvoices,
    overstockValue,
    lastSessionDate,
    lastSessionName,
    todayWasteEntries,
    spendOverviewData,
    missingParCount,
    periodSpend,
    deliveryIssuesCount,
    priceIncreaseImpact,
    recordedWasteValue,
    recordedWasteCount,
    wasteItemsMissingCost,
  };
}
