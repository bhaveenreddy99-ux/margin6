import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { fetchInvoiceDocumentIdsForRestaurant } from "@/lib/procurement-dedupe";

/**
 * Current behavior (updated for split procurement model):
 * - Fetches the latest purchase-related date per catalog item from confirmed vendor
 *   invoices (`invoices` + `invoice_items`) and, for unmigrated legacy rows only,
 *   from `purchase_history` in RECEIVED/POSTED/COMPLETE status.
 * - Optionally scoped by `location_id`.
 * - Returns `catalog_item_id` → ISO date string (invoice_date preferred, else created_at).
 */
export function useLastOrderDates(restaurantId: string | undefined, locationId?: string | null) {
  const [dateMap, setDateMap] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!restaurantId) {
      setDateMap({});
      return;
    }

    let cancelled = false;
    const run = async () => {
      setLoading(true);
      const invoiceDocIds = await fetchInvoiceDocumentIdsForRestaurant(restaurantId);

      // --- New model: confirmed invoices (receipt finalized), line-level catalog link ---
      let invQuery = supabase
        .from("invoices")
        .select("id, created_at, invoice_date")
        .eq("restaurant_id", restaurantId)
        .eq("status", "confirmed");

      if (locationId) {
        invQuery = invQuery.eq("location_id", locationId);
      }

      const { data: invoices } = await invQuery;
      const invDates: Record<string, string> = {};
      (invoices ?? []).forEach((inv) => {
        invDates[inv.id] = inv.invoice_date || inv.created_at;
      });
      const invIds = Object.keys(invDates);

      let invItems: { catalog_item_id: string | null; invoice_id: string }[] = [];
      if (invIds.length > 0) {
        const { data: ii } = await supabase
          .from("invoice_items")
          .select("catalog_item_id, invoice_id")
          .in("invoice_id", invIds)
          .not("catalog_item_id", "is", null);
        invItems = (ii ?? []) as typeof invItems;
      }

      // --- Legacy: purchase_history not superseded by an invoices row ---
      let phQuery = supabase
        .from("purchase_history")
        .select("id, created_at, invoice_date")
        .eq("restaurant_id", restaurantId)
        .in("invoice_status", ["RECEIVED", "POSTED", "COMPLETE"]);

      if (locationId) {
        phQuery = phQuery.eq("location_id", locationId);
      }

      const { data: purchasesRaw } = await phQuery;
      const purchases = (purchasesRaw ?? []).filter((p) => !invoiceDocIds.has(p.id));

      const phIds = purchases.map((p) => p.id);
      const phDateMap: Record<string, string> = {};
      purchases.forEach((p) => {
        phDateMap[p.id] = p.invoice_date || p.created_at;
      });

      let phItems: { catalog_item_id: string | null; purchase_history_id: string }[] = [];
      if (phIds.length > 0) {
        const { data: phi } = await supabase
          .from("purchase_history_items")
          .select("catalog_item_id, purchase_history_id")
          .in("purchase_history_id", phIds)
          .not("catalog_item_id", "is", null);
        phItems = (phi ?? []) as typeof phItems;
      }

      const result: Record<string, string> = {};

      const takeMax = (catalogId: string, date: string) => {
        if (!date) return;
        if (!result[catalogId] || date > result[catalogId]) {
          result[catalogId] = date;
        }
      };

      invItems.forEach((item) => {
        if (!item.catalog_item_id) return;
        const date = invDates[item.invoice_id];
        if (date) takeMax(item.catalog_item_id, date);
      });

      phItems.forEach((item) => {
        if (!item.catalog_item_id) return;
        const date = phDateMap[item.purchase_history_id];
        if (date) takeMax(item.catalog_item_id, date);
      });

      if (!cancelled) {
        setDateMap(result);
        setLoading(false);
      }
    };

    run();
    return () => {
      cancelled = true;
    };
  }, [restaurantId, locationId]);

  return { lastOrderDates: dateMap, loading };
}
