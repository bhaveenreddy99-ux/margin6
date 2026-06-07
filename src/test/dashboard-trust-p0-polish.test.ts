import { describe, expect, it } from "vitest";
import {
  buildLatestInventorySnapshot,
  buildSessionOverstockLines,
  formatStockRiskBandCopy,
} from "@/domain/dashboard/dashboardSelectors";
import { computeMoneyLostTotal } from "@/domain/dashboard/dashboardTrustFormulas";
import {
  PROFIT_RISK_HERO_TITLE,
  PROFIT_RISK_ROW_OVERSTOCK,
  PROFIT_RISK_ROW_WASTE,
} from "@/domain/dashboard/profitRiskLabels";
import { riskThresholdsFromSettings } from "@/domain/inventory/riskThresholds";
import { aggregateWasteRows } from "@/domain/waste/wasteMetricsAggregate";
import { buildWasteDrilldownRows } from "@/domain/waste/wasteDrilldownRows";
import { DASHBOARD_TRUST_SEED_ITEMS } from "@/test/fixtures/dashboardTrustSeed";
import type { InventorySessionItemRow } from "@/domain/dashboard/dashboardTypes";

function seedToSessionRows(): InventorySessionItemRow[] {
  return DASHBOARD_TRUST_SEED_ITEMS.map((item, index) => ({
    id: `seed-${index}`,
    session_id: "seed-session",
    item_name: item.item_name,
    current_stock: item.current_stock,
    par_level: item.par_level,
    unit_cost: item.unit_cost,
    unit: item.unit ?? "case",
    pack_size: item.pack_size ?? null,
    catalog_item_id: item.catalog_item_id ?? null,
    parent_catalog_item_id: null,
    zone_id: null,
  }));
}

describe("P0 trust polish — labels", () => {
  it("uses owner-trust hero title (not Money Lost)", () => {
    expect(PROFIT_RISK_HERO_TITLE).toBe("Profit Risk Identified");
    expect(PROFIT_RISK_HERO_TITLE.toLowerCase()).not.toContain("money lost");
  });

  it("overstock row label describes exposure not loss", () => {
    expect(PROFIT_RISK_ROW_OVERSTOCK).toBe("Cash tied up above PAR");
    expect(PROFIT_RISK_ROW_WASTE).toBe("Recorded waste");
  });
});

describe("P0 trust polish — dynamic PAR threshold copy", () => {
  it("formats bands from smart_order_settings thresholds", () => {
    const copy = formatStockRiskBandCopy(
      riskThresholdsFromSettings({ red_threshold: 40, yellow_threshold: 90 }),
    );
    expect(copy.critical).toBe("Below 40% of PAR level");
    expect(copy.low).toBe("Between 40–90% of PAR");
    expect(copy.ok).toBe("At or above 90% of PAR");
  });

  it("defaults match Settings UI when settings row is null", () => {
    const copy = formatStockRiskBandCopy(riskThresholdsFromSettings(null));
    expect(copy.critical).toBe("Below 50% of PAR level");
    expect(copy.low).toBe("Between 50–100% of PAR");
  });
});

describe("P0 trust polish — overstock formula parity", () => {
  it("buildSessionOverstockLines total matches dashboard snapshot overstockValue", () => {
    const rows = seedToSessionRows();
    const snapshot = buildLatestInventorySnapshot(rows);
    const lines = buildSessionOverstockLines(rows);
    const lineSum = lines.reduce((s, l) => s + l.dollars, 0);
    expect(lineSum).toBe(snapshot.overstockValue);
    expect(lineSum).toBe(snapshot.reorderSummary?.totalWasteValue ?? 0);
  });

  it("OverstockCashTrapCard line sum would match hero overstock prop", () => {
    const lines = buildSessionOverstockLines(seedToSessionRows());
    const heroOverstock = buildLatestInventorySnapshot(seedToSessionRows()).overstockValue;
    expect(lines.reduce((s, l) => s + l.dollars, 0)).toBe(heroOverstock);
  });
});

describe("P0 trust polish — waste formula parity", () => {
  it("buildWasteDrilldownRows sum matches aggregateWasteRows for waste rows", () => {
    const wasteRows = [
      {
        item_name: "Tomatoes",
        quantity: 2,
        quantity_unit: "case" as const,
        total_cost: 24,
        unit_cost: 12,
        catalog_item_id: null,
        reason: "spoilage",
        logged_at: "2026-01-15T12:00:00Z",
      },
    ];
    const catalogMap = new Map<string, number>();
    const sessionMap = new Map(
      Object.entries(
        buildLatestInventorySnapshot(seedToSessionRows()).latestSessionUnitCostByCatalogId,
      ),
    );
    const drilldown = buildWasteDrilldownRows(wasteRows, catalogMap, sessionMap, () => "Jan 15");
    const { totalDollars } = aggregateWasteRows(wasteRows, catalogMap, sessionMap);
    const drillSum = drilldown.reduce((s, r) => s + r.value, 0);
    expect(drillSum).toBe(totalDollars);
    expect(drillSum).toBe(24);
  });
});

describe("P0 trust polish — profit risk total formula", () => {
  it("computeMoneyLostTotal unchanged after label polish", () => {
    const total = computeMoneyLostTotal({
      recordedWasteValue: 10,
      priceIncreaseImpact: 5,
      overstockValue: 20,
      shrinkageValue: 3,
    });
    expect(total).toBe(38);
  });
});
