import { supabase } from "@/integrations/supabase/client";
import { buildSessionOverstockLines } from "@/domain/dashboard/dashboardSelectors";
import type { OverstockItem } from "@/domain/dashboard/dashboardTypes";
import { withLocationOrNull } from "@/domain/locations/locationQueryScope";

/**
 * Returns every item from the latest APPROVED inventory session where
 * stock exceeds PAR, ranked by trapped-cash dollars descending.
 * Uses the same deduped case-planning engine as the dashboard hero KPI.
 */
export async function loadOverstockItems(
  restaurantId: string,
  locationId: string | undefined,
): Promise<OverstockItem[]> {
  let sessQ = supabase
    .from("inventory_sessions")
    .select("id")
    .eq("restaurant_id", restaurantId)
    .eq("status", "APPROVED")
    .order("approved_at", { ascending: false })
    .limit(1);
  if (locationId) sessQ = withLocationOrNull(sessQ, locationId);

  const { data: sessions } = (await sessQ) as unknown as {
    data: Array<{ id: string }> | null;
  };
  if (!sessions || sessions.length === 0) return [];

  const { data: items } = (await supabase
    .from("inventory_session_items")
    .select("*")
    .eq("session_id", sessions[0].id)) as unknown as {
    data: import("@/domain/dashboard/dashboardTypes").InventorySessionItemRow[] | null;
  };

  return buildSessionOverstockLines(items ?? []);
}
