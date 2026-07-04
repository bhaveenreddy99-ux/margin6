import { describe, expect, it } from "vitest";
import { computeDataQualityScore, dataQualityBandLabel } from "@/domain/dataQuality";
import {
  computeInventoryValueConfidence,
  computeOverstockConfidence,
} from "@/domain/dataQuality/computeKpiConfidence";

describe("computeDataQualityScore", () => {
  it("returns excellent when count is fresh and complete", () => {
    const result = computeDataQualityScore({
      daysSinceLastCount: 1,
      missingParCount: 0,
      missingCostCount: 0,
      periodSpend: 100,
      weeklyGrossSales: 5000,
      pendingInvoices: 0,
      deliveryIssuesCount: 0,
      shrinkageValue: 0,
      hasApprovedSession: true,
    });
    expect(result.score).toBeGreaterThanOrEqual(95);
    expect(result.band).toBe("excellent");
    expect(dataQualityBandLabel(result.band)).toBe("Excellent");
  });

  it("deducts for stale count and missing PAR", () => {
    const result = computeDataQualityScore({
      daysSinceLastCount: 10,
      missingParCount: 3,
      missingCostCount: 2,
      periodSpend: 0,
      weeklyGrossSales: null,
      pendingInvoices: 2,
      deliveryIssuesCount: 1,
      shrinkageValue: 50,
      hasApprovedSession: true,
    });
    expect(result.score).toBeLessThan(80);
    expect(result.issues.length).toBeGreaterThan(0);
  });

  it("scores zero floor with no approved session", () => {
    const result = computeDataQualityScore({
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
    expect(result.score).toBe(75);
    expect(result.band).toBe("medium");
  });
});

describe("computeKpiConfidence", () => {
  it("inventory confidence is high with fresh count and full costs", () => {
    const result = computeInventoryValueConfidence({
      daysSinceLastCount: 2,
      missingParCount: 0,
      missingCostCount: 0,
      periodSpend: 0,
      weeklyGrossSales: 1000,
      pendingInvoices: 0,
      deliveryIssuesCount: 0,
      shrinkageValue: 0,
      hasApprovedSession: true,
      overstockValue: 0,
      inventoryValue: 1000,
      recordedWasteValue: 0,
      priceIncreaseImpact: 0,
      wasteItemsMissingCost: 0,
      reorderSummary: {
        totalReorderValue: 0,
        missingCostCount: 0,
        noParCount: 0,
        redCount: 1,
        yellowCount: 2,
        greenCount: 3,
      },
      foodCostPct: 30,
    });
    expect(result.level).toBe("high");
  });

  it("overstock confidence is low when all items lack PAR", () => {
    const result = computeOverstockConfidence({
      daysSinceLastCount: 1,
      missingParCount: 5,
      missingCostCount: 0,
      periodSpend: 0,
      weeklyGrossSales: null,
      pendingInvoices: 0,
      deliveryIssuesCount: 0,
      shrinkageValue: 0,
      hasApprovedSession: true,
      overstockValue: 0,
      inventoryValue: 500,
      recordedWasteValue: 0,
      priceIncreaseImpact: 0,
      wasteItemsMissingCost: 0,
      reorderSummary: {
        totalReorderValue: 0,
        missingCostCount: 0,
        noParCount: 5,
        redCount: 0,
        yellowCount: 0,
        greenCount: 0,
      },
      foodCostPct: null,
    });
    expect(result.level).toBe("low");
  });
});
