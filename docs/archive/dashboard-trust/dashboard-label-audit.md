# Dashboard Label Audit

Financial labels affect owner trust. This audit maps **current copy**, **accuracy risk**, and **recommended alternatives**. All locations reference production UI as of this audit.

Risk levels: **High** = likely misread as realized cash loss; **Medium** = scope/timing unclear; **Low** = cosmetic or internal naming.

---

## Hero & aggregate labels

| Current Label | Risk | Recommended Label | Reason |
|---------------|------|-------------------|--------|
| **Money Lost This Period** | **High** | **Profit Risk Identified** or **Exposure This Period** | Total mixes period waste/price/shrinkage with **snapshot** overstock (not time-bound). “Lost” implies cash already gone. |
| estimated loss this period | **High** | estimated exposure this period · tap to see math | Aligns subcopy with non-cash overstock component. |
| No loss data yet | Low | No exposure data yet | Consistent with “risk/exposure” framing. |
| Upload your first invoice to start tracking | Medium | Upload your first invoice to unlock spend and price alerts | Waste/overstock can exist without invoices; copy over-promises invoice dependency. |

---

## Money Lost sub-rows

| Current Label | Risk | Recommended Label | Reason |
|---------------|------|-------------------|--------|
| **Waste** | Medium | **Recorded waste** | Matches `recordedWasteValue`; clarifies logged entries only. |
| **Price hikes** | Low | **Price increase impact** | Aligns with KPI field name and P&L section. |
| **Overstock** | **High** | **Cash tied up above PAR** | Not “lost”—inventory still on hand; PAR required for meaning. |
| **Shrinkage** | Medium | **Variance / shrinkage alerts** | Sourced from notifications, not physical shrink receipts. |
| Set PAR levels for accurate overstock tracking | Low | (keep) | Accurate — without PAR, overstock math is suppressed. |

---

## Today at a glance KPIs

| Current Label | Risk | Recommended Label | Reason |
|---------------|------|-------------------|--------|
| Critical low stock items | Low | (keep) | Matches `redCount` semantics. |
| May stock out soon | Medium | Below reorder threshold | Threshold is configurable, not strictly “stock-out”. |
| Reorder needed today | Medium | **Reorder gap ($)** | Value is dollars to reach PAR, not physical delivery today. |
| Estimated to reach PAR levels | Low | (keep) | Accurate formula description. |
| Inventory value | Low | (keep) | Standard term; add “from last approved count” in subcopy always. |
| Last count | Low | (keep) | Clear operational label. |
| Food cost this period | Low | (keep) | Locked until sales entered — subcopy handles null state. |
| Enter weekly sales to unlock food cost % | Low | (keep) | Honest empty state. |

---

## Profit & Loss Intelligence

| Current Label | Risk | Recommended Label | Reason |
|---------------|------|-------------------|--------|
| Profit & Loss Intelligence | Medium | **Profit Risk Intelligence** | No P&L statement—risk signals only. |
| **potential savings identified this period** | **High** | **Recovery opportunity identified** | Not realized savings; excludes shrinkage; overstock is tied cash not saved. |
| Take Action | Low | Review actions | Softer — avoids implying guaranteed savings. |
| Overstock exposure | Low | (keep) | Better than “overstock loss”. |
| Price increase impact | Low | (keep) | Matches formula. |
| Recorded waste value | Low | (keep) | Matches loader. |
| Unresolved delivery issues | Low | (keep) | Count of invoices, not dollars. |
| ${N} tied up above PAR — pause reorders | Low | (keep) | Accurate economic meaning. |
| Margin6 flagged ${N} in supplier price increases | Low | **RestaurantIQ flagged…** | Brand consistency (product is RestaurantIQ). |
| High Loss Products | **High** | **High-risk items** | Items aren’t necessarily “products” with recipe margin. |

---

## Intelligence cards

| Current Label | Risk | Recommended Label | Reason |
|---------------|------|-------------------|--------|
| Top Profit Leaks | **High** | **Top profit risks** | “Leaks” implies confirmed loss; several buckets are exposure. |
| Cash Frozen in Overstock | Low | (keep) | Honest — cash tied in excess stock. |
| frozen in slow-moving inventory | Medium | frozen above PAR levels | “Slow-moving” not computed — only PAR excess. |
| Price Hike Alerts | Low | (keep) | Clear. |
| Variance & Shrinkage | Medium | **Count variance alerts** | Mixes SHRINK_ALERT and COUNT_VARIANCE notification types. |
| {total} total unaccounted | **High** | **Total flagged variance ($)** | “Unaccounted” is strong; values come from notification estimates. |
| No variance detected — counts are matching expected usage | Medium | No variance alerts this period | Alerts ≠ proof counts match usage. |

---

## Reports tab

| Current Label | Risk | Recommended Label | Reason |
|---------------|------|-------------------|--------|
| Below 50% of PAR level | **High** | Below critical threshold ({N}%) | UI hardcodes 50%; code uses `smart_order_settings.red_threshold`. |
| Between 50–100% of PAR | **High** | Between critical and warning thresholds | Same — use configured thresholds in copy. |
| At or above PAR level | Medium | At or above warning threshold | Green = ≥ yellow threshold, not strictly “at PAR”. |
| On-hand is based on your last approved count | Low | (keep) | Trust-building — keep visible on all inventory KPIs. |

---

## Action Center

| Current Label | Risk | Recommended Label | Reason |
|---------------|------|-------------------|--------|
| {N} in overstock at risk | Medium | ${N} in overstock exposure | “At risk” vague. |
| You should reorder about ${N} today | Medium | Estimated reorder gap: ${N} | Dollar gap, not necessarily order placed today. |

---

## Priority relabel roadmap

1. **P0 (trust):** Money Lost → Profit Risk Identified; Overstock sub-label → Cash tied up above PAR; Reports threshold copy → dynamic thresholds.
2. **P1 (consistency):** Align P&L banner formula label with Money Lost components; unify “profit leaks” → “profit risks”.
3. **P2 (polish):** Brand name in action strings; empty-state invoice dependency copy.

**Implementation note:** Label changes only — no formula changes required for P0 copy fixes. Dynamic threshold copy requires passing `red_threshold` / `yellow_threshold` into Reports UI (`Dashboard.tsx:1082–1104`).
