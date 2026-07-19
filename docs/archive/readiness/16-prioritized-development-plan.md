# 16 — Prioritized Development Plan

Ordered smallest safe fixes after discovery (for post-baseline work — **not executed in this run**).

## Phase 0 — Trust blockers (P1)

| # | Item | Defect | Effort | Acceptance |
|---|------|--------|--------|------------|
| 1 | Dashboard inventory value + last count date from approved session | DEF-LOCAL-002 | M | Owner A sees non-zero inventory for A1; date matches `…804` |
| 2 | Locations RLS: managers read only assigned locations | DEF-LOCAL-001 | S | Manager A1 SELECT A2 → 0 rows |

## Phase 1 — Core workflow completion (P2)

| # | Item | Defect | Effort | Acceptance |
|---|------|--------|--------|------------|
| 3 | Price hike alert card reads seeded notifications or invoice events | DEF-LOCAL-009 | M | Mozzarella increase visible once |
| 4 | Employee count entry on desktop (or document phone-only) | DEF-LOCAL-003 | M | Playwright can enter qty |
| 5 | Receipt confirm idempotency | DEF-LOCAL-008 | L | 1 movement per invoice under double-click + concurrent |

## Phase 2 — Test harness (non-product)

| # | Item | Defect | Effort |
|---|------|--------|--------|
| 6 | Update dashboard.smoke selectors | DEF-LOCAL-004 | S |
| 7 | Mobile-aware `expectEmployeeShell` | DEF-LOCAL-006 | S |
| 8 | Document `npx playwright install webkit` | DEF-LOCAL-005 | S |

## Phase 3 — Baseline re-run (QA)

| # | Action |
|---|--------|
| 9 | Re-run Suites 1–2 with reject→approve + DB snapshots |
| 10 | Run Suite 6 concurrency (two browser contexts) |
| 11 | Complete Suite 8 financial table (UI vs RPC vs domain) |
| 12 | Full 8-user authorization matrix |

## Phase 4 — Sellable polish

| # | Item |
|---|------|
| 13 | Smart order open PO deduction verification |
| 14 | Reports ↔ dashboard formula parity check |
| 15 | Recovery suite (refresh, offline, two tabs) |

## Sequencing rationale

Dashboard and location RLS are **trust** issues that block every downstream demo. Receipt idempotency is **financial safety**. Harness fixes unblock observation without changing product behavior. Full baseline re-run should happen only after Phase 0–1 so defects aren't rediscovered.

## Estimated timeline (engineering)

- Phase 0: 2–4 days
- Phase 1: 1–2 weeks
- Phase 2–3: 3–5 days QA
- Phase 4: ongoing stabilization
