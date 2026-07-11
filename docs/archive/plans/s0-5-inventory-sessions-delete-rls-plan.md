# Plan — S0-5: Restrict `inventory_sessions` DELETE (protect count history)

> **Date:** 2026-06-23
> **Roadmap item:** S0-5 (P0 Security), effort **S** — [trust-first-roadmap.md](../trust-first-roadmap.md)
> **Workflow step:** STEP 3 — Create Plan ([engineering-workflow.md](../engineering-workflow.md))
> **Investigation:** [s0-5-inventory-sessions-delete-rls.md](../investigations/s0-5-inventory-sessions-delete-rls.md)
> **Status:** Awaiting approval — **two decisions required (§2)** — no code changed yet.

## 1. Root cause (one line)

The `inventory_sessions` DELETE policy is `is_member_of(restaurant_id)` (any member, any status), so STAFF can delete APPROVED count history via the API; migration `20260222022439` widened the original IN_PROGRESS-only rule to all statuses without a role split.

## 2. Decisions required before implementation

**Decision 1 — target model:**
- **Model B (recommended):** Manager+ delete any session; non-managers delete only IN_PROGRESS. Mirrors the existing UPDATE split, preserves the STAFF "Clear my draft" workflow, no UI change.
- **Model A (strict):** Manager+ only. Simplest, fully blocks STAFF — but **breaks the STAFF "Clear" button** ([InventoryHubSessions.tsx:255-266](../../src/features/inventory-count/components/InventoryHubSessions.tsx#L255)) unless a paired UI change hides/reroutes it.

**Decision 2 — companion `inventory_session_items` DELETE:**
- **Include (recommended):** tighten the child-table DELETE to the same rule, else STAFF can still empty an APPROVED session's line items via the API (S0-5's goal bypassable, investigation §6).
- **Defer:** session-row only; log the residual leak as a follow-up.

This plan is written for **Model B + include companion** (the root-cause-complete fix). If you choose A or defer, I'll adjust the migration accordingly before implementing.

## 3. Goal & success criteria

**Goal:** a STAFF API caller cannot delete APPROVED/IN_REVIEW sessions or their items; Manager+ retains full delete; the STAFF in-progress "Clear" workflow still works.

Done when:
- STAFF `DELETE inventory_sessions` of an APPROVED/IN_REVIEW row → **0 rows / blocked** by RLS.
- STAFF `DELETE inventory_sessions` of their own IN_PROGRESS row → **allowed** (Model B).
- OWNER/MANAGER `DELETE` any session → allowed.
- (Companion) STAFF `DELETE inventory_session_items` of a non-IN_PROGRESS session → blocked; of an IN_PROGRESS session → allowed.
- CI green (no app code changed); RLS verified via the role matrix (§8).

## 4. Chosen approach (Model B + companion)

One new migration `supabase/migrations/<ts>_restrict_inventory_session_delete.sql`, reusing `has_restaurant_role_any` (no new helper, no app change):

```sql
-- inventory_sessions: Manager+ delete any; members delete only IN_PROGRESS.
DROP POLICY IF EXISTS "Members can delete sessions" ON public.inventory_sessions;
DROP POLICY IF EXISTS "Members can delete in-progress sessions" ON public.inventory_sessions; -- legacy name, defensive
CREATE POLICY "Delete sessions: manager+ or own in-progress"
  ON public.inventory_sessions FOR DELETE TO authenticated
  USING (
    has_restaurant_role_any(restaurant_id, ARRAY['OWNER'::app_role, 'MANAGER'::app_role])
    OR (is_member_of(restaurant_id) AND status = 'IN_PROGRESS')
  );

-- inventory_session_items: same rule via the parent session's restaurant + status.
DROP POLICY IF EXISTS "Members can delete session items" ON public.inventory_session_items;
CREATE POLICY "Delete session items: manager+ or in-progress"
  ON public.inventory_session_items FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.inventory_sessions s
      WHERE s.id = inventory_session_items.session_id
        AND (
          has_restaurant_role_any(s.restaurant_id, ARRAY['OWNER'::app_role, 'MANAGER'::app_role])
          OR (is_member_of(s.restaurant_id) AND s.status = 'IN_PROGRESS')
        )
    )
  );

NOTIFY pgrst, 'reload schema';
```

Notes:
- The child policy uses an `EXISTS` against the parent session so the same role/status rule applies (the existing `session_restaurant_id(session_id)` helper only returns the restaurant, not status — an inline `EXISTS` carries both).
- `IN_PROGRESS` is the status string used throughout (`20260219140640`, the UPDATE split).
- Idempotent `DROP … IF EXISTS` for both current and legacy policy names so re-runs / mid-history environments converge.

## 5. Files affected

| # | File | Change | Risk |
|---|------|--------|------|
| 1 | `supabase/migrations/<ts>_restrict_inventory_session_delete.sql` | **New** migration: replace the two DELETE policies | Low (additive, no data) |
| 2 | — | **No app/UI change** under Model B | — |

No schema/column change, no data migration, no client change.

## 6. Risks & mitigations

- **R1 STAFF "Clear" breaks** → avoided by Model B's `IN_PROGRESS` allowance (and the companion keeps item-delete working for IN_PROGRESS). If Model A is chosen instead, a paired UI change is required (hide "Clear" for STAFF or reroute via RPC) — **flagged, not included here**.
- **R2 Manager+ / RPC cascade breaks** → none: Manager+ retains full delete; `delete_restaurant_cascade` and `delete_inventory_list` are SECURITY DEFINER (bypass RLS).
- **R3 leftover permissive policy** → defensive `DROP IF EXISTS` of both names before create; verify post-deploy that exactly one DELETE policy exists per table.
- **R4 child `EXISTS` performance** → DELETE is low-frequency and `session_id`/`id` are indexed (PK/FK); negligible.

## 7. Implementation order

1. Confirm Decisions 1 & 2.
2. Add the migration (timestamp after the latest existing migration).
3. (No app changes for Model B.)
4. Apply locally / to a branch DB if available; run the role verification matrix (§8).
5. Run `vitest` + `tsc` (regression — should be unaffected, no app code touched).

## 8. Test plan (preview — detailed in STEP 5)

RLS can't be exercised under vitest (no DB). Verification is via SQL as each role (local `supabase db reset` + seeded members, or a staging branch):

| Actor | Target | Operation | Expected |
|-------|--------|-----------|----------|
| STAFF | APPROVED session | `DELETE inventory_sessions` | blocked (0 rows) |
| STAFF | IN_REVIEW session | `DELETE` | blocked |
| STAFF | own IN_PROGRESS session | `DELETE` | allowed |
| MANAGER | APPROVED session | `DELETE` | allowed |
| OWNER | any session | `DELETE` | allowed |
| STAFF | items of APPROVED session | `DELETE inventory_session_items` | blocked |
| STAFF | items of IN_PROGRESS session | `DELETE` | allowed |
| — | UI: STAFF "Clear" in-progress draft | end-to-end | still works (200) |
| — | UI: STAFF cannot see/exercise delete on Review/Approved | — | unchanged (StaffRestricted) |

- **Policy-shape assertion:** after migration, `SELECT polname, cmd FROM pg_policies WHERE tablename IN ('inventory_sessions','inventory_session_items') AND cmd='DELETE'` → exactly one DELETE policy each, with the new definition.
- **Regression:** `vitest run` + `tsc --noEmit` green (no app code changed).
- **Migration sanity:** `supabase db reset` (or lint) applies cleanly in order.

## 9. Rollback strategy

Self-contained, no data touched. To roll back: a follow-up migration (or revert + redeploy) restoring `USING (is_member_of(restaurant_id))` on both tables. Instantaneous; nothing to backfill. (Rolling back re-opens the P0 — only if the fix demonstrably breaks a workflow.)

## 10. Final-review questions to answer at STEP 6

What changed · problem solved (STAFF can no longer destroy approved count history) · residual risk (if companion deferred / if Model A chosen, UI follow-up) · next (S0-6 `purchase_history_items` write).

> No application code was modified in producing this plan.
