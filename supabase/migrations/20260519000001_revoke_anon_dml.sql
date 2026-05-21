-- Revoke INSERT/UPDATE/DELETE/TRUNCATE from the anon role on all public tables.
-- Anon should never have write access; RLS is not a sufficient line of defense
-- when not every table has correct policies. Authenticated writes via the JS
-- client continue to work because supabase-js attaches the user JWT post-sign-in.
-- SELECT is intentionally retained for anon (public read flows may rely on it;
-- tighten per-table separately if needed).

REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON ALL TABLES IN SCHEMA public FROM anon;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLES FROM anon;
