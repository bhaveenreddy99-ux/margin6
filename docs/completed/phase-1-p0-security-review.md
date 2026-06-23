# Phase 1 — P0 Security Review

> **Date:** 2026-06-23
> **Branch:** `feat/dashboard-trust-transparency` (local — **not pushed**; `main` unchanged)
> **Scope:** The 7 Phase-1 P0 security items from [trust-first-roadmap.md](../trust-first-roadmap.md) — S0-1, S0-2, S0-3, S0-5, S0-6, S0-7, S0-8.
> **Process:** Each item followed the 6-step [engineering-workflow.md](../engineering-workflow.md) (Understand → Investigate → Plan → Implement → Test → Review), one focused commit per item, with an investigation + plan + completion doc each (test-results docs are local/gitignored).
> **Status:** Implemented & committed locally; **CI green** (tsc + vitest 486). DB-side RLS/RPC matrices and edge-function auth matrices are **documented but pending execution** at `supabase db reset` / staging / deploy.

---

## 1. Commit summary (7 commits, oldest → newest)

| # | Commit | Item | One-line fix |
|---|--------|------|--------------|
| 1 | `f2677c5` | **S0-1** | `parse-invoice` edge fn now requires a real authenticated member (service-role bypass for trusted server callers); was accepting any bearer. |
| 2 | `6a1c411` | **S0-2** | `process-notifications` cron now requires the service-role key (in-body gate); was publicly invokable. |
| 3 | `07a93df` | **S0-3** | `inbound-invoice-email` now verifies the Resend/Svix webhook signature (fail-closed); was unauthenticated. |
| 4 | `17e616c` | **S0-5** | `inventory_sessions` + `inventory_session_items` DELETE → Manager+ or own-IN_PROGRESS; was any member, any status. |
| 5 | `969ed20` | **S0-6** | `purchase_history_items` INSERT/UPDATE/DELETE → Manager+; INSERT/DELETE were `is_member_of` under a lying "Manager+" name. |
| 6 | `00225ac` | **S0-7** | `weekly_sales`/`daily_sales` write policies defensively re-asserted as Manager+ (source was already correct — the roadmap leak claim was stale). |
| 7 | `0869ba6` | **S0-8** | `notifications` creation routed through a validated `SECURITY DEFINER` RPC; direct client INSERT dropped. Was: any member could forge alerts / pollute the shrinkage KPI. |

---

## 2. What each fixed (detail)

### S0-1 — `parse-invoice` membership auth · `f2677c5`
- **Was:** `verify_jwt=false` + a check that only tested the header *starts with* `"Bearer "`. The public anon key (or any string) reached the paid Anthropic call → **unbounded Anthropic spend / DoS**.
- **Now:** in-function triage — no token → 401; **service-role key** → trusted server-to-server bypass (for `inbound-invoice-email` + `audit-invoice-anon`); any other token → must resolve to a real user (`auth.getUser`) **and** be a member of the `restaurant_id` (now sent by the client) → else 401/400/403, all **before** the Anthropic call.
- **Files:** `parse-invoice/index.ts`, `_shared/parseInvoiceAuth.ts` (pure helper), `useInvoiceActions.ts` (×3 add `restaurant_id`). `verify_jwt` kept `false`.

### S0-2 — `process-notifications` service auth · `6a1c411`
- **Was:** `verify_jwt=false` and **no** in-body check — anyone who knew the URL could `POST {}` and trigger the whole notification/email engine + an all-restaurants fan-out (**mass email / DoS / sender-reputation**).
- **Now:** first statement in the handler rejects unless the request carries the exact service-role key (mirrors `send-email`), before the service client or any processing runs.
- **Files:** `process-notifications/index.ts`, `_shared/serviceAuth.ts` (pure helper). `verify_jwt` kept `false` (cron has no user JWT).

### S0-3 — `inbound-invoice-email` webhook auth · `07a93df`
- **Was:** the docstring claimed "verify the webhook secret" but the handler **never** did — forged Resend-shaped payloads could **inject invoices into any restaurant**, drive AI spend, write notifications, email owners.
- **Now:** **fail-closed** Svix verification at the top of the handler — 500 if `RESEND_WEBHOOK_SECRET` unset → 400 if `svix-*` headers missing → `new Webhook(secret).verify(rawBody, headers)` → 401 on bad signature, **before** any DB write/upload/parse/notification/email.
- **Files:** `inbound-invoice-email/index.ts`, `_shared/webhookAuth.ts` (pure helper). Imports `svix@1.24.0`. `verify_jwt` kept `false`.

### S0-5 — `inventory_sessions` DELETE · `17e616c` *(migration-only)*
- **Was:** DELETE = `is_member_of(restaurant_id)` (any member, **any status**) → STAFF could delete APPROVED/IN_REVIEW count history (the basis of all value math). Child `inventory_session_items` equally open.
- **Now (Model B):** Manager+ may delete any session; a non-manager member may delete only **IN_PROGRESS** (preserves the STAFF "Clear my draft" UI). Same rule applied to `inventory_session_items` via the parent session's role+status. SECURITY DEFINER cascade RPCs unaffected.
- **File:** `20260623000001_restrict_inventory_session_delete.sql`.

### S0-6 — `purchase_history_items` writes · `969ed20` *(migration-only)*
- **Was:** INSERT/DELETE = `is_member_of` under "Manager+" names (a **lying** policy) → STAFF could forge/delete purchase line items (feed Period Spend / Food Cost % / price comparisons). No UPDATE policy (the Manager+ invoice-review catalog mapping was silently blocked).
- **Now:** INSERT/UPDATE/DELETE → `has_restaurant_role_any(OWNER,MANAGER)` (parent-parity); UPDATE added (repairs the mapping). SELECT unchanged. Creation RPCs are SECURITY DEFINER → unaffected; no client INSERT exists.
- **File:** `20260623000002_restrict_purchase_history_items_write.sql`.

### S0-7 — `weekly_sales`/`daily_sales` writes · `00225ac` *(migration-only; defensive)*
- **Finding:** the roadmap/G4 "name lies / `is_member_of`" claim is **stale/incorrect** — current source already enforces Manager+ (membership AND location AND `has_restaurant_role_any(OWNER,MANAGER)`) on all writes. **No source leak.**
- **Now:** an **idempotent re-assertion** of the same 6 write policies (3 per table) so the **deployed** DB is guaranteed to match correct source in any environment (the deployed state can't be inspected from the repo). SELECT read-gates untouched. **This is an assertion, not a bug fix.**
- **File:** `20260623000003_reassert_sales_write_manager_only.sql`. Stale doc corrections prepared **locally** (deferred to a separate docs commit).

### S0-8 — `notifications` creation lockdown · `0869ba6` *(migration + client)*
- **Was:** INSERT = `is_member_of(restaurant_id)` with no `user_id`/type/severity guard → any member could forge alerts (incl. CRITICAL) to any user and insert `SHRINK_ALERT`/`COUNT_VARIANCE` rows that **directly inflate the Shrinkage KPI**.
- **Now:** new `SECURITY DEFINER` RPC `create_member_notifications` (validates caller membership; filters recipients to members; **type allowlist** = `PAR_CHANGE_REQUEST`, `PRICE_CHANGE_REQUEST`, `PAR_SUGGESTIONS`, `LOW_STOCK` — all KPI/server-only types rejected; stamps `source_user_id`); the **4 client insert sites** rerouted to it; the **direct client INSERT policy dropped**. Server creators (cron/edge, service-role) bypass RLS → unaffected.
- **Files:** `20260623000004_notifications_create_rpc.sql`, `createMemberNotifications.ts` (+ generated `types.ts`), `useManagerCommands.ts` (×2), `PARSuggestions.tsx`, `smartOrderFromSession.ts`, `create-member-notifications.test.ts`.

---

## 3. Deploy co-requisites (MUST be satisfied or features break)

| Item | Co-requisite | If not done |
|------|--------------|-------------|
| **S0-2** | Set `app.settings.service_role_key` GUC in the Supabase project (the hourly pg_cron job builds its bearer from it, falling back to an **empty string**). | The cron's bearer is empty → the new gate 401s it → **all notifications silently stop.** |
| **S0-3** | Set `RESEND_WEBHOOK_SECRET` (to Resend's inbound signing secret, `whsec_…`) **and** enable signing on the Resend inbound webhook; deploy with `--no-verify-jwt`. | Fail-closed gate rejects every inbound email → **invoice-email ingestion stops.** |
| **S0-1** | None required for correctness, but confirm the edge fn has `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` (already used elsewhere). | — |
| **S0-5 / S0-6 / S0-7 / S0-8** | None (additive RLS/RPC). Just run the verification matrices. | — |
| **S0-8** | Migration + client must deploy **together** (client calls the new RPC). | If only the migration deploys, client notification calls fail (non-fatal toasts); if only the client deploys, the RPC 404s. |
| **All edge fns (S0-1/2/3)** | `supabase functions deploy …` (S0-2/S0-3 keep `verify_jwt=false`/`--no-verify-jwt`). | Old code stays live. |

**Pinned dependency:** S0-3 imports `svix@1.24.0` (esm.sh) — the pin couldn't be verified from the sandbox; the post-deploy real-delivery test surfaces any import/version issue immediately.

---

## 4. Verification status

| Item | CI (tsc + vitest) | DB / edge matrix |
|------|:----:|------|
| S0-1 | ✅ (unit: `parseInvoiceAuth` triage; invoice e2e page) | ⏳ 401/400/403/200 + service-bypass matrix — run against served fn |
| S0-2 | ✅ (unit: `serviceAuth`) | ⏳ 401 no/invalid key, 200 with service key — served fn |
| S0-3 | ✅ (unit: `extractSvixHeaders`) | ⏳ signed → 200, unsigned/bad-sig → 401/400, no secret → 500 — served fn |
| S0-5 | ✅ (regression only) | ⏳ role×status SQL matrix + `pg_policies` shape assertion |
| S0-6 | ✅ (regression only) | ⏳ role SQL matrix + `pg_policies` shape assertion |
| S0-7 | ✅ (regression only) | ⏳ `pg_policies` assertion confirms writes = `has_restaurant_role_any(OWNER,MANAGER)` (also confirms deployed DB matches source) |
| S0-8 | ✅ (unit: `createMemberNotifications` ×4; +486 suite) | ⏳ RPC allow/reject matrix + direct-INSERT-blocked + `pg_proc`/`has_function_privilege` assertions |

- **CI:** `npx tsc --noEmit` → exit 0; `npx vitest run` → **486 passed / 42 files** (deterministic). One occasionally-flaky live-backend smoke (`money-leak-snapshot`) is pre-existing and unrelated (passes in isolation).
- **DB/edge:** exact SQL/curl matrices live in each item's `docs/test-results/s0-*-results.md` (local). **None executed yet** — no running DB / `psql` / deployed fn in the build sandbox.

---

## 5. Remaining risks

1. **DB/edge verification not yet executed.** Each fix reuses proven helpers (`is_member_of`, `has_restaurant_role_any`, the `send-email`/`stripe-webhook` auth patterns) and CI is green, but the role-based RLS/RPC matrices and the edge-function auth matrices must be run at `supabase db reset` / staging / post-deploy before relying on them. *(No data risk — all changes are additive policies/RPCs; no rows modified.)*
2. **S0-2 / S0-3 silent-outage dependency** on the GUC / Resend secret (see §3) — the highest operational risk; gate deploy on them.
3. **S0-8 residual (accepted):** a member can still create an **allowlisted, benign** cross-user notification (fake LOW_STOCK / PAR request) with custom text — mild same-restaurant spam, not KPI pollution or CRITICAL/arbitrary-type forging. Server-side templating could harden later.
4. **S0-1 residual:** no rate-limit / payload-size cap on `parse-invoice` (out of scope) — a compromised member can still call it repeatedly. Follow-up hardening recommended.
5. **Out-of-scope siblings still open** (P1, by design): `notification_preferences` over-broad write (S1-5), the dedupe-ignores-`data` issue (T1-6), and the other RLS↔UI gaps (S1-1…S1-9). The per-location permission flags remain UI-only (S1-7).
6. **Pinned `svix@1.24.0`** version (S0-3) unverified from sandbox.
7. **Stale canonical docs:** `trust-first-roadmap.md` (S0-7 row) and `role-permission-matrix.md` (G4) still describe S0-7 as a leak — corrections are **local/uncommitted**, pending the separate docs commit.

---

## 6. Rollback notes

| Item | Rollback | Data impact | Re-opens leak? |
|------|----------|:-----------:|:--------------:|
| S0-1 | `git revert f2677c5` + redeploy fn | none | yes |
| S0-2 | `git revert 6a1c411` + redeploy fn | none | yes |
| S0-3 | `git revert 07a93df` + redeploy fn, **or** fix `RESEND_WEBHOOK_SECRET`/redeploy prior version | none (rejected reqs write nothing) | yes |
| S0-5 | follow-up migration restoring `is_member_of` (or revert) | none | yes |
| S0-6 | follow-up migration restoring `is_member_of` on INSERT/DELETE + drop added UPDATE (or revert) | none | yes |
| S0-7 | revert the re-assertion migration | none | **no** — source was already correct |
| S0-8 | **revert the whole commit `0869ba6`** (migration + client are co-dependent) | none (no rows modified) | yes |

General: every change is additive (new policies/RPC/auth gates) and touches **no existing rows**, so rollback is instantaneous with nothing to backfill. Migrations apply in timestamp order (`20260623000001`–`0004`, after the latest pre-existing `20260528000001`).

---

## 7. Pre-deploy checklist

**Gate the deploy on these:**
- [ ] **S0-2:** `SELECT current_setting('app.settings.service_role_key', true);` returns non-empty (set it if not). Confirm the next hourly `process-notifications` run returns 200 (`cron.job_run_details` / Edge logs).
- [ ] **S0-3:** `RESEND_WEBHOOK_SECRET` set to Resend's signing secret; signing enabled on the Resend inbound webhook; send a real test email → draft invoice created + 200; a bogus `POST` → 400/401.
- [ ] **S0-1:** logged-in member upload still parses; a `curl` with `Authorization: Bearer x` now returns 401.
- [ ] **S0-5/6/7/8:** `supabase db reset` (or staging) applies migrations `0001`–`0004` cleanly; run each item's RLS/RPC role matrix; run the `pg_policies` / `pg_proc` / `has_function_privilege` shape assertions (exact SQL in the per-item results docs).
- [ ] **S0-8:** STAFF PAR/price request still notifies managers; count-approval low-stock alert still arrives; **direct REST `POST /notifications` by a member is rejected**; member RPC call with `SHRINK_ALERT` raises.
- [ ] **Edge deploys:** `parse-invoice`, `process-notifications`, `inbound-invoice-email` deployed with the intended `verify_jwt` flags; confirm `svix` import resolves for `inbound-invoice-email`.
- [ ] **Co-deploy:** S0-8 migration + client ship in the same release.
- [ ] **Docs:** land the separate docs commit correcting the stale S0-7 claims (or note it as pending).

**Post-deploy smoke:** dashboard Shrinkage no longer reflects any member-forged rows (S0-8 + unblocks T0-7); no regression in invoice intake (file/photo/email), count→approve→order, sales entry, purchase history.

---

## 8. Outcome

All 7 Phase-1 P0 security items are implemented, unit/regression-green, and committed as focused, individually-revertable commits on `feat/dashboard-trust-transparency` (local, unpushed). The remaining work to call Phase 1 "done in production" is **operational**: satisfy the S0-2/S0-3 secrets, run the documented DB/edge verification matrices, and deploy edge fns + the co-dependent S0-8 change. Per the roadmap, this is the minimum security bar before real customer data; the KPI-trust items (Phase 3, incl. the now-unblocked **T0-7**) and Phase 2 (**S0-INFRA**, S0-4, S0-9) follow — **not started**.

> No application code was changed in producing this review.
