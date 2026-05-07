import { useCallback, useEffect, useState } from "react";
import type { NavigateFunction } from "react-router-dom";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { fetchInvoiceReviewDoc } from "@/data/invoice/fetchInvoiceReviewDoc";
import { insertComparisonRows } from "@/data/invoice/insertComparisonRows";
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

  const loadData = useCallback(async () => {
    if (!id || !currentRestaurantId) return;

    setLoading(true);
    try {
      const doc = await fetchInvoiceReviewDoc(id, currentRestaurantId);

      if (!doc) {
        toast.error("Invoice not found");
        navigate(-1);
        return;
      }

      setReviewDocKind(doc.docKind);
      setInvoice(doc.invoice);
      setPoItems(doc.poItems);
      setInvoiceItems(doc.items);
      setCatalogItems(doc.catalogItems);
      setIssues(doc.issues);
      setVendorMappings(doc.vendorMappings);

      // Explicit write: only runs when this invoice has never been reviewed before.
      // Separated from the read so it can never race with a concurrent viewer.
      if (doc.comparisons.length === 0 && doc.items.length > 0) {
        const inserted = await insertComparisonRows(
          doc.invoice,
          doc.items,
          doc.poItems,
          doc.vendorMappings,
          doc.catalogItems,
          doc.docKind,
        );
        setComparisons(inserted);

        supabase
          .rpc("notify_delivery_issues", { p_purchase_history_id: id })
          .then(({ error }) => {
            if (error) console.warn("[notify_delivery_issues]", error.message);
          });
      } else {
        setComparisons(doc.comparisons);
      }
    } finally {
      setLoading(false);
    }
  }, [currentRestaurantId, id, navigate]);

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
