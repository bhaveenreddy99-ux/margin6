-- ═══════════════════════════════════════════════════════════════════════════
-- Stripe billing: 14-day trial + $99/month subscription
--
-- Adds subscription state to public.restaurants. Existing rows default to
-- 'trial' with a 14-day window from migration time so nobody loses access at
-- deploy. Every column has a DEFAULT and is nullable where appropriate —
-- purely additive, no breakage.
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE public.restaurants
  ADD COLUMN IF NOT EXISTS subscription_status TEXT NOT NULL DEFAULT 'trial',
  ADD COLUMN IF NOT EXISTS trial_ends_at TIMESTAMPTZ DEFAULT (now() + interval '14 days'),
  ADD COLUMN IF NOT EXISTS stripe_customer_id TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS stripe_subscription_id TEXT DEFAULT NULL;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'restaurants_subscription_status_chk'
  ) THEN
    ALTER TABLE public.restaurants
      ADD CONSTRAINT restaurants_subscription_status_chk
      CHECK (subscription_status IN ('trial', 'active', 'past_due', 'canceled'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_restaurants_stripe_customer_id
  ON public.restaurants (stripe_customer_id)
  WHERE stripe_customer_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_restaurants_stripe_subscription_id
  ON public.restaurants (stripe_subscription_id)
  WHERE stripe_subscription_id IS NOT NULL;

NOTIFY pgrst, 'reload schema';
