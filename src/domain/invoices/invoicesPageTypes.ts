import type { Database } from "@/integrations/supabase/types";

export type InvoiceTableRow = Database["public"]["Tables"]["invoices"]["Row"];
export type InvoiceItemRow = Database["public"]["Tables"]["invoice_items"]["Row"];
export type InvoiceInsert = Database["public"]["Tables"]["invoices"]["Insert"];
export type InvoiceUpdate = Database["public"]["Tables"]["invoices"]["Update"];
export type InvoiceItemInsert = Database["public"]["Tables"]["invoice_items"]["Insert"];
export type InvoiceIngestionInsert = Database["public"]["Tables"]["invoice_ingestions"]["Insert"];
export type PurchaseOrderRow = Database["public"]["Tables"]["purchase_orders"]["Row"];
export type PurchaseOrderItemRow = Database["public"]["Tables"]["purchase_order_items"]["Row"];
export type SmartOrderRunItemRow = Database["public"]["Tables"]["smart_order_run_items"]["Row"];
export type LocationRow = Database["public"]["Tables"]["locations"]["Row"];
export type SmartOrderRunRow = Database["public"]["Tables"]["smart_order_runs"]["Row"];
export type InventorySessionItemRow = Database["public"]["Tables"]["inventory_session_items"]["Row"];
export type CatalogItemRow = Database["public"]["Tables"]["inventory_catalog_items"]["Row"];

export type InvoiceListQueryRow = InvoiceTableRow & {
  purchase_orders?: { po_number: string | null; smart_order_run_id: string | null } | null;
  po_number?: string | null;
};

export type InvoiceListRow = InvoiceTableRow & {
  po_number: string | null;
  smart_order_run_id: string | null;
  purchase_orders?: { po_number: string | null; smart_order_run_id: string | null } | null;
};

export type InvoiceCatalogItem = Pick<
  CatalogItemRow,
  | "id"
  | "item_name"
  | "vendor_sku"
  | "product_number"
  | "brand_name"
  | "vendor_name"
  | "unit"
  | "pack_size"
  | "default_unit_cost"
>;

export type InvoiceLocationOption = Pick<LocationRow, "id" | "name">;

export type InvoiceListOption = Pick<
  Database["public"]["Tables"]["inventory_lists"]["Row"],
  "id" | "name"
>;

export type SmartOrderRunOption = Pick<
  SmartOrderRunRow,
  "id" | "created_at" | "inventory_list_id"
> & {
  inventory_lists?: { name: string | null } | null;
};

export type LastSessionItem = Pick<InventorySessionItemRow, "item_name" | "current_stock">;

export type DeliveryIssuePoRow = {
  purchase_history_id: string;
  po_number: string | null;
  issue_count: number;
};

export type PurchaseOrderCandidateRow = Pick<
  PurchaseOrderRow,
  "id" | "po_number" | "vendor_name" | "created_at"
>;

export type PurchaseOrderCatalogLinkRow = Pick<
  PurchaseOrderItemRow,
  "purchase_order_id" | "catalog_item_id"
>;

export type ParseInvoiceRawItem = {
  product_number?: unknown;
  item_name?: unknown;
  quantity?: unknown;
  unit_cost?: unknown;
  line_total?: unknown;
  unit?: unknown;
  pack_size?: unknown;
  brand_name?: unknown;
};

export type ParseInvoiceResult = {
  vendor_name?: string;
  invoice_number?: string;
  invoice_date?: string;
  po_number?: string | null;
  subtotal?: number;
  tax?: number;
  total?: number;
  items?: ParseInvoiceRawItem[];
  error?: string;
};

export type InvoiceCreateTab = "manual" | "import" | "vendor";
export type InvoiceSaveIntent = "DRAFT" | "RECEIVED";
export type InvoiceStatusFilter = "all" | "draft" | "pending_review" | "posted";
