# Plan — S0-7: `weekly_sales` write policy (verify + reconcile)

> **Date:** 2026-06-23
> **Roadmap item:** S0-7 (P0 Security), effort **S** — [trust-first-roadmap.md](../trust-first-roadmap.md)
> **Workflow step:** STEP 3 — Create Plan ([engineering-workflow.md](../engineering-workflow.md))
> **Investigation:** [s0-7-weekly-sales-write-rls.md](../investigations/s0-7-weekly-sales-write-rls.md)
> **Status:** Awaiting approval — **decisions required (§2)** — no code changed yet.

## 1. Root cause (one line)

There is **no leak in source**: `weekly_sales`/`daily_sales` write policies already enforce `has_restaurant_role_any(OWNER,MANAGER)` (+ location scoping). The roadmap/G4 claim of an `is_member_of` clause is **stale/incorrect**. S0-7 is therefore a *verification + documentation reconciliation*, not a bug fix — with one open question about the **deployed** DB I cannot inspect from here.

## 2. Decisions required

**Decision 1 — how to close S0-7:**
- **(A) Doc-correction only** — declare S0-7 already-satisfied in source; correct the stale docs; verify the deployed DB out-of-band via a `pg_policies` query. No migration. *(Minimal; trusts that migrations applied unaltered.)*
- **(B) Defensive idempotent re-assertion migration + doc-correction (recommended for a P0)** — ship a migration that DROP/CREATEs the **same** Manager+ write policies, guaranteeing the deployed DB matches correct source in **every** environment (closes the "what if prod drifted?" gap), and correct the docs. Zero behavior change where source is already right.

**Decision 2 — scope of any re-assertion (only if B):**
- **weekly_sales + daily_sales** (recommended — identical sibling, same posture, feeds the weekly digest), or
- **weekly_sales only** (literal S0-7 scope).

This plan is written for **(B) + both tables** (security-first, environment-independent guarantee). If you pick (A) or weekly_sales-only, I adjust accordingly.

## 3. Goal & success criteria

**Goal:** S0-7 verifiably closed — STAFF cannot write sales via the API in **any** environment, and the audit docs match reality.

Done when:
- `weekly_sales` (and `daily_sales`, if B+both) write policies are confirmed/guaranteed to require `has_restaurant_role_any(OWNER,MANAGER)`.
- Stale docs (roadmap S0-7/G4, role-permission-matrix Part B/G4, product-reality Sales row) are corrected to state the writes are Manager+-gated.
- CI green; RLS verified via the role matrix (§7).

## 4. Chosen approach — (B) defensive re-assertion + doc fix

**4a. Migration** `supabase/migrations/<ts>_reassert_sales_write_manager_only.sql` — idempotently re-create the **write** policies for both tables with the **exact** existing conditions (no weakening), reusing existing helpers. Example (weekly_sales INSERT; UPDATE/DELETE and daily_sales analogous):
```sql
DROP POLICY IF EXISTS "Managers+ can insert weekly sales" ON public.weekly_sales;
CREATE POLICY "Managers+ can insert weekly sales"
  ON public.weekly_sales FOR INSERT TO authenticated
  WITH CHECK (
    is_member_of(restaurant_id)
    AND user_can_access_location(auth.uid(), location_id)
    AND has_restaurant_role_any(restaurant_id, ARRAY['OWNER'::app_role, 'MANAGER'::app_role])
  );
-- … UPDATE (USING + WITH CHECK), DELETE (USING) — identical role+location conjunction …
-- … repeat the three write policies for public.daily_sales …
-- SELECT policies are NOT touched (read-gate, out of S0-7 scope).
NOTIFY pgrst, 'reload schema';
```
The conditions are copied verbatim from [20260518000001:207-281](../../supabase/migrations/20260518000001_sales_entry.sql#L207) so the re-assertion cannot weaken the posture; it only guarantees it.

**4b. Doc correction** (separate, non-code) — update:
- `trust-first-roadmap.md` S0-7 row → "verified already Manager+ in source; re-asserted defensively" (or "CLOSED — already correct").
- `role-permission-matrix.md` G4 + Part B `weekly_sales` row → change from "name lies / is_member_of" to "Manager+ enforced (name accurate)".
- `product-reality.md` Sales/`weekly_sales` write note → corrected.

## 5. Files affected

| # | File | Change | Risk |
|---|------|--------|------|
| 1 | `supabase/migrations/<ts>_reassert_sales_write_manager_only.sql` | **New** (only if B) — idempotent re-assert of 6 write policies (3 per table) | Very low (no behavior change; must copy conditions exactly) |
| 2 | docs (roadmap, role-permission-matrix, product-reality) | Correct the stale "leak" claims | None (docs) |
| 3 | — | **No app/UI change** | — |

No schema/column change, no data migration.

## 6. Risks & mitigations

- **R1 — re-assertion accidentally weakens a policy.** → Copy the three conjuncts verbatim (member AND location AND role); review the diff against the original block; the role matrix (§7) catches any STAFF allow.
- **R2 — doc-only (A) leaves a drifted prod open.** → mitigated only by an out-of-band `pg_policies` check; (B) removes this risk entirely.
- **R3 — touching SELECT by mistake.** → re-assert **write** policies only; leave the read-gate untouched.
- **Rollback:** trivial — the policies are functionally unchanged; revert the migration. No data touched.

## 7. Test plan (preview — detailed in STEP 5)

RLS not unit-testable under vitest. Verify via SQL as each role (`supabase db reset` / staging) + a deterministic `pg_policies` assertion.

| Actor | Op (weekly_sales & daily_sales) | Expected |
|-------|----------------------------------|:--------:|
| STAFF | INSERT / UPDATE / DELETE | blocked |
| MANAGER (with location access) | INSERT / UPDATE / DELETE | allowed |
| OWNER | INSERT / UPDATE / DELETE | allowed |
| any member w/ access | SELECT | allowed (unchanged) |

Policy-shape assertion (also serves to confirm the deployed DB, addressing the §6-R2 gap):
```sql
SELECT tablename, policyname, cmd, with_check, qual
FROM pg_policies
WHERE schemaname='public' AND tablename IN ('weekly_sales','daily_sales') AND cmd <> 'SELECT'
ORDER BY tablename, cmd;
-- Every write policy must contain has_restaurant_role_any(..., ARRAY['OWNER','MANAGER']);
-- NONE may be is_member_of-only.
```
- **Regression:** `vitest run` + `tsc --noEmit` green (no app code).
- **Migration sanity:** `supabase db reset` applies cleanly.

## 8. Rollback strategy

Self-contained, no data touched. Revert the re-assertion migration (or, for doc-only, revert the doc edits). Instantaneous. Note: unlike S0-5/S0-6, rolling back does **not** re-open a leak in source (source was already correct); it only removes the environment guarantee.

## 9. Final-review questions to answer at STEP 6

What changed (verification + optional re-assertion + doc reconciliation) · problem solved (confirmed STAFF cannot write sales; corrected a stale P0 claim) · residual risk (deployed-DB confirmation if doc-only) · next (S0-8 `notifications` INSERT no `user_id` check — a genuine open leak).

> No application code was modified in producing this plan.
