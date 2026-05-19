-- =============================================================================
-- 11 smoke tests for the sales-entry migration. Pure DO-block assertions so
-- PASS lines only emit on actual success. Continue-on-error so a single
-- failure does not stop the suite.
--
-- Constants (kept in PL/pgSQL DECLARE blocks per test, no psql variables):
--   restaurant_id = 11111111-1111-1111-1111-111111111111
--   location_id   = 22222222-2222-2222-2222-222222222222
--   owner         = aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa  (OWNER role)
--   manager       = bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb  (MANAGER role)
--   staff_yes     = cccccccc-cccc-cccc-cccc-cccccccccccc  (STAFF, can_see=true)
--   staff_no      = dddddddd-dddd-dddd-dddd-dddddddddddd  (STAFF, can_see=false)
--   week_start    = 2026-05-11 (Monday)
-- =============================================================================

\set ON_ERROR_STOP off
\set QUIET on

-- ── Test 1: OWNER inserts weekly_sales ───────────────────────────────────────
\echo '── Test 1: OWNER inserts weekly_sales'
BEGIN;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', true);
SELECT set_config('request.jwt.claims', '{"sub":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa","role":"authenticated"}', true);
DO $$
BEGIN
  BEGIN
    INSERT INTO public.weekly_sales (restaurant_id, location_id, week_start, gross_sales, entered_by_user_id)
    VALUES (
      '11111111-1111-1111-1111-111111111111'::uuid,
      '22222222-2222-2222-2222-222222222222'::uuid,
      '2026-05-11'::date, 10000.00,
      'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid
    );
    RAISE NOTICE '   PASS: OWNER insert succeeded';
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE '   FAIL: OWNER insert errored: %', SQLERRM;
  END;
END $$;
ROLLBACK;

-- ── Test 2: STAFF with can_see_food_cost_pct=false → 0 rows ──────────────────
\echo '── Test 2: STAFF (can_see=false) reads weekly_sales → expect 0 rows'
BEGIN;
INSERT INTO public.weekly_sales (restaurant_id, location_id, week_start, gross_sales, entered_by_user_id)
VALUES (
  '11111111-1111-1111-1111-111111111111'::uuid,
  '22222222-2222-2222-2222-222222222222'::uuid,
  '2026-05-11'::date, 10000.00,
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid
);
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', 'dddddddd-dddd-dddd-dddd-dddddddddddd', true);
SELECT set_config('request.jwt.claims', '{"sub":"dddddddd-dddd-dddd-dddd-dddddddddddd","role":"authenticated"}', true);
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM public.weekly_sales
   WHERE location_id = '22222222-2222-2222-2222-222222222222'::uuid
     AND week_start = '2026-05-11'::date;
  IF n = 0 THEN RAISE NOTICE '   PASS: STAFF (can_see=false) saw 0 rows';
  ELSE RAISE NOTICE '   FAIL: STAFF (can_see=false) saw % rows (expected 0)', n;
  END IF;
END $$;
ROLLBACK;

-- ── Test 3: STAFF with can_see_food_cost_pct=true → 1 row ───────────────────
\echo '── Test 3: STAFF (can_see=true) reads weekly_sales → expect 1 row'
BEGIN;
INSERT INTO public.weekly_sales (restaurant_id, location_id, week_start, gross_sales, entered_by_user_id)
VALUES (
  '11111111-1111-1111-1111-111111111111'::uuid,
  '22222222-2222-2222-2222-222222222222'::uuid,
  '2026-05-11'::date, 10000.00,
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid
);
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', 'cccccccc-cccc-cccc-cccc-cccccccccccc', true);
SELECT set_config('request.jwt.claims', '{"sub":"cccccccc-cccc-cccc-cccc-cccccccccccc","role":"authenticated"}', true);
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM public.weekly_sales
   WHERE location_id = '22222222-2222-2222-2222-222222222222'::uuid
     AND week_start = '2026-05-11'::date;
  IF n = 1 THEN RAISE NOTICE '   PASS: STAFF (can_see=true) saw 1 row';
  ELSE RAISE NOTICE '   FAIL: STAFF (can_see=true) saw % rows (expected 1)', n;
  END IF;
END $$;
ROLLBACK;

-- ── Test 4: MANAGER inserts weekly_sales ─────────────────────────────────────
\echo '── Test 4: MANAGER inserts weekly_sales'
BEGIN;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', true);
SELECT set_config('request.jwt.claims', '{"sub":"bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb","role":"authenticated"}', true);
DO $$
BEGIN
  BEGIN
    INSERT INTO public.weekly_sales (restaurant_id, location_id, week_start, gross_sales, entered_by_user_id)
    VALUES (
      '11111111-1111-1111-1111-111111111111'::uuid,
      '22222222-2222-2222-2222-222222222222'::uuid,
      '2026-05-11'::date, 12000.00,
      'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'::uuid
    );
    RAISE NOTICE '   PASS: MANAGER insert succeeded';
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE '   FAIL: MANAGER insert errored: %', SQLERRM;
  END;
END $$;
ROLLBACK;

-- ── Test 5: STAFF cannot INSERT weekly_sales ─────────────────────────────────
\echo '── Test 5: STAFF tries to INSERT → expect RLS rejection'
BEGIN;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', 'cccccccc-cccc-cccc-cccc-cccccccccccc', true);
SELECT set_config('request.jwt.claims', '{"sub":"cccccccc-cccc-cccc-cccc-cccccccccccc","role":"authenticated"}', true);
DO $$
BEGIN
  BEGIN
    INSERT INTO public.weekly_sales (restaurant_id, location_id, week_start, gross_sales, entered_by_user_id)
    VALUES (
      '11111111-1111-1111-1111-111111111111'::uuid,
      '22222222-2222-2222-2222-222222222222'::uuid,
      '2026-05-11'::date, 9000.00,
      'cccccccc-cccc-cccc-cccc-cccccccccccc'::uuid
    );
    RAISE NOTICE '   FAIL: STAFF insert succeeded (expected RLS rejection)';
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE '   PASS: STAFF insert rejected (RLS)';
  WHEN OTHERS THEN
    RAISE NOTICE '   PASS: STAFF insert rejected (% / %)', SQLSTATE, SQLERRM;
  END;
END $$;
ROLLBACK;

-- ── Test 6: 1 daily row → weekly_sales is_partial=true, gross=daily ──────────
\echo '── Test 6: 1 daily row → weekly_sales is_partial=true, gross=1500'
BEGIN;
INSERT INTO public.daily_sales (restaurant_id, location_id, sale_date, gross_sales, entered_by_user_id)
VALUES (
  '11111111-1111-1111-1111-111111111111'::uuid,
  '22222222-2222-2222-2222-222222222222'::uuid,
  '2026-05-12'::date, 1500.00,
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid
);
DO $$
DECLARE r record;
BEGIN
  SELECT * INTO r FROM public.weekly_sales
   WHERE location_id = '22222222-2222-2222-2222-222222222222'::uuid
     AND week_start = '2026-05-11'::date;
  IF r IS NULL THEN
    RAISE NOTICE '   FAIL: no weekly_sales row created by trigger';
  ELSIF r.is_partial = true AND r.gross_sales = 1500.00 AND r.entry_method = 'manual_daily_aggregated' THEN
    RAISE NOTICE '   PASS: weekly row created (is_partial=true, gross=1500.00, method=manual_daily_aggregated)';
  ELSE
    RAISE NOTICE '   FAIL: is_partial=%, gross=%, method=%', r.is_partial, r.gross_sales, r.entry_method;
  END IF;
END $$;

-- ── Test 7: + 6 daily rows → is_partial=false, gross sum ─────────────────────
\echo '── Test 7: 6 more daily rows (full week) → is_partial=false, gross=11300'
INSERT INTO public.daily_sales (restaurant_id, location_id, sale_date, gross_sales, entered_by_user_id) VALUES
  ('11111111-1111-1111-1111-111111111111'::uuid, '22222222-2222-2222-2222-222222222222'::uuid, '2026-05-11'::date, 1000.00, 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid),
  ('11111111-1111-1111-1111-111111111111'::uuid, '22222222-2222-2222-2222-222222222222'::uuid, '2026-05-13'::date, 1200.00, 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid),
  ('11111111-1111-1111-1111-111111111111'::uuid, '22222222-2222-2222-2222-222222222222'::uuid, '2026-05-14'::date, 1300.00, 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid),
  ('11111111-1111-1111-1111-111111111111'::uuid, '22222222-2222-2222-2222-222222222222'::uuid, '2026-05-15'::date, 2000.00, 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid),
  ('11111111-1111-1111-1111-111111111111'::uuid, '22222222-2222-2222-2222-222222222222'::uuid, '2026-05-16'::date, 2500.00, 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid),
  ('11111111-1111-1111-1111-111111111111'::uuid, '22222222-2222-2222-2222-222222222222'::uuid, '2026-05-17'::date, 1800.00, 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid);
DO $$
DECLARE r record;
BEGIN
  SELECT * INTO r FROM public.weekly_sales
   WHERE location_id = '22222222-2222-2222-2222-222222222222'::uuid
     AND week_start = '2026-05-11'::date;
  IF r.is_partial = false AND r.gross_sales = 11300.00 THEN
    RAISE NOTICE '   PASS: full-week aggregate (is_partial=false, gross=11300.00)';
  ELSE
    RAISE NOTICE '   FAIL: is_partial=%, gross=%', r.is_partial, r.gross_sales;
  END IF;
END $$;

-- ── Test 8: DELETE 1 daily row → is_partial=true, recomputed ────────────────
\echo '── Test 8: DELETE 1 daily row → is_partial=true, gross=9800'
DELETE FROM public.daily_sales
 WHERE sale_date = '2026-05-12'::date
   AND location_id = '22222222-2222-2222-2222-222222222222'::uuid;
DO $$
DECLARE r record;
BEGIN
  SELECT * INTO r FROM public.weekly_sales
   WHERE location_id = '22222222-2222-2222-2222-222222222222'::uuid
     AND week_start = '2026-05-11'::date;
  IF r IS NULL THEN
    RAISE NOTICE '   FAIL: weekly_sales unexpectedly deleted';
  ELSIF r.is_partial = true AND r.gross_sales = 9800.00 THEN
    RAISE NOTICE '   PASS: weekly row recomputed (is_partial=true, gross=9800.00)';
  ELSE
    RAISE NOTICE '   FAIL: is_partial=%, gross=%', r.is_partial, r.gross_sales;
  END IF;
END $$;

-- ── Test 9: DELETE remaining 6 daily rows → weekly row deleted ──────────────
\echo '── Test 9: DELETE all remaining daily rows → weekly_sales row deleted'
DELETE FROM public.daily_sales
 WHERE location_id = '22222222-2222-2222-2222-222222222222'::uuid
   AND sale_date >= '2026-05-11'::date
   AND sale_date <  '2026-05-18'::date;
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM public.weekly_sales
   WHERE location_id = '22222222-2222-2222-2222-222222222222'::uuid
     AND week_start = '2026-05-11'::date;
  IF n = 0 THEN RAISE NOTICE '   PASS: weekly_sales row deleted (count=0)';
  ELSE RAISE NOTICE '   FAIL: weekly_sales row still present (count=%)', n;
  END IF;
END $$;
ROLLBACK;

-- ── Test 10: manual_weekly wins ──────────────────────────────────────────────
\echo '── Test 10: manual_weekly wins → daily insert leaves weekly unchanged'
BEGIN;
INSERT INTO public.weekly_sales (restaurant_id, location_id, week_start, gross_sales, entry_method, entered_by_user_id)
VALUES (
  '11111111-1111-1111-1111-111111111111'::uuid,
  '22222222-2222-2222-2222-222222222222'::uuid,
  '2026-05-11'::date, 50000.00, 'manual_weekly',
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid
);
INSERT INTO public.daily_sales (restaurant_id, location_id, sale_date, gross_sales, entered_by_user_id)
VALUES (
  '11111111-1111-1111-1111-111111111111'::uuid,
  '22222222-2222-2222-2222-222222222222'::uuid,
  '2026-05-12'::date, 1500.00,
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid
);
DO $$
DECLARE r record;
BEGIN
  SELECT * INTO r FROM public.weekly_sales
   WHERE location_id = '22222222-2222-2222-2222-222222222222'::uuid
     AND week_start = '2026-05-11'::date;
  IF r.gross_sales = 50000.00 AND r.entry_method = 'manual_weekly' AND r.is_partial = false THEN
    RAISE NOTICE '   PASS: manual_weekly preserved (gross=50000.00, method=manual_weekly, is_partial=false)';
  ELSE
    RAISE NOTICE '   FAIL: gross=%, method=%, is_partial=%', r.gross_sales, r.entry_method, r.is_partial;
  END IF;
END $$;
ROLLBACK;

-- ── Test 11: entry_method=garbage → CHECK violation ─────────────────────────
\echo '── Test 11: entry_method=garbage → expect CHECK violation'
BEGIN;
DO $$
BEGIN
  BEGIN
    INSERT INTO public.weekly_sales (restaurant_id, location_id, week_start, gross_sales, entry_method, entered_by_user_id)
    VALUES (
      '11111111-1111-1111-1111-111111111111'::uuid,
      '22222222-2222-2222-2222-222222222222'::uuid,
      '2026-05-11'::date, 1000, 'garbage',
      'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid
    );
    RAISE NOTICE '   FAIL: garbage entry_method was accepted';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE '   PASS: CHECK constraint rejected garbage entry_method';
  END;
END $$;
ROLLBACK;

\echo ''
\echo '── 11 smoke tests complete ──'
