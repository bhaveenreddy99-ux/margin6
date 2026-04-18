import type { Database } from "@/integrations/supabase/types";
import { deriveInvoiceComparisonStatus } from "@/lib/invoice-comparison";
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

function resolveComparisonLineTotal(
  explicitTotal: unknown,
  quantity: unknown,
  unitCost: unknown,
): number | null {
  const total = Number(explicitTotal);
  if (explicitTotal != null && Number.isFinite(total)) return total;

  const qty = Number(quantity);
  const cost = Number(unitCost);
  if (!Number.isFinite(qty) || !Number.isFinite(cost)) return null;

  return qty * cost;
}

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

function buildPoLookup(
  poItemsList: InvoiceReviewPoItem[],
): Record<string, ResolvedPoItem> {
  const poByCatalogId: Record<string, ResolvedPoItem> = {};

  poItemsList
    .map((purchaseOrderItem) => ({
      ...purchaseOrderItem,
      resolved_catalog_id: purchaseOrderItem.catalog_item_id || null,
    }))
    .forEach((purchaseOrderItem) => {
      if (purchaseOrderItem.resolved_catalog_id) {
        poByCatalogId[purchaseOrderItem.resolved_catalog_id] = purchaseOrderItem;
      }
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
    const invoicedQty = Number(item.quantity) || 0;
    const invoicedCost = item.unit_cost != null ? Number(item.unit_cost) : null;
    const invoicedTotal = resolveComparisonLineTotal(item.total_cost, invoicedQty, invoicedCost);

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
        received_qty: invoicedQty,
        status: "unmatched",
      };
    }

    const purchaseOrderItem = poByCatalogId[catalogId];
    if (purchaseOrderItem) matchedPoCatalogIds.add(catalogId);

    const poQty = purchaseOrderItem ? resolvePoOrderedQty(purchaseOrderItem) : null;
    const poCost =
      purchaseOrderItem?.unit_cost != null ? Number(purchaseOrderItem.unit_cost) : null;
    const poTotal = resolveComparisonLineTotal(null, poQty, poCost);

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
      received_qty: invoicedQty,
      status,
    };
  });

  poItemsList.forEach((purchaseOrderItem) => {
    if (resolvePoOrderedQty(purchaseOrderItem) <= 0) return;

    const catalogId = purchaseOrderItem.catalog_item_id || null;
    if (catalogId && matchedPoCatalogIds.has(catalogId)) return;

    const poQty = resolvePoOrderedQty(purchaseOrderItem);
    rows.push({
      ...buildSyntheticLineKeys(invoice, smartOrderRunId, doc),
      purchase_order_item_id: doc === "invoice" ? purchaseOrderItem.id : null,
      catalog_item_id: catalogId,
      item_name: purchaseOrderItem.item_name,
      po_qty: poQty,
      po_unit_cost:
        purchaseOrderItem.unit_cost != null ? Number(purchaseOrderItem.unit_cost) : null,
      po_total_cost: resolveComparisonLineTotal(
        null,
        poQty,
        purchaseOrderItem.unit_cost != null ? Number(purchaseOrderItem.unit_cost) : null,
      ),
      invoiced_qty: 0,
      invoiced_unit_cost: 0,
      invoiced_total_cost: 0,
      received_qty: 0,
      status: "missing_from_invoice",
    });
  });

  return rows;
}
