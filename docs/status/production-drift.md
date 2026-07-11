# Production drift — GitHub vs live Supabase

**Project:** `margin6` (`ogbnctyctoujzdcfphad`)  
**Last verified:** 2026-07-11 (read-only SQL + repo inspection)

---

## Migration ledger drift

| Topic | GitHub | Production |
|-------|--------|------------|
| Logical migration count | 131 (+2 corrective files in unmerged work) | 131 applied |
| Latest invite migrations | Filenames `20260706`–`20260711` | Same SQL, versions `20260705194029`–`20260706210854` |
| Corrective location RLS | `20260712000001` (repo) | **Not applied** |
| Corrective anon RPC revoke | `20260712000002` (repo) | **Not applied** |

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
