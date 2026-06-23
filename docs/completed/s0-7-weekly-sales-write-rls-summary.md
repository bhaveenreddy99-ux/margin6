# Completed — S0-7: `weekly_sales` write policy (verify + re-assert + reconcile)

> **Date:** 2026-06-23
> **Workflow step:** STEP 6 — Final Review ([engineering-workflow.md](../engineering-workflow.md))
> **Roadmap item:** S0-7 (P0 Security) — [trust-first-roadmap.md](../trust-first-roadmap.md)
> **Investigation:** [investigations/s0-7-weekly-sales-write-rls.md](../investigations/s0-7-weekly-sales-write-rls.md) · **Plan:** [plans/s0-7-weekly-sales-write-rls-plan.md](../plans/s0-7-weekly-sales-write-rls-plan.md) · **Results:** [test-results/s0-7-weekly-sales-write-rls-results.md](../test-results/s0-7-weekly-sales-write-rls-results.md)

## 0. Read this first — what S0-7 actually was

**This was NOT a source bug fix.** The `weekly_sales`/`daily_sales` write policies in source **already enforce Manager+** (`has_restaurant_role_any(OWNER,MANAGER)` + membership + location). The roadmap/G4 claim that they used `is_member_of` (a "lying policy" like S0-6) was **stale/incorrect**. Verified against the current migration, git history (single unmodified commit), and a full drift check (no other migration touches these policies).

So S0-7 became: **(1) a defensive no-op re-assertion migration** to guarantee the *deployed* DB matches the correct source in every environment (the one thing source review can't confirm), and **(2) reconciling the stale P0 claim in the docs.** No existing source leak was fixed, because there wasn't one.

## 1. What changed

| File | Change |
|------|--------|
| `supabase/migrations/20260623000003_reassert_sales_write_manager_only.sql` | **New.** Idempotently DROP/CREATEs the 6 write policies (INSERT/UPDATE/DELETE × `weekly_sales` + `daily_sales`) with the **verbatim** existing Manager+ conditions. Header states explicitly it is a no-op/assertion, not a fix. SELECT read-gates untouched. |
| `docs/trust-first-roadmap.md` | S0-7 row + impl-order step 7 corrected: "not a leak; already Manager+; defensively re-asserted." |
| `docs/role-permission-matrix.md` | Part B "Write `weekly_sales`" row → ✅ Manager+; Part C G4 struck through as corrected; "two policies lie" pattern note → "one lied (G3); G4 claim was stale." |

**No app/UI code, no new helper, no schema/data change.** `product-reality.md` needed no edit (it never claimed a weekly_sales write leak — only manual/POS food-cost notes).

## 2. Why ship a migration if source is already correct?

The repo cannot inspect the **deployed** database. If any environment ever had a looser policy applied (an older draft, or a manual `ALTER POLICY`), source review alone can't catch it. The idempotent re-assertion makes the running DB **provably** carry the Manager+ write policies after it applies — environment-independent — at zero behavior cost where source is already right. The conditions are copied verbatim from [20260518000001:207-281](../../supabase/migrations/20260518000001_sales_entry.sql#L207) so the re-assertion cannot weaken the posture.

## 3. Decisions applied (per approval)
- **Defensive re-assertion migration** (not doc-only).
- **Both `weekly_sales` + `daily_sales`** (identical posture; daily_sales feeds the weekly digest).
- **Doc corrections** for the stale P0 claim.
- Made the no-op/assertion nature explicit; did **not** present this as fixing a source leak.

## 4. Verification asks (answered)
- **Current write policies:** Manager+ (`has_restaurant_role_any(OWNER,MANAGER)`) AND membership AND `user_can_access_location` — INSERT/UPDATE/DELETE, both tables.
- **Name vs rule:** name "Managers+" **matches** the rule — no lie (contrast S0-6).
- **Who should create/edit/delete:** OWNER/MANAGER with location access — exactly what's enforced.
- **STAFF API write access:** **none** — the role conjunct blocks STAFF.
- **Migration risk & rollback:** §6.

## 5. Verification results
- **CI regression:** `tsc --noEmit` clean; `vitest run` **482 passed** (no app code touched).
- **RLS matrix + `pg_policies` shape assertion:** documented with runnable SQL in the results doc; **pending execution** at `supabase db reset` / staging (no DB/`psql` here). The shape assertion doubles as the deployed-DB drift check.

## 6. What risk remains & rollback
- **Residual:** until the migration is applied + the `pg_policies` assertion run on each environment, the deployed-state guarantee is pending. (Source is correct regardless.)
- **Rollback:** revert the migration (and doc edits). Trivial, no data touched. **Unlike S0-5/S0-6, rollback does NOT re-open a source leak** — it only removes the environment guarantee.

## 7. What should be done next
1. **At deploy:** apply the migration; run the `pg_policies` shape assertion + role matrix to confirm Manager+ everywhere.
2. **Proceed to S0-8** (`notifications` INSERT has no `user_id` check) — a **genuine** open leak (any member can forge alerts to any user). *(Not started, per instruction.)*

## 8. Pending deploy co-requisites carried from earlier S0 items (none deployed yet)
- **S0-2:** set `app.settings.service_role_key` GUC, or pg_cron notifications stop.
- **S0-3:** set `RESEND_WEBHOOK_SECRET` + enable Resend signing, or inbound-email ingestion stops.
- **S0-5 / S0-6 / S0-7:** run the RLS verification matrices at deploy (no secret/config co-requisite).
