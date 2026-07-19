# Completed — S0-1: Enforce membership auth on `parse-invoice`

> **Date:** 2026-06-23
> **Workflow step:** STEP 6 — Final Review ([engineering-workflow.md](../engineering-workflow.md))
> **Roadmap item:** S0-1 (P0 Security) — [trust-first-roadmap.md](../trust-first-roadmap.md)
> **Investigation:** [investigations/s0-1-parse-invoice-auth.md](../investigations/s0-1-parse-invoice-auth.md) · **Plan:** [plans/s0-1-parse-invoice-auth-plan.md](../plans/s0-1-parse-invoice-auth-plan.md) · **Results:** [test-results/s0-1-parse-invoice-auth-results.md](../test-results/s0-1-parse-invoice-auth-results.md)

## 1. What changed

| File | Change |
|------|--------|
| [supabase/functions/_shared/parseInvoiceAuth.ts](../../supabase/functions/_shared/parseInvoiceAuth.ts) | **New.** Pure, dependency-free auth-triage helpers: `extractBearerToken` and `classifyParseInvoiceToken` (→ `reject` / `service` / `user`). Shared by the Deno function and the vitest test. |
| [supabase/functions/parse-invoice/index.ts](../../supabase/functions/parse-invoice/index.ts#L159-L207) | Replaced the cosmetic `header.startsWith("Bearer ")` check with: token triage → 401 on no token; **service-role key bypass** for trusted server callers; for every other token, `auth.getUser(token)` (401 if invalid) + required `restaurant_id` (400 if absent) + `restaurant_members` membership check (403 if not a member). All rejections occur **before** the paid Anthropic call. |
| [src/hooks/useInvoiceActions.ts](../../src/hooks/useInvoiceActions.ts) | Added `restaurant_id: currentRestaurantId` to all three `parse-invoice` invocations (PDF, photo, save flow); added `currentRestaurantId` to the two affected `useCallback` dependency arrays. |
| [supabase/config.toml](../../supabase/config.toml) | **Unchanged** (documented decision): `verify_jwt` stays `false` because the function owns auth itself — the anon key is a valid project JWT, so the gateway flag cannot distinguish real users, and a tokenless service path must still be possible. |
| `src/test/parse-invoice-auth.test.ts` | **New.** 10 unit tests pinning the triage logic (anon key ≠ bypass; exact service-key match only; no-token reject). |

Plus the three workflow docs (investigation, plan, results) and this summary.

## 2. What problem was solved

`parse-invoice` was effectively unauthenticated (`verify_jwt = false` + a header-shape-only check), so anyone with the publicly-shipped anon key — or any string-shaped bearer — could drive **unbounded Anthropic spend** and degrade the live invoice-parsing workflow for paying customers (roadmap S0-1 / G6). The function now does paid work **only** for an authenticated member of the target restaurant, or for a trusted server-to-server caller holding the server-only service-role key. This honors CLAUDE.md "Security before features … RPCs must enforce permissions. Never trust UI permissions."

## 3. What risk remains

- **Live async-path verification pending deploy.** The user-validation + membership branch could not be executed here (no Deno; edge functions don't run under `npm run dev`). The synchronous bypass logic is unit-tested; the 401/403/400/200 matrix is documented for a `supabase functions serve` / post-deploy run. **Run before relying on the fix in production.**
- **No rate limit or payload size cap** (explicitly out of S0-1 scope). A compromised member account or the unauthenticated `audit-invoice-anon` lead-gen endpoint can still drive cost. Recommend a follow-up hardening item: per-user/per-restaurant rate limiting + a `PDF`/text `content` size cap (only `IMAGE` is capped today).
- **Service-key trust is coarse.** Both server callers bypass via the service key; their own front-door auth is tracked separately — `inbound-invoice-email` webhook auth is **S0-3**, and `audit-invoice-anon` is intentionally public (its own abuse surface). Not regressed by this change, but not closed by it either.
- **Client UX for a missing active restaurant:** if `currentRestaurantId` were ever null at upload time, the function returns 400 and the existing catch surfaces an error toast. Acceptable; the invoices page requires an active restaurant.

## 4. What should be done next

1. **At deploy:** run the documented 401/403/400/200 + service-bypass matrix against the served function; confirm a real member upload still parses and a `Bearer x` call now returns 401.
2. **Proceed to S0-2** (`process-notifications` publicly invokable) — next in the Phase-1 P0 security sequence. *(Not started, per instruction.)*
3. **File a follow-up** for `parse-invoice` rate limiting + payload size cap (out-of-scope hardening identified here).

## 5. Verification snapshot
- `tsc --noEmit` → clean. `vitest run` → 467 passed (incl. 10 new). `playwright invoice-flow.spec.ts` → invoice-page tests pass; the lone failure is the unrelated pre-existing billing **$69.99/$99** contradiction (**T0-8**).
