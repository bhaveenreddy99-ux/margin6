import { describe, it, expect } from "vitest";
import { computeOrderQtyCases } from "@/lib/inventory-utils";
import {
  computeSuggestedOrderCases,
  computeLineInventoryValue,
  computeLineReorderValue,
  computeLineOverstockValue,
  computeStockRisk,
  computeOrderDollars,
  computeSessionPlanningAggregate,
  type CasePlanningLine,
} from "@/domain/inventory/casePlanningEngine";

describe("casePlanningEngine", () => {
  // ── computeSuggestedOrderCases ──────────────────────────────────────────────

  describe("computeSuggestedOrderCases", () => {
    it("stock 4.5, par 5 → order 1 (ceil of 0.5)", () => {
      const line: CasePlanningLine = { currentStockCases: 4.5, parLevelCases: 5, unitCostPerCase: null };
      expect(computeSuggestedOrderCases(line)).toBe(1);
    });

    it("stock 5, par 5 → order 0 (at PAR)", () => {
      const line: CasePlanningLine = { currentStockCases: 5, parLevelCases: 5, unitCostPerCase: null };
      expect(computeSuggestedOrderCases(line)).toBe(0);
    });

    it("stock 6, par 5 → order 0 (overstock)", () => {
      const line: CasePlanningLine = { currentStockCases: 6, parLevelCases: 5, unitCostPerCase: null };
      expect(computeSuggestedOrderCases(line)).toBe(0);
    });

    it("stock null, par 5 → order 5 (null stock treated as 0)", () => {
      const line: CasePlanningLine = { currentStockCases: null, parLevelCases: 5, unitCostPerCase: null };
      expect(computeSuggestedOrderCases(line)).toBe(5);
    });

    it("stock undefined, par 5 → order 5", () => {
      const line: CasePlanningLine = { currentStockCases: undefined, parLevelCases: 5, unitCostPerCase: null };
      expect(computeSuggestedOrderCases(line)).toBe(5);
    });

    it("stock 3, par null → order 0 (no PAR)", () => {
      const line: CasePlanningLine = { currentStockCases: 3, parLevelCases: null, unitCostPerCase: 10 };
      expect(computeSuggestedOrderCases(line)).toBe(0);
    });

    it("stock 2, par 5 → order 3 (already whole number)", () => {
      const line: CasePlanningLine = { currentStockCases: 2, parLevelCases: 5, unitCostPerCase: null };
      expect(computeSuggestedOrderCases(line)).toBe(3);
    });

    it("stock 2.1, par 5 → order 3 (ceil of 2.9 = 3)", () => {
      const line: CasePlanningLine = { currentStockCases: 2.1, parLevelCases: 5, unitCostPerCase: null };
      expect(computeSuggestedOrderCases(line)).toBe(3);
    });
  });

  // ── computeLineInventoryValue ───────────────────────────────────────────────

  describe("computeLineInventoryValue", () => {
    it("2.5 cases × $10 = $25", () => {
      const line: CasePlanningLine = { currentStockCases: 2.5, parLevelCases: 5, unitCostPerCase: 10 };
      const result = computeLineInventoryValue(line);
      expect(result.dollars).toBe(25);
      expect(result.isMissingCost).toBe(false);
    });

    it("null cost returns dollars 0 and isMissingCost true", () => {
      const line: CasePlanningLine = { currentStockCases: 3, parLevelCases: 5, unitCostPerCase: null };
      const result = computeLineInventoryValue(line);
      expect(result.dollars).toBe(0);
      expect(result.isMissingCost).toBe(true);
    });

    it("undefined cost returns dollars 0 and isMissingCost true", () => {
      const line: CasePlanningLine = { currentStockCases: 3, parLevelCases: 5, unitCostPerCase: undefined };
      const result = computeLineInventoryValue(line);
      expect(result.dollars).toBe(0);
      expect(result.isMissingCost).toBe(true);
    });

    it("null stock treated as 0 cases", () => {
      const line: CasePlanningLine = { currentStockCases: null, parLevelCases: 5, unitCostPerCase: 10 };
      const result = computeLineInventoryValue(line);
      expect(result.dollars).toBe(0);
      expect(result.isMissingCost).toBe(false);
    });

    it("rounds to 2 decimal places", () => {
      const line: CasePlanningLine = { currentStockCases: 1, parLevelCases: 2, unitCostPerCase: 10.005 };
      const result = computeLineInventoryValue(line);
      expect(result.dollars).toBe(10.01);
    });
  });

  // ── computeLineReorderValue ─────────────────────────────────────────────────

  describe("computeLineReorderValue", () => {
    it("3 cases × $12.50 = $37.50", () => {
      const line: CasePlanningLine = { currentStockCases: 2, parLevelCases: 5, unitCostPerCase: 12.5 };
      const result = computeLineReorderValue(line);
      expect(result.dollars).toBe(37.50);
      expect(result.isMissingCost).toBe(false);
    });

    it("null cost returns dollars 0 and isMissingCost true", () => {
      const line: CasePlanningLine = { currentStockCases: 2, parLevelCases: 5, unitCostPerCase: null };
      const result = computeLineReorderValue(line);
      expect(result.dollars).toBe(0);
      expect(result.isMissingCost).toBe(true);
    });

    it("at PAR (no order needed) returns dollars 0 regardless of cost", () => {
      const line: CasePlanningLine = { currentStockCases: 5, parLevelCases: 5, unitCostPerCase: 20 };
      const result = computeLineReorderValue(line);
      expect(result.dollars).toBe(0);
      expect(result.isMissingCost).toBe(false);
    });
  });

  // ── computeLineOverstockValue ───────────────────────────────────────────────

  describe("computeLineOverstockValue", () => {
    it("stock 7, par 5, cost $10 → overstock $20", () => {
      const line: CasePlanningLine = { currentStockCases: 7, parLevelCases: 5, unitCostPerCase: 10 };
      const result = computeLineOverstockValue(line);
      expect(result.dollars).toBe(20);
      expect(result.isMissingCost).toBe(false);
    });

    it("stock at PAR → overstock $0", () => {
      const line: CasePlanningLine = { currentStockCases: 5, parLevelCases: 5, unitCostPerCase: 10 };
      const result = computeLineOverstockValue(line);
      expect(result.dollars).toBe(0);
    });

    it("stock below PAR → overstock $0", () => {
      const line: CasePlanningLine = { currentStockCases: 3, parLevelCases: 5, unitCostPerCase: 10 };
      const result = computeLineOverstockValue(line);
      expect(result.dollars).toBe(0);
    });

    it("null cost with overstock → dollars 0 and isMissingCost true", () => {
      const line: CasePlanningLine = { currentStockCases: 7, parLevelCases: 5, unitCostPerCase: null };
      const result = computeLineOverstockValue(line);
      expect(result.dollars).toBe(0);
      expect(result.isMissingCost).toBe(true);
    });

    it("zero $/case with overstock → dollars 0, not missing cost (portfolio parity)", () => {
      const line: CasePlanningLine = { currentStockCases: 7, parLevelCases: 5, unitCostPerCase: 0 };
      const result = computeLineOverstockValue(line);
      expect(result.dollars).toBe(0);
      expect(result.isMissingCost).toBe(false);
    });
  });

  // ── portfolio-dashboard edge: same order math as computeSuggestedOrderCases ─

  describe("computeOrderQtyCases vs computeSuggestedOrderCases (portfolio parity)", () => {
    it("agrees for representative cases-only session lines", () => {
      const lines: CasePlanningLine[] = [
        { currentStockCases: 4.5, parLevelCases: 5, unitCostPerCase: 10 },
        { currentStockCases: 5, parLevelCases: 5, unitCostPerCase: null },
        { currentStockCases: 6, parLevelCases: 5, unitCostPerCase: null },
        { currentStockCases: null, parLevelCases: 5, unitCostPerCase: null },
        { currentStockCases: undefined, parLevelCases: 5, unitCostPerCase: null },
        { currentStockCases: 3, parLevelCases: null, unitCostPerCase: 10 },
        { currentStockCases: 2, parLevelCases: 5, unitCostPerCase: null },
        { currentStockCases: 2.1, parLevelCases: 5, unitCostPerCase: null },
      ];
      for (const line of lines) {
        expect(computeOrderQtyCases(line.currentStockCases, line.parLevelCases)).toBe(
          computeSuggestedOrderCases(line),
        );
      }
    });
  });

  // ── computeOrderDollars ─────────────────────────────────────────────────────

  describe("computeOrderDollars", () => {
    it("3 × $12.50 = $37.50", () => {
      expect(computeOrderDollars(3, 12.5).dollars).toBe(37.5);
    });

    it("null cost → isMissingCost true, dollars 0", () => {
      const r = computeOrderDollars(3, null);
      expect(r.dollars).toBe(0);
      expect(r.isMissingCost).toBe(true);
    });

    it("qty 0 → dollars 0", () => {
      expect(computeOrderDollars(0, 10).dollars).toBe(0);
    });
  });

  // ── computeStockRisk ────────────────────────────────────────────────────────

  describe("computeStockRisk", () => {
    it("returns NO_PAR when parLevelCases is null", () => {
      const line: CasePlanningLine = { currentStockCases: 3, parLevelCases: null, unitCostPerCase: 10 };
      expect(computeStockRisk(line).level).toBe("NO_PAR");
    });

    it("returns RED when stock is 0 with positive par", () => {
      const line: CasePlanningLine = { currentStockCases: 0, parLevelCases: 5, unitCostPerCase: 10 };
      expect(computeStockRisk(line).level).toBe("RED");
    });

    it("returns GREEN when stock >= par", () => {
      const line: CasePlanningLine = { currentStockCases: 5, parLevelCases: 5, unitCostPerCase: 10 };
      expect(computeStockRisk(line).level).toBe("GREEN");
    });
  });

  // ── computeSessionPlanningAggregate ────────────────────────────────────────

  describe("computeSessionPlanningAggregate", () => {
    it("sums inventory values across lines", () => {
      const lines: CasePlanningLine[] = [
        { currentStockCases: 2, parLevelCases: 5, unitCostPerCase: 10 },
        { currentStockCases: 3, parLevelCases: 5, unitCostPerCase: 20 },
      ];
      const result = computeSessionPlanningAggregate(lines);
      expect(result.totalInventoryValueDollars).toBe(80); // 2×10 + 3×20
    });

    it("counts missing costs correctly — items with null cost excluded from dollar totals", () => {
      const lines: CasePlanningLine[] = [
        { currentStockCases: 2, parLevelCases: 5, unitCostPerCase: 10 },
        { currentStockCases: 3, parLevelCases: 5, unitCostPerCase: null },
        { currentStockCases: 1, parLevelCases: 5, unitCostPerCase: null },
      ];
      const result = computeSessionPlanningAggregate(lines);
      expect(result.itemsMissingCost).toBe(2);
      expect(result.itemsWithCost).toBe(1);
      // dollar total only includes the one costed line
      expect(result.totalInventoryValueDollars).toBe(20);
    });

    it("sums suggested order cases across lines", () => {
      const lines: CasePlanningLine[] = [
        { currentStockCases: 2, parLevelCases: 5, unitCostPerCase: 10 }, // needs 3
        { currentStockCases: 4.5, parLevelCases: 5, unitCostPerCase: 10 }, // needs ceil(0.5)=1
      ];
      const result = computeSessionPlanningAggregate(lines);
      expect(result.totalSuggestedOrderCases).toBe(4);
    });

    it("counts risk categories", () => {
      const lines: CasePlanningLine[] = [
        { currentStockCases: 0, parLevelCases: 5, unitCostPerCase: null }, // RED
        { currentStockCases: 3, parLevelCases: 5, unitCostPerCase: null }, // YELLOW (60%)
        { currentStockCases: 5, parLevelCases: 5, unitCostPerCase: null }, // GREEN
        { currentStockCases: 2, parLevelCases: null, unitCostPerCase: null }, // NO_PAR
      ];
      const result = computeSessionPlanningAggregate(lines);
      expect(result.redCount).toBe(1);
      expect(result.yellowCount).toBe(1);
      expect(result.greenCount).toBe(1);
      expect(result.noParCount).toBe(1);
    });

    it("totalReorderValueDollars excludes lines with missing cost", () => {
      const lines: CasePlanningLine[] = [
        { currentStockCases: 2, parLevelCases: 5, unitCostPerCase: 10 }, // order 3 → $30
        { currentStockCases: 1, parLevelCases: 5, unitCostPerCase: null }, // order 4 → $0 (no cost)
      ];
      const result = computeSessionPlanningAggregate(lines);
      expect(result.totalReorderValueDollars).toBe(30);
    });
  });
});
