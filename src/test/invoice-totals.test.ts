import { describe, it, expect } from "vitest";
import { resolveDocumentTotal } from "@/lib/invoice-totals";

describe("invoice-totals", () => {
  it("uses header total when provided", () => {
    expect(resolveDocumentTotal({ total: 99.5 }, [{ quantity: 1, unit_cost: 1 }])).toBe(99.5);
  });

  it("sums line total_cost when header missing", () => {
    expect(
      resolveDocumentTotal(
        {},
        [
          { total_cost: 10, quantity: 1, unit_cost: 10 },
          { total_cost: 5, quantity: 2, unit_cost: 2.5 },
        ],
      ),
    ).toBe(15);
  });

  it("falls back to qty × unit_cost", () => {
    expect(resolveDocumentTotal(null, [{ quantity: 3, unit_cost: 4 }])).toBe(12);
  });
});
