import { describe, expect, it } from "vitest";
import {
  buildMoneyLeakSnapshot,
  moneyLeakSnapshotFromParts,
} from "@/domain/reports/buildMoneyLeakSnapshot";

describe("moneyLeakSnapshotFromParts", () => {
  const period = { start: "2026-01-01T00:00:00.000Z", end: "2026-01-07T23:59:59.999Z" };

  it("realLoss.total = waste + price increase; riskExposure.total = overstock + reorder", () => {
    const snap = moneyLeakSnapshotFromParts({
      period,
      locationId: "loc-1",
      inventory: {
        overstockValue: 100.5,
        reorderSummary: {
          totalReorderValue: 40,
          totalSuggestedUnits: 3,
          totalWasteValue: 100.5,
          redCount: 0,
          yellowCount: 0,
          greenCount: 0,
          noParCount: 0,
          missingCostCount: 2,
        },
        missingCostCount: 2,
        lastSessionApprovedAtIso: "2026-01-05T12:00:00.000Z",
      },
      waste: { recordedWasteValue: 25.25, wasteItemsMissingCost: 1 },
      spend: { priceIncreaseImpact: 10.1 },
      invoiceProblemLineCount: 4,
    });

    expect(snap.realLoss.wasteDollars).toBe(25.25);
    expect(snap.realLoss.priceIncreaseDollars).toBe(10.1);
    expect(snap.realLoss.total).toBeCloseTo(35.35, 5);

    expect(snap.riskExposure.overstockDollars).toBe(100.5);
    expect(snap.riskExposure.reorderGapDollars).toBe(40);
    expect(snap.riskExposure.total).toBe(140.5);

    expect(snap.dataIssues.wasteMissingCostCount).toBe(1);
    expect(snap.dataIssues.invoiceProblemLineCount).toBe(4);
    expect(snap.dataIssues.missingCostItems).toBe(2);
    expect(snap.metadata.lastApprovedSessionAt).toBe("2026-01-05T12:00:00.000Z");
    expect(snap.period).toEqual(period);
    expect(snap.locationId).toBe("loc-1");
  });

  it("null reorderSummary → reorderGapDollars 0", () => {
    const snap = moneyLeakSnapshotFromParts({
      period,
      inventory: {
        overstockValue: 0,
        reorderSummary: null,
        missingCostCount: 0,
        lastSessionApprovedAtIso: null,
      },
      waste: { recordedWasteValue: 0, wasteItemsMissingCost: 0 },
      spend: { priceIncreaseImpact: 0 },
      invoiceProblemLineCount: 0,
    });
    expect(snap.riskExposure.reorderGapDollars).toBe(0);
    expect(snap.riskExposure.total).toBe(0);
  });

  it("zero unit-cost style: missingCostItems can be 0 while exposure uses engine totals", () => {
    const snap = moneyLeakSnapshotFromParts({
      period,
      inventory: {
        overstockValue: 0,
        reorderSummary: {
          totalReorderValue: 0,
          totalSuggestedUnits: 0,
          totalWasteValue: 0,
          redCount: 1,
          yellowCount: 0,
          greenCount: 0,
          noParCount: 0,
          missingCostCount: 0,
        },
        missingCostCount: 0,
        lastSessionApprovedAtIso: "2026-01-01T00:00:00.000Z",
      },
      waste: { recordedWasteValue: 0, wasteItemsMissingCost: 0 },
      spend: { priceIncreaseImpact: 0 },
      invoiceProblemLineCount: 0,
    });
    expect(snap.dataIssues.missingCostItems).toBe(0);
    expect(snap.realLoss.total).toBe(0);
  });

  it("empty / zero dataset: all totals zero, notes still present", () => {
    const snap = moneyLeakSnapshotFromParts({
      period,
      inventory: {
        overstockValue: 0,
        reorderSummary: null,
        missingCostCount: 0,
        lastSessionApprovedAtIso: null,
      },
      waste: { recordedWasteValue: 0, wasteItemsMissingCost: 0 },
      spend: { priceIncreaseImpact: 0 },
      invoiceProblemLineCount: 0,
    });
    expect(snap.realLoss.total).toBe(0);
    expect(snap.riskExposure.total).toBe(0);
    expect(snap.dataIssues.wasteMissingCostCount).toBe(0);
    expect(snap.metadata.notes.length).toBeGreaterThan(0);
  });

  it("appends extraNotes", () => {
    const snap = moneyLeakSnapshotFromParts({
      period,
      inventory: {
        overstockValue: 0,
        reorderSummary: null,
        missingCostCount: 0,
        lastSessionApprovedAtIso: null,
      },
      waste: { recordedWasteValue: 0, wasteItemsMissingCost: 0 },
      spend: { priceIncreaseImpact: 0 },
      invoiceProblemLineCount: 0,
      extraNotes: ["Pilot note"],
    });
    expect(snap.metadata.notes.some((n) => n === "Pilot note")).toBe(true);
  });
});

describe("realLossPercentOfRevenue", () => {
  const period = { start: "2026-01-01T00:00:00.000Z", end: "2026-01-07T23:59:59.999Z" };
  const baseInventory = {
    overstockValue: 0,
    reorderSummary: null,
    missingCostCount: 0,
    lastSessionApprovedAtIso: null,
  };

  it("computes loss ratio when gross sales > 0", () => {
    // wasteDollars + priceIncreaseDollars = 200 + 142 = 342
    // grossSalesForWeek = 10000 → 342 / 10000 = 0.0342
    const snap = moneyLeakSnapshotFromParts({
      period,
      inventory: baseInventory,
      waste: { recordedWasteValue: 200, wasteItemsMissingCost: 0 },
      spend: { priceIncreaseImpact: 142 },
      invoiceProblemLineCount: 0,
      grossSalesForWeek: 10000,
    });
    expect(snap.realLoss.total).toBe(342);
    expect(snap.realLossPercentOfRevenue).toBeCloseTo(0.0342, 4);
  });

  it("returns null when grossSalesForWeek is null", () => {
    const snap = moneyLeakSnapshotFromParts({
      period,
      inventory: baseInventory,
      waste: { recordedWasteValue: 200, wasteItemsMissingCost: 0 },
      spend: { priceIncreaseImpact: 142 },
      invoiceProblemLineCount: 0,
      grossSalesForWeek: null,
    });
    expect(snap.realLossPercentOfRevenue).toBeNull();
  });

  it("returns null when grossSalesForWeek is 0 to avoid div-by-zero", () => {
    const snap = moneyLeakSnapshotFromParts({
      period,
      inventory: baseInventory,
      waste: { recordedWasteValue: 200, wasteItemsMissingCost: 0 },
      spend: { priceIncreaseImpact: 142 },
      invoiceProblemLineCount: 0,
      grossSalesForWeek: 0,
    });
    expect(snap.realLossPercentOfRevenue).toBeNull();
  });
});

describe("buildMoneyLeakSnapshot (integration smoke)", () => {
  it("runs without throwing when restaurant has no data (invalid id)", async () => {
    const snap = await buildMoneyLeakSnapshot({
      restaurantId: "00000000-0000-0000-0000-000000000000",
      timeFilter: "30_days",
    });
    expect(snap.period.start).toBeDefined();
    expect(snap.period.end).toBeDefined();
    expect(typeof snap.realLoss.total).toBe("number");
    expect(typeof snap.riskExposure.total).toBe("number");
    expect(Number.isFinite(snap.realLoss.total)).toBe(true);
    expect(Number.isFinite(snap.riskExposure.total)).toBe(true);
  });
});
