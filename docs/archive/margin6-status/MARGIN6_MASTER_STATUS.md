# Margin6 — Master Status Document

*Compiled from the full audit + QA effort: live-DB/code audit, calculation audit, silent-failure audit, three permission rounds, the unit-conversion test, the human walkthrough (employee/manager/owner), and the security deploy. Every item is tagged and states **how** it was verified.*

**Legend:** ✅ WORKS (verified) · ⚠️ NEEDS IMPROVEMENT · ❌ BROKEN/GAP · 🔜 DEFERRED (intentionally later)
**Verification tiers:** `[ran]` executed/observed live · `[db]` verified in Postgres · `[code]` verified by reading source (not run) · `[ui]` observed in the running app · `[not-tested]` explicitly not exercised.

---

## 1. SUMMARY

Margin6 is a **genuinely capable early-stage product with a solid spine and a few sharp, real defects.** The data model, RLS multi-tenancy, the counting→approval→smart-order server logic, the invoice three-way match, and the dashboard math are real and mostly correct — the core value proposition works. The **security posture was materially improved this cycle**: 7 P0 fixes are now live on production, including closing an unauthenticated cross-tenant data-destruction hole. But three things keep it from "trust it blindly": (1) a **live production bug that makes confirming any invoice with a >5% price change crash** (the flagship "catch price creep" flow); (2) a **dashboard that renders a confident `$0`/empty when a query silently fails** rather than an honest error; and (3) a **permission/onboarding model that is real at the DB but leaky and unfriendly at the edges** (staff sees the owner dashboard, staff could edit PAR on production until the held fix ships, and users are dead-in-the-water until an admin assigns them a location). Honest one-liner: **the engine is sound and the security is much better than it was, but don't hand it to a paying restaurant until the invoice-confirm crash and the silent-$0 dashboard are fixed.**

---

## 2. WHAT WORKS (verified — trust it)

### Money math & conversion
- ✅ **Unit conversion, mixed units** `[ran]` — `2 cases + 8 lb` of a 40-lb-per-case item → **2.2 cases**, valued at **$220** ($100/case). Ran the *real* engine (`pack-parser.ts`, `inventory-conversions.ts`, `zoneCounting.ts`, `casePlanningEngine.ts`) via vite-node; matched the hand-calc (88 lb × $2.50/lb = $220). Zone path (`normalizeZoneQtyToPlanningUnit`) sums `[2 case]=2 + [8 lb]=0.2`.
- ✅ **Conversion safety (unknown ratio)** `[ran]` — an item with no parseable pack ratio returns `planningUnitMeta=null` and `normalizeZoneQtyToPlanningUnit` **throws** ("Unit not allowed") instead of inventing a number; a null-cost line returns `{dollars:0, isMissingCost:true}` (flagged, not silently zero).
- ✅ **Food cost %** `[ran/ui]` — dashboard showed **11.9%** = $1,185.36 spend ÷ $10,000 sales; matched hand-calc. Traces sales→KPI correctly. *(spend was enabled by costing a demo invoice locally — labeled; see §3-S2.)*
- ✅ **Canonical formula file** `[code]` — `dashboardTrustFormulas.ts` is a **test-only** wrapper of the real domain functions; **no divergent duplicate implementations** of the KPIs were found.
- ✅ **Inventory value engine** `[code]` — `computeLineInventoryValue = stock(cases) × unit_cost($/case)`, null cost → `dollars:0 + isMissingCost:true`. Logic is correct and defensive.

### Security & tenancy (server-side)
- ✅ **RLS coverage** `[db]` — all **58 public tables** have RLS enabled *and* at least one policy; no locked-out or wide-open tables.
- ✅ **Isolation model** `[db]` — `is_member_of` / `has_restaurant_role_any` / `user_can_access_location` verified; OWNER short-circuits confirmed in the new authz helpers.
- ✅ **Permission enforcement (Round 3, role × action)** `[db]` — SQL RLS impersonation, rollback-only:

  | Action | STAFF | MANAGER (assigned) | OWNER |
  |---|---|---|---|
  | Approve inventory session | 🚫 blocked ✅ | ✅ allowed ✅ | ✅ allowed ✅ |
  | Delete inventory list | 🚫 blocked ✅ | ✅ allowed ✅ | ✅ allowed ✅ |
  | Submit smart order (≤ threshold) | 🚫 blocked ✅ | ✅ allowed ✅ | ✅ allowed ✅ |
  | Submit smart order **over** threshold | — | 🚫 **blocked** ✅ | ✅ (unlimited) |
  | Edit PAR level | ⚠️ allowed (see §3) | ✅ allowed | ✅ allowed |

- ✅ **`delete_inventory_list` hole — CLOSED on production** `[db]` — was `SECURITY DEFINER` with **no auth check** and `EXECUTE` granted to `anon` (unauthenticated cross-tenant cascade-delete of invoices/PO/history). After deploy: **anon EXECUTE = false**, owner/manager guard added. Verified live.
- ✅ **`submit_smart_order` / `confirm_invoice_receipt` role enforcement** `[db]` — now gated by `can_approve_order_amount` / `can_confirm_receipt`; owners pass, over-threshold managers blocked.
- ✅ **`approve_inventory_session_atomic`** `[db]` — the best-built RPC: SECURITY INVOKER, Manager+ check, `FOR UPDATE` lock, blocks double-approval.

### Invoice → order (three-way match)
- ✅ **Invoice-vs-order comparison UI** `[ui]` — the MarginEdge-style screen is strong and clear: explicit **Ordered / Billed / Received** three-way match. Price increase (Chicken $100→$115) flagged **"Price Mismatch (+$15)"**; short delivery (Fries billed 2 / received 1) flagged **"Short delivery (−1, 50%), Short $42."** Tolerances shown. *(comparison rows DB-seeded; the display/derivation is real product code.)*
- ✅ **Post-Invoice safety gate** `[ui]` — "Post Invoice" is **disabled until received quantities are confirmed**; the confirm dialog warns "2 open discrepancies — consider reporting… this cannot be undone." Good trust behavior.

### Flows
- ✅ **Login** `[ui]` — works (`/login`).
- ✅ **Sales entry — weekly & daily** `[ui]` — weekly single-box and a **7-day daily grid with spreadsheet-paste**; both persisted (DB-confirmed: 1 `weekly_sales` row, 7 `daily_sales` rows). Above-average UX.
- ✅ **Count creation** `[ui]` — "Start new count" → name modal (good microcopy) → real `IN_PROGRESS` session created (DB-confirmed).

---

## 3. WHAT'S BROKEN OR OPEN (real issues, ranked)

> "Deployed-fixed" = fixed on **production** now. "Held" = fix written & locally verified but **not yet on production**. "Open" = no fix yet.

### ❌ #1 — Invoice confirm CRASHES on any >5% price change *(REAL, LIVE ON PROD)*
- **What:** `confirm_invoice_receipt` builds a price-alert notification with `' (+' || item->>'pct_change' || '%)'`. On **Postgres 17** (`||` binds tighter than `->>`) this evaluates `text || jsonb`, tries to parse `" (+"` as JSON → **`invalid input syntax for type json: Token "(" is invalid`** → the entire confirm **rolls back**. `[ran]` reproduced on local PG **17.6 — identical to production's engine**.
- **Where:** `supabase/migrations/20260623000007_confirm_receipt_enforce_manager.sql` (the price_increase/decrease/unit_mismatch notification blocks), deployed function `public.confirm_invoice_receipt`.
- **Why it matters:** the flagship "catch supplier price creep" flow **cannot post an invoice** when there's a real price increase — no catalog update, no stock movement, no alert. Silent to the user (generic failure).
- **Fix:** parenthesize every `(item->>'x')` used in `||` concatenation (one-line-class change; verified locally that it then posts cleanly). **Status: ❌ OPEN on prod** (the bug shipped with the S0-9 migration; it pre-existed in the prior function too).

### ❌ #2 — Silent-failure `$0`/empty dashboard *(REAL — code-verified across 9 loaders)*
- **What:** every dashboard loader discards the Supabase `error` (8 via `as unknown as { data }` casts that drop `error`; `loadShrinkageValue` checks it then `return 0`). A failed query becomes a confident **`$0` / `[]` / `null`**, indistinguishable from a genuine zero. The `useDashboardData` T0-4 "reset-to-error" contract never fires because the loaders never throw. `[code]` (not runtime fault-injected).
- **Where:** `src/domain/dashboard/loadShrinkageValue.ts:33`, `loadInventoryMetrics.ts`, `loadSpendMetrics.ts`, `loadProfitLeaks.ts`, `loadWasteMetrics.ts`, `loadOverstockItems.ts`, `loadInvoiceMetrics.ts`, `loadFoodCostMetrics.ts`, `loadRestaurantPortfolioSummaries.ts`.
- **Why it matters:** the product's entire pitch is *trustworthy numbers*; a broken query that reads as "$0 lost / all clear" is the worst possible failure for trust.
- **Fix:** a `LoadOutcome<T> = {status:"ok",value} | {status:"error"}` type; loaders return `error` on failure; widgets render "couldn't calculate — tap to retry." Pilot designed for `loadShrinkageValue` (single consumer). **Status: ❌ OPEN** (plan only).

### ❌ #3 — Food-cost empty-state message is misleading *(REAL)*
- **What:** the card says **"Enter weekly sales to unlock food cost %"** even when weekly sales *are* entered — because `loadFoodCostMetrics` returns an `empty` object (`weeklyGrossSales=null`) whenever `periodSpend<=0`, and the UI keys the message off that. `[ran/code]`
- **Where:** `src/domain/dashboard/loadFoodCostMetrics.ts:88`.
- **Why it matters:** a new operator who just entered sales is told to enter sales again; the real blocker (no costed spend) is hidden.
- **Fix:** distinguish "needs sales" vs "needs spend/invoices" in the empty state. **Status: ❌ OPEN.**

### ⚠️ #4 — Price-increase impact may double-count *(SUSPECTED — code-analysis, not runtime-confirmed)*
- **What:** "price increase impact" is summed from **two sources** — `invoice_line_comparisons` (in `loadSpendMetrics`) and `PRICE_INCREASE` notifications (in `dashboardSelectors`/`priceIncreaseFromNotifications`). If both feed the same KPI for the same invoice, it's counted twice. `[code]` — **not** runtime-verified.
- **Fix:** confirm at runtime; dedupe by invoice/source. **Status: ⚠️ OPEN, needs confirmation.**

### ❌ #5 — Staff can edit PAR levels *(S1-6 — the "named Manager+ but is member-only" lie)*
- **What:** `par_guide_items` INSERT/UPDATE/DELETE policies are *named* "Manager+…" but enforce `is_member_of`, so STAFF can edit PAR (which drives reorder math). `[db]`
- **Where:** `par_guide_items` policies; fix in `supabase/migrations/20260624000003_restrict_par_guide_items_write.sql`.
- **Verified fix locally** `[db]`: after the migration, STAFF edit-PAR → **blocked (0 rows / RLS)**, Manager/Owner still allowed.
- **Status: ⚠️ HELD** — fix is on the branch and locally verified, **not yet applied to production** → **still OPEN on prod.**

### ❌ #6 — `notifications` INSERT has no `user_id` check (S0-8) *(OPEN on prod)*
- **What:** any member can insert notifications for any `user_id` (spoofing). Fix is migration `20260623000004_notifications_create_rpc` (routes through a definer RPC + drops the direct-insert policy). `[db]`
- **Status: ⚠️ HELD** — intentionally split out to deploy *with* the frontend (old app still does direct inserts). **Open on prod** until that combined deploy.

### ❌ #7 — Edge-function auth gaps (S0-1/2/3) *(OPEN on prod)*
- `parse-invoice` accepts any `Bearer` prefix without validating membership (`[code]`; the branch fix adds real membership + `restaurant_id`); `process-notifications` has no caller auth (cron-driven); `inbound-invoice-email` never enforces `RESEND_WEBHOOK_SECRET`. `[db/code]`
- **Status: ⚠️ HELD** — branch fixes exist; **edge functions not deployed.** Open on prod. *(Also: the `process-notifications` cron sends a bare JWT; deploying the hardened function first would 401 the hourly job — a `Bearer` cron-fix migration is staged for that.)*

### ⚠️ #8 — Staff sees the full owner money-dashboard *(REAL)*
- **What:** a STAFF login lands on the owner-style dashboard (Money Lost, Data Quality, Audit Center) — no lean count-only view. `[ui]`
- **Why it matters:** role-fit/trust; a closer shouldn't see P&L. Note cost *visibility* flags (`can_see_costs` etc.) are **UI-only** — not enforced at the DB (`[db]`), so this is also a data-exposure concern (S1-1).
- **Status: ❌ OPEN.**

### ⚠️ #9 — Onboarding dead-end: no location assignment = unusable *(REAL)*
- **What:** with no `user_location_assignments` row, the app is empty and **"Start count" is disabled**; confirmed by assigning a location → button enabled. `[ui]` Arguably correct RBAC, but a hard dependency with no in-product guidance.
- **Status: ❌ OPEN (UX).**

### ⚠️ #10 — `/auth` returns a hard 404 *(REAL, minor)*
- Login is `/login`; `/auth` 404s. `[ui]` A plausible bookmark dead-ends. **Status: ❌ OPEN (minor).**

### Notes on prod hygiene
- ⚠️ **Migration ledger drift** `[db]` — the 7 prod fixes were applied via MCP under regenerated `20260630…` version numbers, not the repo's `20260623…`. A future `supabase db push` will see the repo files as "pending" and try to re-run them (idempotent, but untidy). Fix with `supabase migration repair`. **Status: ⚠️ OPEN (bookkeeping).**

---

## 4. WHAT NEEDS IMPROVEMENT (works but weak)

- ⚠️ **Dashboard data fetching is fragmented** `[code]` — `useDashboardData` is marked **DEPRECATED/"Not used"** yet still orchestrates; several cards (`PriceHikeAlertsCard`, likely `ShrinkageAlertCard`, `MoneyLostWidget`) **self-fetch** independently with no shared error boundary → partial-failure "$0" cards.
- ⚠️ **Two sources of "current stock" / cost** `[code/db]` — `approve_inventory_session_atomic` and `confirm_invoice_receipt` overwrite `inventory_catalog_items.current_stock` / `default_unit_cost` (point-in-time), while `stock_movements` (a ledger) is written but **read by nothing** yet. Cost updates leave **no `catalog_cost_history`**.
- ⚠️ **Price-% basis is invoice-relative** `[ui]` — a $100→$115 increase is shown as **+13.0%** (15/115), not +15% (15/100). Not wrong, but an unusual convention worth a tooltip.
- ⚠️ **Weekly vs daily sales don't reconcile** `[ran]` — stored in separate tables with no cross-check; entering inconsistent weekly ($10k) vs daily ($11k) totals produced **no warning**. Food cost % uses `weekly_sales`.
- ⚠️ **No "Saved ✓" confirmation on sales save** `[ui]` — only the history row updating signals success.
- ⚠️ **React controlled inputs** `[ui]` — login/count fields didn't reliably accept synthesized input (needed native-setter events). Not a user-facing bug, but brittle for automation/e2e.
- ⚠️ **Per-location permission system is cosmetic server-side** `[db]` — `get_location_permissions` (the 6 flags) is consumed by **0 RLS policies / RPCs**; it's a UI preference panel, not enforcement (S1-7). `user_location_assignments` had **0 rows** in prod.

---

## 5. DEFERRED (correctly later — not gaps)

- 🔜 **Cost-layer / unit-registry foundation** — commits `c01be89` (C0-MVP-1) + `a548e43` (C0-MVP-2, local-only). *Why:* explicitly "MVP-3 not started"; intentionally excluded from the security PR.
- 🔜 **`catalog_cost_history`** — cost-change audit trail. *Why:* depends on the cost-layer work above.
- 🔜 **Recipes** — tables were created then **dropped** (`20260502000001_drop_unused_recipe_tables`). *Why:* out of current scope.
- 🔜 **Vendor integrations / vendor scoring** — `vendor_integrations` table exists, 0 rows; vendor-import edge functions are **demo/mock**. *Why:* real vendor APIs not built.
- 🔜 **AI assistant, GL mapping, POS integration, deep reports** — not present. *Why:* explicitly positioned as "No POS required"; these are later-stage.
- 🔜 **Catch-weight (per-lb pricing nuance beyond pack conversion)** — partial handling in `_shared/resolveInvoiceUnitCost.ts`; full catch-weight deferred.
- 🔜 **Zone-level count detail** — `inventory_session_item_zones` exists (0 rows); mixed counts currently reconciled via `conversion_formula`. *Why:* feature not fully wired.

---

## 6. DEPLOY STATE

### ✅ Live on production (applied + verified `[db]`)
7 migrations (applied via MCP as `20260630…` versions):
- S0-5 restrict inventory-session delete · S0-6 purchase_history_items Manager+ · S0-7 sales write reassert · S0-INFRA authz helpers · S0-4 submit_smart_order approval · S0-9 confirm_receipt Manager+ · `delete_inventory_list` owner check (**anon exec = false** verified).

### ⚠️ Staged on branch `security-trust-to-main` (PR #1 open, NOT merged, NOT on prod)
- `20260623000004_notifications_create_rpc` (S0-8) — **held**, deploy *with* frontend.
- `20260624000002_fix_process_notifications_cron_auth` — cron `Bearer` fix (prereq for process-notifications).
- `20260624000003_restrict_par_guide_items_write` (S1-6) — **held**, locally verified.
- Frontend changes + edge-function hardening (`parse-invoice`, `process-notifications`, `inbound-invoice-email`).

### ❌ Not deployed
- **All 3 edge functions** (parse-invoice / process-notifications / inbound-invoice-email) — still the old, weaker versions on prod.
- **Frontend** (Vercel auto-deploys on merge to `main`; PR #1 not merged).

### Still OPEN on production (no fix live)
- Invoice-confirm precedence crash (#1) · silent-$0 (#2) · food-cost message (#3) · staff-edit-PAR (#5, held) · notifications spoof (#6, held) · edge-fn auth (#7, held) · staff-owner-dashboard (#8) · onboarding (#9) · `/auth` 404 (#10) · S1-2/3/4/5/7/9 (never addressed).

---

## 7. PAGE-BY-PAGE MAP

| Page / route | Status | Verified | Hand-off to next / notes |
|---|---|---|---|
| `/` marketing | ✅ | `[ui]` | → Log in |
| `/login` | ✅ | `[ui]` | → `/app/dashboard`. React inputs brittle. |
| `/auth` | ❌ | `[ui]` | **404** — dead route |
| `/app/dashboard` | ⚠️ | `[ui]` | Renders; **staff sees owner view** (#8); food-cost message bug (#3); silent-$0 risk (#2). KPI "View math" drill-downs present but **not fully traced this pass** `[not-tested]`. |
| `/app/inventory/enter` (list + start count) | ✅ | `[ui/db]` | "Start new count"→modal→session created. **Location-gated** (#9). Empty-list earlier was a **test-data artifact** (fixed by seeding). |
| `/app/inventory/enter` (count **grid**) | ❔ | `[not-tested]` | The mixed-unit data-entry grid **could not be driven under automation** ("Continue count" didn't advance). Conversion itself proven in code ($220). **Not claimed working via UI.** |
| `/app/inventory/review` (manager) | ✅ (list) | `[ui]` | Shows "1 pending review" for the submitted count. Per-item **detail render (2.2 cases/$220) not confirmed in UI** `[not-tested]` — verified in DB + code instead. |
| Approve → Smart Order → Submit | ✅ (server) | `[db]` | Approve + submit verified via **RPC** (Round 3). Full **UI click-through not completed** `[not-tested]`. |
| `/app/invoices/:id/review` | ✅ / ❌ | `[ui]` | Three-way match display **excellent**; but **posting a price-increase invoice crashes** (#1). |
| `/app/sales` | ✅ | `[ui/db]` | Weekly + daily both persist; feeds food-cost % (11.9%). |
| `/app/settings` (Owner) | ❔ | `[not-tested]` | Not driven this session. Current-password-not-verified (S1-8) is from **code audit** only. |

**Where handoffs break:** count-grid → review (couldn't drive entry via automation; conversion proven separately) · invoice-review → post (crash on price change #1) · any loader → dashboard card (silent-$0 #2) · sales → food-cost (works, but empty-state message misleads #3).

---

## 8. RECOMMENDED NEXT STEPS (ranked)

1. **Fix #1 (invoice-confirm precedence crash) — TODAY.** One-line-class change (parenthesize `(item->>'x')`), same green-first/local-verified flow. It's live-on-prod and kills the core value flow. *Ship as a hotfix migration.*
2. **Complete the security deploy.** Merge PR #1 (frontend + edge functions), apply the held migrations in the planned order: cron-fix → edge functions → then `000004` (notifications) **with** the frontend, plus **`000003` (S1-6 staff-edit-PAR)** and the ledger `migration repair`. This closes S0-8, S1-6, and the three edge-fn gaps that are still open on prod.
3. **Fix #2 (silent-$0).** Implement the `LoadOutcome<T>` pilot on `loadShrinkageValue`, then roll across the 9 loaders + add a dashboard error boundary. Highest *trust* leverage.
4. **Fix #3 + #8 quick wins.** Correct the food-cost empty-state message; give staff a lean role-appropriate landing (and decide whether cost columns need DB-level protection, not just UI hiding).
5. **Confirm/fix #4 (price double-count)** at runtime; decide the single source of truth for price-increase impact.
6. **Verify the two untested UI paths** — the count-entry grid (real device, or fix the automation) and the manager approve→order→invoice click-through — so the whole loop is UI-proven, not just server-proven.
7. **Onboarding UX (#9)** — in-product prompt when a user has no location assignment; **`/auth` 404 (#10)** redirect.
8. **Then** resume the deferred cost-layer/unit-registry track.

---

*Honesty notes:* Numbers like the **$7,211 / $9,723** "Est. inventory value" were **displayed** in the UI but **not** independently hand-calc-verified against raw rows `[not-tested]` — only the **$220 conversion** and **11.9% food cost** were hand-verified. The **silent-failure** and **price-double-count** findings are **code-analysis**, not runtime fault-injection. Wherever a fix was "verified," it was verified **on local** (Postgres 17.6, matching prod's engine) unless it says "live on production."
