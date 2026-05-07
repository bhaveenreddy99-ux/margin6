import type { Database, Json } from "@/integrations/supabase/types";

export type InventoryListRow = Database["public"]["Tables"]["inventory_lists"]["Row"];
export type InventoryListInsert = Database["public"]["Tables"]["inventory_lists"]["Insert"];
export type InventoryListUpdate = Database["public"]["Tables"]["inventory_lists"]["Update"];

export type CatalogItem = Database["public"]["Tables"]["inventory_catalog_items"]["Row"];
export type CatalogItemInsert = Database["public"]["Tables"]["inventory_catalog_items"]["Insert"];
export type CatalogItemUpdate = Database["public"]["Tables"]["inventory_catalog_items"]["Update"];

type ListCategoryRow = Database["public"]["Tables"]["list_categories"]["Row"];

export type ListCategory = ListCategoryRow & {
  parent_category_id?: string | null;
};

export type ListCategoryInsert = Database["public"]["Tables"]["list_categories"]["Insert"] & {
  parent_category_id?: string | null;
};

export type CategorySet = Database["public"]["Tables"]["list_category_sets"]["Row"] & {
  set_type: "custom_ai" | "user_manual" | string;
};

export type ItemCategoryMap = Database["public"]["Tables"]["list_item_category_map"]["Row"];
export type ItemCategoryMapInsert = Database["public"]["Tables"]["list_item_category_map"]["Insert"];

export type PurchaseHistoryRow = Database["public"]["Tables"]["purchase_history"]["Row"];
export type PurchaseHistoryItemRow = Database["public"]["Tables"]["purchase_history_items"]["Row"];
export type ImportTemplateRow = Database["public"]["Tables"]["import_templates"]["Row"];
export type ParGuideRow = Database["public"]["Tables"]["par_guides"]["Row"];

export type PurchaseHistoryWithListName = PurchaseHistoryRow & {
  inventory_lists?: { name: string | null } | null;
};

export type LinkedParGuide = {
  id: string;
  name: string;
  itemCount: number;
};

export type RecentPurchasedItem = PurchaseHistoryItemRow & {
  purchase_date: string;
  vendor_name: string | null;
};

export type IssueItem = Pick<
  CatalogItem,
  | "id"
  | "item_name"
  | "category"
  | "unit"
  | "pack_size"
  | "vendor_sku"
  | "vendor_name"
  | "default_unit_cost"
  | "default_par_level"
> & {
  reasons: string[];
};

export type AdvancedListView = null | "keyword-groups" | "recent";
export type GridSort = "date" | "name";
export type ImportStep = "upload" | "map" | "preview";
export type SaveStatus = "saved" | "saving" | "idle";
export type ExportFormat = "csv" | "xlsx" | "pdf";
export type CategorySetType = "custom_ai" | "user_manual";

export type ImportField =
  | "item_name"
  | "unit"
  | "pack_size"
  | "vendor_sku"
  | "default_unit_cost"
  | "brand_name"
  | "vendor_name"
  | "category";

export const REQUIRED_IMPORT_FIELDS = ["item_name"] as const;
export const OPTIONAL_IMPORT_FIELDS = [
  "unit",
  "pack_size",
  "vendor_sku",
  "default_unit_cost",
  "brand_name",
  "vendor_name",
  "category",
] as const;

export type ImportMapping = Partial<Record<ImportField, string>>;

export type ParsedImportCell = string | number | boolean | null | undefined;
export type ParsedImportRow = Record<string, ParsedImportCell>;

export type ImportPreviewRow = {
  sr_no: number;
  item_name: string;
  unit: string;
  pack_size: string;
  vendor_sku: string;
  default_unit_cost: number | null;
  brand_name: string;
  vendor_name: string;
  category: string;
  unit_cost_raw: string;
};

export type ImportSummary = {
  itemsReady: number;
  duplicates: number;
  missingUnit: number;
  missingPackSize: number;
  emptyNameRows: number;
};

export type NewItemDraft = {
  item_name: string;
  category: string;
  unit: string;
  pack_size: string;
  vendor_sku: string;
  vendor_name: string;
  default_unit_cost: number;
  par_level: string;
};

export type ItemEditDraft = Partial<
  Pick<
    CatalogItemUpdate,
    | "item_name"
    | "category"
    | "unit"
    | "pack_size"
    | "vendor_sku"
    | "vendor_name"
    | "default_unit_cost"
    | "default_par_level"
  >
>;

export type EditSheetValues = {
  item_name: string;
  vendor_sku: string;
  default_unit_cost: number | null;
  unit: string;
  pack_size: string;
};

export type CatalogItemQuickUpdate = Pick<
  CatalogItemUpdate,
  "item_name" | "vendor_sku" | "unit" | "vendor_name" | "pack_size" | "default_unit_cost"
>;

export type ImportTemplateMapping = Record<string, string>;

export type CatalogMetadata = Json;
