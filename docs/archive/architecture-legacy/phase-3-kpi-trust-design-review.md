# Phase 3 — KPI Trust & Profit Intelligence: Design Review

> **Date:** 2026-06-23 · **Type:** Investigation & design only (no code, no formula change, no commit).
> **Mission:** *"A restaurant owner should never have to trust us — they should be able to verify every number."*
> **Builds on:** [t0-0-kpi-canonical-investigation.md](../investigations/t0-0-kpi-canonical-investigation.md), [t0-0-kpi-trust-matrix.md](t0-0-kpi-trust-matrix.md), [t0-0-kpi-registry.md](t0-0-kpi-registry.md), [t0-4](../completed/t0-4-audit-center-error-state-summary.md), [t0-5](../investigations/t0-5-kpi-error-handling.md). Final-dashboard layout in [phase-3-final-dashboard-design.md](../plans/phase-3-final-dashboard-design.md).
> **CLAUDE.md Money Rules honored:** every KPI is exactly one of Verified / Potential / Forecast — never combined; if a number can't be explained, it isn't shown.

---

## How to read this

Each KPI has a **profile** covering Parts 1–8. Two cross-cutting tables (Part 4 trust ranking, Part 8 readiness) sit up front. The verdict line on each profile is the design decision: **SHIP · CONDITIONAL · BETA · HIDE · REMOVE · SPLIT**.

### Cross-cutting — Part 4 trust ranking (can it lie?)

| KPI | Can lie? | Stale? | Fail→$0? | Dup-inflate? | User-manipulable? | Timing? | Pages disagree? | UI↔backend? | **Risk** |
|-----|:--:|:--:|:--:|:--:|:--:|:--:|:--:|:--:|:---:|
| K6 Profit Risk hero | **yes** | yes | yes (T0-5) | yes (price) | waste cost | **yes (mixed basis)** | **yes** | yes (inline≠canonical) | **Critical** |
| K7 Savings banner | **yes** | yes | yes | yes | — | yes | **yes (vs hero)** | yes | **Critical** |
| K8 Price Increase (agg) | **yes (double-count)** | yes | yes | **yes** | — | yes | **yes (qty basis)** | yes | **Critical** |
| K9 Shrinkage | yes (estimate) | yes | **yes (loader→0)** | dedup-trigger | (closed S0-8) | yes | yes | — | **High** |
| K16 Audit Center | (T0-4 fixed) | no | (fixed) | — | — | — | — | — | High→**Low** |
| K1 Inventory Value | minor | yes | **yes (loader→0)** | zone (hero ok) | cost (S0-9 gated) | snapshot | **yes (hero≠trend)** | — | **High** |
| K13 Top Profit Leaks | yes | yes | yes | yes | — | yes | **yes (vs K6/K8)** | — | **High** |
| K14 Portfolio Money Lost | yes | yes | yes | yes | — | yes | yes | — | **High** |
| K3 Reorder/Critical-Low | minor | yes | yes | zone | — | snapshot | **yes (2 engines, T1-5)** | yes | **Medium** |
| K4 Waste | yes (inflatable) | yes | yes | — | **yes (total_cost)** | period | — | — | **Medium** |
| K10 Food Cost % | yes (window) | yes | null (honest) | — | sales editable | **yes (window mismatch)** | — | — | **Medium** |
| K11 Discrepancy count | minor (label) | yes | 0 | dedup ok | — | period | — | — | **Low–Med** |
| K2 Overstock | low | yes | yes (loader) | zone (ok) | — | snapshot | low | — | **Low** |
| K5 Period Spend | low | yes | yes (loader) | **dedup'd** | — | window edges | low | — | **Low** |
| K12 Missing Delivery | low | — | — | — | — | — | — | not rendered | **Low** |
| K15 Pending Invoices | low | yes | 0 | — | — | — | — | — | **Low** |

> The dominant cross-cutting risks: **mixed-basis composites** (K6/K7/K13/K14), **duplicated/divergent formulas** (K8 qty basis; K1 hero≠trend; K3 two engines), and **failure→$0** (T0-5 loader swallow, still open). T0-4 already removed the Audit-Center lie.

### Cross-cutting — Part 8 readiness & effort

| KPI | Ready today | Needs calc fix | Needs trust fix | Needs arch fix | Needs new data | Needs redesign | Effort |
|-----|:--:|:--:|:--:|:--:|:--:|:--:|:--:|
| K5 Period Spend | ✅ | | | | | | — |
| K15 Pending Invoices | ✅ | | | | | | — |
| K1 Inventory Value | | T1-3 (trend dedupe) | | | | | **S** |
| K2 Overstock | ✅ (relabel) | | | | | | **S** |
| K3 Reorder/Critical-Low | | T1-5 (one engine) | | | | | **M** |
| K4 Waste | | | T1-8 (cost integrity) | | | | **M** |
| K11 Discrepancy count | | | | | | label | **S** |
| K12 Missing Delivery | | | | | | render (T1-4) | **M** |
| K10 Food Cost % | | T1-9 (window) | | | POS (later) | | **M** |
| K8 Price Increase | | **T0-3 (pick one)** | | | | | **M** |
| K9 Shrinkage | | | **T0-7 (label/re-source)** | | count-deltas (later) | | **M–L** |
| K6 Profit Risk | | | | **T0-0/T0-1 (split)** | | **SPLIT** | **M** |
| K7 Savings banner | | | | T0-2 | | redesign/remove | **S–M** |
| K13 Top Profit Leaks | | T0-3 | | T0-0 | | | **M** |
| K14 Portfolio Money Lost | | | T1-11 (verify) | T0-0 | | | **M** |
| K16 Audit Center | ✅ (T0-4 shipped) | | T0-5 (cards) | | | | done/S |
| Vendor Connect | | | | | **real integration** | **REMOVE** | — |

---

## KPI PROFILES (Parts 1–8 each)

### K5 — Period Spend · **SHIP (hero-eligible)**
- **P1 Business:** *"What did I spend on inventory this period?"* The owner's cash-out baseline; decision: is spend tracking volume/sales, or creeping? **Class: Verified** — sum of confirmed, immutable invoice line totals.
- **P2 Calc:** `Σ invoice_items.total_cost` where `invoices.status='confirmed'` and business-date in window, **plus** `purchase_history_items.total_cost` for `invoice_status IN ('COMPLETE','POSTED')` **deduped** against invoice doc-ids ([loadSpendMetrics.ts:54,78,85](../../src/domain/dashboard/loadSpendMetrics.ts#L54)). Tables: `invoices`, `invoice_items`, `purchase_history(_items)`. Window: selected filter (this_week/last_week/30d). **Edge cases:** drafts/rejected → excluded (`status='confirmed'`); PO-vs-invoice double-count → removed by `procurement-dedupe`; NULL `total_cost` → contributes 0; negatives → none expected (credits not modeled — flag); **two uploads of the same physical invoice (same invoice_number)** → *not* deduped (no invoice_number uniqueness) — **edge case to harden**; deleted invoice → drops out. **Two implementations?** One line-item sum is authoritative; a second invoice-total sum coexists but is unused — keep the line sum.
- **P3 Triggers:** invoice **confirmed** (S0-9 manager); purchase order posted; window change. Not cron-driven.
- **P4 Trust:** Low risk. Can fail→$0 via loader swallow (T0-5). No mixing.
- **P5 Drill-down:** Spend → by vendor → invoice → line items → `invoice_items` rows. History: spend trend by period.
- **P6 Dashboard:** **Card** (hero-eligible); turn amber if spend % of sales rises (needs sales). Notify on a large week-over-week jump.
- **P7 Action:** **Review purchasing / vendor mix.** Not "interesting" — it's the denominator of profitability.
- **P8 Readiness:** **Ready today.** (Harden same-invoice dedup later.)

### K1 — Inventory Value · **SHIP hero (alone)**
- **P1 Business:** *"How much money is sitting in my stockroom right now?"* Owner cares: cash tied in product; decision: is value drifting up (over-ordering) vs sales. **Class: Verified** (snapshot of latest approved count × cost).
- **P2 Calc:** `Σ current_stock × unit_cost` over the **latest APPROVED** session per inventory list, **zone-deduped** ([dashboardSelectors.ts:235](../../src/domain/dashboard/dashboardSelectors.ts#L235), `deduplicateSessionItems`). Tables: `inventory_sessions(status='APPROVED')`, `inventory_session_items`. **Edge cases:** `unit_cost NULL` → line = $0 (undercounts — surface "N items missing cost"); multiple sessions → `order by approved_at desc` (latest) — **tie at same `approved_at` is nondeterministic** (no tiebreaker — harden with `id`); zone double-count → deduped for hero **but the trend chart is NOT** (T1-3 → two "current" numbers); deleted approved session → S0-5 now blocks STAFF from deleting it; manual cost override (receipt confirm) → now manager-gated (S0-9). **Two implementations:** hero (deduped `:235`) vs trend (`:339`, not deduped) → **make trend use the deduped sum.**
- **P3 Triggers:** inventory **approved**; catalog cost change on **receipt confirm** (manager); PAR change (no — value ignores PAR).
- **P4 Trust:** **High** until T1-3 — hero≠trend on one screen. Fail→$0 (loader). Cost integrity up post-S0-9.
- **P5 Drill-down:** Value → priced lines (item, on_hand, unit_cost, $) → session item rows → the **invoice that established the cost** (post-T1-2 `catalog_cost_history`) → DB rows. History: value trend (after dedupe fix).
- **P6 Dashboard:** **Hero**, shown **without** the trend chart beside it until T1-3; "as of <count date>"; red if value spikes vs trailing average (over-ordering signal).
- **P7 Action:** **Recount if stale / review ordering if rising.**
- **P8 Readiness:** **Needs calc fix (T1-3, S)** for the trend; hero ships today.

### K2 — Overstock (Cash Trap) · **SHIP (as "cash tied up")**
- **P1 Business:** *"How much cash is frozen in stock above what I need?"* Decision: cut the next order. **Class: Potential** — cash tied up, *not* a realized loss.
- **P2 Calc:** `Σ max(stock−par,0) × unit_cost`; PAR≤0 → $0 ([casePlanningEngine.ts:134](../../src/domain/inventory/casePlanningEngine.ts#L134), `reorderEngine.ts:132`), zone-deduped. Tables: `inventory_session_items`, `par_guide_items`. **Edge cases:** PAR null/0 → excluded (no false overstock); negative excess → clamped to 0; zone dup → deduped (hero==card parity asserted in tests); missing cost → line 0.
- **P3 Triggers:** inventory **approved**; **PAR changed**.
- **P4 Trust:** **Low** — math tested, parity asserted. Only danger: being summed into a "loss/savings" total (K6/K7) — forbidden.
- **P5 Drill-down:** Overstock → lines (item, on_hand, par, excess, unit_cost, $) → session item rows. History: overstock trend.
- **P6 Dashboard:** **Card**, labeled *"$X cash tied up in overstock"*; never "savings"/"exposure." Red if it grows period-over-period.
- **P7 Action:** **Reduce the next order** (links to Smart Order).
- **P8 Readiness:** **Ready today** with the honest label.

### K3 — Reorder Needed ($) / Critical-Low (count) · **CONDITIONAL (one engine)**
- **P1 Business:** *"What must I buy to avoid running out, and how many items are critical?"* Decision: place the order now. **Class: Potential.**
- **P2 Calc:** suggested cases `ceil(max(par−stock,0))`; reorder $ `Σ order × unit_cost`; critical-low = `count(risk==RED)` vs `smart_order_settings` thresholds. Tables: `inventory_session_items`, `par_guide_items`, `smart_order_settings`. **Edge cases:** par null → no suggestion; negative → clamped; **two order engines on screen** — current `computeOrderQtyCases` vs **deprecated `computeOrderQty`** still rendered in `Review.tsx:323`/`Approved.tsx:235` → **disagree** (T1-5).
- **P3 Triggers:** inventory **approved**; **PAR changed**; threshold settings changed.
- **P4 Trust:** **Medium** — the two-engine disagreement is a UI↔UI contradiction.
- **P5 Drill-down:** Reorder → RED/critical items → suggested qty math → session rows → Smart Order run.
- **P6 Dashboard:** **Hero/Card** (the core workflow); red badge = critical count; notify when criticals appear.
- **P7 Action:** **Place a Smart Order.**
- **P8 Readiness:** **Needs calc fix (T1-5, M)** — remove the deprecated engine.

### K4 — Waste · **CONDITIONAL (cost caveat)**
- **P1 Business:** *"How much money did I throw away this period?"* Decision: fix storage/rotation/prep. **Class: Verified (weak)** — logged events, but `total_cost` is **member-editable**.
- **P2 Calc:** per row prefer `total_cost`, else `qty × resolved unit cost` ([recordedWasteValue.ts](../../src/domain/waste/recordedWasteValue.ts)); period-summed. Tables: `waste_log`, `inventory_catalog_items`. **Edge cases:** `total_cost` client-set → **STAFF-inflatable** (T1-8); missing cost → fallback resolution (catalog/session) or excluded (surface "N missing cost"); negative → none; deleted entry → drops.
- **P3 Triggers:** **waste logged** (any member); edit/delete of an entry.
- **P4 Trust:** **Medium** — a Verified input that can be **gamed** by a staffer.
- **P5 Drill-down:** Waste → entries (item, qty, cost, who/when) → `waste_log` rows. History: waste trend.
- **P6 Dashboard:** **Card**; red on a spike; notify on large single entries.
- **P7 Action:** **Investigate top-wasted items** (storage/rotation/portioning).
- **P8 Readiness:** **Needs trust fix (T1-8, M)** — server-validate cost / gate who sets `total_cost`.

### K11 — Invoice Discrepancies (count) · **CONDITIONAL (relabel)**
- **P1 Business:** *"How many deliveries had a billing/short problem?"* Decision: open and dispute them. **Class: Verified** (a count).
- **P2 Calc:** unique invoices with `receipt_status='issues_reported'` OR any comparison problem ([loadSpendMetrics.ts:164](../../src/domain/dashboard/loadSpendMetrics.ts#L164)). Tables: `invoices`, `invoice_line_comparisons`. **Edge cases:** dedup of the same invoice across predicates handled (unique ids); label "delivery issues" undersells price/total mismatches.
- **P3 Triggers:** invoice received/reviewed; comparison written; issue reported.
- **P4 Trust:** **Low–Medium** — it's a count (hard to inflate); only the **label** misleads.
- **P5 Drill-down:** count → flagged invoices → comparison rows.
- **P6 Dashboard:** **Card/Alert**; red when >0; notify on new issues.
- **P7 Action:** **Open the flagged invoices / dispute with vendor.**
- **P8 Readiness:** **Label fix (S).**

### K12 — Missing Deliveries ($) · **BETA (render it)**
- **P1 Business:** *"How much was I billed for goods that never arrived?"* Decision: claim a vendor credit. **Class: Verified.**
- **P2 Calc:** `Σ (invoiced_qty − received_qty) × invoiced_unit_cost` ([invoice-comparison.ts:113](../../src/lib/invoice-comparison.ts#L113)); tested. Tables: `invoice_line_comparisons`. **Edge cases:** received≥invoiced → 0 (clamped); the count (K11) uses a different `received<po` baseline → reconcile before surfacing $.
- **P3 Triggers:** **receipt confirmed** (manager).
- **P4 Trust:** **Low** — correct, immutable; just **not rendered** (T1-4).
- **P5 Drill-down:** $ → short lines → comparison rows → invoice.
- **P6 Dashboard:** **Beta card** ("we caught $X short-shipped"); red when >0.
- **P7 Action:** **Request a vendor credit.**
- **P8 Readiness:** **Needs render (T1-4, M).**

### K10 — Food Cost % · **BETA (needs sales)**
- **P1 Business:** *"What % of sales am I spending on food?"* Decision: adjust purchasing/menu pricing. **Class: Forecast→Verified** (depends on manual sales).
- **P2 Calc:** `(periodSpend / weeklyGrossSales) × 100`; null until sales>0 ([loadFoodCostMetrics.ts:100](../../src/domain/dashboard/loadFoodCostMetrics.ts#L100)). Tables: `weekly_sales`, `invoices`, `location_settings`. **Edge cases:** sales=0/null → **null + prompt** (honest); 30-day spend vs weekly-sales window can mismatch on partial weeks (T1-9); sales are **manual** (no POS) and member-editable.
- **P3 Triggers:** **sales entered**; invoice confirmed.
- **P4 Trust:** **Medium** — window mismatch; manual input.
- **P5 Drill-down:** % → spend + sales inputs → invoices & `weekly_sales`. History: % vs 28–32% band.
- **P6 Dashboard:** **Beta card**, perm-gated (`can_see_food_cost_pct`); red >32%; prompt when sales missing.
- **P7 Action:** **Review purchasing / menu pricing.**
- **P8 Readiness:** **Needs calc fix (T1-9, M)** + POS later.

### K15 — Pending Invoices (count) · **SHIP (low stakes)**
- **P1 Business:** *"How many invoices need my attention?"* Decision: process them. **Class: Verified (count).**
- **P2 Calc:** count draft/review invoices + pending purchase_history ([dashboardSelectors.ts:35](../../src/domain/dashboard/dashboardSelectors.ts#L35)). **Edge cases:** status transitions; deletes drop.
- **P3 Triggers:** upload; status change.
- **P4 Trust:** Low. **P5:** → pending list → invoice. **P6:** small card/badge. **P7:** **Process pending invoices.** **P8:** ready.

### K8 — Price Increase Impact (aggregate) · **HIDE aggregate / SHIP per-invoice flag** · **needs T0-3**
- **P1 Business:** *"How much are vendors overcharging vs my PO this period?"* Decision: challenge the vendor. **Class: Verified — but double-counted.**
- **P2 Calc:** **two sources summed** — comparison `(inv−po)×min(inv,po)` + notifications `Σ(new−old)×qty` ([loadSpendMetrics.ts:157-181](../../src/domain/dashboard/loadSpendMetrics.ts#L157)); `loadProfitLeaks.ts:217` re-implements with a **different qty** (`invoiced_qty`). Tables: `invoice_line_comparisons`, `notifications`, `invoices`. **Edge cases:** **disjointness unenforced** → double-count if both exist; price *decrease* suppressed to 0; divergent qty bases → different dollars for the same hike on two screens.
- **P3 Triggers:** **receipt confirmed** (manager) writes comparisons + PRICE_INCREASE notifications.
- **P4 Trust:** **Critical (aggregate)** — duplicated, divergent, inflatable. **Per-invoice flag is trustworthy.**
- **P5 Drill-down:** flag → hiked lines (old→new, %, $) → comparison/notification → invoice.
- **P6 Dashboard:** **per-invoice flag in Invoice Review** + a **count** on the dashboard; **hide the aggregate $** until T0-3.
- **P7 Action:** **Contact the vendor / challenge the increase.**
- **P8 Readiness:** **Needs calc fix (T0-3, M)** — one source, one qty basis.

### K9 — Shrinkage · **HIDE as "loss" / BETA as "estimate"** · **needs T0-7**
- **P1 Business:** *"Is stock disappearing faster than usage explains?"* Decision: investigate theft/portioning/miscount. **Class: Derived (estimate)** — heuristic, not a counted loss.
- **P2 Calc:** `Σ data.items[].dollar_impact` for `SHRINK_ALERT`/`COUNT_VARIANCE` notifications ([loadShrinkageValue.ts:35](../../src/domain/dashboard/loadShrinkageValue.ts#L35)). Tables: `notifications` (cron-sourced). **Edge cases:** `dollar_impact` is the cron's heuristic (usage vs rolling avg × resolved cost); post-S0-8 **not client-forgeable**; dedupe trigger ignores `data` (distinct alerts can merge); **loader returns 0 on error** (T0-5).
- **P3 Triggers:** inventory **approved** → `process-notifications` **cron** computes anomalies.
- **P4 Trust:** **High** as a "verified loss" (it's an estimate); Medium as "estimated variance."
- **P5 Drill-down:** estimate → flagged items (usage vs avg) → count deltas → session items.
- **P6 Dashboard:** **Beta card** labeled *"estimated variance,"* never inside a loss total; red on large variance; notify owner/manager.
- **P7 Action:** **Investigate the flagged items** (theft/portion/miscount).
- **P8 Readiness:** **Needs trust fix (T0-7, M–L)** — label as estimate now; re-source from count/movement deltas later.

### K6 — Profit Risk hero ("Money Lost") · **SPLIT (do not show as one number)** · violates Money Rules
- **P1 Business:** intends *"my total exposure/loss this period."* Owner anchors on it — which is exactly why it must be right. **Class: MIXED (invalid).**
- **P2 Calc:** `waste + priceIncrease + overstock + shrinkage` **inline** ([ProfitRiskWidget.tsx:93](../../src/components/ProfitRiskWidget.tsx#L93)); canonical `computeMoneyLostTotal` is **test-only** (T0-0). **Edge cases / why invalid:** mixes **period flows** (waste/price/shrink) with a **point-in-time snapshot** (overstock) → changing the time filter moves 3 of 4 terms; sums **realized losses + not-lost cash (overstock) + an estimate (shrink)**; inherits K8's double-count; inline copy untested.
- **P3 Triggers:** any component's trigger (waste/receipt/cron/approval).
- **P4 Trust:** **Critical** — mixed basis, duplicated formula, UI≠canonical, fail→$0.
- **P5 Drill-down:** must become **three** sub-numbers (Verified losses / Potential overstock / Derived shrink), each to its own evidence.
- **P6 Dashboard:** **do not show as one hero number.** Replace with the split (see Part 9).
- **P7 Action:** per-component (vendor / order / investigate).
- **P8 Readiness:** **SPLIT — needs architecture+trust fix (T0-0→T0-1, M).** *Recommendation: this KPI, as a single number, should not exist.*

### K7 — Savings banner ("potential savings identified") · **REMOVE/REDESIGN** · violates Money Rules
- **P1 Business:** implies *"recoverable money."* But it sums **overstock** (cash you already own, not recoverable) with waste + price. **Class: MIXED (mislabeled).**
- **P2 Calc:** `overstock + waste + priceIncrease` inline ([Dashboard.tsx:765](../../src/pages/app/Dashboard.tsx#L765)); the **same overstock $** is labeled "exposure" in K6 and "savings" here. **Edge cases:** double-labeling; inherits K8 double-count.
- **P3–P5:** as components. **P6:** **remove** (or redesign to only *realized recoverable* items, if any). **P7:** none honest today. **P8:** **S–M (T0-2).** *Recommendation: remove the banner; it cannot be defended to a CFO ("recoverable savings" that includes inventory you already bought).*

### K13 — Top Profit Leaks (Top 5) · **HIDE aggregate / keep per-item after T0-3**
- **P1:** *"Where am I bleeding money, ranked?"* Useful **if** consistent. **Class: Mixed** (composes waste/price/overstock/shrink). **P2:** uses a **different price-qty basis** than K6/K8 → the same hike shows different $ across cards. **P4:** High. **P6:** per-item list is promising once T0-3 unifies price; the blended ranking should not mix classes. **P7:** per-item action. **P8:** **M (T0-3 + T0-0).**

### K14 — Portfolio "Money Lost this week" · **HIDE** · verify (T1-11)
- Per-restaurant copy of K6's mixing ([loadRestaurantPortfolioSummaries.ts:198](../../src/domain/dashboard/loadRestaurantPortfolioSummaries.ts#L198)). **Class: Mixed.** Label asserts realized loss. **Action:** compare locations. **Readiness:** **verify + repoint to split canonical (T1-11, M).**

### K16 — Audit Center · **SHIP (T0-4 done) / finish with T0-5**
- The verification surface. **T0-4 shipped** (no more `$0` on error). Remaining: the self-fetching cards it doesn't cover (T0-5). **Action:** the page's *job* is the owner action (verify every number). **Readiness:** done; T0-5 completes "failure ≠ zero."

### Vendor Connect · **REMOVE** (not a KPI)
- Returns `MOCK_INVOICES` presented as real (T0-6). Mock-as-real is the fastest trust-killer. **Remove until a real integration exists.**

---

## Recommendations that challenge the current set

1. **K6 Profit Risk hero must be SPLIT, not fixed** — a single number that blends Verified/Potential/Forecast cannot be defended to a CFO; replace with three honest sub-numbers.
2. **K7 Savings banner should be REMOVED** — "recoverable savings" that includes overstock (already-owned inventory) is indefensible.
3. **K8 aggregate Price Increase should be HIDDEN until one source/one qty basis** — show the per-invoice flag (which is true) instead.
4. **K9 Shrinkage must be relabeled an estimate** — never inside a loss total.
5. **K13/K14 aggregates HIDDEN** until they share K6's split canonical.
6. **Vendor Connect REMOVED.**
7. **Everything that ships must obey "failure ≠ zero"** (T0-4 done for Audit; T0-5 for cards) and **one formula per KPI** (T0-0).

> No application code, loader, card, or formula was modified in producing this design review.
