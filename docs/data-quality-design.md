# Data Quality Design

Pure domain module: `src/domain/dataQuality/computeDataQualityScore.ts`

Purpose: give owners a **0–100 score** explaining why dashboard numbers may be incomplete or stale. No new data sources — inputs come from existing dashboard snapshot fields and loader outputs.

---

## Inputs (all from production today)

| Signal | Source in code | Table / field |
|--------|----------------|---------------|
| Last count age (days) | `loadInventoryMetrics.lastSessionDate` | `inventory_sessions.approved_at` |
| Missing PAR count | `missingParCount` | `inventory_session_items.par_level` |
| Missing cost count | `missingCostCount` | `inventory_session_items.unit_cost` |
| Missing vendor on catalog | Future: catalog query | `inventory_catalog_items.vendor_name` |
| Missing weekly sales | `weeklyGrossSales == null` when spend > 0 | `weekly_sales` |
| Unreviewed invoices | `pendingInvoices` + `invoicePendingReview` | `invoices.status` |
| Count variance alerts | shrinkage notifications in period | `notifications` |
| No approved session | `lastSessionDate == null` | `inventory_sessions` |

---

## Scoring model (implemented)

Start at **100**. Subtract weighted penalties (floor at 0):

| Penalty | Max deduction | Trigger |
|---------|---------------|---------|
| Stale count | 25 | No session: −25; >7 days: −20; >3 days: −10 |
| Missing PAR | 20 | `min(20, missingParCount × 2)` |
| Missing cost | 20 | `min(20, missingCostCount × 2)` |
| No sales for food cost | 10 | `periodSpend > 0` and no `weeklyGrossSales` |
| Pending invoice review | 15 | `min(15, pendingReview × 3)` |
| Delivery issues | 10 | `deliveryIssuesCount > 0` → −10 |
| Shrinkage alerts | 5 | `shrinkageValue > 0` → −5 |

---

## Bands

| Score | Label | Owner message |
|-------|-------|---------------|
| 95–100 | Excellent | Numbers reflect fresh counts and complete catalog data. |
| 80–94 | Good | Minor gaps — review missing PAR or costs. |
| 60–79 | Medium | Some KPIs may understate exposure — count or invoice review recommended. |
| 0–59 | Low confidence | Do not use dollar KPIs for decisions until count and PAR are complete. |

---

## Dashboard display

`DataQualityBanner` on Dashboard Today tab (`Dashboard.tsx`) shows score, band, and top 3 issues. Does not block KPIs — informational only.

---

## API shape

```typescript
type DataQualityResult = {
  score: number;
  band: "excellent" | "good" | "medium" | "low";
  issues: Array<{ code: string; message: string; deduction: number }>;
};
```

---

## Risks

| Risk | Mitigation |
|------|------------|
| Weights feel arbitrary | Document in Audit Center; tune from owner feedback |
| Vendor-missing not yet wired | Phase 2 query in `computeDataQualityScore` |
| Multi-location portfolio | Score computed per active location context only |

---

## Effort

| Task | Estimate |
|------|----------|
| Domain scorer (done) | 0.5 d |
| Dashboard banner | 0.5 d |
| Audit Center integration | 0.5 d |
| Vendor-missing signal | 1 d |
