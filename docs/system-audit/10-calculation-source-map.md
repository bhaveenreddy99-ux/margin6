# 10 — Calculation Source Map

One source of truth assessment for each important number.

| Metric | Canonical function | File | Duplicates / wrappers | SQL duplicate? |
|--------|-------------------|------|----------------------|----------------|
| **Suggested order qty (cases)** | `computeSuggestedOrderCases` | `domain/inventory/casePlanningEngine.ts` | `computeOrderQtyCases` in `lib/inventory-utils.ts` (same formula) | No |
| **Inventory line value** | `computeLineInventoryValue` | `casePlanningEngine.ts` | `dashboardTrustFormulas.computeInventoryLineValue` | No |
| **Overstock $** | `computeLineOverstockValue` | `casePlanningEngine.ts` | `reorderEngine.computeWasteValue` (misnamed), `dashboardTrustFormulas` | No |
| **Reorder $** | `computeLineReorderValue` | `casePlanningEngine.ts` | `computeReorderSummary` in `reorderEngine.ts` | No |
| **Session aggregates** | `computeReorderSummary` | `reorderEngine.ts` | `computeSessionPlanningAggregate` (test-only path) | No |
| **PAR level** | `resolveParLevelFromGuideMaps` | `parGuideLevels.ts` | `getApprovedPar` in itemView | No |
| **Zone → stock** | `sumZoneRowsToCurrentStock` | `zoneCounting.ts` | Legacy direct stock writes | No |
| **Base unit conversion** | `normalizeZoneQtyToPlanningUnit` | `zoneCounting.ts` | `planningUnitMeta.ts` pack parsing | No |
| **Received qty (cases)** | `normalizeReceivedQuantityToCases` | `receivingEngine.ts` | SQL `normalize_received_qty_to_cases` | **Yes — TS + SQL** |
| **Three-way variance** | `computeThreeWayVariance` | `receivingEngine.ts` | Comparison status in `invoice-comparison.ts` | Partial overlap |
| **Recorded waste $** | `dollarsForWasteRow` | `waste/recordedWasteValue.ts` | `wasteMetricsAggregate` delegates | No |
| **Price hike $ (notifications)** | `priceIncreaseDollarImpact` | `priceIncreaseFromNotifications.ts` | `linePriceIncreaseImpact` in dashboardSelectors (comparison path) | **Two paths** |
| **Shrinkage $** | Sum `dollar_impact` | `loadShrinkageValue.ts` | Duplicated query in `ShrinkageAlertCard.tsx` | **UI duplicate fetch** |
| **Food cost % (dashboard)** | `(periodSpend/sales)*100` | `loadFoodCostMetrics.ts` | `dashboardTrustFormulas.computeFoodCostPct` | No |
| **Food cost % (recipes)** | `computeFoodCostPct` | `recipeCostEngine.ts` | **Dead** — tables dropped | N/A |
| **Profit Risk total** | Sum 4 components | `ProfitRiskWidget.tsx` | `computeMoneyLostTotal` wrapper | No |
| **Approval threshold** | Hook + RPC | `useLocationPermissions`, `can_approve_order_amount` | Parity test pins contract | **TS + SQL aligned** |
| **KPI confidence** | `computeInventoryValueConfidence` etc. | `dataQuality/computeKpiConfidence.ts` | — | No |
| **Data quality score** | `computeDataQualityScore` | `dataQuality/computeDataQualityScore.ts` | — | No |
| **Smart order vendor block** | `analyzeVendorBlockForSubmit` | `ordering/smartOrderVendor.ts` | Inline checks in SmartOrder.tsx | Partial |
| **Invoice comparison status** | `deriveInvoiceComparisonStatus` | `lib/invoice-comparison.ts` | `buildDerivedComparisonRows` | No |
| **Money leak snapshot** | `buildMoneyLeakSnapshot` | `reports/buildMoneyLeakSnapshot.ts` | Delegates to dashboard loaders | No |

---

## Risk categories

### Duplicated logic (action needed)

1. **Order qty:** `computeOrderQtyCases` vs `computeSuggestedOrderCases` — consolidate to casePlanningEngine
2. **Price impact:** notification path vs comparison path — document when each applies; dedupe dashboard
3. **Shrinkage:** loader vs ShrinkageAlertCard inline query
4. **Received qty normalization:** TS `receivingEngine` + SQL RPC — must stay in sync (parity test gap)

### Inline page calculations

- `SmartOrder.tsx` — risk display, totals (uses domain imports but large inline orchestration)
- `Dashboard.tsx` — display formatting, some derived display state via selectors (acceptable)

### Floating-point / rounding

- Currency display via `formatCurrency` / `formatNum`
- Numeric columns in Postgres `numeric` type
- No verified penny-rounding policy document

### Null → zero behavior

- `loadInventoryMetrics`: empty approved session → zero metrics (may show $0 without error — baseline issue)
- `computeReorderSummary`: null par → NO_PAR band
- Waste: `dollarsForWasteRow` returns null if no cost → excluded from sums

### Location filtering

- Dashboard loaders accept `locationId` optional — **bug suspected** when mismatch with approved session location (DEF-LOCAL-002)
- `withLocationOrNull` helper used inconsistently

### Double-counting

- Spend loader merges invoices + purchase_history — intentional legacy
- Hero total sums waste + price + overstock + shrinkage — mutually exclusive categories by design

---

## Profit Risk Identified formula (canonical UI)

```
Profit Risk Identified =
  recordedWasteValue
  + priceIncreaseImpact
  + overstockValue
  + shrinkageValue
```

Source: `ProfitRiskWidget.tsx` + `dashboardTrustFormulas.computeMoneyLostTotal`

**Excludes:** reorder needed $, pending invoice $ (not in hero)

---

## Inventory value formula

```
Σ (current_stock_cases × unit_cost_per_case) over latest APPROVED session items
```

Source: `buildLatestInventorySnapshot` → `computeLineInventoryValue` in `dashboardSelectors.ts` + `loadInventoryMetrics.ts`

---

## Overstock formula

```
max(stock - par, 0) × unit_cost  per line, summed
```

Source: `computeLineOverstockValue` in `casePlanningEngine.ts`
