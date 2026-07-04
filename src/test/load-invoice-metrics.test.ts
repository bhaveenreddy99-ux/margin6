import { beforeEach, describe, expect, it, vi } from "vitest";

// Silent-$0 rollout: loadInvoiceMetrics returns a LoadOutcome so a failed
// pending-invoices query surfaces as an error instead of "0 pending".
const { fromMock } = vi.hoisted(() => ({ fromMock: vi.fn() }));

vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: fromMock } }));
vi.mock("@/lib/procurement-dedupe", () => ({
  fetchInvoiceDocumentIdsForRestaurant: vi.fn(async () => new Set<string>()),
}));

import { loadInvoiceMetrics } from "@/domain/dashboard/loadInvoiceMetrics";

function query(result: { count?: number | null; data?: unknown; error: unknown }) {
  const b: Record<string, unknown> = {};
  for (const m of ["select", "eq", "in"]) b[m] = vi.fn(() => b);
  b.then = (resolve: (r: typeof result) => unknown) => resolve(result);
  return b;
}

describe("loadInvoiceMetrics — LoadOutcome (silent-$0 fix)", () => {
  beforeEach(() => {
    fromMock.mockReset();
  });

  it("returns { status: 'error' } when a query fails — NOT 0 pending", async () => {
    fromMock.mockReturnValue(query({ count: null, data: null, error: { message: "boom" } }));

    const out = await loadInvoiceMetrics("r1", undefined);

    expect(out.status).toBe("error");
    expect(out).not.toMatchObject({ value: { pendingInvoices: 0 } });
  });

  it("returns { status: 'ok', value: { pendingInvoices: 0 } } for a genuine empty result", async () => {
    fromMock.mockReturnValue(query({ count: 0, data: [], error: null }));

    const out = await loadInvoiceMetrics("r1", undefined);

    expect(out).toEqual({ status: "ok", value: { pendingInvoices: 0 } });
  });
});
