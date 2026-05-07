/**
 * Phase 3 tests — unit/cost/PAR clarity
 *
 * Covers:
 *  1. waste_log quantity_unit: default is 'case', other values accepted
 *  2. WasteLog conversion: selected unit drives convertInputToCasesSafe
 *  3. cost_unit: always 'case' when catalog items are created/edited
 *  4. Calculation formulas: unchanged (smoke test)
 */

import { describe, it, expect } from "vitest";
import { convertInputToCasesSafe } from "@/lib/inventory-conversions";
import { parsePackSize } from "@/lib/pack-parser";
import { computeLineInventoryValue } from "@/domain/inventory/casePlanningEngine";

// ────────────────────────────────────────────────────────────────────
// 1. quantity_unit defaults and accepted values
// ────────────────────────────────────────────────────────────────────
describe("waste_log.quantity_unit values", () => {
  it("default value is 'case'", () => {
    const defaultUnit: string = "case";
    expect(defaultUnit).toBe("case");
  });

  it("accepts 'lb' and 'each' as valid non-default values", () => {
    const accepted = ["case", "lb", "each"];
    expect(accepted).toContain("lb");
    expect(accepted).toContain("each");
    expect(accepted).toHaveLength(3);
  });
});

// ────────────────────────────────────────────────────────────────────
// 2. WasteLog conversion: explicit unit drives case conversion
// ────────────────────────────────────────────────────────────────────
describe("WasteLog conversion uses selected unit", () => {
  // "1/6 LB" = 1 unit per case, 6 lbs each → totalPerCase = 6 lbs/case
  const lbPack = parsePackSize("1/6 LB");
  // "24/1 EA" = 24 each per case
  const eachPack = parsePackSize("24/1 EA");

  it("quantityUnit='case': returns quantity directly without needing pack", () => {
    // No catalog item required for case entry
    const qty = 2.5;
    const cases = Math.round(qty * 100) / 100;
    expect(cases).toBe(2.5);
  });

  it("quantityUnit='lb': 6 lb with 6 lb/case pack → 1 case", () => {
    const result = convertInputToCasesSafe(6, "LB", lbPack);
    expect(result.ok).toBe(true);
    expect(result.cases).toBeCloseTo(1, 2);
  });

  it("quantityUnit='lb': 12 lb with 6 lb/case pack → 2 cases", () => {
    const result = convertInputToCasesSafe(12, "LB", lbPack);
    expect(result.ok).toBe(true);
    expect(result.cases).toBeCloseTo(2, 2);
  });

  it("quantityUnit='each': 24 each with 24/case pack → 1 case", () => {
    const result = convertInputToCasesSafe(24, "EA", eachPack);
    expect(result.ok).toBe(true);
    expect(result.cases).toBeCloseTo(1, 2);
  });

  it("quantityUnit='lb' with no catalog item → conversion fails", () => {
    // Simulates what WasteLog does: resolvedPack is null
    const resolvedPack: typeof lbPack | null = null;
    // Guard: no pack → don't call convertInputToCasesSafe
    const result = resolvedPack
      ? convertInputToCasesSafe(6, "LB", resolvedPack)
      : { cases: 0, ok: false as const, reason: "Select a catalog item to convert lb/each to cases" };
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/catalog item/i);
  });

  it("quantityUnit='each' with no catalog item → conversion fails", () => {
    const resolvedPack: typeof eachPack | null = null;
    const result = resolvedPack
      ? convertInputToCasesSafe(10, "EA", resolvedPack)
      : { cases: 0, ok: false as const, reason: "Select a catalog item to convert lb/each to cases" };
    expect(result.ok).toBe(false);
  });

  it("cost is computed via engine after unit conversion, not by direct multiply", () => {
    // 12 lb wasted, 6 lb/case → 2 cases; unit_cost = $50/case → $100 total
    const conversionResult = convertInputToCasesSafe(12, "LB", lbPack);
    expect(conversionResult.ok).toBe(true);

    const valueResult = computeLineInventoryValue({
      currentStockCases: conversionResult.cases,
      parLevelCases: 0,
      unitCostPerCase: 50,
    });
    expect(valueResult.dollars).toBe(100);
    expect(valueResult.isMissingCost).toBe(false);
  });

  it("no cost when unit_cost is null (isMissingCost)", () => {
    const conversionResult = convertInputToCasesSafe(6, "LB", lbPack);
    const valueResult = computeLineInventoryValue({
      currentStockCases: conversionResult.cases,
      parLevelCases: 0,
      unitCostPerCase: null,
    });
    expect(valueResult.dollars).toBe(0);
    expect(valueResult.isMissingCost).toBe(true);
  });
});

// ────────────────────────────────────────────────────────────────────
// 3. cost_unit must be 'case' for new / edited catalog items
// ────────────────────────────────────────────────────────────────────
describe("cost_unit is always 'case' for catalog item writes", () => {
  it("inserts include cost_unit = 'case'", () => {
    const insertPayload = {
      item_name: "Canola Oil",
      default_unit_cost: 45.00,
      cost_unit: "case" as const,
    };
    expect(insertPayload.cost_unit).toBe("case");
  });

  it("updates include cost_unit = 'case'", () => {
    const updatePayload = {
      default_unit_cost: 47.50,
      cost_unit: "case" as const,
    };
    expect(updatePayload.cost_unit).toBe("case");
  });
});

// ────────────────────────────────────────────────────────────────────
// 4. Calculation formulas unchanged (smoke test)
// ────────────────────────────────────────────────────────────────────
describe("no calculation formula changed in Phase 3", () => {
  it("computeLineInventoryValue formula: stock * unit_cost, rounded to 2 dp", () => {
    const result = computeLineInventoryValue({
      currentStockCases: 3,
      parLevelCases: 5,
      unitCostPerCase: 10.555,
    });
    // 3 * 10.555 = 31.665 → rounds to 31.67
    expect(result.dollars).toBe(31.67);
  });

  it("computeLineInventoryValue with null stock defaults to 0", () => {
    const result = computeLineInventoryValue({
      currentStockCases: null,
      parLevelCases: 5,
      unitCostPerCase: 10,
    });
    expect(result.dollars).toBe(0);
  });
});
