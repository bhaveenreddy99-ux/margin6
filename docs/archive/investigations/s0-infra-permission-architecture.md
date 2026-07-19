# Investigation — S0-INFRA: Server-side permission enforcement model

> **Date:** 2026-06-23
> **Type:** Architecture & design investigation (no code changed, no migration created).
> **Roadmap item:** S0-INFRA (Phase 2 foundation) — [trust-first-roadmap.md](../trust-first-roadmap.md). Build **before** S0-4 / S0-9 and the P1 permission items.
> **Sources:** code trace (cited inline), [role-permission-matrix.md](../role-permission-matrix.md), [product-reality.md](../product-reality.md), [phase-1-p0-security-review.md](../completed/phase-1-p0-security-review.md).
> **Companions:** [architecture/s0-infra-authorization-model.md](../architecture/s0-infra-authorization-model.md) · [architecture/s0-infra-dependency-map.md](../architecture/s0-infra-dependency-map.md) · [plans/s0-infra-implementation-plan.md](../plans/s0-infra-implementation-plan.md)

---

## 1. Executive summary

Margin6 already has a **strong RLS layer** (167 `has_restaurant_role*` references across migrations) and a **correct RPC template** (`approve_inventory_session_atomic`). The authorization problem is **not** "no server-side enforcement" — it is **three layers that don't share one model**:

1. **Restaurant role** (`restaurant_members.role`) — enforced well in RLS, partially in RPCs, duplicated in ~82 client sites.
2. **Location access** (`user_location_assignments`) — enforced in some RLS (sales) but inconsistently elsewhere.
3. **Six per-location permission flags** (`can_see_costs`, `can_approve_orders`, `can_edit_par`, `order_approval_threshold`, …) — **read by the UI only; enforced by no RLS policy and no RPC.** The server-side function to read them (`get_location_permissions`) **exists but is wired to nothing** (dead).

The two active P0 RPC gaps (`submit_smart_order` → S0-4, `confirm_invoice_receipt` → S0-9) and the P1 flag items (S1-1/1-6/1-7) all fail for the **same root cause**: there is no single, server-callable helper set that answers *"can this user do X to this location?"* including the flags. **S0-INFRA is that helper set** + the rule that RLS/RPC are the only security boundary and the UI mirrors it.

This document covers requirements 1–3 (current architecture, sources of truth, ranked gaps). The proposed model, dependency map, migration strategy, risks, rollout, and effort are in the three companion documents.

---

## 2. Current permission architecture (Requirement 1)

### 2.1 The SQL helpers (where they live, what they do)

| Helper | Defined | Semantics | Used where | Verdict |
|--------|---------|-----------|-----------|---------|
| `is_member_of(r_id)` | [20260212001141:61](../../supabase/migrations/20260212001141_initial_schema_core_rls.sql#L61) | true if caller is any member of restaurant | RLS (broad), RPCs (submit_smart_order, confirm_invoice_receipt, create_member_notifications), edge fns | **Sound. Keep.** |
| `has_restaurant_role(r_id, role)` | [:74](../../supabase/migrations/20260212001141_initial_schema_core_rls.sql#L74) | true if caller has exact role | RLS (owner-only policies) | **Sound. Keep.** |
| `has_restaurant_role_any(r_id, role[])` | [:87](../../supabase/migrations/20260212001141_initial_schema_core_rls.sql#L87) | true if caller has any of the roles | RLS (Manager+ everywhere), `approve_inventory_session_atomic` | **Sound. Keep — the workhorse.** |
| `user_accessible_location_ids(uid)` | [20260503000005:1](../../supabase/migrations/20260503000005_location_rls_helpers.sql#L1) | OWNER → all active locations; others → assigned locations | `user_can_access_location` | **Sound. Keep.** |
| `user_can_access_location(uid, loc)` | [20260503000005:24](../../supabase/migrations/20260503000005_location_rls_helpers.sql#L24) | location membership/access | RLS on `weekly_sales`/`daily_sales` (S0-7); a few others | **Sound but under-used.** |
| `get_location_permissions(uid, loc)` | [20260503000005:44](../../supabase/migrations/20260503000005_location_rls_helpers.sql#L44) | returns the 6 flags from `user_location_assignments` | **NOWHERE** (only the defining migration, the schema snapshot, generated `types.ts`) | **DEAD — exists, enforces nothing.** Also `GRANT ALL … TO anon` (snapshot:6673). |

All are `SECURITY DEFINER STABLE SET search_path=public` and `GRANT EXECUTE … TO authenticated` — the right shape. The gap is **coverage**, not correctness: the flag helper is unused, and `user_can_access_location` is applied to sales only.

### 2.2 Role checks in RLS (the strong layer)

Role is enforced **broadly** in RLS — **167** `has_restaurant_role*` references across the migration set, e.g.:
- Manager+ writes on `inventory_lists`, `par_guides`, `purchase_history` (+items, S0-6), `weekly_sales`/`daily_sales` (S0-7), `restaurant_settings`, `locations`, `inventory_settings`, `smart_order_settings`, `purchase_orders` ([20260329120000:160-169](../../supabase/migrations/20260329120000_workflow_purchase_orders_invoices_stock.sql#L160)).
- OWNER-only on `restaurants`, `restaurant_members`, settings DELETE.
- S0-5 added the role+status split on `inventory_sessions` DELETE.

**RLS is the most consistent layer.** Its weakness is the **per-location flags** (none read in RLS) and a few **write policies not location-scoped** (only SELECT is — G18/S1-9).

### 2.3 Role checks in RPCs (mixed)

| RPC | Check today | Verdict |
|-----|-------------|---------|
| `approve_inventory_session_atomic` ([20260418222826:26-55](../../supabase/migrations/20260418222826_approve_inventory_session_atomic.sql#L26)) | `auth.uid()` present → `auth.uid()=p_user_id` → `has_restaurant_role_any(OWNER,MANAGER)` | ✅ **The correct template.** |
| `create_member_notifications` (S0-8) | `is_member_of` + recipient membership + type allowlist | ✅ correct for its purpose |
| `delete_restaurant_cascade` ([20260214021402:16](../../supabase/migrations/20260214021402_delete_restaurant_cascade.sql#L16)) | `role='OWNER'` | ✅ |
| **`submit_smart_order`** ([20260327000004:20](../../supabase/migrations/20260327000004_serialize_smart_order_submit.sql#L20)) | **`is_member_of` only** — ignores `can_approve_orders` + `order_approval_threshold` | ❌ **S0-4 gap** |
| **`confirm_invoice_receipt`** (latest [20260524000001:36](../../supabase/migrations/20260524000001_fix_catalog_default_unit_cost_in_confirm_receipt.sql#L36)) | **`is_member_of` only** — no role / no "manager confirmed" re-check | ❌ **S0-9 gap** |
| `delete_inventory_list` | SECURITY DEFINER, no explicit role gate (relies on caller context) | ⚠️ review under S0-INFRA |

**Pattern:** the privileged RPCs that need flag/threshold/role logic (`submit_smart_order`, `confirm_invoice_receipt`) do membership-only, while the one done right (`approve_inventory_session_atomic`) shows the template. They diverge because there is **no shared helper they all call**.

### 2.4 Role/permission checks in the UI

- **Restaurant role** flows from `restaurant_members.role` → `RestaurantContext.currentRestaurant.role` → **~82 inline checks** across `src/` (`role === "OWNER"`, `isManagerOrOwner`, `restaurantRole`, `OwnerRoute`, `StaffRestrictedRoute`). Route guards (`OwnerRoute`, `StaffRestrictedRoute`) + in-component flags.
- **Location flags** flow from the `user_location_assignments` **table** (read directly under RLS at [RestaurantContext.tsx:171](../../src/contexts/RestaurantContext.tsx#L171), [useLocationSettings.ts:214](../../src/hooks/useLocationSettings.ts#L214)) → `useLocationPermissions()` ([src/hooks/useLocationPermissions.ts](../../src/hooks/useLocationPermissions.ts)) → consumed for **UI masking/gating only**:
  - `can_see_inventory_value`, `can_see_food_cost_pct` → Dashboard KPI masking ([Dashboard.tsx:1620,1650](../../src/pages/app/Dashboard.tsx#L1620)).
  - `can_edit_par` → InventoryCount ([InventoryCountPage.tsx:555](../../src/features/inventory-count/pages/InventoryCountPage.tsx#L555)).
  - `can_approve_orders` + `order_approval_threshold` → SmartOrder submit gate ([SmartOrder.tsx:295,476-489,670](../../src/pages/app/SmartOrder.tsx#L476)).
  - `can_see_costs` → **read nowhere that enforces it** (not in Invoices/Review/PurchaseHistory).
- **OWNER short-circuit:** `useLocationPermissions` hard-codes OWNER → all flags true ([useLocationPermissions.ts:13-22](../../src/hooks/useLocationPermissions.ts#L13)). Any server model **must** replicate this exactly or owners diverge.

**The UI is the *only* place the six flags are consulted.** That is the core of S0-INFRA.

---

## 3. Permission sources of truth (Requirement 2)

| Permission | Stored | Read | Enforced (server) | Ignored / gap |
|------------|--------|------|-------------------|---------------|
| **Restaurant role** (OWNER/MANAGER/STAFF) | `restaurant_members.role` | RLS via `has_restaurant_role*`; client via `RestaurantContext` | ✅ RLS broadly; ✅ `approve_*` RPC | ❌ `submit_smart_order`, `confirm_invoice_receipt` RPCs (membership-only) |
| **Restaurant membership** | `restaurant_members` | `is_member_of` | ✅ RLS + RPCs + edge | — |
| **Location access** | `user_location_assignments` (row exists) + OWNER→all | `user_can_access_location` / `user_accessible_location_ids` | ✅ sales RLS; ⚠️ partial elsewhere | ❌ most write policies not location-scoped (G18/S1-9) |
| **Per-location `role`** | `user_location_assignments.role` | **nothing** | — | ❌ **dead column** — never read by server or client (canonical role is `restaurant_members.role`) |
| `can_approve_orders` | `user_location_assignments.can_approve_orders` (default **true**) | UI (`SmartOrder`) | ❌ none | ❌ `submit_smart_order` ignores it (S0-4) |
| `order_approval_threshold` | `user_location_assignments` (default null=unlimited) | UI (`SmartOrder`) | ❌ none | ❌ `submit_smart_order` ignores it (S0-4) |
| `can_see_costs` | `user_location_assignments.can_see_costs` (default **false**) | **UI never enforces it** | ❌ none | ❌ **never read anywhere that gates costs** (G10/S1-1) |
| `can_edit_par` | `user_location_assignments.can_edit_par` (default **true**) | UI (`InventoryCount`) | ❌ none | ❌ `par_*` RLS uses role/`is_member_of`, not the flag (S1-6) |
| `can_see_inventory_value` | `user_location_assignments` (default false) | UI (Dashboard mask) | ❌ none | ❌ tables API-readable regardless (read-mask only) |
| `can_see_food_cost_pct` | `user_location_assignments` (default true) | UI (Dashboard) **+** sales SELECT RLS ([20260518000001:196-205](../../supabase/migrations/20260518000001_sales_entry.sql#L196)) | ⚠️ the **only** flag with *any* server enforcement (sales read-gate) | partial |
| **Permission-reader fn** | `get_location_permissions(uid,loc)` | **nothing** | — | ❌ **dead** infra; the hook to wire |

**Two structural truths:**
1. **`restaurant_members.role` is the canonical role; `user_location_assignments.role` is dead** — two role columns, one used. S0-INFRA must declare one canonical and deprecate the other.
2. **Five of six flags are enforced by zero server code** (only `can_see_food_cost_pct` has a partial sales read-gate). The flags are, today, **cosmetic** (role-permission-matrix G16).

---

## 4. Gap analysis (Requirement 3), ranked

### P0 — active authorization holes the foundation must close
| ID | Gap | Evidence | Why P0 |
|----|-----|----------|--------|
| GA-1 | `submit_smart_order` ignores `can_approve_orders` + `order_approval_threshold` (UI-gated only) | [20260327000004:20](../../supabase/migrations/20260327000004_serialize_smart_order_submit.sql#L20) vs [SmartOrder.tsx:476-489](../../src/pages/app/SmartOrder.tsx#L476) | Any member places any-size real PO via the RPC → **S0-4** |
| GA-2 | `confirm_invoice_receipt` is membership-only; UI promises "manager must confirm"; overwrites cost + writes stock | [20260524000001:36](../../supabase/migrations/20260524000001_fix_catalog_default_unit_cost_in_confirm_receipt.sql#L36) | Unauthorized cost overwrite / stock movement → **S0-9** |
| GA-3 | No shared server helper for the flags → every flag-dependent fix re-invents logic | `get_location_permissions` dead; UI-only flags | Institutionalizes duplicate permission systems (banned by CLAUDE.md) |

### P1 — flags that exist but enforce nothing (before paid customers)
| ID | Gap | Evidence | Roadmap |
|----|-----|----------|---------|
| GA-4 | `can_see_costs` never enforced — owner's cost-hiding is ignored on Invoices/Review/PurchaseHistory | no enforcement site found | S1-1 |
| GA-5 | `can_edit_par` UI-only; `par_*` RLS uses role/`is_member_of` | par RLS vs flag | S1-6 |
| GA-6 | All 6 per-location flags cosmetic (no RLS/RPC reads them) | §3 | S1-7 (the big one) |
| GA-7 | Write policies not location-scoped (only SELECT is) | G18 | S1-9 |
| GA-8 | MANAGER without a `user_location_assignment` sees empty data / could be locked out by location helpers | product-reality §1 | T1-10 (depends on S1-7) |

### P2 — duplication / hygiene (after trust restored)
| ID | Gap | Evidence | Roadmap |
|----|-----|----------|---------|
| GA-9 | ~82 inline client role checks; no single client resolver beyond `useLocationPermissions` | grep | C-2 |
| GA-10 | Dead `user_location_assignments.role` column (two role sources) | §3 | — (decide in S0-INFRA) |
| GA-11 | `get_location_permissions` `GRANT ALL … TO anon` | snapshot:6673 | tighten in S0-INFRA |
| GA-12 | OWNER-implies-all + threshold-null-unlimited semantics live only in client TS | `useLocationPermissions.ts` | must be encoded server-side once |

### Cross-cutting patterns (the root causes)
- **RP-1 — No single source of truth for the *flags*.** They live in `user_location_assignments`, are read only by the client, and the server reader (`get_location_permissions`) is unused.
- **RP-2 — UI is treated as an enforcement layer.** Threshold, can_approve_orders, can_edit_par, can_see_costs are "enforced" only by hiding buttons; the API ignores them.
- **RP-3 — RPCs don't share the role/flag helpers** that RLS uses, so privileged RPCs drift to membership-only.
- **RP-4 — Duplicated role logic** (82 client sites + per-table RLS copies) with no shared resolver → drift risk.
- **RP-5 — Two role columns**, one dead.

---

## 5. What S0-INFRA must deliver (preview — full design in the architecture doc)

A **single, composable SQL helper layer** that RLS and RPCs both call, encoding the *exact* semantics the client already uses (OWNER⇒all, threshold null⇒unlimited, location access), plus the rule that **RLS/RPC are the only security boundary and the UI mirrors it**:

1. Keep the sound helpers (`is_member_of`, `has_restaurant_role*`, `user_can_access_location`).
2. Add a **canonical flag/permission helper** (e.g. `has_location_permission(uid, loc, flag)` with OWNER short-circuit) and an **order-approval helper** (role + `can_approve_orders` + threshold vs amount) — wiring the currently-dead `get_location_permissions` intent.
3. Declare `restaurant_members.role` canonical; deprecate `user_location_assignments.role`.
4. A **single client resolver** that mirrors the server helper (collapse the 82 inline checks over time).

This unblocks S0-4, S0-9, S1-1, S1-6, S1-7 (see dependency map) without re-implementing permission logic per fix.

> No application code or migration was created in producing this investigation.
