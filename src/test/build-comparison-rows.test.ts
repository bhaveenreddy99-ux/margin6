import { describe, expect, it } from "vitest";
import { buildComparisonRows } from "@/domain/invoices/buildComparisonRows";
import type {
  InvoiceReviewCatalogItem,
  InvoiceReviewDocument,
  InvoiceReviewLineItem,
  InvoiceReviewPoItem,
  InvoiceReviewVendorMapping,
} from "@/domain/invoices/invoiceReviewTypes";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeDoc(overrides: Partial<InvoiceReviewDocument> = {}): InvoiceReviewDocument {
  return {
    id: "invoice-1",
    purchase_orders: { smart_order_run_id: "run-1" },
    ...overrides,
  };
}

function makeLineItem(overrides: Partial<InvoiceReviewLineItem> = {}): InvoiceReviewLineItem {
  return {
    id: "line-1",
    item_name: "Tomatoes",
    catalog_item_id: "cat-1",
    quantity: 10,
    unit_cost: 5,
    total_cost: 50,
    ...overrides,
  };
}

function makePoItem(overrides: Partial<InvoiceReviewPoItem> = {}): InvoiceReviewPoItem {
  return {
    id: "po-item-1",
    item_name: "Tomatoes",
    catalog_item_id: "cat-1",
    quantity_ordered: 10,
    unit_cost: 5,
    ...overrides,
  };
}

function makeCatalogItem(overrides: Partial<InvoiceReviewCatalogItem> = {}): InvoiceReviewCatalogItem {
  return {
    id: "cat-1",
    item_name: "Tomatoes",
    vendor_sku: null,
    product_number: null,
    ...overrides,
  };
}

const NO_MAPPINGS: InvoiceReviewVendorMapping[] = [];

// ---------------------------------------------------------------------------
// Matched line: catalog + PO item both present
// ---------------------------------------------------------------------------

describe("buildComparisonRows — matched invoice line", () => {
  it("produces status ok when qty and cost match PO exactly", () => {
    const rows = buildComparisonRows(
      makeDoc(),
      [makeLineItem()],
      [makePoItem()],
      NO_MAPPINGS,
      [makeCatalogItem()],
      "invoice",
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("ok");
    expect(rows[0].catalog_item_id).toBe("cat-1");
    expect(rows[0].invoiced_qty).toBe(10);
    expect(rows[0].po_qty).toBe(10);
  });

  it("produces qty_mismatch when invoiced qty differs meaningfully from PO qty", () => {
    const rows = buildComparisonRows(
      makeDoc(),
      [makeLineItem({ quantity: 7 })],
      [makePoItem({ quantity_ordered: 10 })],
      NO_MAPPINGS,
      [makeCatalogItem()],
      "invoice",
    );
    expect(rows[0].status).toBe("qty_mismatch");
  });

  it("produces price_mismatch when invoiced cost differs meaningfully from PO cost", () => {
    const rows = buildComparisonRows(
      makeDoc(),
      [makeLineItem({ unit_cost: 8 })],
      [makePoItem({ unit_cost: 5 })],
      NO_MAPPINGS,
      [makeCatalogItem()],
      "invoice",
    );
    expect(rows[0].status).toBe("price_mismatch");
  });

  it("sets purchase_order_item_id on matched invoice-kind row", () => {
    const rows = buildComparisonRows(
      makeDoc(),
      [makeLineItem()],
      [makePoItem({ id: "po-item-abc" })],
      NO_MAPPINGS,
      [makeCatalogItem()],
      "invoice",
    );
    expect(rows[0].purchase_order_item_id).toBe("po-item-abc");
  });

  it("does NOT set purchase_order_item_id for purchase_history doc kind", () => {
    const rows = buildComparisonRows(
      makeDoc(),
      [makeLineItem()],
      [makePoItem()],
      NO_MAPPINGS,
      [makeCatalogItem()],
      "purchase_history",
    );
    expect(rows[0].purchase_order_item_id).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Unmatched line: no catalog match
// ---------------------------------------------------------------------------

describe("buildComparisonRows — unmatched invoice line (no catalog ID)", () => {
  it("produces status unmatched with null catalog_item_id", () => {
    const rows = buildComparisonRows(
      makeDoc(),
      [makeLineItem({ catalog_item_id: null, vendor_sku: null, product_number: null })],
      [],
      NO_MAPPINGS,
      [],
      "invoice",
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("unmatched");
    expect(rows[0].catalog_item_id).toBeNull();
  });

  it("sets received_qty equal to invoiced_qty for unmatched lines", () => {
    const rows = buildComparisonRows(
      makeDoc(),
      [makeLineItem({ catalog_item_id: null, quantity: 7 })],
      [],
      NO_MAPPINGS,
      [],
      "invoice",
    );
    expect(rows[0].invoiced_qty).toBe(7);
    expect(rows[0].received_qty).toBe(7);
  });
});

// ---------------------------------------------------------------------------
// Extra on invoice: catalog match but not in PO
// ---------------------------------------------------------------------------

describe("buildComparisonRows — extra on invoice (catalog match, no PO item)", () => {
  it("produces status extra_on_invoice", () => {
    const rows = buildComparisonRows(
      makeDoc(),
      [makeLineItem()],   // catalog_item_id: "cat-1"
      [],                 // empty PO list
      NO_MAPPINGS,
      [makeCatalogItem()],
      "invoice",
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("extra_on_invoice");
    expect(rows[0].po_qty).toBeNull();
    expect(rows[0].po_unit_cost).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Missing from invoice: PO item not matched by any invoice line
// ---------------------------------------------------------------------------

describe("buildComparisonRows — missing from invoice (PO item not invoiced)", () => {
  it("appends missing_from_invoice row for unmatched PO item", () => {
    const rows = buildComparisonRows(
      makeDoc(),
      [],             // no invoice lines
      [makePoItem()], // PO item present
      NO_MAPPINGS,
      [makeCatalogItem()],
      "invoice",
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("missing_from_invoice");
    expect(rows[0].invoiced_qty).toBe(0);
    expect(rows[0].po_qty).toBe(10);
  });

  it("skips PO items with zero or negative ordered quantity", () => {
    const rows = buildComparisonRows(
      makeDoc(),
      [],
      [makePoItem({ quantity_ordered: 0 })],
      NO_MAPPINGS,
      [makeCatalogItem()],
      "invoice",
    );
    expect(rows).toHaveLength(0);
  });

  it("does NOT duplicate: PO item matched by invoice line is not also appended as missing", () => {
    const rows = buildComparisonRows(
      makeDoc(),
      [makeLineItem()],   // matches cat-1
      [makePoItem()],     // same cat-1
      NO_MAPPINGS,
      [makeCatalogItem()],
      "invoice",
    );
    // Should only be 1 row (the invoice line), not 2
    expect(rows).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Document key routing (invoice vs purchase_history)
// ---------------------------------------------------------------------------

describe("buildComparisonRows — doc kind routing", () => {
  it("sets invoice_id on invoice kind rows", () => {
    const rows = buildComparisonRows(makeDoc(), [makeLineItem()], [], NO_MAPPINGS, [makeCatalogItem()], "invoice");
    expect(rows[0].invoice_id).toBe("invoice-1");
    expect(rows[0].purchase_history_id).toBeNull();
  });

  it("sets purchase_history_id on purchase_history kind rows", () => {
    const rows = buildComparisonRows(
      makeDoc(),
      [makeLineItem()],
      [],
      NO_MAPPINGS,
      [makeCatalogItem()],
      "purchase_history",
    );
    expect(rows[0].purchase_history_id).toBe("invoice-1");
    expect(rows[0].invoice_id).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Smart order run ID propagation
// ---------------------------------------------------------------------------

describe("buildComparisonRows — smart_order_run_id propagation", () => {
  it("reads smart_order_run_id from purchase_orders for invoice kind", () => {
    const doc = makeDoc({ purchase_orders: { smart_order_run_id: "run-abc" } });
    const rows = buildComparisonRows(doc, [makeLineItem()], [], NO_MAPPINGS, [makeCatalogItem()], "invoice");
    expect(rows[0].smart_order_run_id).toBe("run-abc");
  });

  it("reads smart_order_run_id directly from document for purchase_history kind", () => {
    const doc: InvoiceReviewDocument = { id: "ph-1", smart_order_run_id: "run-xyz" } as InvoiceReviewDocument;
    const rows = buildComparisonRows(doc, [makeLineItem()], [], NO_MAPPINGS, [makeCatalogItem()], "purchase_history");
    expect(rows[0].smart_order_run_id).toBe("run-xyz");
  });

  it("sets null smart_order_run_id when no run is linked", () => {
    const doc = makeDoc({ purchase_orders: null });
    const rows = buildComparisonRows(doc, [makeLineItem()], [], NO_MAPPINGS, [makeCatalogItem()], "invoice");
    expect(rows[0].smart_order_run_id).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Mixed scenario: some matched, some missing, some extra
// ---------------------------------------------------------------------------

describe("buildComparisonRows — mixed scenario", () => {
  it("correctly categorizes all three row types in one pass", () => {
    const invoice = makeDoc();
    const catalogItems = [
      makeCatalogItem({ id: "cat-1", item_name: "Tomatoes" }),
      makeCatalogItem({ id: "cat-2", item_name: "Lettuce" }),
    ];
    const lineItems = [
      makeLineItem({ id: "l1", item_name: "Tomatoes", catalog_item_id: "cat-1", quantity: 10 }),
      makeLineItem({ id: "l2", item_name: "Basil", catalog_item_id: null }),   // unmatched
    ];
    const poItems = [
      makePoItem({ id: "p1", catalog_item_id: "cat-1", quantity_ordered: 10 }),
      makePoItem({ id: "p2", catalog_item_id: "cat-2", quantity_ordered: 5, item_name: "Lettuce" }),
    ];

    const rows = buildComparisonRows(invoice, lineItems, poItems, NO_MAPPINGS, catalogItems, "invoice");

    const statuses = rows.map((r) => r.status);
    expect(statuses).toContain("ok");                   // Tomatoes matched
    expect(statuses).toContain("unmatched");            // Basil has no catalog match
    expect(statuses).toContain("missing_from_invoice"); // Lettuce on PO but not invoiced
    expect(rows).toHaveLength(3);
  });
});
