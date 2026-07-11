# Trust Program — Implementation Plan

Goal: increase owner trust from **6/10 → 9+/10** via explainability, auditable KPIs, and data quality transparency.

**Out of scope:** POS, recipe costing, new operational features.

---

## Phase status

| Phase | Deliverable | Status | Effort |
|-------|-------------|--------|--------|
| 1 | `docs/kpi-definitions.md` | **Done** | 2 d |
| 2 | `docs/dashboard-label-audit.md` | **Done** (copy not applied to UI) | 1 d |
| 3 | `components/explainability/` | **Done** (core components) | 2 d |
| 4 | `src/domain/dataQuality/` | **Done** (scorer) | 1.5 d |
| 5 | KPI confidence engine | **Done** (domain + badge) | 1.5 d |
| 6 | Human audit report enhancement | **Done** (extended fields) | 1 d |
| 7 | Strict CI audit mode | **Done** (`E2E_STRICT_AUDIT=1`) | 1 d |
| 8 | Empty scenario tests | **Done** (vitest pure) | 1 d |
| 9 | Settings Audit Center | **Done** (page + route) | 2 d |

**Remaining to reach 9/10 (recommended next):**

| Item | Effort | Priority |
|------|--------|----------|
| Apply P0 label copy changes (Phase 2) | 0.5 d | P0 |
| Dynamic threshold copy on Reports tab | 0.5 d | P0 |
| Wire View Math on MoneyLostWidget via KpiExplainSheet | 1 d | P1 |
| Vendor-missing in data quality | 1 d | P1 |
| Unify overstock dedupe (hero vs card) | 2 d | P1 — **formula change — needs product sign-off** |
| Unify waste logic (Profit Leaks vs dashboard) | 2 d | P2 |
| PDF export from Audit Center | 2 d | P3 |

**Total delivered in this pass:** ~13 d equivalent documentation + foundation code.

**Total to 9/10 polish:** +5–8 d.

---

## Architecture

```
useDashboardData → KPISnapshot
        ↓
computeDataQualityScore(snapshot, meta)
computeKpiConfidence(snapshot, meta)
        ↓
Dashboard (banner + badges + explain sheets)
AuditCenter (full table)
        ↓
human-dashboard-trust-flow.spec.ts (UI vs Supabase)
dashboard-trust-calculations.test.ts (formula unit)
empty-scenario.test.ts (edge cases)
```

---

## Risks

| Risk | Impact | Mitigation |
|------|--------|------------|
| KPI formulas differ across surfaces | Owners catch contradictions | kpi-definitions.md + human audit CI |
| Strict CI flaky on shared staging data | False build failures | `E2E_SUPABASE_SERVICE_ROLE_KEY` + pinned test restaurant |
| Label changes confuse existing users | Support tickets | Phased rollout; tooltip “formerly Money Lost” |
| Overstock dedupe fix changes hero $ | Perceived regression | Communicate as bug fix; audit before/after |
| Confidence badges feel punitive | Trust drop | Copy focuses on data gaps not blame |
| Audit Center duplicates Dashboard | Low adoption | Link from low-confidence badges |

---

## Verification checklist

- [ ] `npm test` — unit + empty scenarios
- [ ] `npm run test:e2e:human-audit` — generates report
- [ ] `E2E_STRICT_AUDIT=1 npm run test:e2e:human-audit` — core KPIs must pass
- [ ] Owner opens Settings → Audit Center — values match Dashboard
- [ ] No NaN/Infinity in empty scenarios

---

## Files added/modified (this pass)

**Docs:** `docs/kpi-definitions.md`, `dashboard-label-audit.md`, `data-quality-design.md`, `confidence-scoring.md`, `owner-audit-center.md`, `trust-implementation-plan.md`

**Domain:** `src/domain/dataQuality/computeDataQualityScore.ts`, `computeKpiConfidence.ts`, `types.ts`

**UI:** `src/components/explainability/*`, `src/components/dashboard/DataQualityBanner.tsx`, `src/pages/app/settings/AuditCenter.tsx`

**Tests:** `src/test/dashboard-empty-scenarios.test.ts`, extended `tests/e2e/helpers/humanAudit/*`

**Routes:** `App.tsx` — `/app/settings/audit`; `Settings.tsx` — nav link

---

## Assumptions (none without code trace)

- All formulas traced to files listed in `kpi-definitions.md`
- Food cost locked until `weekly_sales.gross_sales > 0` — verified in `loadFoodCostMetrics.ts:96–98`
- Money Lost excludes invoice delivery dollar gaps — verified (count only in `deliveryIssuesCount`)
- Price hike uses qty=1 for notifications — verified in `priceIncreaseDollarImpact`

No assumptions about POS, recipes, or sales forecasting.
