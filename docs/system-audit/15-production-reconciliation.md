# Production reconciliation — repository vs live Supabase

**Live project:** `margin6` (`ogbnctyctoujzdcfphad`) · Postgres 17 · `us-east-1`  
**Repository branch audited:** `main`  
**Live migration count:** 131  
**Repository migration count:** 131  
**Live head:** `20260706210854_get_invite_preview_rpc`  
**Repository head:** `20260711000001_get_invite_preview_rpc`

## Executive summary

Production and the repository share the **same logical migration history** (131 versions each) but **six recent invite-related migrations differ only by timestamp**. No repository-only SQL objects were found beyond those renamed versions. **Do not apply repository-only timestamps to production** — production already has equivalent objects under different version numbers.

New corrective migrations created in this epic (not yet on production):

| Migration | Purpose |
|-----------|---------|
| `20260712000001_location_select_rls_scoped.sql` | Close manager/staff location listing leak |
| `20260712000002_revoke_unintentional_anon_rpc_exec.sql` | Re-assert authenticated-only EXECUTE on sensitive RPCs |

## Drift classification

| Situation | Finding |
|-----------|---------|
| Production behind repository | **No** — same 131 logical steps |
| Same migration, different timestamp | **Yes** — 6 invite migrations (see table below) |
| Repository renamed migrations | **Yes** — repo uses `20260706–20260711` block; prod uses `20260705–20260706210854` |
| Production manual changes | **Possible** — anon EXECUTE grants persist on several RPCs despite repo revoke migrations; grant drift, not missing migrations |
| Generated TypeScript types stale | **Not verified in this pass** — run `supabase gen types` after staging apply and diff |
| Duplicate migrations | **One historical duplicate on both sides:** `add_invoice_email_restaurant_settings` at `20260329119000` and `20260329120000` |
| Unsafe to apply repo-only timestamps | **Yes** — would fail or noop on objects already present |

## Reconciliation table — timestamp drift (invite slice)

| Repository migration | Live migration | Objects affected | Equivalent | Safe to apply repo version | Required action |
|----------------------|----------------|----------------|------------|---------------------------|-----------------|
| `20260706000001_restrict_restaurant_members_owner_self_insert.sql` | `20260705194029_restrict_restaurant_members_owner_self_insert` | Policy `Owners can insert members` on `restaurant_members` | **Yes** (same intent) | **No** — already applied under live version | **No action** on production |
| `20260707000001_restaurant_invites_table.sql` | `20260706201837_restaurant_invites_table` | Table `restaurant_invites`, enum `restaurant_invite_status`, indexes, RLS | **Yes** | **No** | **Documentation correction** — treat as renamed |
| `20260708000001_create_invite_rpc.sql` | `20260706202033_create_invite_rpc` | `create_invite(...)`, grants | **Yes** | **No** | **Rename/reconcile history** in docs/CI only |
| `20260709000001_accept_invite_rpc.sql` | `20260706202237_accept_invite_rpc` | `accept_invite(p_token)` | **Yes** | **No** | **Rename/reconcile history** |
| `20260710000001_invite_support_rpcs.sql` | `20260706202359_invite_support_rpcs` | `list_invites`, `resend_invite`, `revoke_invite` | **Yes** | **No** | **Rename/reconcile history** |
| `20260711000001_get_invite_preview_rpc.sql` | `20260706210854_get_invite_preview_rpc` | `get_invite_preview(p_token)` | **Mostly yes** — repo adds explicit `SET search_path = public, pg_temp` and `REVOKE ALL FROM public` | **No** — function exists; optional **new corrective migration** if prod body lacks hardened search_path | **Manual investigation** — diff live function body vs repo; apply hardening only if prod differs |

## Reconciliation table — epic corrective migrations (repository only)

| Repository migration | Live migration | Objects affected | Equivalent | Safe to apply | Required action |
|----------------------|----------------|----------------|------------|---------------|-----------------|
| `20260712000001_location_select_rls_scoped.sql` | — | Policies on `locations`, `location_settings` | **No** | **Yes** after staging verification | **New corrective migration** — deploy via normal pipeline |
| `20260712000002_revoke_unintentional_anon_rpc_exec.sql` | — | EXECUTE grants on 11 RPCs | **Partial** — prod may already match intent for some; verified anon drift on others | **Yes** after dependency check | **New corrective migration** |

## Shared history notes

- Versions `20260212001141` through `20260701000001` align by version string on both sides (125 migrations).
- Production duplicate `20260329119000` / `20260329120000` (`add_invoice_email_restaurant_settings`) also exists in the repository — idempotent `IF NOT EXISTS` patterns; **no action** unless a future cleanup migration is scheduled.
- Edge Functions were **not** compared byte-for-byte in this pass; deployment is out of scope for this epic.

## Idempotency review (drift block)

All six invite-slice migrations use `CREATE OR REPLACE`, `DROP POLICY IF EXISTS`, or `CREATE TABLE IF NOT EXISTS` patterns. Re-applying under a new timestamp on production would **not corrupt data** but would **fail migration tracking** (version already applied under another name) or create noop churn. **Do not edit `supabase_migrations.schema_migrations` to fake alignment.**

## Generated types

After staging apply of `20260712000001` and `20260712000002`:

1. Run `supabase gen types typescript --local` (staging linked project).
2. Diff `src/integrations/supabase/types.ts` (or project convention).
3. Expect **no schema type changes** from grant-only migration; possible comment-only drift.

## Recommended repository hygiene (no production change)

1. Add CI check: compare migration **names** (suffix) between environments, not only version prefixes.
2. Document that production deploy timestamps may differ from repo filenames when applied via Supabase dashboard or squashed releases.
3. Keep repo filenames stable; do **not** rename the six invite files to match production timestamps (would break fresh local installs mid-history).

## Decision log

| Question | Answer |
|----------|--------|
| Is production behind? | **No** (logical parity) |
| Is it safe to run `20260711000001` on production? | **No** — duplicate of live `20260706210854` |
| Is grant drift a migration gap? | **Yes** — `20260623000005` revoke for `get_location_permissions` did not stick for anon; addressed in `20260712000002` |
| Must location RLS ship before dashboard trust work? | **Independent** — dashboard loader fixes are frontend; location fix is RLS |
