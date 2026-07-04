import { beforeEach, describe, expect, it, vi } from "vitest";

// Silent-$0 rollout: loadFoodCostMetrics splits error from empty — a failed sales
// query is { status: "error" } (not "enter weekly sales"), while a genuine
// no-data period stays { status: "ok", value: <empty> }.
const { fromMock } = vi.hoisted(() => ({ fromMock: vi.fn() }));

vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: fromMock } }));

import { loadFoodCostMetrics } from "@/domain/dashboard/loadFoodCostMetrics";

function query(result: { data: unknown; error: unknown }) {
  const b: Record<string, unknown> = {};
  for (const m of ["select", "eq", "gte", "lte", "maybeSingle"]) b[m] = vi.fn(() => b);
  b.then = (resolve: (r: typeof result) => unknown) => resolve(result);
  return b;
}

describe("loadFoodCostMetrics — LoadOutcome (silent-$0, error vs empty)", () => {
  beforeEach(() => {
    fromMock.mockReset();
  });

  it("returns { status: 'error' } when the sales query fails — NOT 'enter weekly sales'", async () => {
    fromMock.mockReturnValue(query({ data: null, error: { message: "boom" } }));

    const out = await loadFoodCostMetrics("loc1", 1000, "30_days");

    expect(out.status).toBe("error");
  });

  it("returns { status: 'ok' } with an empty metric for a genuine no-data period", async () => {
    // periodSpend <= 0 → not enough data yet (never queries)
    const out = await loadFoodCostMetrics(undefined, 0, "this_week");

    expect(out).toEqual({
      status: "ok",
      value: { foodCostPct: null, weeklyGrossSales: null, targetPct: 30, status: null },
    });
  });
});
