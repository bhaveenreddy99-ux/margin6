import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { supabase } from "@/integrations/supabase/client";

type AppSupabase = SupabaseClient<Database>;
import type {
  InventoryCatalogItemRow,
  InventoryListRow,
  InventorySessionItemRow,
  InventorySessionItemZoneRow,
  InventorySessionListRow,
  ParGuideItemRow,
  ParGuideRow,
  ReminderWithListLocation,
} from "@/domain/inventory/enterInventoryTypes";
import type {
  CatalogListLinkRow,
  ListModeRow,
  ParGuidePickerOption,
  SessionMetaRow,
} from "@/features/inventory-count/types";
import { loadSessionItemsWithZones } from "@/domain/inventory/loadSessionItemsWithZones";

export async function fetchInventoryLists(currentRestaurantId: string) {
  return (supabase
    .from("inventory_lists")
    .select("*")
    .eq("restaurant_id", currentRestaurantId)) as unknown as Promise<{
    data: InventoryListRow[] | null;
  }>;
}

export async function fetchInventoryCatalogListLinks(currentRestaurantId: string) {
  return (supabase
    .from("inventory_catalog_items")
    .select("id, inventory_list_id")
    .eq("restaurant_id", currentRestaurantId)) as unknown as Promise<{
    data: CatalogListLinkRow[] | null;
  }>;
}

export async function fetchParGuideListLinks(currentRestaurantId: string) {
  return (supabase
    .from("par_guides")
    .select("id, inventory_list_id")
    .eq("restaurant_id", currentRestaurantId)) as unknown as Promise<{
    data: Array<Pick<ParGuideRow, "id" | "inventory_list_id">> | null;
  }>;
}

export async function fetchApprovedSessionDates(currentRestaurantId: string, locationId?: string | null) {
  let query = supabase
    .from("inventory_sessions")
    .select("inventory_list_id, approved_at")
    .eq("restaurant_id", currentRestaurantId)
    .eq("status", "APPROVED")
    .not("approved_at", "is", null)
    .order("approved_at", { ascending: false });
  if (locationId) query = query.eq("location_id", locationId);
  return query as unknown as Promise<{
    data: Array<Pick<InventorySessionListRow, "inventory_list_id" | "approved_at">> | null;
  }>;
}

export async function fetchInventorySchedules(currentRestaurantId: string) {
  return (supabase
    .from("reminders")
    .select("*, inventory_lists(name), locations(name)")
    .eq("restaurant_id", currentRestaurantId)
    .eq("is_enabled", true)
    .not("inventory_list_id", "is", null)) as unknown as Promise<{
    data: ReminderWithListLocation[] | null;
  }>;
}

export async function fetchInventorySessionsByStatus(
  currentRestaurantId: string,
  status: "IN_PROGRESS" | "IN_REVIEW" | "APPROVED",
  approvedAfterIso?: string,
  locationId?: string | null,
) {
  let query = supabase
    .from("inventory_sessions")
    .select("*, inventory_lists(name), locations(name)")
    .eq("restaurant_id", currentRestaurantId)
    .eq("status", status);

  if (locationId) query = query.eq("location_id", locationId);

  if (status === "APPROVED" && approvedAfterIso) {
    query = query.gte("approved_at", approvedAfterIso).order("approved_at", { ascending: false });
  } else {
    query = query.order("updated_at", { ascending: false });
  }

  return query as unknown as Promise<{
    data: InventorySessionListRow[] | null;
  }>;
}

export async function fetchInventorySessionStats(sessionIds: string[]) {
  return (supabase
    .from("inventory_session_items")
    .select("session_id, current_stock, unit_cost")
    .in("session_id", sessionIds)) as unknown as Promise<{
    data: Array<Pick<InventorySessionItemRow, "session_id" | "current_stock" | "unit_cost">> | null;
  }>;
}

export async function fetchLatestParGuide(
  inventoryListId: string,
  restaurantId?: string | null,
  locationId?: string | null,
  supabaseClient?: AppSupabase,
) {
  const client = supabaseClient ?? supabase;
  const baseQuery = client.from("par_guides").select("id").eq("inventory_list_id", inventoryListId);
  const withRestaurant = restaurantId ? baseQuery.eq("restaurant_id", restaurantId) : baseQuery;
  const withLocation = locationId ? withRestaurant.eq("location_id", locationId) : withRestaurant;
  return withLocation.order("created_at", { ascending: false }).limit(1).maybeSingle() as unknown as {
    data: Pick<ParGuideRow, "id"> | null;
    error: { message: string } | null;
  };
}

export async function fetchCatalogItemsForList(
  currentRestaurantId: string,
  inventoryListId: string,
) {
  return (supabase
    .from("inventory_catalog_items")
    .select("*")
    .eq("restaurant_id", currentRestaurantId)
    .eq("inventory_list_id", inventoryListId)) as unknown as {
    data: InventoryCatalogItemRow[] | null;
  };
}

export async function fetchParGuideItems(parGuideId: string) {
  return (supabase
    .from("par_guide_items")
    .select("*")
    .eq("par_guide_id", parGuideId)) as unknown as {
    data: ParGuideItemRow[] | null;
  };
}

export async function fetchSessionMeta(sessionId: string) {
  return (supabase
    .from("inventory_sessions")
    .select("inventory_list_id, counting_par_guide_id")
    .eq("id", sessionId)
    .maybeSingle()) as unknown as {
    data: SessionMetaRow | null;
  };
}

export async function fetchInventoryListMode(listId: string) {
  return (supabase
    .from("inventory_lists")
    .select("active_category_mode")
    .eq("id", listId)
    .maybeSingle()) as unknown as {
    data: ListModeRow | null;
  };
}

export async function fetchSessionItems(sessionId: string) {
  return loadSessionItemsWithZones(supabase, sessionId) as Promise<{
    data: InventorySessionItemRow[] | null;
    error: { message: string } | null;
  }>;
}

export async function fetchSessionItemsByName(sessionId: string) {
  return loadSessionItemsWithZones(supabase, sessionId, { orderByItemName: true }) as Promise<{
    data: InventorySessionItemRow[] | null;
    error: { message: string } | null;
  }>;
}

export async function fetchSessionItemZonesForSessionItem(sessionItemId: string) {
  return supabase
    .from("inventory_session_item_zones")
    .select("*")
    .eq("session_item_id", sessionItemId) as unknown as Promise<{
    data: InventorySessionItemZoneRow[] | null;
    error: { message: string } | null;
  }>;
}

export async function fetchSessionItemStock(sessionItemId: string) {
  return supabase
    .from("inventory_session_items")
    .select("id, current_stock")
    .eq("id", sessionItemId)
    .maybeSingle() as unknown as Promise<{
    data: Pick<InventorySessionItemRow, "id" | "current_stock"> | null;
    error: { message: string } | null;
  }>;
}

export async function fetchParGuideName(guideId: string) {
  return (supabase
    .from("par_guides")
    .select("name")
    .eq("id", guideId)
    .maybeSingle()) as unknown as {
    data: Pick<ParGuideRow, "name"> | null;
  };
}

export async function fetchParGuideLevelRows(guideId: string) {
  return (supabase
    .from("par_guide_items")
    .select("item_name, par_level, catalog_item_id")
    .eq("par_guide_id", guideId)) as unknown as {
    data: Array<Pick<ParGuideItemRow, "item_name" | "par_level" | "catalog_item_id">> | null;
  };
}

export async function fetchParGuidePickerOptions(currentRestaurantId: string) {
  return (supabase
    .from("par_guides")
    .select("id, name, inventory_list_id")
    .eq("restaurant_id", currentRestaurantId)) as unknown as {
    data: ParGuidePickerOption[] | null;
  };
}

export async function fetchSmartOrderParGuides(
  currentRestaurantId: string,
  inventoryListId: string,
) {
  return (supabase
    .from("par_guides")
    .select("*")
    .eq("restaurant_id", currentRestaurantId)
    .eq("inventory_list_id", inventoryListId)) as unknown as {
    data: ParGuideRow[] | null;
  };
}

export async function fetchSmartOrderSettings(currentRestaurantId: string) {
  return supabase
    .from("smart_order_settings")
    .select("red_threshold, yellow_threshold")
    .eq("restaurant_id", currentRestaurantId)
    .maybeSingle();
}

export async function fetchParGuidesForSelectedList(
  currentRestaurantId: string,
  inventoryListId: string,
  locationId?: string | null,
) {
  const baseQuery = supabase
    .from("par_guides")
    .select("*")
    .eq("restaurant_id", currentRestaurantId)
    .eq("inventory_list_id", inventoryListId);
  return (locationId ? baseQuery.eq("location_id", locationId) : baseQuery)
    .order("updated_at", { ascending: false });
}
