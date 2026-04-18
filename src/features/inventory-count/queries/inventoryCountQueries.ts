import { supabase } from "@/integrations/supabase/client";
import type {
  InventoryCatalogItemRow,
  InventoryListRow,
  InventorySessionItemRow,
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

export async function fetchApprovedSessionDates(currentRestaurantId: string) {
  return (supabase
    .from("inventory_sessions")
    .select("inventory_list_id, approved_at")
    .eq("restaurant_id", currentRestaurantId)
    .eq("status", "APPROVED")
    .not("approved_at", "is", null)
    .order("approved_at", { ascending: false })) as unknown as Promise<{
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
) {
  const query = supabase
    .from("inventory_sessions")
    .select("*, inventory_lists(name), locations(name)")
    .eq("restaurant_id", currentRestaurantId)
    .eq("status", status);

  if (status === "APPROVED" && approvedAfterIso) {
    query.gte("approved_at", approvedAfterIso).order("approved_at", { ascending: false });
  } else {
    query.order("updated_at", { ascending: false });
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

export async function fetchLatestParGuide(inventoryListId: string) {
  return (supabase
    .from("par_guides")
    .select("id")
    .eq("inventory_list_id", inventoryListId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle()) as unknown as {
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
  return (supabase
    .from("inventory_session_items")
    .select("*")
    .eq("session_id", sessionId)) as unknown as {
    data: InventorySessionItemRow[] | null;
    error: { message: string } | null;
  };
}

export async function fetchSessionItemsByName(sessionId: string) {
  return (supabase
    .from("inventory_session_items")
    .select("*")
    .eq("session_id", sessionId)
    .order("item_name", { ascending: true })) as unknown as {
    data: InventorySessionItemRow[] | null;
    error: { message: string } | null;
  };
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
) {
  return supabase
    .from("par_guides")
    .select("*")
    .eq("restaurant_id", currentRestaurantId)
    .eq("inventory_list_id", inventoryListId)
    .order("updated_at", { ascending: false });
}
