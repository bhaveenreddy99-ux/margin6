-- =============================================================================
-- Smoke test for backfill_default_locations migration.
-- Tests:
--   (1) Restaurant with zero active locations → backfill creates exactly 1
--   (2) Restaurant with one active location → backfill is a no-op (no duplicate)
--   (3) Re-running the migration is idempotent
-- =============================================================================

\set ON_ERROR_STOP off

-- Minimal schema (subset of 20260212001141 + 20260214020430 just for restaurants/locations)
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE public.restaurants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.locations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id uuid NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  name text NOT NULL,
  address text,
  city text,
  state text,
  zip text,
  storage_types jsonb DEFAULT '["Cooler","Freezer","Dry Storage","Bar"]'::jsonb,
  is_default boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Seed: restaurant 1 (no locations), restaurant 2 (1 existing location)
INSERT INTO public.restaurants (id, name) VALUES
  ('11111111-1111-1111-1111-111111111111', 'No-Locations Bistro'),
  ('22222222-2222-2222-2222-222222222222', 'Already-Has-One Cafe');

INSERT INTO public.locations (restaurant_id, name) VALUES
  ('22222222-2222-2222-2222-222222222222', 'Main Street');

-- Sanity: pre-state
DO $$
DECLARE n1 int; n2 int;
BEGIN
  SELECT count(*) INTO n1 FROM public.locations WHERE restaurant_id = '11111111-1111-1111-1111-111111111111'::uuid;
  SELECT count(*) INTO n2 FROM public.locations WHERE restaurant_id = '22222222-2222-2222-2222-222222222222'::uuid;
  IF n1 = 0 AND n2 = 1 THEN
    RAISE NOTICE '   PRE: restaurant 1 has 0 locations, restaurant 2 has 1 (correct)';
  ELSE
    RAISE EXCEPTION '   PRE: unexpected state (r1=% r2=%)', n1, n2;
  END IF;
END $$;

-- ── Run the actual backfill migration ───────────────────────────────────────
\echo '── Applying backfill migration ──'
INSERT INTO public.locations (id, restaurant_id, name, is_active, created_at)
SELECT gen_random_uuid(), r.id, r.name, true, now()
FROM public.restaurants r
WHERE NOT EXISTS (
  SELECT 1 FROM public.locations l
  WHERE l.restaurant_id = r.id AND l.is_active = true
);

-- ── Test 1: restaurant 1 now has 1 location named after itself ─────────────
DO $$
DECLARE r record;
BEGIN
  SELECT count(*) AS cnt, max(name) AS lname INTO r
   FROM public.locations
  WHERE restaurant_id = '11111111-1111-1111-1111-111111111111'::uuid AND is_active = true;
  IF r.cnt = 1 AND r.lname = 'No-Locations Bistro' THEN
    RAISE NOTICE '   PASS [1]: restaurant 1 now has 1 location named "%"', r.lname;
  ELSE
    RAISE NOTICE '   FAIL [1]: cnt=%, name=%', r.cnt, r.lname;
  END IF;
END $$;

-- ── Test 2: restaurant 2 still has exactly its original 1 location ──────────
DO $$
DECLARE r record;
BEGIN
  SELECT count(*) AS cnt, max(name) AS lname INTO r
   FROM public.locations
  WHERE restaurant_id = '22222222-2222-2222-2222-222222222222'::uuid AND is_active = true;
  IF r.cnt = 1 AND r.lname = 'Main Street' THEN
    RAISE NOTICE '   PASS [2]: restaurant 2 unchanged — 1 location named "%"', r.lname;
  ELSE
    RAISE NOTICE '   FAIL [2]: cnt=%, name=% (expected 1 named "Main Street")', r.cnt, r.lname;
  END IF;
END $$;

-- ── Test 3: re-running the backfill is a no-op ──────────────────────────────
\echo '── Re-applying backfill (idempotency check) ──'
INSERT INTO public.locations (id, restaurant_id, name, is_active, created_at)
SELECT gen_random_uuid(), r.id, r.name, true, now()
FROM public.restaurants r
WHERE NOT EXISTS (
  SELECT 1 FROM public.locations l
  WHERE l.restaurant_id = r.id AND l.is_active = true
);

DO $$
DECLARE n_total int;
BEGIN
  SELECT count(*) INTO n_total FROM public.locations WHERE is_active = true;
  IF n_total = 2 THEN
    RAISE NOTICE '   PASS [3]: re-run is idempotent — still 2 active locations total';
  ELSE
    RAISE NOTICE '   FAIL [3]: total active locations = % (expected 2)', n_total;
  END IF;
END $$;
