# 04 — Business Rules Catalog (Phase 5)

Every rule is stated as **Trigger · Inputs · Logic · Outputs · DB effects · Consumers**, sourced from the pure-logic layer. File paths cited; line numbers approximate to the audited revision.

---

## A. Risk & Reorder

### R-A1 Suggested order quantity (case-based ceiling)
- **Trigger:** Smart Order + reorder summaries.
- **Inputs:** `current_stock` (cases), `par_level` (cases).
- **Logic:** `need = par − stock`; if `par ≤ 0` or `need ≤ 0` → `0`; else `ceil(need)`.
- **Outputs:** whole-case suggested order.
- **DB:** written to `smart_order_run_items.suggested_order`.
- **Consumers:** `src/lib/inventory-utils.ts`, `src/domain/inventory/casePlanningEngine.ts`, `items/itemView.ts`, `smartOrderFromSession.ts`.

### R-A2 Risk tiering (red/yellow/green/no-par)
- **Inputs:** `currentStock`, `parLevel`, thresholds.
- **Logic:** defaults red = 50%, yellow = 100% (yellow clamped ≥ red). `par ≤ 0` → `NO_PAR`. `percent = round(stock/par*100)`. `stock ≤ 0` or `percent < red` → RED; `percent < yellow` → YELLOW; else GREEN.
- **DB:** `smart_order_run_items.risk`; `smart_order_settings.{red_threshold,yellow_threshold}` override defaults.
- **Consumers:** `inventory-utils.ts` (`getRisk`, `computeRiskLevel`), reorderEngine, dashboard.

### R-A3 Reorder & overstock dollars
- **Logic:** reorder $ = `suggested_order_cases × unit_cost` (missing cost → $0, flagged). overstock $ = `max(stock − par, 0) × unit_cost` (par ≤ 0 → 0).
- **Consumers:** `casePlanningEngine.ts`, `reorderEngine.ts`, `dashboardSelectors.ts`, `dashboardTrustFormulas.ts`.

### R-A4 Vendor selection gate (single vendor)
- **Trigger:** Smart Order submit pre-check.
- **Logic:** block if >1 distinct non-empty vendor among order lines; block if no resolvable vendor (line vendor or list fallback).
- **Consumers:** `smartOrderVendor.ts` → `SmartOrder.tsx`.

### R-A5 Latest invoice cost lookup
- **Logic:** sort invoice lines by recency; first-seen `unit_cost` per `catalog_item_id` wins → `Map<catalogId, unitCost>`.
- **Consumers:** `invoiceCostLookup.ts` → SmartOrder cost display.

---

## B. PAR

### R-B1 PAR guide map build
- **Logic:** keep finite `par_level > 0`; build maps keyed by `catalog_item_id` and by normalized `item_name`.
- **Consumers:** `parGuideLevels.ts`.

### R-B2 PAR resolution precedence
- **Logic:** (1) guide by catalog id → (2) guide by normalized name → (3) session line PAR → (4) catalog default PAR (non-counting-guide path) → (5) 0 / no_par.
- **Consumers:** `parGuideLevels.ts`, `items/itemView.ts`, `sessionSelectors.ts`.

### R-B3 PAR health categorization
- **Logic:** missing PAR (`type/risk_type == missing_par`); likely-too-low (increase/usage_trend/stockout); likely-too-high (decrease/overstock).
- **Consumers:** `parHealth.ts` → `PARSuggestions.tsx`.

### R-B4 Catalog default PAR sync
- **Logic:** prefer valid `catalog_item_id`; else normalized-name match to catalog rows; dedupe by catalog id (first wins) → `{catalogId, parLevel}[]`.
- **DB:** updates `inventory_catalog_items.default_par_level`.
- **Consumers:** `catalogParSync.ts` → `PARManagement.tsx`.

---

## C. Inventory sessions & zones

### R-C1 Session status lifecycle
- **States:** `IN_PROGRESS → IN_REVIEW → APPROVED` (enum `session_status`). Optimistic updates enforce expected current status. Approval only from IN_REVIEW.
- **DB:** `inventory_sessions.status`.
- **Consumers:** `sessionWorkflow.ts`, `useSessionCommands.ts`, `approve_inventory_session_atomic`.

### R-C2 Reopen policy (approved → review)
- **Logic:** if any downstream smart-order runs / POs / invoices / low-stock notifications exist → block unless explicit override.
- **Consumers:** `sessionWorkflow.ts` → `Approved.tsx`.

### R-C3 Approval duplicate-line guard
- **Logic:** duplicate if same non-empty `vendor_sku`; name-only dedupe only when both rows lack SKU; blocks approval with detail.
- **Consumers:** `sessionWorkflow.ts`.

### R-C4 Zone quantity normalization
- **Logic:** entered unit must equal planning unit or base count unit; planning unit passthrough; base unit → divide by `units_per_planning_unit`; reject negative/non-finite.
- **DB:** `inventory_session_item_zones.normalized_qty`.
- **Consumers:** `zoneCounting.ts`, `inventoryZoneWritePipeline.ts`.

### R-C5 Parent stock reconciliation
- **Logic:** if zone rows exist, parent `current_stock` = Σ normalized rows; else legacy stock.
- **Consumers:** `zoneCounting.ts`, `zoneReconcile.ts`.

### R-C6 First-zone legacy-override ack
- **Logic:** first zone write on a line with non-zero legacy total is blocked unless `acknowledgeReplacesLegacyTotal = true`.
- **Consumers:** `zoneReconcile.ts`.

### R-C7 Approved-count immutability (UI)
- **Logic:** IN_REVIEW & APPROVED lock stock/price/add/delete/zone writes in command handlers. Server-side item immutability is **NOT VERIFIED** as DB-enforced (relies on RLS + approval flow).

---

## D. Invoices — matching, variance, receiving

### R-D1 Strict auto-match (intake)
- **Logic:** `MANUAL` → skip; already `MATCHED+id` → skip; explicit `catalog_item_id` wins; else SKU path only (unique vendor-mapping SKU or unique catalog SKU).
- **Consumers:** `resolveInvoiceLineCatalogMatch.ts`, `strongMatchInvoiceItems.ts`.

### R-D2 Review matching (extended)
- **Logic:** strict SKU → exact vendor item-name mapping (unique) → unique normalized catalog name.
- **Consumers:** `resolveInvoiceLineCatalogMatch.ts`, `buildComparisonRows.ts`.

### R-D3 Comparison row construction
- **Logic:** unresolved catalog → `unmatched`; real lines auto-fill `received_qty = invoiced_qty`, `received_qty_confirmed=false`; derive status; add synthetic `missing_from_invoice` rows for PO lines with qty>0 absent on invoice; duplicate PO catalog ids summed only if same/null unit cost.
- **DB:** inserts `invoice_line_comparisons`.
- **Consumers:** `buildComparisonRows.ts`, `insertComparisonRows.ts`.

### R-D4 Variance tolerances & status precedence
- **Tolerances:** qty (0.01 abs, 0.5%), price (0.01 abs, 1%), total (1 abs, 1%). Variance only when `absDiff > minAbs` **and** `%diff > pct`.
- **Precedence:** `received_short/received_over` → `qty_mismatch` → `price_mismatch` → `total_mismatch` → `ok`. Fixed statuses (`missing_from_invoice`, `extra_on_invoice`, `unmatched`) preserved.
- **Consumers:** `lib/invoice-comparison.ts`, `invoiceReviewSelectors.ts`.

### R-D5 Receiving qty → cases normalization
- **Logic:** case aliases passthrough; LB → `qty/totalPerCase`; OZ → `(qty/16)/totalPerCase`; each/count → `qty/unitsPerCase`; unknown unit or missing divisor → fail; round 4dp.
- **Consumers:** `receivingEngine.ts`; DB mirror `normalize_received_qty_to_cases` RPC.

### R-D6 Receipt confirm gate
- **Logic:** block confirm if any real line (`invoiced_qty>0`, not `missing_from_invoice`) has null `received_qty` or unconfirmed auto-filled qty.
- **Consumers:** `receivingEngine.ts` → `useInvoiceReviewActions.ts` → `confirm_invoice_receipt`.

### R-D7 Fixed-status persistence guard
- **Logic:** only persist derived status when current status is null or not in the fixed set.
- **Consumers:** `invoiceStatusLifecycle.ts` (also duplicated inline in `useInvoiceReviewActions.ts`).

### R-D8 Invoice save/intent rules
- **Logic:** line total = explicit else `unit_cost*qty`; vendor match for PO-linking = exact or substring (shorter length ≥3); intent `RECEIVED` → workflow `review`/receipt `reviewing`, else draft/pending.
- **Consumers:** `invoicesPageHelpers.ts`, `useInvoiceActions.ts`.

### R-D9 Weight-priced unit cost correction (edge)
- **Logic:** corrects unit cost for weight-priced lines and derives totals when missing.
- **Consumers:** `_shared/resolveInvoiceUnitCost.ts` (edge).

---

## E. Dashboard trust & KPIs

### R-E1 Inventory KPI source of truth
- **Logic:** latest `APPROVED` session only; compute snapshot/reorder/overstock/missing from its items (dedupe duplicate catalog rows by summing stock).
- **Consumers:** `loadInventoryMetrics.ts`, `dashboardSelectors.ts`.

### R-E2 Spend & price-increase metrics
- **Logic:** period spend from line-item totals; delivery-issue count from problem statuses; price impact = `max(invoiced−po,0) × min(invoiced_qty, po_qty)` + PRICE_INCREASE notifications.
- **Consumers:** `loadSpendMetrics.ts`, `priceIncreaseFromNotifications.ts`.

### R-E3 Food cost %
- **Logic:** no location or no spend → null; else `(periodSpend / grossSales) × 100`; status bands `<28 under`, `>32 over`, else `at`; target loaded from `location_settings.food_cost_target_pct`.
- **Consumers:** `loadFoodCostMetrics.ts`.

### R-E4 Waste / shrinkage / overstock / profit leaks
- **Logic:** waste = canonical row valuation (R-F1); shrinkage = Σ notification `dollar_impact`; overstock = latest approved session; profit leaks = top-5 aggregate of waste + price-hike + overstock + shrinkage (partial-tolerant).
- **Consumers:** `loadWasteMetrics.ts`, `loadShrinkageValue.ts`, `loadOverstockItems.ts`, `loadProfitLeaks.ts`.

### R-E5 Trust totals
- **Logic:** money-lost = waste + price-increase + overstock + shrinkage; savings banner = overstock + waste + price-increase; trust potential savings = overstock + waste + invoice-issues + price-hike.
- **Consumers:** `dashboardTrustFormulas.ts`, `kpiExplainBuilders.ts`, `AuditCenter.tsx`.

### R-E6 Snapshot assembly (loud-fail)
- **Logic:** per-loader error preserved as KPI error flag; never render confident `$0` on error.
- **Consumers:** `buildDashboardSnapshot.ts`, `useDashboardData.ts`.

### R-E7 Data-quality score
- **Logic:** start 100; deduct weighted penalties for stale counts, missing PAR/cost, absent spend/sales, pending invoices, delivery issues, shrinkage; clamp 0–100; map to bands.
- **Consumers:** `computeDataQualityScore.ts` → `DataQualityBanner`, `AuditCenter`.

### R-E8 KPI confidence
- **Logic:** rule-based high/medium/low per KPI from freshness, missing cost/PAR, approved-count presence.
- **Consumers:** `computeKpiConfidence.ts` → explainability sheets.

---

## F. Waste

### R-F1 Waste dollar valuation hierarchy
- **Logic:** (1) `total_cost` always trusted → (2) `unit_cost × qty` (case-unit rows) → (3) catalog default × qty (case-unit) → (4) latest session cost × qty (case-unit) → else 0.
- **Consumers:** `recordedWasteValue.ts`, `wasteMetricsAggregate.ts`, `wasteDrilldownRows.ts`.

### R-F2 Missing-cost detection
- **Logic:** non-case rows require `total_cost`; case rows may use fallbacks.
- **Consumers:** same as R-F1.

---

## G. Notifications / alerts

### R-G1 Member notification allowlist (RPC-only)
- **Logic:** only `PAR_CHANGE_REQUEST`, `PRICE_CHANGE_REQUEST`, `PAR_SUGGESTIONS`, `LOW_STOCK` via `create_member_notifications`; recipient must be a member.
- **Consumers:** `createMemberNotifications.ts`, `useManagerCommands.ts`, `smartOrderFromSession.ts`.

### R-G2 Low-stock attention alert
- **Logic:** on smart-order create/approve when red/yellow>0; severity CRITICAL if any red else WARNING; recipients from preferences mode.
- **Consumers:** `smartOrderFromSession.ts`.

### R-G3 App-event notifications (fire-and-forget)
- **Logic:** invoke `dispatch-app-notifications`; errors logged, never block.
- **Consumers:** `dispatchAppNotifications.ts`.

### R-G4 Cron alert rules (edge)
- **Logic (in `process-notifications`):** low-stock from approved session vs thresholds; count reminders/overdue from `reminders`/`location_settings`; digests by `notification_preferences.digest_hour`; shrink/variance; weekly loss digest; price-hike emails. Timezone via **fixed offsets (no DST)**.

---

## H. Sales

### R-H1 Sales validation & upsert
- **Logic:** non-negative; weekly upsert on `(location_id, week_start)` (`entry_method=manual_weekly`); daily upsert on `(location_id, sale_date)` (`manual_daily`); daily→weekly aggregation trigger.
- **Consumers:** `upsertSales.ts`, `loadSalesForWeek.ts`, `Sales.tsx`.

---

## I. Catalog identity & conversions

### R-I1 Catalog identity key
- **Logic:** `catalog:<id>` if id, else `name:<normalized>`; normalized = trimmed lowercase.
- **Consumers:** `catalog-identity.ts`, `usage-analytics.ts`.

### R-I2 Session item catalog link fallback
- **Logic:** direct `catalog_item_id` → else `metadata.catalog_item_id`.
- **Consumers:** `sessionItemCatalogLink.ts`.

### R-I3 Pack parsing
- **Logic:** normalize freeform `pack_size` into `PackStructure` (`unitsPerCase`, `totalPerCase`, …); success/failure with safe defaults; `pack_parse_success` stored on catalog.
- **Consumers:** `pack-parser.ts`, `receivingEngine.ts`, `inventory-conversions.ts`.

### R-I4 Unit-to-case conversion
- **Logic:** cases passthrough; units → `/unitsPerCase`; weight → `/totalPerCase`; reject invalid/missing divisor.
- **Consumers:** `inventory-conversions.ts`, `UniversalCountInput.tsx`, `WasteLog.tsx`.

---

## J. Permissions & entitlement

### R-J1 UI permission resolution
- **Logic:** OWNER → all flags true (hard-coded); MANAGER/STAFF → flags from `user_location_assignments`. **UI-only** — not read by RLS/RPC.
- **Consumers:** `useLocationPermissions.ts`.

### R-J2 Order approval limit (server, RPC)
- **Logic:** `submit_smart_order` computes order amount from DB rows and checks `can_approve_order_amount` before creating PO.
- **DB:** `can_approve_order_amount` reads `order_approval_threshold`.

### R-J3 Subscription entitlement (single source of truth)
- **Precedence:** LEGACY (created before `2027-01-01` cutoff & no Stripe sub) → grandfathered (covered forever); `active` → covered; `past_due`/`canceled` → read-only; trial not expired → trialing (covered); expired → read-only.
- **State:** enforcement OFF; nothing acts on `readOnly`.
- **Consumers:** `resolveEntitlement.ts`, `useSubscription.ts`, `TrialBanner`, `Billing`.

---

## Notes on rule integrity
- **One-source-of-truth discipline is mostly upheld** (risk, reorder, valuation, entitlement each centralized).
- **Duplicated logic** found: invoice fixed-status guard (R-D7) duplicated in hook.
- **Dead rule:** `buildMoneyLeakSnapshot` (reports) unused at runtime.
- **Recipe cost engine** (`recipeCostEngine`) mostly unused since recipe tables were dropped.
