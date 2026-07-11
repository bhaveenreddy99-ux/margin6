# Completed — S0-8: Route notification creation through a validated RPC; lock down direct INSERT

> **Date:** 2026-06-23
> **Workflow step:** STEP 6 — Final Review ([engineering-workflow.md](../engineering-workflow.md))
> **Roadmap item:** S0-8 (P0 Security) — [trust-first-roadmap.md](../trust-first-roadmap.md)
> **Investigation:** [investigations/s0-8-notifications-insert-spoofing.md](../investigations/s0-8-notifications-insert-spoofing.md) · **Plan:** [plans/s0-8-notifications-insert-spoofing-plan.md](../plans/s0-8-notifications-insert-spoofing-plan.md) · **Results:** [test-results/s0-8-notifications-insert-spoofing-results.md](../test-results/s0-8-notifications-insert-spoofing-results.md)

## 1. What changed

Unlike S0-5/6/7 (migration-only), this is a **co-dependent migration + client change** (one commit):

| File | Change |
|------|--------|
| `supabase/migrations/20260623000004_notifications_create_rpc.sql` | **New.** `SECURITY DEFINER` RPC `create_member_notifications(...)` (validates caller membership, filters recipients to members, enforces the 4-type allowlist, stamps `data.source_user_id`); `REVOKE` from public/anon + `GRANT EXECUTE` to `authenticated`; **DROP** the `"Members can create notifications"` INSERT policy. SELECT/UPDATE (self-only) kept. |
| `src/domain/notifications/createMemberNotifications.ts` | **New** thin client wrapper over the RPC (mapped params, empty-recipient short-circuit, `{ error }` shape). |
| `src/integrations/supabase/types.ts` | Added the `create_member_notifications` function signature to the generated `Database` types so the RPC type-checks. |
| `useManagerCommands.ts` (×2), `PARSuggestions.tsx`, `smartOrderFromSession.ts` | Rerouted the 4 client `.from("notifications").insert(...)` sites to `createMemberNotifications(...)`. |
| `src/test/create-member-notifications.test.ts` | **New** — 4 unit tests for the wrapper contract. |

## 2. What problem was solved

The `notifications` INSERT policy was `is_member_of(restaurant_id)` with no `user_id`/type/severity guard, so any member could **forge alerts to any user** (incl. CRITICAL) and insert **`SHRINK_ALERT`/`COUNT_VARIANCE`** rows that **directly inflate the Shrinkage KPI** (role-permission-matrix G5; kpi-source-of-truth §14). Because the legitimate flows are cross-user, the fix is **server-mediated creation**: the four real client creates now go through a validated RPC, and direct client INSERT is removed. Members can no longer forge notifications or pollute the shrinkage dollar by **either** path. Honors CLAUDE.md "RPCs must enforce permissions; never trust UI permissions."

## 3. Decisions applied (per approval)
- **Drop direct client INSERT entirely** (no authenticated INSERT policy remains).
- **Type allowlist = the 4 observed types** (`PAR_CHANGE_REQUEST`, `PRICE_CHANGE_REQUEST`, `PAR_SUGGESTIONS`, `LOW_STOCK`); all KPI/server-only types rejected by the RPC.

## 4. Why it's safe (no legitimate flow broken)

- The 4 cross-user client flows (STAFF→manager PAR/price requests; PAR suggestions; low-stock approval alerts) keep working through the RPC.
- Server creators (`process-notifications` cron, `dispatch-app-notifications` / `inbound-invoice-email` edge fns) use the service-role key → **bypass RLS** → unaffected; they remain the only creators of SHRINK_ALERT/COUNT_VARIANCE/etc.
- Exhaustive grep confirmed **exactly 4** client insert sites, all migrated, before dropping the policy.
- The existing BEFORE INSERT dedupe trigger still fires on RPC inserts.

## 5. Verification

- **CI:** `tsc` clean; `vitest` **486 passed** (+4 new wrapper tests). New RPC added to generated types.
- **RPC/RLS matrix + UI checks:** documented with runnable SQL + `pg_policies`/`pg_proc`/`has_function_privilege` assertions in the results doc; **pending execution** at `supabase db reset` / staging (no DB/`psql` in this sandbox).
- **KPI integrity:** SHRINK_ALERT/COUNT_VARIANCE now creatable only by the server → unblocks **T0-7**.

## 6. What risk remains

- **DB-side verification not yet executed** — RPC reuses proven helpers (`is_member_of`) and the SECURITY DEFINER pattern; run the role matrix at deploy/staging before relying on it. (No data risk: additive RPC + policy drop, no rows modified.)
- **Residual (accepted):** a member can still create an **allowlisted, benign** cross-user notification (e.g. a fake LOW_STOCK or PAR request) with custom text — mild same-restaurant spam, not KPI pollution or arbitrary-type/CRITICAL forging. Server-side templating could harden this later (follow-up).
- **Out of scope (noted):** `notification_preferences` over-broad write (S1-5) and the dedupe-ignores-`data` issue (T1-6) — separate items, untouched.
- **Migration ordering:** `20260623000004` sorts after S0-7's `20260623000003`.

## 7. Rollback

Co-dependent → **rollback = revert the whole S0-8 commit** (migration + client + types + tests together): restores the `is_member_of` INSERT policy and removes the RPC/wrapper/call-sites atomically. No data touched → instantaneous. (Rollback re-opens the leak.)

## 8. What should be done next

1. **At deploy:** run the RPC/RLS verification matrix + UI checks; confirm the `pg_policies` / function-privilege assertions.
2. **Phase-1 P0 security is now complete** (S0-1, S0-2, S0-3, S0-5, S0-6, S0-7, S0-8). Per the roadmap, next is **Phase 2** (S0-INFRA → S0-4/S0-9) or the **T0** trust items (notably **T0-7**, now unblocked). *(Not started, per instruction.)*
3. **Pending docs commit:** the stale S0-7 doc corrections are still local/uncommitted (separate docs commit, as agreed).

## 9. Pending deploy co-requisites carried from earlier S0 items (none deployed yet)
- **S0-2:** set `app.settings.service_role_key` GUC, or pg_cron notifications stop.
- **S0-3:** set `RESEND_WEBHOOK_SECRET` + enable Resend signing, or inbound-email ingestion stops.
- **S0-5 / S0-6 / S0-7 / S0-8:** run the RLS/RPC verification matrices at deploy (no secret/config co-requisite).
