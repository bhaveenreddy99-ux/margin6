# New table checklist

Use this when adding a table in `public` (migrations, manual DDL, or Supabase SQL editor).

## Security

- [ ] **Row Level Security (RLS) is enabled** on the new table: `ALTER TABLE ... ENABLE ROW LEVEL SECURITY;`
- [ ] **Policies exist** for every access pattern (`SELECT`, `INSERT`, `UPDATE`, `DELETE` as needed) for `authenticated` and any other role that should use the table via PostgREST. Do not rely on table grants alone.
- [ ] **Never grant** `INSERT`, `UPDATE`, or `DELETE` on the new table to `anon` unless you have a documented, reviewed exception. Default posture: anon is **read-only** at the table level (see `20260425130000_revoke_anon_dml.sql`).
- [ ] If the table is referenced by a **foreign key** or RPC used from the app, confirm policies allow the same rows your app logic expects.
- [ ] **Service role** bypasses RLS; use only in trusted server code, not in the browser.

## PostgREST / API

- [ ] If the table should be exposed to the client, it is in `public` and listed where your API config expects (if you restrict exposed tables).
- [ ] **Realtime** (if used): add the table to the publication and confirm RLS applies to the subscription use case.

## Data and ops

- [ ] **Indexes** for common filters and joins.
- [ ] **Constraints** (NOT NULL, CHECK, unique) match domain rules.
- [ ] If you add **sensitive** columns, redact or avoid exposing them in views/RPCs used by the client.

## After migration

- [ ] Run the **RLS audit query** (see project security docs or the revoke migration notes) and confirm the new table does not appear in “RLS off” or “no policies” lists.
