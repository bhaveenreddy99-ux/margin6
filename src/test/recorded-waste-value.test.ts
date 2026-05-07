import { describe, it, expect } from "vitest";
import { dollarsForWasteRow } from "@/domain/waste/recordedWasteValue";

describe("dollarsForWasteRow", () => {
  const emptyCat = new Map<string, number>();
  const emptySess = new Map<string, number>();

  it("uses total_cost when set", () => {
    expect(
      dollarsForWasteRow(
        { quantity: 2, total_cost: 10, unit_cost: 99, catalog_item_id: null },
        emptyCat,
        emptySess,
      ),
    ).toBe(10);
  });

  it("uses unit_cost * qty when no total_cost", () => {
    expect(
      dollarsForWasteRow(
        { quantity: 3, total_cost: null, unit_cost: 2, catalog_item_id: null },
        emptyCat,
        emptySess,
      ),
    ).toBe(6);
  });

  it("uses catalog default when row costs missing", () => {
    const cat = new Map([["a", 4]]);
    expect(
      dollarsForWasteRow(
        { quantity: 2, total_cost: null, unit_cost: null, catalog_item_id: "a" },
        cat,
        emptySess,
      ),
    ).toBe(8);
  });

  it("prefers catalog over session when both exist", () => {
    const cat = new Map([["a", 4]]);
    const sess = new Map([["a", 9]]);
    expect(
      dollarsForWasteRow(
        { quantity: 1, total_cost: null, unit_cost: null, catalog_item_id: "a" },
        cat,
        sess,
      ),
    ).toBe(4);
  });

  it("uses session when catalog missing", () => {
    const sess = new Map([["a", 5]]);
    expect(
      dollarsForWasteRow(
        { quantity: 2, total_cost: null, unit_cost: null, catalog_item_id: "a" },
        emptyCat,
        sess,
      ),
    ).toBe(10);
  });

  it("returns 0 when no catalog_item_id and no row costs", () => {
    expect(
      dollarsForWasteRow(
        { quantity: 2, total_cost: null, unit_cost: null, catalog_item_id: null },
        emptyCat,
        emptySess,
      ),
    ).toBe(0);
  });

  // ── Non-case unit (lb / each) guards ──────────────────────────────────────
  it("uses total_cost for lb entry — stored value is always reliable", () => {
    expect(
      dollarsForWasteRow(
        { quantity: 12, quantity_unit: "lb", total_cost: 1.5, unit_cost: 5, catalog_item_id: null },
        emptyCat,
        emptySess,
      ),
    ).toBe(1.5);
  });

  it("returns 0 for lb entry when total_cost is null — does NOT multiply per-case unit_cost × lb qty", () => {
    // If we multiplied naively: $5/case × 12 lb = $60 — this is the bug we are fixing.
    expect(
      dollarsForWasteRow(
        { quantity: 12, quantity_unit: "lb", total_cost: null, unit_cost: 5, catalog_item_id: null },
        emptyCat,
        emptySess,
      ),
    ).toBe(0);
  });

  it("returns 0 for lb entry when total_cost is null even with catalog default", () => {
    const cat = new Map([["a", 4]]);
    expect(
      dollarsForWasteRow(
        { quantity: 12, quantity_unit: "lb", total_cost: null, unit_cost: null, catalog_item_id: "a" },
        cat,
        emptySess,
      ),
    ).toBe(0);
  });

  it("returns 0 for each entry when total_cost is null — same protection as lb", () => {
    expect(
      dollarsForWasteRow(
        { quantity: 5, quantity_unit: "each", total_cost: null, unit_cost: 3, catalog_item_id: null },
        emptyCat,
        emptySess,
      ),
    ).toBe(0);
  });

  it("treats null quantity_unit as case — backward compat for legacy rows", () => {
    expect(
      dollarsForWasteRow(
        { quantity: 2, quantity_unit: null, total_cost: null, unit_cost: 3, catalog_item_id: null },
        emptyCat,
        emptySess,
      ),
    ).toBe(6);
  });

  it("treats missing quantity_unit as case — backward compat for callers not passing the field", () => {
    expect(
      dollarsForWasteRow(
        { quantity: 2, total_cost: null, unit_cost: 3, catalog_item_id: null },
        emptyCat,
        emptySess,
      ),
    ).toBe(6);
  });
});
