import { describe, expect, it } from "vitest";
import {
  buildReconciledSessionItemStock,
  isAllowedZoneUnit,
  normalizeZoneQtyToPlanningUnit,
  sumZoneRowsToCurrentStock,
  type PlanningUnitMeta,
} from "@/domain/inventory/zoneCounting";

const chickenMeta: PlanningUnitMeta = {
  planning_unit: "case",
  count_base_unit: "lb",
  units_per_planning_unit: 40,
};

describe("zoneCounting", () => {
  describe("isAllowedZoneUnit", () => {
    it("allows planning and base units case-insensitively", () => {
      expect(isAllowedZoneUnit("case", chickenMeta)).toBe(true);
      expect(isAllowedZoneUnit("CASE", chickenMeta)).toBe(true);
      expect(isAllowedZoneUnit("CS", chickenMeta)).toBe(true);
      expect(isAllowedZoneUnit("lb", chickenMeta)).toBe(true);
      expect(isAllowedZoneUnit(" LB ", chickenMeta)).toBe(true);
    });
    it("rejects unknown units and invalid meta", () => {
      expect(isAllowedZoneUnit("kg", chickenMeta)).toBe(false);
      expect(isAllowedZoneUnit("", chickenMeta)).toBe(false);
      expect(isAllowedZoneUnit("case", { ...chickenMeta, units_per_planning_unit: 0 })).toBe(false);
    });
  });

  describe("normalizeZoneQtyToPlanningUnit", () => {
    it("matches chicken breast example zones", () => {
      expect(normalizeZoneQtyToPlanningUnit(1.5, "case", chickenMeta)).toBe(1.5);
      expect(normalizeZoneQtyToPlanningUnit(1.5, "CS", chickenMeta)).toBe(1.5);
      expect(normalizeZoneQtyToPlanningUnit(12, "lb", chickenMeta)).toBeCloseTo(0.3, 10);
      expect(normalizeZoneQtyToPlanningUnit(4, "lb", chickenMeta)).toBeCloseTo(0.1, 10);
    });
    it("throws on negative qty or bad unit", () => {
      expect(() => normalizeZoneQtyToPlanningUnit(-1, "case", chickenMeta)).toThrow(RangeError);
      expect(() => normalizeZoneQtyToPlanningUnit(1, "each", chickenMeta)).toThrow(Error);
    });
  });

  describe("sumZoneRowsToCurrentStock", () => {
    it("sums normalized_qty", () => {
      expect(
        sumZoneRowsToCurrentStock([{ normalized_qty: 1.5 }, { normalized_qty: 0.3 }, { normalized_qty: 0.1 }]),
      ).toBeCloseTo(1.9, 10);
    });
    it("throws on bad normalized values", () => {
      expect(() => sumZoneRowsToCurrentStock([{ normalized_qty: NaN }])).toThrow(RangeError);
    });
  });

  describe("buildReconciledSessionItemStock", () => {
    it("reconciles from zone rows when present", () => {
      const total = buildReconciledSessionItemStock({
        zoneRows: [
          { entered_qty: 1.5, entered_unit: "case" },
          { entered_qty: 12, entered_unit: "lb" },
          { entered_qty: 4, entered_unit: "lb" },
        ],
        itemMeta: chickenMeta,
        legacyCurrentStock: 999,
      });
      expect(total).toBeCloseTo(1.9, 10);
    });
    it("uses legacy current_stock when no zone rows", () => {
      expect(
        buildReconciledSessionItemStock({
          zoneRows: [],
          itemMeta: chickenMeta,
          legacyCurrentStock: 3.25,
        }),
      ).toBe(3.25);
    });
    it("treats null legacy as 0 when no zone rows", () => {
      expect(
        buildReconciledSessionItemStock({
          zoneRows: [],
          itemMeta: chickenMeta,
          legacyCurrentStock: null,
        }),
      ).toBe(0);
    });
  });
});
