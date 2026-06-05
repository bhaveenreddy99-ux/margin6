# Dashboard KPI Definitions

Every KPI below is traced to **production code** in this repository. Formulas describe **implemented behavior**, not idealized product copy.

**Orchestration:** `useDashboardData` → parallel loaders → `buildDashboardSnapshot` → `Dashboard.tsx` + widgets.

**Time filter:** `dashboardSpendRangeFromFilter` (`src/domain/dashboard/dashboardSelectors.ts`) — `this_week` | `last_week` | `30_days`.

**Inventory snapshot:** Latest `inventory_sessions` row where `status = 'APPROVED'`, scoped by restaurant + optional location (`withLocationOrNull` includes `location_id IS NULL`).

**Canonical case math:** `src/domain/inventory/casePlanningEngine.ts` — stock/PAR in **cases**, `unit_cost` = **$/case**, `Math.ceil` for order qty, `round2` for line dollars.

---

## 1. Money Lost This Period (hero total)

| Field | Detail |
|-------|--------|
| **UI** | `MoneyLostWidget` — Today tab hero (`src/components/MoneyLostWidget.tsx:157`) |
| **Loader** | Composite from `useDashboardData` / `buildDashboardSnapshot` |
| **Source tables** | `waste_log`, `notifications`, `invoice_line_comparisons`, `inventory_session_items` (via overstock) |
| **Business logic** | Sum four period/snapshot components shown as sub-rows |
| **Formula** | `total = recordedWasteValue + priceIncreaseImpact + overstockValue + shrinkageValue` |
| **Expected output** | Whole dollars in UI (`maximumFractionDigits: 0`) |
| **Code** | `MoneyLostWidget.tsx:62–63`, `dashboardTrustFormulas.ts:111–122` |

**Important:** Overstock uses **latest approved count**, not period-filtered. Waste, price hikes, and shrinkage use the active time filter.

---

## 2. Waste (recorded waste value)

| Field | Detail |
|-------|--------|
| **UI** | Money Lost row “Waste”; P&L “Recorded waste value” |
| **Loader** | `loadWasteMetrics` → `aggregateWasteRows` → `dollarsForWasteRow` |
| **Source tables** | `waste_log`, `inventory_catalog_items`, latest session `unit_cost` by catalog |
| **Query** | `waste_log` where `logged_at` in `[startDate, endDate]`; optional location scope |
| **Formula** | Per row: (1) `total_cost` if valid; (2) else if case unit: `unit_cost × quantity`; (3) else catalog/session default × qty; else 0. Sum = `recordedWasteValue` |
| **Code** | `loadWasteMetrics.ts`, `recordedWasteValue.ts:28–61`, `wasteMetricsAggregate.ts:16–29` |

---

## 3. Price increase impact

| Field | Detail |
|-------|--------|
| **UI** | Money Lost “Price hikes”; `PriceHikeAlertsCard`; P&L “Price increase impact” |
| **Loader** | `loadSpendMetrics` |
| **Source tables** | `invoice_line_comparisons`, `notifications` (`PRICE_INCREASE`), `invoices` |
| **Formula** | `Σ linePriceIncreaseImpact(comparison)` where `(invoiced_cost - po_cost) × min(invoiced_qty, po_qty)` if invoiced > po; plus `Σ (new_cost - old_cost) × 1` from PRICE_INCREASE notifications in period |
| **Code** | `loadSpendMetrics.ts:157–184`, `dashboardSelectors.ts:127–145`, `priceIncreaseFromNotifications.ts:61–104` |

---

## 4. Overstock value

| Field | Detail |
|-------|--------|
| **UI** | Money Lost “Overstock”; P&L “Overstock exposure”; `OverstockCashTrapCard` |
| **Loader** | `loadInventoryMetrics` → `buildLatestInventorySnapshot` → `reorderSummary.totalWasteValue` |
| **Source tables** | `inventory_sessions`, `inventory_session_items`, `smart_order_settings` |
| **Formula** | Zone-deduped by `catalog_item_id`. Per line: `max(0, stock - par) × unit_cost` via `computeLineOverstockValue`; `par ≤ 0` or null cost → $0 |
| **Expected output** | Sum of line overstock dollars (rounded per line) |
| **Code** | `casePlanningEngine.ts:134–148`, `reorderEngine.ts:111–150`, `dashboardSelectors.ts:235–255` |

**Note:** `loadOverstockItems` lists items without zone dedupe — card line totals may differ slightly from hero aggregate.

---

## 5. Shrinkage value

| Field | Detail |
|-------|--------|
| **UI** | Money Lost “Shrinkage”; `ShrinkageAlertCard` |
| **Loader** | `loadShrinkageValue` |
| **Source tables** | `notifications` where `type IN ('SHRINK_ALERT', 'COUNT_VARIANCE')` |
| **Formula** | `Σ Number(data.items[].dollar_impact)` where impact > 0, `created_at` in period |
| **Code** | `loadShrinkageValue.ts:16–44` |

---

## 6. Critical low stock count

| Field | Detail |
|-------|--------|
| **UI** | Today KPI “Critical low stock items”; Reports “Critical Items” |
| **Loader** | `reorderSummary.redCount` from latest approved session |
| **Source tables** | `inventory_session_items`, `smart_order_settings` |
| **Formula** | Count lines where `computeRiskLevel` = `RED`: stock ≤ 0 OR `(stock/par)×100 < red_threshold` (default 50%) |
| **Expected output** | Integer count |
| **Code** | `inventory-utils.ts:78–122`, `reorderEngine.ts:133–135`, `Dashboard.tsx:1432–1437` |

---

## 7. Reorder needed today (dollars)

| Field | Detail |
|-------|--------|
| **UI** | Today KPI “Reorder needed today” |
| **Loader** | `reorderSummary.totalReorderValue` |
| **Source tables** | Latest approved `inventory_session_items` |
| **Formula** | `Σ ceil(max(par - stock, 0)) × unit_cost` per line; null cost → $0 |
| **Code** | `casePlanningEngine.ts:80–86, 116–124`, `reorderEngine.ts:125–130` |

---

## 8. Inventory value

| Field | Detail |
|-------|--------|
| **UI** | Today KPI “Inventory value”; Reports summary |
| **Loader** | `buildLatestInventorySnapshot.inventoryValue` |
| **Source tables** | Latest approved `inventory_session_items` (zone-deduped) |
| **Formula** | `Σ round2(stock × unit_cost)`; null cost excluded from dollars |
| **Code** | `dashboardSelectors.ts:235–243`, `casePlanningEngine.ts:103–107` |

---

## 9. Food cost this period

| Field | Detail |
|-------|--------|
| **UI** | Today KPI “Food cost this period” (permission-gated) |
| **Loader** | `loadFoodCostMetrics` |
| **Source tables** | `weekly_sales`, `location_settings`, period spend from invoices |
| **Formula** | `null` if no location, `periodSpend ≤ 0`, or no gross sales; else `(periodSpend / grossSales) × 100` |
| **Code** | `loadFoodCostMetrics.ts:76–111` |

---

## 10. Period spend

| Field | Detail |
|-------|--------|
| **UI** | Spend Overview card |
| **Loader** | `loadSpendMetrics` → `fetchSpendOverviewData` |
| **Source tables** | `invoices`, `invoice_items`, `purchase_history`, `purchase_history_items` |
| **Formula** | Sum line `total_cost` for confirmed invoices + deduped purchase history in date window |
| **Code** | `loadSpendMetrics.ts:34–192` |

---

## 11. Delivery issues count

| Field | Detail |
|-------|--------|
| **UI** | Action Center; P&L “Unresolved delivery issues” |
| **Loader** | `loadSpendMetrics.deliveryIssuesCount` |
| **Source tables** | `invoices.receipt_status`, `invoice_line_comparisons` |
| **Formula** | Unique invoice IDs with `receipt_status = 'issues_reported'` OR problem comparison rows in period |
| **Code** | `dashboardSelectors.ts:102–125, 437–451` |

---

## 12. Potential savings banner

| Field | Detail |
|-------|--------|
| **UI** | P&L Intelligence green banner |
| **Loader** | Inline in `ProfitLossIntelligence` |
| **Formula** | `overstockValue + recordedWasteValue + priceIncreaseImpact` (**excludes shrinkage**) |
| **Code** | `Dashboard.tsx:727`, `dashboardTrustFormulas.ts:125–132` |

---

## 13. Top profit leaks

| Field | Detail |
|-------|--------|
| **UI** | `ProfitLeaksCard` |
| **Loader** | `loadProfitLeaks` — top 5 (item, reason) by dollars |
| **Source tables** | `waste_log`, `invoices`, `invoice_line_comparisons`, `notifications`, `inventory_session_items` |
| **Formula** | Separate buckets per reason; waste uses simpler cost logic than dashboard waste KPI |
| **Code** | `loadProfitLeaks.ts:48–318` |

---

## 14. Missing PAR / missing cost counts

| Field | Detail |
|-------|--------|
| **UI** | Alert banner; reorder KPI footnote |
| **Loader** | `missingParCount`, `missingCostCount` from inventory snapshot |
| **Formula** | PAR missing if null/≤0/NaN; cost missing if `unit_cost == null` |
| **Code** | `dashboardSelectors.ts:81–85, 245–246` |

---

## 15. Inventory value trend

| Field | Detail |
|-------|--------|
| **UI** | Reports / Analytics chart |
| **Loader** | `buildInventoryTrendData` on last 8 approved sessions |
| **Formula** | Per session: `Σ stock × unit_cost` (**not zone-deduped**) |
| **Code** | `loadInventoryMetrics.ts:145–177`, `dashboardSelectors.ts:285–307` |

---

## Known implementation inconsistencies (audit findings)

| Issue | KPIs affected |
|-------|----------------|
| Overstock dedupe differs | Money Lost hero vs `OverstockCashTrapCard` list |
| Waste cost logic differs | `loadWasteMetrics` vs `loadProfitLeaks` waste bucket |
| Shrinkage scope differs | Money Lost total vs `ShrinkageAlertCard` (last 10 notifs) |
| P&L savings omits shrinkage | Banner vs Money Lost hero |
| Reports copy hardcodes 50%/100% | Actual thresholds from `smart_order_settings` |

See `docs/dashboard-label-audit.md` for label recommendations.
