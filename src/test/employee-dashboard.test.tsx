import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

// Phase 0: the EMPLOYEE view is the count task ONLY — it must show a start/continue
// CTA + count status and contain NO money/KPI figures whatsoever.

const { useRestaurantMock, useCountStatusMock } = vi.hoisted(() => ({
  useRestaurantMock: vi.fn(),
  useCountStatusMock: vi.fn(),
}));

vi.mock("@/contexts/RestaurantContext", () => ({ useRestaurant: useRestaurantMock }));
vi.mock("@/hooks/useEmployeeCountStatus", () => ({ useEmployeeCountStatus: useCountStatusMock }));

import { EmployeeDashboard } from "@/pages/app/dashboard/EmployeeDashboard";

function renderEmployee() {
  return render(
    <MemoryRouter>
      <EmployeeDashboard />
    </MemoryRouter>,
  );
}

const withLocation = {
  currentRestaurant: { id: "r1", name: "Joe's Diner", role: "STAFF" },
  currentLocation: { id: "l1", name: "Main Kitchen", restaurant_id: "r1", is_default: true, is_active: true },
};

describe("EmployeeDashboard (Phase 0 — count task only)", () => {
  beforeEach(() => {
    useRestaurantMock.mockReset();
    useCountStatusMock.mockReset();
  });
  afterEach(cleanup);

  it("shows a 'Start count' CTA and never renders any money/KPI figure", () => {
    useRestaurantMock.mockReturnValue(withLocation);
    useCountStatusMock.mockReturnValue({ loading: false, lastCountAt: null, inProgressSessionId: null });

    const { container } = renderEmployee();

    expect(screen.getByRole("button", { name: /start count/i })).toBeTruthy();
    // No money/KPI leakage into the staff view.
    expect(container.textContent).not.toMatch(/\$|Money|Profit|Food cost|Overstock|Shrinkage|Inventory value/i);
  });

  it("shows 'Continue count' when a session is in progress", () => {
    useRestaurantMock.mockReturnValue(withLocation);
    useCountStatusMock.mockReturnValue({ loading: false, lastCountAt: null, inProgressSessionId: "sess-1" });

    renderEmployee();

    expect(screen.getByRole("button", { name: /continue count/i })).toBeTruthy();
  });

  it("guides the user instead of a dead button when no location is assigned", () => {
    useRestaurantMock.mockReturnValue({ ...withLocation, currentLocation: null });
    useCountStatusMock.mockReturnValue({ loading: false, lastCountAt: null, inProgressSessionId: null });

    renderEmployee();

    expect(screen.getByText(/assign you a location/i)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /count/i })).toBeNull();
  });
});
