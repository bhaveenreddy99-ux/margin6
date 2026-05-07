/**
 * Phase 4: Trusted Receiving tests
 *
 * Covers:
 *  - normalizeReceivedQuantityToCases (CS passthrough, LB/EA conversion, failures)
 *  - computeThreeWayVariance
 *  - validateReceivingBeforeConfirm (blocks missing, blocks unconfirmed, passes when all ok)
 *  - buildComparisonRows: received_qty_confirmed seeding
 *  - buildPoLookup: duplicate catalog_item_id no longer silently overwrites
 */

import { describe, expect, it } from "vitest";
import {
  normalizeReceivedQuantityToCases,
  computeThreeWayVariance,
  validateReceivingBeforeConfirm,
} from "@/domain/invoices/receivingEngine";
import { buildComparisonRows } from "@/domain/invoices/buildComparisonRows";
import { countUnconfirmedReceivedQty } from "@/domain/invoices/invoiceReviewSelectors";
import type {
  InvoiceReviewCatalogItem,
  InvoiceReviewComparison,
  InvoiceReviewDocument,
  InvoiceReviewLineItem,
  InvoiceReviewPoItem,
  InvoiceReviewVendorMapping,
} from "@/domain/invoices/invoiceReviewTypes";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeDoc(overrides: Partial<InvoiceReviewDocument> = {}): InvoiceReviewDocument {
  return { id: "invoice-1", purchase_orders: { smart_order_run_id: "run-1" }, ...overrides };
}

function makeLineItem(overrides: Partial<InvoiceReviewLineItem> = {}): InvoiceReviewLineItem {
  return {
    id: "line-1", item_name: "Tomatoes", catalog_item_id: "cat-1",
    quantity: 10, unit_cost: 5, total_cost: 50, ...overrides,
  };
}

function makePoItem(overrides: Partial<InvoiceReviewPoItem> = {}): InvoiceReviewPoItem {
  return {
    id: "po-item-1", item_name: "Tomatoes", catalog_item_id: "cat-1",
    quantity_ordered: 10, unit_cost: 5, ...overrides,
  };
}

function makeCatalogItem(overrides: Partial<InvoiceReviewCatalogItem> = {}): InvoiceReviewCatalogItem {
  return { id: "cat-1", item_name: "Tomatoes", vendor_sku: null, product_number: null, ...overrides };
}

const NO_MAPPINGS: InvoiceReviewVendorMapping[] = [];

// Minimal comparison row for selector/validator tests
function makeComparison(overrides: Partial<InvoiceReviewComparison> = {}): InvoiceReviewComparison {
  return {
    id: "comp-1",
    invoice_id: "invoice-1",
    invoice_item_id: "line-1",
    purchase_history_id: null,
    purchase_history_item_id: null,
    smart_order_run_id: null,
    purchase_order_item_id: null,
    catalog_item_id: "cat-1",
    item_name: "Tomatoes",
    po_qty: 10,
    po_unit_cost: 5,
    po_total_cost: 50,
    invoiced_qty: 10,
    invoiced_unit_cost: 5,
    invoiced_total_cost: 50,
    received_qty: 10,
    received_qty_confirmed: false,
    status: "ok",
    cost_diff: null,
    qty_diff: null,
    total_diff: null,
    created_at: null,
    ...overrides,
  } as InvoiceReviewComparison;
}

// ─── normalizeReceivedQuantityToCases ─────────────────────────────────────────

describe("normalizeReceivedQuantityToCases", () => {
  it("CS unit: 10 CS → 10 cases (passthrough)", () => {
    const result = normalizeReceivedQuantityToCases({
      receivedQty: 10,
      receivedUnit: "CS",
      packSize: "6/4 LB",
    });
    expect(result.ok).toBe(true);
    expect(result.quantityCases).toBe(10);
    expect(result.conversionStatus).toBe("passthrough_case");
  });

  it("null unit: treats as case passthrough", () => {
    const result = normalizeReceivedQuantityToCases({
      receivedQty: 5,
      receivedUnit: null,
      packSize: null,
    });
    expect(result.ok).toBe(true);
    expect(result.quantityCases).toBe(5);
    expect(result.conversionStatus).toBe("passthrough_case");
  });

  it("CASE alias: 3 CASE → 3 cases", () => {
    const result = normalizeReceivedQuantityToCases({
      receivedQty: 3,
      receivedUnit: "CASE",
      packSize: null,
    });
    expect(result.ok).toBe(true);
    expect(result.quantityCases).toBe(3);
  });

  it("LB unit with 6/4 LB pack: 24 LB → 1 case (24 / (6×4))", () => {
    const result = normalizeReceivedQuantityToCases({
      receivedQty: 24,
      receivedUnit: "LB",
      packSize: "6/4 LB",
    });
    expect(result.ok).toBe(true);
    // 6 units × 4 lb each = 24 lb/case → 24 lb / 24 = 1 case
    expect(result.quantityCases).toBeCloseTo(1, 4);
    expect(result.conversionStatus).toBe("converted_to_case");
    expect(result.sourceQuantity).toBe(24);
    expect(result.sourceUnit).toBe("LB");
  });

  it("LB unit with 2/10 LB pack: 5 LB → 0.25 cases (5 / (2×10))", () => {
    const result = normalizeReceivedQuantityToCases({
      receivedQty: 5,
      receivedUnit: "LB",
      packSize: "2/10 LB",
    });
    expect(result.ok).toBe(true);
    // 2 × 10 = 20 lb/case → 5 / 20 = 0.25
    expect(result.quantityCases).toBeCloseTo(0.25, 4);
  });

  it("LB unit with no pack_size: conversion fails", () => {
    const result = normalizeReceivedQuantityToCases({
      receivedQty: 24,
      receivedUnit: "LB",
      packSize: null,
    });
    expect(result.ok).toBe(false);
    expect(result.conversionStatus).toBe("conversion_failed");
    expect(result.quantityCases).toBe(0);
  });

  it("EA unit with 24/1 EA pack: 24 EA → 1 case (24 / 24)", () => {
    const result = normalizeReceivedQuantityToCases({
      receivedQty: 24,
      receivedUnit: "EA",
      packSize: "24/1 EA",
    });
    expect(result.ok).toBe(true);
    expect(result.quantityCases).toBeCloseTo(1, 4);
    expect(result.conversionStatus).toBe("converted_to_case");
  });

  it("EA unit with 12 EA pack: 6 EA → 0.5 cases", () => {
    const result = normalizeReceivedQuantityToCases({
      receivedQty: 6,
      receivedUnit: "EA",
      packSize: "12/1 EA",
    });
    expect(result.ok).toBe(true);
    expect(result.quantityCases).toBeCloseTo(0.5, 4);
  });

  it("EA unit with no pack_size: conversion fails", () => {
    const result = normalizeReceivedQuantityToCases({
      receivedQty: 24,
      receivedUnit: "EA",
      packSize: null,
    });
    expect(result.ok).toBe(false);
    expect(result.conversionStatus).toBe("conversion_failed");
  });

  it("unknown unit: conversion fails with clear reason", () => {
    const result = normalizeReceivedQuantityToCases({
      receivedQty: 10,
      receivedUnit: "BARREL",
      packSize: "6/4 LB",
    });
    expect(result.ok).toBe(false);
    expect(result.conversionStatus).toBe("conversion_failed");
    expect(result.reason).toContain("BARREL");
  });

  it("returns sourceQuantity and sourceUnit for audit trail", () => {
    const result = normalizeReceivedQuantityToCases({
      receivedQty: 48,
      receivedUnit: "LB",
      packSize: "6/4 LB",
    });
    expect(result.sourceQuantity).toBe(48);
    expect(result.sourceUnit).toBe("LB");
  });
});

// ─── computeThreeWayVariance ──────────────────────────────────────────────────

describe("computeThreeWayVariance", () => {
  it("all match → ok=true, all flags false", () => {
    const result = computeThreeWayVariance({
      orderedQty: 10, invoicedQty: 10, receivedQty: 10,
      orderedUnitCost: 5, invoicedUnitCost: 5,
    });
    expect(result.ok).toBe(true);
    expect(result.orderedVsInvoiceQtyMismatch).toBe(false);
    expect(result.invoiceVsReceivedQtyMismatch).toBe(false);
    expect(result.priceMismatch).toBe(false);
  });

  it("ordered vs invoiced qty differ significantly → orderedVsInvoiceQtyMismatch=true", () => {
    const result = computeThreeWayVariance({
      orderedQty: 10, invoicedQty: 7, receivedQty: 7,
      orderedUnitCost: 5, invoicedUnitCost: 5,
    });
    expect(result.orderedVsInvoiceQtyMismatch).toBe(true);
    expect(result.ok).toBe(false);
  });

  it("invoice vs received qty differ significantly → invoiceVsReceivedQtyMismatch=true", () => {
    const result = computeThreeWayVariance({
      orderedQty: 10, invoicedQty: 10, receivedQty: 7,
      orderedUnitCost: 5, invoicedUnitCost: 5,
    });
    expect(result.invoiceVsReceivedQtyMismatch).toBe(true);
    expect(result.ok).toBe(false);
  });

  it("price differs significantly → priceMismatch=true", () => {
    const result = computeThreeWayVariance({
      orderedQty: 10, invoicedQty: 10, receivedQty: 10,
      orderedUnitCost: 5, invoicedUnitCost: 7,
    });
    expect(result.priceMismatch).toBe(true);
    expect(result.ok).toBe(false);
  });

  it("null values are handled gracefully (no crash, no false positives)", () => {
    const result = computeThreeWayVariance({
      orderedQty: null, invoicedQty: 10, receivedQty: 10,
      orderedUnitCost: null, invoicedUnitCost: 5,
    });
    // No PO to compare against → mismatch flags don't fire for null
    expect(result.orderedVsInvoiceQtyMismatch).toBe(false);
    expect(result.priceMismatch).toBe(false);
  });
});

// ─── validateReceivingBeforeConfirm ──────────────────────────────────────────

describe("validateReceivingBeforeConfirm", () => {
  it("valid when all real invoice lines have received_qty_confirmed=true", () => {
    const result = validateReceivingBeforeConfirm({
      comparisons: [
        makeComparison({ received_qty: 10, received_qty_confirmed: true }),
        makeComparison({ id: "comp-2", received_qty: 5, received_qty_confirmed: true }),
      ],
    });
    expect(result.valid).toBe(true);
    expect(result.blockingRows).toBe(0);
  });

  it("blocks when any line has received_qty_confirmed=false (auto-filled, not confirmed)", () => {
    const result = validateReceivingBeforeConfirm({
      comparisons: [
        makeComparison({ received_qty: 10, received_qty_confirmed: false }),
      ],
    });
    expect(result.valid).toBe(false);
    expect(result.blockingRows).toBe(1);
    expect(result.reason).toMatch(/unconfirmed/i);
  });

  it("blocks when received_qty is null (missing)", () => {
    const result = validateReceivingBeforeConfirm({
      comparisons: [
        makeComparison({ received_qty: null, received_qty_confirmed: false }),
      ],
    });
    expect(result.valid).toBe(false);
    expect(result.blockingRows).toBe(1);
    expect(result.reason).toMatch(/missing/i);
  });

  it("skips missing_from_invoice rows (they have invoiced_qty=0)", () => {
    const result = validateReceivingBeforeConfirm({
      comparisons: [
        makeComparison({
          invoiced_qty: 0,
          received_qty: 0,
          received_qty_confirmed: false,
          status: "missing_from_invoice",
        }),
      ],
    });
    // missing_from_invoice rows are PO-synthetic, no confirmation needed
    expect(result.valid).toBe(true);
    expect(result.blockingRows).toBe(0);
  });

  it("skips rows where invoiced_qty is zero or null (nothing to confirm)", () => {
    const result = validateReceivingBeforeConfirm({
      comparisons: [
        makeComparison({ invoiced_qty: 0, received_qty: null, received_qty_confirmed: false }),
        makeComparison({ invoiced_qty: null, received_qty: null, received_qty_confirmed: false }),
      ],
    });
    expect(result.valid).toBe(true);
  });

  it("counts multiple blocking rows", () => {
    const result = validateReceivingBeforeConfirm({
      comparisons: [
        makeComparison({ id: "c1", received_qty: 10, received_qty_confirmed: false }),
        makeComparison({ id: "c2", received_qty: 5, received_qty_confirmed: false }),
        makeComparison({ id: "c3", received_qty: 3, received_qty_confirmed: true }),
      ],
    });
    expect(result.valid).toBe(false);
    expect(result.blockingRows).toBe(2);
  });
});

// ─── countUnconfirmedReceivedQty selector ────────────────────────────────────

describe("countUnconfirmedReceivedQty", () => {
  it("counts rows where received_qty_confirmed=false with invoiced_qty > 0", () => {
    const comparisons = [
      makeComparison({ received_qty_confirmed: false, invoiced_qty: 10 }),
      makeComparison({ id: "c2", received_qty_confirmed: true, invoiced_qty: 5 }),
      makeComparison({ id: "c3", received_qty_confirmed: false, invoiced_qty: 0 }), // invoiced=0, skip
    ] as InvoiceReviewComparison[];
    expect(countUnconfirmedReceivedQty(comparisons)).toBe(1);
  });

  it("returns 0 when all rows are confirmed", () => {
    const comparisons = [
      makeComparison({ received_qty_confirmed: true, invoiced_qty: 10 }),
    ] as InvoiceReviewComparison[];
    expect(countUnconfirmedReceivedQty(comparisons)).toBe(0);
  });

  it("skips missing_from_invoice rows", () => {
    const comparisons = [
      makeComparison({ received_qty_confirmed: false, invoiced_qty: 0, status: "missing_from_invoice" }),
    ] as InvoiceReviewComparison[];
    expect(countUnconfirmedReceivedQty(comparisons)).toBe(0);
  });
});

// ─── buildComparisonRows: received_qty_confirmed seeding ─────────────────────

describe("buildComparisonRows — received_qty_confirmed seeding (Phase 4)", () => {
  it("auto-filled invoice lines have received_qty_confirmed=false", () => {
    const rows = buildComparisonRows(
      makeDoc(),
      [makeLineItem()],
      [makePoItem()],
      NO_MAPPINGS,
      [makeCatalogItem()],
      "invoice",
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].received_qty_confirmed).toBe(false);
  });

  it("unmatched invoice lines also have received_qty_confirmed=false", () => {
    const rows = buildComparisonRows(
      makeDoc(),
      [makeLineItem({ catalog_item_id: null })],
      [],
      NO_MAPPINGS,
      [],
      "invoice",
    );
    expect(rows[0].received_qty_confirmed).toBe(false);
  });

  it("synthetic missing_from_invoice rows have received_qty_confirmed=true (no action needed)", () => {
    const rows = buildComparisonRows(
      makeDoc(),
      [],
      [makePoItem()],
      NO_MAPPINGS,
      [makeCatalogItem()],
      "invoice",
    );
    expect(rows[0].status).toBe("missing_from_invoice");
    expect(rows[0].received_qty_confirmed).toBe(true);
  });
});

// ─── buildPoLookup: duplicate catalog_item_id fix (Phase 4) ──────────────────

describe("buildComparisonRows — duplicate PO catalog_item_id handling (Phase 4)", () => {
  it("sums quantity when two PO items share catalog_item_id and same cost", () => {
    const poItems: InvoiceReviewPoItem[] = [
      makePoItem({ id: "p1", catalog_item_id: "cat-1", quantity_ordered: 6, unit_cost: 5 }),
      makePoItem({ id: "p2", catalog_item_id: "cat-1", quantity_ordered: 4, unit_cost: 5 }),
    ];

    const rows = buildComparisonRows(
      makeDoc(),
      [makeLineItem({ quantity: 10, unit_cost: 5 })],
      poItems,
      NO_MAPPINGS,
      [makeCatalogItem()],
      "invoice",
    );

    // The two PO lines are summed: 6 + 4 = 10 expected
    expect(rows).toHaveLength(1);
    expect(rows[0].po_qty).toBe(10);
  });

  it("does NOT silently drop one duplicate when costs differ — keeps first, skips second", () => {
    const poItems: InvoiceReviewPoItem[] = [
      makePoItem({ id: "p1", catalog_item_id: "cat-1", quantity_ordered: 8, unit_cost: 5 }),
      makePoItem({ id: "p2", catalog_item_id: "cat-1", quantity_ordered: 4, unit_cost: 7 }), // different cost
    ];

    const rows = buildComparisonRows(
      makeDoc(),
      [makeLineItem({ quantity: 8, unit_cost: 5 })],
      poItems,
      NO_MAPPINGS,
      [makeCatalogItem()],
      "invoice",
    );

    // The first PO item is kept; the second (different cost) is skipped
    expect(rows).toHaveLength(1);
    // po_qty = 8 (from first item, not silently 4 from last-write)
    expect(rows[0].po_qty).toBe(8);
  });

  it("still produces missing_from_invoice for deduplicated PO items not on invoice", () => {
    // Two PO lines for same catalog id, nothing on invoice
    const poItems: InvoiceReviewPoItem[] = [
      makePoItem({ id: "p1", catalog_item_id: "cat-1", quantity_ordered: 6, unit_cost: 5 }),
      makePoItem({ id: "p2", catalog_item_id: "cat-1", quantity_ordered: 4, unit_cost: 5 }),
    ];

    const rows = buildComparisonRows(
      makeDoc(),
      [],
      poItems,
      NO_MAPPINGS,
      [makeCatalogItem()],
      "invoice",
    );

    // Summed into one missing row
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("missing_from_invoice");
    expect(rows[0].po_qty).toBe(10);
  });
});
