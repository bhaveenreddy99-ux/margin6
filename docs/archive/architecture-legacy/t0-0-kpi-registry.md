# T0-0 — Canonical KPI Registry (proposed source of truth)

> **Date:** 2026-06-23 · Companion to [t0-0-kpi-canonical-investigation.md](../investigations/t0-0-kpi-canonical-investigation.md) & [t0-0-kpi-trust-matrix.md](t0-0-kpi-trust-matrix.md). No code.
> **Purpose:** one authoritative row per KPI. This table is the intended **single source of truth** that the eventual `dashboardTrustFormulas.ts` (made non-dead) and the explainability builders must both derive from — so the formula is written **once** and the rendered number, the "View Math" string, and the tests all reference it.
> **Columns:** Business meaning · Formula (canonical) · Trust level · Source tables · Update trigger (when it changes) · Owner action (what to do about it) · Drill-down (Summary→Math→Evidence→Records target).

## Registry

| KPI | Business meaning | Canonical formula | Trust | Source tables | Update trigger | Owner action | Drill-down target |
|-----|------------------|-------------------|:-----:|---------------|----------------|--------------|-------------------|
| **Period Spend** | What I spent on inventory this period | `Σ invoice_items.total_cost` (confirmed) + deduped `purchase_history_items.total_cost` | Verified | `invoice_items`, `purchase_history_items`, `invoices` | invoice confirmed (S0-9 manager) | review vendors/volume | → vendor breakdown → invoice → line items |
| **Inventory Value** | $ of stock on hand (latest approved count) | `Σ current_stock × unit_cost` (zone-deduped) | Verified | `inventory_sessions(APPROVED)`, `inventory_session_items` | count approved | trust as snapshot; recount if stale | → items with cost → session item rows |
| **Overstock (Cash Trap)** | Cash tied up above PAR | `Σ max(stock−par,0) × unit_cost`; PAR≤0→0 | Potential | `inventory_session_items`, `par_guide_items` | count approved / PAR change | reduce next order | → overstock lines (item, excess, $) → session item |
| **Reorder Needed ($)** | $ to bring items up to PAR | `Σ ceil(max(par−stock,0)) × unit_cost` | Potential | `inventory_session_items`, `par_guide_items`, `smart_order_settings` | count approved / PAR | place Smart Order | → reorder lines → Smart Order run |
| **Critical-Low (count)** | # items at RED risk | `count(risk == RED)` vs thresholds | Potential | `inventory_session_items`, `smart_order_settings` | count approved | order now | → RED items → session item |
| **Waste** | $ of waste logged this period | prefer `total_cost`, else `qty × resolved unit cost` | Verified (weak: editable) | `waste_log`, `inventory_catalog_items` | waste entry logged | investigate top items | → waste entries → `waste_log` row + logger |
| **Food Cost %** | spend ÷ sales | `(periodSpend / weeklyGrossSales) × 100`; null if sales≤0 | Forecast→Verified | `weekly_sales`, `invoices`, `location_settings` | sales entered / invoice confirmed | enter sales; compare to 28–32% | → spend + sales inputs → invoices & weekly_sales |
| **Invoice Discrepancies (count)** | # invoices with delivery/billing problems | `count(distinct invoice with issues_reported OR comparison problem)` | Verified | `invoices`, `invoice_line_comparisons` | invoice received/reviewed | open the flagged invoices | → flagged invoices → comparison rows |
| **Missing Deliveries ($)** *(orphaned)* | billed-but-short goods | `Σ (invoiced_qty − received_qty) × invoiced_unit_cost` | Verified | `invoice_line_comparisons` | receipt confirmed | claim credit from vendor | → short lines → comparison rows |
| **Price Increase Impact** | $ overcharged vs PO this period | **ONE** source: comparison `(inv−po) × min(inv,po)` **OR** notifications `Σ(new−old)×qty` — *not summed* (T0-3) | Verified (currently double-counted) | `invoice_line_comparisons`, `notifications`, `invoices` | invoice confirmed | challenge vendor | → hiked lines → comparison / notification |
| **Shrinkage** | Inventory variance loss (estimate) | `Σ data.items[].dollar_impact` (SHRINK_ALERT, COUNT_VARIANCE) — **label as estimate** | Derived | `notifications` (cron-sourced) | count approved → cron run | investigate variance | → flagged items → count deltas |
| **Pending Invoices (count)** | # invoices awaiting action | `count(draft/review) + pending purchase_history` | Verified | `invoices`, `purchase_history` | upload / status change | process them | → pending list → invoice |
| **Profit Risk hero** *(rebuild)* | headline exposure | **MUST split** Verified losses (waste + price + missing-delivery) from Potential (overstock) from Derived (shrinkage) — **never one number** | Mixed → split | (composite) | any component changes | act per component | → per-class breakdown |
| **Savings banner** *(rebuild/remove)* | recoverable upside | **Remove overstock**; only realized recoverable items, if any | Mixed → fix | (composite) | — | — | → per-item |
| **"Money Lost this week" (portfolio)** *(verify)* | per-restaurant realized loss | same canonical as the split Profit Risk, per restaurant | Mixed → verify | (composite, per restaurant) | weekly | compare locations | → per-restaurant → per-class |

## Registry rules (how to keep it the source of truth)

1. **One formula, one place.** Each "Canonical formula" cell maps to **exactly one** exported function (in a non-dead `dashboardTrustFormulas.ts` or the per-line engines). The **renderer imports it**; the **explain builder imports it** (or reads the registry's formula string); the **test asserts it**. No inline re-implementation of composites (kills T0-0/T0-1/T0-2).
2. **One class per KPI.** A registry row may carry only **one** Trust level. Composites that need multiple classes (Profit Risk) become **multiple rows** (Verified-losses, Potential-overstock, Derived-shrinkage), shown as separate lines — never summed into one figure (Money Rules).
3. **Every KPI has an Update trigger + Drill-down target.** If a KPI can't name what record changed it or what the owner sees on click, it isn't ready to show.
4. **Failure ≠ zero.** A KPI whose loader errored must render an explicit error state, never `0`/"all clear" (fixes T0-4/T0-5).
5. **No mock as KPI.** Anything backed by mock data (Vendor Connect) is excluded from the registry until real.

## Mapping registry → existing code (what becomes canonical)

| Registry formula | Make canonical from | Today rendered by (to repoint) |
|------------------|---------------------|-------------------------------|
| Inventory value | `dashboardSelectors.ts:235` | hero ✓ / trend `:339` (repoint to deduped) |
| Overstock | `reorderEngine.ts:132` / `casePlanningEngine.ts:134` | `OverstockCashTrapCard` (already aligned) |
| Reorder/Critical-Low | `casePlanningEngine.ts:80` / `reorderEngine.ts` | remove deprecated `computeOrderQty` (T1-5) |
| Waste | `recordedWasteValue.ts` | `loadWasteMetrics` ✓ |
| Period spend | `loadSpendMetrics.ts:34-129` | Spend overview ✓ |
| Food cost % | `dashboardTrustFormulas.ts:100` (wrap) | hero (import it) |
| Price increase | **pick one** source in `loadSpendMetrics.ts` | de-dup vs `loadProfitLeaks.ts:217` (T0-3) |
| Missing delivery | `invoice-comparison.ts:113` | **render it** (T1-4) |
| Shrinkage | `loadShrinkageValue.ts` | label as estimate |
| Profit Risk (split) | new canonical = 3 separate exports | `ProfitRiskWidget.tsx:93` (import; split) (T0-1) |
| Savings banner | new canonical (no overstock) | `Dashboard.tsx:765` (import; fix) (T0-2) |

> No application code, KPI logic, or dashboard was modified in producing this registry.
