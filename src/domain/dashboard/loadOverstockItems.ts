import { supabase } from "@/integrations/supabase/client";
import { buildSessionOverstockLines } from "@/domain/dashboard/dashboardSelectors";
import type { OverstockItem } from "@/domain/dashboard/dashboardTypes";
import type { LoadOutcome } from "@/domain/dashboard/loadOutcome";
import { withLocationOrNull } from "@/domain/locations/locationQueryScope";

/**
 * Returns every item from the latest APPROVED inventory session where
 * stock exceeds PAR, ranked by trapped-cash dollars descending.
 * Uses the same deduped case-planning engine as the dashboard hero KPI.
 *
 * Returns a {@link LoadOutcome}: a failed query yields `{ status: "error" }` so the
 * card shows "couldn't calculate" rather than an empty list read as "no overstock".
 */
export async function loadOverstockItems(
  restaurantId: string,
  locationId: string | undefined,
): Promise<LoadOutcome<OverstockItem[]>> {
  let sessQ = supabase
    .from("inventory_sessions")
    .select("id")
    .eq("restaurant_id", restaurantId)
    .eq("status", "APPROVED")
    .order("approved_at", { ascending: false })
    .limit(1);
  if (locationId) sessQ = withLocationOrNull(sessQ, locationId);

  const { data: sessions, error: sessErr } = (await sessQ) as unknown as {
    data: Array<{ id: string }> | null;
    error: unknown;
  };
  if (sessErr) return { status: "error", error: sessErr };
  if (!sessions || sessions.length === 0) return { status: "ok", value: [] };

  const { data: items, error: itemsErr } = (await supabase
    .from("inventory_session_items")
    .select("*")
    .eq("session_id", sessions[0].id)) as unknown as {
    data: import("@/domain/dashboard/dashboardTypes").InventorySessionItemRow[] | null;
    error: unknown;
  };
  if (itemsErr) return { status: "error", error: itemsErr };

  return { status: "ok", value: buildSessionOverstockLines(items ?? []) };
}
