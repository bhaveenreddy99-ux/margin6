# Prioritized Roadmap

**Date:** 2026-07-10  
**Derived from:** Read-only audit — see docs 01–06

---

## Phase 1 — Repository Reproducibility

**Goal:** Any engineer can verify build + test + deploy steps.

| Task | Exit criteria |
|------|---------------|
| Add `npm run typecheck` script | CI/local parity |
| Add GitHub Actions: lint, tsc, vitest, build | PR checks green |
| Document env vars in README | No secret values |
| Pin Node version | `.nvmrc` or engines field |

**Branch:** `chore/ci-quality-gates`  
**Risk:** Low

---

## Phase 2 — Security & Production Reconciliation

**Goal:** Repo state matches production; no legacy invite confusion.

| Task | Exit criteria |
|------|---------------|
| Deploy invite 4b/4c fixes + legacy cancel DELETE | Manager invite emails arrive |
| Fix Settings route for managers (Team tab) | Manager reaches Team without OwnerRoute block |
| Migration ledger reconciliation doc + apply missing | Prod RPC versions match |
| Slice 4d: remove legacy `invitations.insert` paths | No legacy rows created |
| Slice 5: DROP legacy invite tables/triggers | Single invite system |
| Revoke legacy anon grants on `invitations` | SQL verification |

**Branch:** `feat/invite-4d-cutover`, `fix/settings-manager-route`  
**Dependencies:** Phase 1 CI  
**Risk:** Medium — prod data migration

---

## Phase 3 — Onboarding

**Goal:** New owner → location → first count without dead ends.

| Task | Exit criteria |
|------|---------------|
| Force location assignment on invite accept | No zero-assignment members |
| Post-signup checklist UI | Empty states guide next step |
| Block dashboard money view until first approved count (optional) | Honest empty states |

**Branch:** `feat/onboarding-checklist`

---

## Phase 4 — Mobile Count Reliability

**Goal:** Count survives network loss and tab lifecycle.

| Task | Exit criteria |
|------|---------------|
| Autosave conflict tests | Two-tab test spec |
| Offline queue or explicit save status | User sees save state |
| STAFF session delete UI aligned with Jun 2026 RLS | No UI/API mismatch |

**Branch:** `feat/count-autosave-hardening`

---

## Phase 5 — Smart-Order Integrity

**Goal:** Deterministic, explainable reorder; no double-order.

| Task | Exit criteria |
|------|---------------|
| Document canonical reorder formula in domain | Single source |
| Subtract open PO qty in reorderEngine | Test: open PO prevents duplicate |
| Explain sheet for smart order lines | Manager can trace PAR → suggestion |

**Branch:** `fix/reorder-open-po-deduction`

---

## Phase 6 — Invoice & Receipt Integrity

**Goal:** Idempotent receipt; no duplicate price impact.

| Task | Exit criteria |
|------|---------------|
| Integration test: double confirm receipt | Second call no-op |
| Unify price-impact source (comparison OR notification) | Dashboard single count |
| Fix >5% price change confirm crash (if still open) | E2E receipt pass |

**Branch:** `fix/receipt-idempotency-tests`

---

## Phase 7 — Financial KPI Trust

**Goal:** All surfaces use LoadOutcome; one formula per KPI.

| Task | Exit criteria |
|------|---------------|
| Extend LoadOutcome to Reports | No silent $0 |
| Align portfolio moneyLost with dashboard or rename | UI labels distinct |
| Wire ProfitRiskWidget through computeMoneyLostTotal | No inline sum |

**Branch:** `fix/reports-load-outcome`

---

## Phase 8 — Notifications & Async

**Goal:** Trusted delivery; no spoofing; dedup.

| Task | Exit criteria |
|------|---------------|
| Verify process-notifications cron auth on prod | Logs clean |
| Notification dedup tests | No duplicate emails |
| Remove client-side notification INSERT if any remain | RPC-only create |

**Branch:** `fix/notification-pipeline`

---

## Phase 9 — Pilot Operations

**Goal:** Support 3 design partners.

| Task | Exit criteria |
|------|---------------|
| Runbook: invite, reset user, reconcile migration | Doc in docs/ops |
| Human audit script in CI (optional nightly) | Report artifact |
| Sentry or equivalent | Error visibility |

**Branch:** `chore/pilot-ops`

---

## Phase 10 — Scale Hardening

**Goal:** 100+ customers without rewrite.

| Task | Exit criteria |
|------|---------------|
| Dashboard query consolidation | Single RPC or materialized view spike |
| Pagination on large lists | No unbounded SELECT |
| RLS index review | pg advisor clean |

**Branch:** `perf/dashboard-aggregation`

---

## First 20 Cursor Tickets (Summary)

See final report Section L for full ticket details.

1. Add CI workflow (lint + tsc + test + build)
2. Add `npm run typecheck` script
3. Fix Settings OwnerRoute → manager Team access
4. Deploy legacy invite cancel DELETE fix
5. Cutover Team UI — block legacy invitations.insert (4d)
6. Migration ledger reconciliation script
7. DROP legacy invitations trigger (slice 5)
8. Extend LoadOutcome to Reports
9. Unify ProfitRiskWidget total formula
10. Portfolio moneyLost label/fix
11. Receipt idempotency integration test
12. Price-impact dedup audit + fix
13. Open PO deduction in reorderEngine
14. Enforce location assignment on accept_invite
15. STAFF catalog RLS tighten OR document API risk
16. Per-location permission flags → RPC enforcement (spike)
17. E2E invite flow spec (secure path)
18. Autosave two-tab Playwright test
19. Add Sentry to frontend + edge functions
20. Document production verification checklist per migration
