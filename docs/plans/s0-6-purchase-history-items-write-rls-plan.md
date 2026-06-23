# Plan — S0-6: Restrict `purchase_history_items` writes to Manager+ (fix the lying policy)

> **Date:** 2026-06-23
> **Roadmap item:** S0-6 (P0 Security), effort **S** — [trust-first-roadmap.md](../trust-first-roadmap.md)
> **Workflow step:** STEP 3 — Create Plan ([engineering-workflow.md](../engineering-workflow.md))
> **Investigation:** [s0-6-purchase-history-items-write-rls.md](../investigations/s0-6-purchase-history-items-write-rls.md)
> **Status:** Awaiting approval — **one decision required (§2)** — no code changed yet.

## 1. Root cause (one line)

`purchase_history_items` INSERT/DELETE policies are named "Manager+" but use `is_member_of(...)`, so STAFF can write/delete purchase line items via the API; the parent `purchase_history` is correctly Manager+ but the child was never converted.

## 2. Decision required

**Add a Manager+ UPDATE policy to the child?**
- **Include (recommended):** matches the parent (which has Manager+ UPDATE) and **repairs the invoice-review catalog-mapping update** (`useInvoiceReviewActions.ts:263`), which is currently silently blocked by RLS. Strictly safe — Manager+-only, on a StaffRestricted page; currently denied-for-all, so it only *enables* an intended Manager+ action.
- **Leak-only (defer UPDATE):** tighten INSERT/DELETE → Manager+ and leave UPDATE denied (status quo, no behavior change). Repair the mapping separately later.

This plan is written for **include UPDATE** (full parent-parity). If you choose leak-only, I drop the UPDATE policy from the migration.

## 3. Goal & success criteria

**Goal:** child write policies match the verified-correct parent — Manager+ for INSERT/UPDATE/DELETE, any member for SELECT — closing the STAFF direct-API write leak with no impact to legitimate flows.

Done when:
- STAFF `INSERT`/`DELETE` `purchase_history_items` via the API → **blocked**.
- OWNER/MANAGER `INSERT`/`UPDATE`/`DELETE` → allowed.
- (If included) MANAGER catalog-mapping UPDATE on invoice review persists.
- SELECT unchanged (any member).
- RPC-mediated creation unchanged (SECURITY DEFINER bypass).
- CI green (no app code); RLS verified via the role matrix (§8).

## 4. Chosen approach (Manager+ parity, include UPDATE)

One new migration `supabase/migrations/<ts>_restrict_purchase_history_items_write.sql`, reusing `has_restaurant_role_any` + the existing `purchase_history_restaurant_id()` scoping helper. **No app/UI change.**

```sql
-- INSERT: was is_member_of under a "Manager+" name → make it actually Manager+.
DROP POLICY IF EXISTS "Manager+ can create purchase history items" ON public.purchase_history_items;
CREATE POLICY "Manager+ can create purchase history items"
  ON public.purchase_history_items FOR INSERT TO authenticated
  WITH CHECK (has_restaurant_role_any(
    purchase_history_restaurant_id(purchase_history_id),
    ARRAY['OWNER'::public.app_role, 'MANAGER'::public.app_role]));

-- DELETE: same.
DROP POLICY IF EXISTS "Manager+ can delete purchase history items" ON public.purchase_history_items;
CREATE POLICY "Manager+ can delete purchase history items"
  ON public.purchase_history_items FOR DELETE TO authenticated
  USING (has_restaurant_role_any(
    purchase_history_restaurant_id(purchase_history_id),
    ARRAY['OWNER'::public.app_role, 'MANAGER'::public.app_role]));

-- UPDATE: add for parent-parity (repairs the Manager+ invoice-review mapping). [INCLUDE-decision]
DROP POLICY IF EXISTS "Manager+ can update purchase history items" ON public.purchase_history_items;
CREATE POLICY "Manager+ can update purchase history items"
  ON public.purchase_history_items FOR UPDATE TO authenticated
  USING     (has_restaurant_role_any(
    purchase_history_restaurant_id(purchase_history_id),
    ARRAY['OWNER'::public.app_role, 'MANAGER'::public.app_role]))
  WITH CHECK (has_restaurant_role_any(
    purchase_history_restaurant_id(purchase_history_id),
    ARRAY['OWNER'::public.app_role, 'MANAGER'::public.app_role]));

NOTIFY pgrst, 'reload schema';
```

Notes:
- SELECT policy left untouched (any member view — matches parent, correct).
- Same policy **names** reused for INSERT/DELETE (now the "Manager+" name is **true**).
- Idempotent `DROP … IF EXISTS` before each create.

## 5. Files affected

| # | File | Change | Risk |
|---|------|--------|------|
| 1 | `supabase/migrations/<ts>_restrict_purchase_history_items_write.sql` | **New** migration: INSERT/DELETE → Manager+ (+ Manager+ UPDATE) | Low (additive; no data; no client insert/delete affected) |
| 2 | — | **No app/UI change** | — |

No schema/column change, no data migration, no client change.

## 6. Risks & mitigations

- **R1 INSERT/DELETE break a legitimate flow** → none: no client INSERT exists (RPC-only, bypasses RLS); client DELETEs are on Owner/Manager+ routes.
- **R2 UPDATE behavior change** → only if included; it *enables* a currently-blocked Manager+ action (repair, not regression). Manager+/StaffRestricted-gated.
- **R3 leftover permissive policy** → `DROP IF EXISTS` exact names; verified no other write policy on the table.
- **R4 RPC creation** → unchanged (SECURITY DEFINER bypass); STAFF cannot reach those RPCs except where a separate item (S0-4) governs them.

## 7. Implementation order

1. Confirm the §2 decision (include UPDATE vs leak-only).
2. Add the migration (timestamp after the latest existing).
3. (No app changes.)
4. Apply via `supabase db reset` / staging; run the role matrix (§8).
5. `vitest` + `tsc` (regression — unaffected).

## 8. Test plan (preview — detailed in STEP 5)

RLS isn't unit-testable under vitest (no DB). Verify via SQL as each role (`supabase db reset` + seeded OWNER/MANAGER/STAFF), plus a deterministic policy-shape assertion.

| Actor | Operation | Expected |
|-------|-----------|:--------:|
| STAFF | `INSERT purchase_history_items` | blocked |
| STAFF | `DELETE purchase_history_items` | blocked |
| STAFF | `UPDATE purchase_history_items` | blocked |
| MANAGER | INSERT / UPDATE / DELETE | allowed |
| OWNER | INSERT / UPDATE / DELETE | allowed |
| any member | `SELECT` | allowed (unchanged) |
| RPC (smart-order submit / confirm-receipt) | creates items | works (SECURITY DEFINER, unchanged) |

Policy-shape assertion:
```sql
SELECT policyname, cmd, qual, with_check FROM pg_policies
WHERE schemaname='public' AND tablename='purchase_history_items'
ORDER BY cmd;
-- Expect SELECT=is_member_of; INSERT/UPDATE/DELETE=has_restaurant_role_any(OWNER,MANAGER); no is_member_of on writes.
```

- **Regression:** `vitest run` + `tsc --noEmit` green (no app code changed).
- **Migration sanity:** `supabase db reset` applies cleanly in order.
- **UI (manual, if UPDATE included):** Manager invoice-review catalog mapping for a `purchase_history_item_id` now persists.

## 9. Rollback strategy

Self-contained, no data touched. Roll back via a follow-up migration (or revert + redeploy) restoring `is_member_of` on INSERT/DELETE and dropping the added UPDATE policy. Instantaneous; nothing to backfill. (Rollback re-opens the P0.)

## 10. Final-review questions to answer at STEP 6

What changed · problem solved (STAFF can no longer forge/delete purchase line items; the lying policy name is corrected) · residual risk (UPDATE decision; RPC-path governance is S0-4) · next (S0-7 `weekly_sales`, same name-lie pattern).

> No application code was modified in producing this plan.
