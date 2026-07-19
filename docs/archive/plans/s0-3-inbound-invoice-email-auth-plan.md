# Plan — S0-3: Verify the Resend webhook signature on `inbound-invoice-email`

> **Date:** 2026-06-23
> **Roadmap item:** S0-3 (P0 Security), effort **S–M** — [trust-first-roadmap.md](../trust-first-roadmap.md)
> **Workflow step:** STEP 3 — Create Plan ([engineering-workflow.md](../engineering-workflow.md))
> **Investigation:** [s0-3-inbound-invoice-email-auth.md](../investigations/s0-3-inbound-invoice-email-auth.md)
> **Status:** Awaiting approval — no code changed yet.

## 1. Root cause (one line)

`inbound-invoice-email` is `verify_jwt = false` with **no in-body signature check** (the documented `RESEND_WEBHOOK_SECRET` is never read), so anyone can POST a forged Resend payload and inject invoices.

## 2. Goal & success criteria

**Goal:** the function processes a request **only** when it carries a valid Resend/Svix signature. Mirror `stripe-webhook` (fail-closed). No new permission system; no processing-logic change.

Done when:
- A request with **no / invalid** Svix signature → rejected (`400`/`401`) with **no** DB write, no storage upload, no `parse-invoice` call, no email.
- A genuine Resend webhook (valid signature) → processes exactly as today.
- If `RESEND_WEBHOOK_SECRET` is unset → `500 "Server not configured"` (fail closed; never processes unsigned).
- CI (tests + types) green; the live ingestion path verified post-deploy (§5).

## 3. Chosen approach

Mirror [stripe-webhook/index.ts:14-66](../../supabase/functions/stripe-webhook/index.ts#L14-L66), using **Svix** verification (Resend's signing scheme).

1. **New shared helper** `supabase/functions/_shared/webhookAuth.ts` — pure, dependency-free:
   ```ts
   export interface SvixHeaders { "svix-id": string; "svix-timestamp": string; "svix-signature": string; }
   export function extractSvixHeaders(get: (name: string) => string | null): SvixHeaders | null;
   ```
   Returns the three headers when all present, else `null`. Pure → unit-testable under vitest (same tactic as S0-1/S0-2).
2. **`inbound-invoice-email/index.ts`** — at the top of the handler, **after** the `OPTIONS`/method checks and **before** building the service client / reading the body:
   - `const webhookSecret = Deno.env.get("RESEND_WEBHOOK_SECRET");` → if falsy, `500 "Server not configured"`.
   - `const svixHeaders = extractSvixHeaders((k) => req.headers.get(k));` → if `null`, `400 "Missing webhook signature"`.
   - `const rawBody = await req.text();` (raw bytes required for signature).
   - `let verified; try { verified = new Webhook(webhookSecret).verify(rawBody, svixHeaders); } catch { return 401 "Invalid webhook signature"; }`
   - Replace the current `const rawBody = await req.json()` ([index.ts:174](../../supabase/functions/inbound-invoice-email/index.ts#L174)) so downstream uses the **verified** payload object (`const body = verified?.data ?? verified;`). The body is read exactly once (as text), so no double-read of the stream.
   - Import `Webhook` from a pinned Svix esm.sh URL (Deno), e.g. `import { Webhook } from "https://esm.sh/svix@1.42.0";` (version pinned at implementation).
3. **`config.toml`** — **no change**: `verify_jwt = false` stays (Resend has no Supabase JWT; auth is the signature, consistent with `stripe-webhook`).

**Why fail-closed (not fail-open-if-unset):** a transitional "process unsigned when secret missing" mode would leave the P0 hole open. The cost is the deploy dependency in §5, which we gate explicitly.

## 4. Files affected

| # | File | Change | Risk |
|---|------|--------|------|
| 1 | `supabase/functions/_shared/webhookAuth.ts` | **New** pure `extractSvixHeaders` helper | Low |
| 2 | [inbound-invoice-email/index.ts](../../supabase/functions/inbound-invoice-email/index.ts#L155) | Add Svix verify gate at top of handler; switch body read to raw `text()` then use verified payload; import `Webhook` | Medium — must preserve the existing parse of `{type,data}` and not double-read the body |
| 3 | [config.toml](../../supabase/config.toml#L21-L22) | No change (documented) | — |
| 4 | `src/test/inbound-invoice-email-auth.test.ts` | **New** vitest unit tests for `extractSvixHeaders` | Low |

No client/UI change. No migration. No `package.json` change (Deno fetches `svix` at deploy).

## 5. Deployment / configuration dependencies (REQUIRED — gate the deploy)

1. **Set `RESEND_WEBHOOK_SECRET`** in Supabase Edge Function secrets = Resend inbound webhook **signing secret** (`whsec_…`). Likely **unset today** (docstring marks it "optional"). **If unset at deploy, every emailed invoice is rejected (500) and ingestion stops silently.**
2. **Enable signing on the Resend inbound webhook** for this endpoint (so `svix-*` headers are sent).
3. Deploy with `--no-verify-jwt` (keep `verify_jwt = false`).
4. **Post-deploy verification:** send a test email to a registered `invoice_email` (or replay a Resend delivery) → confirm a draft invoice is created and the function returns `200`; confirm a `curl` with a bogus body now returns `400/401`. Watch Edge Function logs + Resend delivery status.

## 6. Risks & mitigations

- **R1 — Ingestion outage if secret/signing not ready (§5.1–5.2).** → Gate the deploy on confirming both; fail-closed is intentional. Documented in results + summary; rollback in §8.
- **R2 — Body double-read / payload-shape regression.** The current code reads `req.json()` then unwraps `.data`. → Read `req.text()` once, verify, and feed the verified object through the *same* `?.data ?? body` unwrap + `validateInboundPayload`. Covered by the manual matrix (genuine payload still parses).
- **R3 — Svix version/API drift.** → Pin the esm.sh version; verify the `Webhook.verify(rawBody, headers)` signature at implementation against Resend's current docs.
- **R4 — Clock skew / timestamp tolerance.** Svix enforces a timestamp window; genuine Resend retries are within tolerance. → Default tolerance; note in runbook.

## 7. Alternatives considered

- **`verify_jwt = true`.** Rejected: Resend can't present a Supabase JWT; would block the only legitimate caller.
- **Shared static secret in a header / query param** (instead of Svix). Rejected: weaker (replayable, no body integrity) and diverges from Resend's actual signing; Svix gives body-integrity + replay protection.
- **Fail-open when secret unset.** Rejected (§3) — leaves the P0 open.

## 8. Rollback strategy

- **Code:** `git revert` the S0-3 commit + redeploy → restores prior (open but functional) behavior; ingestion resumes immediately. Isolated change, no schema/data.
- **Operational:** if verification wrongly blocks Resend, fix `RESEND_WEBHOOK_SECRET` / enable signing (most likely), or redeploy the previous function version. Rejected requests write nothing → no cleanup.
- **Detection:** post-deploy spike in 400/401 + drop in successful `invoice_id`s; Resend dashboard delivery failures.

## 9. Implementation order

1. **Precheck (no code):** re-confirm GATE green; re-confirm no client caller (done).
2. Add `_shared/webhookAuth.ts` pure helper.
3. Add the verify gate to `inbound-invoice-email/index.ts` (import Svix, fail-closed secret check, header check, raw-body verify, feed verified payload into existing flow).
4. Add vitest unit tests for `extractSvixHeaders`.
5. Run tests + typecheck → green.
6. **Deploy checklist (hand-off, §5):** set secret, enable Resend signing, deploy `--no-verify-jwt`, verify a real inbound email + a forged `curl`.

## 10. Test plan (preview — detailed in STEP 5)

The new logic is the synchronous signature gate; processing is unchanged.

| Case | Expected |
|------|----------|
| `extractSvixHeaders` all 3 present | object |
| any svix header missing | `null` (→ 400) |
| `RESEND_WEBHOOK_SECRET` unset | `500 Server not configured` (handler) |
| missing svix headers | `400 Missing webhook signature` |
| present headers, bad signature | `401 Invalid webhook signature`, **no** DB write / parse / email |
| genuine Resend signature | `200`, normal processing (draft invoice, parse, notify) |

- **Unit (vitest, CI):** `extractSvixHeaders` table above in `src/test/inbound-invoice-email-auth.test.ts`.
- **Crypto verify path (manual/integration, no Deno or svix in vitest):** documented matrix run against a served/deployed function — forged body → 401/400 with zero side effects; a replayed genuine Resend delivery → 200 + draft invoice. (Same cross-runtime constraint as S0-1/S0-2: esm.sh imports can't load under vitest.)
- **Regression:** full `vitest run` + `tsc --noEmit` green; no e2e affected (no UI caller).
- **Deploy verification:** §5.4.

## 11. Final-review questions to answer at STEP 6

What changed · problem solved (closed forged-invoice injection) · residual risk (secret/signing deploy dependency; crypto path manually verified) · next (S0-5 inventory_sessions DELETE → Manager+).

> No application code was modified in producing this plan.
