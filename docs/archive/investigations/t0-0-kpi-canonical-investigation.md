# Investigation — T0-0: Canonical KPI Formula Source of Truth

> **Date:** 2026-06-23 · **Type:** Investigation & architecture only (no code, no migration, no dashboard/KPI change, no commit).
> **Roadmap item:** T0-0 (P0 Trust prerequisite) — [trust-first-roadmap.md](../trust-first-roadmap.md). Must precede T0-1/T0-2/T0-3 and any dashboard card fix.
> **Sources:** code trace (cited inline), [kpi-source-of-truth.md](../kpi-source-of-truth.md) (prior audit, dated 2026-06-22 — **pre Phase 1/2**; updated here), [product-reality.md](../product-reality.md), [phase-1-p0-security-review.md](../completed/phase-1-p0-security-review.md).
> **Companions:** [t0-0-kpi-trust-matrix.md](../architecture/t0-0-kpi-trust-matrix.md) · [t0-0-kpi-registry.md](../architecture/t0-0-kpi-registry.md) · [t0-0-dashboard-recommendation.md](../plans/t0-0-dashboard-recommendation.md) · [t0-0-remediation-roadmap.md](../plans/t0-0-remediation-roadmap.md)

---

## 0. Executive summary

Margin6's KPI math splits into two layers with **opposite** trust postures:

1. **Per-line math is centralized and sound.** `casePlanningEngine.ts`, `reorderEngine.ts`, `recordedWasteValue.ts`, `invoice-comparison.ts`, `priceIncreaseFromNotifications.ts` compute each line's dollars in one place, reused by loaders. These are trustworthy.
2. **Composition (aggregate) math is duplicated and the canonical copy is dead.** `dashboardTrustFormulas.ts` declares the aggregate formulas (Profit Risk total, Savings banner total, food-cost %) — but its **own header says** *"Used by dashboard trust tests; UI loaders should keep calling the underlying modules"* ([dashboardTrustFormulas.ts:1-4](../../src/domain/dashboard/dashboardTrustFormulas.ts#L1)). So **tests pass against the canonical formulas while the UI renders inline re-implementations** ([ProfitRiskWidget.tsx:93](../../src/components/ProfitRiskWidget.tsx#L93), [Dashboard.tsx:765](../../src/pages/app/Dashboard.tsx#L765)). That is the T0-0 defect: the "source of truth" enforces nothing.

On top of that, the **Profit Risk hero** and **Savings banner** mix trust classes the Money Rules forbid (Verified losses + Potential snapshot overstock), the **Audit Center renders `$0` "verified" on load error** (confirmed below), and **Shrinkage / aggregate Price-Increase** remain estimate-or-double-counted.

**Net:** the per-item facts are showable today; the blended "one big money number" is not. This document inventories every KPI, classifies its trust, ranks the duplication, and recommends what to ship, hide, beta, or remove (companion docs).

**Post Phase 1/2 update (not in the prior audit):** S0-8 made `notifications` INSERT RPC-gated → Shrinkage and Price-Increase notification rows are **no longer client-forgeable** (only the `process-notifications` cron / manager-gated `confirm_invoice_receipt` create them). S0-9 made catalog cost overwrites **manager-only**. These *raise* the floor on Shrinkage and Inventory-Value cost integrity, but do **not** fix the composition/mixing defects below.

---

## 1. KPI inventory (Requirement 1)

| # | KPI | Where shown | Formula (essence) | Source file(s) | Source tables |
|---|-----|-------------|-------------------|----------------|---------------|
| K1 | **Inventory Value** | Dashboard hero ([:1617](../../src/pages/app/Dashboard.tsx#L1617)), Reports, Audit | `Σ on_hand × unit_cost` (latest APPROVED), zone-deduped (hero) | `loadInventoryMetrics.ts`, `dashboardSelectors.ts:235` (hero) vs `:339` (trend, **not** deduped) | `inventory_sessions`, `inventory_session_items` |
| K2 | **Overstock (Cash Trap)** | Dashboard card, Audit | `Σ max(on_hand−par,0) × unit_cost`; PAR≤0→0 | `casePlanningEngine.ts:134`, `reorderEngine.ts:132`, `OverstockCashTrapCard.tsx` | `inventory_session_items`, `par_guide_items` |
| K3 | **Reorder Needed ($) / Critical-Low** | Dashboard hero ([:1591](../../src/pages/app/Dashboard.tsx#L1591)), Smart Order, Audit | `ceil(max(par−stock,0))×cost`; red = risk RED count | `reorderEngine.ts`, `casePlanningEngine.ts:80` | `inventory_session_items`, `smart_order_settings` |
| K4 | **Waste (recorded)** | Dashboard, Audit, Waste Log | prefer `total_cost`, else `qty × resolved cost` | `loadWasteMetrics.ts`, `recordedWasteValue.ts` | `waste_log`, `inventory_catalog_items` |
| K5 | **Period Spend** | Dashboard Spend, feeds Food Cost | `Σ invoice_items.total_cost (confirmed)` + deduped `purchase_history_items` | `loadSpendMetrics.ts:34-129` | `invoice_items`, `purchase_history_items`, `invoices` |
| K6 | **Profit Risk hero (Money Lost total)** | Dashboard hero | `waste + priceIncrease + overstock + shrinkage` **inline** | **`ProfitRiskWidget.tsx:93`** (inline) ≅ test-only `dashboardTrustFormulas.ts:111` | `waste_log`, `notifications`, `invoice_line_comparisons`, `inventory_sessions` |
| K7 | **Savings banner ("potential savings")** | Dashboard banner | `overstock + waste + priceIncrease` **inline** | **`Dashboard.tsx:765`** (inline) ≅ test-only `dashboardTrustFormulas.ts:126` | as above (no shrinkage) |
| K8 | **Price Increase Impact (aggregate)** | Dashboard, Top Profit Risks, Audit | comparison `(inv−po)×min(inv,po)` **+** `Σ(new−old)` notifications | `loadSpendMetrics.ts:157-181`, `dashboardSelectors.ts:127`, `priceIncreaseFromNotifications.ts`; **re-impl** `loadProfitLeaks.ts:217` (diff qty) | `invoice_line_comparisons`, `notifications`, `invoices` |
| K9 | **Shrinkage** | Dashboard, Audit, ShrinkageAlertCard | `Σ data.items[].dollar_impact` (SHRINK_ALERT, COUNT_VARIANCE) | `loadShrinkageValue.ts:35-42` | `notifications` |
| K10 | **Food Cost %** | Dashboard hero (perm-gated), Audit | `(periodSpend / grossSales) × 100`; null until sales>0 | `loadFoodCostMetrics.ts:100` | `weekly_sales`, `invoices`, `location_settings` |
| K11 | **Invoice Discrepancies (count)** | Dashboard ("Delivery Issues"), Audit | unique invoices with `issues_reported` OR a comparison problem | `loadSpendMetrics.ts:164`, `dashboardSelectors.ts:102` | `invoices`, `invoice_line_comparisons` |
| K12 | **Missing Deliveries ($)** | **not rendered** (orphaned) | `(inv_qty−recv_qty)×inv_unit_cost` | `invoice-comparison.ts:113`, `dashboardTrustFormulas.ts:90` | `invoice_line_comparisons` |
| K13 | **Top Profit Leaks (Top 5)** | Dashboard "Top Profit Risks" | composes waste/price/overstock/shrinkage per item | `loadProfitLeaks.ts` (price qty basis **differs** from K8) | `waste_log`, `invoice_line_comparisons`, `notifications`, `inventory_session_items` |
| K14 | **"Money Lost this week" (portfolio)** | My Restaurants | per-restaurant `waste + hike + overstock + shrink` (7-day) | `loadRestaurantPortfolioSummaries.ts:198-207` | same as K6 |
| K15 | **Pending Invoices (count)** | Dashboard | count draft/review + pending purchase_history | `loadInvoiceMetrics.ts`, `dashboardSelectors.ts:35` | `invoices`, `purchase_history` |
| K16 | **Audit Center verification table** | `/settings/audit` | re-displays K1–K10 with confidence badges | `AuditCenter.tsx`, `kpiExplainBuilders.ts` | (reads the snapshot) |
| — | *Vendor Connect* (not a KPI) | Invoices tab | returns `MOCK_INVOICES` | `vendor-import-invoices` | — (mock; T0-6) |

Explainability ("View Math") exists for **5** KPIs: Inventory Value, Overstock, Reorder, Money-Lost/Profit-Risk, Food Cost ([kpiExplainBuilders.ts:92-235](../../src/components/explainability/kpiExplainBuilders.ts#L92)). The explain builders state the formula as **prose strings** — a *third* place the aggregate formula is written (after the inline UI copy and the test-only canonical), and they can drift independently.

## 2. Formula trace (Requirement 2) — representative paths

**Profit Risk hero (K6) — the headline:**
```
Dashboard hero  →  <ProfitRiskWidget recordedWasteValue / priceIncreaseImpact / overstockValue / shrinkageValue>
  ↑ props from buildDashboardSnapshot.ts (KPISnapshot)
  ↓ INLINE composition
ProfitRiskWidget.tsx:93   total = recordedWasteValue + priceIncreaseImpact + overstockValue + shrinkageValue
  (canonical computeMoneyLostTotal at dashboardTrustFormulas.ts:111 — TEST-ONLY, not imported here)
  ├─ recordedWasteValue ← loadWasteMetrics.ts → recordedWasteValue.ts          ← waste_log, inventory_catalog_items
  ├─ priceIncreaseImpact ← loadSpendMetrics.ts:157-181 (comparison + notifications) ← invoice_line_comparisons, notifications
  ├─ overstockValue     ← loadInventoryMetrics.ts → reorderEngine.ts:132 (SNAPSHOT) ← inventory_session_items, par_guide_items
  └─ shrinkageValue     ← loadShrinkageValue.ts:35 (period)                      ← notifications
```
The four terms mix **period flows** (waste, price, shrink) with a **point-in-time snapshot** (overstock) — changing the time filter moves 3 of 4 terms (T0-1).

**Inventory Value (K1):** `Dashboard:1617 → useDashboardData → loadInventoryMetrics → dashboardSelectors.ts:235 (deduped) → inventory_session_items`. The **trend chart** beside it uses `:339` (**not** deduped) → two "current value" numbers on one screen (T1-3).

**Audit Center (K16):** `AuditCenter.tsx:60 useDashboardData (error → _error, IGNORED) → fmtMoney(snapshot.<kpi>) → renders default 0 as "$0" on failure` (see §3.K16).

(Full per-loader trace + tables in the [registry](../architecture/t0-0-kpi-registry.md).)

## 3. Trust classification (Requirement 3)

Classes: **Verified** (realized fact from immutable/operational records) · **Potential** (future risk/opportunity, not realized) · **Forecast** (predicted) · **Derived** (estimate/heuristic) · **Unknown**.

| KPI | Class | Why |
|-----|:-----:|-----|
| K5 Period Spend | **Verified** | sum of confirmed invoice line totals — immutable source |
| K1 Inventory Value | **Verified** | latest APPROVED count × cost; cost now manager-gated (S0-9). *But* hero/trend dedupe mismatch (T1-3) |
| K11 Invoice Discrepancy **count** | **Verified** | counts immutable comparison/receipt flags (it's a count, not $) |
| K12 Missing Deliveries $ | **Verified** | billed-minus-received × invoiced cost (immutable) — *but not rendered* |
| K4 Waste | **Verified (weak)** | logged events; `total_cost` is **STAFF-editable** (waste_log writable by members) → inflatable |
| K2 Overstock | **Potential** | cash *tied up* above PAR — not a realized loss; snapshot |
| K3 Reorder / Critical-Low | **Potential** | future purchase need; snapshot |
| K10 Food Cost % | **Forecast→Verified** | depends on **manual** weekly sales (no POS); honest null until entered |
| K8 Price Increase $ (aggregate) | **Verified but double-counted** | two sources summed, disjointness unenforced, divergent qty bases (T0-3) |
| K9 Shrinkage | **Derived** | heuristic `dollar_impact` from the cron's anomaly detector; post-S0-8 not forgeable, but still an **estimate**, not a counted loss |
| K6 Profit Risk hero | **Mixed (invalid)** | Verified period + Potential snapshot + Derived shrinkage summed into one number |
| K7 Savings banner | **Mixed (invalid)** | Potential overstock relabeled as recoverable "savings"; same $ labeled "exposure" in K6 |
| K13 Top Profit Leaks | **Mixed** | composes the above with a **different** price-qty basis than K6/K8 |
| K14 Portfolio "Money Lost" | **Mixed/Unknown→traced** | per-restaurant copy of K6's mixing |
| K15 Pending Invoices | **Verified (count)** | simple status count |
| K16 Audit Center values | **Unknown on error** | renders default `0` as verified when the load fails (§K16) |

### K16 — Audit Center renders `$0` "verified" on error (confirmed; T0-4)
[AuditCenter.tsx:60](../../src/pages/app/settings/AuditCenter.tsx#L60) destructures `{ loading, error: _error, … }` — the `_error` underscore marks it **deliberately ignored**; only `loading` is consumed. `useDashboardData` sets `error` on failure ([:209](../../src/hooks/useDashboardData.ts#L209)) but keeps the snapshot at its **all-zero defaults** ([:32-53](../../src/hooks/useDashboardData.ts#L32)). `fmtMoney(0)` returns `"$0"` (0 is finite; `"—"` is only for non-finite). **Result:** on a load failure the page whose sole purpose is to prove the numbers are trustworthy displays **`$0` for every KPI with a confidence badge** — fabricated "audited zeros." This is the single most dangerous behavior found.

## 4. Duplication audit (Requirement 4)

| Formula | Canonical (test-only) | Production copy (rendered) | 3rd copy | Severity |
|---------|----------------------|----------------------------|----------|:--------:|
| **Price-hike impact** | `dashboardSelectors.ts:127` (`min(inv,po)` qty) | `loadProfitLeaks.ts:217` (`invoiced` qty) | — | **Critical** — *already divergent*: hero and "Top Profit Risks" show different dollars for the same hike (T0-3) |
| **Profit Risk total** | `dashboardTrustFormulas.ts:111` | `ProfitRiskWidget.tsx:93` (inline) | explain prose `kpiExplainBuilders.ts:200` | **Critical** — headline number; canonical not imported |
| **Savings banner total** | `dashboardTrustFormulas.ts:126` | `Dashboard.tsx:765` (inline) | — | **High** |
| **Price-increase aggregate** | (two sources summed) | `loadSpendMetrics.ts:169-181` | re-summed in portfolio `loadRestaurantPortfolioSummaries.ts:198` | **High** — disjointness unenforced |
| **Inventory value sum** | `dashboardSelectors.ts:235` (deduped) | `dashboardSelectors.ts:339` (trend, **no** dedupe) | — | **Medium** — visible two-number mismatch (T1-3) |
| **Reorder/order qty** | `inventory-utils.ts:197` `computeOrderQtyCases` | deprecated `computeOrderQty:217` rendered in `Review.tsx:323`, `Approved.tsx:235` | — | **High** — engines disagree on screen (T1-5) |
| **Overstock total** | `reorderEngine.ts:132` | `OverstockCashTrapCard.tsx` reduce | wrapper `dashboardTrustFormulas.ts:19` | **Low** — parity tested |
| **Food cost %** | `loadFoodCostMetrics.ts:100` | wrapper `dashboardTrustFormulas.ts:100`, explain prose | — | **Low** — currently agree |

**Pattern (root cause):** the **aggregate/composition** formulas live in ≥2 places (inline UI + test-only canonical, sometimes + explain prose), and the canonical copy is **not imported by the renderer**. Per-line math is fine; **composition is the duplication risk**, and two pairs (price-hike qty; order engine) are **already divergent on screen**.

> Note: an inline `reduce` that sums a loader-computed array (e.g. `OverstockCashTrapCard`, `ShrinkageAlertCard`) is **not** itself a divergence — the per-line dollars come from the engines. The risk is the **choice of terms and time-basis** of the headline composites (K6/K7/K8/K13), which is what's duplicated and drifting.

## 5. Customer readiness (Requirement 5) — summarized (full reasoning in the Trust Matrix)

| YES (show today) | CONDITIONAL | NO (hide) |
|------------------|-------------|-----------|
| K5 Period Spend; per-invoice price-hike & short-delivery **flags**; the "View Math" layer | K1 Inventory Value (hero **alone**, no trend beside); K2 Overstock (as "cash tied up" card); K3 Reorder/Critical-Low (**one** engine); K4 Waste (with client-cost caveat); K11 Discrepancy **count** (relabeled); K10 Food Cost % (only with confirmed sales) | K6 Profit Risk hero; K7 Savings banner; K8 Price-Increase **aggregate**; K9 Shrinkage $; K13 aggregate; K14 portfolio "Money Lost"; K16 Audit Center **until the error state is fixed**; Vendor Connect mock |

## 6. Drill-down design (Requirement 6) — the standard contract

Every KPI card should resolve **Summary → Math → Evidence → Records**:
```
[Summary Card]  number + class chip (Verified/Potential/Forecast/Derived) + confidence badge + period
      ↓ click "View Math"
[Math]          the canonical formula (one string, from the registry) + the exact inputs used
      ↓
[Evidence]      the line items that produced it (e.g. each overstock line: item, on_hand, par, excess, unit_cost, $)
      ↓ click a line
[Records]       the underlying rows (session item, invoice line, waste entry) + "who/when" provenance
```
Today only the 5 explainability KPIs reach **Math**; few reach **Evidence**, and almost none reach **Records** with provenance (e.g. *who* confirmed a receipt that changed a cost — now capturable post-S0-9, but no `catalog_cost_history` yet, T1-2). The registry assigns each KPI its drill-down target (companion doc).

---

## FINAL — required answers

1. **Most trustworthy KPI today:** **Period Spend (K5).** Verified, High confidence — a sum of confirmed, immutable invoice line totals; no mixing, no snapshot, no manual input. Safe to show as-is.
2. **Most dangerous KPI today:** the **Audit Center verification table (K16)** — it renders **`$0` "verified" with confidence badges on load error** (the trust page itself lies). The most dangerous *number* is the **Profit Risk hero (K6)**, which sums incompatible trust classes and time bases into the headline figure owners anchor on.
3. **Closest to production-ready:** **Overstock as a "cash tied up" card (K2)** — sound math, hero==card parity already asserted in tests; needs only honest labeling (not "savings"). (Period Spend is already production-ready.)
4. **Violates the Money Rules:** **Profit Risk hero (K6)** and the **Savings banner (K7)** — the rules require every KPI be exactly one of Verified/Potential/Forecast and **never combined**; both blend Verified losses with Potential overstock (and K6 adds Derived shrinkage), and the *same* overstock dollars are labeled "exposure" in K6 and "savings" in K7.
5. **Would show an owner tomorrow:** **Period Spend**, **Inventory Value hero (alone)**, **Overstock as "cash tied up,"** **per-invoice price-hike / short-delivery flags**, and the **"View Math" explainability layer** — the genuine differentiator.
6. **Would absolutely NOT show an owner:** the **Profit Risk hero / "Money Lost" aggregate (K6/K14)**, the **Shrinkage dollar (K9)** as a "verified loss," the **Audit Center page while it shows `$0` on error (K16)**, and **"Vendor Connect" mock invoices** (T0-6).

> No application code, migration, KPI logic, or dashboard was modified in producing this investigation.
