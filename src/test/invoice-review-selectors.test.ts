import { describe, expect, it } from "vitest";
import { groupConfirmResultItems } from "@/domain/invoices/invoiceReviewSelectors";
import type {
  ConfirmInvoiceReceiptItem,
  ConfirmInvoiceReceiptResult,
} from "@/domain/invoices/invoiceReviewTypes";

function baseResult(overrides: Partial<ConfirmInvoiceReceiptResult>): ConfirmInvoiceReceiptResult {
  return {
    already_confirmed: false,
    no_catalog: 0,
    ...overrides,
  };
}

describe("groupConfirmResultItems", () => {
  it("places status=confirmed items in postedStockItems", () => {
    const confirmed: ConfirmInvoiceReceiptItem = {
      item_name: "Tomatoes",
      status: "confirmed",
      quantity_confirmed: 2.5,
      quantity_unit: "case",
      source_qty: 10,
      source_unit: "LB",
    };
    const r = baseResult({
      items: [confirmed],
    });
    const { postedStockItems, conversionFailedItems } = groupConfirmResultItems(r);
    expect(postedStockItems).toEqual([confirmed]);
    expect(conversionFailedItems).toEqual([]);
  });

  it("places status=unit_conversion_failed items in conversionFailedItems", () => {
    const failed: ConfirmInvoiceReceiptItem = {
      item_name: "Oil",
      status: "unit_conversion_failed",
      source_qty: 5,
      source_unit: "GAL",
      reason: 'Unknown unit "GAL"',
    };
    const r = baseResult({
      unit_conversion_failed: 1,
      items: [failed],
    });
    const { postedStockItems, conversionFailedItems } = groupConfirmResultItems(r);
    expect(postedStockItems).toEqual([]);
    expect(conversionFailedItems).toEqual([failed]);
  });

  it("does not group already_confirmed line items (summary-only in RPC; top banner handles receipt)", () => {
    const line: ConfirmInvoiceReceiptItem = {
      item_name: "Sugar",
      status: "already_confirmed",
      quantity_confirmed: 3,
    };
    const r = baseResult({
      already_confirmed: true,
      items: [line],
    });
    const { postedStockItems, conversionFailedItems } = groupConfirmResultItems(r);
    expect(postedStockItems).toEqual([]);
    expect(conversionFailedItems).toEqual([]);
  });

  it("does not group no_catalog_match (dialog uses no_catalog count + dedicated section)", () => {
    const nc: ConfirmInvoiceReceiptItem = {
      item_name: "Mystery",
      status: "no_catalog_match",
      quantity_confirmed: 1,
    };
    const r = baseResult({
      no_catalog: 1,
      items: [nc],
    });
    const { postedStockItems, conversionFailedItems } = groupConfirmResultItems(r);
    expect(postedStockItems).toEqual([]);
    expect(conversionFailedItems).toEqual([]);
  });

  it("returns empty arrays when confirmResult is null", () => {
    expect(groupConfirmResultItems(null)).toEqual({
      postedStockItems: [],
      conversionFailedItems: [],
    });
  });
});
