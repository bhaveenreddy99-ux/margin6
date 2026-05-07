import { describe, expect, it } from "vitest";
import {
  FIXED_STATUSES,
  shouldPersistDerivedStatus,
} from "@/domain/invoices/invoiceStatusLifecycle";
import {
  filterInvoices,
  matchesInvoiceStatusFilter,
  resolveMainInvoiceStatusKey,
  summarizeInvoices,
} from "@/domain/invoices/invoicesPageSelectors";
import type { InvoiceListRow } from "@/domain/invoices/invoicesPageTypes";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeInvoice(overrides: Partial<InvoiceListRow> = {}): InvoiceListRow {
  return {
    id: "inv-1",
    vendor_name: "Sysco",
    invoice_number: "INV-001",
    status: "review",
    receipt_status: "pending",
    created_at: new Date().toISOString(),
    invoice_date: null,
    invoice_total: null,
    ...overrides,
  } as InvoiceListRow;
}

// ---------------------------------------------------------------------------
// FIXED_STATUSES
// ---------------------------------------------------------------------------

describe("FIXED_STATUSES", () => {
  it("includes missing_from_invoice", () => expect(FIXED_STATUSES.has("missing_from_invoice")).toBe(true));
  it("includes extra_on_invoice", () => expect(FIXED_STATUSES.has("extra_on_invoice")).toBe(true));
  it("includes unmatched", () => expect(FIXED_STATUSES.has("unmatched")).toBe(true));
  it("does not include ok (derived status, not structural)", () => expect(FIXED_STATUSES.has("ok")).toBe(false));
  it("does not include confirmed (receipt status, not structural)", () => expect(FIXED_STATUSES.has("confirmed" as never)).toBe(false));
});

// ---------------------------------------------------------------------------
// shouldPersistDerivedStatus
// ---------------------------------------------------------------------------

describe("shouldPersistDerivedStatus", () => {
  it("returns true for null — no existing status, safe to derive", () => {
    expect(shouldPersistDerivedStatus(null)).toBe(true);
  });

  it("returns true for undefined — no existing status", () => {
    expect(shouldPersistDerivedStatus(undefined)).toBe(true);
  });

  it("returns true for an unknown/non-fixed status string", () => {
    expect(shouldPersistDerivedStatus("draft")).toBe(true);
    expect(shouldPersistDerivedStatus("reviewing")).toBe(true);
  });

  it("returns false for missing_from_invoice — structural fact, must not be overridden", () => {
    expect(shouldPersistDerivedStatus("missing_from_invoice")).toBe(false);
  });

  it("returns false for extra_on_invoice — structural fact, must not be overridden", () => {
    expect(shouldPersistDerivedStatus("extra_on_invoice")).toBe(false);
  });

  it("returns true for confirmed (receipt status, not a structural comparison fact)", () => {
    expect(shouldPersistDerivedStatus("confirmed")).toBe(true);
  });

  it("returns false for every status in FIXED_STATUSES", () => {
    for (const status of FIXED_STATUSES) {
      expect(shouldPersistDerivedStatus(status)).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// resolveMainInvoiceStatusKey
// ---------------------------------------------------------------------------

describe("resolveMainInvoiceStatusKey", () => {
  it("maps draft → DRAFT", () => expect(resolveMainInvoiceStatusKey("draft")).toBe("DRAFT"));
  it("maps review → PENDING_REVIEW", () => expect(resolveMainInvoiceStatusKey("review")).toBe("PENDING_REVIEW"));
  it("maps ready_to_receive → PENDING_REVIEW", () => expect(resolveMainInvoiceStatusKey("ready_to_receive")).toBe("PENDING_REVIEW"));
  it("maps confirmed → POSTED", () => expect(resolveMainInvoiceStatusKey("confirmed")).toBe("POSTED"));
  it("maps COMPLETE → POSTED", () => expect(resolveMainInvoiceStatusKey("COMPLETE")).toBe("POSTED"));
  it("maps null → POSTED (default fallback)", () => expect(resolveMainInvoiceStatusKey(null)).toBe("POSTED"));
  it("maps unknown status → POSTED (default fallback, not DRAFT)", () => {
    expect(resolveMainInvoiceStatusKey("some_unknown_status")).toBe("POSTED");
  });
});

// ---------------------------------------------------------------------------
// matchesInvoiceStatusFilter
// ---------------------------------------------------------------------------

describe("matchesInvoiceStatusFilter", () => {
  it("all filter matches every invoice", () => {
    expect(matchesInvoiceStatusFilter(makeInvoice({ status: "draft" }), "all")).toBe(true);
    expect(matchesInvoiceStatusFilter(makeInvoice({ status: "confirmed" }), "all")).toBe(true);
  });

  it("draft filter matches draft status only", () => {
    expect(matchesInvoiceStatusFilter(makeInvoice({ status: "draft" }), "draft")).toBe(true);
    expect(matchesInvoiceStatusFilter(makeInvoice({ status: "review" }), "draft")).toBe(false);
  });

  it("pending_review filter matches review and ready_to_receive", () => {
    expect(matchesInvoiceStatusFilter(makeInvoice({ status: "review" }), "pending_review")).toBe(true);
    expect(matchesInvoiceStatusFilter(makeInvoice({ status: "ready_to_receive" }), "pending_review")).toBe(true);
    expect(matchesInvoiceStatusFilter(makeInvoice({ status: "draft" }), "pending_review")).toBe(false);
  });

  it("posted filter matches confirmed and COMPLETE", () => {
    expect(matchesInvoiceStatusFilter(makeInvoice({ status: "confirmed" }), "posted")).toBe(true);
    expect(matchesInvoiceStatusFilter(makeInvoice({ status: "COMPLETE" }), "posted")).toBe(true);
    expect(matchesInvoiceStatusFilter(makeInvoice({ status: "draft" }), "posted")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// filterInvoices
// ---------------------------------------------------------------------------

describe("filterInvoices", () => {
  const invoices = [
    makeInvoice({ id: "1", vendor_name: "Sysco", status: "draft" }),
    makeInvoice({ id: "2", vendor_name: "US Foods", invoice_number: "INV-999", status: "review" }),
    makeInvoice({ id: "3", vendor_name: "Sysco", status: "confirmed" }),
  ];

  it("returns all when search and status filter are empty/all", () => {
    expect(filterInvoices(invoices, "", "all")).toHaveLength(3);
  });

  it("filters by vendor name (case-insensitive)", () => {
    expect(filterInvoices(invoices, "sysco", "all")).toHaveLength(2);
  });

  it("filters by invoice number", () => {
    expect(filterInvoices(invoices, "INV-999", "all")).toHaveLength(1);
  });

  it("combines search and status filter", () => {
    expect(filterInvoices(invoices, "sysco", "posted")).toHaveLength(1);
  });

  it("returns empty when no match", () => {
    expect(filterInvoices(invoices, "nonexistent-vendor", "all")).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// summarizeInvoices
// ---------------------------------------------------------------------------

describe("summarizeInvoices", () => {
  it("counts draft invoices", () => {
    const invoices = [makeInvoice({ status: "draft" }), makeInvoice({ id: "2", status: "review" })];
    expect(summarizeInvoices(invoices).draftCount).toBe(1);
  });

  it("counts received invoices (review + ready_to_receive)", () => {
    const invoices = [
      makeInvoice({ status: "review" }),
      makeInvoice({ id: "2", status: "ready_to_receive" }),
      makeInvoice({ id: "3", status: "draft" }),
    ];
    expect(summarizeInvoices(invoices).receivedCount).toBe(2);
  });

  it("counts unique active vendors", () => {
    const invoices = [
      makeInvoice({ vendor_name: "Sysco" }),
      makeInvoice({ id: "2", vendor_name: "US Foods" }),
      makeInvoice({ id: "3", vendor_name: "Sysco" }),
    ];
    expect(summarizeInvoices(invoices).activeVendors).toBe(2);
  });

  it("returns zero counts for empty list", () => {
    const result = summarizeInvoices([]);
    expect(result.draftCount).toBe(0);
    expect(result.receivedCount).toBe(0);
    expect(result.activeVendors).toBe(0);
    expect(result.lastInvoiceDate).toBeNull();
  });
});
