import { supabase } from "@/integrations/supabase/client";
import { dashboardSpendRangeFromFilter } from "@/domain/dashboard/dashboardSelectors";
import type { DashboardTimeFilter } from "@/domain/dashboard/dashboardTypes";
import { loadGrossSalesForWeek } from "@/domain/sales/loadSalesForWeek";
import { weekStartIsoForFilter } from "@/domain/dashboard/priceIncreaseFromNotifications";

export type FoodCostStatus = "under" | "at" | "over";

export type FoodCostMetrics = {
  foodCostPct: number | null;
  weeklyGrossSales: number | null;
  targetPct: number;
  status: FoodCostStatus | null;
};

const INDUSTRY_TARGET_LOW = 28;
const INDUSTRY_TARGET_HIGH = 32;

export function classifyFoodCostStatus(pct: number): FoodCostStatus {
  if (pct < INDUSTRY_TARGET_LOW) return "under";
  if (pct > INDUSTRY_TARGET_HIGH) return "over";
  return "at";
}

async function loadLocationFoodCostTarget(locationId: string): Promise<number> {
  try {
    const { data } = await supabase
      .from("location_settings")
      .select("food_cost_target_pct")
      .eq("location_id", locationId)
      .maybeSingle();

    const target = Number(data?.food_cost_target_pct);
    return Number.isFinite(target) && target > 0 ? target : 30;
  } catch {
    return 30;
  }
}

async function loadGrossSalesForFilter(
  locationId: string,
  timeFilter: DashboardTimeFilter,
): Promise<number | null> {
  if (timeFilter === "30_days") {
    const { startDate, endDate } = dashboardSpendRangeFromFilter(timeFilter);
    const startWeek = startDate.slice(0, 10);
    const endWeek = endDate.slice(0, 10);

    try {
      const { data } = await supabase
        .from("weekly_sales")
        .select("gross_sales")
        .eq("location_id", locationId)
        .gte("week_start", startWeek)
        .lte("week_start", endWeek);

      const total = (data ?? []).reduce(
        (sum, row) => sum + Number(row.gross_sales ?? 0),
        0,
      );
      return total > 0 ? total : null;
    } catch {
      return null;
    }
  }

  const weekStart = weekStartIsoForFilter(timeFilter);
  const { data } = await loadGrossSalesForWeek({
    supabase,
    locationId,
    weekStart,
  });
  return data?.gross_sales && data.gross_sales > 0 ? data.gross_sales : null;
}

export async function loadFoodCostMetrics(
  locationId: string | undefined,
  periodSpend: number,
  timeFilter: DashboardTimeFilter,
): Promise<FoodCostMetrics> {
  const empty: FoodCostMetrics = {
    foodCostPct: null,
    weeklyGrossSales: null,
    targetPct: 30,
    status: null,
  };

  if (!locationId || periodSpend <= 0) return empty;

  try {
    const [grossSales, targetPct] = await Promise.all([
      loadGrossSalesForFilter(locationId, timeFilter),
      loadLocationFoodCostTarget(locationId),
    ]);

    if (!grossSales || grossSales <= 0) {
      return { ...empty, targetPct };
    }

    const foodCostPct = (periodSpend / grossSales) * 100;
    if (!Number.isFinite(foodCostPct)) return { ...empty, targetPct };

    return {
      foodCostPct,
      weeklyGrossSales: grossSales,
      targetPct,
      status: classifyFoodCostStatus(foodCostPct),
    };
  } catch {
    return empty;
  }
}
