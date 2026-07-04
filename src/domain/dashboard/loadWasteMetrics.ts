import { startOfDay } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import { dashboardSpendRangeFromFilter } from "@/domain/dashboard/dashboardSelectors";
import { aggregateWasteRows } from "@/domain/waste/wasteMetricsAggregate";
import type {
  DashboardTimeFilter,
  InventoryCatalogDefaultCostRow,
  WasteLogPeriodRow,
  WasteLogSnapshotRow,
} from "@/domain/dashboard/dashboardTypes";
import type { LoadOutcome } from "@/domain/dashboard/loadOutcome";
import { withLocationOrNull } from "@/domain/locations/locationQueryScope";

export type WasteMetricsResult = {
  todayWasteEntries: WasteLogSnapshotRow[];
  recordedWasteValue: number;
  recordedWasteCount: number;
  wasteItemsMissingCost: number;
};

export async function loadWasteMetrics(
  restaurantId: string,
  locationId: string | undefined,
  timeFilter: DashboardTimeFilter,
  latestSessionUnitCostByCatalogId: Record<string, number>,
): Promise<LoadOutcome<WasteMetricsResult>> {
  const { startDate, endDate } = dashboardSpendRangeFromFilter(timeFilter);
  const rangeStart = new Date(startDate);
  const rangeEnd = new Date(endDate);
  const todayStart = startOfDay(new Date());

  const wasteTodayBase = supabase
    .from("waste_log")
    .select("item_name, quantity, reason, logged_at")
    .eq("restaurant_id", restaurantId)
    .gte("logged_at", todayStart.toISOString());
  const wasteTodayQuery = (locationId ? withLocationOrNull(wasteTodayBase, locationId) : wasteTodayBase)
    .order("logged_at", { ascending: false })
    .limit(20);

  const wasteRangeBase = supabase
    .from("waste_log")
    .select(
      "quantity, quantity_unit, logged_at, item_name, catalog_item_id, unit_cost, total_cost",
    )
    .eq("restaurant_id", restaurantId)
    .gte("logged_at", rangeStart.toISOString())
    .lte("logged_at", rangeEnd.toISOString());
  const wasteRangeQuery = locationId ? withLocationOrNull(wasteRangeBase, locationId) : wasteRangeBase;

  const [wasteTodayResult, wasteRangeResult] = await Promise.all([
    wasteTodayQuery as unknown as Promise<{ data: WasteLogSnapshotRow[] | null; error: unknown }>,
    wasteRangeQuery as unknown as Promise<{ data: WasteLogPeriodRow[] | null; error: unknown }>,
  ]);

  // The period query drives recordedWasteValue; if it failed, don't report $0.
  if (wasteRangeResult.error) return { status: "error", error: wasteRangeResult.error };

  const todayWasteEntries = wasteTodayResult.data ?? [];
  const wasteList = wasteRangeResult.data ?? [];

  const catalogIds = [
    ...new Set(
      wasteList
        .map((row) => row.catalog_item_id)
        .filter((id): id is string => typeof id === "string" && id.length > 0),
    ),
  ];

  const catalogDefaultById = new Map<string, number>();
  if (catalogIds.length > 0) {
    const { data: catalogRows } = (await supabase
      .from("inventory_catalog_items")
      .select("id, default_unit_cost")
      .eq("restaurant_id", restaurantId)
      .in("id", catalogIds)) as unknown as { data: InventoryCatalogDefaultCostRow[] | null };
    for (const row of catalogRows ?? []) {
      const value = Number(row.default_unit_cost);
      if (Number.isFinite(value) && value >= 0) catalogDefaultById.set(row.id, value);
    }
  }

  const sessionUnitByCatalogId = new Map<string, number>(Object.entries(latestSessionUnitCostByCatalogId));

  const { totalDollars: wasteDollars, missingCostCount: wasteMissingCost } = aggregateWasteRows(
    wasteList,
    catalogDefaultById,
    sessionUnitByCatalogId,
  );

  return {
    status: "ok",
    value: {
      todayWasteEntries,
      recordedWasteValue: wasteDollars,
      recordedWasteCount: wasteList.length,
      wasteItemsMissingCost: wasteMissingCost,
    },
  };
}
