import { supabase } from "@/integrations/supabase/client";
import { dashboardSpendRangeFromFilter } from "@/domain/dashboard/dashboardSelectors";
import type { DashboardTimeFilter } from "@/domain/dashboard/dashboardTypes";

type ShrinkItem = {
  item_name?: string;
  dollar_impact?: number | string;
  type?: string;
};

/**
 * Sums `dollar_impact` across every SHRINK_ALERT / COUNT_VARIANCE notification
 * fired in the active period. Returns 0 on missing/empty data — never throws.
 */
export async function loadShrinkageValue(
  restaurantId: string,
  locationId: string | undefined,
  timeFilter: DashboardTimeFilter,
): Promise<number> {
  const { startDate, endDate } = dashboardSpendRangeFromFilter(timeFilter);

  let q = supabase
    .from("notifications")
    .select("data")
    .eq("restaurant_id", restaurantId)
    .in("type", ["SHRINK_ALERT", "COUNT_VARIANCE"])
    .gte("created_at", startDate)
    .lte("created_at", endDate);
  if (locationId) q = q.eq("location_id", locationId);

  const { data, error } = await q;
  if (error || !data) return 0;

  let total = 0;
  for (const row of data) {
    const raw = row.data as { items?: unknown } | null | undefined;
    const items = Array.isArray(raw?.items) ? (raw.items as ShrinkItem[]) : [];
    for (const item of items) {
      const impact = Number(item?.dollar_impact);
      if (Number.isFinite(impact) && impact > 0) total += impact;
    }
  }
  return total;
}
