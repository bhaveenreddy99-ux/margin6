# ADR 0005 — Receiving and cost trust

**Status:** Accepted (2026-07-11)

## Context

Receipt confirmation, catalog cost updates, and dashboard dollars must be trustworthy for pilot credibility.

## Decision

- **Receipt confirmation:** Owner/Manager only (current).
- **Latest approved count** = operational on-hand source of truth.
- **Stock movements** = audit ledger until continuous on-hand explicitly approved.
- **Unit/pack mismatches** must **block** catalog cost updates — **approved future repair rule** (not current shipped behavior; receipt flow may notify but not fully block today).
- Dashboard must not show **failed loads** or **missing cost** as confident `$0`.

## Consequences

- Receipt and count trust epics precede financial KPI marketing.
- Shrinkage dollar and Money Lost remain **out of trusted pilot scope** until proven.

## Not in this PR

No changes to receipt RPC or cost update logic.
