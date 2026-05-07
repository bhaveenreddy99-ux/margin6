# Email alerts — setup, scheduling, and verification

This runbook covers **low stock email alerts** and related paths implemented by the `process-notifications` Edge Function and the `send-email` Edge Function (Resend). Use it to confirm the pipeline is production-ready and to debug when mail does not arrive.

## Architecture (repo)

| Piece | Location | Role |
|--------|-----------|------|
| Notification processor | `supabase/functions/process-notifications/index.ts` | Scans DB (low stock, reminders, digests, overdue schedules, usage anomalies). Calls `send-email` for mail. |
| Outbound email | `supabase/functions/send-email/index.ts` | Sends via **Resend** using `RESEND_API_KEY` (`from: RestaurantIQ <onboarding@resend.dev>` by default in code). |
| Local function config | `supabase/config.toml` | `[functions.process-notifications] verify_jwt = false` — deploy the function and secure invocation at the network/auth layer (see [Manual trigger](#manual-trigger)). |

**Extensions:** `supabase/migrations/20260214040101_pg_cron_pg_net_extensions.sql` enables `pg_cron` and `pg_net` for optional DB-side HTTP scheduling. **This repository does not define a `cron.schedule` job** that calls `process-notifications`. Schedule must be set outside this SQL or added in a follow-up migration.

## 1. Is `process-notifications` on a schedule?

| Source | In this repo? | Action |
|--------|----------------|--------|
| **Supabase `cron` in migrations** | **No** | No `SELECT cron.schedule(...)` calls `process-notifications`. |
| **pg_cron / pg_net** | **Enabled only** | Extensions exist; no job is created in migrations. |
| **Supabase Dashboard** (Edge Functions **Scheduled**, or project cron) | **Not in git** | **Verify in the Supabase project:** Project → *Edge Functions* (or *Database* → *Cron* / *Extensions* depending on plan) and confirm a job hits `https://<project-ref>.supabase.co/functions/v1/process-notifications` on the desired cadence (e.g. every 5–15 minutes for low stock). |
| **External scheduler** (GitHub Actions, Cloud Scheduler, crontab) | Optional | `curl` manual trigger (see below) on a schedule, using a secret URL or service role key. |

**Verification checklist (alert verification runbook):**

1. [ ] In Supabase, confirm a **recurring** trigger exists for `process-notifications` (or document “manual / on-demand only”).
2. [ ] Secrets: `RESEND_API_KEY` set for `send-email`; `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` available to Edge Functions (default when deployed on Supabase).
3. [ ] `send-email` returns 200 when tested (see [Manual trigger](#manual-trigger)).

## 2. How alerts trigger: cron vs manual

- **Automatic (intended):** A scheduler (Supabase scheduled function, pg_cron + `net.http_post`, or external cron) **POSTs** to `process-notifications` on an interval. Each run evaluates all restaurants and user prefs.
- **Manual:** You POST to the same URL once to process immediately (useful for demos and debugging).

**Low stock email (immediate path) requires:**

1. **Latest approved count per list:** For each `inventory_list_id`, the **most recent** `inventory_sessions` row with `status = 'APPROVED'` (ordered by `approved_at`).
2. **Risk bands:** `current_stock` vs `par_level` compared using restaurant `smart_order_settings` (`red_threshold`, `yellow_threshold`) via `computeRiskLevel` in code — items must be **RED** or **YELLOW** relative to those thresholds.
3. **User prefs:** `notification_preferences` for that `restaurant_id` + `user_id`: e.g. `low_stock_red` / `low_stock_yellow`, `channel_email: true`, `email_digest_mode: 'IMMEDIATE'` (not `DAILY_DIGEST` for immediate low-stock mail).
4. **Deduping:** In-app + email for `LOW_STOCK` are **skipped** if a `notifications` row of type `LOW_STOCK` for that user + restaurant was already created **today** (local midnight for the check in code). Clear or test on a new calendar day, or use a test project.

**In-app only:** If you only see rows in the `notifications` table but no email, check `channel_email`, `email_digest_mode`, and `profiles.email`.

## 3. How to test (e.g. “lower PAR”, wait, or run once)

**Option A — End-to-end with real data (closest to production)**

1. Set **PAR** and **stock** on an approved session line so the line is **RED** or **YELLOW** (e.g. reduce counted quantity so `stock / par` falls under your red/yellow % bands in *Smart order* / threshold settings).
2. Ensure that session is the **latest approved** for its list and **approved** after your edits.
3. Set notification prefs for a test user: email on, red (and yellow if needed) on, **IMMEDIATE** digest.
4. If you already triggered `LOW_STOCK` today, wait until the next day **or** use a test DB and delete today’s `notifications` rows of type `LOW_STOCK` for that user, **or** run the function the first time in the day.
5. Run **Manual trigger** (below), or wait for your configured cron.
6. Check inbox and Resend; check `notifications` table for new rows.

**Option B — Fast feedback without waiting for cron**

- Use [Manual trigger](#manual-trigger) after preparing data; inspect JSON `details` in the response and Supabase *Edge Functions* logs for `process-notifications` and `send-email`.

**Option C — `send-email` in isolation**

- POST to `send-email` with the service role (see that function’s auth rules) to confirm Resend API keys and domain; does not test low-stock business logic.

## 4. Troubleshooting

| Symptom | Things to check |
|--------|-------------------|
| No email, no in-app row | No qualifying approved session, no RED/YELLOW lines, or prefs turned off. |
| In-app `LOW_STOCK` but no email | `channel_email` false, or `email_digest_mode` = `DAILY_DIGEST` (email batches later in digest), or `profiles` missing `email`. |
| Error from `send-email` | **Resend** dashboard: [resend.com](https://resend.com) — *Emails* (logs, bounces), API key, domain/`from` policy. Function returns `500` if `RESEND_API_KEY` is unset. |
| “Already notified today” | One `LOW_STOCK` per user + restaurant + calendar day; test on fresh day or new user. |
| Function never runs | [Scheduling](#1-is-process-notifications-on-a-schedule) not configured; only manual posts. |
| 401/403 on invoke | For most projects, use `Authorization: Bearer <anon or service key>`; `send-email` **requires** service role in the `Authorization` header. |

**Supabase logs:** Dashboard → *Edge Functions* → `process-notifications` / `send-email` → *Logs*.

**Database:** `select * from notifications where type = 'LOW_STOCK' order by created_at desc limit 20;`

## 5. Manual trigger command

Replace placeholders with your project values. The request must be allowed to invoke the function (anon key is commonly used for Edge Functions; use the same key the dashboard uses for “Invoke”).

```bash
# process-notifications (one full pass: low stock, reminders, digests, etc.)
export SUPABASE_URL="https://<project-ref>.supabase.co"
export SUPABASE_KEY="<publishable-or-service-role>"

curl -sS -X POST "$SUPABASE_URL/functions/v1/process-notifications" \
  -H "Authorization: Bearer $SUPABASE_KEY" \
  -H "Content-Type: application/json" \
  -d '{}' | jq .

# Optional: test send-email only (Resend) — must use service role per function code
export SUPABASE_SERVICE_ROLE_KEY="<service-role-secret>"

curl -sS -X POST "$SUPABASE_URL/functions/v1/send-email" \
  -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "to": "you@example.com",
    "subject": "RestaurantIQ test",
    "html": "<p>Manual send test</p>"
  }' | jq .
```

Expect `process-notifications` to return JSON like `{ "success": true, "processed": <n>, "details": [ "..."] }`. If `details` is empty, no work matched (no due reminders, no low stock rows, etc.).

## 6. Quick “alert verification” sign-off

- [ ] Scheduler exists **or** team accepts manual-only operation.  
- [ ] `process-notifications` run produces expected `details` in staging with test data.  
- [ ] `send-email` test returns success and Resend shows the message.  
- [ ] Staging user receives low-stock email when PAR/stock and prefs match [§2](#2-how-alerts-trigger-cron-vs-manual).  

---

*Last updated from codebase scan: `process-notifications` and `config.toml` behavior; in-repo there is no cron job definition for this function—confirm schedule in the Supabase project.*
