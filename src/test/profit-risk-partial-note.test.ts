import { describe, expect, it } from "vitest";
import { computeProfitRiskPartialNote } from "@/domain/dashboard/profitRiskLabels";

// Silent-$0 rollout (R4): when a Money Lost component fails, the headline total
// must be flagged partial and name what's missing — never a confident full total
// that silently dropped a failed term.
describe("computeProfitRiskPartialNote", () => {
  it("returns null when nothing errored (total is trustworthy)", () => {
    expect(computeProfitRiskPartialNote([])).toBeNull();
  });

  it("names the single missing component", () => {
    expect(computeProfitRiskPartialNote(["Shrinkage alerts"])).toBe(
      "partial — Shrinkage alerts unavailable",
    );
  });

  it("counts multiple missing components", () => {
    expect(
      computeProfitRiskPartialNote(["Recorded waste", "Price increase impact"]),
    ).toBe("partial — 2 components unavailable");
  });
});
