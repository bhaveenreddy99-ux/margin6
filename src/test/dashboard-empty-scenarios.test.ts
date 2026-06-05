import { describe, expect, it } from "vitest";
import {
  computeDataQualityScore,
  computeInventoryValueConfidence,
  computeMoneyLostConfidence,
  computeOverstockConfidence,
} from "@/domain/dataQuality";
import {
  computeFoodCostPct,
  computeMoneyLostTotal,
  computeOverstockValue,
  computeInventoryLineValue,
  computeReorderNeededValue,
  computeCriticalLowStockCount,
} from "@/domain/dashboard/dashboardTrustFormulas";
import { buildKpiConfidenceInput } from "@/components/explainability";

function assertSafeNumber(n: number, label: string): void {
  expect(Number.isFinite(n), `${label} must be finite`).toBe(true);
  expect(Number.isNaN(n), `${label} must not be NaN`).toBe(false);
}

const emptyConfidenceSnapshot = {
  missingParCount: 0,
  missingCostCount: 0,
  periodSpend: 0,
  weeklyGrossSales: null,
  pendingInvoices: 0,
  deliveryIssuesCount: 0,
  shrinkageValue: 0,
  lastSessionDate: null,
  overstockValue: 0,
  inventoryValue: 0,
  recordedWasteValue: 0,
  priceIncreaseImpact: 0,
  wasteItemsMissingCost: 0,
  reorderSummary: null,
  foodCostPct: null,
};

describe("dashboard empty data scenarios", () => {
  it("Scenario A — no invoices: period spend and food cost stay safe", () => {
    const foodCost = computeFoodCostPct(0, null);
    expect(foodCost).toBeNull();
    assertSafeNumber(computeMoneyLostTotal({
      recordedWasteValue: 0,
      priceIncreaseImpact: 0,
      overstockValue: 0,
      shrinkageValue: 0,
    }), "money lost");
  });

  it("Scenario B — no counts: inventory and overstock are zero", () => {
    assertSafeNumber(computeInventoryLineValue(0, null), "inventory line");
    assertSafeNumber(computeOverstockValue(0, 0, null), "overstock");
    assertSafeNumber(computeReorderNeededValue(0, 0, null), "reorder");
    assertSafeNumber(computeCriticalLowStockCount([]), "critical count");

    const quality = computeDataQualityScore({
      daysSinceLastCount: null,
      missingParCount: 0,
      missingCostCount: 0,
      periodSpend: 0,
      weeklyGrossSales: null,
      pendingInvoices: 0,
      deliveryIssuesCount: 0,
      shrinkageValue: 0,
      hasApprovedSession: false,
    });
    expect(quality.score).toBeLessThan(80);
    assertSafeNumber(quality.score, "quality score");
  });

  it("Scenario C — no sales: food cost locked", () => {
    const foodCost = computeFoodCostPct(500, null);
    expect(foodCost).toBeNull();
    const withZeroSales = computeFoodCostPct(500, 0);
    expect(withZeroSales).toBeNull();
  });

  it("Scenario D — no PAR levels: overstock confidence is low", () => {
    const input = buildKpiConfidenceInput({
      snapshot: {
        ...emptyConfidenceSnapshot,
        reorderSummary: {
          totalReorderValue: 0,
          missingCostCount: 0,
          noParCount: 5,
          redCount: 0,
          yellowCount: 0,
          greenCount: 0,
        },
      },
      daysSinceLastCount: 1,
    });
    const overstock = computeOverstockConfidence(input);
    expect(overstock.level).toBe("low");

    const quality = computeDataQualityScore({
      daysSinceLastCount: 1,
      missingParCount: 5,
      missingCostCount: 0,
      periodSpend: 0,
      weeklyGrossSales: 1000,
      pendingInvoices: 0,
      deliveryIssuesCount: 0,
      shrinkageValue: 0,
      hasApprovedSession: true,
    });
    assertSafeNumber(quality.score, "quality score");
  });

  it("Scenario E — brand new location: all KPI totals zero, no NaN/Infinity", () => {
    const moneyLost = computeMoneyLostTotal({
      recordedWasteValue: 0,
      priceIncreaseImpact: 0,
      overstockValue: 0,
      shrinkageValue: 0,
    });
    assertSafeNumber(moneyLost, "money lost");
    expect(moneyLost).toBe(0);

    const input = buildKpiConfidenceInput({
      snapshot: emptyConfidenceSnapshot,
      daysSinceLastCount: null,
    });
    expect(computeInventoryValueConfidence(input).level).toBe("low");
    expect(computeMoneyLostConfidence(input).level).not.toBe("high");
  });

  it("guards against negative inventory inputs producing invalid totals", () => {
    const val = computeInventoryLineValue(-5, 10);
    assertSafeNumber(val, "negative on-hand inventory");
    const over = computeOverstockValue(-2, 4, 10);
    assertSafeNumber(over, "negative overstock");
  });
});
