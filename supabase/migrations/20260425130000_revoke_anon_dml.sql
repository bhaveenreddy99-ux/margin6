-- All tables must have RLS enabled. anon is untrusted: read-only (SELECT) at the
-- table-privilege level; writes go through the PostgREST session role
-- (authenticated) or service role as appropriate.
--
-- Revokes prior broad grants from 20260212010647_grant_public_tables_anon_authenticated.sql
-- and 20260212014041_grant_sequences_default_privileges.sql (and per-table GRANT ... TO anon).

REVOKE INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public FROM anon;

-- Future tables: do not grant DML to anon by default
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE INSERT, UPDATE, DELETE ON TABLES FROM anon;
