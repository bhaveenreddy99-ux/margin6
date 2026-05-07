import { describe, it, expect } from "vitest";
import {
  getRisk,
  computeOrderQty,
  computeRiskLevel,
  inputDisplayValue,
} from "@/lib/inventory-utils";

describe("inventory-utils", () => {
  describe("getRisk", () => {
    it("returns NO_PAR when par is zero or missing", () => {
      expect(getRisk(5, 0).level).toBe("NO_PAR");
      expect(getRisk(5, null).level).toBe("NO_PAR");
    });

    it("returns RED when stock is zero with positive par", () => {
      expect(getRisk(0, 10).level).toBe("RED");
    });

    it("returns RED when below 50% of par", () => {
      expect(getRisk(4, 10).level).toBe("RED");
    });

    it("returns YELLOW when between 50% and 100%", () => {
      expect(getRisk(7, 10).level).toBe("YELLOW");
    });

    it("returns GREEN at or above par", () => {
      expect(getRisk(10, 10).level).toBe("GREEN");
      expect(getRisk(12, 10).level).toBe("GREEN");
    });

    it("supports threshold overrides", () => {
      expect(getRisk(7, 10, { redThresholdPercent: 80, yellowThresholdPercent: 110 }).level).toBe("RED");
      expect(getRisk(10, 10, { redThresholdPercent: 80, yellowThresholdPercent: 110 }).level).toBe("YELLOW");
      expect(getRisk(12, 10, { redThresholdPercent: 80, yellowThresholdPercent: 110 }).level).toBe("GREEN");
    });
  });

  describe("computeRiskLevel", () => {
    it("matches getRisk(...).level with and without restaurant thresholds", () => {
      expect(computeRiskLevel(4, 10)).toBe(getRisk(4, 10).level);
      const th = { redThresholdPercent: 80, yellowThresholdPercent: 110 } as const;
      expect(computeRiskLevel(7, 10, th)).toBe("RED");
      expect(computeRiskLevel(7, 10, th)).toBe(getRisk(7, 10, th).level);
    });
  });

  describe("computeOrderQty", () => {
    it("returns zero when at or above par", () => {
      expect(computeOrderQty(10, 10)).toBe(0);
      expect(computeOrderQty(12, 10)).toBe(0);
    });

    it("ceil need for case-like units", () => {
      expect(computeOrderQty(2, 10, "CS", null)).toBe(8);
      expect(computeOrderQty(2, 10, null, "10 lb Case")).toBe(8);
    });

    it("2 decimal order qty for liquid/weight units", () => {
      expect(computeOrderQty(2, 4.5, "GAL", null)).toBe(2.5);
      expect(computeOrderQty(1.25, 10, "LB", null)).toBe(8.75);
    });

    it("defaults to ceiling when unit unknown", () => {
      expect(computeOrderQty(2, 10, null, null)).toBe(8);
    });
  });

  describe("inputDisplayValue (Clear All Counts visual reset)", () => {
    it("renders null and undefined as empty string", () => {
      expect(inputDisplayValue(null)).toBe("");
      expect(inputDisplayValue(undefined)).toBe("");
    });

    it("renders 0 as empty string — 0 is the 'uncounted' state in this app", () => {
      // Clear All Counts writes 0 to current_stock (NOT NULL column).
      // The count input MUST render that as blank, not literal "0",
      // otherwise rows still appear to have a count.
      expect(inputDisplayValue(0)).toBe("");
    });

    it("renders positive numbers as their string form", () => {
      expect(inputDisplayValue(5)).toBe("5");
      expect(inputDisplayValue(0.5)).toBe("0.5");
      expect(inputDisplayValue(12.34)).toBe("12.34");
    });
  });
});
