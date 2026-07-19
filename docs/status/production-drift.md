# Production drift — GitHub vs live Supabase

**Project:** `margin6` (`ogbnctyctoujzdcfphad`)  
**Last verified:** 2026-07-11 (read-only SQL + repo inspection)

---

## Three states to keep separate

| State | What it means |
|-------|----------------|
| **GitHub `main` / this docs branch** | Committed application code and **131** migration files — intended implementation truth |
| **Uncommitted working tree** | May contain corrective SQL drafts (e.g. location RLS, anon grant revoke) **not** in any merged commit — do not cite as branch truth |
| **Live Supabase production** | Deployed schema, grants, and edge functions — deployed-state truth |

When these differ, **report drift** before changing production or claiming a fix is shipped.

---

## Migration ledger drift

| Topic | GitHub (`main` / docs branch) | Uncommitted working tree (if present) | Production |
|-------|--------------------------------|---------------------------------------|------------|
| Migration file count | **131** committed | May include draft `20260712000001` / `20260712000002` files locally — **not on branch** | **131** applied |
| Latest invite migrations | Filenames `20260706`–`20260711` | — | Same SQL, ledger versions `20260705194029`–`20260706210854` |
| Location SELECT RLS scoping | `is_member_of(restaurant_id)` on `locations` | Draft `20260712000001_location_select_rls_scoped.sql` may exist locally | **Not applied** — same as `main` |
| Anon RPC grant hardening | Grant drift documented in audit 16 | Draft `20260712000002_revoke_unintentional_anon_rpc_exec.sql` may exist locally | **Not applied** |

**Rule:** Do **not** apply repo-only timestamp filenames to production if equivalent objects already exist under different version strings. See [`../system-audit/15-production-reconciliation.md`](../system-audit/15-production-reconciliation.md).

**Rule:** Do **not** run `supabase migration repair` or broad `db push` without a reviewed plan, backup, and staging proof.

---

## Edge Function drift

| Function | Notes |
|----------|-------|
| `send-invite` | Repo source in `supabase/functions/send-invite/`. Production deploy status must be verified in Supabase dashboard before assuming parity. |
| `confirm_invoice_receipt` / receipt path | Multiple historical migrations; live function body may differ from latest repo migration filename. Diff before redeploy. |

Treat **production edge deploy** as potentially ahead or behind GitHub until byte-for-byte verification.

---

## Generated TypeScript types

`src/integrations/supabase/types.ts` is **known stale** for:

- `restaurant_invites` table
- `create_invite`, `resend_invite` RPCs

Regenerate only after staging schema sync: `supabase gen types typescript --linked` (with approval).

---

## Schema / behavior assumptions that may differ

| Assumption in repo/docs | Production reality |
|-------------------------|-------------------|
| Manager location isolation via `user_can_access_location` on `locations` | **Not on prod** — `is_member_of(restaurant_id)` only |
| `get_location_permissions` anon revoked | **Grant drift** — anon may still execute (see audit 16) |
| Legacy invite tables empty | **`invitations` has rows** — do not drop |
| `purchase_orders` authoritative | **Partial** — `purchase_history` and legacy paths still used |
| Dashboard inventory value matches DB | **Disputed** — trust defects documented in system audit |

---

## Reconciliation rules

1. **Read-only** query production before claiming “fixed in prod.”
2. Compare **migration names** (suffix), not only version prefixes.
3. Apply **new corrective migrations** through staging → prod pipeline; never edit ledger to fake alignment.
4. Diff **Edge Function** source on deploy target vs GitHub.
5. Update this file after each staging/prod verification.

---

## Explicit warnings

- **No** broad `supabase db push` to production from a laptop without review.
- **No** `migration repair` without confirming zero SQL re-execution.
- **No** dropping legacy invite tables while production row counts > 0.
