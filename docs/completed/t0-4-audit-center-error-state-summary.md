# Completed — T0-4: Audit Center error state (Failure ≠ $0)

> **Date:** 2026-06-23 · **Workflow step:** STEP 6 — Final Review
> **Investigation:** [t0-4-audit-center-error-state.md](../investigations/t0-4-audit-center-error-state.md) · **Plan:** [t0-4-audit-center-error-state-plan.md](../plans/t0-4-audit-center-error-state-plan.md) · **Results:** [t0-4-audit-center-error-state-results.md](../test-results/t0-4-audit-center-error-state-results.md)
> **Status:** Implemented, tests green — **not committed** (awaiting commit approval per instruction).

## 1. Exact files changed

| File | Change |
|------|--------|
| `src/hooks/useDashboardData.ts` | (a) **Reset the snapshot on error** — the `catch` now calls `setSnapshot(DEFAULT_SNAPSHOT)` before `setError`, so stale/zero KPI values can't be rendered as verified. (b) **Removed the false `// DEPRECATED: Not used` comment** (the hook has 3 live consumers — Dashboard, AuditCenter, PublicDemo) and replaced it with an accurate header documenting the T0-4 trust contract. |
| `src/pages/app/settings/AuditCenter.tsx` | (a) **Consume the error** — `{ loading, error, refetch, ...snapshot }` (was `error: _error, refetch: _refetch`, both ignored). (b) **Added an `if (error)` early-return error state** (after the `loading` guard, before any KPI computation/render): `AlertTriangle` + "Audit data couldn't load" + **Retry** wired to `refetch`. (c) Imported `AlertTriangle`. |
| `src/test/audit-center-error-state.test.tsx` | **New** — 7 tests (RTL component + source guards). |

## 2. What was fixed

The Audit Center — the product's verification/trust page — rendered **`$0` for every KPI with confidence badges and a data-quality score on load failure** (the hook never cleared its all-zero default snapshot, and the page ignored the `error`). Now:
- **Failure renders an explicit error + Retry**, and **no** KPI table, KPI value, confidence badge, or data-quality score.
- **Failure ≠ $0 / "all clear" / "verified".**
- Stale last-good values can't leak either (hook resets the snapshot on error).

## 3. Requirements ↔ implementation

| Requirement | Done |
|-------------|:----:|
| Hook: `setError` **and** reset snapshot in catch | ✅ `setSnapshot(DEFAULT_SNAPSHOT)` |
| Hook: fix false DEPRECATED comment | ✅ |
| AuditCenter: stop ignoring error; consume `error`/`refetch` | ✅ |
| AuditCenter: explicit error state (message + retry), matching Dashboard pattern | ✅ |
| Error state shows NO table / badges / quality score / values; never `$0` | ✅ (asserted in tests) |
| Verify all states (loading/success/first-fail/fail-after-success/retry) | ✅ (results doc) |
| Tests: first-load fail, stale prevention, retry, no values/badges on error | ✅ (7 tests) |

## 4. Verification
- `tsc --noEmit` → clean · `vitest run` → **563 passed** (+7) · `eslint` (changed files) → clean.
- The 7-test suite proves error/stale/retry/loading/success and pins the fix against regression via source guards.
- **Manual staging check pending** (no live server in sandbox): offline → `/app/settings/audit` shows error+Retry, not `$0`.

## 5. Risk assessment

| # | Risk | Status |
|---|------|--------|
| R1 | Hook snapshot-reset affects the other 2 consumers (Dashboard, PublicDemo) | Low — Dashboard already early-returns on `error` (`:1463`) so it never renders the reset snapshot; PublicDemo shows seeded data and only the rare error-after-success case changes (zeros instead of stale, no trust surface). |
| R2 | Losing stale-but-real values on a transient refetch error | Intended for a trust page — explicit error + Retry is correct. |
| R3 | Partial-success not representable (all-or-nothing `Promise.all`) | Full error state is the honest outcome today; per-KPI errors are a future enhancement. |
| R4 | Scope creep into T0-5 (self-fetching cards swallow errors) | **Not touched** — T0-5 is a separate item, explicitly out of scope. |

## 6. Rollback
Pure client change, no data touched → `git revert` the (future) commit. The two edits are independent: if the hook reset ever proves undesirable, revert just that line and keep the AuditCenter error guard (the primary fix).

## 7. Out of scope (per instruction)
- ❌ T0-5 (self-fetching `ShrinkageAlertCard` / `PriceHikeAlertsCard` swallow) — not started.
- ❌ No new KPI work, no formula changes, no other dashboard cards touched.
