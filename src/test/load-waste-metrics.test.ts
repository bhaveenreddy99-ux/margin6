import { beforeEach, describe, expect, it, vi } from "vitest";

// Silent-$0 rollout: loadWasteMetrics returns a LoadOutcome so a failed period
// query surfaces as an error instead of a confident $0 recorded-waste value.
const { fromMock } = vi.hoisted(() => ({ fromMock: vi.fn() }));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: fromMock },
}));

import { loadWasteMetrics } from "@/domain/dashboard/loadWasteMetrics";

function query(result: { data: unknown; error: unknown }) {
  const b: Record<string, unknown> = {};
  for (const m of ["select", "eq", "gte", "lte", "order", "limit", "in"]) {
    b[m] = vi.fn(() => b);
  }
  b.then = (resolve: (r: typeof result) => unknown) => resolve(result);
  return b;
}

describe("loadWasteMetrics — LoadOutcome (silent-$0 fix)", () => {
  beforeEach(() => {
    fromMock.mockReset();
  });

  it("returns { status: 'error' } when the period query fails — NOT $0", async () => {
    fromMock
      .mockReturnValueOnce(query({ data: [], error: null })) // today
      .mockReturnValueOnce(query({ data: null, error: { message: "boom" } })); // range

    const out = await loadWasteMetrics("r1", undefined, "this_week", {});

    expect(out.status).toBe("error");
    expect(out).not.toMatchObject({ value: { recordedWasteValue: 0 } });
  });

  it("returns { status: 'ok', value } with a real 0 for a genuine empty period", async () => {
    fromMock
      .mockReturnValueOnce(query({ data: [], error: null })) // today
      .mockReturnValueOnce(query({ data: [], error: null })); // range

    const out = await loadWasteMetrics("r1", undefined, "this_week", {});

    expect(out).toEqual({
      status: "ok",
      value: {
        todayWasteEntries: [],
        recordedWasteValue: 0,
        recordedWasteCount: 0,
        wasteItemsMissingCost: 0,
      },
    });
  });
});
