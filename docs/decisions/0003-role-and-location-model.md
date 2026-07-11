# ADR 0003 — Role and location model

**Status:** Accepted (2026-07-11)

## Context

Managers could read unassigned locations on production. Invite rules and null-location data needed explicit policy.

## Decision

- **OWNER:** all locations in restaurant.
- **MANAGER / STAFF:** assigned locations only (`user_location_assignments`).
- **Managers invite STAFF only** for assigned locations; cannot invite managers or owners.
- **Null `location_id`** on operational records: **owner-only** until data repaired; managers/staff must not receive locationless ops records in steady state.

## Consequences

- Location RLS corrective migration required (staging first).
- Team UI must respect invite rules via `send-invite` edge + RPC checks.
- Route guards alone insufficient — RLS must match.

## Known defect

Production `locations` policy may not yet enforce assignment scoping.

## Not in this PR

RLS migration not applied to production.
