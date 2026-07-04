import { beforeEach, describe, expect, it, vi } from "vitest";

// Silent-$0 rollout: loadOverstockItems returns a LoadOutcome so a failed query
// surfaces as an error instead of an empty list read as "no overstock — lean".
const { fromMock } = vi.hoisted(() => ({ fromMock: vi.fn() }));

vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: fromMock } }));

import { loadOverstockItems } from "@/domain/dashboard/loadOverstockItems";

function query(result: { data: unknown; error: unknown }) {
  const b: Record<string, unknown> = {};
  for (const m of ["select", "eq", "order", "limit"]) b[m] = vi.fn(() => b);
  b.then = (resolve: (r: typeof result) => unknown) => resolve(result);
  return b;
}

describe("loadOverstockItems — LoadOutcome (silent-$0 fix)", () => {
  beforeEach(() => {
    fromMock.mockReset();
  });

  it("returns { status: 'error' } when the session query fails — NOT an empty list", async () => {
    fromMock.mockReturnValue(query({ data: null, error: { message: "boom" } }));

    const out = await loadOverstockItems("r1", undefined);

    expect(out.status).toBe("error");
  });

  it("returns { status: 'ok', value: [] } when there is no approved session (genuine empty)", async () => {
    fromMock.mockReturnValue(query({ data: [], error: null }));

    const out = await loadOverstockItems("r1", undefined);

    expect(out).toEqual({ status: "ok", value: [] });
  });
});
