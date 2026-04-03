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
}

export interface InvoiceHeader {
  vendor_name: string;
  invoice_number: string;
  invoice_date: string;
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
