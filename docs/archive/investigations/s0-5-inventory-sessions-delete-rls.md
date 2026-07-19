# Investigation — S0-5: `inventory_sessions` DELETE open to STAFF

> **Date:** 2026-06-23
> **Roadmap item:** S0-5 (P0 Security), [trust-first-roadmap.md](../trust-first-roadmap.md)
> **Workflow step:** STEP 2 — Investigate ([engineering-workflow.md](../engineering-workflow.md))
> **Status:** Investigation complete — no code changed.

## 1. Summary

The `inventory_sessions` DELETE RLS policy grants **any restaurant member — including STAFF — the right to delete any session in any status (including APPROVED)** via the PostgREST API, even though the UI hides the explicit "Delete" action from STAFF. Count sessions are the immutable basis of inventory value, overstock, and reorder math, so this lets a low-privilege user destroy the records the dashboard's money numbers are built on (role-permission-matrix G2; product-reality §2 "STAFF can DELETE `inventory_sessions` via API despite hidden UI button").

The fix is an RLS change. The investigation surfaced two things that shape it: **(a)** STAFF genuinely *do* rely on session DELETE for one workflow (clearing their own in-progress draft), so a blanket "Manager+ only" rule would break a real feature; and **(b)** a companion leak on the child table `inventory_session_items` means session-row protection alone is insufficient to actually protect count history.

## 2. Current RLS DELETE policy (verified)

**One live DELETE policy** on `inventory_sessions` (permissive policies are OR'd; I traced the full history to confirm there is exactly one):

```sql
-- supabase/migrations/20260306000002_rls_core_inventory.sql:252-255
DROP POLICY IF EXISTS "Members can delete sessions" ON public.inventory_sessions;
CREATE POLICY "Members can delete sessions"
  ON public.inventory_sessions FOR DELETE TO authenticated
  USING (is_member_of(restaurant_id));
```

`is_member_of` ([20260212001141:61-72](../../supabase/migrations/20260212001141_initial_schema_core_rls.sql#L61)) returns true for **any** row in `restaurant_members` for the caller — no role check. So OWNER, MANAGER, and **STAFF** all pass, for **any status**.

**Policy history (so the fix drops the right thing):**
1. [20260219140640](../../supabase/migrations/20260219140640_inventory_session_delete_in_progress.sql) created `"Members can delete in-progress sessions"` = `is_member_of(restaurant_id) AND status = 'IN_PROGRESS'` (the original, safer intent).
2. [20260222022439](../../supabase/migrations/20260222022439_inventory_sessions_delete_policy.sql) **dropped** that and created `"Members can delete sessions"` = `is_member_of(restaurant_id)` — **widening delete to any status**. ← the regression.
3. [20260306000002:252-255](../../supabase/migrations/20260306000002_rls_core_inventory.sql#L252) idempotently re-created the same `"Members can delete sessions"` (`is_member_of`).

→ Effective state today: a single `"Members can delete sessions"` policy, any member, any status. The earlier in-progress-only policy is already dropped.

**Contrast — the model the rest of the table already uses:** UPDATE is correctly split — `"Manager+ can update sessions"` (`has_restaurant_role_any(OWNER,MANAGER)`, any session, [20260306000002:361-365](../../supabase/migrations/20260306000002_rls_core_inventory.sql#L361)) **plus** a separate STAFF "in-progress only" update policy. DELETE never got that split — it stayed wide open.

## 3. Root cause

Migration `20260222022439` widened member-delete from **IN_PROGRESS-only** to **any status** (likely to let managers delete completed sessions), but did so for **all members** instead of adding a role split. The result: STAFF can delete APPROVED/IN_REVIEW count history via the API. The UI compensated by hiding the explicit Delete button from STAFF (UI-only gate — the dominant pattern in role-permission-matrix), but RLS — the real gate — stayed open.

## 4. Does any UI depend on STAFF delete? (verified — yes, partially)

There are **two** distinct UI delete affordances, with different role exposure:

| UI action | Handler | Reachable by STAFF? | Session status it targets |
|-----------|---------|:-------------------:|---------------------------|
| **"Clear" in-progress draft** (count landing hub) | `handleClearInProgressSession` ([useSessionCommands.ts:337-345](../../src/features/inventory-count/hooks/useSessionCommands.ts#L337)) | **YES** | The caller's IN_PROGRESS session |
| **"Delete session"** (Review / Approved pages) | `handleDeleteSession` ([useSessionCommands.ts:324-335](../../src/features/inventory-count/hooks/useSessionCommands.ts#L324)) | No (Manager+ only) | Any |

Evidence:
- `/app/inventory/enter` is **not** `StaffRestricted` ([App.tsx:114](../../src/App.tsx#L114)) — STAFF use the count page. `/review` and `/approved` **are** Manager+ ([App.tsx:115-116](../../src/App.tsx#L115)).
- The **"Clear" button** lives in `InventoryHubSessions`, which **does not receive `isManagerOrOwner` at all** and renders the button unconditionally whenever there is a focus IN_PROGRESS session ([InventoryHubSessions.tsx:255-266](../../src/features/inventory-count/components/InventoryHubSessions.tsx#L255)). So STAFF can click "Clear" → `handleClearInProgressSession` → `DELETE inventory_session_items` then `DELETE inventory_sessions` (their own IN_PROGRESS draft).
- The explicit **"Delete session"** is in the Manager+-gated sessions list (`isManagerOrOwner` passed at [InventoryCountPage.tsx:622-639](../../src/features/inventory-count/pages/InventoryCountPage.tsx#L622)) and on the StaffRestricted Review/Approved pages.
- **Rollback paths**: the duplicate-session flow deletes a *just-created* (IN_PROGRESS) session on failure ([sessionWorkflow.ts:445,464](../../src/domain/inventory/sessionWorkflow.ts#L445)) — also an IN_PROGRESS delete.

**Implication:** a blanket "Manager+ only" DELETE policy (model A) would **break the STAFF "Clear" workflow** (button present → API 403 → error toast). The design-consistent fix is to mirror the UPDATE split (model B, §7).

## 5. Do server RPCs still work? (verified — yes)

Both RPCs that delete sessions are `SECURITY DEFINER` and bypass RLS, so they are **unaffected** by tightening the policy:
- `delete_restaurant_cascade` — `SECURITY DEFINER`, checks `role = 'OWNER'` ([20260214021402:7-37](../../supabase/migrations/20260214021402_delete_restaurant_cascade.sql#L7)).
- `delete_inventory_list` — `security definer` ([20260417000001:5-9](../../supabase/migrations/20260417000001_delete_inventory_list_rpc.sql#L5)).

## 6. Companion leak — `inventory_session_items` DELETE (important)

The child table is **also** member-deletable for any session:
```sql
-- 20260212003221_rls_policies_authenticated.sql:63
CREATE POLICY "Members can delete session items" ON public.inventory_session_items
  FOR DELETE TO authenticated USING (is_member_of(session_restaurant_id(session_id)));
```
So even if we lock the `inventory_sessions` **row** to Manager+, **STAFF could still delete every line item of an APPROVED session** directly via the API — destroying the same count history the fix is meant to protect (the session row would survive, but empty). The FK is `ON DELETE CASCADE` ([20260212001141:162](../../supabase/migrations/20260212001141_initial_schema_core_rls.sql#L162)), so deleting a session removes its items automatically; that cascade runs with the deleter's row already authorized, independent of the child policy. **To genuinely achieve S0-5's goal ("protect count history"), the child DELETE must be tightened to the same rule.** (The UI's two delete handlers already delete `inventory_session_items` first, both on IN_PROGRESS or Manager+ paths — so a matching child rule does not break them.)

## 7. Target model — recommendation

Mirror the existing UPDATE split (and restore the original `20260219140640` intent):

**Model B (recommended):** Manager+ may delete **any** session; a non-manager member may delete **only IN_PROGRESS** sessions.
```sql
USING (
  has_restaurant_role_any(restaurant_id, ARRAY['OWNER'::app_role, 'MANAGER'::app_role])
  OR (is_member_of(restaurant_id) AND status = 'IN_PROGRESS')
)
```
- ✅ STAFF cannot delete APPROVED/IN_REVIEW history (the P0).
- ✅ STAFF "Clear my in-progress draft" keeps working.
- ✅ Manager+ delete any (Review/Approved delete, cleanup, duplicate rollback).
- ✅ Consistent with the UPDATE policy split; matches current UI gating exactly.

**Model A (strict, literal roadmap "Manager+ only"):**
```sql
USING (has_restaurant_role_any(restaurant_id, ARRAY['OWNER'::app_role, 'MANAGER'::app_role]))
```
- ✅ Simplest; STAFF cannot delete anything via API.
- ❌ **Breaks the STAFF "Clear" workflow** unless the UI is also changed (hide "Clear" for STAFF, or route it through a status-checked RPC). Would need a paired UI change to avoid a broken button.

> The user's verification asks ("STAFF cannot delete via API" vs "check if any UI depends on STAFF delete") point in opposite directions precisely because of the Clear workflow. **Decision required** — captured in the plan.

## 8. Business impact

- **Destroyed count history** — STAFF (or a compromised STAFF account) can `DELETE` APPROVED sessions, erasing the source of Inventory Value, Overstock, Reorder, and any KPI derived from counts. Irreversible without backups.
- **Silent data integrity loss** — deletions leave no audit trail; downstream money numbers silently change.
- **Trust violation** — CLAUDE.md "RLS is the source of truth … never trust UI permissions." P0 pilot gate.

## 9. User impact

- An owner could find historical/approved counts missing with no record of who removed them.
- Dashboards recompute against whatever counts remain → wrong inventory value / overstock.
- **No legitimate STAFF workflow is lost under model B** (the only STAFF delete — clearing an in-progress draft — is preserved). Under model A, STAFF "Clear" breaks unless the UI is updated.

## 10. Affected components

| Layer | File | Note |
|-------|------|------|
| RLS (target) | [20260306000002:252-255](../../supabase/migrations/20260306000002_rls_core_inventory.sql#L252) | `"Members can delete sessions"` → replace with role-split policy |
| RLS (companion) | [20260212003221:63](../../supabase/migrations/20260212003221_rls_policies_authenticated.sql#L63) | `"Members can delete session items"` → tighten to match (recommended) |
| Role helper | [20260212001141:87-99](../../supabase/migrations/20260212001141_initial_schema_core_rls.sql#L87) | reuse `has_restaurant_role_any` (no new helper) |
| UI (no change in model B) | `useSessionCommands.ts`, `InventoryHubSessions.tsx` | STAFF "Clear" preserved; Manager+ delete unchanged |
| RPCs (unaffected) | `delete_restaurant_cascade`, `delete_inventory_list` | SECURITY DEFINER |

## 11. Affected tables

`inventory_sessions` (policy change) and, if the companion is included, `inventory_session_items` (policy change). No schema/column change; no data migration.

## 12. Migration risk & rollback

- **Risk R1 — break STAFF "Clear":** avoided by model B (allows member delete of IN_PROGRESS). Under model A this risk is real and needs a paired UI change.
- **Risk R2 — break Manager+ delete or RPC cascade:** none — Manager+ retains full delete; the two cascade RPCs are SECURITY DEFINER.
- **Risk R3 — leftover permissive policy:** mitigated by `DROP POLICY IF EXISTS` for both the current name and the legacy `"Members can delete in-progress sessions"` name before `CREATE`.
- **Risk R4 — companion gap:** if `inventory_session_items` is *not* tightened, the fix is bypassable (STAFF empties an APPROVED session's items). Recommend including it.
- **Rollback:** the change is a self-contained, additive migration (drop+create policies). To roll back, apply a follow-up migration (or revert the file and redeploy) that restores `USING (is_member_of(restaurant_id))`. **No data is touched**, so rollback is instantaneous and safe; nothing to backfill. (Note: rolling back re-opens the P0 — only do so if the fix demonstrably breaks a workflow.)

## 13. Open questions for the plan

1. **Model A vs B** (§7) — the core decision. Recommend **B** (preserves STAFF Clear, mirrors UPDATE split). — **needs user confirmation.**
2. **Include the `inventory_session_items` companion tightening?** Recommend **yes** (otherwise S0-5's goal is bypassable). — **needs user confirmation.**
3. Testability: RLS can't be unit-tested under vitest (no DB); plan documents a `psql`/Supabase role-based verification matrix.

## 14. Dependencies / sequencing

GATE green (confirmed in S0-1/2/3). Independent of S0-INFRA. Next Phase-1 item after S0-3. New migration file only; no app code required (model B).

> No application code was modified in producing this investigation.
