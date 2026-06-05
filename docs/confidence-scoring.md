# KPI Confidence Scoring

Module: `src/domain/dataQuality/computeKpiConfidence.ts`

Purpose: per-KPI **High / Medium / Low** confidence shown next to major financial cards. Complements data quality score (restaurant-wide) with metric-specific trust.

---

## Factors (implemented)

### Inventory value

| Factor | High | Medium | Low |
|--------|------|--------|-------|
| Approved session exists | yes | — | no session |
| Count age | ≤3 days | 4–7 days | >7 days or never |
| Cost coverage | 0 missing costs | 1–3 missing | >3 missing |

### Overstock value

| Factor | High | Medium | Low |
|--------|------|--------|-------|
| PAR configured | >0 items with par>0 | some no-PAR | all no-PAR |
| Cost coverage | same as inventory | | |
| Count freshness | ≤7 days | 8–14 days | stale / none |

### Reorder gap ($)

| Factor | High | Medium | Low |
|--------|------|--------|-------|
| Cost on reorder lines | all lines priced | some missing | many missing |
| PAR coverage | >80% items with PAR | 50–80% | <50% |

### Waste / price hike / shrinkage (period KPIs)

| Factor | High | Medium | Low |
|--------|------|--------|-------|
| Time filter data | rows in period | sparse | zero rows but UI >0 (should not happen) |
| Waste cost reliability | 0 missing-cost waste rows | some | many |
| Price hikes | from notifications + comparisons | notifications only | no PO baseline |

### Food cost %

| Factor | High | Medium | Low |
|--------|------|--------|-------|
| Weekly sales entered | yes | — | null |
| Spend in period | yes | — | zero |

---

## Output

```typescript
type ConfidenceLevel = "high" | "medium" | "low";

type KpiConfidence = {
  level: ConfidenceLevel;
  reasons: string[];
};
```

---

## UI

`KpiConfidenceBadge` in `src/components/explainability/KpiConfidenceBadge.tsx` — small pill next to KPI label. Tooltip lists reasons.

Integrated on Today tab KPI cards: Inventory value, Reorder needed, Food cost (when visible).

---

## Mapping to owner trust (6/10 → 9/10)

| Today (6/10) | With confidence (9/10) |
|--------------|------------------------|
| Big dollar number, no context | Number + High/Med/Low + “View math” |
| Hidden missing costs | Badge drops to Medium with reason |
| Stale count invisible | Low confidence + “Last count 12d ago” |

---

## Risks

| Risk | Mitigation |
|------|------------|
| Badge fatigue | Only on top 4 financial KPIs |
| False High when data wrong | Human audit CI catches formula drift |
| Duplicates data quality score | Score = holistic; confidence = per KPI |

---

## Effort

| Task | Estimate |
|------|----------|
| Domain functions (done) | 1 d |
| Badge component (done) | 0.5 d |
| Wire all widgets | 1 d |
| Tune thresholds with real restaurants | 2 d |
