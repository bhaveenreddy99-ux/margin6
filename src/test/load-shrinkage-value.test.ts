import { beforeEach, describe, expect, it, vi } from "vitest";

// Silent-$0 trust fix (pilot): loadShrinkageValue must return a LoadOutcome so a
// failed query is distinguishable from a genuine $0.
const { fromMock } = vi.hoisted(() => ({ fromMock: vi.fn() }));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: fromMock },
}));

import { loadShrinkageValue } from "@/domain/dashboard/loadShrinkageValue";

/** Build a chainable, awaitable supabase query stub that resolves to `result`. */
function mockQuery(result: { data: unknown; error: unknown }) {
  const builder: Record<string, unknown> = {};
  for (const m of ["select", "eq", "in", "gte", "lte"]) {
    builder[m] = vi.fn(() => builder);
  }
  builder.then = (resolve: (r: typeof result) => unknown) => resolve(result);
  fromMock.mockReturnValue(builder);
}

describe("loadShrinkageValue — LoadOutcome (silent-$0 fix)", () => {
  beforeEach(() => {
    fromMock.mockReset();
  });

  it("returns { status: 'error' } when the query errors — NOT 0", async () => {
    mockQuery({ data: null, error: { message: "connection lost" } });

    const out = await loadShrinkageValue("r1", undefined, "this_week");

    expect(out.status).toBe("error");
    // The whole point: a failure must never masquerade as a value of 0.
    expect(out).not.toMatchObject({ value: 0 });
  });

  it("returns { status: 'ok', value: 0 } for a genuine empty period", async () => {
    mockQuery({ data: [], error: null });

    const out = await loadShrinkageValue("r1", undefined, "this_week");

    expect(out).toEqual({ status: "ok", value: 0 });
  });

  it("returns { status: 'ok', value: sum } summing dollar_impact", async () => {
    mockQuery({
      data: [
        { data: { items: [{ dollar_impact: 10 }, { dollar_impact: "5" }] } },
        { data: { items: [{ dollar_impact: 3 }] } },
      ],
      error: null,
    });

    const out = await loadShrinkageValue("r1", undefined, "this_week");

    expect(out).toEqual({ status: "ok", value: 18 });
  });
});
