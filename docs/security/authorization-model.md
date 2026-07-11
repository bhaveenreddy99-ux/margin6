# Authorization model

**Status:** Security authority (2026-07-11)

---

## Principles

1. **PostgreSQL RLS** is the primary tenant isolation layer.
2. **SECURITY DEFINER RPCs** perform privileged mutations with explicit in-function checks.
3. **Route guards** (`OwnerRoute`, `StaffRestrictedRoute`) improve UX only — direct API calls must fail if unauthorized.
4. **Per-location permission flags** (`can_see_costs`, etc.) must eventually be enforced server-side, not only in React.

---

## Roles

| Role | Restaurant membership | Location access |
|------|----------------------|-----------------|
| **OWNER** | `restaurant_members.role = OWNER` | All active locations in restaurant |
| **MANAGER** | `restaurant_members.role = MANAGER` | Assigned locations via `user_location_assignments` |
| **STAFF** | `restaurant_members.role = STAFF` | Assigned locations via `user_location_assignments` |

Helpers: `user_accessible_location_ids`, `user_can_access_location`, `has_location_permission` (`20260623000005_authz_helpers.sql`).

---

## Invite rules (founder)

- **Managers** may invite **STAFF only**, for **their assigned locations**.
- **Managers** may **not** invite managers or owners.
- Invite creation: **`create_invite`** RPC — **edge function only** (`send-invite`), never browser-direct (plaintext token).
- Accept: **`accept_invite`**, **`get_invite_preview`** (capability token model for preview).

---

## Receipt confirmation

- **Current:** Owner or Manager of restaurant (`can_confirm_receipt` / role check in RPC).
- **Staff:** Cannot confirm receipts.

---

## Null location_id records

- **Founder rule:** Managers and staff must **not** receive locationless operational records.
- Historical null-`location_id` data: **owner-only** visibility until reviewed and repaired.

---

## Known defects (production)

| Defect | Policy / area |
|--------|----------------|
| Manager reads all locations | `locations` SELECT: `is_member_of(restaurant_id)` only |
| Cost flags UI-only | Dashboard loaders fetch costs regardless of `can_see_costs` |
| Anon RPC EXECUTE drift | Several DEFINER functions callable by `anon` |

See [`../status/known-blockers.md`](../status/known-blockers.md), [`../system-audit/16-rpc-exposure-audit.md`](../system-audit/16-rpc-exposure-audit.md).

---

## What this PR does not change

This document does not modify RLS policies or grants. Apply fixes only via reviewed migrations on staging first.
