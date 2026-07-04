# Owner Audit Center

Route: **Settings → Audit Center** (`/app/settings/audit`)

Purpose: let restaurant owners **independently verify** every important dashboard number without reading code or SQL.

---

## Access

- **Role:** Owner only (same gate as Locations / Team)
- **Nav:** Settings sidebar — “Audit Center” with Shield icon
- **File:** `src/pages/app/settings/AuditCenter.tsx`

---

## Screen layout

### 1. Data quality summary (top)

- Score 0–100 with band (Excellent / Good / Medium / Low)
- Bullet list of active issues from `computeDataQualityScore`
- Last approved count date and age in days

### 2. KPI verification table

Each row:

| Column | Source |
|--------|--------|
| Metric | KPI name (matches `docs/kpi-definitions.md`) |
| Current value | From dashboard snapshot props / live reload |
| Formula | Plain-English formula string |
| Source tables | Comma-separated tables |
| Last updated | Session `approved_at` or “Period: {filter}” |
| Confidence | High / Medium / Low badge |

Rows included (v1):

- Inventory value
- Overstock exposure
- Reorder gap ($)
- Critical low stock count
- Recorded waste (period)
- Price increase impact (period)
- Shrinkage (period)
- Money Lost total
- Food cost % (if unlocked)
- Period spend

### 3. View Math (per row)

Opens `KpiExplainSheet` with:

- Source data lines (when available from snapshot)
- Formula
- Calculation steps
- Confidence reasons

---

## Data loading

Audit Center reuses **`useDashboardData`** with current restaurant, location, and `this_week` filter — same path as Dashboard. No duplicate loaders.

---

## Owner workflow

1. Open Audit Center after approving a count.
2. Confirm data quality ≥ 80.
3. Expand any Medium/Low confidence KPI → View Math.
4. Cross-check against physical walk-in (optional human process).

---

## Relation to CI human audit

| Owner Audit Center | CI `human-dashboard-trust-flow.spec.ts` |
|--------------------|----------------------------------------|
| Interactive, same restaurant | Automated UI vs Supabase expected |
| On-demand | Every CI run (strict mode) |
| Plain language | Machine-readable report |

Reports: `dashboard-trust-human-audit-report.md` (owner-readable section in Phase 6).

---

## Future (not v1)

- Export PDF audit packet for accountants
- Email weekly trust summary
- Historical score trend

---

## Risks

| Risk | Mitigation |
|------|------------|
| Owners overwhelmed by table | Collapse advanced KPIs; lead with quality score |
| Values drift from Dashboard | Single `useDashboardData` source |
| Non-owners want access | Manager read-only in phase 2 |
