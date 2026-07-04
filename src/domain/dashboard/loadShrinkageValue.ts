import { supabase } from "@/integrations/supabase/client";
import { dashboardSpendRangeFromFilter } from "@/domain/dashboard/dashboardSelectors";
import type { DashboardTimeFilter } from "@/domain/dashboard/dashboardTypes";
import type { LoadOutcome } from "@/domain/dashboard/loadOutcome";
import { withLocationOrNull } from "@/domain/locations/locationQueryScope";

type ShrinkItem = {
  item_name?: string;
  dollar_impact?: number | string;
  type?: string;
};

/**
 * Sums `dollar_impact` across every SHRINK_ALERT / COUNT_VARIANCE notification
 * fired in the active period.
 *
 * Returns a {@link LoadOutcome}: a failed query yields `{ status: "error" }` so the
 * dashboard can show "couldn't calculate" instead of a confident $0. A genuine
 * empty period is still `{ status: "ok", value: 0 }` (a real zero, not a failure).
 */
export async function loadShrinkageValue(
  restaurantId: string,
  locationId: string | undefined,
  timeFilter: DashboardTimeFilter,
): Promise<LoadOutcome<number>> {
  const { startDate, endDate } = dashboardSpendRangeFromFilter(timeFilter);

  let q = supabase
    .from("notifications")
    .select("data")
    .eq("restaurant_id", restaurantId)
    .in("type", ["SHRINK_ALERT", "COUNT_VARIANCE"])
    .gte("created_at", startDate)
    .lte("created_at", endDate);
  if (locationId) q = withLocationOrNull(q, locationId);

  const { data, error } = await q;
  // A real query failure must NOT be rendered as $0.
  if (error) return { status: "error", error };

  // No error: an empty result set is a genuine zero.
  let total = 0;
  for (const row of data ?? []) {
    const raw = row.data as { items?: unknown } | null | undefined;
    const items = Array.isArray(raw?.items) ? (raw.items as ShrinkItem[]) : [];
    for (const item of items) {
      const impact = Number(item?.dollar_impact);
      if (Number.isFinite(impact) && impact > 0) total += impact;
    }
  }
  return { status: "ok", value: total };
}
