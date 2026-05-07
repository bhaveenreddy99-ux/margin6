import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import type {
  InventorySessionItemRow,
  InventorySessionItemZoneRow,
} from "@/domain/inventory/enterInventoryTypes";

type AppSupabase = SupabaseClient<Database>;

type SessionItemTableRow = Database["public"]["Tables"]["inventory_session_items"]["Row"];

/**
 * Loads `inventory_session_items` and their zone rows without using a PostgREST embed.
 * Embeds like `*, inventory_session_item_zones(*)` require the FK to exist in the live DB
 * and in PostgREST’s schema cache; a two-query merge avoids that failure mode.
 */
export function mergeSessionItemZones(
  items: SessionItemTableRow[],
  zones: InventorySessionItemZoneRow[] | null,
): InventorySessionItemRow[] {
  const bySessionItemId = new Map<string, InventorySessionItemZoneRow[]>();
  for (const z of zones ?? []) {
    const list = bySessionItemId.get(z.session_item_id) ?? [];
    list.push(z);
    bySessionItemId.set(z.session_item_id, list);
  }
  return items.map((row) => ({
    ...row,
    inventory_session_item_zones: bySessionItemId.get(row.id) ?? [],
  }));
}

export async function loadSessionItemsWithZones(
  supabase: AppSupabase,
  sessionId: string,
  options?: { orderByItemName?: boolean },
): Promise<{
  data: InventorySessionItemRow[] | null;
  error: { message: string } | null;
}> {
  let itemQuery = supabase.from("inventory_session_items").select("*").eq("session_id", sessionId);
  if (options?.orderByItemName) {
    itemQuery = itemQuery.order("item_name", { ascending: true });
  }
  const { data: items, error: itemsError } = await itemQuery;
  if (itemsError) {
    return { data: null, error: itemsError };
  }
  const list = items ?? [];
  if (list.length === 0) {
    return { data: [], error: null };
  }
  const ids = list.map((r) => r.id);
  // Chunk `.in` filters: very long filter lists can produce URLs/proxies that return 400.
  const IN_CHUNK = 150;
  const zoneRows: InventorySessionItemZoneRow[] = [];
  for (let i = 0; i < ids.length; i += IN_CHUNK) {
    const chunk = ids.slice(i, i + IN_CHUNK);
    const { data: part, error: zonesError } = await supabase
      .from("inventory_session_item_zones")
      .select("*")
      .in("session_item_id", chunk);
    if (zonesError) {
      return { data: null, error: zonesError };
    }
    if (part?.length) {
      zoneRows.push(...(part as InventorySessionItemZoneRow[]));
    }
  }
  return { data: mergeSessionItemZones(list, zoneRows), error: null };
}
