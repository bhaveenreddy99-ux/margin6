import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { loadProfitLeaks } from "@/domain/dashboard/loadProfitLeaks";

// Silent-$0 rollout (Option A, partial-tolerant): loadProfitLeaks returns an
// error ONLY when the list is empty AND at least one source failed. A genuine
// empty period (no errors) still returns an empty list as { status: "ok" }.
function mockSupabase(mode: "error" | "empty"): SupabaseClient {
  const q: Record<string, unknown> = {};
  for (const m of ["select", "eq", "in", "gte", "lte", "order", "limit"]) {
    q[m] = () => q;
  }
  q.then = (resolve: (r: unknown) => unknown, reject: (e: unknown) => unknown) =>
    mode === "error" ? reject(new Error("boom")) : resolve({ data: [], error: null });
  return { from: () => q } as unknown as SupabaseClient;
}

describe("loadProfitLeaks — LoadOutcome (silent-$0, partial-tolerant)", () => {
  it("returns { status: 'error' } when the list is empty AND every source failed", async () => {
    const out = await loadProfitLeaks(mockSupabase("error"), "r1", undefined, "2026-01-01", "2026-01-31");
    expect(out.status).toBe("error");
  });

  it("returns { status: 'ok', value: [] } for a genuine empty period (no source errors)", async () => {
    const out = await loadProfitLeaks(mockSupabase("empty"), "r1", undefined, "2026-01-01", "2026-01-31");
    expect(out).toEqual({ status: "ok", value: [] });
  });
});
