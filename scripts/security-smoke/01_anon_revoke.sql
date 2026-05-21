-- Step A smoke: prove that supabase/migrations/20260519000001_revoke_anon_dml.sql
-- (a) blocks anon writes at the role-grant layer, and
-- (b) leaves authenticated DML intact.
--
-- This script is self-contained: it stands up a minimal public.restaurants
-- table, mirrors the pre-revoke grants from
-- 20260212010647_grant_public_tables_anon_authenticated.sql, then applies the
-- revoke and runs three assertions. Intended to run against a throwaway
-- Postgres instance so it does not depend on the full migration history
-- (which has a pre-existing min(uuid) bug unrelated to Day 1 security).

\set ON_ERROR_STOP on

-- Supabase ships with anon and authenticated roles by default; create them
-- here for bare Postgres parity.
DO $$ BEGIN
  CREATE ROLE anon NOLOGIN;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE ROLE authenticated NOLOGIN;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DROP TABLE IF EXISTS public.restaurants CASCADE;
CREATE TABLE public.restaurants (
  id       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name     text NOT NULL,
  owner_id uuid
);

-- Pre-revoke state, copied verbatim from
-- 20260212010647_grant_public_tables_anon_authenticated.sql.
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO anon;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO anon;

-- The migration under test.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON ALL TABLES IN SCHEMA public FROM anon;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLES FROM anon;

CREATE TEMP TABLE _smoke_results (idx int, label text, status text);

-- TEST 1: anon INSERT must be rejected with insufficient_privilege (42501).
DO $$
DECLARE v_outcome text;
BEGIN
  SET ROLE anon;
  BEGIN
    INSERT INTO public.restaurants (name, owner_id)
    VALUES ('anon-attempt', gen_random_uuid());
    v_outcome := 'FAIL: insert succeeded (anon still has DML)';
  EXCEPTION
    WHEN insufficient_privilege THEN
      v_outcome := 'PASS';
    WHEN OTHERS THEN
      v_outcome := 'FAIL: wrong sqlstate ' || SQLSTATE;
  END;
  RESET ROLE;
  INSERT INTO _smoke_results VALUES
    (1, 'anon INSERT -> expect 42501 insufficient_privilege', v_outcome);
END $$;

-- TEST 2: authenticated INSERT must NOT be blocked at the role-grant layer.
-- A success here, or any non-42501 error, proves the role grant survived.
-- A 42501 here would mean the revoke incorrectly stripped authenticated too.
DO $$
DECLARE v_outcome text; v_state text;
BEGIN
  SET ROLE authenticated;
  -- Stand in for a real Supabase JWT claim; nothing in this minimal schema
  -- reads it, but include it to match the smoke-test contract.
  PERFORM set_config(
    'request.jwt.claims',
    '{"sub":"00000000-0000-0000-0000-000000000001","role":"authenticated"}',
    true
  );
  BEGIN
    INSERT INTO public.restaurants (name, owner_id)
    VALUES ('auth-attempt', '00000000-0000-0000-0000-000000000001');
    v_outcome := 'PASS (insert succeeded; role-grant intact)';
  EXCEPTION
    WHEN insufficient_privilege THEN
      v_outcome := 'FAIL: authenticated lost INSERT (revoke too broad)';
    WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE;
      v_outcome := 'PASS (got ' || v_state ||
                   ', non-grant error means role-grant let it through)';
  END;
  RESET ROLE;
  INSERT INTO _smoke_results VALUES
    (2, 'authenticated INSERT -> expect success or non-42501', v_outcome);
END $$;

-- TEST 3: catalog-level confirmation that the role grant survived the revoke.
DO $$
DECLARE v_has boolean;
BEGIN
  SELECT has_table_privilege('authenticated', 'public.restaurants', 'INSERT')
  INTO v_has;
  INSERT INTO _smoke_results VALUES (
    3,
    'has_table_privilege(authenticated, restaurants, INSERT) -> expect true',
    CASE WHEN v_has THEN 'PASS' ELSE 'FAIL: authenticated lacks INSERT' END
  );
END $$;

-- Bonus catalog check: anon really did lose INSERT (belt-and-suspenders).
DO $$
DECLARE v_has boolean;
BEGIN
  SELECT has_table_privilege('anon', 'public.restaurants', 'INSERT')
  INTO v_has;
  IF v_has THEN
    RAISE WARNING 'Sanity: anon still has INSERT privilege after revoke (would have caught a missed REVOKE)';
  END IF;
END $$;

-- Pretty-print results + summary.
DO $$
DECLARE
  r record;
  n_pass int := 0;
  n_total int := 0;
BEGIN
  FOR r IN SELECT idx, label, status FROM _smoke_results ORDER BY idx LOOP
    n_total := n_total + 1;
    IF r.status LIKE 'PASS%' THEN
      n_pass := n_pass + 1;
      RAISE NOTICE '[TEST %/3] [PASS] %', r.idx, r.label;
    ELSE
      RAISE NOTICE '[TEST %/3] [FAIL] % -- %', r.idx, r.label, r.status;
    END IF;
  END LOOP;
  RAISE NOTICE '[SUMMARY] %/% passed', n_pass, n_total;
  IF n_pass <> n_total THEN
    RAISE EXCEPTION 'Smoke failed: %/% passed', n_pass, n_total;
  END IF;
END $$;
