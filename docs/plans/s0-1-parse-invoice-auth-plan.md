# Plan — S0-1: Enforce membership auth on `parse-invoice`

> **Date:** 2026-06-23
> **Roadmap item:** S0-1 (P0 Security), effort **S** — [trust-first-roadmap.md](../trust-first-roadmap.md)
> **Workflow step:** STEP 3 — Create Plan ([engineering-workflow.md](../engineering-workflow.md))
> **Investigation:** [s0-1-parse-invoice-auth.md](../investigations/s0-1-parse-invoice-auth.md)
> **Status:** Awaiting approval — no code changed yet.

## 1. Root cause (one line)

`parse-invoice` relies on the gateway for auth, but the gateway is disabled (`verify_jwt = false`) and the in-function check only tests `header.startsWith("Bearer ")` — so any string-shaped bearer (incl. the public anon key) reaches the paid Anthropic call.

## 2. Goal & success criteria

**Goal:** the function executes the Anthropic call **only** for a request from a real authenticated user who is a member of the restaurant the invoice belongs to. Reuse the existing auth pattern; introduce no new permission system.

Done when:
- A request with a missing/invalid/arbitrary bearer → `401`, **no Anthropic call**.
- A valid user JWT but not a member of the target restaurant → `403`, **no Anthropic call**.
- A valid member → unchanged behavior (parse succeeds).
- CI (tests + types) is green.

## 3. Chosen approach

**Per-restaurant membership check** (recommended over "any restaurant"), reusing the [create-checkout-session](../../supabase/functions/create-checkout-session/index.ts#L64-L119) pattern:

1. **`supabase/config.toml`** — leave `verify_jwt = false`. The function must do its own user resolution anyway (the anon key is a valid JWT, so the gateway flag can't distinguish real users), and the email-ingestion path may invoke without a user JWT. Defense-in-depth via the flag is *not* relied upon. _(See §7 for the alternative.)_
2. **`parse-invoice/index.ts`** — replace the prefix check at [:147-153](../../supabase/functions/parse-invoice/index.ts#L147-L153) with:
   - extract the token from `Authorization`;
   - create a service-role client and call `auth.getUser(token)` → `401` on failure;
   - read `restaurant_id` from the request body → `400` if absent;
   - query `restaurant_members` for `(user_id, restaurant_id)` → `403` if no row;
   - only then proceed to the existing Anthropic call (no change below this point).
3. **`src/hooks/useInvoiceActions.ts`** — add `restaurant_id` to the body of all three `parse-invoice` invocations ([:532](../../src/hooks/useInvoiceActions.ts#L532), [:580](../../src/hooks/useInvoiceActions.ts#L580), [:789](../../src/hooks/useInvoiceActions.ts#L789)), sourced from the existing active-restaurant context (`RestaurantContext`). The hook already operates within a selected restaurant.

**Why per-restaurant over "any membership":** it is barely more work (the active restaurant id is already in scope client-side), and it is the correct trust posture — a member of restaurant A should not be able to spend the API on behalf of restaurant B. Matches the `create-checkout-session` precedent.

## 4. Files affected

| # | File | Change | Risk |
|---|------|--------|------|
| 1 | [supabase/functions/parse-invoice/index.ts](../../supabase/functions/parse-invoice/index.ts) | Replace placeholder auth (`:147-153`) with token validation + `restaurant_members` membership check; require `restaurant_id` in body | Medium — must not break the legitimate parse path |
| 2 | [src/hooks/useInvoiceActions.ts](../../src/hooks/useInvoiceActions.ts) | Add `restaurant_id` to 3 invoke bodies | Low |
| 3 | [supabase/config.toml](../../supabase/config.toml) | No change (documented decision) — or optional flip to `true` (§7) | Low |

No new files, no migration, no schema change.

## 5. Risks & mitigations

- **Regression: legitimate parsing breaks if `restaurant_id` is unavailable at a call site.** → Verify each of the 3 call sites has the active restaurant in scope before wiring; if any does not, fall back to "member of any restaurant" for that site rather than send `null`. Confirm during implementation.
- **Email-ingestion / server path** ([inbound-invoice-email](../../supabase/functions/inbound-invoice-email/index.ts)) may invoke `parse-invoice` without a user JWT. → Grep for all invokers (server + client) before changing; if a service-to-service caller exists, gate it with the service-role key / internal secret rather than a user token, so we don't break ingestion. **Must verify before coding.**
- **CORS / error contract drift.** → Keep `corsHeaders` and the existing JSON `{ error }` shape; reuse the existing `401` body so client error handling is unchanged.
- **`getUser` latency.** → One extra round-trip; negligible vs. the Anthropic call.

## 6. Implementation order

1. **Precheck (no code):** confirm GATE is green; grep every `parse-invoice` invoker (client + edge functions) to enumerate all callers and confirm whether any are server-to-server.
2. Edge function: add token validation + membership check (fail closed, no Anthropic call on reject).
3. Client: thread `restaurant_id` into the 3 invoke bodies.
4. Handle any server-to-server caller found in step 1 (internal-secret path) if applicable.
5. Run tests + typecheck → green.

## 7. Alternative considered

- **Flip `verify_jwt = true` and rely on the gateway.** Rejected as the *sole* fix: the anon key is a valid project JWT, so the gateway would still admit any site visitor. May still be applied as defense-in-depth, but only alongside the in-function membership check. Decision: keep `false` and own auth in the function to avoid breaking any tokenless server caller and to keep one explicit code path.
- **"Member of any restaurant" check.** Simpler (no client change) but weaker — permits cross-restaurant API spend. Rejected in favor of per-restaurant, kept as the documented fallback if a call site lacks `restaurant_id`.

## 8. Out of scope (flag for roadmap, do not build here)

- Per-user/per-restaurant **rate limiting** on `parse-invoice`.
- **Size cap** on the `PDF`/text `content` payload (only `IMAGE` is capped today at [index.ts:63](../../supabase/functions/parse-invoice/index.ts#L63)).

Both are genuine abuse mitigations but are distinct from "add membership auth" (S0-1). Recommend a follow-up hardening item.

## 9. Test plan (preview — detailed in STEP 5)

Edge-function auth is the new logic; tests must prove **fail-closed before the Anthropic call**:

| Case | Expected |
|------|----------|
| No `Authorization` header | `401`, no Anthropic fetch |
| `Authorization: Bearer garbage` (invalid token) | `401`, no Anthropic fetch |
| Valid user, no `restaurant_id` in body | `400`, no Anthropic fetch |
| Valid user, `restaurant_id` they are **not** a member of | `403`, no Anthropic fetch |
| Valid user + member, missing `content` | `400` (existing behavior preserved) |
| Valid user + member, valid `content` | `200`, Anthropic called once (mock), parsed result returned |

- **Unit:** mock `auth.getUser` and the `restaurant_members` query; assert status codes and that the Anthropic `fetch` is **not** called on the 401/403/400 paths (spy/mock fetch).
- **Type:** `tsc` clean.
- **Manual smoke:** upload a real PDF and a photo as a logged-in member → still parses; confirm a `curl` with `Bearer x` now returns `401`.
- **Regression:** existing `parse-invoice` validation tests (`validateExtractedInvoice`, weight-item correction) still pass — that logic is untouched.

## 10. Final-review questions to answer at STEP 6

What changed · what problem solved (closed unbounded-spend vector) · residual risk (no rate limit / size cap — see §8) · next (S0-2 `process-notifications`).

> No application code was modified in producing this plan.
