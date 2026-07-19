# T0-0 — KPI Remediation Roadmap

> **Date:** 2026-06-23 · Companion to the [investigation](../investigations/t0-0-kpi-canonical-investigation.md), [trust matrix](../architecture/t0-0-kpi-trust-matrix.md), [registry](../architecture/t0-0-kpi-registry.md), [dashboard recommendation](t0-0-dashboard-recommendation.md). No code — sequencing only.
> **Aligns with** the existing T0/T1 items in [trust-first-roadmap.md](../trust-first-roadmap.md); this roadmap is the KPI-specific ordering and the registry-adoption plan that **T0-0 must land first**.
> **Effort key:** S ≤ 0.5d · M = 1–2d · L = 3–5d.

## Ordering principle

Make the **registry real** (one formula, imported by the renderer) **before** fixing any individual number — otherwise every fix lands in the dead canonical copy while the UI keeps rendering its inline version (the current trap). Then fix the **failure modes** (a KPI that lies on error is worse than a wrong-but-honest one), then the **mixed/duplicated** numbers, then **promote** hidden KPIs.

## Phase 0 — Adopt the canonical registry (T0-0 itself). Effort: **M**
1. **Un-dead `dashboardTrustFormulas.ts`:** make the composite formulas (`computeMoneyLostTotal`, `computeDashboardSavingsBannerTotal`, food-cost wrapper) the **imported** source — `ProfitRiskWidget.tsx:93` and `Dashboard.tsx:765` call them instead of inline sums. Explain builders read the **same** formula strings (from the registry).
2. **Parity test that bites:** assert the rendered value === the canonical function for the hero and banner (today the test asserts only the canonical, which the UI ignores).
3. **No number changes yet** — this is pure de-duplication so subsequent fixes land once.
*Exit:* every composite KPI has exactly one formula, imported by its renderer + explain builder + test.

## Phase 1 — Stop the lies (failure modes). Effort: **S–M**
4. **T0-4 — Audit Center error state:** consume `error` (stop ignoring `_error` at `AuditCenter.tsx:60`); render an explicit error/retry state, **never** `$0` with a confidence badge. *(Highest priority — the trust page must not fabricate audited zeros.)*
5. **T0-5 — self-fetching cards:** PriceHike/Shrinkage/ProfitLeaks cards must surface load errors, not render `$0`/"all clear." Failure ≠ zero (registry rule 4).
6. **T0-6 — Vendor Connect mock:** hide/remove the mock-invoice tab (mock-as-real).

## Phase 2 — Fix the mixed / duplicated numbers (Money-Rules). Effort: **M each**
7. **T0-1 — split Profit Risk hero:** present Verified losses (waste + price + missing-delivery) separately from Potential overstock and Derived shrinkage — never one summed figure. (Now lands in the canonical formula from Phase 0.)
8. **T0-2 — fix Savings banner:** remove overstock from "recoverable savings" (or relabel as "cash tied up"); kill the double-label vs the hero.
9. **T0-3 — de-duplicate Price-Increase:** pick **one** source (comparison **or** notifications) and **one** qty basis; align `loadSpendMetrics.ts:169` and `loadProfitLeaks.ts:217`. Then the per-invoice aggregate can be promoted.
10. **T0-7 — re-source/label Shrinkage:** keep it server-sourced (S0-8 already closed forgery); **label as an estimate** (Derived), not a verified loss; long-term, source from immutable count/movement deltas.

## Phase 3 — Promote hidden KPIs (visible truth). Effort: **M**
11. **T1-3 — inventory hero == trend dedupe:** make the trend chart use the deduped sum so the two numbers agree; then show the chart beside the hero.
12. **T1-4 — render Missing Deliveries ($):** surface the already-correct, already-tested formula (a strong Verified story) — beta first.
13. **T1-5 — unify the order engine:** remove the deprecated `computeOrderQty` surfaces so Reorder shows one number everywhere.
14. **T1-11 — verify portfolio "Money Lost":** confirm/repoint it to the split Profit-Risk canonical (depends on T0-1).
15. **T1-9 — food-cost window alignment:** fix the 30-day spend vs weekly-sales window mismatch; promote Food Cost % from beta.

## Phase 4 — Drill-down completeness (trust depth). Effort: **L, ongoing**
16. Bring every shown KPI to **Summary → Math → Evidence → Records** (registry §Drill-down), including provenance ("who confirmed the receipt that changed this cost" — now capturable post-S0-9; pair with **T1-2 `catalog_cost_history`** so cost changes are auditable, not overwritten silently).

## Dependency view

```
        ┌──────────────────────────────┐
        │ Phase 0: adopt canonical      │  ← T0-0 (prerequisite for all KPI fixes)
        │ registry (one formula)        │
        └───────────────┬──────────────┘
        ┌───────────────┴───────────────┐
  Phase 1 (lies)                   Phase 2 (mixed numbers)
  T0-4 Audit $0  ← MUST be first    T0-1 split hero
  T0-5 cards                        T0-2 savings banner
  T0-6 vendor mock                  T0-3 price de-dup
                                    T0-7 shrinkage label
        └───────────────┬───────────────┘
                Phase 3: promote hidden (T1-3/4/5/9/11)
                        │
                Phase 4: drill-down + provenance (T1-2)
```

## What this unlocks
- **At launch (no fixes):** the [dashboard recommendation](t0-0-dashboard-recommendation.md) — show the 5 safe KPIs, hide the rest — is shippable today.
- **After Phase 0–2:** the headline money numbers become defensible (single class, single formula, honest on error) → the hidden tier can be promoted.
- **After Phase 3–4:** the product reaches its stated promise — every money number traceable Summary→Records, with provenance — i.e. *"trust is the product."*

> No application code, KPI logic, or dashboard was modified in producing this roadmap.
