# Plan — S0-2: Authenticate `process-notifications`

> **Date:** 2026-06-23
> **Roadmap item:** S0-2 (P0 Security), effort **S–M** — [trust-first-roadmap.md](../trust-first-roadmap.md)
> **Workflow step:** STEP 3 — Create Plan ([engineering-workflow.md](../engineering-workflow.md))
> **Investigation:** [s0-2-process-notifications-auth.md](../investigations/s0-2-process-notifications-auth.md)
> **Status:** Awaiting approval — no code changed yet.

## 1. Root cause (one line)

`process-notifications` is a service-role cron worker with `verify_jwt = false` and **no in-body auth check**, so anyone who knows the URL can trigger the whole notification/email engine for all restaurants.

## 2. Goal & success criteria

**Goal:** the engine runs **only** when invoked by the trusted cron (which presents the service-role key in the bearer). Mirror the existing `send-email` gate; add no new permission system; change no processing logic.

Done when:
- A request **without** the service-role key (no token, anon key, or arbitrary bearer) → `401`, and **none** of the seven processing blocks run (no DB writes, no emails).
- A request **with** the service-role key (the cron) → runs exactly as today.
- The hourly cron continues to fire successfully (GUC confirmed set — see §5).
- CI (tests + types) green.

## 3. Chosen approach

Mirror [send-email/index.ts:12-20](../../supabase/functions/send-email/index.ts#L12-L20): an in-body service-role gate as the **first** thing inside the `try` block, before the service client is built.

1. **New shared helper** `supabase/functions/_shared/serviceAuth.ts` — a pure, dependency-free predicate `isServiceRoleAuthorized(authHeader: string | null, serviceKey: string | undefined): boolean` (true only when `serviceKey` is set and the bearer carries exactly that key). Pure → unit-testable under vitest (same tactic as S0-1's `parseInvoiceAuth.ts`).
2. **`process-notifications/index.ts`** — at the top of the `try` ([:228](../../supabase/functions/process-notifications/index.ts#L228)):
   ```ts
   const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
   if (!isServiceRoleAuthorized(req.headers.get("Authorization"), serviceKey)) {
     return new Response(JSON.stringify({ error: "Unauthorized – service role required" }),
       { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
   }
   ```
   Then keep the existing `supabaseUrl`/`serviceKey`/`createClient` lines and all processing unchanged.
3. **`config.toml`** — **no change**: `verify_jwt` stays `false` (the cron has no user JWT; auth is owned in-body, consistent with `send-email`/`parse-invoice`).

**Stricter than send-email on purpose:** send-email uses `authHeader.includes(serviceKey)`; the helper will parse the bearer and compare exactly (reusing the `extractBearerToken` approach from S0-1). Both accept the cron's `Bearer <key>`; exact-match avoids substring edge cases. (Optional consistency follow-up: refactor `send-email` to the same helper — recommended to honor "no duplicate logic," but **out of S0-2 scope** to keep the change focused; will note, not do, unless you want it included.)

## 4. Files affected

| # | File | Change | Risk |
|---|------|--------|------|
| 1 | `supabase/functions/_shared/serviceAuth.ts` | **New** pure helper `isServiceRoleAuthorized` (+ bearer extraction) | Low |
| 2 | [process-notifications/index.ts](../../supabase/functions/process-notifications/index.ts#L228) | Add the 401 gate at the top of `try` (≈5 lines) | Low (no processing logic touched) |
| 3 | [config.toml](../../supabase/config.toml#L9-L10) | No change (documented) | — |
| 4 | `src/test/process-notifications-auth.test.ts` | **New** vitest unit tests for the helper | Low |

No client/UI change. No migration change (but a **deploy step** — §5).

## 5. Risks & mitigations (the important part)

- **R1 — Silent notification outage if the cron GUC is unset.** The cron builds the bearer from `current_setting('app.settings.service_role_key', true)` with a **fallback to empty string** ([migration :25-29](../../supabase/migrations/20260522000003_schedule_process_notifications.sql#L25-L29)). If the GUC is not set, the cron will send `Bearer ` (empty) and the new gate will reject it → **all notifications stop**. **Mitigation (required co-step, not optional):**
  1. Confirm in the Supabase project whether the GUC is set: `SELECT current_setting('app.settings.service_role_key', true);` (and the `app.service_role_key` fallback).
  2. If empty, set it once (out-of-band, **not** committed with the literal secret): `ALTER DATABASE postgres SET app.settings.service_role_key = '<service_role_key>';` then verify the next cron tick succeeds.
  3. After deploy, confirm the hourly job returns 200 (Supabase → Edge Functions → logs; or `cron.job_run_details`).
  This investigation cannot read the project, so the GUC state is an **explicit pre-deploy verification**, called out in the test-results doc.
- **R2 — Manual/runbook callers break.** The `docs/email-alerts-setup.md` curl examples already pass the service-role key in the bearer, so they continue to work. No other caller exists.
- **R3 — Over-tight comparison rejects the real cron.** Mitigated by accepting the standard `Bearer <serviceKey>` shape (exact token match) — exactly what the cron sends; covered by unit tests.
- **R4 — Info in error responses.** Unchanged; the 401 body is generic.

## 6. Implementation order

1. **Precheck (no code):** re-confirm GATE green; re-confirm no client caller (done in investigation).
2. Add `_shared/serviceAuth.ts` pure helper.
3. Add the 401 gate to `process-notifications/index.ts` (top of `try`).
4. Add vitest unit tests for the helper.
5. Run tests + typecheck → green.
6. **Deploy checklist (hand-off):** confirm/set the cron GUC (R1), deploy the function, verify the next hourly cron run returns 200.

## 7. Alternatives considered

- **`verify_jwt = true` at the gateway.** Rejected as sole fix: the cron presents the service-role key (a valid project JWT) so it would pass, but so would anyone holding the public anon key — same flaw as S0-1. In-body service-key match is required.
- **Dedicated `CRON_SECRET` env + GUC.** Cleaner separation from the service key, but adds a new secret to provision in two places and diverges from the established `send-email` pattern. Documented as an alternative; not chosen for an S–M fix.
- **Move the cron secret into Supabase Vault** and have the cron read `vault.decrypted_secrets`. More robust than a GUC but scope creep and depends on Vault being provisioned; can be a later hardening.

## 8. Out of scope (note, do not build here)

- Refactoring `send-email` (and other `Bearer ${serviceKey}` callers) onto the shared helper — recommended consistency cleanup, separate change.
- Rate-limiting / fan-out cost controls on the engine.
- The notification **dedupe** correctness issues (LOW_STOCK dual-path, 1-hour trigger ignoring `data`) — these are T1-6, not S0-2.

## 9. Test plan (preview — detailed in STEP 5)

The new logic is the synchronous service-role gate; the rest of the handler is unchanged.

| Case | Expected |
|------|----------|
| `isServiceRoleAuthorized(null, key)` | `false` (→ 401) |
| `isServiceRoleAuthorized("Bearer " + key, key)` | `true` |
| `isServiceRoleAuthorized("Bearer wrong", key)` | `false` |
| anon-key bearer (≠ service key) | `false` |
| `serviceKey` undefined/empty | `false` (fail closed) |
| `Bearer <key>x` / prefix of key | `false` (exact match) |
| empty bearer (`"Bearer "`, the cron's unset-GUC case) | `false` (documents R1) |

- **Unit (vitest, CI):** cover the table above in `src/test/process-notifications-auth.test.ts`.
- **Handler async path (manual/curl, no Deno here):** documented matrix — `POST` with no auth → 401 + zero `details`; `POST` with `Bearer <service key>` → 200 + normal `details`.
- **Regression:** full `vitest run` + `tsc --noEmit` green; no client e2e affected (no UI caller).
- **Deploy verification:** next hourly cron returns 200 (R1).

## 10. Final-review questions to answer at STEP 6

What changed · problem solved (closed the open mass-email/DoS endpoint) · residual risk (GUC-set dependency; send-email helper unification deferred) · next (S0-3 `inbound-invoice-email` webhook auth).

> No application code was modified in producing this plan.
