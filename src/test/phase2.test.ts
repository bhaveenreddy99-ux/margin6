/**
 * Phase 2 regression tests:
 *  - convertInputToCasesSafe (waste unit conversion)
 *  - buildSessionStats (inventory value via engine)
 *  - buildSubmitSummary (reorder value via engine + missing cost tracking)
 *  - computeReorderSummary (reorder + waste value via engine)
 */
import { describe, it, expect } from "vitest";
import { parsePackSize } from "@/lib/pack-parser";
import { getPackFromCatalogItem, convertInputToCasesSafe } from "@/lib/inventory-conversions";
import { computeLineInventoryValue } from "@/domain/inventory/casePlanningEngine";
import { computeReorderSummary, type InventoryItemInput } from "@/domain/inventory/reorderEngine";
import { buildSessionStats, buildSmartOrderRunItems, type SmartOrderComputedItem } from "@/domain/inventory/items/itemView";

// ── convertInputToCasesSafe ──────────────────────────────────────────────────

describe("convertInputToCasesSafe", () => {
  /**
   * "6/4 lb" pack: 6 units per case, 4 lb each → 24 lb total per case.
   * User enters 24 lb → should convert to exactly 1 case.
   */
  it("6/4 lb pack: 24 lb input → 1 case", () => {
    const pack = parsePackSize("6/4 lb");
    // totalPerCase should be 24 (6 × 4)
    expect(pack.totalPerCase).toBe(24);

    const result = convertInputToCasesSafe(24, "LB", pack);
    expect(result.ok).toBe(true);
    expect(result.cases).toBe(1);
  });

  it("6/4 lb pack: 1 case input → same dollars as 24 lb input", () => {
    const pack = parsePackSize("6/4 lb");
    const unitCost = 48; // $48 per case

    const fromLb = convertInputToCasesSafe(24, "LB", pack);
    const fromCase = convertInputToCasesSafe(1, "CS", pack);

    expect(fromLb.ok).toBe(true);
    expect(fromCase.ok).toBe(true);

    const dollarsFromLb = computeLineInventoryValue({
      currentStockCases: fromLb.cases,
      parLevelCases: 0,
      unitCostPerCase: unitCost,
    }).dollars;
    const dollarsFromCase = computeLineInventoryValue({
      currentStockCases: fromCase.cases,
      parLevelCases: 0,
      unitCostPerCase: unitCost,
    }).dollars;

    // Both should equal $48 (1 case × $48/case)
    expect(dollarsFromLb).toBe(48);
    expect(dollarsFromCase).toBe(48);
    expect(dollarsFromLb).toBe(dollarsFromCase);
  });

  it("invalid input (negative) → ok: false", () => {
    const pack = parsePackSize("6/4 lb");
    const result = convertInputToCasesSafe(-1, "LB", pack);
    expect(result.ok).toBe(false);
    expect(result.cases).toBe(0);
  });

  it("null pack → ok: false, cases 0", () => {
    const result = convertInputToCasesSafe(5, "LB", null);
    expect(result.ok).toBe(false);
    expect(result.cases).toBe(0);
    expect(result.reason).toBeDefined();
  });

  it("CS unit: entered value IS cases, passes through", () => {
    const pack = parsePackSize("6/4 lb");
    const result = convertInputToCasesSafe(2.5, "CS", pack);
    expect(result.ok).toBe(true);
    expect(result.cases).toBe(2.5);
  });

  it("each/unit item: 12 units, 12 per case → 1 case", () => {
    // Simulate a catalog item with units_per_case=12, EA
    const pack = getPackFromCatalogItem({
      units_per_case: 12,
      unit_size: 1,
      unit_type: "each",
      total_per_case: 12,
      pack_size: "12 ea",
      pack_parse_success: true,
    });
    const result = convertInputToCasesSafe(12, "EA", pack);
    expect(result.ok).toBe(true);
    expect(result.cases).toBe(1);
  });

  it("weight unit with no totalPerCase → ok: false", () => {
    // A pack with totalPerCase=0 — can't convert weight
    const pack = parsePackSize("EACH"); // fallback pack has totalPerCase=1 not 0
    // Manually construct a bad pack
    const badPack = { ...pack, totalPerCase: 0 };
    const result = convertInputToCasesSafe(5, "LB", badPack);
    expect(result.ok).toBe(false);
  });
});

// ── buildSessionStats ────────────────────────────────────────────────────────

describe("buildSessionStats", () => {
  it("accumulates totalValue via engine (no raw multiplication)", () => {
    const rows = [
      { session_id: "s1", current_stock: 2, unit_cost: 10 },
      { session_id: "s1", current_stock: 3, unit_cost: 20 },
    ];
    const stats = buildSessionStats(rows);
    // 2×10 + 3×20 = 80
    expect(stats["s1"].totalValue).toBe(80);
    expect(stats["s1"].itemsWithCost).toBe(2);
    expect(stats["s1"].itemsWithoutCost).toBe(0);
  });

  it("null unit_cost → increments itemsWithoutCost, contributes $0 to totalValue", () => {
    const rows = [
      { session_id: "s1", current_stock: 5, unit_cost: 10 },
      { session_id: "s1", current_stock: 3, unit_cost: null },
    ];
    const stats = buildSessionStats(rows);
    expect(stats["s1"].itemsWithoutCost).toBe(1);
    expect(stats["s1"].itemsWithCost).toBe(1);
    // Only the costed item contributes
    expect(stats["s1"].totalValue).toBe(50);
  });

  it("null current_stock treated as 0 (uncounted item)", () => {
    const rows = [
      { session_id: "s1", current_stock: null, unit_cost: 15 },
    ];
    const stats = buildSessionStats(rows);
    // stock=0 × cost=15 = $0
    expect(stats["s1"].totalValue).toBe(0);
    expect(stats["s1"].itemsWithCost).toBe(1);
  });

  it("groups by session_id correctly", () => {
    const rows = [
      { session_id: "sA", current_stock: 2, unit_cost: 10 },
      { session_id: "sB", current_stock: 4, unit_cost: 5 },
    ];
    const stats = buildSessionStats(rows);
    expect(stats["sA"].totalValue).toBe(20);
    expect(stats["sB"].totalValue).toBe(20);
  });
});

// ── computeReorderSummary (engine routing) ───────────────────────────────────

describe("computeReorderSummary — engine routing", () => {
  it("totalReorderValue uses engine rounding (not raw multiplication)", () => {
    const items: InventoryItemInput[] = [
      { current_stock: 2, par_level: 5, unit_cost: 12.5 },   // order 3 → $37.50
      { current_stock: 4, par_level: 6, unit_cost: 10 },     // order 2 → $20.00
    ];
    const summary = computeReorderSummary(items);
    expect(summary.totalReorderValue).toBe(57.5);
  });

  it("totalWasteValue uses engine (overstock × cost, rounded)", () => {
    const items: InventoryItemInput[] = [
      { current_stock: 8, par_level: 5, unit_cost: 10 },  // overstock 3 → $30
      { current_stock: 3, par_level: 5, unit_cost: 10 },  // no overstock → $0
    ];
    const summary = computeReorderSummary(items);
    expect(summary.totalWasteValue).toBe(30);
  });

  it("null unit_cost contributes $0 to reorder and waste totals", () => {
    const items: InventoryItemInput[] = [
      { current_stock: 2, par_level: 5, unit_cost: null },
      { current_stock: 8, par_level: 5, unit_cost: null },
    ];
    const summary = computeReorderSummary(items);
    expect(summary.totalReorderValue).toBe(0);
    expect(summary.totalWasteValue).toBe(0);
    expect(summary.missingCostCount).toBe(2);
  });
});

// ── buildSmartOrderRunItems ───────────────────────────────────────────────────

function makeComputedItem(overrides: Partial<SmartOrderComputedItem> = {}): SmartOrderComputedItem {
  return {
    id: "item-1",
    session_id: "session-1",
    item_name: "Donated Bread",
    category: "Bakery",
    unit: "cs",
    current_stock: 2,
    par_level: 5,
    unit_cost: 10,
    pack_size: null,
    vendor_sku: null,
    vendor_name: null,
    brand_name: null,
    catalog_item_id: null,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    // SmartOrderComputedItem extensions
    parLevel: 5,
    parSource: "session",
    currentStock: 2,
    risk: "RED",
    suggestedOrder: 3,
    ...overrides,
  } as SmartOrderComputedItem;
}

describe("buildSmartOrderRunItems", () => {
  it("preserves unit_cost = 0 (manual smart-order path does not coerce zero to null)", () => {
    const rows = buildSmartOrderRunItems("run-42", [makeComputedItem({ unit_cost: 0 })]);
    expect(rows).toHaveLength(1);
    expect(rows[0].unit_cost).toBe(0);
  });

  it("maps null unit_cost to null (genuinely missing cost stays null)", () => {
    const rows = buildSmartOrderRunItems("run-43", [makeComputedItem({ unit_cost: null })]);
    expect(rows).toHaveLength(1);
    expect(rows[0].unit_cost).toBeNull();
  });

  it("passes run_id through to every row", () => {
    const rows = buildSmartOrderRunItems("run-99", [
      makeComputedItem({ unit_cost: 5 }),
      makeComputedItem({ id: "item-2", unit_cost: 0 }),
    ]);
    expect(rows.every((r) => r.run_id === "run-99")).toBe(true);
    expect(rows[1].unit_cost).toBe(0);
  });
});
