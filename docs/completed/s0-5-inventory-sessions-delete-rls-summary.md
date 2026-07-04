# Completed — S0-5: Restrict `inventory_sessions` DELETE (protect count history)

> **Date:** 2026-06-23
> **Workflow step:** STEP 6 — Final Review ([engineering-workflow.md](../engineering-workflow.md))
> **Roadmap item:** S0-5 (P0 Security) — [trust-first-roadmap.md](../trust-first-roadmap.md)
> **Investigation:** [investigations/s0-5-inventory-sessions-delete-rls.md](../investigations/s0-5-inventory-sessions-delete-rls.md) · **Plan:** [plans/s0-5-inventory-sessions-delete-rls-plan.md](../plans/s0-5-inventory-sessions-delete-rls-plan.md) · **Results:** [test-results/s0-5-inventory-sessions-delete-rls-results.md](../test-results/s0-5-inventory-sessions-delete-rls-results.md)

## 1. What changed

A single new migration — **no app/UI code, no new helper, no schema/data change**:

| File | Change |
|------|--------|
| `supabase/migrations/20260623000001_restrict_inventory_session_delete.sql` | **New.** Replaces the DELETE policy on `inventory_sessions` and `inventory_session_items` with a role+status split (Model B), reusing `has_restaurant_role_any` / `is_member_of`. |

**New `inventory_sessions` DELETE policy** — `"Delete sessions: manager+ or own in-progress"`:
```sql
USING (
  has_restaurant_role_any(restaurant_id, ARRAY['OWNER'::app_role, 'MANAGER'::app_role])
  OR (is_member_of(restaurant_id) AND status = 'IN_PROGRESS')
)
```
**New `inventory_session_items` DELETE policy** — `"Delete session items: manager+ or in-progress"`: same rule via an `EXISTS` on the parent session's `restaurant_id` + `status`.

Both drop the old `is_member_of` policies (and the legacy `"Members can delete in-progress sessions"` name, defensively) and `NOTIFY pgrst, 'reload schema'`.

## 2. What problem was solved

The DELETE policy was `is_member_of(restaurant_id)` (any member, **any status**), so STAFF could delete APPROVED/IN_REVIEW count sessions — the immutable basis of inventory value, overstock, and reorder math — via the PostgREST API, despite the UI hiding the button (role-permission-matrix G2). The companion `inventory_session_items` DELETE was equally open, so a session-row fix alone was bypassable. Now:
- **OWNER/MANAGER** delete any session/items (unchanged capability).
- **STAFF/member** delete **only their restaurant's IN_PROGRESS** sessions/items — preserving the "Clear my in-progress draft" workflow while blocking destruction of approved/review history.

This mirrors the table's existing UPDATE split and restores the original `20260219140640` intent. Honors CLAUDE.md "RLS is the source of truth … never trust UI permissions."

## 3. Decisions applied (per approval)
- **Model B** — Manager+ any; member only IN_PROGRESS. (Avoids breaking the STAFF "Clear" button, so **no UI change required**.)
- **Companion included** — `inventory_session_items` tightened to the same rule, so STAFF cannot empty an approved/review session via the API.

## 4. Verification

- **CI regression:** `tsc --noEmit` clean; `vitest run` **482 passed / 41 files** (no app code touched; one pre-existing unrelated flaky smoke). 
- **RLS matrix + UI checks:** documented with runnable SQL in the results doc; **pending execution** at `supabase db reset` / staging — this sandbox has no running DB or `psql`. Includes a deterministic `pg_policies` shape assertion (exactly one DELETE policy per table, new definitions, old ones gone).
- **Server RPCs unaffected:** `delete_restaurant_cascade` (OWNER-checked) and `delete_inventory_list` are `SECURITY DEFINER` → bypass RLS.

## 5. What risk remains

- **Verification not yet executed against a DB.** The policy logic reuses proven helpers and mirrors the working UPDATE split, but the role matrix must be run at `supabase db reset` / on staging before relying on it. (No data risk: additive policy change.)
- **Migration ordering:** timestamp `20260623000001` sorts after the latest existing (`20260528000001`); applies cleanly in sequence.
- **No rate/other DELETE-path changes** — scope was these two policies only.

## 6. Rollback

Self-contained, no data touched. To roll back: a follow-up migration (or revert the file + redeploy) restoring `USING (is_member_of(restaurant_id))` on both tables. Instantaneous; nothing to backfill. (Rolling back re-opens the P0.)

## 7. What should be done next

1. **At deploy:** run the RLS verification matrix (results doc) + the UI workflow checks; confirm the `pg_policies` shape assertion.
2. **Proceed to S0-6** (`purchase_history_items` write open — RLS clause ≠ "Manager+" name) — next in the Phase-1 P0 sequence. *(Not started, per instruction.)*

## 8. Pending deploy co-requisites carried from earlier S0 items (none deployed yet)
- **S0-2:** `app.settings.service_role_key` GUC must be set, or pg_cron notifications stop.
- **S0-3:** `RESEND_WEBHOOK_SECRET` set + Resend signing enabled, or inbound-email ingestion stops.
- **S0-5:** none (additive RLS; just run the verification matrix at deploy).
