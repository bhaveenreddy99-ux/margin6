import { describe, it, expect } from "vitest";
import {
  resolveEntitlement,
  SUBSCRIPTION_LAUNCH_CUTOFF,
} from "@/domain/subscription/resolveEntitlement";

// Slice 2 contract: a NEW restaurant gets column defaults (subscription_status='trial',
// trial_ends_at = now()+14d, created_at = now()) inside the atomic restaurant-creation
// transaction. This asserts those exact defaults resolve to a covered trialing
// entitlement, that a lapsed trial is read-only (not blocked), and that an EXISTING
// (pre-cutoff) restaurant stays grandfathered — new-vs-existing separation, no overlap.

const DAY = 86_400_000;

describe("trial-on-signup — new-restaurant defaults resolve correctly", () => {
  it("a brand-new restaurant ('trial', +14d, created now, no Stripe) → trialing/covered", () => {
    const now = new Date("2026-09-01T00:00:00Z"); // safely after the cutoff
    const e = resolveEntitlement(
      {
        subscriptionStatus: "trial", // stored value — NOT 'trialing'
        trialEndsAt: new Date(now.getTime() + 14 * DAY).toISOString(),
        createdAt: now.toISOString(), // created after cutoff => not legacy
        stripeSubscriptionId: null, // no card, no Stripe
      },
      now,
    );
    expect(e.status).toBe("trialing");
    expect(e.covered).toBe(true);
    expect(e.readOnly).toBe(false);
    expect(e.daysRemaining).toBe(14);
  });

  it("that same trial, once lapsed, is read-only (not blocked)", () => {
    const created = new Date(SUBSCRIPTION_LAUNCH_CUTOFF.getTime() + DAY); // post-cutoff
    const now = new Date(created.getTime() + 30 * DAY);
    const e = resolveEntitlement(
      {
        subscriptionStatus: "trial",
        trialEndsAt: new Date(created.getTime() + 14 * DAY).toISOString(), // expired
        createdAt: created.toISOString(),
        stripeSubscriptionId: null,
      },
      now,
    );
    expect(e.status).toBe("expired");
    expect(e.readOnly).toBe(true);
    expect(e.covered).toBe(false);
  });

  it("an EXISTING (pre-cutoff) restaurant stays grandfathered — never on the trial path", () => {
    const created = new Date(SUBSCRIPTION_LAUNCH_CUTOFF.getTime() - DAY); // pre-cutoff
    const now = new Date(SUBSCRIPTION_LAUNCH_CUTOFF.getTime() + 100 * DAY);
    const e = resolveEntitlement(
      {
        subscriptionStatus: "trial",
        trialEndsAt: "2026-06-01T00:00:00Z", // long expired, but irrelevant for legacy
        createdAt: created.toISOString(),
        stripeSubscriptionId: null,
      },
      now,
    );
    expect(e.status).toBe("grandfathered");
    expect(e.covered).toBe(true);
  });
});
