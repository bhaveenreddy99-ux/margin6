# Product definition — Margin6

**Status:** Authoritative product description (founder decisions encoded 2026-07-11)

---

## What Margin6 is

A SaaS platform for **independent restaurant groups** operating approximately **2–10 locations**. Margin6 helps operators:

- Count inventory quickly and accurately
- Approve counts and generate PAR-based suggested orders
- Create and track purchase orders
- Intake, parse, and review supplier invoices
- Confirm receipts and detect price/delivery issues
- Log waste and receive operational alerts
- Give owners visibility without POS or accounting complexity

**Positioning:** Catch overordering, vendor price increases, delivery shortages, invoice overcharges, and unresolved operational issues — then show owners whether the team fixed them.

---

## Core workflow

```text
Count → Review/Approve → Smart Order → Purchase Order → Invoice → Receipt → Dashboard/Alerts
```

---

## Customer target

- Independent operators and small groups (not enterprise chains)
- ~2–10 locations per account
- Back-of-house focus (inventory + purchasing), not front-of-house POS

---

## Current maturity

**Internal-demo ready.** Development paused for **trust and workflow repair.** Not sold as commercial-ready.

---

## Roles (current behavior vs intent)

| Role | Current (verified) | Intent |
|------|-------------------|--------|
| Owner | Full restaurant access; money dashboard | Same |
| Manager | Shared money dashboard; location assignment partial in RLS | Location-scoped ops; STAFF invites only |
| Staff | Count-focused dashboard | Count entry; no financial dashboard load |

See [`../security/authorization-model.md`](../security/authorization-model.md).

---

## What this document is not

- A marketing promise of commercial readiness
- A spec for POS, recipes, or accounting features
- A guarantee that all workflow steps are production-trusted today

For gaps see [`../status/current-product-status.md`](../status/current-product-status.md).
