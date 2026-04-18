import { describe, expect, it } from "vitest";
import {
  analyzeInvoiceComparison,
  deriveInvoiceComparisonStatus,
  receivedVsBilledDollarVariance,
} from "@/lib/invoice-comparison";

describe("invoice comparison tolerances", () => {
  it("ignores small percentage quantity variance on large lines", () => {
    expect(
      deriveInvoiceComparisonStatus({
        po_qty: 100,
        invoiced_qty: 100.2,
        po_unit_cost: 5,
        invoiced_unit_cost: 5,
      }),
    ).toBe("ok");
  });

  it("flags meaningful percentage quantity variance", () => {
    const analysis = analyzeInvoiceComparison({
      po_qty: 10,
      invoiced_qty: 10.2,
      po_unit_cost: 5,
      invoiced_unit_cost: 5,
    });

    expect(analysis.qty.exceedsTolerance).toBe(true);
    expect(analysis.qty.percentDifference).toBeGreaterThan(0.5);
    expect(analysis.status).toBe("qty_mismatch");
  });

  it("ignores small percentage price variance on large lines", () => {
    expect(
      deriveInvoiceComparisonStatus({
        po_qty: 5,
        invoiced_qty: 5,
        po_unit_cost: 20,
        invoiced_unit_cost: 20.05,
      }),
    ).toBe("ok");
  });

  it("flags meaningful percentage price variance", () => {
    const analysis = analyzeInvoiceComparison({
      po_qty: 5,
      invoiced_qty: 5,
      po_unit_cost: 2,
      invoiced_unit_cost: 2.05,
    });

    expect(analysis.price.exceedsTolerance).toBe(true);
    expect(analysis.price.percentDifference).toBeGreaterThan(1);
    expect(analysis.status).toBe("price_mismatch");
  });

  it("flags meaningful line-total variance even when qty and price are within tolerance", () => {
    const analysis = analyzeInvoiceComparison({
      po_qty: 100,
      invoiced_qty: 100.2,
      po_unit_cost: 5,
      invoiced_unit_cost: 5.02,
      po_total_cost: 500,
      invoiced_total_cost: 520,
    });

    expect(analysis.qty.exceedsTolerance).toBe(false);
    expect(analysis.price.exceedsTolerance).toBe(false);
    expect(analysis.total.exceedsTolerance).toBe(true);
    expect(analysis.status).toBe("total_mismatch");
  });

  it("preserves special non-tolerance statuses", () => {
    expect(
      deriveInvoiceComparisonStatus({
        status: "missing_from_invoice",
        po_qty: 10,
        invoiced_qty: 0,
      }),
    ).toBe("missing_from_invoice");
    expect(
      deriveInvoiceComparisonStatus({
        status: "unmatched",
        po_qty: null,
        invoiced_qty: 4,
      }),
    ).toBe("unmatched");
  });

  it("flags received_short when received is below billed beyond tolerance", () => {
    expect(
      deriveInvoiceComparisonStatus({
        po_qty: 10,
        invoiced_qty: 10,
        received_qty: 8,
        po_unit_cost: 5,
        invoiced_unit_cost: 5,
      }),
    ).toBe("received_short");
  });

  it("flags received_over when received exceeds billed beyond tolerance", () => {
    expect(
      deriveInvoiceComparisonStatus({
        po_qty: 10,
        invoiced_qty: 10,
        received_qty: 12,
        po_unit_cost: 5,
        invoiced_unit_cost: 5,
      }),
    ).toBe("received_over");
  });

  it("prioritizes received variance over PO vs invoice qty when both apply", () => {
    expect(
      deriveInvoiceComparisonStatus({
        po_qty: 10,
        invoiced_qty: 10,
        received_qty: 7,
        po_unit_cost: 5,
        invoiced_unit_cost: 6,
      }),
    ).toBe("received_short");
  });

  it("keeps received variance null-aware when received quantity is blank", () => {
    expect(receivedVsBilledDollarVariance(10, null, 5)).toBeNull();
    expect(
      deriveInvoiceComparisonStatus({
        po_qty: 10,
        invoiced_qty: 10,
        received_qty: null,
        po_unit_cost: 5,
        invoiced_unit_cost: 5,
      }),
    ).not.toBe("received_short");
    expect(
      deriveInvoiceComparisonStatus({
        po_qty: 10,
        invoiced_qty: 10,
        received_qty: null,
        po_unit_cost: 5,
        invoiced_unit_cost: 5,
      }),
    ).not.toBe("received_over");
  });
});
