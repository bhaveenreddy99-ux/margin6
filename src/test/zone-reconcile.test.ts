import { describe, expect, it } from "vitest";
import {
  catalogItemIdsWithDuplicateParentRows,
  reconciledParentStockFromZoneRows,
  zoneUpsertRequiresLegacyAck,
} from "@/domain/inventory/zoneReconcile";
import type { PlanningUnitMeta } from "@/domain/inventory/zoneCounting";

const meta: PlanningUnitMeta = {
  planning_unit: "case",
  count_base_unit: "lb",
  units_per_planning_unit: 40,
};

describe("zoneReconcile", () => {
  describe("reconciledParentStockFromZoneRows", () => {
    it("sums zones from entered fields", () => {
      const total = reconciledParentStockFromZoneRows(
        [
          { entered_qty: 1.5, entered_unit: "case" },
          { entered_qty: 12, entered_unit: "lb" },
          { entered_qty: 4, entered_unit: "lb" },
        ],
        meta,
        99,
      );
      expect(total).toBeCloseTo(1.9, 10);
    });
    it("uses legacy parent stock when no zones", () => {
      expect(reconciledParentStockFromZoneRows([], meta, 3.25)).toBe(3.25);
    });
  });

  describe("zoneUpsertRequiresLegacyAck", () => {
    it("requires ack only for first zone on a line with non-zero legacy stock", () => {
      expect(zoneUpsertRequiresLegacyAck(0, null)).toBe(false);
      expect(zoneUpsertRequiresLegacyAck(0, 0)).toBe(false);
      expect(zoneUpsertRequiresLegacyAck(0, 3.5)).toBe(true);
      expect(zoneUpsertRequiresLegacyAck(1, 99)).toBe(false);
    });
  });

  describe("catalogItemIdsWithDuplicateParentRows", () => {
    it("lists catalog ids with more than one session row", () => {
      expect(
        catalogItemIdsWithDuplicateParentRows([
          { catalog_item_id: "a" },
          { catalog_item_id: "a" },
          { catalog_item_id: "b" },
        ]),
      ).toEqual(["a"]);
    });
    it("ignores null catalog ids", () => {
      expect(
        catalogItemIdsWithDuplicateParentRows([{ catalog_item_id: null }, { catalog_item_id: "x" }]),
      ).toEqual([]);
    });
  });
});
