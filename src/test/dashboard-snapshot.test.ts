import { describe, expect, it } from "vitest";
import { buildDashboardSnapshot } from "@/domain/dashboard/buildDashboardSnapshot";
import { EMPTY_INVENTORY_RESULT } from "@/domain/dashboard/loadInventoryMetrics";
import { computeLineInventoryValue } from "@/domain/inventory/casePlanningEngine";
import {
  buildInventoryTrendData,
  buildLatestInventorySnapshot,
  buildTopSessionItemsByValue,
  buildProfitIntelligenceActions,
  dashboardSpendRangeFromFilter,
  invoiceBusinessDateInRange,
  isInvoiceLineComparisonProblem,
  isMissingParLevel,
  linePriceIncreaseImpact,
  sumPeriodInvoiceSpend,
} from "@/domain/dashboard/dashboardSelectors";
import type {
  DashboardInvoiceStatusRow,
  InvoiceLineComparisonRow,
  InventorySessionItemRow,
  InventoryTrendSessionRow,
} from "@/domain/dashboard/dashboardTypes";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeItem(overrides: Partial<InventorySessionItemRow> = {}): InventorySessionItemRow {
  return {
    id: "item-1",
    session_id: "session-1",
    catalog_item_id: null,
    item_name: "Tomatoes",
    current_stock: 10,
    par_level: 20,
    unit_cost: 5,
    unit: "case",
    pack_size: null,
    category: null,
    vendor_sku: null,
    product_number: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    location_id: null,
    restaurant_id: "restaurant-1",
    display_order: null,
    ...overrides,
  } as InventorySessionItemRow;
}

function makeComparisonRow(
  overrides: Partial<InvoiceLineComparisonRow> = {},
): InvoiceLineComparisonRow {
  return {
    invoice_id: "invoice-1",
    status: "ok",
    received_qty: 10,
    po_qty: 10,
    invoiced_unit_cost: 5,
    po_unit_cost: 5,
    invoiced_qty: 10,
    ...overrides,
  };
}

function makeInvoiceStatusRow(
  overrides: Partial<DashboardInvoiceStatusRow> = {},
): DashboardInvoiceStatusRow {
  return {
    id: "inv-1",
    invoice_total: 100,
    invoice_date: new Date().toISOString(),
    status: "confirmed",
    receipt_status: "confirmed",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// buildDashboardSnapshot
// ---------------------------------------------------------------------------

describe("buildDashboardSnapshot", () => {
  it("assembles all metric fields into the snapshot", () => {
    const inventory = { ...EMPTY_INVENTORY_RESULT, inventoryValue: 1500, missingCostCount: 2 };
    const invoices = { pendingInvoices: 3 };
    const spend = { periodSpend: 4200, spendOverviewData: null, deliveryIssuesCount: 1, priceIncreaseImpact: 50 };
    const waste = { todayWasteEntries: [], recordedWasteValue: 75, recordedWasteCount: 3, wasteItemsMissingCost: 0 };

    const snapshot = buildDashboardSnapshot(inventory, invoices, spend, waste);

    expect(snapshot.inventoryValue).toBe(1500);
    expect(snapshot.missingCostCount).toBe(2);
    expect(snapshot.pendingInvoices).toBe(3);
    expect(snapshot.periodSpend).toBe(4200);
    expect(snapshot.deliveryIssuesCount).toBe(1);
    expect(snapshot.priceIncreaseImpact).toBe(50);
    expect(snapshot.recordedWasteValue).toBe(75);
  });

  it("passes through empty/zero values without coercion", () => {
    const snapshot = buildDashboardSnapshot(
      EMPTY_INVENTORY_RESULT,
      { pendingInvoices: 0 },
      { periodSpend: 0, spendOverviewData: null, deliveryIssuesCount: 0, priceIncreaseImpact: 0 },
      { todayWasteEntries: [], recordedWasteValue: 0, recordedWasteCount: 0, wasteItemsMissingCost: 0 },
    );

    expect(snapshot.inventoryValue).toBe(0);
    expect(snapshot.pendingInvoices).toBe(0);
    expect(snapshot.periodSpend).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// dashboardSpendRangeFromFilter
// ---------------------------------------------------------------------------

describe("dashboardSpendRangeFromFilter", () => {
  const monday = new Date("2024-04-15T12:00:00Z"); // Monday

  it("this_week starts on Monday", () => {
    const { startDate, endDate } = dashboardSpendRangeFromFilter("this_week", monday);
    expect(new Date(startDate).getDay()).toBe(1); // Monday
    expect(new Date(endDate).getTime()).toBeGreaterThanOrEqual(new Date(startDate).getTime());
  });

  it("last_week returns the full previous week", () => {
    const { startDate, endDate } = dashboardSpendRangeFromFilter("last_week", monday);
    const start = new Date(startDate);
    const end = new Date(endDate);
    expect(start.getDay()).toBe(1); // previous Monday
    expect(end.getTime()).toBeGreaterThan(start.getTime());
    expect(end.getTime()).toBeLessThan(monday.getTime());
  });

  it("30_days spans exactly 29 days back from start of day", () => {
    const { startDate, endDate } = dashboardSpendRangeFromFilter("30_days", monday);
    const diffMs = new Date(endDate).getTime() - new Date(startDate).getTime();
    const diffDays = diffMs / (1000 * 60 * 60 * 24);
    expect(diffDays).toBeGreaterThan(28);
    expect(diffDays).toBeLessThan(31);
  });
});

// ---------------------------------------------------------------------------
// isMissingParLevel
// ---------------------------------------------------------------------------

describe("isMissingParLevel", () => {
  it("returns true for null", () => expect(isMissingParLevel(null)).toBe(true));
  it("returns true for undefined", () => expect(isMissingParLevel(undefined)).toBe(true));
  it("returns true for 0", () => expect(isMissingParLevel(0)).toBe(true));
  it("returns true for negative numbers", () => expect(isMissingParLevel(-5)).toBe(true));
  it("returns true for NaN", () => expect(isMissingParLevel(NaN)).toBe(true));
  it("returns true for non-numeric string", () => expect(isMissingParLevel("abc")).toBe(true));
  it("returns false for positive integer", () => expect(isMissingParLevel(10)).toBe(false));
  it("returns false for positive decimal", () => expect(isMissingParLevel(0.5)).toBe(false));
  it("returns false for numeric string", () => expect(isMissingParLevel("5")).toBe(false));
});

// ---------------------------------------------------------------------------
// invoiceBusinessDateInRange
// ---------------------------------------------------------------------------

describe("invoiceBusinessDateInRange", () => {
  const start = new Date("2024-04-01T00:00:00Z");
  const end = new Date("2024-04-30T23:59:59Z");

  it("returns false for null date", () => expect(invoiceBusinessDateInRange(null, start, end)).toBe(false));
  it("returns false for undefined date", () => expect(invoiceBusinessDateInRange(undefined, start, end)).toBe(false));
  it("returns false for invalid date string", () => expect(invoiceBusinessDateInRange("not-a-date", start, end)).toBe(false));
  it("returns true for date within range", () => expect(invoiceBusinessDateInRange("2024-04-15T12:00:00Z", start, end)).toBe(true));
  it("returns true for date at range boundary (start)", () => expect(invoiceBusinessDateInRange("2024-04-01T00:00:00Z", start, end)).toBe(true));
  it("returns false for date before range", () => expect(invoiceBusinessDateInRange("2024-03-31T23:59:59Z", start, end)).toBe(false));
  it("returns false for date after range", () => expect(invoiceBusinessDateInRange("2024-05-01T00:00:00Z", start, end)).toBe(false));
});

// ---------------------------------------------------------------------------
// linePriceIncreaseImpact
// ---------------------------------------------------------------------------

describe("linePriceIncreaseImpact", () => {
  it("returns positive impact when invoiced cost exceeds PO cost", () => {
    const row = makeComparisonRow({ po_unit_cost: 10, invoiced_unit_cost: 12, po_qty: 5, invoiced_qty: 5 });
    expect(linePriceIncreaseImpact(row)).toBeCloseTo(10);
  });

  it("returns 0 when invoiced cost equals PO cost", () => {
    const row = makeComparisonRow({ po_unit_cost: 10, invoiced_unit_cost: 10 });
    expect(linePriceIncreaseImpact(row)).toBe(0);
  });

  it("returns 0 when invoiced cost is less than PO cost (price decrease)", () => {
    const row = makeComparisonRow({ po_unit_cost: 12, invoiced_unit_cost: 10 });
    expect(linePriceIncreaseImpact(row)).toBe(0);
  });

  it("returns 0 when PO cost is null (cannot determine price change without baseline)", () => {
    expect(linePriceIncreaseImpact(makeComparisonRow({ po_unit_cost: null, invoiced_unit_cost: 10 }))).toBe(0);
  });

  it("returns 0 when invoiced cost is null", () => {
    expect(linePriceIncreaseImpact(makeComparisonRow({ po_unit_cost: 10, invoiced_unit_cost: null }))).toBe(0);
  });

  it("uses the smaller of invoiced vs PO qty for impact calculation", () => {
    const row = makeComparisonRow({ po_unit_cost: 10, invoiced_unit_cost: 15, po_qty: 3, invoiced_qty: 10 });
    // min(10, 3) * (15 - 10) = 15
    expect(linePriceIncreaseImpact(row)).toBeCloseTo(15);
  });
});

// ---------------------------------------------------------------------------
// isInvoiceLineComparisonProblem
// ---------------------------------------------------------------------------

describe("isInvoiceLineComparisonProblem", () => {
  it("returns true for missing_from_invoice status", () => {
    expect(isInvoiceLineComparisonProblem(makeComparisonRow({ status: "missing_from_invoice" }))).toBe(true);
  });

  it("returns true for price_mismatch status", () => {
    expect(isInvoiceLineComparisonProblem(makeComparisonRow({ status: "price_mismatch" }))).toBe(true);
  });

  it("returns false for ok status with matching quantities", () => {
    expect(isInvoiceLineComparisonProblem(makeComparisonRow({ status: "ok", received_qty: 10, po_qty: 10 }))).toBe(false);
  });

  it("returns true when received_qty < po_qty regardless of status", () => {
    expect(isInvoiceLineComparisonProblem(makeComparisonRow({ status: "ok", received_qty: 5, po_qty: 10 }))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// buildProfitIntelligenceActions
// ---------------------------------------------------------------------------

describe("buildProfitIntelligenceActions", () => {
  it("returns empty array when all metrics are zero", () => {
    const actions = buildProfitIntelligenceActions({
      reorderSummary: { redCount: 0, yellowCount: 0, greenCount: 0, totalWasteValue: 0, totalReorderValue: 0, totalSuggestedUnits: 0, noParCount: 0, missingCostCount: 0 },
      deliveryIssuesCount: 0,
      priceIncreaseImpact: 0,
      missingParCount: 0,
    });
    expect(actions).toHaveLength(0);
  });

  it("returns CRITICAL action for red items", () => {
    const actions = buildProfitIntelligenceActions({
      reorderSummary: { redCount: 3, yellowCount: 0, greenCount: 0, totalWasteValue: 0, totalReorderValue: 0, totalSuggestedUnits: 0, noParCount: 0, missingCostCount: 0 },
      deliveryIssuesCount: 0,
      priceIncreaseImpact: 0,
      missingParCount: 0,
    });
    expect(actions[0].type).toBe("CRITICAL");
    expect(actions[0].message).toContain("3 items");
  });

  it("uses singular for 1 red item", () => {
    const actions = buildProfitIntelligenceActions({
      reorderSummary: { redCount: 1, yellowCount: 0, greenCount: 0, totalWasteValue: 0, totalReorderValue: 0, totalSuggestedUnits: 0, noParCount: 0, missingCostCount: 0 },
      deliveryIssuesCount: 0,
      priceIncreaseImpact: 0,
      missingParCount: 0,
    });
    expect(actions[0].message).toContain("1 item ");
  });

  it("sorts CRITICAL before WARNING before INFO", () => {
    const actions = buildProfitIntelligenceActions({
      reorderSummary: { redCount: 1, yellowCount: 0, greenCount: 0, totalWasteValue: 500, totalReorderValue: 200, totalSuggestedUnits: 10, noParCount: 0, missingCostCount: 0 },
      deliveryIssuesCount: 2,
      priceIncreaseImpact: 100,
      missingParCount: 3,
    });
    const types = actions.map((a) => a.type);
    const criticalIdx = types.indexOf("CRITICAL");
    const warningIdx = types.indexOf("WARNING");
    const infoIdx = types.lastIndexOf("INFO");
    expect(criticalIdx).toBeLessThan(warningIdx);
    expect(warningIdx).toBeLessThan(infoIdx);
  });

  it("caps output at 6 actions", () => {
    const actions = buildProfitIntelligenceActions({
      reorderSummary: { redCount: 5, yellowCount: 0, greenCount: 0, totalWasteValue: 500, totalReorderValue: 200, totalSuggestedUnits: 5, noParCount: 0, missingCostCount: 0 },
      deliveryIssuesCount: 5,
      priceIncreaseImpact: 500,
      missingParCount: 10,
    });
    expect(actions.length).toBeLessThanOrEqual(6);
  });

  it("returns null reorderSummary without throwing", () => {
    expect(() =>
      buildProfitIntelligenceActions({
        reorderSummary: null,
        deliveryIssuesCount: 1,
        priceIncreaseImpact: 0,
        missingParCount: 0,
      }),
    ).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// sumPeriodInvoiceSpend
// ---------------------------------------------------------------------------

describe("sumPeriodInvoiceSpend", () => {
  const rangeStart = new Date("2024-04-01T00:00:00Z");
  const rangeEnd = new Date("2024-04-30T23:59:59Z");

  it("sums posted invoices within the date range", () => {
    const rows = [
      makeInvoiceStatusRow({ id: "a", invoice_total: 200, invoice_date: "2024-04-10T00:00:00Z", status: "confirmed" }),
      makeInvoiceStatusRow({ id: "b", invoice_total: 300, invoice_date: "2024-04-20T00:00:00Z", status: "COMPLETE" }),
    ];
    const { periodSpend } = sumPeriodInvoiceSpend(rows, rangeStart, rangeEnd);
    expect(periodSpend).toBe(500);
  });

  it("excludes invoices outside the date range", () => {
    const rows = [
      makeInvoiceStatusRow({ invoice_total: 500, invoice_date: "2024-03-15T00:00:00Z", status: "confirmed" }),
    ];
    const { periodSpend } = sumPeriodInvoiceSpend(rows, rangeStart, rangeEnd);
    expect(periodSpend).toBe(0);
  });

  it("excludes non-posted invoices", () => {
    const rows = [
      makeInvoiceStatusRow({ invoice_total: 500, invoice_date: "2024-04-10T00:00:00Z", status: "draft" }),
    ];
    const { periodSpend } = sumPeriodInvoiceSpend(rows, rangeStart, rangeEnd);
    expect(periodSpend).toBe(0);
  });

  it("collects invoice IDs with issues_reported receipt status", () => {
    const rows = [
      makeInvoiceStatusRow({ id: "x", invoice_date: "2024-04-10T00:00:00Z", status: "confirmed", receipt_status: "issues_reported" }),
    ];
    const { issueInvoiceIds } = sumPeriodInvoiceSpend(rows, rangeStart, rangeEnd);
    expect(issueInvoiceIds.has("x")).toBe(true);
  });

  it("returns zero spend for empty rows", () => {
    const { periodSpend, issueInvoiceIds } = sumPeriodInvoiceSpend([], rangeStart, rangeEnd);
    expect(periodSpend).toBe(0);
    expect(issueInvoiceIds.size).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// buildLatestInventorySnapshot
// ---------------------------------------------------------------------------

describe("buildLatestInventorySnapshot", () => {
  it("computes inventoryValue as stock * cost", () => {
    const items = [makeItem({ current_stock: 5, unit_cost: 10 })];
    const { inventoryValue } = buildLatestInventorySnapshot(items);
    expect(inventoryValue).toBe(50);
  });

  it("treats unit_cost = 0 as valid (zero cost, not missing)", () => {
    const items = [makeItem({ current_stock: 5, unit_cost: 0 })];
    const { inventoryValue, missingCostCount } = buildLatestInventorySnapshot(items);
    expect(inventoryValue).toBe(0);
    expect(missingCostCount).toBe(0);
  });

  it("counts items with null unit_cost as missingCostCount", () => {
    const items = [
      makeItem({ unit_cost: 5 }),
      makeItem({ id: "item-2", unit_cost: null }),
    ];
    const { missingCostCount } = buildLatestInventorySnapshot(items);
    expect(missingCostCount).toBe(1);
  });

  it("counts items with par_level <= 0 as missingParCount", () => {
    const items = [
      makeItem({ par_level: 10 }),
      makeItem({ id: "item-2", par_level: 0 }),
      makeItem({ id: "item-3", par_level: null }),
    ];
    const { missingParCount } = buildLatestInventorySnapshot(items);
    expect(missingParCount).toBe(2);
  });

  it("returns zero values for empty item list", () => {
    const snapshot = buildLatestInventorySnapshot([]);
    expect(snapshot.inventoryValue).toBe(0);
    expect(snapshot.missingCostCount).toBe(0);
    expect(snapshot.topReorder).toHaveLength(0);
  });

  it("inventoryValue matches summed computeLineInventoryValue over all lines (Dashboard/Reports)", () => {
    const items = [
      makeItem({ current_stock: 3, unit_cost: 10, par_level: 5 }),
      makeItem({ id: "b", item_name: "B", current_stock: 1, unit_cost: null, par_level: 2 }),
    ];
    const { inventoryValue } = buildLatestInventorySnapshot(items);
    const manual = items.reduce(
      (sum, item) =>
        sum +
        computeLineInventoryValue({
          currentStockCases: item.current_stock,
          parLevelCases: item.par_level,
          unitCostPerCase: item.unit_cost,
        }).dollars,
      0,
    );
    expect(inventoryValue).toBe(manual);
  });
});

describe("buildTopSessionItemsByValue", () => {
  it("ranks priced lines by dollar stock value descending", () => {
    const items = [
      makeItem({ item_name: "Low", current_stock: 1, unit_cost: 5 }),
      makeItem({ id: "h", item_name: "High", current_stock: 10, unit_cost: 10 }),
    ];
    const top = buildTopSessionItemsByValue(items);
    expect(top[0].item_name).toBe("High");
    expect(top[0].total_value).toBe(100);
    expect(top[1].item_name).toBe("Low");
  });

  it("omits lines without truthy unit_cost (aligned with Reports top-items list)", () => {
    const items = [
      makeItem({ item_name: "No cost", unit_cost: null }),
      makeItem({ id: "z", item_name: "Zero cost", unit_cost: 0 }),
      makeItem({ id: "p", item_name: "Priced", current_stock: 2, unit_cost: 5 }),
    ];
    const top = buildTopSessionItemsByValue(items);
    expect(top).toHaveLength(1);
    expect(top[0].item_name).toBe("Priced");
  });
});

// ---------------------------------------------------------------------------
// buildInventoryTrendData
// ---------------------------------------------------------------------------

describe("buildInventoryTrendData", () => {
  it("returns trend points in chronological order (oldest first)", () => {
    const sessions: InventoryTrendSessionRow[] = [
      { id: "s3", approved_at: "2024-04-03T12:00:00Z" },
      { id: "s2", approved_at: "2024-04-02T12:00:00Z" },
      { id: "s1", approved_at: "2024-04-01T12:00:00Z" },
    ];
    const linesBySession = new Map([
      ["s1", [{ current_stock: 10, unit_cost: 5 }]],
      ["s2", [{ current_stock: 8, unit_cost: 5 }]],
      ["s3", [{ current_stock: 12, unit_cost: 5 }]],
    ]);
    const points = buildInventoryTrendData(sessions, linesBySession);
    expect(points[0].label).toMatch(/Apr 1/);
    expect(points[1].label).toMatch(/Apr 2/);
    expect(points[2].label).toMatch(/Apr 3/);
  });

  it("computes session value as sum of stock * cost", () => {
    const sessions: InventoryTrendSessionRow[] = [{ id: "s1", approved_at: "2024-04-01T00:00:00Z" }];
    const lines = new Map([["s1", [{ current_stock: 10, unit_cost: 5 }, { current_stock: 2, unit_cost: 3 }]]]);
    const points = buildInventoryTrendData(sessions, lines);
    expect(points[0].value).toBe(56); // 10*5 + 2*3
  });

  it("uses ? label for sessions with no approved_at", () => {
    const sessions: InventoryTrendSessionRow[] = [{ id: "s1", approved_at: null }];
    const points = buildInventoryTrendData(sessions, new Map());
    expect(points[0].label).toBe("?");
  });
});
