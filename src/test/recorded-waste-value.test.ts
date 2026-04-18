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
});
