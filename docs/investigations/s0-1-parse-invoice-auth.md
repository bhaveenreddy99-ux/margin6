# Investigation — S0-1: `parse-invoice` has no membership auth

> **Date:** 2026-06-23
> **Roadmap item:** S0-1 (P0 Security), [trust-first-roadmap.md](../trust-first-roadmap.md)
> **Workflow step:** STEP 2 — Investigate ([engineering-workflow.md](../engineering-workflow.md))
> **Status:** Investigation complete — no code changed.

## 1. Summary

The `parse-invoice` edge function — which calls the paid Anthropic API to OCR/parse invoices — is **effectively unauthenticated**. Two independent gates are both open:

1. **Gateway gate is off.** `supabase/config.toml` sets `verify_jwt = false` for `parse-invoice`, so Supabase's platform does not require or validate a JWT before invoking the function.
2. **In-function gate is cosmetic.** The handler only checks that the `Authorization` header *starts with* the literal string `"Bearer "`. It never validates the token's signature, never resolves a user, and never checks restaurant membership.

Net effect: **anyone who can produce a request with any `Authorization: Bearer <anything>` header can invoke the function** and cause real Anthropic spend. The project's anon key (shipped publicly in the client bundle) trivially satisfies the check, but so does a literally arbitrary string.

## 2. Current behavior (verified against code)

**Gateway config** — [supabase/config.toml:18-19](../../supabase/config.toml#L18-L19):
```toml
[functions.parse-invoice]
verify_jwt = false
```

**In-function check** — [supabase/functions/parse-invoice/index.ts:147-153](../../supabase/functions/parse-invoice/index.ts#L147-L153):
```ts
const authHeader = req.headers.get("Authorization");
if (!authHeader?.startsWith("Bearer ")) {
  return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, ... });
}
```
After this single string-prefix check the function proceeds to read `{ content, file_type }` from the body and immediately calls `https://api.anthropic.com/v1/messages` with `claude-sonnet-4-6`, `max_tokens: 4096` ([index.ts:249-304](../../supabase/functions/parse-invoice/index.ts#L249-L304)). There is:
- no `auth.getUser()` / token verification,
- no `restaurant_members` lookup,
- no per-user/per-restaurant rate limit,
- no size cap on PDF input (the 5 MB cap at [index.ts:63](../../supabase/functions/parse-invoice/index.ts#L63) applies to the `IMAGE` path only; the `PDF` and text paths forward `content` straight to Anthropic).

**Exploit shape:** `POST /functions/v1/parse-invoice` with header `Authorization: Bearer x` and a JSON body containing a large base64 PDF → unbounded, attacker-controlled Anthropic billing, with no account and no membership.

## 3. Root cause

The function was written to rely on the Supabase gateway for authentication (the normal pattern), but the gateway was explicitly disabled (`verify_jwt = false`) — likely so the email-ingestion / server-to-server paths could call it without a user JWT. To compensate, a placeholder auth check was added inside the function, but it only tests the *shape* of the header (`startsWith("Bearer ")`), not the *validity* of the token or the caller's authorization. The two layers were never reconciled, leaving both open.

This is the dominant pattern flagged in [role-permission-matrix.md](../role-permission-matrix.md) Part C (G6) and Part B ("Parse invoice (AI) — public — Bearer-presence only").

## 4. Why `verify_jwt = false` cannot simply be flipped to `true` alone

`verify_jwt = true` makes the gateway require a *valid project JWT* — but the **anon key is itself a valid project JWT** and is shipped in the public client bundle. So flipping the flag alone still admits anyone holding the anon key (i.e. anyone who views the site). Closing the abuse vector therefore requires **resolving a real authenticated user and confirming restaurant membership inside the function** (or via an RPC), not just toggling the gateway flag. The flag flip is still worthwhile as defense-in-depth (it rejects requests with no token at the edge), but it is not sufficient by itself.

## 5. Business impact

- **Unbounded Anthropic spend.** The headline risk in the roadmap. A trivial script can drive arbitrary cost against the project's `ANTHROPIC_API_KEY` with no account.
- **Cost/availability outage.** Hitting Anthropic spend or rate limits degrades the real, LIVE invoice-parsing workflow for paying customers ([product-reality.md](../product-reality.md) §6 lists AI parsing as LIVE).
- **Trust violation.** Directly contradicts CLAUDE.md "Security before features … RPCs must enforce permissions. Never trust UI permissions." This is a P0 on the pilot gate.

## 6. User impact

- **No direct data exposure** from this function alone: `parse-invoice` is stateless — it does not read or write restaurant tables; it only forwards `content` to Anthropic and returns parsed JSON. An attacker cannot read another restaurant's invoices *through this endpoint*.
- **Indirect customer harm:** if abuse exhausts spend/rate limits, legitimate users' uploads start failing (`429` / `500`), surfacing as "Could not read invoice — try again" in the UI.
- **No regression for legitimate users expected** once the fix authenticates real members — all real callers ([useInvoiceActions.ts](../../src/hooks/useInvoiceActions.ts)) are authenticated app users who are members of the active restaurant.

## 7. Affected components

| Layer | File | Note |
|-------|------|------|
| Gateway config | [supabase/config.toml:18-19](../../supabase/config.toml#L18-L19) | `verify_jwt = false` |
| Edge function | [supabase/functions/parse-invoice/index.ts:141-344](../../supabase/functions/parse-invoice/index.ts#L141) | placeholder auth at `:147-153` |
| Client callers | [src/hooks/useInvoiceActions.ts:532](../../src/hooks/useInvoiceActions.ts#L532), [:580](../../src/hooks/useInvoiceActions.ts#L580), [:789](../../src/hooks/useInvoiceActions.ts#L789) | send `{ content, file_type }` only — **no `restaurant_id` today** |

## 8. Affected tables

None written. The fix will **read** `restaurant_members` (`user_id`, `restaurant_id`, `role`) to confirm membership — the same table and pattern used by [create-checkout-session/index.ts:99-119](../../supabase/functions/create-checkout-session/index.ts#L99). No schema change.

## 9. Reusable pattern (no new auth system)

[create-checkout-session/index.ts:64-119](../../supabase/functions/create-checkout-session/index.ts#L64-L119) already implements exactly the auth shape we need (honors CLAUDE.md "do not duplicate … permission systems"):
1. Extract bearer token from `Authorization`.
2. `userClient.auth.getUser(token)` → reject `401` if no real user.
3. Query `restaurant_members` for the user (+ restaurant) → reject `403` if not a member.

The fix should follow this pattern verbatim.

## 10. Open questions for the plan

1. **Scope of membership check:** verify the user is a member of *any* restaurant (minimal, no client change) vs. a member of a *specific* `restaurant_id` passed in the body (stricter, requires threading `restaurant_id` from the client). Resolved in the plan (recommend per-restaurant, since the active restaurant is readily available client-side).
2. **Out of scope for S0-1 (note for roadmap):** per-user rate limiting and a PDF-size cap on the `content` payload are real abuse mitigations but are separate hardening items, not part of "add membership auth." Flag, do not build here.

## 11. Dependencies / sequencing

- **GATE (green CI)** precedes all P0 fixes per the roadmap. Confirm the suite/types are green before merging code for S0-1.
- S0-1 is independent of other Phase-1 items and does **not** require S0-INFRA (that is for RLS/RPC role helpers; this is an edge-function membership check).

> No application code was modified in producing this investigation.
