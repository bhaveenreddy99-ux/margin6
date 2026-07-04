import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

// Phase 0 adaptive dashboard: the router must (1) send STAFF to the count-only
// view, (2) send OWNER/MANAGER to the money dashboard, and CRITICALLY (3) never
// render the money view — nor invoke its data hook — for STAFF or while the role
// is still loading (no flash, no cost-data fetch).

const { useRestaurantMock, useDashboardDataSpy } = vi.hoisted(() => ({
  useRestaurantMock: vi.fn(),
  useDashboardDataSpy: vi.fn(),
}));

vi.mock("@/contexts/RestaurantContext", () => ({ useRestaurant: useRestaurantMock }));

// Stub the heavy money dashboard with a component that CALLS the data hook, the
// same way the real one does — so "hook not called" proves the money path never ran.
vi.mock("@/pages/app/Dashboard", () => ({
  default: () => {
    useDashboardDataSpy();
    return <div data-testid="owner-manager-dashboard">MONEY VIEW</div>;
  },
}));

vi.mock("@/pages/app/dashboard/EmployeeDashboard", () => ({
  EmployeeDashboard: () => <div data-testid="employee-dashboard">COUNT VIEW</div>,
}));

import DashboardRouter from "@/pages/app/DashboardRouter";

function renderRouter() {
  return render(
    <MemoryRouter>
      <DashboardRouter />
    </MemoryRouter>,
  );
}

describe("DashboardRouter — role-gated adaptive dashboard (Phase 0)", () => {
  beforeEach(() => {
    useRestaurantMock.mockReset();
    useDashboardDataSpy.mockReset();
  });
  afterEach(cleanup);

  it("STAFF sees the count view — money view is never rendered and its data hook never runs", async () => {
    useRestaurantMock.mockReturnValue({ currentRestaurant: { id: "r1", name: "R", role: "STAFF" }, loading: false });

    renderRouter();

    expect(screen.getByTestId("employee-dashboard")).toBeTruthy();
    expect(screen.queryByTestId("owner-manager-dashboard")).toBeNull();
    // give any stray async/lazy render a chance to (not) happen — proves "no flash"
    await waitFor(() => expect(useDashboardDataSpy).not.toHaveBeenCalled());
    expect(screen.queryByTestId("owner-manager-dashboard")).toBeNull();
  });

  it("while the role is LOADING, neither view shows and the money hook never runs (no flash)", async () => {
    useRestaurantMock.mockReturnValue({ currentRestaurant: null, loading: true });

    renderRouter();

    expect(screen.getByTestId("dashboard-loading")).toBeTruthy();
    expect(screen.queryByTestId("owner-manager-dashboard")).toBeNull();
    expect(screen.queryByTestId("employee-dashboard")).toBeNull();
    await waitFor(() => expect(useDashboardDataSpy).not.toHaveBeenCalled());
  });

  it("OWNER sees the money dashboard (data hook runs)", async () => {
    useRestaurantMock.mockReturnValue({ currentRestaurant: { id: "r1", name: "R", role: "OWNER" }, loading: false });

    renderRouter();

    expect(await screen.findByTestId("owner-manager-dashboard")).toBeTruthy();
    expect(screen.queryByTestId("employee-dashboard")).toBeNull();
    expect(useDashboardDataSpy).toHaveBeenCalled();
  });

  it("MANAGER sees the money dashboard in Phase 0 (manager refinement is a later phase)", async () => {
    useRestaurantMock.mockReturnValue({ currentRestaurant: { id: "r1", name: "R", role: "MANAGER" }, loading: false });

    renderRouter();

    expect(await screen.findByTestId("owner-manager-dashboard")).toBeTruthy();
    expect(screen.queryByTestId("employee-dashboard")).toBeNull();
  });
});
