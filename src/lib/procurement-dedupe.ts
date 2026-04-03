import { supabase } from "@/integrations/supabase/client";

/**
 * All `invoices.id` values for a restaurant. Legacy `purchase_history` rows whose
 * `id` is in this set were migrated to the invoices table and must not be double-counted
 * or listed twice when merging procurement reads.
 */
export async function fetchInvoiceDocumentIdsForRestaurant(restaurantId: string): Promise<Set<string>> {
  const { data } = await supabase.from("invoices").select("id").eq("restaurant_id", restaurantId);
  return new Set((data ?? []).map((r) => r.id));
}
