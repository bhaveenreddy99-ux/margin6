import { supabase } from "@/integrations/supabase/client";
import type {
  InvoiceReviewCatalogItem,
  InvoiceReviewComparison,
  InvoiceReviewDocKind,
  InvoiceReviewDocument,
  InvoiceReviewIssue,
  InvoiceReviewLineItem,
  InvoiceReviewPoItem,
  InvoiceReviewVendorMapping,
} from "@/domain/invoices/invoiceReviewTypes";

export type FetchedInvoiceReviewDoc = {
  docKind: InvoiceReviewDocKind;
  invoice: InvoiceReviewDocument;
  items: InvoiceReviewLineItem[];
  poItems: InvoiceReviewPoItem[];
  comparisons: InvoiceReviewComparison[];
  issues: InvoiceReviewIssue[];
  catalogItems: InvoiceReviewCatalogItem[];
  vendorMappings: InvoiceReviewVendorMapping[];
};

async function fetchSupportingData(
  restaurantId: string,
  invoiceId: string,
  docKind: InvoiceReviewDocKind,
  vendorName: string | null | undefined,
  itemsQuery: Promise<{ data: InvoiceReviewLineItem[] | null }>,
  comparisonsQuery: Promise<{ data: InvoiceReviewComparison[] | null }>,
): Promise<{
  items: InvoiceReviewLineItem[];
  comparisons: InvoiceReviewComparison[];
  issues: InvoiceReviewIssue[];
  catalogItems: InvoiceReviewCatalogItem[];
  vendorMappings: InvoiceReviewVendorMapping[];
}> {
  const catalogQuery = supabase
    .from("inventory_catalog_items")
    .select("id, item_name, vendor_sku, product_number")
    .eq("restaurant_id", restaurantId) as unknown as Promise<{
    data: InvoiceReviewCatalogItem[] | null;
  }>;

  // delivery_issues hits TS instantiation depth limit on typed .from() — cast at source
  const issuesColumn = docKind === "invoice" ? "invoice_id" : "purchase_history_id";
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const issuesQuery = (supabase as any)
    .from("delivery_issues")
    .select("*")
    .eq(issuesColumn, invoiceId) as Promise<{
    data: InvoiceReviewIssue[] | null;
    error: { message: string } | null;
  }>;

  const [itemsResult, comparisonsResult, catalogResult, issuesResult] = await Promise.all([
    itemsQuery,
    comparisonsQuery,
    catalogQuery,
    issuesQuery,
  ]);

  if (issuesResult.error) console.warn("[delivery_issues fetch]", issuesResult.error.message);

  let vendorMappings: InvoiceReviewVendorMapping[] = [];
  if (vendorName) {
    const { data } = await supabase
      .from("vendor_item_mappings")
      .select("*")
      .eq("restaurant_id", restaurantId)
      .eq("vendor_name", vendorName);
    vendorMappings = data || [];
  }

  return {
    items: itemsResult.data || [],
    comparisons: comparisonsResult.data || [],
    issues: issuesResult.data ?? [],
    catalogItems: catalogResult.data || [],
    vendorMappings,
  };
}

/**
 * Resolves the invoice review document from either the `invoices` or `purchase_history`
 * table, along with all supporting data needed for the review page.
 *
 * Returns null if no document is found for the given id + restaurantId.
 */
export async function fetchInvoiceReviewDoc(
  id: string,
  restaurantId: string,
): Promise<FetchedInvoiceReviewDoc | null> {
  // Try invoices first
  const { data: invData, error: invErr } = await supabase
    .from("invoices")
    .select("*, purchase_orders(id, po_number, smart_order_run_id, purchase_order_items(*))")
    .eq("id", id)
    .eq("restaurant_id", restaurantId)
    .maybeSingle();

  if (invData && !invErr) {
    const invoice = invData as InvoiceReviewDocument;
    const poItems = (invoice.purchase_orders?.purchase_order_items || []) as InvoiceReviewPoItem[];

    const supporting = await fetchSupportingData(
      restaurantId,
      id,
      "invoice",
      invoice.vendor_name,
      supabase.from("invoice_items").select("*").eq("invoice_id", id) as unknown as Promise<{
        data: InvoiceReviewLineItem[] | null;
      }>,
      supabase
        .from("invoice_line_comparisons")
        .select("*")
        .eq("invoice_id", id) as unknown as Promise<{ data: InvoiceReviewComparison[] | null }>,
    );

    return { docKind: "invoice", invoice, poItems, ...supporting };
  }

  // Fall back to purchase_history
  const { data: legacyData } = await supabase
    .from("purchase_history")
    .select("*, smart_order_runs(id, po_number, smart_order_run_items(*)), purchase_orders(po_number)")
    .eq("id", id)
    .eq("restaurant_id", restaurantId)
    .single();

  if (!legacyData) return null;

  const invoice = legacyData as InvoiceReviewDocument;
  const poItems = (invoice.smart_order_runs?.smart_order_run_items || []) as InvoiceReviewPoItem[];

  const supporting = await fetchSupportingData(
    restaurantId,
    id,
    "purchase_history",
    invoice.vendor_name,
    supabase
      .from("purchase_history_items")
      .select("*")
      .eq("purchase_history_id", id) as unknown as Promise<{
      data: InvoiceReviewLineItem[] | null;
    }>,
    supabase
      .from("invoice_line_comparisons")
      .select("*")
      .eq("purchase_history_id", id) as unknown as Promise<{
      data: InvoiceReviewComparison[] | null;
    }>,
  );

  return { docKind: "purchase_history", invoice, poItems, ...supporting };
}
