import { useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { analyzeInvoiceComparison } from "@/lib/invoice-comparison";
import {
  countMissingReceivedQty,
  countUnconfirmedReceivedQty,
} from "@/domain/invoices/invoiceReviewSelectors";
import { validateReceivingBeforeConfirm } from "@/domain/invoices/receivingEngine";
import { FIXED_STATUSES } from "@/domain/invoices/invoiceStatusLifecycle";
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
  comparisons: InvoiceReviewComparison[];
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

/** Returns false for statuses that must never be overridden by a client-derived value. */
function shouldPersistDerivedStatus(currentDbStatus: string | null | undefined): boolean {
  return currentDbStatus == null || !FIXED_STATUSES.has(currentDbStatus as never);
}

type StatusPersistResult = { persisted: false } | { persisted: true; status: string };

/**
 * Writes the derived status to the DB if the current DB status is not a FIXED_STATUS.
 * Toasts on write failure; never throws.
 */
async function persistStatusIfAllowed(
  comparisonId: string,
  currentDbStatus: string | null | undefined,
  newDerivedStatus: string,
): Promise<StatusPersistResult> {
  if (!shouldPersistDerivedStatus(currentDbStatus)) return { persisted: false };
  const { error } = await supabase
    .from("invoice_line_comparisons")
    .update({ status: newDerivedStatus })
    .eq("id", comparisonId);
  if (error) {
    toast.error("Could not update line status");
    console.error(error);
    return { persisted: false };
  }
  return { persisted: true, status: newDerivedStatus };
}

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
  comparisons,
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

  // Single source of truth — derived from comparisons on every render.
  // Eliminates the useState+useEffect+eager-update triple that could disagree.
  const receivedMissingCount = useMemo(
    () => countMissingReceivedQty(comparisons),
    [comparisons],
  );

  // Phase 4: count rows auto-filled but not yet manager-confirmed
  const receivedUnconfirmedCount = useMemo(
    () => countUnconfirmedReceivedQty(comparisons),
    [comparisons],
  );

  // Non-stale read for handleConfirmReceipt: comparisons prop updates each render,
  // but the async handler captures a closure snapshot. The ref always holds current.
  const comparisonsRef = useRef(comparisons);
  useEffect(() => { comparisonsRef.current = comparisons; }, [comparisons]);

  const handleConfirmReceipt = async () => {
    if (!id || !currentRestaurantId) return;

    // Phase 4: validate both missing qty AND unconfirmed qty using receivingEngine
    const validation = validateReceivingBeforeConfirm({ comparisons: comparisonsRef.current });
    if (!validation.valid) {
      toast.error(validation.reason ?? "Please confirm all received quantities before posting.");
      return;
    }

    // Guard for legacy countMissingReceivedQty (belt-and-suspenders)
    const missingCount = countMissingReceivedQty(comparisonsRef.current);
    if (missingCount > 0) return;

    setConfirming(true);
    try {
      const { data, error } = await supabase.rpc("confirm_invoice_receipt", {
        p_invoice_id: id,
        p_restaurant_id: currentRestaurantId,
      });
      if (error) throw error;

      // Server-side gate can return success:false (e.g. received_qty_not_confirmed)
      // without raising a PostgREST error — handle it explicitly.
      if (data && typeof data === "object" && "success" in data && data.success === false) {
        const msg = (data as { message?: string }).message ?? "Receipt could not be posted.";
        toast.error(msg);
        return;
      }

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
          if (error) toast.error("Delivery issue notification failed — issues were saved but the notification could not be sent");
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

      const newDerivedStatus = analyzeInvoiceComparison(comparison).status;
      const statusResult = await persistStatusIfAllowed(comparison.id, comparison.status, newDerivedStatus);

      setComparisons((prev) =>
        prev.map((row) => {
          if (row.id !== comparison.id) return row;
          return {
            ...row,
            catalog_item_id: selectedCatalogId,
            ...(statusResult.persisted ? { status: statusResult.status } : {}),
          };
        }),
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
    const invalidNumber = trimmed !== "" && !Number.isFinite(numeric);
    const toSave = numeric != null && Number.isFinite(numeric) ? numeric : null;

    // Phase 4: user explicitly edited this row → mark it manager-confirmed
    const { error: qtyError } = await supabase
      .from("invoice_line_comparisons")
      .update({ received_qty: toSave, received_qty_confirmed: true })
      .eq("id", comparison.id);

    if (qtyError) {
      toast.error("Could not save received quantity");
      console.error(qtyError);
      return;
    }

    if (invalidNumber) {
      toast.error("Received quantity must be a number — left blank");
    }

    const newDerivedStatus = analyzeInvoiceComparison({ ...comparison, received_qty: toSave }).status;
    const statusResult = await persistStatusIfAllowed(comparison.id, comparison.status, newDerivedStatus);

    setComparisons((prev) =>
      prev.map((row) => {
        if (row.id !== comparison.id) return row;
        return {
          ...row,
          received_qty: toSave,
          received_qty_confirmed: true,
          ...(statusResult.persisted ? { status: statusResult.status } : {}),
        };
      }),
    );
  };

  /**
   * Phase 4: Marks ALL real invoice lines as manager-confirmed without changing quantities.
   * Intended for the "Confirm all received quantities are correct" button.
   */
  const handleConfirmAllReceivedQty = async () => {
    if (!id) return;

    const realLines = comparisonsRef.current.filter((c) => {
      const invoicedQty = Number(c.invoiced_qty ?? 0);
      return Number.isFinite(invoicedQty) && invoicedQty > 0 && c.status !== "missing_from_invoice";
    });
    if (realLines.length === 0) return;

    // For purchase_history docs comparisons are keyed by purchase_history_id, not invoice_id.
    const confirmAllQuery = supabase
      .from("invoice_line_comparisons")
      .update({ received_qty_confirmed: true })
      .neq("status", "missing_from_invoice");

    const { error } = await (
      reviewDocKind === "invoice"
        ? confirmAllQuery.eq("invoice_id", id)
        : confirmAllQuery.eq("purchase_history_id", id)
    );

    if (error) {
      toast.error("Could not confirm received quantities");
      console.error(error);
      return;
    }

    setComparisons((prev) =>
      prev.map((row) => {
        const invoicedQty = Number(row.invoiced_qty ?? 0);
        if (!Number.isFinite(invoicedQty) || invoicedQty <= 0) return row;
        if (row.status === "missing_from_invoice") return row;
        return { ...row, received_qty_confirmed: true };
      }),
    );

    toast.success("All received quantities confirmed");
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
    receivedMissingCount,
    receivedUnconfirmedCount,
    handleConfirmAllReceivedQty,
  };
}
