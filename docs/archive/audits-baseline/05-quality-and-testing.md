# Quality & Testing Audit

**Date:** 2026-07-10  
**Commands run:** 2026-07-10 on local workspace

---

## Quality Gate Results

| Command | Exists | Run | Result | Notes |
|---------|--------|-----|--------|-------|
| `npm ci` | Yes | **Not run** | — | Would modify node_modules |
| `npm run lint` | Yes | Yes | **Exit 0**, 240 problems (180 errors, 60 warnings) | ESLint reports errors but exits 0 — gate ineffective |
| `npm run typecheck` | **No** | — | Missing script | Use `npx tsc -p tsconfig.app.json --noEmit` |
| `npx tsc -p tsconfig.app.json --noEmit` | — | Yes | **Exit 0** | Passes despite `strict: false` |
| `npm run test` | Yes | Yes | **Pass** — 58 files, 601 tests, 7.28s | All green |
| `npm run build` | Yes | Yes | **Pass** — 6.37s | Chunks >600kB warned |
| `npm run test:e2e` | Yes | **Not run** | Environment-dependent | Requires E2E_EMAIL/E2E_PASSWORD or auth file |

---

## TypeScript Strictness

| Setting | Value | Risk |
|---------|-------|------|
| `strict` (app) | **false** | High — null/any holes |
| `strictNullChecks` (root) | **false** | High |
| `@typescript-eslint/no-unused-vars` | off | Noise tolerated |

---

## Type Safety Counts (src/)

| Pattern | Count (approx) |
|---------|----------------|
| Explicit `any` (`: any`, `as any`) | **~16 files**, ~70 occurrences |
| `@ts-ignore` / `@ts-expect-error` | **0** in src/ (Confirmed) |
| `eslint-disable` | ~43 across repo (hooks, e2e, contexts) |

**Domain layer:** No explicit `any` in `src/domain/*.ts` (Confirmed by subagent audit).

---

## Test Coverage Matrix

| Area | Classification | Evidence |
|------|----------------|----------|
| Tenant isolation | Partial | `restaurant-isolation.spec.ts`, `multi-restaurant.spec.ts` — env-dependent |
| Role permissions | **Strong** | `authz-parity.test.ts` (70 tests) |
| Invitation security | Partial | SQL tests in `supabase/tests/`; E2E missing |
| Unit conversion | **Strong** | `casePlanningEngine.test.ts`, `inventory-conversions.test.ts` |
| Inventory valuation | **Strong** | Trust calculation tests |
| Count lifecycle | Partial | Zone tests; concurrency missing |
| Smart-order math | Partial | `smart-order-from-session.test.ts` |
| Invoice matching | Partial | `invoice-matching.test.ts`, comparison tests |
| Receipt idempotency | **Missing** | No dedicated integration test found |
| Dashboard error states | **Strong** | `dashboard-empty-scenarios`, LoadOutcome tests |
| Edge-function auth | Partial | `parse-invoice-auth`, `inbound-invoice-email-auth`, `process-notifications-auth` |
| Onboarding E2E | Weak | Smoke tests skip without auth |
| Mobile count recovery | **Missing** | — |
| Food cost | Partial | `load-food-cost-metrics.test.ts` |

---

## E2E Assumptions

- `E2E_EMAIL`, `E2E_PASSWORD` or `PLAYWRIGHT_AUTH_FILE`
- Live Supabase backend (not isolated)
- Many tests use `test.skip()` when auth or fixture data missing
- Human audit: `human-dashboard-trust-flow.spec.ts` — compares UI to live DB

---

## Flaky / Skipped Patterns

- Widespread conditional `test.skip(Boolean(missingAuthReason))`
- Invoice-flow skips when no invoice in restaurant
- No `.only()` abuse found in src tests

---

## SQL Tests (supabase/tests/)

6 files including invite RLS, accept_invite, create_invite — run manually against migrated DB; not in CI.
