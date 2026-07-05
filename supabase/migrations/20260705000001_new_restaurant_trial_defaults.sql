-- Slice 2: trial-on-signup for NEW restaurants, made explicit + canonical at the
-- schema level.
--
-- The trial is created INSIDE the same atomic INSERT that creates a restaurant:
-- these column defaults fire within the create_restaurant_with_owner SECURITY
-- DEFINER transaction (and on ANY other insert path too — strictly more robust
-- than embedding the trial only in that one RPC). subscription_status is NOT NULL,
-- so a restaurant row can NEVER exist without its trial. Stores 'trial' (the
-- CHECK-allowed value); resolveEntitlement (frontend) derives 'trialing'.
--
-- SAFETY:
--   * ONLY affects NEW restaurant creation — defaults apply to new INSERTs;
--     existing rows are never touched (NO backfill).
--   * Idempotent — re-affirms the values already in place, made explicit + documented.
--   * Enforcement is NOT wired here — the trial is tracked, nothing is gated.
--
-- This does NOT modify the create_restaurant_with_owner function (chosen over an
-- in-function CREATE OR REPLACE to keep the blast radius minimal on a signup-
-- critical function — same care as the security migrations).

ALTER TABLE public.restaurants
  ALTER COLUMN subscription_status SET DEFAULT 'trial',
  ALTER COLUMN trial_ends_at       SET DEFAULT (now() + interval '14 days');

COMMENT ON COLUMN public.restaurants.subscription_status IS
  'Billing state. New restaurants default to a 14-day no-card trial. Resolved via '
  'resolveEntitlement (frontend): accounts created before SUBSCRIPTION_LAUNCH_CUTOFF '
  'with no Stripe subscription are grandfathered. Enforcement not yet wired.';

COMMENT ON COLUMN public.restaurants.trial_ends_at IS
  'Trial expiry, set to now()+14d at creation. Ignored for legacy/grandfathered '
  'accounts by resolveEntitlement.';
