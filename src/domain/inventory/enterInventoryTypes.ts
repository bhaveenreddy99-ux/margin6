import type { Database } from "@/integrations/supabase/types";

export type InventoryListRow = Database["public"]["Tables"]["inventory_lists"]["Row"];
export type InventorySessionRow = Database["public"]["Tables"]["inventory_sessions"]["Row"];
export type InventorySessionItemZoneRow =
  Database["public"]["Tables"]["inventory_session_item_zones"]["Row"];

export type InventorySessionItemRow = Database["public"]["Tables"]["inventory_session_items"]["Row"] & {
  catalog_item_id?: string | null;
  restaurant_id?: string | null;
  display_order?: number | null;
  product_number?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  /** Present when session items are loaded with an `inventory_session_item_zones` embed. */
  inventory_session_item_zones?: InventorySessionItemZoneRow[] | null;
};
export type InventorySessionItemInsert =
  Database["public"]["Tables"]["inventory_session_items"]["Insert"];
export type InventoryCatalogItemRow =
  Database["public"]["Tables"]["inventory_catalog_items"]["Row"];
export type InventoryCatalogItemUpdate =
  Database["public"]["Tables"]["inventory_catalog_items"]["Update"];
export type ParGuideRow = Database["public"]["Tables"]["par_guides"]["Row"];
export type ParGuideItemRow = Database["public"]["Tables"]["par_guide_items"]["Row"];
export type ReminderRow = Database["public"]["Tables"]["reminders"]["Row"];
export type SmartOrderRunItemInsert =
  Database["public"]["Tables"]["smart_order_run_items"]["Insert"];
export type SmartOrderRunRow = Database["public"]["Tables"]["smart_order_runs"]["Row"];
export type RestaurantMemberRow = Database["public"]["Tables"]["restaurant_members"]["Row"];
export type ProfileRow = Database["public"]["Tables"]["profiles"]["Row"];
export type NotificationRow = Database["public"]["Tables"]["notifications"]["Insert"];
export type SessionStatus = Database["public"]["Enums"]["session_status"];

export type ReminderScheduleForNextOccurrence = Pick<
  ReminderRow,
  "days_of_week" | "time_of_day" | "timezone"
>;

export type InventorySessionListRow = InventorySessionRow & {
  inventory_lists?: { name: string } | null;
  locations?: { name: string } | null;
};

export type ReminderWithListLocation = ReminderRow & {
  inventory_lists?: { name: string } | null;
  locations?: { name: string } | null;
};

export type SessionItemState = {
  itemOrder: string[];
  itemById: Record<string, InventorySessionItemRow>;
};

export type ListSelectorMeta = Record<
  string,
  {
    itemCount: number;
    lastCountedAt: string | null;
    hasParGuide: boolean;
  }
>;

export type SessionStats = Record<
  string,
  {
    qty: number;
    totalValue: number;
    counted: number;
    total: number;
    itemsWithCost: number;
    itemsWithoutCost: number;
    totalItems: number;
  }
>;

export type ScheduleWithNextDate = ReminderWithListLocation & {
  nextDate: Date;
};

export type CatalogLookupEntry = {
  id: string;
  product_number: string | null;
};

export type CategoryMappingEntry = {
  category_id: string | null;
  category_name: string;
  item_sort_order: number;
};

export type MappedCategory = {
  id: string;
  name: string;
  sort_order: number;
};

export type ApprovedParLookupArgs = {
  countingParGuideId: string | null;
  countingParByCatalogId: Record<string, number>;
  countingParByNormalizedName: Record<string, number>;
  approvedParMap: Record<string, number>;
  catalogDefaultParById: Record<string, number>;
  catalogDefaultParByName: Record<string, number>;
};

export type FilterStatus = "all" | "uncounted" | "below_par" | "low" | "critical";
export type CategoryMode =
  | "list_order"
  | "custom-categories"
  | "my-categories"
  | "alphabetic";

export type NotificationPreferenceRecipient = {
  user_id: string;
};

export type NotificationPreferenceRow = Database["public"]["Tables"]["notification_preferences"]["Row"] & {
  alert_recipients?: NotificationPreferenceRecipient[] | null;
};
