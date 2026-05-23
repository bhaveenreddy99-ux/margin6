// DEPRECATED: Not used. See loadRestaurantPortfolioSummaries.ts
// Do not delete — it may have useful logic for future reference.

import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { buildDashboardSnapshot } from "@/domain/dashboard/buildDashboardSnapshot";
import { loadInventoryMetrics, EMPTY_INVENTORY_RESULT, type InventoryMetricsResult } from "@/domain/dashboard/loadInventoryMetrics";
import { loadInvoiceMetrics, type InvoiceMetricsResult } from "@/domain/dashboard/loadInvoiceMetrics";
import { loadOverstockItems } from "@/domain/dashboard/loadOverstockItems";
import { loadProfitLeaks } from "@/domain/dashboard/loadProfitLeaks";
import { loadShrinkageValue } from "@/domain/dashboard/loadShrinkageValue";
import { loadSpendMetrics } from "@/domain/dashboard/loadSpendMetrics";
import { loadWasteMetrics } from "@/domain/dashboard/loadWasteMetrics";
import { dashboardSpendRangeFromFilter } from "@/domain/dashboard/dashboardSelectors";
import type {
  DashboardTimeFilter,
  KPISnapshot,
  PortfolioDashboardResponse,
  SingleDashboardData,
} from "@/domain/dashboard/dashboardTypes";

export type { DashboardTimeFilter };

type UseDashboardDataArgs = {
  currentRestaurantId: string | null | undefined;
  currentLocationId: string | null | undefined;
  timeFilter: DashboardTimeFilter;
};

const DEFAULT_SNAPSHOT: KPISnapshot = {
  stockStatus: { red: 0, yellow: 0, green: 0 },
  topReorder: [],
  reorderSummary: null,
  highUsage: [],
  recommendations: [],
  inventoryValue: 0,
  missingCostCount: 0,
  trendData: [],
  overstockValue: 0,
  lastSessionDate: null,
  lastSessionName: null,
  missingParCount: 0,
  pendingInvoices: 0,
  periodSpend: 0,
  spendOverviewData: null,
  deliveryIssuesCount: 0,
  priceIncreaseImpact: 0,
  todayWasteEntries: [],
  recordedWasteValue: 0,
  recordedWasteCount: 0,
  wasteItemsMissingCost: 0,
  shrinkageValue: 0,
  topProfitLeaks: [],
  overstockItems: [],
};

const EMPTY_INVOICE_RESULT: InvoiceMetricsResult = { pendingInvoices: 0 };

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
  const [snapshot, setSnapshot] = useState<KPISnapshot>(DEFAULT_SNAPSHOT);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [refetchCount, setRefetchCount] = useState(0);

  const latestSessionUnitCostByCatalogIdRef = useRef<Record<string, number>>({});
  const cachedInventoryRef = useRef<InventoryMetricsResult | null>(null);
  const cachedInvoiceRef = useRef<InvoiceMetricsResult | null>(null);
  const previousFetchRef = useRef<{ locKey: string; timeFilter: DashboardTimeFilter; refetchCount: number }>({
    locKey: "",
    timeFilter: "this_week",
    refetchCount: 0,
  });

  const refetch = useCallback(() => setRefetchCount((c) => c + 1), []);

  useEffect(() => {
    if (!currentRestaurantId) return;

    const restaurantId = currentRestaurantId;
    const locationId = currentLocationId ?? undefined;
    const locKey = `${restaurantId}:${locationId ?? ""}`;
    const onlyTimeFilterChanged =
      previousFetchRef.current.locKey === locKey &&
      previousFetchRef.current.timeFilter !== timeFilter &&
      previousFetchRef.current.refetchCount === refetchCount;

    let cancelled = false;

    const run = async () => {
      try {
        let inventoryResult: InventoryMetricsResult;
        let invoiceResult: InvoiceMetricsResult;

        if (!onlyTimeFilterChanged) {
          setLoading(true);
          latestSessionUnitCostByCatalogIdRef.current = {};

          [inventoryResult, invoiceResult] = await Promise.all([
            loadInventoryMetrics(restaurantId, locationId),
            loadInvoiceMetrics(restaurantId, locationId),
          ]);

          if (cancelled) return;

          latestSessionUnitCostByCatalogIdRef.current = inventoryResult.latestSessionUnitCostByCatalogId;
          cachedInventoryRef.current = inventoryResult;
          cachedInvoiceRef.current = invoiceResult;
        } else {
          inventoryResult = cachedInventoryRef.current ?? EMPTY_INVENTORY_RESULT;
          invoiceResult = cachedInvoiceRef.current ?? EMPTY_INVOICE_RESULT;
        }

        const { startDate, endDate } = dashboardSpendRangeFromFilter(timeFilter);
        const [spendResult, wasteResult, shrinkageResult, profitLeaksResult, overstockItemsResult] = await Promise.all([
          loadSpendMetrics(restaurantId, locationId, timeFilter),
          loadWasteMetrics(restaurantId, locationId, timeFilter, latestSessionUnitCostByCatalogIdRef.current),
          loadShrinkageValue(restaurantId, locationId, timeFilter),
          loadProfitLeaks(supabase, restaurantId, locationId, startDate, endDate),
          loadOverstockItems(restaurantId, locationId),
        ]);

        if (cancelled) return;

        setSnapshot(buildDashboardSnapshot(inventoryResult, invoiceResult, spendResult, wasteResult, shrinkageResult, profitLeaksResult, overstockItemsResult));
        setError(null);
        previousFetchRef.current = { locKey, timeFilter, refetchCount };
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err : new Error(String(err)));
      } finally {
        if (!cancelled && !onlyTimeFilterChanged) setLoading(false);
      }
    };

    run();
    return () => {
      cancelled = true;
    };
  }, [currentLocationId, currentRestaurantId, timeFilter, refetchCount]);

  return { ...snapshot, loading, error, refetch };
}
