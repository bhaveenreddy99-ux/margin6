import { describe, expect, it } from "vitest";
import {
  aggregateWasteRows,
  sumWasteDollarsByLocation,
  type WasteRollupRow,
} from "@/domain/waste/wasteMetricsAggregate";

describe("aggregateWasteRows", () => {
  const empty = new Map<string, number>();

  it("case waste with unit_cost calculates dollars", () => {
    expect(
      aggregateWasteRows(
        [{ quantity: 3, quantity_unit: "case", unit_cost: 12, total_cost: null, catalog_item_id: null }],
        empty,
        empty,
      ),
    ).toEqual({ totalDollars: 36, missingCostCount: 0 });
  });

  it("legacy null quantity_unit treats as case — unit_cost × qty", () => {
    expect(
      aggregateWasteRows(
        [{ quantity: 2, total_cost: null, unit_cost: 5, catalog_item_id: null }],
        empty,
        empty,
      ),
    ).toEqual({ totalDollars: 10, missingCostCount: 0 });
  });

  it("lb waste without total_cost is $0 and counts as missing cost", () => {
    expect(
      aggregateWasteRows(
        [
          {
            quantity: 12,
            quantity_unit: "lb",
            total_cost: null,
            unit_cost: 40,
            catalog_item_id: "cat-1",
          },
        ],
        new Map([["cat-1", 30]]),
        new Map([["cat-1", 50]]),
      ),
    ).toEqual({ totalDollars: 0, missingCostCount: 1 });
  });

  it("lb waste with total_cost uses stored value and is not missing cost", () => {
    expect(
      aggregateWasteRows(
        [
          {
            quantity: 12,
            quantity_unit: "lb",
            total_cost: 18.5,
            unit_cost: 99,
            catalog_item_id: null,
          },
        ],
        empty,
        empty,
      ),
    ).toEqual({ totalDollars: 18.5, missingCostCount: 0 });
  });
});

describe("sumWasteDollarsByLocation (contract vs aggregateWasteRows)", () => {
  it("matches single-restaurant/session maps: per-location sum equals dashboard-style aggregate", () => {
    const rows: WasteRollupRow[] = [
      {
        restaurant_id: "rest-1",
        location_id: "loc-a",
        quantity: 2,
        quantity_unit: null,
        unit_cost: 7,
        total_cost: null,
        catalog_item_id: null,
      },
      {
        restaurant_id: "rest-1",
        location_id: "loc-b",
        quantity: 1,
        quantity_unit: "case",
        unit_cost: 10,
        total_cost: null,
        catalog_item_id: null,
      },
    ];
    const catByR = new Map<string, Map<string, number>>([["rest-1", new Map()]]);
    const sessByL = new Map<string, Map<string, number>>([
      ["loc-a", new Map()],
      ["loc-b", new Map()],
    ]);
    const byLoc = sumWasteDollarsByLocation(rows, catByR, sessByL);
    expect(byLoc.get("loc-a")).toBe(14);
    expect(byLoc.get("loc-b")).toBe(10);

    const stripContext = rows.map(({ quantity, quantity_unit, unit_cost, total_cost, catalog_item_id }) => ({
      quantity,
      quantity_unit,
      unit_cost,
      total_cost,
      catalog_item_id,
    }));
    expect(aggregateWasteRows(stripContext, new Map(), new Map()).totalDollars).toBe(24);
    expect([...byLoc.values()].reduce((s, v) => s + v, 0)).toBe(24);
  });

  it("applies catalog and session maps per restaurant and location like loadWasteMetrics", () => {
    const rows: WasteRollupRow[] = [
      {
        restaurant_id: "r1",
        location_id: "l1",
        quantity: 2,
        quantity_unit: null,
        total_cost: null,
        unit_cost: null,
        catalog_item_id: "c1",
      },
    ];
    const catByR = new Map([["r1", new Map([["c1", 15]])]]);
    const sessByL = new Map([["l1", new Map<string, number>()]]);
    const byLoc = sumWasteDollarsByLocation(rows, catByR, sessByL);
    expect(byLoc.get("l1")).toBe(30);
    expect(
      aggregateWasteRows(
        [
          {
            quantity: 2,
            quantity_unit: null,
            total_cost: null,
            unit_cost: null,
            catalog_item_id: "c1",
          },
        ],
        catByR.get("r1")!,
        sessByL.get("l1")!,
      ).totalDollars,
    ).toBe(30);
  });
});
