import { useCallback, useEffect, useState } from "react";
import type { NavigateFunction } from "react-router-dom";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { buildComparisonRows } from "@/domain/invoices/buildComparisonRows";
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

type UseInvoiceReviewDataArgs = {
  id?: string;
  currentRestaurantId?: string;
  navigate: NavigateFunction;
};

type DeliveryIssuesQuery = {
  select: (query: string) => {
    eq: (column: string, value: string) => Promise<{ data: InvoiceReviewIssue[] | null }>;
  };
};

export function useInvoiceReviewData({
  id,
  currentRestaurantId,
  navigate,
}: UseInvoiceReviewDataArgs) {
  const [invoice, setInvoice] = useState<InvoiceReviewDocument | null>(null);
  const [invoiceItems, setInvoiceItems] = useState<InvoiceReviewLineItem[]>([]);
  const [poItems, setPoItems] = useState<InvoiceReviewPoItem[]>([]);
  const [comparisons, setComparisons] = useState<InvoiceReviewComparison[]>([]);
  const [issues, setIssues] = useState<InvoiceReviewIssue[]>([]);
  const [catalogItems, setCatalogItems] = useState<InvoiceReviewCatalogItem[]>([]);
  const [vendorMappings, setVendorMappings] = useState<InvoiceReviewVendorMapping[]>([]);
  const [loading, setLoading] = useState(true);
  const [reviewDocKind, setReviewDocKind] = useState<InvoiceReviewDocKind>("invoice");

  const insertGeneratedComparisons = useCallback(
    async (
      invoiceDoc: InvoiceReviewDocument,
      items: InvoiceReviewLineItem[],
      poItemsList: InvoiceReviewPoItem[],
      mappings: InvoiceReviewVendorMapping[],
      catalogItemsList: InvoiceReviewCatalogItem[],
      docKind: InvoiceReviewDocKind,
    ) => {
      const rows = buildComparisonRows(
        invoiceDoc,
        items,
        poItemsList,
        mappings,
        catalogItemsList,
        docKind,
      );

      if (rows.length > 0) {
        const { data: inserted } = await supabase
          .from("invoice_line_comparisons")
          .insert(rows)
          .select();
        if (inserted) setComparisons(inserted as InvoiceReviewComparison[]);
      }
    },
    [],
  );

  const loadData = useCallback(async () => {
    if (!id || !currentRestaurantId) return;

    setLoading(true);
    try {
      const { data: invNewData, error: invNewErr } = await supabase
        .from("invoices")
        .select("*, purchase_orders(id, po_number, smart_order_run_id, purchase_order_items(*))")
        .eq("id", id)
        .eq("restaurant_id", currentRestaurantId)
        .maybeSingle();

      const invNew = (invNewData as InvoiceReviewDocument | null) ?? null;
      if (invNew && !invNewErr) {
        setReviewDocKind("invoice");
        setInvoice(invNew);

        const itemsPromise = supabase
          .from("invoice_items")
          .select("*")
          .eq("invoice_id", id) as unknown as Promise<{ data: InvoiceReviewLineItem[] | null }>;
        const catalogItemsPromise = supabase
          .from("inventory_catalog_items")
          .select("id, item_name, vendor_sku, product_number")
          .eq("restaurant_id", currentRestaurantId) as unknown as Promise<{
          data: InvoiceReviewCatalogItem[] | null;
        }>;
        const comparisonsPromise = supabase
          .from("invoice_line_comparisons")
          .select("*")
          .eq("invoice_id", id) as unknown as Promise<{ data: InvoiceReviewComparison[] | null }>;
        const deliveryIssuesQuery = supabase.from("delivery_issues") as unknown as DeliveryIssuesQuery;

        const itemsResult = await itemsPromise;
        const catalogItemsResult = await catalogItemsPromise;
        const comparisonsResult = await comparisonsPromise;
        const issuesResult = await deliveryIssuesQuery.select("*").eq("invoice_id", id);

        const items = itemsResult.data || [];
        const fetchedCatalogItems = catalogItemsResult.data || [];
        const fetchedComparisons = comparisonsResult.data || [];
        const issuesList = issuesResult.data || [];
        const poItemsList = (invNew.purchase_orders?.purchase_order_items ||
          []) as InvoiceReviewPoItem[];

        setPoItems(poItemsList);
        setInvoiceItems(items);
        setCatalogItems(fetchedCatalogItems);
        setIssues(issuesList);

        let mappings: InvoiceReviewVendorMapping[] = [];
        if (invNew.vendor_name) {
          const { data: mappingsData } = await supabase
            .from("vendor_item_mappings")
            .select("*")
            .eq("restaurant_id", currentRestaurantId)
            .eq("vendor_name", invNew.vendor_name);
          mappings = mappingsData || [];
        }

        setVendorMappings(mappings);
        setComparisons(fetchedComparisons);

        if (fetchedComparisons.length === 0 && items.length > 0) {
          await insertGeneratedComparisons(
            invNew,
            items,
            poItemsList,
            mappings,
            fetchedCatalogItems,
            "invoice",
          );
          supabase
            .rpc("notify_delivery_issues", { p_purchase_history_id: id })
            .then(({ error }) => {
              if (error) console.warn("[notify_delivery_issues]", error.message);
            });
        }
        return;
      }

      const { data: legacyData } = await supabase
        .from("purchase_history")
        .select("*, smart_order_runs(id, po_number, smart_order_run_items(*)), purchase_orders(po_number)")
        .eq("id", id)
        .single();

      const legacyInvoice = legacyData as InvoiceReviewDocument | null;
      if (!legacyInvoice) {
        toast.error("Invoice not found");
        navigate(-1);
        return;
      }

      setReviewDocKind("purchase_history");
      setInvoice(legacyInvoice);

      const itemsPromise = supabase
        .from("purchase_history_items")
        .select("*")
        .eq("purchase_history_id", id) as unknown as Promise<{ data: InvoiceReviewLineItem[] | null }>;
      const catalogItemsPromise = supabase
        .from("inventory_catalog_items")
        .select("id, item_name, vendor_sku, product_number")
        .eq("restaurant_id", currentRestaurantId) as unknown as Promise<{
        data: InvoiceReviewCatalogItem[] | null;
      }>;
      const comparisonsPromise = supabase
        .from("invoice_line_comparisons")
        .select("*")
        .eq("purchase_history_id", id) as unknown as Promise<{
        data: InvoiceReviewComparison[] | null;
      }>;
      const deliveryIssuesQuery = supabase.from("delivery_issues") as unknown as DeliveryIssuesQuery;

      const itemsResult = await itemsPromise;
      const catalogItemsResult = await catalogItemsPromise;
      const comparisonsResult = await comparisonsPromise;
      const issuesResult = await deliveryIssuesQuery.select("*").eq("purchase_history_id", id);

      const items = itemsResult.data || [];
      const fetchedCatalogItems = catalogItemsResult.data || [];
      const fetchedComparisons = comparisonsResult.data || [];
      const issuesList = issuesResult.data || [];
      const poItemsList = (legacyInvoice.smart_order_runs?.smart_order_run_items ||
        []) as InvoiceReviewPoItem[];

      setPoItems(poItemsList);
      setInvoiceItems(items);
      setCatalogItems(fetchedCatalogItems);
      setIssues(issuesList);

        let mappings: InvoiceReviewVendorMapping[] = [];
      if (legacyInvoice.vendor_name) {
        const { data: mappingsData } = await supabase
          .from("vendor_item_mappings")
          .select("*")
          .eq("restaurant_id", currentRestaurantId)
          .eq("vendor_name", legacyInvoice.vendor_name);
        mappings = mappingsData || [];
      }

      setVendorMappings(mappings);
      setComparisons(fetchedComparisons);

      if (fetchedComparisons.length === 0 && items.length > 0) {
        await insertGeneratedComparisons(
          legacyInvoice,
          items,
          poItemsList,
          mappings,
          fetchedCatalogItems,
          "purchase_history",
        );
        supabase
          .rpc("notify_delivery_issues", { p_purchase_history_id: id })
          .then(({ error }) => {
            if (error) console.warn("[notify_delivery_issues]", error.message);
          });
      }
    } finally {
      setLoading(false);
    }
  }, [currentRestaurantId, id, insertGeneratedComparisons, navigate]);

  useEffect(() => {
    if (!id || !currentRestaurantId) return;
    void loadData();
  }, [currentRestaurantId, id, loadData]);

  return {
    invoice,
    setInvoice,
    invoiceItems,
    setInvoiceItems,
    poItems,
    comparisons,
    setComparisons,
    issues,
    setIssues,
    catalogItems,
    vendorMappings,
    setVendorMappings,
    loading,
    reviewDocKind,
    loadData,
  };
}
