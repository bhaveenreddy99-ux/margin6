# Architecture — S0-INFRA: The Margin6 Authorization Model

> **Date:** 2026-06-23 · **Status:** Proposed design (no code). · **Investigation:** [s0-infra-permission-architecture.md](../investigations/s0-infra-permission-architecture.md)
> **Principle (CLAUDE.md):** *RLS is the source of truth. RPCs must enforce permissions. Never trust UI permissions. Do not duplicate permission systems.*

---

## 1. Design goals

1. **One model, three layers.** A single conceptual authorization model, enforced server-side (RLS + RPC), *mirrored* (not enforced) by the UI.
2. **One helper library.** RLS and RPCs call the **same** SQL helpers — no per-table or per-RPC re-implementation.
3. **Flags become real.** The six per-location flags get a single server-side reader that RLS/RPC use; the UI keeps consuming the same values for UX.
4. **Semantics encoded once.** OWNER⇒all-permissions, threshold-null⇒unlimited, location-access rules live in **one** SQL place that matches `useLocationPermissions` exactly.
5. **Additive & reversible.** Ship the helper layer with no behavior change first; wire enforcement in per-item, each individually revertable.

---

## 2. Source of truth (the canonical hierarchy)

```
Identity            auth.uid()                              (Supabase Auth)
   │
Restaurant role     restaurant_members.role  ∈ {OWNER, MANAGER, STAFF}     ← CANONICAL ROLE
   │                (has_restaurant_role / has_restaurant_role_any)
Location access     user_location_assignments (row) OR role=OWNER→all      ← CANONICAL ACCESS
   │                (user_accessible_location_ids / user_can_access_location)
Per-location grants user_location_assignments.{6 flags, threshold}         ← CANONICAL GRANTS
   │                (NEW: has_location_permission / can_approve_order_amount)
Enforcement         RLS policies  +  SECURITY DEFINER RPCs                  ← THE BOUNDARY
Presentation        UI (route guards, useLocationPermissions)              ← MIRROR ONLY
```

**Decisions:**
- **`restaurant_members.role` is the one role.** `user_location_assignments.role` is **deprecated** (dead today — §3.5 of the investigation). Do not start reading it; plan its removal.
- **OWNER is absolute:** OWNER ⇒ access to all active locations and all flags true, threshold ignored. Encoded in the helpers (matches `useLocationPermissions.ts:13-22`).
- **A flag's "effective value"** = `OWNER ? true : (user_location_assignments.<flag> for the user+location, default per column)`. `order_approval_threshold` effective = `OWNER ? unlimited : (row value; null ⇒ unlimited)`.
- **The flags are *grants on top of* role**, not a replacement: e.g. submitting an order needs MANAGER+ **or** (member **and** `can_approve_orders` **and** within threshold) — exact rule decided per operation in S0-4/S0-9 design, using these helpers.

---

## 3. Layer responsibilities (which check goes where)

### 3.1 RLS — table-level CRUD authorization (the baseline gate)
- **Owns:** can this user SELECT/INSERT/UPDATE/DELETE *this row* of *this table*? Membership + role + location scope.
- **Already strong** (167 `has_restaurant_role*` refs). S0-INFRA's job here: (a) add **location scoping** to write policies that lack it (S1-9), (b) add **flag checks** where a flag governs a table (e.g. `can_edit_par` on `par_*` — S1-6) via the new helper.
- **Must stay simple/cheap** (RLS runs per-row): helpers are `STABLE SECURITY DEFINER` and hit indexed columns.

### 3.2 RPC (SECURITY DEFINER) — privileged / atomic / cross-row operations
- **Owns:** operations that need transactional logic, cross-table writes, or **flag+threshold** decisions that RLS can't express cleanly — `submit_smart_order` (threshold), `confirm_invoice_receipt` (manager confirm), `approve_inventory_session_atomic` (already correct).
- **Rule:** every privileged RPC begins with the **same authorization preamble** built from the shared helpers — the `approve_inventory_session_atomic` template:
  ```
  if auth.uid() is null then raise ... end if;
  if not <required check using shared helpers> then raise 'access denied' end if;
  ```
- **No RPC may be membership-only** if the operation is privileged. S0-4/S0-9 fix exactly this.

### 3.3 UI — presentation only (never the boundary)
- **Owns:** hide/disable affordances, friendly messaging (e.g. "exceeds your approval limit"). Consumes the **same** flags via `useLocationPermissions`.
- **Never** the security guarantee. Every UI gate must have a matching RLS/RPC gate. (Today's threshold/can_approve_orders/can_see_costs are UI-only — the anti-pattern S0-INFRA ends.)

---

## 4. The canonical helper library (the S0-INFRA deliverable)

### 4.1 Keep (sound, widely used)
- `is_member_of(r_id)`
- `has_restaurant_role(r_id, role)` · `has_restaurant_role_any(r_id, role[])`
- `user_accessible_location_ids(uid)` · `user_can_access_location(uid, loc)`

### 4.2 Add (the missing flag layer)
| New helper | Signature → returns | Semantics | Replaces / wires |
|-----------|---------------------|-----------|------------------|
| `has_location_permission(p_uid, p_location_id, p_flag text)` | → boolean | OWNER ⇒ true; else read `user_location_assignments.<p_flag>` for (uid, loc); false if no assignment | Single reader for `can_see_costs`, `can_edit_par`, `can_see_inventory_value`, `can_see_food_cost_pct`, `can_approve_orders`. Wires the intent of the dead `get_location_permissions`. |
| `can_approve_order_amount(p_uid, p_restaurant_id, p_location_id, p_amount numeric)` | → boolean | OWNER/MANAGER ⇒ true; else `can_approve_orders` **and** (`order_approval_threshold` is null **or** `p_amount <= threshold`) | The server gate `submit_smart_order` needs (S0-4) |
| `can_confirm_receipt(p_uid, p_restaurant_id)` | → boolean | `has_restaurant_role_any(OWNER,MANAGER)` (and/or a receiving flag if product wants STAFF receiving) | The server gate `confirm_invoice_receipt` needs (S0-9) |
| *(optional convenience)* `is_owner_or_manager(r_id)` | → boolean | `has_restaurant_role_any(r_id, {OWNER,MANAGER})` | readability sugar; collapses repeated array literals |

Notes:
- Prefer a **generic `has_location_permission(…, flag)`** over six bespoke functions — one place for the OWNER short-circuit and default logic. Whitelist the flag names inside it to avoid SQL-injection-by-column.
- Keep `get_location_permissions` (returns all 6) for the **client** to read in one call if desired, but **tighten its grant** (revoke from `anon`) and consider re-pointing the client at it later (C-2 consolidation). It is not the enforcement path — the per-flag helper is.

### 4.3 Deprecate / replace
- `user_location_assignments.role` → **deprecated** (dead). Plan removal after confirming nothing reads it.
- `get_location_permissions` `GRANT … TO anon` → **revoke** (GA-11).
- The **82 inline client role checks** → replace over time with a single client resolver (`useAuthz()` / extend `useLocationPermissions`) that mirrors `has_location_permission` / `can_approve_order_amount` (C-2). Not part of the security boundary, but kills drift.

### 4.4 Parity contract (critical)
The server helpers and `useLocationPermissions` **must agree** on every input. Lock this with a parity test matrix (same uid/location/flag → same answer in SQL and TS) so the UI never offers what the server denies (broken UX) or hides what the server allows (false lock). This matrix is part of S0-INFRA's test deliverable.

---

## 5. Worked examples (how a request is authorized end-to-end)

**Submit a $4,000 smart order as a STAFF member with `can_approve_orders=true`, threshold=$1,000:**
- UI: SmartOrder shows "exceeds your approval limit" (reads `perms.order_approval_threshold`). *(presentation)*
- API: `supabase.rpc('submit_smart_order', …)` → RPC preamble calls `can_approve_order_amount(uid, rest, loc, 4000)` → MANAGER? no; `can_approve_orders` yes but `4000 > 1000` → **false → raise 'approval required'**. *(boundary — closes S0-4)*

**View vendor cost columns as a MANAGER with `can_see_costs=false`:**
- UI: hides cost columns *(after S1-1 wires the flag)*.
- API: RLS/RPC on the cost-bearing read paths consult `has_location_permission(uid, loc, 'can_see_costs')` → false → cost fields not returned. *(boundary — closes S1-1)*

**Confirm receipt as STAFF:**
- API: `confirm_invoice_receipt` preamble → `can_confirm_receipt(uid, rest)` → STAFF false → **raise**. *(boundary — closes S0-9)*

---

## 6. Non-goals / explicitly out of scope for S0-INFRA itself
- Building S0-4 / S0-9 / S1-1 / S1-6 / S1-7 (S0-INFRA provides the helpers; those items *use* them — see dependency map).
- Removing the dead `ula.role` column now (deprecate first, remove later).
- Rewriting all 82 client checks now (provide the resolver; migrate incrementally).
- Any KPI/trust work (Phase 3).

> No application code or migration was created in producing this architecture.
