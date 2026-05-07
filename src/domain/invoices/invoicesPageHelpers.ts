import type { InvoiceHeader, InvoiceItem, LinkedSmartOrderLine } from "@/components/invoices/types";
import type {
  InvoiceCatalogItem,
  InvoiceIngestionInsert,
  InvoiceInsert,
  InvoiceItemInsert,
  InvoiceItemRow,
  InvoiceListQueryRow,
  InvoiceListRow,
  InvoiceSaveIntent,
  InvoiceUpdate,
  ParseInvoiceRawItem,
  ParseInvoiceResult,
  PurchaseOrderCandidateRow,
  PurchaseOrderCatalogLinkRow,
  PurchaseOrderItemRow,
} from "@/domain/invoices/invoicesPageTypes";

export function parseInvoicePayloadError(data: unknown): string | null {
  if (!data || typeof data !== "object") return null;
  const record = data as Record<string, unknown>;
  if (typeof record.error === "string" && record.error.trim()) return record.error;
  return null;
}

export function buildInvoicePatchFromParse(result: ParseInvoiceResult): InvoiceUpdate {
  const patch: InvoiceUpdate = { updated_at: new Date().toISOString() };
  if (result.vendor_name !== undefined) {
    patch.vendor_name = String(result.vendor_name).trim() || null;
  }
  if (result.invoice_number !== undefined) {
    patch.invoice_number = String(result.invoice_number).trim() || null;
  }
  if (result.invoice_date !== undefined) {
    patch.invoice_date = String(result.invoice_date).trim() || null;
  }
  if (result.subtotal !== undefined) {
    const numeric = Number(result.subtotal);
    patch.invoice_subtotal = Number.isFinite(numeric) ? numeric : null;
  }
  if (result.tax !== undefined) {
    const numeric = Number(result.tax);
    patch.invoice_tax = Number.isFinite(numeric) ? numeric : null;
  }
  if (result.total !== undefined) {
    const numeric = Number(result.total);
    patch.invoice_total = Number.isFinite(numeric) ? numeric : null;
  }
  return patch;
}

export function parseInvoiceItemsToInsertRows(
  invoiceId: string,
  rawItems: ParseInvoiceRawItem[],
): InvoiceItemInsert[] {
  const rows: InvoiceItemInsert[] = [];
  for (const raw of rawItems) {
    if (!raw || typeof raw !== "object") continue;
    const itemName = String(raw.item_name ?? "").trim();
    if (!itemName) continue;
    const quantity = Number(raw.quantity);
    const unitCost = raw.unit_cost != null ? Number(raw.unit_cost) : null;
    const lineTotal = raw.line_total != null ? Number(raw.line_total) : null;
    const totalCost =
      lineTotal != null && Number.isFinite(lineTotal)
        ? lineTotal
        : unitCost != null && Number.isFinite(unitCost) && Number.isFinite(quantity)
          ? unitCost * quantity
          : null;

    rows.push({
      invoice_id: invoiceId,
      item_name: itemName,
      product_number:
        raw.product_number != null && String(raw.product_number).trim() !== ""
          ? String(raw.product_number).trim()
          : null,
      quantity_invoiced: Number.isFinite(quantity) ? quantity : 0,
      unit_cost: unitCost != null && Number.isFinite(unitCost) ? unitCost : null,
      total_cost: totalCost,
      pack_size:
        raw.pack_size != null && String(raw.pack_size).trim() !== ""
          ? String(raw.pack_size)
          : null,
      brand_name:
        raw.brand_name != null && String(raw.brand_name).trim() !== ""
          ? String(raw.brand_name)
          : null,
      unit:
        raw.unit != null && String(raw.unit).trim() !== ""
          ? String(raw.unit)
          : null,
      match_status: "UNMATCHED",
      catalog_item_id: null,
    });
  }
  return rows;
}

export function sanitizeStorageFilename(name: string): string {
  return name.replace(/[^\w.\-]+/g, "_").replace(/^\.+/, "").slice(0, 200) || "upload";
}

export function vendorNamesMatchForPoLink(
  poVendor: string | null | undefined,
  invoiceVendor: string,
): boolean {
  const invoice = invoiceVendor.trim().toLowerCase();
  if (!invoice) return false;
  const purchaseOrder = String(poVendor ?? "").trim().toLowerCase();
  if (!purchaseOrder) return false;
  if (purchaseOrder === invoice) return true;
  const shorter = purchaseOrder.length <= invoice.length ? purchaseOrder : invoice;
  const longer = purchaseOrder.length > invoice.length ? purchaseOrder : invoice;
  if (shorter.length < 3) return false;
  return longer.includes(shorter);
}

export function flattenInvoiceListRows(rows: InvoiceListQueryRow[]): InvoiceListRow[] {
  return rows.map((row) => ({
    ...row,
    po_number: row.purchase_orders?.po_number ?? row.po_number ?? null,
    smart_order_run_id: row.purchase_orders?.smart_order_run_id ?? null,
  }));
}

export function buildLinkedPurchaseOrderLines(
  purchaseOrderItems: PurchaseOrderItemRow[],
): LinkedSmartOrderLine[] {
  return purchaseOrderItems.map((purchaseOrderItem) => ({
    ...purchaseOrderItem,
    suggested_order: purchaseOrderItem.quantity_ordered ?? null,
  }));
}

export function buildInvoiceHeaderFromRow(invoice: InvoiceListRow): InvoiceHeader {
  const runId = invoice.smart_order_run_id || invoice.purchase_orders?.smart_order_run_id || "";
  return {
    vendor_name: invoice.vendor_name || "",
    invoice_number: invoice.invoice_number || "",
    invoice_date: invoice.invoice_date || new Date().toISOString().split("T")[0],
    po_number: typeof invoice.po_number === "string" ? invoice.po_number : "",
    location_id: invoice.location_id || "",
    linked_smart_order_id: runId,
  };
}

export function buildInvoiceEditorItems(
  rows: InvoiceItemRow[],
  catalogItems: InvoiceCatalogItem[],
): InvoiceItem[] {
  return rows.map((row) => ({
    product_number:
      row.product_number != null && String(row.product_number).trim() !== ""
        ? String(row.product_number).trim()
        : null,
    item_name: row.item_name,
    quantity: Number(row.quantity_invoiced),
    unit_cost: row.unit_cost != null ? Number(row.unit_cost) : null,
    line_total: row.total_cost != null ? Number(row.total_cost) : null,
    unit: row.unit ?? null,
    pack_size: row.pack_size,
    brand_name: row.brand_name ?? null,
    catalog_item_id: row.catalog_item_id,
    match_status: row.match_status === "MATCHED" || row.match_status === "MANUAL"
      ? row.match_status
      : "UNMATCHED",
    catalog_match_name: row.catalog_item_id
      ? catalogItems.find((catalogItem) => catalogItem.id === row.catalog_item_id)?.item_name
      : undefined,
  }));
}

export function resolveInvoiceWorkflowState(intent: InvoiceSaveIntent) {
  return {
    workflowStatus: intent === "RECEIVED" ? "review" : "draft",
    receiptStatus: intent === "RECEIVED" ? "reviewing" : "pending",
  } as const;
}

export function buildInvoiceInsertPayload(args: {
  restaurantId: string;
  userId: string;
  header: InvoiceHeader;
  purchaseOrderId: string | null;
  intent: InvoiceSaveIntent;
}): InvoiceInsert {
  const workflow = resolveInvoiceWorkflowState(args.intent);
  return {
    restaurant_id: args.restaurantId,
    vendor_name: args.header.vendor_name.trim(),
    invoice_number: args.header.invoice_number.trim() || null,
    invoice_date: args.header.invoice_date || null,
    location_id: args.header.location_id || null,
    purchase_order_id: args.purchaseOrderId,
    created_by: args.userId,
    status: workflow.workflowStatus,
    receipt_status: workflow.receiptStatus,
    updated_at: new Date().toISOString(),
  };
}

export function buildInvoiceItemInsertRows(args: {
  invoiceId: string;
  items: InvoiceItem[];
  catalogItems: InvoiceCatalogItem[];
}): InvoiceItemInsert[] {
  return args.items.map((item) => {
    const catalogItem = item.catalog_item_id
      ? args.catalogItems.find((catalogRow) => catalogRow.id === item.catalog_item_id)
      : null;
    const brandName = item.brand_name ?? catalogItem?.brand_name ?? null;

    return {
      invoice_id: args.invoiceId,
      item_name: item.item_name,
      product_number: item.product_number?.trim() || null,
      quantity: item.quantity,
      unit_cost: item.unit_cost,
      total_cost: item.line_total ?? (item.unit_cost ? item.unit_cost * item.quantity : null),
      pack_size: item.pack_size,
      catalog_item_id: item.catalog_item_id,
      match_status: item.match_status,
      brand_name: brandName,
    };
  });
}

export function buildInvoiceIngestionRow(args: {
  restaurantId: string;
  invoiceId: string;
  storagePath: string;
  sourceKind: "file" | "photo";
  mimeType: string | null;
  originalFilename: string;
  userId: string;
}): InvoiceIngestionInsert {
  return {
    restaurant_id: args.restaurantId,
    invoice_id: args.invoiceId,
    storage_path: args.storagePath,
    source_kind: args.sourceKind,
    mime_type: args.mimeType,
    original_filename: args.originalFilename,
    created_by: args.userId,
  };
}

export function scorePurchaseOrderCandidates(
  candidates: PurchaseOrderCandidateRow[],
  invoiceCatalogIds: Set<string>,
  purchaseOrderItems: PurchaseOrderCatalogLinkRow[],
) {
  const purchaseOrderCatalogIds = new Map<string, Set<string>>();
  for (const row of purchaseOrderItems) {
    const purchaseOrderId = row.purchase_order_id;
    const catalogId = row.catalog_item_id;
    if (catalogId == null || String(catalogId).trim() === "") continue;
    if (!purchaseOrderCatalogIds.has(purchaseOrderId)) {
      purchaseOrderCatalogIds.set(purchaseOrderId, new Set());
    }
    purchaseOrderCatalogIds.get(purchaseOrderId)?.add(catalogId);
  }

  const overlapCount = (purchaseOrderId: string): number => {
    const purchaseOrderSet = purchaseOrderCatalogIds.get(purchaseOrderId);
    if (!purchaseOrderSet || invoiceCatalogIds.size === 0) return 0;
    let count = 0;
    for (const catalogId of invoiceCatalogIds) {
      if (purchaseOrderSet.has(catalogId)) count += 1;
    }
    return count;
  };

  return candidates
    .map((candidate) => ({
      id: candidate.id,
      po_number: candidate.po_number,
      overlap: overlapCount(candidate.id),
    }))
    .sort((a, b) => b.overlap - a.overlap);
}

export function normalizeSpreadsheetRows(
  rows: Record<string, unknown>[],
): ParseInvoiceRawItem[] {
  if (rows.length === 0) return [];

  const headers = Object.keys(rows[0]).map((header) => header.toLowerCase());
  const originalHeaders = Object.keys(rows[0]);
  const findColumn = (keys: string[]) => {
    for (const key of keys) {
      const index = headers.findIndex((header) => header.includes(key));
      if (index >= 0) return originalHeaders[index];
    }
    return null;
  };

  const nameColumn = findColumn(["item", "description", "product name", "desc"]);
  const quantityColumn = findColumn(["qty", "quantity", "shipped", "ship"]);
  const priceColumn = findColumn(["price", "unit cost", "cost", "unit price"]);
  const totalColumn = findColumn(["total", "extended", "amount", "ext"]);
  const skuColumn = findColumn(["product number", "sku", "item number", "item #", "product #", "prod"]);
  const unitColumn = findColumn(["unit", "uom", "measure"]);
  const packColumn = findColumn(["pack", "size", "pack size"]);
  const brandColumn = findColumn(["brand", "manufacturer", "mfg", "brand name"]);

  return rows
    .map((row) => ({
      product_number: skuColumn ? String(row[skuColumn] || "") : null,
      item_name: nameColumn ? String(row[nameColumn] || "") : "",
      quantity: quantityColumn ? Number(row[quantityColumn]) || 0 : 0,
      unit_cost: priceColumn ? Number(String(row[priceColumn]).replace(/[$,]/g, "")) || null : null,
      line_total: totalColumn ? Number(String(row[totalColumn]).replace(/[$,]/g, "")) || null : null,
      unit: unitColumn ? String(row[unitColumn] || "") : null,
      pack_size: packColumn ? String(row[packColumn] || "") : null,
      brand_name: brandColumn ? String(row[brandColumn] || "") : null,
    }))
    .filter((row) => row.item_name);
}
