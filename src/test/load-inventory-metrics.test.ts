import { beforeEach, describe, expect, it, vi } from "vitest";

// Silent-$0 rollout: loadInventoryMetrics returns a LoadOutcome so a failed
// latest-session / session-items query surfaces as an error instead of a
// confident $0 inventory value / empty reorder / $0 overstock.
const { fromMock } = vi.hoisted(() => ({ fromMock: vi.fn() }));

vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: fromMock } }));
vi.mock("@/lib/usage-analytics", () => ({
  computeUsageAnalytics: vi.fn(async () => []),
  computePARRecommendations: vi.fn(async () => []),
}));

import { loadInventoryMetrics } from "@/domain/dashboard/loadInventoryMetrics";

function query(result: { data: unknown; error: unknown }) {
  const b: Record<string, unknown> = {};
  for (const m of ["select", "eq", "order", "limit", "in", "maybeSingle"]) {
    b[m] = vi.fn(() => b);
  }
  b.then = (resolve: (r: typeof result) => unknown) => resolve(result);
  return b;
}

describe("loadInventoryMetrics — LoadOutcome (silent-$0 fix)", () => {
  beforeEach(() => {
    fromMock.mockReset();
  });

  it("returns { status: 'error' } when the session query fails — NOT $0", async () => {
    fromMock.mockReturnValue(query({ data: null, error: { message: "boom" } }));

    const out = await loadInventoryMetrics("r1", undefined);

    expect(out.status).toBe("error");
    expect(out).not.toMatchObject({ value: { inventoryValue: 0 } });
  });

  it("returns { status: 'ok' } with a real 0 when there are no approved sessions", async () => {
    fromMock.mockReturnValue(query({ data: [], error: null }));

    const out = await loadInventoryMetrics("r1", undefined);

    expect(out.status).toBe("ok");
    if (out.status === "ok") {
      expect(out.value.inventoryValue).toBe(0);
      expect(out.value.overstockValue).toBe(0);
      expect(out.value.topReorder).toEqual([]);
    }
  });
});
