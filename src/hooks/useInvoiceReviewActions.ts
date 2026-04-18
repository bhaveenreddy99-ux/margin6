import { useState, type Dispatch, type SetStateAction } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import type {
  ConfirmInvoiceReceiptResult,
  InvoiceReviewComparison,
  InvoiceReviewDocKind,
  InvoiceReviewDocument,
  InvoiceReviewIssue,
  InvoiceReviewLineItem,
  InvoiceReviewVendorMapping,
} from "@/domain/invoices/invoiceReviewTypes";

type StateSetter<T> = Dispatch<SetStateAction<T>>;

type UseInvoiceReviewActionsArgs = {
  id?: string;
  currentRestaurantId?: string;
  reviewDocKind: InvoiceReviewDocKind;
  invoice: InvoiceReviewDocument | null;
  lineItemById: Record<string, InvoiceReviewLineItem>;
  catalogOverrides: Record<string, string>;
  reportItem: InvoiceReviewComparison | null;
  reportIssueType: string;
  reportNotes: string;
  setInvoice: StateSetter<InvoiceReviewDocument | null>;
  setInvoiceItems: StateSetter<InvoiceReviewLineItem[]>;
  setComparisons: StateSetter<InvoiceReviewComparison[]>;
  setIssues: StateSetter<InvoiceReviewIssue[]>;
  setVendorMappings: StateSetter<InvoiceReviewVendorMapping[]>;
  setCatalogOverrides: StateSetter<Record<string, string>>;
  setReportSheetOpen: StateSetter<boolean>;
};

function getErrorMessage(error: unknown) {
  if (typeof error === "object" && error !== null && "message" in error) {
    return String((error as { message?: unknown }).message ?? "Unknown error");
  }

  return String(error);
}

export function useInvoiceReviewActions({
  id,
  currentRestaurantId,
  reviewDocKind,
  invoice,
  lineItemById,
  catalogOverrides,
  reportItem,
  reportIssueType,
  reportNotes,
  setInvoice,
  setInvoiceItems,
  setComparisons,
  setIssues,
  setVendorMappings,
  setCatalogOverrides,
  setReportSheetOpen,
}: UseInvoiceReviewActionsArgs) {
  const [confirming, setConfirming] = useState(false);
  const [confirmResult, setConfirmResult] = useState<ConfirmInvoiceReceiptResult | null>(null);
  const [savingMappings, setSavingMappings] = useState<Record<string, boolean>>({});
  const [reportSaving, setReportSaving] = useState(false);

  const handleConfirmReceipt = async () => {
    if (!id || !currentRestaurantId) return;

    setConfirming(true);
    try {
      const { data, error } = await supabase.rpc("confirm_invoice_receipt", {
        p_invoice_id: id,
        p_restaurant_id: currentRestaurantId,
      });
      if (error) throw error;

      setInvoice((prev) => {
        if (!prev) return prev;

        return reviewDocKind === "invoice"
          ? { ...prev, receipt_status: "confirmed", status: "confirmed" }
          : { ...prev, receipt_status: "confirmed", invoice_status: "COMPLETE" };
      });

      setConfirmResult(data as ConfirmInvoiceReceiptResult);

      supabase
        .rpc("notify_delivery_issues", {
          p_purchase_history_id: id,
        })
        .then(({ error }) => {
          if (error) console.warn(
            "[notify_delivery_issues after confirm]",
            error.message,
          );
        });
    } catch (error: unknown) {
      toast.error(`Failed: ${getErrorMessage(error)}`);
    } finally {
      setConfirming(false);
    }
  };

  const handleSaveIssue = async () => {
    if (!reportItem || !id) return;

    setReportSaving(true);
    try {
      const issueRow =
        reviewDocKind === "invoice"
          ? {
              invoice_id: id,
              purchase_history_id: null as string | null,
              invoice_line_comparison_id: reportItem.id,
              catalog_item_id: reportItem.catalog_item_id || null,
              item_name: reportItem.item_name,
              issue_type: reportIssueType,
              notes: reportNotes.trim() || null,
            }
          : {
              purchase_history_id: id,
              invoice_id: null as string | null,
              invoice_line_comparison_id: reportItem.id,
              catalog_item_id: reportItem.catalog_item_id || null,
              item_name: reportItem.item_name,
              issue_type: reportIssueType,
              notes: reportNotes.trim() || null,
            };

      const { data, error } = await supabase
        .from("delivery_issues")
        .insert(issueRow)
        .select()
        .single();
      if (error) throw error;

      setIssues((prev) => [...prev, data as InvoiceReviewIssue]);
      setReportSheetOpen(false);

      if (reviewDocKind === "invoice") {
        await supabase.from("invoices").update({ receipt_status: "issues_reported" }).eq("id", id);
      } else {
        await supabase.from("purchase_history").update({ receipt_status: "issues_reported" }).eq("id", id);
      }

      setInvoice((prev) => (prev ? { ...prev, receipt_status: "issues_reported" } : prev));
      toast.success("Issue reported");
    } catch (error: unknown) {
      toast.error(`Failed: ${getErrorMessage(error)}`);
    } finally {
      setReportSaving(false);
    }
  };

  const handleSaveMapping = async (comparison: InvoiceReviewComparison) => {
    const selectedCatalogId = catalogOverrides[comparison.id];
    if (!selectedCatalogId || !currentRestaurantId || !invoice) return;

    setSavingMappings((prev) => ({ ...prev, [comparison.id]: true }));
    try {
      const lineId = comparison.invoice_item_id || comparison.purchase_history_item_id;
      const lineItem = lineId ? lineItemById[lineId] : null;

      await supabase.from("vendor_item_mappings").upsert(
        {
          restaurant_id: currentRestaurantId,
          vendor_name: invoice.vendor_name,
          vendor_sku: lineItem?.vendor_sku || null,
          vendor_item_name: comparison.item_name,
          catalog_item_id: selectedCatalogId,
        },
        { onConflict: "restaurant_id,vendor_name,vendor_item_name" },
      );

      if (comparison.invoice_item_id) {
        await supabase
          .from("invoice_items")
          .update({ catalog_item_id: selectedCatalogId, match_status: "MAPPED" })
          .eq("id", comparison.invoice_item_id);
        setInvoiceItems((prev) =>
          prev.map((item) =>
            item.id === comparison.invoice_item_id
              ? { ...item, catalog_item_id: selectedCatalogId, match_status: "MAPPED" }
              : item,
          ),
        );
      } else if (comparison.purchase_history_item_id) {
        await supabase
          .from("purchase_history_items")
          .update({ catalog_item_id: selectedCatalogId, match_status: "MAPPED" })
          .eq("id", comparison.purchase_history_item_id);
        setInvoiceItems((prev) =>
          prev.map((item) =>
            item.id === comparison.purchase_history_item_id
              ? { ...item, catalog_item_id: selectedCatalogId, match_status: "MAPPED" }
              : item,
          ),
        );
      }

      await supabase
        .from("invoice_line_comparisons")
        .update({ catalog_item_id: selectedCatalogId })
        .eq("id", comparison.id);

      setComparisons((prev) =>
        prev.map((row) =>
          row.id === comparison.id ? { ...row, catalog_item_id: selectedCatalogId } : row,
        ),
      );
      setVendorMappings((prev) => {
        const index = prev.findIndex(
          (mapping) =>
            mapping.vendor_item_name?.toLowerCase() === comparison.item_name?.toLowerCase(),
        );
        const entry: InvoiceReviewVendorMapping = {
          restaurant_id: currentRestaurantId,
          vendor_name: invoice.vendor_name ?? null,
          vendor_item_name: comparison.item_name,
          vendor_sku: lineItem?.vendor_sku || null,
          catalog_item_id: selectedCatalogId,
        };
        if (index >= 0) {
          const next = [...prev];
          next[index] = { ...next[index], ...entry };
          return next;
        }
        return [...prev, entry];
      });
      setCatalogOverrides((prev) => {
        const next = { ...prev };
        delete next[comparison.id];
        return next;
      });
      toast.success("Mapping saved");
    } catch (error: unknown) {
      toast.error(`Failed: ${getErrorMessage(error)}`);
    } finally {
      setSavingMappings((prev) => ({ ...prev, [comparison.id]: false }));
    }
  };

  const persistReceivedQty = async (comparison: InvoiceReviewComparison, raw: string) => {
    const trimmed = raw.trim();
    const numeric = trimmed === "" ? null : Number(trimmed);
    const fallback = Number(comparison.invoiced_qty) || 0;
    const toSave = numeric != null && Number.isFinite(numeric) ? numeric : fallback;
    const { error } = await supabase
      .from("invoice_line_comparisons")
      .update({ received_qty: toSave })
      .eq("id", comparison.id);

    if (error) {
      toast.error("Could not save received quantity");
      console.error(error);
      return;
    }

    setComparisons((prev) =>
      prev.map((row) => (row.id === comparison.id ? { ...row, received_qty: toSave } : row)),
    );
  };

  return {
    confirmResult,
    setConfirmResult,
    confirming,
    handleConfirmReceipt,
    reportSaving,
    handleSaveIssue,
    savingMappings,
    handleSaveMapping,
    persistReceivedQty,
  };
}
