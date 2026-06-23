# Investigation — S0-3: `inbound-invoice-email` has no webhook authentication

> **Date:** 2026-06-23
> **Roadmap item:** S0-3 (P0 Security), [trust-first-roadmap.md](../trust-first-roadmap.md)
> **Workflow step:** STEP 2 — Investigate ([engineering-workflow.md](../engineering-workflow.md))
> **Status:** Investigation complete — no code changed.

## 1. Summary

`inbound-invoice-email` ingests vendor invoices that arrive by email. It is a **public, unauthenticated** endpoint that performs **privileged, service-role writes** (creates invoices, uploads files, inserts line items, sends emails, writes notifications) — and it verifies **nothing** about the caller:

1. **Gateway gate off** — `supabase/config.toml` → `[functions.inbound-invoice-email] verify_jwt = false` ([config.toml:21-22](../../supabase/config.toml#L21-L22)).
2. **No in-function gate** — despite the function's own docstring claiming *"1. Verify the webhook secret from Resend"* ([index.ts:8](../../supabase/functions/inbound-invoice-email/index.ts#L8)) and listing `RESEND_WEBHOOK_SECRET` as a secret ([index.ts:19](../../supabase/functions/inbound-invoice-email/index.ts#L19)), **the handler never reads that secret and never verifies a signature.** It goes straight from a method check to a service-role client and processes the body ([index.ts:155-201](../../supabase/functions/inbound-invoice-email/index.ts#L155-L201)).

Net effect: **anyone who can POST a forged Resend-shaped JSON payload can inject invoices into a real restaurant**, drive AI-parse spend, write notifications, and send emails to owners/managers — confirmed in [role-permission-matrix.md](../role-permission-matrix.md) G8 and [product-reality.md](../product-reality.md) §6 ("forged payloads can inject invoices"). This is a pilot-gate P0.

## 2. How email currently enters the system (verified)

The end-to-end ingestion path (from the docstring [index.ts:1-25](../../supabase/functions/inbound-invoice-email/index.ts#L1-L25) + handler):

1. A restaurant has a unique inbound address in `restaurant_settings.invoice_email` (e.g. `midwest-ab3x7f@invoices.margin6.com`).
2. **DNS/MX** for `invoices.margin6.com` point to **Resend**'s inbound mail servers (config outside the repo).
3. A vendor emails an invoice (PDF/image attachment) to that address.
4. **Resend receives the email and POSTs a webhook** `{"type":"email.received","data":{ from, to[], subject, attachments[] … }}` to `https://<project-ref>.supabase.co/functions/v1/inbound-invoice-email`.
5. The function ([index.ts:203-236](../../supabase/functions/inbound-invoice-email/index.ts#L203-L236)) routes by the `to` address → `restaurant_settings.invoice_email` (`ilike`) → `restaurant_id`; unknown addresses return `200 {ignored:true}` (so Resend won't retry).
6. It downloads the attachment, dedups retries, **creates a `draft` invoice**, uploads to `invoice-uploads`, inserts an `invoice_ingestions` row, calls **`parse-invoice`** (with the service-role key), patches the invoice header, inserts `invoice_items`, matches catalog, and **notifies + emails OWNER/MANAGER** ([index.ts:289-687](../../supabase/functions/inbound-invoice-email/index.ts#L289)).

This webhook is the **only automated email-ingestion path**. (Manual upload via the app — `useInvoiceActions` → `parse-invoice` — is a separate, authenticated path and is unaffected by S0-3.)

## 3. Who is expected to call the webhook (verified)

**Only Resend's inbound-email service.** Evidence:
- The docstring names Resend and the inbound webhook URL ([index.ts:4-24](../../supabase/functions/inbound-invoice-email/index.ts#L4-L24)).
- The payload type is the Resend inbound shape (`{type:"email.received", data:{…}}`, [index.ts:178-179](../../supabase/functions/inbound-invoice-email/index.ts#L178-L179)).
- The CORS allow-list already includes **`svix-id, svix-timestamp, svix-signature`** ([index.ts:42](../../supabase/functions/inbound-invoice-email/index.ts#L42)) — Resend signs webhooks using the **Svix** "Standard Webhooks" scheme. These headers are the signature the function should verify.
- **No client/app code calls it** (`grep inbound-invoice-email src/` → none). There is no legitimate first-party caller to accommodate.

→ The correct authentication is **Svix signature verification** using the Resend webhook signing secret (`RESEND_WEBHOOK_SECRET`, a `whsec_…` value), exactly as `stripe-webhook` verifies the `stripe-signature` with `STRIPE_WEBHOOK_SECRET`.

## 4. Will existing ingestion break? (the central risk)

**It can — and this is the most important deployment dependency.** Strict signature verification rejects any request without a valid Resend/Svix signature. Ingestion continues to work **only if both** are true at deploy time:

1. **`RESEND_WEBHOOK_SECRET` is set** in Supabase Edge Function secrets, to the value of Resend's inbound webhook **signing secret**.
2. **Resend's inbound webhook is configured to sign** requests (Svix signing enabled on that endpoint), so it actually sends `svix-id/svix-timestamp/svix-signature`.

Today the docstring marks `RESEND_WEBHOOK_SECRET` **"(optional)"** ([index.ts:19](../../supabase/functions/inbound-invoice-email/index.ts#L19)) and the code never reads it — strong evidence the secret may **not be set** in the project. If we deploy strict verification while the secret is unset (or Resend signing is off), **all emailed invoices stop ingesting silently** (each rejected with 4xx/5xx; Resend may retry then drop). This mirrors the S0-2 cron-GUC dependency and must be a gated deploy step, not an afterthought.

**Mitigation choice (resolved in plan): fail closed**, paired with a required pre-deploy verification that the secret is set and Resend signing is on. A "fail-open-if-secret-unset" mode is explicitly rejected — it would leave the P0 hole open and defeat the fix.

## 5. Root cause

The function was designed with webhook verification in mind (docstring step 1, the `svix-*` CORS headers, the documented `RESEND_WEBHOOK_SECRET`) but the verification was **never implemented** — only stubbed in comments. With `verify_jwt = false` (correct, since Resend has no Supabase JWT) and no compensating in-body signature check, the endpoint is fully open. The sibling `stripe-webhook` shows the intended pattern was known and applied elsewhere but not here.

## 6. Reusable pattern (no new auth system)

[stripe-webhook/index.ts:14-66](../../supabase/functions/stripe-webhook/index.ts#L14-L66) is the in-repo template:
- read required secret from env; **fail closed (500)** if unset;
- require the signature header; **400** if missing;
- read the **raw body** (`req.text()`), verify signature against the raw bytes; **400/401** on failure;
- only then process.

S0-3 applies the same shape using **Svix** verification (Resend's scheme) instead of Stripe's SDK. Svix provides a Deno-importable verifier (`https://esm.sh/svix` → `new Webhook(secret).verify(rawBody, { "svix-id", "svix-timestamp", "svix-signature" })`).

## 7. Business impact

- **Forged invoice injection** — an attacker who knows/guesses a restaurant's `invoice_email` can POST fake invoices into that restaurant's books (draft invoices, line items, totals), corrupting purchasing/cost data and any KPI derived from it.
- **AI-parse cost abuse** — every forged call invokes `parse-invoice` (paid Anthropic). (Note: S0-1 now gates `parse-invoice`, but this function calls it with the **service-role key**, which S0-1 intentionally bypasses — so forged inbound calls still reach the paid parse.)
- **Email + notification spam to real owners/managers** — the function emails OWNER/MANAGER and writes notifications, so forgery becomes a channel to phish/spam the restaurant's decision-makers ("New invoice from <vendor>").
- **Trust violation** — CLAUDE.md "Security before features … never trust UI"; financial data integrity is the product.

## 8. User impact

- **Owners/managers** could see fabricated invoices and receive spoofed "invoice received" emails that look legitimate.
- **Data integrity:** forged `invoices`/`invoice_items` pollute Purchase History, price comparisons, and spend.
- **No first-party regression expected** from the fix: the only legitimate caller is Resend, which signs requests — provided §4's secret/signing prerequisites are met.

## 9. Affected components

| Layer | File | Note |
|-------|------|------|
| Gateway config | [config.toml:21-22](../../supabase/config.toml#L21-L22) | `verify_jwt = false` (keep — Resend has no Supabase JWT) |
| Edge function | [inbound-invoice-email/index.ts:155-201](../../supabase/functions/inbound-invoice-email/index.ts#L155-L201) | add Svix verification before any processing; switch body read to raw text |
| Secret | `RESEND_WEBHOOK_SECRET` | currently unread; must be **set** in project (Resend signing secret) |
| Resend dashboard | (outside repo) | inbound webhook signing must be **enabled** |
| Pattern source | [stripe-webhook/index.ts:14-66](../../supabase/functions/stripe-webhook/index.ts#L14-L66) | mirror (fail-closed) |

**No client/UI code** references the function → no front-end change.

## 10. Affected tables

None changed. The fix adds **no** DB reads/writes — it gates the entry point before the existing service-role processing (`invoices`, `invoice_ingestions`, `invoice_items`, `notifications`, storage) runs.

## 11. Deployment / configuration dependencies (must all hold)

1. **`RESEND_WEBHOOK_SECRET` set** in Supabase Edge Function secrets = Resend inbound webhook signing secret (`whsec_…`). *(Verify; likely unset today.)*
2. **Resend inbound webhook signing enabled** for the `inbound-invoice-email` endpoint (so `svix-*` headers are sent).
3. **`verify_jwt = false` retained** (Resend presents no Supabase JWT); deploy with `--no-verify-jwt`.
4. New Deno dependency: `svix` via esm.sh URL import in the function (no `package.json` change; Deno fetches at deploy).

## 12. Rollback strategy

- **Primary (code):** the change is isolated to the top of the handler (verify → then existing flow). `git revert` the S0-3 commit and redeploy → returns to the prior (open but functional) behavior; ingestion resumes immediately. Low risk, no schema/data involved.
- **Fast operational mitigation if verification wrongly blocks Resend in prod:** (a) correct/set `RESEND_WEBHOOK_SECRET` to match Resend's signing secret and confirm signing is on (most likely fix), or (b) redeploy the previous function version (Supabase retains versions) / revert the commit. No data cleanup needed — rejected requests write nothing.
- **Detection:** monitor Edge Function logs for a spike in 400/401 from this function and a drop in successful `invoice_id` results after deploy; Resend dashboard shows webhook delivery failures.

## 13. Open questions for the plan

1. **Is `RESEND_WEBHOOK_SECRET` set and is Resend signing enabled?** Cannot be read from here → required pre-deploy verification (§11). — Resolved as a gated deploy step.
2. **Svix library version / exact verify call** for Deno (esm.sh). — Plan pins a version and the `Webhook.verify` usage; crypto path verified manually (vitest can't load esm.sh URL imports).
3. **Testability:** extract a pure `extractSvixHeaders` helper for CI unit tests (header presence → 400 path); the cryptographic verify is covered by a manual/integration matrix (same constraint as S0-1/S0-2).

## 14. Dependencies / sequencing

- **GATE** green (confirmed during S0-1/S0-2). Independent of S0-INFRA. Next item after S0-2 in Phase-1.

> No application code was modified in producing this investigation.
