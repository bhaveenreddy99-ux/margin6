-- =============================================================================
-- Bootstrap a minimal Supabase-like Postgres for sales-entry smoke tests.
-- Replaces what the supabase CLI normally provides (auth schema, auth.uid),
-- avoiding the unrelated min(uuid) divergence in migration 20260307000002.
--
-- This file is LOCAL-TEST-ONLY. It is not pushed to prod.
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ── Minimal auth schema (supabase normally creates this) ──────────────────────
CREATE SCHEMA IF NOT EXISTS auth;

CREATE TABLE IF NOT EXISTS auth.users (
  id uuid PRIMARY KEY,
  instance_id uuid,
  email text,
  aud text,
  role text,
  raw_user_meta_data jsonb,
  created_at timestamptz DEFAULT now()
);

-- auth.uid() — same shape as supabase ships, reads JWT claim sub.
CREATE OR REPLACE FUNCTION auth.uid()
RETURNS uuid
LANGUAGE sql
STABLE
AS $$
  SELECT
    COALESCE(
      nullif(current_setting('request.jwt.claim.sub', true), ''),
      (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
    )::uuid;
$$;

-- ── authenticated role (Supabase ships this; we need it for RLS impersonation)─
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    CREATE ROLE authenticated NOINHERIT;
  END IF;
END $$;

-- Grant the role schema visibility so RLS-gated SELECTs can resolve relations.
GRANT USAGE ON SCHEMA public TO authenticated;
GRANT USAGE ON SCHEMA auth TO authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO authenticated;

\echo 'Bootstrap complete.'
