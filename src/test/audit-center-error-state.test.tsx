import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// T0-4: the Audit Center must NEVER render $0 / confidence badges / a data-quality
// score when its data failed to load. These tests prove the error state and that
// stale/zero KPI values never leak through an error.

const { useDashboardDataMock, useRestaurantMock, useLocationPermissionsMock } = vi.hoisted(() => ({
  useDashboardDataMock: vi.fn(),
  useRestaurantMock: vi.fn(),
  useLocationPermissionsMock: vi.fn(),
}));

vi.mock("@/hooks/useDashboardData", () => ({ useDashboardData: useDashboardDataMock }));
vi.mock("@/contexts/RestaurantContext", () => ({ useRestaurant: useRestaurantMock }));
vi.mock("@/hooks/useLocationPermissions", () => ({ useLocationPermissions: useLocationPermissionsMock }));

// Light stubs for heavy presentational/derivation modules so the success render is
// deterministic. Confidence badge + data-quality banner get test-ids so we can
// assert they are ABSENT under the error state.
vi.mock("@/components/explainability", () => ({
  KpiConfidenceBadge: ({ level }: { level: string }) => (
    <span data-testid="kpi-confidence-badge">{level}</span>
  ),
  KpiExplainSheet: () => null,
  buildDataQualityInput: () => ({}),
  buildKpiConfidenceInput: () => ({}),
  buildInventoryExplain: () => ({}),
  buildOverstockExplain: () => ({}),
  buildReorderExplain: () => ({}),
  buildMoneyLostExplain: () => ({}),
  buildFoodCostExplain: () => ({}),
}));
vi.mock("@/components/dashboard/DataQualityBanner", () => ({
  DataQualityBanner: () => <div data-testid="data-quality-banner" />,
}));
vi.mock("@/domain/dataQuality", () => ({
  computeInventoryValueConfidence: () => ({ level: "high" }),
  computeOverstockConfidence: () => ({ level: "high" }),
  computeReorderConfidence: () => ({ level: "high" }),
  computeMoneyLostConfidence: () => ({ level: "low" }),
  computeFoodCostConfidence: () => ({ level: "medium" }),
  computeDataQualityScore: () => ({ score: 100, band: "good", issues: [] }),
  dataQualityBandLabel: () => "Good",
}));

import AuditCenterPage from "@/pages/app/settings/AuditCenter";

// Full KPISnapshot shape (mirrors useDashboardData DEFAULT_SNAPSHOT).
const baseSnapshot = {
  stockStatus: { red: 0, yellow: 0, green: 0 },
  topReorder: [],
  reorderSummary: null,
  highUsage: [],
  recommendations: [],
  inventoryValue: 0,
  missingCostCount: 0,
  trendData: [],
  overstockValue: 0,
  lastSessionDate: null,
  lastSessionName: null,
  missingParCount: 0,
  pendingInvoices: 0,
  periodSpend: 0,
  spendOverviewData: null,
  deliveryIssuesCount: 0,
  priceIncreaseImpact: 0,
  todayWasteEntries: [],
  recordedWasteValue: 0,
  recordedWasteCount: 0,
  wasteItemsMissingCost: 0,
  shrinkageValue: 0,
  topProfitLeaks: [],
  overstockItems: [],
  foodCostPct: null,
  weeklyGrossSales: null,
  foodCostTargetPct: 30,
  foodCostStatus: null,
};

function hookReturn(over: Record<string, unknown>) {
  return { loading: false, error: null, refetch: vi.fn(), ...baseSnapshot, ...over };
}

beforeEach(() => {
  cleanup();
  useRestaurantMock.mockReturnValue({
    currentRestaurant: { id: "r1", name: "Test Diner" },
    currentLocation: null,
  });
  useLocationPermissionsMock.mockReturnValue({
    can_approve_orders: true,
    can_see_costs: true,
    can_see_food_cost_pct: true,
    can_see_inventory_value: true,
    can_edit_par: true,
    order_approval_threshold: null,
  });
});

describe("AuditCenter — error state (T0-4)", () => {
  it("first-load failure: shows error + Retry, and NO KPI table / values / badges / score", () => {
    useDashboardDataMock.mockReturnValue(
      hookReturn({ loading: false, error: new Error("boom") }),
    );

    const { container } = render(<AuditCenterPage />);

    expect(screen.getByText(/audit data couldn't load/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /retry/i })).toBeInTheDocument();

    // table, badges, data-quality score all gone
    expect(screen.queryByText(/KPI verification/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/data quality score/i)).not.toBeInTheDocument();
    expect(screen.queryByTestId("kpi-confidence-badge")).not.toBeInTheDocument();
    expect(screen.queryByTestId("data-quality-banner")).not.toBeInTheDocument();

    // Failure ≠ $0
    expect(container.textContent).not.toContain("$0");
  });

  it("stale-snapshot prevention: even with non-zero values, an error renders NO values", () => {
    useDashboardDataMock.mockReturnValue(
      hookReturn({
        loading: false,
        error: new Error("boom"),
        inventoryValue: 12345,
        overstockValue: 999,
        periodSpend: 4321,
      }),
    );

    const { container } = render(<AuditCenterPage />);

    expect(screen.getByText(/audit data couldn't load/i)).toBeInTheDocument();
    expect(container.textContent).not.toContain("12,345");
    expect(container.textContent).not.toContain("4,321");
    expect(screen.queryByText(/KPI verification/i)).not.toBeInTheDocument();
    expect(screen.queryByTestId("kpi-confidence-badge")).not.toBeInTheDocument();
  });

  it("retry: clicking Retry calls the hook's refetch", () => {
    const refetch = vi.fn();
    useDashboardDataMock.mockReturnValue(
      hookReturn({ loading: false, error: new Error("boom"), refetch }),
    );

    render(<AuditCenterPage />);
    fireEvent.click(screen.getByRole("button", { name: /retry/i }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it("loading: shows skeleton, not the table or an error", () => {
    useDashboardDataMock.mockReturnValue(hookReturn({ loading: true }));
    render(<AuditCenterPage />);
    expect(screen.queryByText(/audit data couldn't load/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/KPI verification/i)).not.toBeInTheDocument();
  });

  it("success: renders the KPI verification table with values + badges (no error state)", () => {
    useDashboardDataMock.mockReturnValue(
      hookReturn({ loading: false, error: null, inventoryValue: 12345, periodSpend: 6789 }),
    );

    render(<AuditCenterPage />);
    expect(screen.getByText(/KPI verification/i)).toBeInTheDocument();
    expect(screen.queryByText(/audit data couldn't load/i)).not.toBeInTheDocument();
    expect(screen.getByText("$12,345")).toBeInTheDocument();
    expect(screen.getAllByTestId("kpi-confidence-badge").length).toBeGreaterThan(0);
  });
});

describe("AuditCenter / useDashboardData — source guards (regression)", () => {
  const root = resolve(__dirname, "..");

  it("AuditCenter consumes `error` (does not ignore it as _error)", () => {
    const src = readFileSync(resolve(root, "pages/app/settings/AuditCenter.tsx"), "utf8");
    expect(src).toContain("loading, error, refetch,");
    expect(src).not.toContain("error: _error");
    expect(src).toContain("if (error)");
  });

  it("useDashboardData resets the snapshot on error (no stale values)", () => {
    const src = readFileSync(resolve(root, "hooks/useDashboardData.ts"), "utf8");
    expect(src).toContain("setSnapshot(DEFAULT_SNAPSHOT)");
    expect(src).not.toContain("DEPRECATED: Not used");
  });
});
