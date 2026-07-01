// Single-restaurant dashboard data hook. ACTIVELY USED by Dashboard.tsx,
// AuditCenter.tsx, and PublicDemo.tsx. (`usePortfolioDashboardData` below serves
// the multi-restaurant portfolio view.)
//
// Trust contract (T0-4): on a load error the snapshot is reset to
// DEFAULT_SNAPSHOT so no stale or zero KPI values can be rendered as if valid;
// consumers MUST gate on `error` and render an explicit error state rather than
// any KPI value.

import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { buildDashboardSnapshot } from "@/domain/dashboard/buildDashboardSnapshot";
import { loadInventoryMetrics, EMPTY_INVENTORY_RESULT, type InventoryMetricsResult } from "@/domain/dashboard/loadInventoryMetrics";
import { loadInvoiceMetrics, type InvoiceMetricsResult } from "@/domain/dashboard/loadInvoiceMetrics";
import { loadOverstockItems } from "@/domain/dashboard/loadOverstockItems";
import { loadFoodCostMetrics } from "@/domain/dashboard/loadFoodCostMetrics";
import { loadProfitLeaks } from "@/domain/dashboard/loadProfitLeaks";
import { loadShrinkageValue } from "@/domain/dashboard/loadShrinkageValue";
import { loadSpendMetrics } from "@/domain/dashboard/loadSpendMetrics";
import { loadWasteMetrics, type WasteMetricsResult } from "@/domain/dashboard/loadWasteMetrics";
import { dashboardSpendRangeFromFilter } from "@/domain/dashboard/dashboardSelectors";
import type {
  DashboardKpiErrors,
  DashboardTimeFilter,
  KPISnapshot,
  PortfolioDashboardResponse,
  SingleDashboardData,
} from "@/domain/dashboard/dashboardTypes";

const EMPTY_WASTE_RESULT: WasteMetricsResult = {
  todayWasteEntries: [],
  recordedWasteValue: 0,
  recordedWasteCount: 0,
  wasteItemsMissingCost: 0,
};

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
  errors: {},
  topProfitLeaks: [],
  overstockItems: [],
  foodCostPct: null,
  weeklyGrossSales: null,
  foodCostTargetPct: 30,
  foodCostStatus: null,
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
        if (!onlyTimeFilterChanged) {
          setLoading(true);
          latestSessionUnitCostByCatalogIdRef.current = {};
        }

        const { startDate, endDate } = dashboardSpendRangeFromFilter(timeFilter);

        const inventoryPromise: Promise<InventoryMetricsResult> = onlyTimeFilterChanged
          ? Promise.resolve(cachedInventoryRef.current ?? EMPTY_INVENTORY_RESULT)
          : loadInventoryMetrics(restaurantId, locationId);

        const invoicePromise: Promise<InvoiceMetricsResult> = onlyTimeFilterChanged
          ? Promise.resolve(cachedInvoiceRef.current ?? EMPTY_INVOICE_RESULT)
          : loadInvoiceMetrics(restaurantId, locationId);

        const spendPromise = loadSpendMetrics(restaurantId, locationId, timeFilter);

        const [
          inventoryResult,
          invoiceResult,
          spendResult,
          shrinkageResult,
          profitLeaksResult,
          overstockItemsResult,
          wasteResult,
          foodCostResult,
        ] = await Promise.all([
          inventoryPromise,
          invoicePromise,
          spendPromise,
          loadShrinkageValue(restaurantId, locationId, timeFilter),
          loadProfitLeaks(supabase, restaurantId, locationId, startDate, endDate),
          loadOverstockItems(restaurantId, locationId),
          inventoryPromise.then((inventory) =>
            loadWasteMetrics(
              restaurantId,
              locationId,
              timeFilter,
              inventory.latestSessionUnitCostByCatalogId,
            ),
          ),
          spendPromise.then((spend) =>
            loadFoodCostMetrics(locationId, spend.periodSpend, timeFilter),
          ),
        ]);

        if (!onlyTimeFilterChanged) {
          latestSessionUnitCostByCatalogIdRef.current =
            inventoryResult.latestSessionUnitCostByCatalogId;
          cachedInventoryRef.current = inventoryResult;
          cachedInvoiceRef.current = invoiceResult;
        }

        if (cancelled) return;

        // Silent-$0 fix: a failed query surfaces as a per-KPI error flag instead
        // of a confident $0. A genuine empty period still yields a real 0.
        const shrinkageValue =
          shrinkageResult.status === "ok" ? shrinkageResult.value : 0;
        const wasteValue =
          wasteResult.status === "ok" ? wasteResult.value : EMPTY_WASTE_RESULT;
        const errors: DashboardKpiErrors = {
          shrinkage: shrinkageResult.status === "error",
          waste: wasteResult.status === "error",
        };

        setSnapshot(
          buildDashboardSnapshot(
            inventoryResult,
            invoiceResult,
            spendResult,
            wasteValue,
            shrinkageValue,
            profitLeaksResult,
            overstockItemsResult,
            foodCostResult,
            errors,
          ),
        );
        setError(null);
        previousFetchRef.current = { locKey, timeFilter, refetchCount };
      } catch (err) {
        if (!cancelled) {
          // T0-4: clear the snapshot so stale/zero KPI values cannot be rendered
          // as verified. Consumers must show an explicit error state on `error`.
          setSnapshot(DEFAULT_SNAPSHOT);
          setError(err instanceof Error ? err : new Error(String(err)));
        }
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
