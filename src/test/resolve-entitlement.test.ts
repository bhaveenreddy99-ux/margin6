import { describe, it, expect } from "vitest";
import {
  resolveEntitlement,
  SUBSCRIPTION_LAUNCH_CUTOFF,
} from "@/domain/subscription/resolveEntitlement";

// Slice 1.5: one grandfather-aware resolver is the single source of truth for
// entitlement. Existing (legacy) accounts must resolve to grandfathered forever
// and can NEVER be expired; a lapsed trial for NEW accounts is read-only (Option
// A — humane), never a hard block. Enforcement is not wired — this is logic only.

const before = new Date(SUBSCRIPTION_LAUNCH_CUTOFF.getTime() - 86_400_000).toISOString(); // pre-launch
const after = new Date(SUBSCRIPTION_LAUNCH_CUTOFF.getTime() + 86_400_000).toISOString(); //  post-launch
const NOW = new Date("2026-08-01T00:00:00Z");

describe("resolveEntitlement — single source of truth", () => {
  it("LEGACY: pre-launch account with an EXPIRED trial date is still grandfathered (never expired)", () => {
    const e = resolveEntitlement(
      {
        subscriptionStatus: "trial",
        trialEndsAt: "2026-06-04T00:00:00Z", // long past
        createdAt: before,
        stripeSubscriptionId: null,
      },
      NOW,
    );
    expect(e.status).toBe("grandfathered");
    expect(e.covered).toBe(true);
    expect(e.readOnly).toBe(false);
  });

  it("LEGACY: missing created_at / null status resolves grandfathered (defensive, never lock out)", () => {
    const e = resolveEntitlement(
      { subscriptionStatus: null, trialEndsAt: null, createdAt: null, stripeSubscriptionId: null },
      NOW,
    );
    expect(e.status).toBe("grandfathered");
    expect(e.covered).toBe(true);
  });

  it("a legacy account that later subscribes reads as active (covered), not grandfathered", () => {
    const e = resolveEntitlement(
      { subscriptionStatus: "active", trialEndsAt: null, createdAt: before, stripeSubscriptionId: "sub_123" },
      NOW,
    );
    expect(e.status).toBe("active");
    expect(e.covered).toBe(true);
  });

  it("NEW trialing account (post-launch, future end) is covered with days remaining", () => {
    const e = resolveEntitlement(
      {
        subscriptionStatus: "trial",
        trialEndsAt: new Date(NOW.getTime() + 5 * 86_400_000).toISOString(),
        createdAt: after,
        stripeSubscriptionId: null,
      },
      NOW,
    );
    expect(e.status).toBe("trialing");
    expect(e.covered).toBe(true);
    expect(e.daysRemaining).toBe(5);
  });

  it("NEW expired trial is READ-ONLY, not blocked (covered=false, readOnly=true)", () => {
    const e = resolveEntitlement(
      {
        subscriptionStatus: "trial",
        trialEndsAt: "2026-07-10T00:00:00Z", // past, but post-launch account
        createdAt: after,
        stripeSubscriptionId: null,
      },
      NOW,
    );
    expect(e.status).toBe("expired");
    expect(e.covered).toBe(false);
    expect(e.readOnly).toBe(true); // humane: view existing, can't add new — NOT a hard lockout
  });

  it("past_due and canceled are read-only, not blocked", () => {
    for (const s of ["past_due", "canceled"] as const) {
      const e = resolveEntitlement(
        { subscriptionStatus: s, trialEndsAt: null, createdAt: after, stripeSubscriptionId: "sub_x" },
        NOW,
      );
      expect(e.status).toBe(s);
      expect(e.covered).toBe(false);
      expect(e.readOnly).toBe(true);
    }
  });

  it("expired is never MORE locked-out than a legacy account (legacy stays covered)", () => {
    const legacy = resolveEntitlement(
      { subscriptionStatus: "trial", trialEndsAt: "2026-01-01T00:00:00Z", createdAt: before, stripeSubscriptionId: null },
      NOW,
    );
    const expired = resolveEntitlement(
      { subscriptionStatus: "trial", trialEndsAt: "2026-07-10T00:00:00Z", createdAt: after, stripeSubscriptionId: null },
      NOW,
    );
    expect(legacy.covered).toBe(true); // existing users: full access
    expect(expired.readOnly).toBe(true); // new lapsed users: read-only, still not blocked
    expect(expired.covered).toBe(false);
  });
});
