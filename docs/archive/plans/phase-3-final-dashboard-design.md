# Phase 3 — Final Dashboard Design (Part 9)

> **Date:** 2026-06-23 · Companion to [phase-3-kpi-trust-design-review.md](../architecture/phase-3-kpi-trust-design-review.md). No code — a design only.
> **Design principle:** *not for appearance — for trust and decision-making.* Every card states its **class** (Verified/Potential/Forecast/Estimate), shows its math, and ends in an action. **Fewer cards, all defensible.**

## The dashboard we should launch

Two tiers: **(A) Launch dashboard** = only what survives a CFO challenge today. **(B) Promotion queue** = cards that enter as their trust fixes land. The headline is **not** a blended "Money Lost" number — it is a small set of verifiable facts, each with a verb.

### Layout (top → bottom, by decision priority)

```
┌─ ROW 1 · STATE OF MY MONEY (verified facts) ───────────────────────────────┐
│  [Inventory Value]      [Period Spend]        [Food Cost %  (beta/perm)]    │
│   Verified · hero        Verified                Forecast→Verified          │
├─ ROW 2 · WHAT TO DO NOW (action drivers) ──────────────────────────────────┤
│  [Reorder / Critical-Low]   [Overstock — cash tied up]   [Pending Invoices] │
│   Potential                  Potential                    count             │
├─ ROW 3 · WHERE I'M LOSING (verified, per-item — NO blended total) ─────────┤
│  [Price-Hike flags (count)] [Invoice Discrepancies] [Missing Deliveries $*] │
│   Verified per-invoice       Verified count          Verified (beta)        │
├─ ROW 4 · ESTIMATES (clearly marked) ───────────────────────────────────────┤
│  [Variance / Shrinkage — estimated]                                         │
│   Estimate · "investigate", never a "loss total"                            │
└─ FOOTER · [Verify every number → Audit Center]  ───────────────────────────┘
   *Missing Deliveries enters in beta once baseline reconciled (T1-4)
```

**Explicitly absent at launch:** the Profit Risk "Money Lost" hero (K6 — split, not shown), the Savings banner (K7 — removed), the aggregate Price-Increase $ (K8 — count only), Top Profit Leaks blended ranking (K13), portfolio "Money Lost" (K14), Vendor Connect (removed).

## Per-card specification

| # | Card | Position / Priority | Business purpose | Calculation (canonical) | Update trigger | Confidence | Click | Action | Drill-down |
|---|------|--------------------|------------------|-------------------------|----------------|:---------:|-------|--------|-----------|
| 1 | **Inventory Value** | R1 · Hero · P0 | cash in stockroom | `Σ stock×cost` latest APPROVED, zone-deduped | inventory approved; receipt cost change | badge (count age, missing-cost) | View Math → items → session rows → cost invoice | **Recount if stale / review ordering if rising** | Summary→Math→items→`inventory_session_items`→cost source |
| 2 | **Period Spend** | R1 · Card · P0 | cash out this period | confirmed invoice lines + deduped PO | invoice confirmed | high | by vendor → invoice → lines | **Review purchasing** | →vendor→invoice→`invoice_items` |
| 3 | **Food Cost %** | R1 · Card · P1 · *beta, perm-gated* | spend ÷ sales | `(spend/sales)×100`, null if no sales | sales entered; invoice confirmed | medium (manual sales) | spend+sales inputs | **Adjust purchasing / pricing** | →invoices & `weekly_sales` |
| 4 | **Reorder / Critical-Low** | R2 · Hero · P0 | avoid stockouts | `ceil(max(par−stock,0))×cost`; RED count (one engine) | approved; PAR change | medium (after T1-5) | RED items → qty math | **Place a Smart Order** | →session rows→Smart Order run |
| 5 | **Overstock — cash tied up** | R2 · Card · P1 | free frozen cash | `Σ max(stock−par,0)×cost` | approved; PAR change | high | overstock lines | **Reduce next order** | →lines→session rows |
| 6 | **Pending Invoices** | R2 · Badge · P2 | items needing attention | count draft/review + pending PH | upload; status change | high | pending list | **Process invoices** | →invoice |
| 7 | **Price-Hike flags (count)** | R3 · Alert · P0 | vendor overcharge caught | **count** of per-invoice hike flags (single source) | receipt confirmed | per-invoice high | flagged invoices → lines | **Contact / challenge vendor** | →comparison/notification→invoice |
| 8 | **Invoice Discrepancies** | R3 · Alert · P1 | short/billing problems | unique invoices with issue/comparison problem | received/reviewed | medium | flagged invoices | **Dispute with vendor** | →comparison rows |
| 9 | **Missing Deliveries $** | R3 · Card · P1 · *beta (T1-4)* | billed-but-short | `Σ(inv_qty−recv_qty)×inv_cost` | receipt confirmed | high | short lines | **Request a credit** | →comparison rows |
| 10 | **Variance / Shrinkage — estimated** | R4 · Card · P2 · *beta* | stock disappearing | `Σ dollar_impact` SHRINK/COUNT_VARIANCE (labeled **estimate**) | approved → cron | estimate badge | flagged items → deltas | **Investigate items** | →count deltas→session items |
| — | **Audit Center** (footer link) | Footer · P0 | verify every number | re-displays 1–10 with formula/source/confidence; error state honest (T0-4) | on load | per-row | the verification table | **Verify** | the registry |

## State rules (when cards appear / disappear / turn red / notify / require action)

| Card | Appears | Disappears | Red when | Notify when | Requires action when |
|------|---------|------------|----------|-------------|----------------------|
| Inventory Value | always (after first approved count) | no approved count → empty state ("count to begin") | value spikes vs trailing avg | — | stale count (>X days) |
| Period Spend | always | — | spend % of sales rising (needs sales) | big week-over-week jump | — |
| Food Cost % | sales entered | no sales → prompt (not $0) | >32% | crosses target | sales missing → "enter sales" |
| Reorder/Critical-Low | criticals exist | all green → "stocked OK" | RED count > 0 | new criticals | RED items present |
| Overstock | overstock > 0 | none → "no overstock" | grows period-over-period | — | sustained growth |
| Pending Invoices | >0 | 0 → hidden | aging > X days | new upload | pending present |
| Price-Hike flags | hikes detected | 0 → "no hikes" | any hike | new hike | hike present |
| Invoice Discrepancies | issues > 0 | 0 → "no issues" | >0 | new issue | dispute needed |
| Missing Deliveries | short > 0 | 0 → "no shortfalls" | >0 | new short-ship | credit claim |
| Variance/Shrinkage | variance flagged | none → "counts matching" | large variance | flagged | investigate |

**Universal rules (apply to every card — the trust contract):**
- **Failure ≠ zero (T0-4/T0-5):** a load error renders *"couldn't load — Retry,"* **never** `$0`, "all clear," a value, or a confidence badge.
- **Empty ≠ failure:** a *verified* empty (load succeeded, zero rows) shows the honest "none detected" copy.
- **One class per card:** the class chip (Verified/Potential/Forecast/Estimate) is mandatory; no card blends classes.
- **One formula per KPI (T0-0):** the rendered number, the "View Math" string, and the test all reference the same canonical function.
- **Every card ends in a verb** (Part 7) — no card is "interesting information."

## Why this beats the current dashboard
- **Removes the indefensible:** the blended "Money Lost" hero and "potential savings" banner — the two numbers a CFO would reject — are gone, replaced by verifiable facts + per-item leak flags.
- **Keeps the wedge:** per-invoice price-hike / short-delivery detection + "View Math" — the category differentiator — are front and center and *true*.
- **Honest by construction:** estimates are labeled estimates; failures look like failures; every number drills to records.
- **Shippable now:** Rows 1–2 + Price-Hike flags + Discrepancies are ready or near-ready today; the rest enter the promotion queue as T0-1/2/3/7 and T1-3/4/5/9 land.

## Promotion queue (what turns on as fixes ship)
| Becomes GA when | Card |
|-----------------|------|
| T1-3 | Inventory Value **trend chart** beside the hero |
| T1-5 | Reorder shows one engine everywhere |
| T1-4 | Missing Deliveries $ → GA |
| T0-3 | Price-Increase **aggregate $** (one source) — if still wanted |
| T0-7 | Shrinkage → from "estimate" toward "verified" (count-delta sourced) |
| T0-1 | A **split** exposure view (Verified losses · Potential overstock · Estimated variance) — never one number |
| T1-9 | Food Cost % → GA |

> No application code, loader, card, or formula was modified in producing this design.
