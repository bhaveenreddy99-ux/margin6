import type { Database } from "@/integrations/supabase/types";

type PurchaseOrderItemRow = Database["public"]["Tables"]["purchase_order_items"]["Row"];
type SmartOrderRunItemRow = Database["public"]["Tables"]["smart_order_run_items"]["Row"];

/**
 * PO lines loaded for a linked smart order, with `suggested_order` set from `quantity_ordered`
 * so they align with `smart_order_run_items` for variance/compare logic.
 */
export type LinkedPurchaseOrderLine = PurchaseOrderItemRow & { suggested_order: number | null };

/** Lines backing invoice vs linked order comparison (PO-backed or run-staging). */
export type LinkedSmartOrderLine = LinkedPurchaseOrderLine | SmartOrderRunItemRow;

export interface InvoiceItem {
  product_number: string | null;
  item_name: string;
  quantity: number;
  unit_cost: number | null;
  line_total: number | null;
  unit: string | null;
  pack_size: string | null;
  brand_name?: string | null;
  catalog_item_id: string | null;
  match_status: "MATCHED" | "UNMATCHED" | "MANUAL";
  catalog_match_name?: string;
  /** Present when line was loaded from a saved invoice_items row. */
  id?: string;
}

export interface InvoiceHeader {
  vendor_name: string;
  invoice_number: string;
  invoice_date: string;
  /** Optional PO # for auto-link (manual or pre-filled from linked PO when editing). */
  po_number: string;
  location_id: string;
  linked_smart_order_id: string;
}

export type InvoiceStatus = "DRAFT" | "RECEIVED" | "POSTED";

export interface VendorInvoiceSummary {
  invoice_number: string;
  invoice_date: string;
  vendor_name: string;
  total: number;
  item_count: number;
  status: string;
}
