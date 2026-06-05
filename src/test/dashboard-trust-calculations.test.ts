import { describe, expect, it } from "vitest";
import {
  aggregateSeedInventoryMetrics,
  computeCriticalLowStockCount,
  computeDashboardSavingsBannerTotal,
  computeFoodCostPct,
  computeInventoryLineValue,
  computeMissingDeliveryFromComparison,
  computeMissingDeliveryValue,
  computeMoneyLostTotal,
  computeOverstockValue,
  computePriceHikeImpact,
  computePriceHikePct,
  computeReorderNeededValue,
  computeSmartOrderQty,
  computeTrustPotentialSavings,
  computeWasteValue,
} from "@/domain/dashboard/dashboardTrustFormulas";
import {
  DASHBOARD_TRUST_EXPECTED,
  DASHBOARD_TRUST_MISSING_DELIVERY,
  DASHBOARD_TRUST_PRICE_HIKE,
  DASHBOARD_TRUST_SEED_ITEMS,
  DASHBOARD_TRUST_SPEND,
  DASHBOARD_TRUST_WASTE,
  seedToInventoryInputs,
} from "@/test/fixtures/dashboardTrustSeed";

describe("dashboard trust calculations (fixed seed)", () => {
  const inputs = seedToInventoryInputs();

  it("1. overstock value = max(on_hand − par, 0) × unit_cost → Tomatoes $36.00", () => {
    const tomatoes = DASHBOARD_TRUST_SEED_ITEMS[0]!;
    expect(computeOverstockValue(tomatoes.current_stock, tomatoes.par_level, tomatoes.unit_cost)).toBe(
      DASHBOARD_TRUST_EXPECTED.overstockTomatoes,
    );
  });

  it("1. overstock value = max(on_hand − par, 0) × unit_cost → Container Plastic $102.90", () => {
    const container = DASHBOARD_TRUST_SEED_ITEMS[3]!;
    expect(computeOverstockValue(container.current_stock, container.par_level, container.unit_cost)).toBe(
      DASHBOARD_TRUST_EXPECTED.overstockContainerPlastic,
    );
  });

  it("1. total overstock across seed session → $138.90", () => {
    expect(aggregateSeedInventoryMetrics(inputs).overstockValue).toBe(
      DASHBOARD_TRUST_EXPECTED.totalOverstock,
    );
  });

  it("2. smart order qty = max(par − on_hand, 0) rounded up → Chicken 9 cases", () => {
    const chicken = DASHBOARD_TRUST_SEED_ITEMS[1]!;
    expect(computeSmartOrderQty(chicken.current_stock, chicken.par_level)).toBe(
      DASHBOARD_TRUST_EXPECTED.smartOrderChicken,
    );
  });

  it("2. smart order qty = max(par − on_hand, 0) rounded up → Fryer Oil 1 case", () => {
    const oil = DASHBOARD_TRUST_SEED_ITEMS[2]!;
    expect(computeSmartOrderQty(oil.current_stock, oil.par_level)).toBe(
      DASHBOARD_TRUST_EXPECTED.smartOrderOil,
    );
  });

  it("2. smart order qty at PAR → Tomatoes 0 cases", () => {
    const tomatoes = DASHBOARD_TRUST_SEED_ITEMS[0]!;
    expect(computeSmartOrderQty(tomatoes.current_stock, tomatoes.par_level)).toBe(0);
  });

  it("3. inventory value = Σ(on_hand × unit_cost) → seed total $369.40", () => {
    const manual = DASHBOARD_TRUST_SEED_ITEMS.reduce(
      (sum, item) => sum + computeInventoryLineValue(item.current_stock, item.unit_cost),
      0,
    );
    expect(manual).toBe(DASHBOARD_TRUST_EXPECTED.totalInventoryValue);
    expect(aggregateSeedInventoryMetrics(inputs).inventoryValue).toBe(
      DASHBOARD_TRUST_EXPECTED.totalInventoryValue,
    );
  });

  it("4. reorder needed value = order_qty × unit_cost → Chicken $225.00", () => {
    const chicken = DASHBOARD_TRUST_SEED_ITEMS[1]!;
    expect(
      computeReorderNeededValue(chicken.current_stock, chicken.par_level, chicken.unit_cost),
    ).toBe(DASHBOARD_TRUST_EXPECTED.reorderValueChicken);
  });

  it("4. reorder needed value = order_qty × unit_cost → Fryer Oil $18.00", () => {
    const oil = DASHBOARD_TRUST_SEED_ITEMS[2]!;
    expect(computeReorderNeededValue(oil.current_stock, oil.par_level, oil.unit_cost)).toBe(
      DASHBOARD_TRUST_EXPECTED.reorderValueOil,
    );
  });

  it("4. total reorder needed value across seed → $243.00", () => {
    expect(aggregateSeedInventoryMetrics(inputs).totalReorderValue).toBe(
      DASHBOARD_TRUST_EXPECTED.totalReorderValue,
    );
  });

  it("5. critical low stock count (RED risk) → 1 item (Chicken Breast)", () => {
    expect(computeCriticalLowStockCount(inputs)).toBe(DASHBOARD_TRUST_EXPECTED.criticalLowStockCount);
    expect(aggregateSeedInventoryMetrics(inputs).criticalLowStockCount).toBe(1);
  });

  it("6. price hike % = (new_cost − old_cost) / old_cost × 100 → 14.7%", () => {
    expect(
      computePriceHikePct(DASHBOARD_TRUST_PRICE_HIKE.old_cost, DASHBOARD_TRUST_PRICE_HIKE.new_cost),
    ).toBeCloseTo(DASHBOARD_TRUST_EXPECTED.priceHikePct, 1);
  });

  it("6. price hike dollar impact → $1.47 per unit", () => {
    expect(computePriceHikeImpact(DASHBOARD_TRUST_PRICE_HIKE)).toBeCloseTo(
      DASHBOARD_TRUST_EXPECTED.priceHikeImpact,
      2,
    );
  });

  it("7. waste value = waste_qty × unit_cost → $30.00", () => {
    expect(
      computeWasteValue({
        quantity: DASHBOARD_TRUST_WASTE.quantity,
        unit_cost: DASHBOARD_TRUST_WASTE.unit_cost,
        total_cost: DASHBOARD_TRUST_WASTE.total_cost,
        catalog_item_id: null,
      }),
    ).toBe(DASHBOARD_TRUST_EXPECTED.wasteValue);
  });

  it("8. missing delivery value = missing_qty × invoice_unit_cost → $60.00", () => {
    expect(
      computeMissingDeliveryValue(
        DASHBOARD_TRUST_MISSING_DELIVERY.missing_qty,
        DASHBOARD_TRUST_MISSING_DELIVERY.invoiced_unit_cost,
      ),
    ).toBe(DASHBOARD_TRUST_EXPECTED.missingDeliveryValue);
  });

  it("8. missing delivery matches invoice comparison variance (10 invoiced − 7 received) × $20", () => {
    expect(
      computeMissingDeliveryFromComparison(
        DASHBOARD_TRUST_MISSING_DELIVERY.invoiced_qty,
        DASHBOARD_TRUST_MISSING_DELIVERY.received_qty,
        DASHBOARD_TRUST_MISSING_DELIVERY.invoiced_unit_cost,
      ),
    ).toBe(DASHBOARD_TRUST_EXPECTED.missingDeliveryValue);
  });

  it("9. trust potential savings = overstock + waste + invoice issues + price hikes → $230.37", () => {
    expect(
      computeTrustPotentialSavings({
        overstockValue: DASHBOARD_TRUST_EXPECTED.totalOverstock,
        wasteValue: DASHBOARD_TRUST_EXPECTED.wasteValue,
        invoiceIssuesValue: DASHBOARD_TRUST_EXPECTED.missingDeliveryValue,
        priceHikeImpact: DASHBOARD_TRUST_EXPECTED.priceHikeImpact,
      }),
    ).toBeCloseTo(DASHBOARD_TRUST_EXPECTED.trustPotentialSavings, 2);
  });

  it("9. Money Lost widget total = waste + price hikes + overstock + shrinkage → $175.37", () => {
    expect(
      computeMoneyLostTotal({
        recordedWasteValue: DASHBOARD_TRUST_EXPECTED.wasteValue,
        priceIncreaseImpact: DASHBOARD_TRUST_EXPECTED.priceHikeImpact,
        overstockValue: DASHBOARD_TRUST_EXPECTED.totalOverstock,
        shrinkageValue: DASHBOARD_TRUST_SPEND.shrinkageValue,
      }),
    ).toBeCloseTo(DASHBOARD_TRUST_EXPECTED.moneyLostWidgetTotal, 2);
  });

  it("9. Dashboard savings banner = overstock + waste + price hikes → $170.37", () => {
    expect(
      computeDashboardSavingsBannerTotal({
        overstockValue: DASHBOARD_TRUST_EXPECTED.totalOverstock,
        recordedWasteValue: DASHBOARD_TRUST_EXPECTED.wasteValue,
        priceIncreaseImpact: DASHBOARD_TRUST_EXPECTED.priceHikeImpact,
      }),
    ).toBeCloseTo(DASHBOARD_TRUST_EXPECTED.savingsBannerTotal, 2);
  });

  it("10. food cost % locked (null) until weekly sales entered — spend $3000, no sales", () => {
    expect(
      computeFoodCostPct(
        DASHBOARD_TRUST_SPEND.periodSpend,
        DASHBOARD_TRUST_SPEND.weeklyGrossSales,
      ),
    ).toBe(DASHBOARD_TRUST_EXPECTED.foodCostPctWithoutSales);
  });

  it("10. food cost % = periodSpend / weekly_sales × 100 → 30% when sales $10,000", () => {
    expect(
      computeFoodCostPct(
        DASHBOARD_TRUST_SPEND.periodSpend,
        DASHBOARD_TRUST_SPEND.weeklyGrossSalesEntered,
      ),
    ).toBe(DASHBOARD_TRUST_EXPECTED.foodCostPctWithSales);
  });
});
