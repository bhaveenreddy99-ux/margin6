import { describe, expect, it } from "vitest";
import { buildDashboardSnapshot } from "@/domain/dashboard/buildDashboardSnapshot";
import { buildLatestInventorySnapshot } from "@/domain/dashboard/dashboardSelectors";
import {
  aggregateSeedInventoryMetrics,
  computeDashboardSavingsBannerTotal,
  computeFoodCostPct,
  computeMissingDeliveryFromComparison,
  computeMoneyLostTotal,
  computePriceHikeImpact,
  computeTrustPotentialSavings,
  computeWasteValue,
} from "@/domain/dashboard/dashboardTrustFormulas";
import { EMPTY_INVENTORY_RESULT } from "@/domain/dashboard/loadInventoryMetrics";
import {
  DASHBOARD_TRUST_EXPECTED,
  DASHBOARD_TRUST_MISSING_DELIVERY,
  DASHBOARD_TRUST_PRICE_HIKE,
  DASHBOARD_TRUST_SPEND,
  DASHBOARD_TRUST_WASTE,
  seedToInventoryInputs,
  seedToSessionItemRows,
} from "@/test/fixtures/dashboardTrustSeed";

/**
 * End-to-end dashboard trust: fixed seed flows through production snapshot builders
 * and pinned totals must match every financial KPI the dashboard surfaces.
 */
describe("dashboard trust e2e (fixed seed → snapshot KPIs)", () => {
  const sessionItems = seedToSessionItemRows();
  const inventoryInputs = seedToInventoryInputs();
  const inventorySnapshot = buildLatestInventorySnapshot(sessionItems);
  const aggregated = aggregateSeedInventoryMetrics(inventoryInputs);

  const wasteValue = computeWasteValue({
    quantity: DASHBOARD_TRUST_WASTE.quantity,
    unit_cost: DASHBOARD_TRUST_WASTE.unit_cost,
    total_cost: DASHBOARD_TRUST_WASTE.total_cost,
    catalog_item_id: null,
  });

  const priceHikeImpact = computePriceHikeImpact(DASHBOARD_TRUST_PRICE_HIKE);

  const missingDeliveryValue = computeMissingDeliveryFromComparison(
    DASHBOARD_TRUST_MISSING_DELIVERY.invoiced_qty,
    DASHBOARD_TRUST_MISSING_DELIVERY.received_qty,
    DASHBOARD_TRUST_MISSING_DELIVERY.invoiced_unit_cost,
  );

  const foodCostWithoutSales = computeFoodCostPct(
    DASHBOARD_TRUST_SPEND.periodSpend,
    DASHBOARD_TRUST_SPEND.weeklyGrossSales,
  );

  const snapshot = buildDashboardSnapshot(
    {
      ...EMPTY_INVENTORY_RESULT,
      stockStatus: inventorySnapshot.stockStatus,
      topReorder: inventorySnapshot.topReorder,
      reorderSummary: inventorySnapshot.reorderSummary,
      inventoryValue: inventorySnapshot.inventoryValue,
      missingCostCount: inventorySnapshot.missingCostCount,
      overstockValue: inventorySnapshot.overstockValue,
      missingParCount: inventorySnapshot.missingParCount,
    },
    { pendingInvoices: 0 },
    {
      periodSpend: DASHBOARD_TRUST_SPEND.periodSpend,
      spendOverviewData: null,
      deliveryIssuesCount: 1,
      priceIncreaseImpact: priceHikeImpact,
    },
    {
      todayWasteEntries: [],
      recordedWasteValue: wasteValue,
      recordedWasteCount: 1,
      wasteItemsMissingCost: 0,
    },
    DASHBOARD_TRUST_SPEND.shrinkageValue,
    [],
    [],
    {
      foodCostPct: foodCostWithoutSales,
      weeklyGrossSales: DASHBOARD_TRUST_SPEND.weeklyGrossSales,
      targetPct: 30,
      status: null,
    },
  );

  it("inventory KPIs from approved session seed → value $369.40, overstock $138.90, reorder $243.00", () => {
    expect(inventorySnapshot.inventoryValue).toBe(DASHBOARD_TRUST_EXPECTED.totalInventoryValue);
    expect(inventorySnapshot.overstockValue).toBe(DASHBOARD_TRUST_EXPECTED.totalOverstock);
    expect(inventorySnapshot.reorderSummary?.totalReorderValue).toBe(
      DASHBOARD_TRUST_EXPECTED.totalReorderValue,
    );
    expect(snapshot.inventoryValue).toBe(DASHBOARD_TRUST_EXPECTED.totalInventoryValue);
    expect(snapshot.overstockValue).toBe(DASHBOARD_TRUST_EXPECTED.totalOverstock);
  });

  it("stock risk KPIs → 1 critical low (RED), matches reorderSummary.redCount", () => {
    expect(inventorySnapshot.stockStatus.red).toBe(DASHBOARD_TRUST_EXPECTED.criticalLowStockCount);
    expect(snapshot.stockStatus.red).toBe(1);
    expect(aggregated.criticalLowStockCount).toBe(1);
  });

  it("period loss KPIs → waste $30.00, price hike $1.47, shrinkage $5.00", () => {
    expect(wasteValue).toBe(DASHBOARD_TRUST_EXPECTED.wasteValue);
    expect(priceHikeImpact).toBeCloseTo(DASHBOARD_TRUST_EXPECTED.priceHikeImpact, 2);
    expect(snapshot.recordedWasteValue).toBe(DASHBOARD_TRUST_EXPECTED.wasteValue);
    expect(snapshot.priceIncreaseImpact).toBeCloseTo(DASHBOARD_TRUST_EXPECTED.priceHikeImpact, 2);
  });

  it("invoice delivery gap → missing 3 × $20 = $60.00 (comparison variance)", () => {
    expect(missingDeliveryValue).toBe(DASHBOARD_TRUST_EXPECTED.missingDeliveryValue);
  });

  it("Money Lost widget total from snapshot parts → $175.37", () => {
    expect(
      computeMoneyLostTotal({
        recordedWasteValue: snapshot.recordedWasteValue,
        priceIncreaseImpact: snapshot.priceIncreaseImpact,
        overstockValue: snapshot.overstockValue,
        shrinkageValue: snapshot.shrinkageValue,
      }),
    ).toBeCloseTo(DASHBOARD_TRUST_EXPECTED.moneyLostWidgetTotal, 2);
  });

  it("Dashboard savings banner from snapshot parts → $170.37", () => {
    expect(
      computeDashboardSavingsBannerTotal({
        overstockValue: snapshot.overstockValue,
        recordedWasteValue: snapshot.recordedWasteValue,
        priceIncreaseImpact: snapshot.priceIncreaseImpact,
      }),
    ).toBeCloseTo(DASHBOARD_TRUST_EXPECTED.savingsBannerTotal, 2);
  });

  it("trust potential savings formula → $230.37 (includes invoice-issue dollars)", () => {
    expect(
      computeTrustPotentialSavings({
        overstockValue: snapshot.overstockValue,
        wasteValue: snapshot.recordedWasteValue,
        invoiceIssuesValue: missingDeliveryValue,
        priceHikeImpact: snapshot.priceIncreaseImpact,
      }),
    ).toBeCloseTo(DASHBOARD_TRUST_EXPECTED.trustPotentialSavings, 2);
  });

  it("food cost % stays null in snapshot until weekly sales is entered", () => {
    expect(foodCostWithoutSales).toBeNull();
    expect(snapshot.foodCostPct).toBeNull();
    expect(snapshot.weeklyGrossSales).toBeNull();
    expect(snapshot.foodCostStatus).toBeNull();
  });

  it("food cost % unlocks to 30% once weekly sales $10,000 is entered", () => {
    const pct = computeFoodCostPct(
      DASHBOARD_TRUST_SPEND.periodSpend,
      DASHBOARD_TRUST_SPEND.weeklyGrossSalesEntered,
    );
    expect(pct).toBe(DASHBOARD_TRUST_EXPECTED.foodCostPctWithSales);
  });
});
