# Completed — S0-2: Authenticate `process-notifications`

> **Date:** 2026-06-23
> **Workflow step:** STEP 6 — Final Review ([engineering-workflow.md](../engineering-workflow.md))
> **Roadmap item:** S0-2 (P0 Security) — [trust-first-roadmap.md](../trust-first-roadmap.md)
> **Investigation:** [investigations/s0-2-process-notifications-auth.md](../investigations/s0-2-process-notifications-auth.md) · **Plan:** [plans/s0-2-process-notifications-auth-plan.md](../plans/s0-2-process-notifications-auth-plan.md) · **Results:** [test-results/s0-2-process-notifications-auth-results.md](../test-results/s0-2-process-notifications-auth-results.md)

## 1. What changed

| File | Change |
|------|--------|
| [supabase/functions/_shared/serviceAuth.ts](../../supabase/functions/_shared/serviceAuth.ts) | **New.** Pure, dependency-free helpers `extractBearerToken` and `isServiceRoleAuthorized(authHeader, serviceKey)` (true only on an exact service-role-key bearer; fails closed when the key is unset). Shared by the Deno function and the vitest test. |
| [supabase/functions/process-notifications/index.ts:243-252](../../supabase/functions/process-notifications/index.ts#L243-L252) | Added a service-role 401 gate as the **first** statement in the `try`, before the service client is built and before any of the seven processing blocks. Reads `SUPABASE_SERVICE_ROLE_KEY`, rejects with `401 "Unauthorized – service role required"` unless the request carries that key. |
| [supabase/config.toml](../../supabase/config.toml) | **Unchanged** — `verify_jwt` stays `false` (the cron caller has no user JWT; authorization is owned in-body, consistent with `send-email`). |
| `src/test/process-notifications-auth.test.ts` | **New.** 9 unit tests covering missing / invalid / anon-key / wrong / exact-service-key / unset-key / empty-bearer cases. |

Plus the three workflow docs (investigation, plan, results) and this summary. **No client/UI change** (the function has no front-end caller). **No `send-email` refactor** (explicitly out of scope). **S0-3 not started.**

## 2. What problem was solved

`process-notifications` — the platform-wide notification/email engine — was fully unauthenticated (`verify_jwt = false` + no in-body check), so anyone who knew the URL could `POST {}` and trigger emails, notification writes, and a heavy all-restaurants fan-out for **every** restaurant (S0-2 / role-permission-matrix G7). It now runs **only** for a caller presenting the exact service-role key (the trusted pg_cron job). Honors CLAUDE.md "Security before features" and reuses the established `send-email` service-role pattern (no new permission system, no duplicate logic — the gate lives in one shared helper).

## 3. ⚠️ Deploy co-requisite (REQUIRED — do not deploy without this)

The hourly **pg_cron** job ([migration 20260522000003:25-29](../../supabase/migrations/20260522000003_schedule_process_notifications.sql#L25-L29)) builds its `Authorization` bearer from the `app.settings.service_role_key` GUC, **falling back to an empty string if unset**. With the new gate, an empty bearer is rejected (401).

**`app.settings.service_role_key` MUST be set in the Supabase project before/with this deployment, or pg_cron notifications will stop entirely (silently).**

Steps:
1. `SELECT current_setting('app.settings.service_role_key', true);` — confirm non-empty.
2. If empty: `ALTER DATABASE postgres SET app.settings.service_role_key = '<service_role_key>';` (out-of-band; never commit the literal secret).
3. Deploy the function; confirm the next hourly run returns 200 (`cron.job_run_details` / Edge Function logs).

## 4. What risk remains

- **R1 — GUC dependency (above).** The fix is correct; its safe operation depends on the GUC being set. Mitigated by the documented, required deploy step + post-deploy verification. Until verified in the project, treat notifications as "armed but unconfirmed."
- **No rate-limiting / fan-out cost controls.** A holder of the service-role key (already fully privileged) can still invoke repeatedly; out of S0-2 scope.
- **Duplicate-logic cleanup deferred.** `send-email` (and other `Bearer ${serviceKey}` callers) still inline their own checks; folding them onto `isServiceRoleAuthorized` is a recommended consistency follow-up, not done here to keep the change focused.
- **Notification dedupe correctness** (LOW_STOCK dual-path, 1-hour trigger ignoring `data`) is untouched — that is T1-6, not a security issue.

## 5. What should be done next

1. **At deploy:** execute the §3 GUC checklist and the 401/200 curl matrix in the results doc.
2. **Proceed to S0-3** (`inbound-invoice-email` webhook auth) — next in the Phase-1 P0 sequence. *(Not started, per instruction.)*
3. **Optional cleanup:** unify `send-email` + other service-role callers onto the shared helper.

## 6. Verification snapshot
`tsc --noEmit` → clean. `vitest run` → 476 passed (incl. 9 new), green across 5 consecutive runs; one **pre-existing, unrelated** flaky live-backend smoke (`money-leak-snapshot`) passes in isolation. New auth tests deterministic (9/9).
