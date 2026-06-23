# Investigation — S0-2: `process-notifications` is publicly invokable

> **Date:** 2026-06-23
> **Roadmap item:** S0-2 (P0 Security), [trust-first-roadmap.md](../trust-first-roadmap.md)
> **Workflow step:** STEP 2 — Investigate ([engineering-workflow.md](../engineering-workflow.md))
> **Status:** Investigation complete — no code changed.

## 1. Summary

`process-notifications` is the platform-wide notification/email engine (low-stock alerts, reminders, daily/weekly digests, shrink/variance alerts, price-hike emails). It is **completely unauthenticated**:

1. **Gateway gate off** — `supabase/config.toml` sets `verify_jwt = false` for the function.
2. **No in-function gate** — the handler ([index.ts:223-237](../../supabase/functions/process-notifications/index.ts#L223-L237)) goes straight from `Deno.serve` to building a **service-role** Supabase client from env and iterating **all restaurants**. There is no `Authorization` check of any kind.

Net effect: **anyone who knows the URL can POST `{}` and trigger a full notification/email run for every restaurant on the platform** — mass email to real customers, notification-table writes, and a heavy all-restaurants DB fan-out (DoS vector). This is the most serious auth finding in [notification-engine-audit.md](../notification-engine-audit.md) (§"Auth surface", line 218) and matches role-permission-matrix G7.

## 2. Current behavior (verified against code)

- Config: [config.toml:9-10](../../supabase/config.toml#L9-L10) → `[functions.process-notifications] verify_jwt = false`.
- Handler entry [index.ts:223-237](../../supabase/functions/process-notifications/index.ts#L223-L237):
  ```ts
  Deno.serve(async (req) => {
    if (req.method === "OPTIONS") { return new Response(null, { headers: corsHeaders }); }
    try {
      const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
      const serviceKey  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
      const supabase = createClient(supabaseUrl, serviceKey);   // ← no auth check before this
      const { data: restaurants } = await supabase.from("restaurants").select("id, name");
      // … iterate ALL restaurants, send emails, write notifications …
  ```
- The function performs seven processing blocks, each over **all** restaurants:
  1. Low-stock alerts (in-app + IMMEDIATE email) — dedupe: "already a LOW_STOCK today" per user+restaurant.
  2. Reminders (+ optional `auto_create_session` into `inventory_sessions`) — **time-gated** to the reminder's hour/day/timezone.
  3. Daily digests — **time-gated** to the user's digest hour.
  4. Overdue-schedule alerts — per-session dedupe.
  5. Shrink / count-variance detection — dedupe: per-day per-restaurant.
  6. Monday 07:00 UTC weekly loss email — **time-gated** + 6-day dedupe.
  7. Price-hike emails — `price_email_sent` flag dedupe, 24h window.
- All outbound mail goes through `send-email` with `Authorization: Bearer ${serviceKey}` ([index.ts:365-369](../../supabase/functions/process-notifications/index.ts#L365), etc.).

## 3. Legitimate invoker (verified)

A **pg_cron** job — [20260522000003_schedule_process_notifications.sql:16-34](../../supabase/migrations/20260522000003_schedule_process_notifications.sql#L16-L34) — runs hourly (`0 * * * *`) and `net.http_post`s to the hosted function URL with:
```sql
'Authorization', 'Bearer ' || coalesce(
  current_setting('app.settings.service_role_key', true),
  current_setting('app.service_role_key', true),
  ''                                   -- ← fallback: EMPTY bearer
)
```
**No application/client code invokes `process-notifications`** (grep confirms only the cron + the manual `curl` runbook in `docs/email-alerts-setup.md`). This matters for the fix: there is **no client surface to change** (unlike S0-1).

**Critical caveat for the fix:** if neither GUC is set in the project, the cron posts `Authorization: Bearer ` (empty). Today that "works" only because the function does no auth. The moment we require the service key, an unset GUC means the **legitimate cron is rejected and all notifications silently stop**. The GUC-set state must be confirmed/guaranteed as part of this change (see plan §Risks).

## 4. Root cause

The function was designed as a **service-role cron worker** and was expected to be reachable "only by cron / protected by a secret" (archived `role-permission-audit.md:119` even notes: "Acceptable if reachable only by cron / protected by secret"). But neither protection was implemented: `verify_jwt` was disabled (correct — the cron has no user JWT) **without** adding the compensating in-body shared-secret check that the sibling privileged functions use. The result is an open, high-privilege, high-fan-out endpoint.

## 5. Reusable pattern (no new auth system)

`send-email` already implements exactly the check this function needs — an in-body service-role gate ([send-email/index.ts:12-20](../../supabase/functions/send-email/index.ts#L12-L20)):
```ts
const authHeader = req.headers.get("Authorization") || "";
const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
if (!serviceKey || !authHeader.includes(serviceKey)) {
  return new Response(JSON.stringify({ error: "Unauthorized – service role required" }), { status: 401, … });
}
```
The audit names this as the pattern to mirror (notification-engine-audit §"Recommendations", line 251). Since the cron already sends the service-role key in the bearer, mirroring this gate is the minimal, consistent fix — **provided** the GUC is set so the bearer is non-empty.

## 6. Business impact

- **Mass email to real customers on demand** — an unauthenticated party can fire low-stock/price-hike/weekly-loss emails for every restaurant, at any time. **Sender-reputation damage** (Resend domain) and customer trust loss. (Roadmap S0-2 headline.)
- **DoS / cost** — each call fans out across all restaurants, all approved sessions, all items, plus multiple sub-queries per restaurant; trivially abused to load the DB and rack up function/email cost.
- **Schedule subversion** — an attacker can consume the daily/per-window dedupe so the legitimate hourly run later produces nothing, or push emails out at attacker-chosen times.
- **Trust-rule violation** — CLAUDE.md "Security before features"; this is a pilot-gate P0.

## 7. User impact

- **Spam / spoofed-timing alerts** to owners/managers/staff (premature or off-hours digests).
- **State side-effects** an outsider can induce: `notifications` rows (including `severity: "CRITICAL"`), `emailed_at` / `price_email_sent` flips, and **auto-created `inventory_sessions`** (step 2, when a reminder hits its window).
- **Bounded, not unbounded:** the per-day / per-window / 6-day dedupes (and the global 1-hour dedupe trigger, [20260522000002_notification_dedup.sql](../../supabase/migrations/20260522000002_notification_dedup.sql)) cap *duplicate* emails — so the dominant harm is processing-load DoS + a single attacker-timed blast per dedupe window, not infinite duplicate mail. Still a P0 spam/reputation/DoS surface.
- **No cross-tenant data is returned** to the caller — the response is only a `details: string[]` summary (restaurant names + recipient emails appear in it, a minor info leak).

## 8. Affected components

| Layer | File | Note |
|-------|------|------|
| Gateway config | [config.toml:9-10](../../supabase/config.toml#L9-L10) | `verify_jwt = false` (keep — cron has no user JWT) |
| Edge function | [process-notifications/index.ts:223-237](../../supabase/functions/process-notifications/index.ts#L223-L237) | add in-body service-role gate here |
| Cron caller | [20260522000003_schedule_process_notifications.sql:23-30](../../supabase/migrations/20260522000003_schedule_process_notifications.sql#L23-L30) | already sends `Bearer <service_role_key>` via GUC; **GUC must be set** |
| Pattern source | [send-email/index.ts:12-20](../../supabase/functions/send-email/index.ts#L12-L20) | mirror this |

**No client/UI code** references the function → no front-end change.

## 9. Affected tables

None changed. The fix adds **no** DB reads/writes — it only gates the entry point before the existing service-role processing runs.

## 10. Open questions for the plan

1. **Is the cron GUC (`app.settings.service_role_key`) actually set in the project?** If not, the fix must be paired with setting it (out-of-band, not committed with the literal secret) or the cron will be rejected. — Resolved in plan as a required deploy step + verification.
2. **Validate against `SUPABASE_SERVICE_ROLE_KEY` (mirror send-email) vs. a dedicated `CRON_SECRET`?** — Plan recommends mirroring the service key for consistency; documents the `CRON_SECRET` alternative.
3. **Testability:** extract the gate into a pure helper (as done for S0-1) so the check is unit-tested in CI even though the Deno handler can't load under vitest. — Plan §Test.

## 11. Dependencies / sequencing

- **GATE (green CI)** — confirmed green during S0-1 (467 tests, tsc clean); re-confirm at implementation.
- Independent of S0-INFRA. Same Phase-1 family as the just-completed S0-1.

> No application code was modified in producing this investigation.
