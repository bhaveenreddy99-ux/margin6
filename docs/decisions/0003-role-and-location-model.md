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

## Current implementation gaps (not intended policy)

| Gap | Current behavior |
|-----|------------------|
| Manager invite location scoping | `create_invite` allows a MANAGER to invite STAFF to any location in the restaurant without checking `user_can_access_location` |
| Null `location_id` visibility | RLS on several operational tables uses `location_id IS NULL OR user_can_access_location(...)`, exposing locationless rows to managers/staff |

These require corrective RPC/RLS work on staging before production. RLS migration not applied to production.

## Not in this PR
