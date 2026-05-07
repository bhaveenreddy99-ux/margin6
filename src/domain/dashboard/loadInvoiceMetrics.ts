import { supabase } from "@/integrations/supabase/client";
import { countPendingInvoices } from "@/domain/dashboard/dashboardSelectors";
import { fetchInvoiceDocumentIdsForRestaurant } from "@/lib/procurement-dedupe";

export type InvoiceMetricsResult = {
  pendingInvoices: number;
};

export async function loadInvoiceMetrics(
  restaurantId: string,
  locationId?: string,
): Promise<InvoiceMetricsResult> {
  const invoiceDocIds = await fetchInvoiceDocumentIdsForRestaurant(restaurantId);

  let invoicePendingQuery = supabase
    .from("invoices")
    .select("id", { count: "exact", head: true })
    .eq("restaurant_id", restaurantId)
    .in("status", ["draft", "review", "ready_to_receive"]);
  if (locationId) invoicePendingQuery = invoicePendingQuery.eq("location_id", locationId);

  let purchaseHistoryPendingQuery = supabase
    .from("purchase_history")
    .select("id")
    .eq("restaurant_id", restaurantId)
    .in("invoice_status", ["DRAFT", "RECEIVED"]);
  if (locationId) purchaseHistoryPendingQuery = purchaseHistoryPendingQuery.eq("location_id", locationId);

  const [invoicePendingResult, purchaseHistoryPendingResult] = await Promise.all([
    invoicePendingQuery as unknown as Promise<{ count: number | null }>,
    purchaseHistoryPendingQuery as unknown as Promise<{ data: { id: string }[] | null }>,
  ]);

  return {
    pendingInvoices: countPendingInvoices(
      invoicePendingResult.count ?? 0,
      purchaseHistoryPendingResult.data ?? [],
      invoiceDocIds,
    ),
  };
}
