import type { Database } from "@/integrations/supabase/types";

type DeliveryIssueRow = Database["public"]["Tables"]["delivery_issues"]["Row"];
type InventoryCatalogItemRow = Database["public"]["Tables"]["inventory_catalog_items"]["Row"];
type InvoiceLineComparisonRow = Database["public"]["Tables"]["invoice_line_comparisons"]["Row"];
type InvoiceRow = Database["public"]["Tables"]["invoices"]["Row"];
type PurchaseHistoryRow = Database["public"]["Tables"]["purchase_history"]["Row"];
type VendorMappingRow = Database["public"]["Tables"]["vendor_item_mappings"]["Row"];

export type InvoiceReviewDocKind = "invoice" | "purchase_history";

export type InvoiceReviewCatalogItem = Pick<
  InventoryCatalogItemRow,
  "id" | "item_name" | "vendor_sku" | "product_number"
>;

export type InvoiceReviewLineItem = {
  id: string;
  item_name: string;
  catalog_item_id: string | null;
  match_status?: string | null;
  /** invoice_items rows: quantity_invoiced. purchase_history_items rows: quantity. */
  quantity_invoiced?: number | null;
  /** Legacy alias used by purchase_history_items. Prefer quantity_invoiced when present. */
  quantity?: number | null;
  total_cost?: number | null;
  unit_cost?: number | null;
  product_number?: string | null;
  vendor_sku?: string | null;
  unit?: string | null;
  brand_name?: string | null;
  pack_size?: string | null;
};

export type InvoiceReviewPoItem = {
  id: string;
  item_name: string;
  catalog_item_id?: string | null;
  quantity_ordered?: number | null;
  suggested_order?: number | null;
  total_cost?: number | null;
  unit_cost?: number | null;
  product_number?: string | null;
  brand_name?: string | null;
  pack_size?: string | null;
};

export type InvoiceReviewPurchaseOrdersRelation = {
  id?: string;
  po_number?: string | null;
  smart_order_run_id?: string | null;
  purchase_order_items?: InvoiceReviewPoItem[] | null;
};

export type InvoiceReviewSmartOrderRunRelation = {
  id?: string;
  po_number?: string | null;
  smart_order_run_items?: InvoiceReviewPoItem[] | null;
};

export type InvoiceReviewDocument = Partial<InvoiceRow> &
  Partial<PurchaseHistoryRow> & {
    id: string;
    vendor_name?: string | null;
    invoice_number?: string | null;
    receipt_status?: string | null;
    status?: string | null;
    invoice_status?: string | null;
    purchase_order_id?: string | null;
    purchase_orders?: InvoiceReviewPurchaseOrdersRelation | null;
    smart_order_runs?: InvoiceReviewSmartOrderRunRelation | null;
  };

export type InvoiceReviewIssue = Omit<DeliveryIssueRow, "purchase_history_id"> & {
  purchase_history_id?: string | null;
  invoice_id?: string | null;
};

export type InvoiceReviewVendorMapping = Pick<
  VendorMappingRow,
  "restaurant_id" | "vendor_item_name" | "vendor_sku" | "catalog_item_id"
> &
  Partial<VendorMappingRow> & {
    vendor_name: string | null;
  };

/** Per-line entries from `confirm_invoice_receipt` RPC `items` array (stock-movement path). */
export type ConfirmInvoiceReceiptItem = {
  item_name: string;
  status:
    | "confirmed"
    | "already_confirmed"
    | "unit_conversion_failed"
    | "no_catalog_match";
  /** Normalized quantity in cases when status === "confirmed". */
  quantity_confirmed?: number | null;
  quantity_unit?: string | null;
  /** Raw received qty before normalization (invoice path). */
  source_qty?: number | null;
  source_unit?: string | null;
  reason?: string | null;
};

export type ConfirmInvoiceReceiptResult = {
  /** False when server-side gate blocks the post (e.g. received_qty_not_confirmed). */
  success?: boolean;
  error?: string;
  unconfirmed_count?: number;
  already_confirmed: boolean;
  no_catalog: number;
  confirmed?: number;
  inventory_updated?: boolean;
  stock_movements_created?: number;
  unit_conversion_failed?: number;
  price_changes?: Array<{ item_name: string; old_cost: number | null; new_cost: number; pct_change: number | null; direction: string }>;
  confirmed_at?: string | null;
  message?: string;
  items?: ConfirmInvoiceReceiptItem[];
};

export type InvoiceReviewComparison = InvoiceLineComparisonRow;
