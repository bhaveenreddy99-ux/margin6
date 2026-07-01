import { beforeEach, describe, expect, it, vi } from "vitest";

// Silent-$0 rollout: loadSpendMetrics returns a LoadOutcome so a failed
// spend-contributing query surfaces as an error instead of a confident $0
// Period Spend / price-hike impact.
const { fromMock } = vi.hoisted(() => ({ fromMock: vi.fn() }));

vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: fromMock } }));
vi.mock("@/lib/procurement-dedupe", () => ({
  fetchInvoiceDocumentIdsForRestaurant: vi.fn(async () => new Set<string>()),
}));
vi.mock("@/domain/dashboard/priceIncreaseFromNotifications", () => ({
  fetchPriceIncreaseNotifications: vi.fn(async () => []),
  sumPriceIncreaseImpactFromNotifications: vi.fn(() => 0),
}));

import { loadSpendMetrics } from "@/domain/dashboard/loadSpendMetrics";

function query(result: { data: unknown; error: unknown }) {
  const b: Record<string, unknown> = {};
  for (const m of ["select", "eq", "in", "gte", "lte", "order", "limit"]) {
    b[m] = vi.fn(() => b);
  }
  b.then = (resolve: (r: typeof result) => unknown) => resolve(result);
  return b;
}

describe("loadSpendMetrics — LoadOutcome (silent-$0 fix)", () => {
  beforeEach(() => {
    fromMock.mockReset();
  });

  it("returns { status: 'error' } when a spend query fails — NOT $0", async () => {
    fromMock.mockReturnValue(query({ data: null, error: { message: "boom" } }));

    const out = await loadSpendMetrics("r1", undefined, "this_week");

    expect(out.status).toBe("error");
    expect(out).not.toMatchObject({ value: { periodSpend: 0 } });
  });

  it("returns { status: 'ok' } with a real 0 for a genuine empty period", async () => {
    fromMock.mockReturnValue(query({ data: [], error: null }));

    const out = await loadSpendMetrics("r1", undefined, "this_week");

    expect(out).toEqual({
      status: "ok",
      value: {
        periodSpend: 0,
        spendOverviewData: null,
        deliveryIssuesCount: 0,
        priceIncreaseImpact: 0,
      },
    });
  });
});
