# Margin6 — Master Fix & Improvement Plan

*Derived from `MARGIN6_MASTER_STATUS.md`. Not a re-audit — an execution sequence.*

**Ordering principle:** impact first, weighted toward our wedge — **trustworthy numbers** and **mobile counting**. A broken trust feature hurts us more than it hurts the leaders, because trust *is* the pitch.

**Discipline (every phase):** read-only investigate → show plan → approve → execute one small step → **green CI (vitest + `tsc --noEmit -p tsconfig.app.json`) before any merge** → **nothing to production without a separate, explicit deploy decision.** Local Postgres is 17.6 (= prod engine), so local verification is representative.

**Tags:** 🔴 BROKEN · 🟡 IMPROVEMENT · 🏁 closes/relates to a competitive gap.

**Operational note:** Phases 1 and 3 are both **production deploys**. You may run them in one deploy window to batch prod risk, or ship Phase 1 as a standalone hotfix (recommended — it's urgent and self-contained).

---

## PHASE 1 — Stop the bleeding: invoice-confirm crash 🔴
**Why first:** it's *live on production*, it silently kills the flagship "catch supplier price creep" flow, and it directly breaks our #1 differentiator (trustworthy numbers). Highest impact, smallest change.

| Item | Type | Files | Approach | Verify | Prod? | Competitive |
|---|---|---|---|---|---|---|
| Fix `confirm_invoice_receipt` JSON operator-precedence crash on >5% price change | 🔴 | New migration `supabase/migrations/2026…_fix_confirm_receipt_json_precedence.sql` (CREATE OR REPLACE `confirm_invoice_receipt` **and** `_legacy`) | Parenthesize every `(item->>'x')` used inside `\|\|` string concatenation in the PRICE_INCREASE / PRICE_DECREASE / UNIT_MISMATCH notification blocks | **Local repro test:** seed an invoice with a +15% line, call the RPC as manager → returns success (currently throws); confirm catalog cost updates, stock movement + PRICE_INCREASE notification created. Add a regression SQL/unit test so it can't silently regress. | **YES** — one migration, `CREATE OR REPLACE`, idempotent, no schema change | 🏁 Protects "trustworthy numbers"; restores MarginEdge-parity price-alerting |

**First Claude Code task:**
> Read-only first. Reproduce the `confirm_invoice_receipt` JSON precedence crash on local (seed a >5% price-increase invoice, call the RPC as the manager, capture the error). Then draft — don't apply — a migration that `CREATE OR REPLACE`s `confirm_invoice_receipt` and `confirm_invoice_receipt_legacy` with every `(item->>'…')` parenthesized in the notification concatenations. Show me the migration and the local before/after (throws → posts, catalog cost updated, notification created). Apply nothing to production.

---

## PHASE 2 — Trustworthy numbers (the wedge) 🔴
**Why second:** the silent-`$0` dashboard attacks the exact thing we sell — verifiable numbers — on *every* dashboard view, for every user. Group the three "numbers you can't trust" defects into one focused session.

| Item | Type | Files | Approach | Verify | Prod? | Competitive |
|---|---|---|---|---|---|---|
| **Silent-`$0` dashboard** — loaders swallow query errors, render confident `$0`/`[]`/`null` | 🔴 | New `src/domain/dashboard/loadOutcome.ts`; the 9 `loadX*.ts` loaders; `src/hooks/useDashboardData.ts`; dashboard widgets; new `KpiCouldNotLoad` component | Introduce `LoadOutcome<T> = {status:"ok",value} \| {status:"error"}`. **Pilot on `loadShrinkageValue`** (single consumer) → then roll across all 9. Widgets render "couldn't calculate — tap to retry" on error; genuine 0 still shows 0. | Per-loader unit test: error path returns `{status:"error"}` (not 0); ok path returns real value. vitest + tsc green. Manually force a query failure → card shows error state, not `$0`. | Frontend only (via merge/deploy) | 🏁 **Protects the wedge**; reliability is table-stakes vs leaders |
| **Food-cost empty-state message** says "Enter weekly sales" when the real blocker is *no spend* | 🔴 | `src/domain/dashboard/loadFoodCostMetrics.ts:88` + the card component | Distinguish "needs sales" vs "needs costed spend/invoices" in the empty state | Local: sales present + spend=0 → message says "needs spend/invoices"; both present → shows %. | Frontend | 🏁 Fast-onboarding clarity |
| **Price-increase impact double-count** (suspected) | 🔴/🟡 | `loadSpendMetrics.ts`, `dashboardSelectors.ts`, `priceIncreaseFromNotifications.ts` | **Confirm at runtime first** (seed one priced invoice, check the KPI isn't counted from both `invoice_line_comparisons` *and* PRICE_INCREASE notifications). If real, pick one source of truth / dedupe by invoice. | Test: single price increase → impact counted once. | Frontend | 🏁 Protects wedge |

**Split guidance:** if one session is tight, do **2a = pilot loader + food-cost message + double-count confirm**, **2b = roll silent-`$0` across the remaining 8 loaders + dashboard error boundary.**

**First Claude Code task:**
> Read-only first. Implement the silent-`$0` fix as a pilot on `loadShrinkageValue` only: add `src/domain/dashboard/loadOutcome.ts` with a `LoadOutcome<T>` discriminated type, make `loadShrinkageValue` return it, thread it through `useDashboardData`, and render a `KpiCouldNotLoad` ("couldn't calculate — tap to retry") in the shrinkage widget on error. Add a unit test proving the error path returns `{status:"error"}` not `0`. Green CI before you show me the diff. Local only.

---

## PHASE 3 — Finish the security deploy 🔴
**Why third:** these fixes are **already written and locally verified** on branch `security-trust-to-main` (PR #1) but are **open on production**. Low effort, closes real holes. (Ranked below Phase 2 by wedge-impact only because current prod is owner-only; pull it earlier if batching with Phase 1's deploy window.)

| Item | Type | Files | Approach | Verify | Prod? | Competitive |
|---|---|---|---|---|---|---|
| **S1-6 staff-can-edit-PAR** | 🔴 | `20260624000003_restrict_par_guide_items_write.sql` (held) | Apply migration | Re-run the Round-3 check: STAFF edit-PAR blocked, Manager/Owner allowed | **YES** | 🏁 Trust/correctness of reorder math |
| **S0-8 notification spoofing** | 🔴 | `20260623000004_notifications_create_rpc.sql` (held) | Apply **with** frontend (old app still does direct inserts) | Direct member INSERT rejected; RPC path works | **YES** | Reliability |
| **Edge-fn auth (S0-1/2/3)** | 🔴 | `parse-invoice`, `process-notifications`, `inbound-invoice-email` + cron `Bearer` fix `20260624000002` | Sequence: cron-fix → edge deploys → `000004`+frontend together (per the split plan) | Smoke each: parse-invoice requires membership+`restaurant_id`; cron still runs; webhook rejects unsigned | **YES** | Reliability/table-stakes |
| **Migration ledger drift** | 🟡 | — | `supabase migration repair --status applied …` so repo versions match prod | `supabase migration list` clean | **YES (metadata)** | — |

**First Claude Code task:**
> Read-only first. Produce the exact, ordered production deploy runbook to finish PR #1: which held migrations apply in what order, the edge-function deploy sequence (cron-fix → functions → `000004` with the frontend merge), the `supabase migration repair` commands for the ledger drift, and the post-deploy verification queries for each. Change nothing — I'll approve each step and make the deploy decision.

---

## PHASE 4 — Mobile counting works + fast onboarding 🔴
**Why fourth:** mobile-first counting and fast onboarding are our other wedge — and MarketMan's mobile counting is a known weakness we can beat. Two of these were **not fully proven** and one is a hard dead-end.

| Item | Type | Files | Approach | Verify | Prod? | Competitive |
|---|---|---|---|---|---|---|
| **Count-entry grid — verify it actually works on a device** | 🔴/verify | `src/features/inventory-count/` (`InventoryCountPage`, zone strips, `useSessionCommands`) | Drive the mixed-unit count on a real device or fixed e2e (automation couldn't advance "Continue count" — could be a real interaction bug or just tooling). Enter `2 cases + 8 lb`, save, submit. | Session item persists `2.2` cases; e2e (`tests/e2e`) covers the mixed-count → submit path | Frontend | 🏁 **Beats MarketMan's crashing mobile count** |
| **Onboarding dead-end** — no location assignment ⇒ empty app + disabled "Start count" | 🔴 | `src/contexts/RestaurantContext.tsx`, count start screen | In-product guidance when a user has no `user_location_assignments` (prompt/assign flow) instead of a silent dead button | New user with no location sees a clear next step, not a dead button | Frontend (maybe assign RPC) | 🏁 **Fast onboarding vs leaders' weeks-long setup** |
| **`/auth` 404** | 🔴 | router (`src/App.tsx`) | Redirect `/auth` → `/login` | Visiting `/auth` lands on login | Frontend | Polish |

**First Claude Code task:**
> Read-only first. Investigate why the inventory count grid ("Continue count" → data entry) didn't advance under automation — determine whether it's a real product interaction bug or an automation artifact, by tracing `useSessionCommands`/`InventoryCountPage` and testing the real handler. Report findings (real bug vs artifact) before proposing any fix. Local only.

---

## PHASE 5 — Traceable drill-downs + dashboard consolidation 🟡
**Why fifth:** CrunchTime's *most-praised* feature is drilling a number down to its source. Our "View math" exists but wasn't fully traced; and the fragmented, half-deprecated fetching undermines both trust and drill-down. This is where we can **match a gap the leaders win on** while reinforcing the wedge.

| Item | Type | Files | Approach | Verify | Prod? | Competitive |
|---|---|---|---|---|---|---|
| **Verify + strengthen KPI drill-downs ("View math")** | 🟡 | `src/components/explainability/*`, `useMathBreakdown.ts`, `DrilldownSheet.tsx` | For each KPI, confirm the drill-down traces to real source rows (invoice / count / waste); fix any dead-end | Each KPI opens a breakdown that reconciles to raw data | Frontend | 🏁 **Matches CrunchTime's signature traceability** |
| **Consolidate dashboard fetching** | 🟡 | `useDashboardData.ts` (deprecated), self-fetching cards (`PriceHikeAlertsCard`, `ShrinkageAlertCard`, `MoneyLostWidget`) | One orchestrated path + shared error boundary (builds on Phase 2's `LoadOutcome`) | No card renders independently of the error contract | Frontend | Reliability |

**First Claude Code task:**
> Read-only first. Audit every dashboard KPI's "View math" / explain drill-down: does each trace to real source rows, and are any dead-ends? Produce a per-KPI traceability table (KPI → drill-down target → does it reconcile). No fixes yet — I want the map first.

---

## PHASE 6 — Role-fit & polish 🟡 (+ small 🔴)
**Why last:** real but lower-blast-radius; do after the wedge is solid.

| Item | Type | Files | Approach | Verify | Prod? | Competitive |
|---|---|---|---|---|---|---|
| **Staff sees owner dashboard** + cost-visibility is UI-only (S1-1/8) | 🔴/🟡 | dashboard, route guards, `useLocationPermissions`; decide if cost columns need DB-level protection | Lean staff landing; decide column/row protection vs UI hiding | STAFF lands on a role-appropriate view; costs not exposed via API if that's the call | Frontend (+ maybe RLS) | Role-fit for independents |
| **Weekly vs daily sales reconciliation hint** | 🟡 | `src/pages/app/Sales.tsx` | Warn when weekly total ≠ sum of daily | Inconsistent entry surfaces a hint | Frontend | Trust |
| **"Saved ✓" toast on sales save** | 🟡 | `Sales.tsx` | Add success toast | Toast on save | Frontend | Polish |
| **Price-% basis tooltip** (shows invoice-relative %) | 🟡 | invoice review components | Tooltip clarifying the % basis | Tooltip present | Frontend | Clarity |

**First Claude Code task:**
> Read-only first. Propose the leanest staff-appropriate dashboard landing (what a STAFF role should see instead of the owner money-dashboard), and separately assess whether cost columns need DB-level protection or UI hiding is acceptable given our threat model. Recommend, don't implement. Local only.

---

## At-a-glance sequence

| Phase | Focus | Type | Touches prod? | Wedge |
|---|---|---|---|---|
| 1 | Invoice-confirm crash | 🔴 | **Yes (hotfix)** | Trustworthy numbers |
| 2 | Silent-`$0` + food-cost msg + double-count | 🔴 | Frontend | Trustworthy numbers |
| 3 | Finish security deploy (S1-6, S0-8, edge-fn) | 🔴 | **Yes (coordinated)** | Reliability |
| 4 | Mobile counting + onboarding + `/auth` | 🔴 | Frontend | Mobile-first + fast setup |
| 5 | Drill-down traceability + fetch consolidation | 🟡 | Frontend | Beats CrunchTime gap |
| 6 | Role-fit + polish | 🟡 | Frontend | Independent-fit |

**Start here:** Phase 1, first task above.
