import { beforeEach, describe, expect, it, vi } from "vitest";

// Silent-$0 rollout: loadRestaurantPortfolioSummaries returns a LoadOutcome so a
// failed core query surfaces as { status: "error" } (the My Restaurants view shows
// "couldn't load", not every restaurant as "—"/$0), while a genuinely empty
// portfolio (no restaurant ids) stays { status: "ok", value: {} }.
const { fromMock } = vi.hoisted(() => ({ fromMock: vi.fn() }));

vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: fromMock } }));

import { loadRestaurantPortfolioSummaries } from "@/domain/dashboard/loadRestaurantPortfolioSummaries";

function query(result: { data: unknown; error: unknown }) {
  const b: Record<string, unknown> = {};
  for (const m of ["select", "in", "eq", "gte", "lte", "not", "order"]) b[m] = vi.fn(() => b);
  b.then = (resolve: (r: typeof result) => unknown) => resolve(result);
  return b;
}

describe("loadRestaurantPortfolioSummaries — LoadOutcome (silent-$0)", () => {
  beforeEach(() => {
    fromMock.mockReset();
  });

  it("returns { status: 'error' } when a core query fails — NOT every restaurant as $0/—", async () => {
    // Any query failing makes the whole portfolio unreliable.
    fromMock.mockReturnValue(query({ data: null, error: { message: "boom" } }));

    const out = await loadRestaurantPortfolioSummaries(["r1", "r2"]);

    expect(out.status).toBe("error");
  });

  it("returns { status: 'ok', value: {} } for a genuinely empty portfolio", async () => {
    const out = await loadRestaurantPortfolioSummaries([]);

    expect(out).toEqual({ status: "ok", value: {} });
    expect(fromMock).not.toHaveBeenCalled();
  });
});
