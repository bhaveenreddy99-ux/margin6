import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { VendorMappingRow } from "@/domain/invoices/strongMatchInvoiceItems";
import {
  buildLinkedPurchaseOrderLines,
  flattenInvoiceListRows,
} from "@/domain/invoices/invoicesPageHelpers";
import type {
  DeliveryIssuePoRow,
  InvoiceCatalogItem,
  InvoiceItemRow,
  InvoiceListQueryRow,
  InvoiceListRow,
  InvoiceLocationOption,
  LastSessionItem,
  SmartOrderRunItemRow,
  SmartOrderRunOption,
} from "@/domain/invoices/invoicesPageTypes";
import type { LinkedSmartOrderLine } from "@/components/invoices/types";

type UseInvoicesDataArgs = {
  currentRestaurantId: string | null | undefined;
  dateRange: string;
  linkedSmartOrderId: string;
};

type DeliveryIssueRpcResult = Promise<{
  data: DeliveryIssuePoRow[] | null;
  error: unknown;
}>;

type InvoiceItemsQueryResult = Promise<{
  data: InvoiceItemRow[] | null;
  error: unknown;
}>;

export function useInvoicesData({
  currentRestaurantId,
  dateRange,
  linkedSmartOrderId,
}: UseInvoicesDataArgs) {
  const [purchases, setPurchases] = useState<InvoiceListRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [deliveryIssuePOs, setDeliveryIssuePOs] = useState<DeliveryIssuePoRow[]>([]);
  const [catalogItems, setCatalogItems] = useState<InvoiceCatalogItem[]>([]);
  const [vendorMappings, setVendorMappings] = useState<VendorMappingRow[]>([]);
  const [locations, setLocations] = useState<InvoiceLocationOption[]>([]);
  const [smartOrders, setSmartOrders] = useState<SmartOrderRunOption[]>([]);
  const [lastSessionItems, setLastSessionItems] = useState<LastSessionItem[]>([]);
  const [linkedSmartOrderItems, setLinkedSmartOrderItems] = useState<LinkedSmartOrderLine[]>([]);

  const refreshPurchases = useCallback(async () => {
    if (!currentRestaurantId) return;
    setLoading(true);

    let query = supabase
      .from("invoices")
      .select("*, purchase_orders(po_number, smart_order_run_id)")
      .eq("restaurant_id", currentRestaurantId)
      .order("created_at", { ascending: false });

    if (dateRange !== "all") {
      const now = new Date();
      let start: Date;
      if (dateRange === "7") start = new Date(now.getTime() - 7 * 86400000);
      else if (dateRange === "30") start = new Date(now.getTime() - 30 * 86400000);
      else start = new Date(now.getTime() - 90 * 86400000);
      query = query.gte("created_at", start.toISOString());
    }

    const { data } = (await query) as unknown as { data: InvoiceListQueryRow[] | null };
    if (data) {
      setPurchases(flattenInvoiceListRows(data));
    }
    setLoading(false);
  }, [currentRestaurantId, dateRange]);

  const loadInvoiceItems = useCallback(async (invoiceId: string) => {
    const result = (supabase
      .from("invoice_items")
      .select("*")
      .eq("invoice_id", invoiceId)) as unknown as InvoiceItemsQueryResult;
    const { data } = await result;
    return data ?? [];
  }, []);

  useEffect(() => {
    refreshPurchases();
  }, [refreshPurchases]);

  useEffect(() => {
    if (!currentRestaurantId) return;
    const request = supabase.rpc("get_delivery_issue_pos", {
      p_restaurant_id: currentRestaurantId,
    }) as unknown as DeliveryIssueRpcResult;

    request.then(({ data, error }) => {
      if (!error && data) setDeliveryIssuePOs(data);
    });
  }, [currentRestaurantId]);

  useEffect(() => {
    if (!currentRestaurantId) return;

    const catalogPromise = (supabase
      .from("inventory_catalog_items")
      .select("id, item_name, vendor_sku, product_number, brand_name, vendor_name, unit, pack_size, default_unit_cost")
      .eq("restaurant_id", currentRestaurantId)) as unknown as Promise<{
      data: InvoiceCatalogItem[] | null;
    }>;

    const mappingPromise = (supabase
      .from("vendor_item_mappings")
      .select("*")
      .eq("restaurant_id", currentRestaurantId)) as unknown as Promise<{
      data: VendorMappingRow[] | null;
    }>;

    const locationPromise = (supabase
      .from("locations")
      .select("id, name")
      .eq("restaurant_id", currentRestaurantId)
      .eq("is_active", true)) as unknown as Promise<{
      data: InvoiceLocationOption[] | null;
    }>;

    const smartOrderPromise = (supabase
      .from("smart_order_runs")
      .select("id, created_at, inventory_list_id, inventory_lists(name)")
      .eq("restaurant_id", currentRestaurantId)
      .order("created_at", { ascending: false })
      .limit(10)) as unknown as Promise<{
      data: SmartOrderRunOption[] | null;
    }>;

    Promise.all([
      catalogPromise,
      mappingPromise,
      locationPromise,
      smartOrderPromise,
    ]).then(([catalogResult, mappingResult, locationResult, smartOrderResult]) => {
      if (catalogResult.data) setCatalogItems(catalogResult.data);
      if (mappingResult.data) setVendorMappings(mappingResult.data);
      if (locationResult.data) setLocations(locationResult.data);
      if (smartOrderResult.data) setSmartOrders(smartOrderResult.data);
    });
  }, [currentRestaurantId]);

  useEffect(() => {
    if (!currentRestaurantId) return;
    supabase
      .from("inventory_sessions")
      .select("id")
      .eq("restaurant_id", currentRestaurantId)
      .eq("status", "APPROVED")
      .order("approved_at", { ascending: false })
      .limit(1)
      .then(({ data: sessions }) => {
        if (!sessions?.length) return;
        (supabase
          .from("inventory_session_items")
          .select("item_name, current_stock")
          .eq("session_id", sessions[0].id) as unknown as Promise<{
          data: LastSessionItem[] | null;
        }>).then(({ data }) => {
          if (data) setLastSessionItems(data);
        });
      });
  }, [currentRestaurantId]);

  useEffect(() => {
    if (!linkedSmartOrderId) {
      setLinkedSmartOrderItems([]);
      return;
    }

    (async () => {
      const { data: purchaseOrder } = (await supabase
        .from("purchase_orders")
        .select("id")
        .eq("smart_order_run_id", linkedSmartOrderId)
        .maybeSingle()) as unknown as {
        data: { id: string } | null;
      };

      if (purchaseOrder?.id) {
        const { data: purchaseOrderItems } = (await supabase
          .from("purchase_order_items")
          .select("*")
          .eq("purchase_order_id", purchaseOrder.id)) as unknown as {
          data: NonNullable<Parameters<typeof buildLinkedPurchaseOrderLines>[0]> | null;
        };

        setLinkedSmartOrderItems(buildLinkedPurchaseOrderLines(purchaseOrderItems ?? []));
        return;
      }

      const { data: smartOrderRunItems } = (await supabase
        .from("smart_order_run_items")
        .select("*")
        .eq("run_id", linkedSmartOrderId)) as unknown as {
        data: SmartOrderRunItemRow[] | null;
      };

      setLinkedSmartOrderItems(smartOrderRunItems ?? []);
    })();
  }, [linkedSmartOrderId]);

  return {
    purchases,
    loading,
    deliveryIssuePOs,
    catalogItems,
    vendorMappings,
    locations,
    smartOrders,
    lastSessionItems,
    linkedSmartOrderItems,
    refreshPurchases,
    loadInvoiceItems,
  };
}
