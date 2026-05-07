import { supabase } from "@/integrations/supabase/client";
import { buildComparisonRows } from "@/domain/invoices/buildComparisonRows";
import type {
  InvoiceReviewCatalogItem,
  InvoiceReviewComparison,
  InvoiceReviewDocKind,
  InvoiceReviewDocument,
  InvoiceReviewLineItem,
  InvoiceReviewPoItem,
  InvoiceReviewVendorMapping,
} from "@/domain/invoices/invoiceReviewTypes";

/**
 * Generates and inserts comparison rows for an invoice that has none yet.
 * Returns the inserted rows, or an empty array if there was nothing to insert.
 *
 * This is a deliberate write operation — call it explicitly, never from a read hook.
 */
export async function insertComparisonRows(
  invoice: InvoiceReviewDocument,
  items: InvoiceReviewLineItem[],
  poItems: InvoiceReviewPoItem[],
  vendorMappings: InvoiceReviewVendorMapping[],
  catalogItems: InvoiceReviewCatalogItem[],
  docKind: InvoiceReviewDocKind,
): Promise<InvoiceReviewComparison[]> {
  const rows = buildComparisonRows(invoice, items, poItems, vendorMappings, catalogItems, docKind);
  if (rows.length === 0) return [];

  const { data: inserted } = await supabase
    .from("invoice_line_comparisons")
    .insert(rows)
    .select();

  return (inserted as InvoiceReviewComparison[]) ?? [];
}
