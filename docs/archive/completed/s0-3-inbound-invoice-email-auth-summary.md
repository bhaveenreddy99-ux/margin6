# Completed — S0-3: Verify the Resend webhook signature on `inbound-invoice-email`

> **Date:** 2026-06-23
> **Workflow step:** STEP 6 — Final Review ([engineering-workflow.md](../engineering-workflow.md))
> **Roadmap item:** S0-3 (P0 Security) — [trust-first-roadmap.md](../trust-first-roadmap.md)
> **Investigation:** [investigations/s0-3-inbound-invoice-email-auth.md](../investigations/s0-3-inbound-invoice-email-auth.md) · **Plan:** [plans/s0-3-inbound-invoice-email-auth-plan.md](../plans/s0-3-inbound-invoice-email-auth-plan.md)

## 1. What changed

| File | Change |
|------|--------|
| [supabase/functions/_shared/webhookAuth.ts](../../supabase/functions/_shared/webhookAuth.ts) | **New.** Pure, dependency-free `extractSvixHeaders(get)` → returns the `svix-id` / `svix-timestamp` / `svix-signature` set only when all three are present, else `null`. Unit-testable under vitest. |
| [supabase/functions/inbound-invoice-email/index.ts:172-209](../../supabase/functions/inbound-invoice-email/index.ts#L172-L209) | Added a **fail-closed** Svix verification gate immediately after the method check and **before** the service client / body processing: `500` if `RESEND_WEBHOOK_SECRET` unset → `400` if `svix-*` headers missing → read **raw body** (`req.text()`) → `new Webhook(secret).verify(rawBody, headers)` → `401` on failure. The verified payload feeds the existing `{type,data}` unwrap + `validateInboundPayload` flow (body read exactly once; no double-read). Imports `Webhook` from `https://esm.sh/svix@1.24.0`. Docstring updated: `RESEND_WEBHOOK_SECRET` is now **REQUIRED**. |
| [supabase/config.toml](../../supabase/config.toml) | **Unchanged** — `verify_jwt = false` stays (Resend presents no Supabase JWT; the signature is the auth, consistent with `stripe-webhook`). |
| `src/test/inbound-invoice-email-auth.test.ts` | **New.** 6 unit tests for `extractSvixHeaders` (all-present / each-missing / empty / none). |

Plus the investigation, plan, and this summary. **No client/UI change** (Resend-only caller). **Manual invoice upload untouched** (separate authenticated `useInvoiceActions` → `parse-invoice` path). **S0-5 not started.**

## 2. What problem was solved

`inbound-invoice-email` was a public, unauthenticated endpoint (`verify_jwt = false` + no in-body check) that performed privileged service-role writes — anyone who could POST a forged Resend-shaped payload could **inject invoices into a real restaurant**, drive AI-parse spend, write notifications, and email owners/managers (S0-3 / role-permission-matrix G8). It now processes a request **only** when it carries a valid Resend/Svix signature, rejecting everything else **before** any DB write, file upload, `parse-invoice` call, notification, or email. Reuses the `stripe-webhook` fail-closed pattern (no new auth system).

## 3. ⚠️ Deploy co-requisite (REQUIRED — do not deploy without this)

The gate is **fail-closed**: it rejects unless a valid signature is present. Two things must be true in the project **before/with** deployment, or **all inbound-email invoice ingestion stops**:

1. **`RESEND_WEBHOOK_SECRET` is set** in Supabase Edge Function secrets, to Resend's inbound webhook **signing secret** (`whsec_…`). *(Likely unset today — the old docstring marked it "optional" and the code never read it.)*
2. **Signing is enabled** on the Resend inbound webhook for this endpoint (so `svix-id/timestamp/signature` headers are sent).
3. Deploy with `--no-verify-jwt` (keep `verify_jwt = false`).

**Post-deploy verification:** send a real email to a registered `invoice_email` (or replay a Resend delivery) → confirm a draft invoice is created and the function returns `200`; confirm a `curl` with a bogus body now returns `400/401`. Watch Edge Function logs + Resend delivery status.

## 4. What risk remains

- **R1 — Ingestion outage if §3 not satisfied.** The fix is correct; safe operation depends on the secret being set and Resend signing enabled. Gated by the required deploy step + post-deploy check. Until verified in the project, treat email ingestion as "armed but unconfirmed."
- **Svix version pin (`1.24.0`).** Pinned for reproducibility; the network probe for the latest version was unavailable in this environment. The post-deploy real-delivery test surfaces any import/version issue immediately; bump if Resend's signing format requires a newer release.
- **Crypto-path coverage.** The cryptographic `Webhook.verify` runs only in Deno (esm.sh import) and can't load under vitest; it is covered by the manual/deploy matrix, not CI. The synchronous header gate is unit-tested.
- **`parse-invoice` cost via this path:** forged calls are now blocked, but legitimate inbound emails still invoke `parse-invoice` with the service-role key (S0-1's intentional server bypass) — expected and unchanged.

## 5. What should be done next

1. **At deploy:** execute the §3 checklist (set secret, enable Resend signing, deploy `--no-verify-jwt`, run the 200/401 verification).
2. **Proceed to S0-5** (`inventory_sessions` DELETE → Manager+) — next in the Phase-1 P0 sequence. *(Not started, per instruction.)*

## 6. Verification snapshot
`tsc --noEmit` → clean. `vitest run` → **482 passed / 41 files** (incl. 6 new), green across repeated runs. New auth tests deterministic (6/6). The one occasionally-flaky `money-leak-snapshot` live-backend smoke is pre-existing and unrelated (passes in isolation).

## Rollback (from plan §8)
Isolated top-of-handler change → `git revert` the S0-3 commit + redeploy restores prior behavior and ingestion immediately; or correct `RESEND_WEBHOOK_SECRET` / redeploy the previous function version. Rejected requests write nothing → no data cleanup.
