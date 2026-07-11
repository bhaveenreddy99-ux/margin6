# Financial Trust Audit

**Date:** 2026-07-10  
**Mode:** Read-only

---

## Canonical Formula Registry

### Inventory Value
- **Formula:** `Σ round2(on_hand_cases × unit_cost_per_case)`
- **Source:** `computeLineInventoryValue()` — `src/domain/inventory/casePlanningEngine.ts`
- **Aggregation:** `buildLatestInventorySnapshot()` — `src/domain/dashboard/dashboardSelectors.ts`
- **Error behavior:** LoadOutcome in `loadInventoryMetrics.ts`; missing cost → `isMissingCost: true`
- **Traceability:** Explain sheets via `useMathBreakdown.ts`, `kpiExplainBuilders.ts`
- **Confidence:** **Trustworthy with limitations** (missing cost flagged)
- **Tests:** `load-inventory-metrics.test.ts`, `dashboard-trust-calculations.test.ts` (21 tests)

### Overstock (Cash above PAR)
- **Formula:** `Σ round2(max(0, stock - par) × unit_cost_per_case)`
- **Source:** `computeLineOverstockValue()` / `computeWasteValue()` chain
- **Error behavior:** LoadOutcome via inventory loader
- **Confidence:** **Trustworthy with limitations**

### Profit Risk / Money Lost (Dashboard hero)
- **Formula:** `waste + priceIncreaseImpact + overstock + shrinkage`
- **Source:** `computeMoneyLostTotal()` — `src/domain/dashboard/dashboardTrustFormulas.ts`
- **UI duplicate:** `ProfitRiskWidget.tsx` sums inline (architectural debt)
- **Labeling:** "Profit Risk Identified" — exposure not realized loss (`profitRiskLabels.ts`)
- **Error behavior:** Per-component `metricErrors` → `KpiCouldNotLoad`; partial note when components fail
- **Double-count risk:** Price increase from comparisons + notifications — **Suspected**
- **Confidence:** **Trustworthy with limitations** on main dashboard; label honest

### Portfolio "Money Lost" (My Restaurants)
- **Formula:** `waste + price_hikes + shrinkage` (7-day window)
- **Omits:** Overstock
- **Confidence:** **Misleading if compared to dashboard hero** — different definition

### Food Cost %
- **Formula:** `(periodSpend / weeklyGrossSales) × 100`
- **Source:** `computeFoodCostPct()` — returns **null** if sales missing
- **Error behavior:** LoadOutcome; UI shows locked state without sales
- **Confidence:** **Trustworthy** when data complete

### Period Spend
- **Formula:** Confirmed invoices line costs + purchase history (deduped)
- **Source:** `loadSpendMetrics.ts`
- **Confidence:** **Trustworthy with limitations**

### Recorded Waste
- **Formula:** Priority: stored total_cost → unit×qty → catalog default → session cost
- **Source:** `src/domain/waste/recordedWasteValue.ts`
- **Non-case units:** Only stored total_cost (no case fallback)
- **Confidence:** **Trustworthy with limitations**

### Shrinkage
- **Formula:** Sum `dollar_impact` from SHRINK_ALERT / COUNT_VARIANCE notifications
- **Source:** `loadShrinkageValue.ts`
- **Confidence:** **Incomplete** — depends on notification pipeline

---

## LoadOutcome Pattern (Financial Honesty)

**Confirmed:** Dashboard loaders use `{ status: "ok" | "error" }` — failed queries must not render as $0.

**Gaps:**
| Area | Behavior | Classification |
|------|----------|----------------|
| Main dashboard KPIs | LoadOutcome + error flags | Trustworthy |
| Reports / Money Leak | Failed loads → zeros (`buildMoneyLeakSnapshot.ts`) | **Misleading** |
| Portfolio tab in Dashboard | Separate fetch path with catch | **Incomplete** |
| `loadFoodCostMetrics` target default | `catch { return 30 }` | **Suspected silent default** |

---

## Metric Trust Classification

| Metric | Classification |
|--------|----------------|
| Inventory value (dashboard) | Trustworthy with limitations |
| Overstock | Trustworthy with limitations |
| Profit Risk hero | Trustworthy with limitations |
| Portfolio money lost | Misleading vs dashboard |
| Food cost % | Trustworthy with limitations |
| Reports money leak | Incomplete / misleading on error |
| Marketing demo estimates | Labeled estimate only |

---

## Show Your Math

**Exists:**
- KPI explain builders
- Confidence badges (`computeKpiConfidence.ts`)
- Data quality score
- Audit Center (owner-only route)

**Missing / broken:**
- Drill-down from portfolio money lost to source rows
- Unified formula metadata across Reports and Dashboard
- Accountant-facing export reconciliation view (no ACCOUNTANT role)
