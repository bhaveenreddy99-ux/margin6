# Workflow: Count to owner review

**Status:** Workflow authority (2026-07-11)

---

## Steps

```text
1. STAFF (or Manager) starts inventory session → IN_PROGRESS
2. Enter counts (optional zone rows per line)
3. Submit for review → IN_REVIEW (or equivalent workflow state)
4. MANAGER+ approves → APPROVED (immutable)
5. Approval RPC may create smart_order_run
6. Owner/Manager views dashboard KPIs from latest APPROVED session
```

---

## Key components

| Step | Code / RPC |
|------|------------|
| Count UI | `InventoryCountPage`, `InventorySessionEditor` |
| Zones | `inventory_session_item_zones` |
| Approve | `approve_inventory_session_atomic` |
| Smart order | `SmartOrder.tsx`, `submit_smart_order` |
| Dashboard load | `loadInventoryMetrics.ts` |

---

## Current behavior

- STAFF uses **EmployeeDashboard** — no money dashboard fetch.
- Approval requires **Manager+** (RPC enforcement).
- Approved sessions are treated as **immutable** in product rules.

---

## Known defects / gaps

| Issue | Type |
|-------|------|
| Dashboard inventory $ vs DB | Trust defect |
| Incomplete count E2E coverage | Test gap |
| Counted zero vs uncounted display | UX/trust defect |

---

## Intended behavior

- Latest **approved** session drives operational on-hand for ordering and owner review.
- Failed or partial loads must not display as `$0` inventory value.

---

## Future decisions

- Whether in-progress zone totals surface in any KPI before approval (currently: no for owner value).
