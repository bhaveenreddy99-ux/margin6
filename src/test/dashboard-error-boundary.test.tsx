import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { DashboardErrorBoundary } from "@/components/dashboard/DashboardErrorBoundary";

// Silent-$0 trust fix: a KPI card that throws while rendering must land in the
// error contract (an explicit "couldn't load" + Retry), never blank the layout or
// read as $0.

function Boom(): JSX.Element {
  throw new Error("render boom");
}

describe("DashboardErrorBoundary", () => {
  afterEach(cleanup);

  it("renders the error contract (not a blank/$0) when a child throws", () => {
    // Suppress React's expected error log for the thrown child.
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    render(
      <DashboardErrorBoundary label="Profit Risk">
        <Boom />
      </DashboardErrorBoundary>,
    );

    expect(screen.getByText(/Profit Risk couldn't load/i)).toBeTruthy();
    expect(screen.getByText(/isn't \$0/i)).toBeTruthy();
    expect(screen.getByRole("button", { name: /retry/i })).toBeTruthy();
    spy.mockRestore();
  });

  it("invokes onRetry and resets when Retry is clicked", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const onRetry = vi.fn();
    render(
      <DashboardErrorBoundary label="Overstock" onRetry={onRetry}>
        <Boom />
      </DashboardErrorBoundary>,
    );

    fireEvent.click(screen.getByRole("button", { name: /retry/i }));
    expect(onRetry).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });
});
