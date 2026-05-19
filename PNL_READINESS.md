# P&L Lite — Public-launch readiness checklist

Scope: **inventory + food cost only, multi-location native** (no labor, no recipes, no POS — recipes/POS deferred to Phase C). Build the *actual* (count-driven) food-cost P&L on top of trustworthy numbers, for both single-location operators and small chains (3–25 locations).

**Multi-location model:**
- P&L is **per-location** at the storage layer. Every `period_snapshots` row belongs to exactly one location (or to the "unassigned" bucket if `location_id IS NULL`).
- A **restaurant-wide consolidated P&L** is computed by summing per-location snapshots for the same period — never recomputed from raw data.
- Period boundaries are **restaurant-level** (all locations close on the same week). Per-location close can fail independently (one location's invoices unresolved blocks just that location).
- **Inter-location transfers are out of scope for launch** (deferred to v1.1, see Out of scope). Pilots that move stock between locations will have to record those as waste-out + manual catalog adjustment at the receiving location. Communicate this limitation up front.

Track:
- [ ] = not started
- [~] = in progress
- [x] = done

Each item has File:line refs, the audit verdict it closes, the fix, the test, and a rough time. Work through workstreams in order — later items depend on earlier ones being trustworthy.

Cross-ref: see [DEMO_READINESS.md](DEMO_READINESS.md) for the older Tier-0 demo bugs. Some overlap is marked below.

---

## Workstream 1 — Lock the foundation (Week 1)

Goal: every number P&L will read becomes correct and constraint-protected.

### 1.1 DB UNIQUE on `inventory_session_items(session_id, catalog_item_id)`

| Field | Detail |
|---|---|
| **Closes** | Audit #8, #37; DEMO_READINESS #3 at the DB level |
| **Why** | App-level dedupe in [dashboardSelectors.ts:163-191](src/domain/dashboard/dashboardSelectors.ts#L163-L191) only protects the dashboard. Smart Order, edge functions, raw SQL, and future P&L queries all need the DB to enforce uniqueness. |
| **Fix** | New migration: cleanup script merges existing dup rows (sum `current_stock`, take first for other fields, delete extras) → then `ALTER TABLE inventory_session_items ADD CONSTRAINT inventory_session_items_unique_catalog UNIQUE (session_id, catalog_item_id);` partial index (`WHERE catalog_item_id IS NOT NULL`). |
| **Test** | After migration, attempting to insert a second row with same `(session_id, catalog_item_id)` errors. Dashboard `inventoryValue` unchanged for sessions that had duplicates. |
| **Time** | 4-8h |
| **Status** | [ ] |

### 1.2 Portfolio edge fn — dedupe session items

| Field | Detail |
|---|---|
| **Closes** | Audit #30, #31 |
| **File** | [supabase/functions/portfolio-dashboard/index.ts:179-208](supabase/functions/portfolio-dashboard/index.ts#L179-L208) |
| **Why** | Edge fn iterates raw `inventory_session_items`; duplicate zone rows double-count R/Y/G and overstock. Client dedupes, edge doesn't. |
| **Fix** | Port `deduplicateSessionItems` logic from [dashboardSelectors.ts:163-191](src/domain/dashboard/dashboardSelectors.ts#L163-L191) into the edge function (or inline the same `Map<catalog_id, summed_stock>` pattern). After 1.1 lands, this becomes belt-and-suspenders. |
| **Test** | Seed 2 zone rows for same `catalog_item_id` in one approved session. Single dashboard R/Y/G == portfolio R/Y/G for that restaurant. |
| **Time** | 2-3h |
| **Status** | [ ] |

### 1.3 Portfolio edge fn — use `catalog.current_stock` like single dashboard

| Field | Detail |
|---|---|
| **Closes** | Audit #32 |
| **File** | [portfolio-dashboard/index.ts:180-184](supabase/functions/portfolio-dashboard/index.ts#L180-L184) |
| **Why** | Single dashboard augments session items with `inventory_catalog_items.current_stock` (running balance post-receipts) at [loadInventoryMetrics.ts:132-150](src/domain/dashboard/loadInventoryMetrics.ts#L132-L150). Portfolio shows frozen count → numbers diverge by the receipts since last count. |
| **Fix** | After fetching session items, query `inventory_catalog_items (id, current_stock)` for the restaurant and overwrite item `current_stock` where `catalog.current_stock` is non-null. Same pattern as single dashboard. |
| **Test** | Approve a session, then confirm an invoice receipt. Single dashboard and portfolio show the same updated stock for that item. |
| **Time** | 2-3h |
| **Status** | [ ] |

### 1.4 Portfolio edge fn — safe error serialization + FK shape

| Field | Detail |
|---|---|
| **Closes** | Audit #35, #36; DEMO_READINESS #5 |
| **File** | [portfolio-dashboard/index.ts:110-111, 328](supabase/functions/portfolio-dashboard/index.ts#L110-L111) |
| **Fix** | `const message = err instanceof Error ? err.message : String(err);` in the catch. For the membership embed, handle both `restaurants` as object and as `[object]` array. |
| **Test** | Force a throw of a non-Error value; response body has readable message. Mock the Supabase response with `restaurants` as array; `.id` still resolves. |
| **Time** | 1h |
| **Status** | [ ] |

### 1.5 Pack-parse coverage report

| Field | Detail |
|---|---|
| **Closes** | Audit #26, #41 |
| **File** | [usage-analytics.ts:192-229, 240-242](src/lib/usage-analytics.ts#L192-L229) |
| **Why** | `estimatePackSizeMultiplierForUnit` silently returns `null` on unparseable pack strings → `convertPurchaseQuantityToStockUnits` falls back to raw quantity. P&L undercounts purchases for those items. |
| **Fix** | Script `scripts/audit-pack-parse-coverage.ts` that walks every catalog item, runs the parser, and writes to a `catalog_pack_parse_issues` table (`catalog_item_id`, `pack_size_raw`, `attempted_unit`, `last_checked_at`). Add a Settings → Data Quality screen listing unresolved rows. P&L screen must display the unresolved count as a footer. |
| **Test** | Seed a catalog item with pack `"weird-pack-xyz"`. Script lists it in the issues table; Settings shows the count; P&L footer shows "12 items missing pack parse — purchases may undercount." |
| **Time** | 1-2d |
| **Status** | [ ] |

### 1.6 Surface negative usage instead of hiding it

| Field | Detail |
|---|---|
| **Closes** | Audit #27 |
| **File** | [usage-analytics.ts:474-486](src/lib/usage-analytics.ts#L474-L486) |
| **Why** | `weeklyUsage = Math.max(0, weeklyUsage)` silently zeros negative usage (ending + purchases > beginning = data inconsistency). P&L needs to surface these as data-quality flags, not bury them. |
| **Fix** | Change `ComputedUsageItem` to add `has_negative_usage: boolean`. Keep `weekly_usage` clamped for downstream callers, but expose the raw signed value as `usage_raw_signed` so the P&L screen can list affected items. |
| **Test** | Seed a sequence where ending stock > beginning + purchases. Usage row reports `has_negative_usage: true`. P&L footer lists the item. |
| **Time** | 2-4h |
| **Status** | [ ] |

### 1.7 Audit log: cost, qty, approval changes

| Field | Detail |
|---|---|
| **Closes** | Audit #39 |
| **Why** | First operator question after seeing a P&L change is "who changed what?" Without an audit log you cannot answer. |
| **Fix** | New tables `audit_cost_changes`, `audit_session_changes`, `audit_invoice_changes` — `actor_user_id`, `entity_id`, `field`, `before`, `after`, `changed_at`. Postgres triggers on `inventory_catalog_items.default_unit_cost`, `inventory_session_items.unit_cost / current_stock`, `inventory_sessions.status`, `invoice_items.unit_cost / quantity_invoiced / total_cost`. RLS: read-only for OWNER/MANAGER. |
| **Test** | Edit a catalog cost; audit row appears with before/after. Re-approve a session; audit row appears. |
| **Time** | 1d |
| **Status** | [ ] |

### 1.8 RLS hardening — revoke anon DML

| Field | Detail |
|---|---|
| **Closes** | DEMO_READINESS #2 |
| **File** | [supabase/migrations/20260212010647_grant_public_tables_anon_authenticated.sql](supabase/migrations/20260212010647_grant_public_tables_anon_authenticated.sql) |
| **Fix** | New migration: `REVOKE INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public FROM anon;` Re-grant only what anon-only flows need (likely none). Add a SQL CI check: every public table has `relrowsecurity = true`. |
| **Test** | With anon key, `INSERT INTO restaurants` fails. SQL check returns 0 tables. |
| **Time** | 4-8h |
| **Status** | [ ] |

### 1.9 Sentry + structured logs

| Field | Detail |
|---|---|
| **Why** | You cannot ship a paid P&L without seeing FE/edge errors in real time. |
| **Fix** | `@sentry/react` on FE, sentry-deno wrapper on each edge fn. Structured logger that emits `{timestamp, fn, level, actor_id, restaurant_id, msg, ctx}` JSON to stdout (Supabase log-drains). |
| **Test** | Throw test error from a page and an edge fn; both appear in Sentry within 60s. |
| **Time** | 4-8h |
| **Status** | [ ] |

---

## Workstream 2 — Period close primitive (Week 2)

Goal: a "week 18" P&L number is immutable. Without close, every refresh can move historical numbers.

### 2.1 `accounting_periods` table (restaurant-level boundary)

| Field | Detail |
|---|---|
| **Closes** | Audit #38 (in part) |
| **Schema** | `id`, `restaurant_id`, `start_date`, `end_date`, `status` (`open` \| `partially_closed` \| `closed`), `closed_at`, `closed_by_user_id`, `reopened_at`, `reopened_by_user_id`, `notes`. UNIQUE on `(restaurant_id, start_date)`. |
| **Why** | A period is **one row per restaurant** (not per location). All locations share the same Week 18 boundary. `status = partially_closed` when some but not all locations have snapshots; `closed` only when every active location has a snapshot. |
| **Test** | Create period, close one of two locations, period status = `partially_closed`. Close second → `closed`. |
| **Time** | 2h |
| **Status** | [ ] |

### 2.2 `period_snapshots` table (per-location)

| Field | Detail |
|---|---|
| **Closes** | Audit #38 |
| **Schema** | `id`, `period_id`, `restaurant_id`, `location_id` (nullable for "unassigned" bucket — sessions/invoices without `location_id`), `beginning_session_id`, `ending_session_id`, `beginning_inventory_dollars`, `purchases_dollars` (breakdown JSON: invoice_total, purchase_history_total, by_vendor), `ending_inventory_dollars`, `waste_dollars`, `cogs_dollars`, `gross_sales_dollars` (nullable until sales entered), `food_cost_pct` (nullable), `snapshot_at`, `data_quality_flags` JSONB (`{missing_cost_items, negative_usage_items, pack_parse_misses, days_missing_sales}`). UNIQUE on `(period_id, location_id)` — one row per location per period (NULLs are distinct in pg; treat unassigned as a single bucket via partial index `WHERE location_id IS NULL`). Note: transfers_in/out columns deferred with item 2.6. |
| **Why** | Frozen numbers per location per closed period. Consolidated P&L is computed by summing these rows — never recomputed from live data. Per-location storage is the foundation for chain rollups. |
| **Test** | After `close_period_for_location` runs, exactly one row per (period, location). Modifying invoices afterwards does NOT change the snapshot. Sum across locations equals consolidated COGS. |
| **Time** | 3h |
| **Status** | [ ] |

### 2.3 `close_period_for_location(period_id, location_id)` RPC

| Field | Detail |
|---|---|
| **Logic** | Transactional, per-location. (a) Pick beginning session = latest APPROVED with `approved_at < period.start_date` AND matching `location_id` (or `IS NULL` for unassigned bucket). (b) Ending session = same with `approved_at <= period.end_date`. (c) Sum session items through canonical engine. (d) Sum confirmed invoices + completed purchase_history scoped to that `location_id`, in `[start_date, end_date]` (line-cost basis, same as [loadSpendMetrics.ts:101-116](src/domain/dashboard/loadSpendMetrics.ts#L101-L116)). (e) Sum waste scoped to location. (f) COGS = beginning + purchases − ending. (g) Write `period_snapshots` row scoped to (period, location). (h) If every active location for the restaurant now has a snapshot, flip `accounting_periods.status` to `closed`; else `partially_closed`. (Transfer accounting deferred — item 2.6.) |
| **Blocks** | Reject if any invoice for that location in the window has `status IN ('draft','review','ready_to_receive')`. Reject if no APPROVED session for that location before `start_date`. Reject if location has no active `is_active = true` row. |
| **Test** | Closing one location does not affect another. Modifying that location's invoices after close does NOT change its snapshot. Sum of per-location snapshots equals what live aggregate would have computed at moment of close. |
| **Time** | 1d |
| **Status** | [ ] |

### 2.3b `close_period(period_id)` convenience RPC

| Field | Detail |
|---|---|
| **Logic** | Loops `close_period_for_location` for every active location in the restaurant + the unassigned bucket if any sessions/invoices have `location_id IS NULL`. Reports which locations succeeded and which were blocked (with reason per location). Sets period status to `closed` if all succeed, `partially_closed` if some succeed, leaves `open` if all fail. |
| **Why** | One-click "Close Week 18" for owners managing multiple locations. |
| **Test** | Two locations: one with open invoice, one clean. Convenience RPC closes the clean one, returns blocker for the dirty one, period status = `partially_closed`. |
| **Time** | 4h |
| **Status** | [ ] |

### 2.4 `reopen_period_for_location` + `reopen_period` RPCs (Owner only)

| Field | Detail |
|---|---|
| **Logic** | Owner-only RLS. Per-location variant: deletes that location's `period_snapshots` row, flips period status from `closed` → `partially_closed` (or `open` if it was the last snapshot). Convenience variant: reopens all locations for the period, sets status to `open`. Both require non-empty `reason` (min 10 chars) and write to audit log. |
| **Test** | Manager call returns 403. Owner call without reason returns 400. Reopening one of three closed locations flips period to `partially_closed`. |
| **Time** | 4h |
| **Status** | [ ] |

### 2.5 Period Close UI (multi-location aware)

| Field | Detail |
|---|---|
| **Route** | `/app/p-and-l/periods` |
| **Features** | List of weekly periods (auto-generated rolling forward) with overall status badge (`open` / `partially_closed` / `closed`). Each period row expands into a per-location matrix: location name, status, beginning/ending session indicator, blocker count, per-location "Close" CTA and per-location reopen (Owner). A top-level "Close All" CTA runs the convenience RPC. Block-list panel per location: open invoices, missing-cost items above threshold, pack-parse misses, missing daily-sales days. Each blocker deep-links to the page to fix it. |
| **Test** | UI matches RPC behavior end-to-end across 1-, 2-, and 5-location restaurants. |
| **Time** | 1-2d |
| **Status** | [ ] |

### 2.6 ~~Inventory transfers between locations~~ — DEFERRED to v1.1

**Decision (2026-05-13):** Out of scope for launch. Next target after public release.

**Launch workaround:** Pilots that transfer stock between locations record the sending side as a waste-log entry (reason: "transfer out") and the receiving side as a manual catalog stock adjustment. P&L will show the sender's COGS slightly elevated (extra waste) and the receiver's slightly low — acceptable for v1.

Full design preserved here for v1.1:
- `inventory_transfers` table: `id`, `restaurant_id`, `from_location_id`, `to_location_id`, `transfer_date`, `created_by_user_id`, `notes`, `status` (`draft` \| `confirmed`).
- `inventory_transfer_items`: `transfer_id`, `catalog_item_id`, `quantity_cases`, `unit_cost_at_transfer`, `total_cost`.
- Trigger updates both locations' `current_stock` on confirm.
- `period_snapshots` adds `transfers_in_dollars` / `transfers_out_dollars` columns.
- COGS formula becomes: beginning + purchases + transfers_in − transfers_out − ending.

| Status | [ ] DEFERRED — v1.1 |

---

## Workstream 3 — P&L Lite screen (Week 3)

Goal: ship the screen owners pay for.

### 3.1 `daily_sales` table + per-location entry UI

| Field | Detail |
|---|---|
| **Schema** | `id`, `restaurant_id`, `location_id` (NOT NULL — sales must be attributed to a location; "unassigned" not allowed since chains need per-store food cost %), `sale_date` (DATE), `gross_sales`, `comps` (default 0), `discounts` (default 0), `tax` (default 0), `revenue_center` (nullable free text), `entered_by_user_id`, `entered_at`. UNIQUE `(location_id, sale_date)`. |
| **Why** | No POS — owners type one daily sales number per location. Period close flags missing days per location (in `data_quality_flags.days_missing_sales`), doesn't block. For single-location restaurants this is one input per day; for chains it's one per location per day. |
| **UI** | `/app/sales` — location switcher at top, month grid below, one cell per day, single number input. Bulk paste from spreadsheet supported. "Copy across locations" helper for restaurants that enter aggregate then split. Edit prior days requires audit reason. |
| **Test** | Enter sales for 3 locations × 7 days. Each `period_snapshots.gross_sales_dollars` matches its location's sum. Edit prior day; audit row exists. |
| **Time** | 1-2d |
| **Status** | [ ] |

### 3.2 `food_cost_report` RPCs — per-location + consolidated

| Field | Detail |
|---|---|
| **`food_cost_report_for_location(period_id, location_id)`** | Returns for one location: `{ beginning_inventory, purchases_invoiced, purchases_legacy, ending_inventory, cogs, sales, food_cost_pct, waste_dollars, waste_pct_of_sales, top_categories_by_purchase, top_items_by_usage_dollars, price_change_impact, data_quality: { missing_cost_items, pack_parse_misses, negative_usage_items, days_missing_sales } }`. |
| **`food_cost_report_consolidated(period_id)`** | Sums per-location snapshots into restaurant-wide totals. Returns same shape plus `by_location: [{ location_id, name, cogs, sales, food_cost_pct }]` for comparison. Skips locations with no snapshot (and surfaces those in `data_quality.locations_not_closed`). |
| **Source** | Reads exclusively from `period_snapshots` + `daily_sales`. Never recomputes from live source. |
| **Test** | Close 2 of 3 locations. Consolidated report shows 2 locations' numbers + `locations_not_closed: [third]`. Modifying an invoice for a closed location after close does NOT change consolidated numbers. Per-location food_cost_pct is independent. |
| **Time** | 1-2d |
| **Status** | [ ] |

### 3.3 P&L Lite screen at `/app/p-and-l` (location switcher + consolidated)

| Field | Detail |
|---|---|
| **Features** | (1) **Scope switcher** at the top: "All Locations (consolidated)" + each individual location. Default to All Locations for multi-location restaurants, to the single location for single-location restaurants. (2) **Period picker** (closed only by default; "preview current" available with red watermark; consolidated view shows period status badge and skipped-location list). (3) Numbers from 3.2 displayed with formulas spelled out. (4) **Per-location comparison table** (consolidated view only): one row per location with sales, COGS, food cost %, sortable by food cost % to surface outliers. (5) Drill-downs: COGS → category → item-level usage; Purchases → vendor breakdown; Waste → reason breakdown. (6) "Why did this change?" link on any number → opens period audit log diff. (7) Data-quality footer with counts from 3.2 (consolidated view aggregates across locations). |
| **Constraints** | Owner + Manager roles only. Managers see only locations they have access to (respect existing `restaurant_members` scoping). Disable if no `period_snapshots` exist for the restaurant (onboarding CTA → close first period). |
| **Test** | Numbers on screen match RPC output exactly. Drill-downs sum back to parent. Consolidated COGS = sum of per-location COGS. Manager scoped to one location cannot see other locations' numbers. |
| **Time** | 3-4d |
| **Status** | [ ] |

### 3.4 PDF + CSV export (single-location, per-location, and consolidated)

| Field | Detail |
|---|---|
| **Why** | Bookkeepers and accountants want a takeaway artifact. Chains need per-location *and* consolidated. |
| **Fix** | Use existing [jspdf](package.json) dep. Three export modes: (a) **Single location** — header: restaurant + location + period + closed_at + closed_by + generated_at; body: seven numbers + drill-downs. (b) **All locations (one PDF, multi-page)** — one page per location, final consolidated summary page with per-location comparison table. (c) **Consolidated only** — restaurant total + per-location row table on one page. CSV: flat one-row-per-line with a `location` column so chains can pivot. |
| **Test** | Per-location PDF totals match per-location screen. Multi-page PDF's consolidated page totals match consolidated screen. CSV opens in Excel/Sheets without escaping issues. |
| **Time** | 1d |
| **Status** | [ ] |

---

## Workstream 4 — Pre-launch commercial readiness (parallel, ~Week 3-4)

Required before charging money. Can run alongside Workstream 3.

### 4.1 Stripe billing + per-location pricing

| Status | [ ] |
| **Tier shape** | Starter $79/loc (inventory + invoices), Pro $149/loc (+ P&L Lite + waste depth), Multi-unit $249/loc (+ portfolio rollup + accounting export). |
| **Time** | 2-3d |

### 4.2 Onboarding wizard (0 → first count in <30 min)

| Status | [ ] |
| **Steps** | Create restaurant → invite team → import vendor catalog (CSV or vendor-statement OCR) → seed first inventory list → record opening inventory → confirm first invoice. |
| **Time** | 2-3d |

### 4.3 Mobile PWA + offline counting queue

| Status | [ ] |
| **Why** | Counts happen on phones in walk-in freezers with bad signal. IndexedDB write-through + sync on reconnect. |
| **Time** | 3-5d |

### 4.4 ToS, Privacy, DPA, basic security page

| Status | [ ] |
| **Time** | 1d (template-driven) |

### 4.5 Cron + email deliverability proof

| Closes | DEMO_READINESS #7 |
| Status | [ ] |
| **Fix** | pg_cron schedule for `process-notifications` committed in repo (not Supabase dashboard only). Resend domain SPF/DKIM verified, bounce webhook captured. Manual trigger test documented. |
| **Time** | 1-2h verify + document |

### 4.6 Hot-path perf cleanup

| Closes | DEMO_READINESS #8, #9 |
| Status | [ ] |
| **Files** | [PurchaseHistory.tsx ~180-212](src/pages/app/PurchaseHistory.tsx#L180-L212), `inventoryCountQueries.ts` `select("*")` cases. |
| **Time** | 4-8h per page |

---

## Execution order (one-by-one)

Work top-to-bottom. Don't skip ahead — later items assume earlier ones are trustworthy.

1. **1.1** DB UNIQUE constraint *(blocks portfolio dedupe, blocks period close)*
2. **1.2** Portfolio dedupe
3. **1.3** Portfolio uses catalog.current_stock
4. **1.4** Portfolio error/FK fixes
5. **1.8** RLS revoke
6. **1.9** Sentry + structured logs *(do before pilots so you see what breaks)*
7. **1.6** Negative-usage surfacing
8. **1.5** Pack-parse coverage report
9. **1.7** Audit log
10. **2.1** accounting_periods table (restaurant-level)
11. **2.2** period_snapshots table (per-location)
12. **2.3** close_period_for_location RPC
13. **2.3b** close_period convenience RPC
14. **2.4** reopen_period RPCs
15. **2.5** Period Close UI (multi-location matrix)
16. **3.1** daily_sales + per-location entry UI
17. **3.2** food_cost_report per-location + consolidated RPCs
18. **3.3** P&L Lite screen with location switcher
19. **3.4** PDF/CSV export (3 modes)
20. **4.5** Cron proof *(can move earlier — independent)*
21. **4.6** Hot-path perf *(can move earlier — independent)*
22. **4.4** Legal pages
23. **4.1** Stripe billing
24. **4.2** Onboarding wizard
25. **4.3** Mobile PWA + offline

**Post-launch (v1.1):** 2.6 inventory transfers between locations.

---

## Definition of "ready for public"

- All Workstream 1 + 2 + 3 items marked `[x]` (item 2.6 deferred to v1.1).
- 4.1, 4.2, 4.4, 4.5 marked `[x]`.
- One closed P&L period demonstrated on each of: (a) a single-location pilot, (b) a 3+ location chain pilot. Every number traces to a `period_snapshots` row, and the audit log explains every cost / qty change.
- Consolidated COGS for the chain pilot equals the sum of its per-location snapshots.
- 4.3 (mobile/offline) and 4.6 (perf) can ship in the first patch after launch if needed.

---

## Out of scope (do not build)

- Labor, scheduling, payroll, prime cost, tip pooling — **permanently out**.
- Theoretical COGS / variance (needs recipes + POS — Phase C).
- Recipe builder (deleted from codebase 2026-05-13).
- POS integrations (Phase C).
- Inventory transfers between locations (deferred to v1.1, next target after launch — see item 2.6).
- Multi-currency, EDI, native mobile, SOC 2 Type 2 — all v1.1+.

---

## Changelog

| Date | Change |
|---|---|
| 2026-05-13 | Initial plan from number audit + scope lock (no labor/recipes/POS). Recipe files deleted from src/. |
| 2026-05-13 | Multi-location native: per-location `period_snapshots`, restaurant-level `accounting_periods` with `partially_closed`, per-location + consolidated `food_cost_report` RPCs, location-switcher P&L screen, transfers table (2.6 optional). |
| 2026-05-13 | Inventory transfers (item 2.6) deferred to v1.1 — workaround documented (waste-out + manual catalog adjustment). Execution order renumbered to 25 items. |
