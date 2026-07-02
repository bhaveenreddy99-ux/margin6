import { supabase } from "@/integrations/supabase/client";
import { dashboardSpendRangeFromFilter } from "@/domain/dashboard/dashboardSelectors";
import type { DashboardTimeFilter } from "@/domain/dashboard/dashboardTypes";
import type { LoadOutcome } from "@/domain/dashboard/loadOutcome";
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

// Returns a LoadOutcome so a failed sales query is distinguishable from a genuine
// "no sales entered" (null) — the dashboard shows "couldn't calculate" vs "enter sales".
async function loadGrossSalesForFilter(
  locationId: string,
  timeFilter: DashboardTimeFilter,
): Promise<LoadOutcome<number | null>> {
  if (timeFilter === "30_days") {
    const { startDate, endDate } = dashboardSpendRangeFromFilter(timeFilter);
    const startWeek = startDate.slice(0, 10);
    const endWeek = endDate.slice(0, 10);

    const { data, error } = await supabase
      .from("weekly_sales")
      .select("gross_sales")
      .eq("location_id", locationId)
      .gte("week_start", startWeek)
      .lte("week_start", endWeek);
    if (error) return { status: "error", error };

    const total = (data ?? []).reduce(
      (sum, row) => sum + Number(row.gross_sales ?? 0),
      0,
    );
    return { status: "ok", value: total > 0 ? total : null };
  }

  const weekStart = weekStartIsoForFilter(timeFilter);
  const { data, error } = await loadGrossSalesForWeek({
    supabase,
    locationId,
    weekStart,
  });
  if (error) return { status: "error", error };
  return { status: "ok", value: data?.gross_sales && data.gross_sales > 0 ? data.gross_sales : null };
}

export async function loadFoodCostMetrics(
  locationId: string | undefined,
  periodSpend: number,
  timeFilter: DashboardTimeFilter,
): Promise<LoadOutcome<FoodCostMetrics>> {
  const empty: FoodCostMetrics = {
    foodCostPct: null,
    weeklyGrossSales: null,
    targetPct: 30,
    status: null,
  };

  // Genuine "not enough data yet" (no location or no spend) — an ok empty, not a failure.
  if (!locationId || periodSpend <= 0) return { status: "ok", value: empty };

  try {
    const [grossSalesOutcome, targetPct] = await Promise.all([
      loadGrossSalesForFilter(locationId, timeFilter),
      loadLocationFoodCostTarget(locationId),
    ]);

    // A failed sales query is an error — not "no sales entered".
    if (grossSalesOutcome.status === "error") {
      return { status: "error", error: grossSalesOutcome.error };
    }
    const grossSales = grossSalesOutcome.value;

    if (!grossSales || grossSales <= 0) {
      return { status: "ok", value: { ...empty, targetPct } };
    }

    const foodCostPct = (periodSpend / grossSales) * 100;
    if (!Number.isFinite(foodCostPct)) return { status: "ok", value: { ...empty, targetPct } };

    return {
      status: "ok",
      value: {
        foodCostPct,
        weeklyGrossSales: grossSales,
        targetPct,
        status: classifyFoodCostStatus(foodCostPct),
      },
    };
  } catch (error) {
    return { status: "error", error };
  }
}
