# ADR 0004 — Order record model

**Status:** Accepted (2026-07-11)

## Context

Smart order, PO UI, and purchase history paths coexist. Contributors assumed a single order table.

## Decision

- **`purchase_orders`** is the **intended authoritative** future order record.
- **Current production behavior** may still use **`purchase_history`** and legacy paths — document as **unresolved drift**.
- Do **not** silently migrate or delete legacy paths in unrelated PRs.

## Consequences

- New order features should prefer `purchase_orders` schema.
- Reconciliation epic needed before declaring PO workflow “complete.”
- README must not claim “finished formal PO workflow.”

## Not in this PR

No schema or code changes to order tables.
