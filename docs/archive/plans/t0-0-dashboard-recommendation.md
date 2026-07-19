# T0-0 — Dashboard Recommendation ("if Margin6 launched tomorrow")

> **Date:** 2026-06-23 · Companion to the [investigation](../investigations/t0-0-kpi-canonical-investigation.md), [trust matrix](../architecture/t0-0-kpi-trust-matrix.md), [registry](../architecture/t0-0-kpi-registry.md). No code, no dashboard change — a recommendation only.
> **Principle (CLAUDE.md):** *If a number cannot be explained, do not show it. Never combine Verified/Potential/Forecast. Never present mock as real.*

## The decision in one screen

If we launched tomorrow with **today's** code (no further fixes), the dashboard should show **only verified per-item facts + the explainability layer**, and hide every blended money number. The goal at launch is *"few numbers, all defensible"* — trust beats density.

## SHOW — the 5 KPIs to lead with

| # | KPI | Why it earns the spot | Required caveat at launch |
|---|-----|----------------------|---------------------------|
| 1 | **Period Spend** | Verified, High; immutable invoice sums; the most trustworthy number in the product | none |
| 2 | **Inventory Value (hero, alone)** | Verified snapshot of the latest approved count; the basis of value | show the hero **without** the trend chart beside it (dedupe mismatch, T1-3); show "as of <count date>" |
| 3 | **Overstock — "Cash tied up"** | Potential, High; tested math; the clearest actionable lever | label strictly as *cash tied up in overstock*, **never** "savings"; class chip = Potential |
| 4 | **Reorder Needed / Critical-Low** | Potential, Medium; drives the core order workflow | use the **one** current engine only (suppress the deprecated `computeOrderQty` surfaces, T1-5) |
| 5 | **Per-invoice Price-Hike & Short-Delivery flags** (in Invoice Review, surfaced as a count on the dashboard) | Verified, per-line, explainable — the category wedge ("am I being overcharged?") | show as **flags/count**, not an aggregate dollar (the aggregate is double-counted, T0-3) |

Plus the **"View Math" explainability layer** on all of the above — the genuine differentiator and the trust mechanism. (Period Spend / Inventory Value / Overstock / Reorder all have or can reuse explain builders.)

## HIDE — do not show until remediated

| KPI | Hide because | Unblocks after |
|-----|--------------|----------------|
| **Profit Risk hero / "Money Lost" aggregate** | mixes Verified + Potential + Derived into one number (Money-Rules violation) | T0-1 (split) |
| **Savings banner** | overstock relabeled as recoverable; same $ double-labeled vs hero | T0-2 |
| **Aggregate Price Increase Impact** | double-counted, divergent qty bases | T0-3 (pick one source) |
| **Shrinkage dollar** | Derived estimate presented as a verified loss | T0-7 (re-source/label) |
| **Inventory trend chart beside the hero** | not zone-deduped → contradicts the hero number | T1-3 |
| **"Money Lost this week" on My Restaurants** | per-restaurant copy of the hero's mixing | T1-11 + T0-1 |
| **Audit Center page** | renders `$0` "verified" on load error — the trust page lying | **T0-4 (must fix first)** |

## BETA — show, clearly marked, behind a "beta" label

| KPI | Why beta (not hide, not GA) |
|-----|------------------------------|
| **Food Cost %** | genuinely useful but depends on **manual** sales (no POS) and has a window-alignment gap (T1-9); honest-null handling already exists. Mark beta + "enter weekly sales to enable." |
| **Missing Deliveries ($)** | the formula is Verified and tested but **unrendered** (T1-4); surface it in beta once the invoiced-vs-PO baseline is reconciled — a strong "we caught $X short-shipped" story. |
| **Invoice Discrepancy insights** (beyond the count) | the count is fine; richer discrepancy dollars need T0-3 first. |

## REMOVE — take out entirely

| Item | Why remove |
|------|-----------|
| **"Vendor Connect"** (auto-import) | returns `MOCK_INVOICES` ([vendor-import-invoices](../../supabase/functions/vendor-import-invoices/index.ts)) presented as a real integration — mock-as-real is the fastest way to destroy trust (T0-6). Remove the tab/flag until a real integration exists. |
| **Duplicate/deprecated order-qty surfaces** | the deprecated `computeOrderQty` rendered in `Review.tsx`/`Approved.tsx` contradicts the current engine on screen (T1-5) — remove, don't just hide. |

## Sequencing note
This recommendation is **achievable at launch with zero formula changes** — it is a *visibility* decision (show the safe set, hide the rest). The formula fixes (T0-0 adoption → T0-1/2/3/7) then progressively **promote** hidden KPIs into the SHOW/BETA tiers. The single must-fix-before-any-launch item is **T0-4** (Audit Center `$0`-on-error), because a trust page that lies on failure is worse than no trust page.

> No application code, KPI logic, or dashboard was modified in producing this recommendation.
