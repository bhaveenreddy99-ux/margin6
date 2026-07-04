# Completed — S0-6: Restrict `purchase_history_items` writes to Manager+

> **Date:** 2026-06-23
> **Workflow step:** STEP 6 — Final Review ([engineering-workflow.md](../engineering-workflow.md))
> **Roadmap item:** S0-6 (P0 Security) — [trust-first-roadmap.md](../trust-first-roadmap.md)
> **Investigation:** [investigations/s0-6-purchase-history-items-write-rls.md](../investigations/s0-6-purchase-history-items-write-rls.md) · **Plan:** [plans/s0-6-purchase-history-items-write-rls-plan.md](../plans/s0-6-purchase-history-items-write-rls-plan.md) · **Results:** [test-results/s0-6-purchase-history-items-write-rls-results.md](../test-results/s0-6-purchase-history-items-write-rls-results.md)

## 1. What changed

A single new migration — **no app/UI code, no new helper, no schema/data change**:

| File | Change |
|------|--------|
| `supabase/migrations/20260623000002_restrict_purchase_history_items_write.sql` | **New.** Brings `purchase_history_items` write policies to Manager+ parity with the parent `purchase_history`, reusing `has_restaurant_role_any` + `purchase_history_restaurant_id`. |

Policy result on `purchase_history_items`:
- **INSERT** `"Manager+ can create purchase history items"` — was `is_member_of` → now `has_restaurant_role_any(OWNER, MANAGER)`. (Name is now true.)
- **DELETE** `"Manager+ can delete purchase history items"` — was `is_member_of` → now Manager+.
- **UPDATE** `"Manager+ can update purchase history items"` — **new** (was no policy → denied for all) → Manager+ (USING + WITH CHECK).
- **SELECT** `"Members can view purchase history items"` — **unchanged** (any member).

Each write policy is `DROP … IF EXISTS` then recreated; ends with `NOTIFY pgrst, 'reload schema'`.

## 2. What problem was solved

The INSERT/DELETE policies were **named** "Manager+" but used `is_member_of(...)`, so **STAFF could forge or delete purchase-history line items via the PostgREST API** (role-permission-matrix G3, a "lying" policy) — corrupting realized vendor cost/quantity data behind Period Spend, Food Cost %, and price comparisons. The child now matches the verified-correct parent model: **Manager+ for INSERT/UPDATE/DELETE, any member for SELECT.** Honors CLAUDE.md "RLS is the source of truth … never trust UI permissions."

Bonus: adding the previously-absent **UPDATE** policy repairs the invoice-review catalog-mapping update (`useInvoiceReviewActions.ts:263`, a Manager+ page) that RLS was silently blocking.

## 3. Decisions applied (per approval)
- **Manager+ for INSERT + DELETE** (close the STAFF leak).
- **Include Manager+ UPDATE** (full parent-parity; repairs the silently-blocked catalog mapping).
- SELECT unchanged; no UI change; no new helper.

## 4. Why it's safe (no legitimate flow broken)

- **No client INSERT** of `purchase_history_items` exists — creation is exclusively via `SECURITY DEFINER` RPCs (smart-order submit, confirm-receipt, PO sync) that **bypass RLS** → unaffected.
- Client **DELETE**s are on `/app/settings` (OwnerRoute) and `/app/smart-order` (StaffRestricted → Manager+) → unaffected.
- The client **UPDATE** is on `/app/invoices/:id/review` (StaffRestricted → Manager+) → now permitted (was blocked).
- STAFF have no UI to write these rows; they only lose the **direct table-API** write they should never have had.

## 5. Verification

- **CI regression:** `tsc --noEmit` clean; `vitest run` **482 passed** (no app code touched).
- **RLS matrix + UI checks:** documented with runnable SQL + a deterministic `pg_policies` shape assertion in the results doc; **pending execution** at `supabase db reset` / staging (no DB/`psql` in this sandbox).
- **RPC creation path unaffected:** SECURITY DEFINER bypass confirmed.

## 6. What risk remains

- **Verification not yet executed against a DB** — logic reuses proven helpers and mirrors the working parent policies, but run the role matrix at `supabase db reset` / staging before relying on it. (No data risk: additive policy change.)
- **RPC-mediated creation governance is out of scope** — S0-6 closes only the direct table-API write leak. Whether a STAFF can trigger creation via an RPC (e.g. `submit_smart_order`) is governed by that RPC's own checks (S0-4), not this change.
- **Migration ordering:** `20260623000002` sorts after S0-5's `20260623000001` and the latest pre-existing (`20260528000001`).

## 7. Rollback

Self-contained, no data touched. Roll back via a follow-up migration (or revert + redeploy) restoring `is_member_of` on INSERT/DELETE and dropping the added UPDATE policy. Instantaneous; nothing to backfill. (Rollback re-opens the P0.)

## 8. What should be done next

1. **At deploy:** run the RLS verification matrix + UI checks; confirm the `pg_policies` shape assertion.
2. **Proceed to S0-7** (`weekly_sales` write — same "name lies" pattern: policies named "Managers+" but clause `is_member_of`). *(Not started, per instruction.)*

## 9. Pending deploy co-requisites carried from earlier S0 items (none deployed yet)
- **S0-2:** set `app.settings.service_role_key` GUC, or pg_cron notifications stop.
- **S0-3:** set `RESEND_WEBHOOK_SECRET` + enable Resend signing, or inbound-email ingestion stops.
- **S0-5 / S0-6:** none beyond running the RLS verification matrices at deploy.
