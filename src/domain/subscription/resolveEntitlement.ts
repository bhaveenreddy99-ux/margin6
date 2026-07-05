// SINGLE SOURCE OF TRUTH for "what access does this restaurant's subscription
// entitle it to." Every entitlement READ — the trial banner, the Billing page,
// and the future Phase-4 enforcement gate — resolves through this one pure
// function so the paths can never diverge again.
//
// IMPORTANT: ENFORCEMENT IS NOT WIRED HERE. This computes the intended posture
// (covered / read-only). Nothing acts on `readOnly` yet — the enforcement flag
// stays OFF, so no real user's access changes today. This slice fixes the LOGIC
// so that when enforcement is eventually flipped on, no existing user locks out.

export type EntitlementStatus =
  | "grandfathered" // legacy account (pre-launch, never subscribed) — covered forever
  | "active" //        live Stripe subscription
  | "trialing" //      post-launch trial, not yet expired
  | "expired" //       post-launch trial lapsed, no subscription
  | "past_due" //      Stripe payment failed
  | "canceled"; //     subscription canceled

export type Entitlement = {
  status: EntitlementStatus;
  /** Full access intended (view + create). */
  covered: boolean;
  /**
   * View-only intended: can read existing data, cannot add new counts/invoices.
   * The humane "convert-later" posture (Option A) for a lapsed trial — we don't
   * burn the bridge. NOT enforced until the flag flips (Phase 4).
   */
  readOnly: boolean;
  /** Days left for a trialing account; null otherwise. */
  daysRemaining: number | null;
};

export type RestaurantSubscriptionInput = {
  subscriptionStatus: string | null | undefined;
  trialEndsAt: string | Date | null | undefined;
  createdAt: string | Date | null | undefined;
  stripeSubscriptionId: string | null | undefined;
};

/**
 * Accounts created before this instant that never took a Stripe subscription are
 * LEGACY and grandfathered forever — the expiry logic never touches them.
 *
 * PLACEHOLDER (far future) while PRE-LAUNCH: this grandfathers ALL existing AND
 * all build-phase test/partner accounts, so nobody lands on a trial/expiry path
 * before we actually launch. MUST be set to the real launch date before billing
 * enforcement is ever turned on (Phase 4).
 */
export const SUBSCRIPTION_LAUNCH_CUTOFF = new Date("2027-01-01T00:00:00.000Z");

function toDate(v: string | Date | null | undefined): Date | null {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

function daysUntil(end: Date, now: Date): number {
  return Math.max(0, Math.ceil((end.getTime() - now.getTime()) / 86_400_000));
}

/**
 * Resolve a restaurant's entitlement. Precedence (top wins):
 *  1. LEGACY  → grandfathered (covered forever; can NEVER become expired)
 *  2. active  → covered
 *  3. past_due / canceled → read-only (humane, not blocked)
 *  4. trial: not-yet-expired → trialing (covered); lapsed → expired (read-only)
 */
export function resolveEntitlement(
  input: RestaurantSubscriptionInput,
  now: Date = new Date(),
): Entitlement {
  const createdAt = toDate(input.createdAt);
  const trialEndsAt = toDate(input.trialEndsAt);
  const hasStripeSub = !!input.stripeSubscriptionId;
  const raw = (input.subscriptionStatus ?? "").toLowerCase();

  // 1) LEGACY short-circuit — wins over everything. A restaurant created before
  //    the launch cutoff that never took a Stripe subscription is grandfathered
  //    forever; trial_ends_at is irrelevant, so it can NEVER resolve to expired.
  //    A missing row / null created_at lands here too (defensive: never lock out).
  const isLegacy = !hasStripeSub && (createdAt === null || createdAt < SUBSCRIPTION_LAUNCH_CUTOFF);
  if (isLegacy) {
    return { status: "grandfathered", covered: true, readOnly: false, daysRemaining: null };
  }

  // 2) Live subscription.
  if (raw === "active") {
    return { status: "active", covered: true, readOnly: false, daysRemaining: null };
  }

  // 3) Billing problems — read-only, not blocked (convert-later).
  if (raw === "past_due") {
    return { status: "past_due", covered: false, readOnly: true, daysRemaining: null };
  }
  if (raw === "canceled") {
    return { status: "canceled", covered: false, readOnly: true, daysRemaining: null };
  }

  // 4) Trial (post-launch). Expired trial = READ-ONLY (Option A), never hard-blocked.
  const trialExpired = trialEndsAt !== null && trialEndsAt.getTime() <= now.getTime();
  if (trialExpired) {
    return { status: "expired", covered: false, readOnly: true, daysRemaining: 0 };
  }
  return {
    status: "trialing",
    covered: true,
    readOnly: false,
    daysRemaining: trialEndsAt ? daysUntil(trialEndsAt, now) : null,
  };
}
