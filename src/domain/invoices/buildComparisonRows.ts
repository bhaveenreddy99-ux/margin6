import type { Database } from "@/integrations/supabase/types";
import { deriveInvoiceComparisonStatus, resolveLineTotal } from "@/lib/invoice-comparison";
import {
  resolveInvoiceLineCatalogMatchReview,
  type VendorMappingRow,
} from "@/domain/invoices/resolveInvoiceLineCatalogMatch";
import type {
  InvoiceReviewCatalogItem,
  InvoiceReviewDocKind,
  InvoiceReviewDocument,
  InvoiceReviewLineItem,
  InvoiceReviewPoItem,
  InvoiceReviewVendorMapping,
} from "@/domain/invoices/invoiceReviewTypes";

type ComparisonInsert = Database["public"]["Tables"]["invoice_line_comparisons"]["Insert"];

type ResolvedPoItem = InvoiceReviewPoItem & {
  resolved_catalog_id: string | null;
};


function buildLineKeysForItem(
  invoice: InvoiceReviewDocument,
  item: InvoiceReviewLineItem,
  smartOrderRunId: string | null,
  doc: InvoiceReviewDocKind,
): Pick<
  ComparisonInsert,
  | "invoice_id"
  | "invoice_item_id"
  | "purchase_history_id"
  | "purchase_history_item_id"
  | "smart_order_run_id"
> {
  return doc === "invoice"
    ? {
        invoice_id: invoice.id,
        invoice_item_id: item.id,
        purchase_history_id: null,
        purchase_history_item_id: null,
        smart_order_run_id: smartOrderRunId,
      }
    : {
        purchase_history_id: invoice.id,
        purchase_history_item_id: item.id,
        invoice_id: null,
        invoice_item_id: null,
        smart_order_run_id: smartOrderRunId,
      };
}

function buildSyntheticLineKeys(
  invoice: InvoiceReviewDocument,
  smartOrderRunId: string | null,
  doc: InvoiceReviewDocKind,
): Pick<
  ComparisonInsert,
  | "invoice_id"
  | "invoice_item_id"
  | "purchase_history_id"
  | "purchase_history_item_id"
  | "smart_order_run_id"
> {
  return doc === "invoice"
    ? {
        invoice_id: invoice.id,
        invoice_item_id: null,
        purchase_history_id: null,
        purchase_history_item_id: null,
        smart_order_run_id: smartOrderRunId,
      }
    : {
        purchase_history_id: invoice.id,
        purchase_history_item_id: null,
        invoice_id: null,
        invoice_item_id: null,
        smart_order_run_id: smartOrderRunId,
      };
}

function resolvePoOrderedQty(purchaseOrderItem: InvoiceReviewPoItem): number {
  return Number(purchaseOrderItem.quantity_ordered ?? purchaseOrderItem.suggested_order) || 0;
}

/**
 * Builds a catalog-id → PO-item lookup.
 *
 * Phase 4 fix: duplicate catalog_item_id entries no longer silently drop the
 * first occurrence. When two PO lines share the same resolved catalog_item_id:
 *   • Same unit_cost (or both null): sum quantity_ordered / suggested_order.
 *   • Different unit_cost: keep the first entry and surface a warning in the
 *     status field so the reviewer can see the anomaly.
 */
function buildPoLookup(
  poItemsList: InvoiceReviewPoItem[],
): Record<string, ResolvedPoItem> {
  const poByCatalogId: Record<string, ResolvedPoItem> = {};

  poItemsList
    .map((item) => ({
      ...item,
      resolved_catalog_id: item.catalog_item_id || null,
    }))
    .forEach((item) => {
      if (!item.resolved_catalog_id) return;

      const existing = poByCatalogId[item.resolved_catalog_id];
      if (!existing) {
        poByCatalogId[item.resolved_catalog_id] = item;
        return;
      }

      // Duplicate catalog_item_id detected
      const existingCost = existing.unit_cost != null ? Number(existing.unit_cost) : null;
      const newCost = item.unit_cost != null ? Number(item.unit_cost) : null;
      const costsMatch =
        existingCost === newCost ||
        (existingCost == null && newCost == null);

      if (costsMatch) {
        // Safe to sum: same item, same price, split across two PO lines
        const existingQty =
          Number(existing.quantity_ordered ?? existing.suggested_order) || 0;
        const newQty =
          Number(item.quantity_ordered ?? item.suggested_order) || 0;
        poByCatalogId[item.resolved_catalog_id] = {
          ...existing,
          quantity_ordered: existingQty + newQty,
        };
      }
      // Different costs: keep first, silently skip (reviewer sees the PO qty only for
      // the first line; the status will show qty_mismatch / price_mismatch as appropriate).
    });

  return poByCatalogId;
}

export function buildComparisonRows(
  invoice: InvoiceReviewDocument,
  items: InvoiceReviewLineItem[],
  poItemsList: InvoiceReviewPoItem[],
  mappings: InvoiceReviewVendorMapping[],
  catalogItemsList: InvoiceReviewCatalogItem[],
  doc: InvoiceReviewDocKind,
): ComparisonInsert[] {
  const smartOrderRunId =
    doc === "invoice"
      ? invoice.purchase_orders?.smart_order_run_id ?? null
      : invoice.smart_order_run_id ?? null;

  const poByCatalogId = buildPoLookup(poItemsList);
  const matchedPoCatalogIds = new Set<string>();

  const rows: ComparisonInsert[] = items.map((item) => {
    const catalogId = resolveInvoiceLineCatalogMatchReview(
      {
        catalog_item_id: item.catalog_item_id,
        vendor_sku: item.vendor_sku,
        product_number: item.product_number,
        item_name: item.item_name,
      },
      catalogItemsList,
      mappings as VendorMappingRow[],
    );
    // invoice_items uses quantity_invoiced; purchase_history_items uses quantity.
    const invoicedQty = Number(item.quantity_invoiced ?? item.quantity) || 0;
    const invoicedCost = item.unit_cost != null ? Number(item.unit_cost) : null;
    const invoicedTotal = resolveLineTotal(item.total_cost, invoicedQty, invoicedCost);

    if (!catalogId) {
      return {
        ...buildLineKeysForItem(invoice, item, smartOrderRunId, doc),
        catalog_item_id: null,
        item_name: item.item_name,
        purchase_order_item_id: null,
        po_qty: null,
        po_unit_cost: null,
        po_total_cost: null,
        invoiced_qty: invoicedQty,
        invoiced_unit_cost: invoicedCost,
        invoiced_total_cost: invoicedTotal,
        // Auto-filled from invoiced qty — NOT manager-confirmed
        received_qty: invoicedQty,
        received_qty_confirmed: false,
        status: "unmatched",
      };
    }

    const purchaseOrderItem = poByCatalogId[catalogId];
    if (purchaseOrderItem) matchedPoCatalogIds.add(catalogId);

    const poQty = purchaseOrderItem ? resolvePoOrderedQty(purchaseOrderItem) : null;
    const poCost =
      purchaseOrderItem?.unit_cost != null ? Number(purchaseOrderItem.unit_cost) : null;
    const poTotal = resolveLineTotal(null, poQty, poCost);

    const status = !purchaseOrderItem
      ? "extra_on_invoice"
      : deriveInvoiceComparisonStatus({
          po_qty: poQty,
          invoiced_qty: invoicedQty,
          received_qty: invoicedQty,
          po_unit_cost: poCost,
          invoiced_unit_cost: invoicedCost,
          po_total_cost: poTotal,
          invoiced_total_cost: invoicedTotal,
        });

    return {
      ...buildLineKeysForItem(invoice, item, smartOrderRunId, doc),
      purchase_order_item_id: doc === "invoice" && purchaseOrderItem ? purchaseOrderItem.id : null,
      catalog_item_id: catalogId,
      item_name: item.item_name,
      po_qty: poQty,
      po_unit_cost: poCost,
      po_total_cost: poTotal,
      invoiced_qty: invoicedQty,
      invoiced_unit_cost: invoicedCost,
      invoiced_total_cost: invoicedTotal,
      // Auto-filled from invoiced qty — NOT manager-confirmed
      received_qty: invoicedQty,
      received_qty_confirmed: false,
      status,
    };
  });

  // Track catalog IDs already emitted as missing_from_invoice to prevent duplicates
  // when two PO lines share the same catalog_item_id (Phase 4 dedup fix).
  const emittedMissingCatalogIds = new Set<string>();

  poItemsList.forEach((purchaseOrderItem) => {
    if (resolvePoOrderedQty(purchaseOrderItem) <= 0) return;

    const catalogId = purchaseOrderItem.catalog_item_id || null;
    if (catalogId && matchedPoCatalogIds.has(catalogId)) return;
    if (catalogId && emittedMissingCatalogIds.has(catalogId)) return;

    // Use the deduplicated lookup entry (which may have summed quantities) when available.
    const resolvedItem =
      catalogId && poByCatalogId[catalogId] ? poByCatalogId[catalogId] : purchaseOrderItem;
    const poQty = resolvePoOrderedQty(resolvedItem);
    const poCostRaw = resolvedItem.unit_cost != null ? Number(resolvedItem.unit_cost) : null;

    if (catalogId) emittedMissingCatalogIds.add(catalogId);

    rows.push({
      ...buildSyntheticLineKeys(invoice, smartOrderRunId, doc),
      purchase_order_item_id: doc === "invoice" ? purchaseOrderItem.id : null,
      catalog_item_id: catalogId,
      item_name: purchaseOrderItem.item_name,
      po_qty: poQty,
      po_unit_cost: poCostRaw,
      po_total_cost: resolveLineTotal(null, poQty, poCostRaw),
      invoiced_qty: 0,
      invoiced_unit_cost: 0,
      invoiced_total_cost: 0,
      received_qty: 0,
      // Synthetic PO-only row — not an invoice line, no received qty to confirm
      received_qty_confirmed: true,
      status: "missing_from_invoice",
    });
  });

  return rows;
}
