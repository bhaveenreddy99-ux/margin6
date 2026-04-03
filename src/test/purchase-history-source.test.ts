import { describe, it, expect } from "vitest";
import {
  INVOICE_DOCUMENT_FILTER,
  isPurchaseHistoryInBusinessWindow,
  resolvePurchaseHistoryBusinessDate,
} from "@/lib/purchase-history-source";

describe("purchase-history-source", () => {
  it("exports PostgREST or filter for invoice-like documents", () => {
    expect(INVOICE_DOCUMENT_FILTER).toContain("invoice_number");
    expect(INVOICE_DOCUMENT_FILTER).toContain("pdf_url");
  });

  it("prefers invoice_date over created_at for business date", () => {
    const businessDate = resolvePurchaseHistoryBusinessDate({
      created_at: "2026-03-20T09:30:00Z",
      invoice_date: "2026-03-17",
    });

    expect(businessDate.getFullYear()).toBe(2026);
    expect(businessDate.getMonth()).toBe(2);
    expect(businessDate.getDate()).toBe(17);
  });

  it("falls back to created_at when invoice_date is missing", () => {
    const businessDate = resolvePurchaseHistoryBusinessDate({
      created_at: "2026-03-20T09:30:00Z",
      invoice_date: null,
    });

    expect(businessDate.toISOString()).toBe("2026-03-20T09:30:00.000Z");
  });

  it("filters rows by business date window", () => {
    const inWindow = isPurchaseHistoryInBusinessWindow(
      { created_at: "2026-03-20T09:30:00Z", invoice_date: "2026-03-17" },
      new Date("2026-03-15T00:00:00Z"),
      new Date("2026-03-18T23:59:59Z"),
    );
    const outOfWindow = isPurchaseHistoryInBusinessWindow(
      { created_at: "2026-03-20T09:30:00Z", invoice_date: "2026-03-10" },
      new Date("2026-03-15T00:00:00Z"),
      new Date("2026-03-18T23:59:59Z"),
    );

    expect(inWindow).toBe(true);
    expect(outOfWindow).toBe(false);
  });
});
