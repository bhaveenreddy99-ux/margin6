import { supabase } from "@/integrations/supabase/client";
import type { OverstockItem } from "@/domain/dashboard/dashboardTypes";

/**
 * Returns every item from the latest APPROVED inventory session where
 * `current_stock > par_level`, ranked by trapped-cash dollars descending.
 * Returns `[]` on missing data — never throws.
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
  if (locationId) sessQ = sessQ.eq("location_id", locationId);

  const { data: sessions } = (await sessQ) as unknown as {
    data: Array<{ id: string }> | null;
  };
  if (!sessions || sessions.length === 0) return [];

  const { data: items } = (await supabase
    .from("inventory_session_items")
    .select("item_name, current_stock, par_level, unit_cost")
    .eq("session_id", sessions[0].id)) as unknown as {
    data: Array<{
      item_name: string | null;
      current_stock: number | null;
      par_level: number | null;
      unit_cost: number | null;
    }> | null;
  };

  const result: OverstockItem[] = [];
  for (const row of items ?? []) {
    const name = (row.item_name ?? "").trim();
    if (!name) continue;
    const stock = Number(row.current_stock ?? 0);
    const par = Number(row.par_level ?? 0);
    const cost = Number(row.unit_cost ?? 0);
    if (!Number.isFinite(stock) || !Number.isFinite(par) || !Number.isFinite(cost)) continue;
    // Items without a PAR cannot be overstocked — skip.
    if (par <= 0) continue;
    if (stock <= par || cost <= 0) continue;
    const unitsOver = stock - par;
    const dollars = unitsOver * cost;
    if (!Number.isFinite(dollars) || dollars <= 0) continue;
    result.push({
      item_name: name,
      current_stock: stock,
      par_level: par,
      unit_cost: cost,
      units_over: unitsOver,
      dollars,
    });
  }

  return result.sort((a, b) => b.dollars - a.dollars);
}
