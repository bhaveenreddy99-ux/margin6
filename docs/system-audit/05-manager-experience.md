# 05 — Manager Experience

**Critical finding:** There is **no manager-specific dashboard or navigation shell**. Managers who pass route guards use the **same `Dashboard.tsx` as owners**, with permission flags selectively hiding two KPI cards.

---

## Routes managers can access

| Route | Access | Guard |
|-------|--------|-------|
| `/app/dashboard` | Yes | Full money dashboard (not EmployeeDashboard) |
| `/app/inventory/enter` | Yes | — |
| `/app/inventory/review` | Yes | StaffRestrictedRoute |
| `/app/inventory/approved` | Yes | StaffRestrictedRoute |
| `/app/inventory/lists` | Yes | StaffRestrictedRoute |
| `/app/smart-order` | Yes | StaffRestrictedRoute |
| `/app/par/*` | Yes | StaffRestrictedRoute |
| `/app/invoices/*` | Yes | StaffRestrictedRoute |
| `/app/purchase-history` | Yes | StaffRestrictedRoute |
| `/app/waste-log` | Yes | — |
| `/app/sales` | Yes | StaffRestrictedRoute |
| `/app/notifications` | Yes | — |
| `/app/settings` | **No** | OwnerRoute → redirect dashboard |
| `/app/billing` | **No** | OwnerRoute (baseline S9-03 PASS) |
| `/app/settings/alerts` | **No** | OwnerRoute |

**Settings exception:** `Settings.tsx` allows MANAGER for some sections when accessed — but route is Owner-only, so managers **cannot reach Settings UI** unless URL bypass (redirects).

---

## Reused owner pages

| Page | Role-aware? | Notes |
|------|-------------|-------|
| Dashboard.tsx | Minimal | Only 2 permission gates |
| SmartOrder.tsx | Yes | `can_approve_orders`, threshold UI |
| InvoiceReview.tsx | No | Assumes manager+ via route |
| PARSuggestions.tsx | Partial | `isManagerPlus` for bulk actions |
| Review.tsx | Yes | `isManagerOrOwner` |
| WasteLog.tsx | Partial | Delete manager-only |

---

## Financial queries for managers

`useDashboardData` runs **all loaders** for any MANAGER on dashboard — including spend, profit leaks, shrinkage — regardless of `can_see_costs`.

**Only gated in UI:**
- `can_see_inventory_value` → inventory value card
- `can_see_food_cost_pct` → food cost card

**Not gated:** Profit Risk hero, waste, price hikes, overstock, spend overview, reorder $, etc.

**STAFF protection:** `DashboardRouter` prevents STAFF from mounting `useDashboardData` — **does not apply to managers without cost permission**.

---

## Manager capability matrix

| Capability | UI | Backend | Location scoped | Custom perm | Tested | Status |
|------------|-----|---------|-----------------|-------------|--------|--------|
| View dashboard | Yes | Yes | Partial (header) | No for most KPIs | baseline partial | **Restricted owner UX** |
| View costs | Partial | Yes (data loaded) | Partial | `can_see_costs` **unused in dashboard** | authz-parity | **UI gap** |
| View food cost % | Partial | Yes | Partial | `can_see_food_cost_pct` | authz-parity | **Partial** |
| View inventory value | Partial | Yes | Partial | `can_see_inventory_value` | authz-parity | **Partial** |
| Count inventory | Yes | Yes | `user_can_access_location` on sessions | — | baseline partial | **Partial** |
| Submit count | Yes (if staff role) | Yes | RLS | — | workflow test | N/A for pure manager |
| Review count | Yes | Yes | Route guard | — | S2-01 pass | **Partial** |
| Approve count | Yes | RPC MANAGER+ | — | — | SQL smoke | **Working** |
| Edit PAR | Yes | Yes | — | `can_edit_par` in PAR UI | Unverified | **Partial** |
| Create order | Yes | Yes | smart_order_runs | — | Unverified | **Partial** |
| Submit order | Yes | RPC | — | `can_approve_orders` + threshold | authz-parity | **Working** |
| Approve order | Yes | `can_approve_order_amount` | location_id on run | threshold | authz-parity | **Working** |
| Receive delivery | Yes | Yes | invoice location RLS | — | Unverified | **Partial** |
| Upload invoice | Yes | Yes | — | — | Unverified | **Working** |
| Review invoice | Yes | Yes | — | — | S5-01 pass | **Partial** |
| Confirm receipt | Yes | `can_confirm_receipt` RPC | — | — | unit test only | **Unverified E2E** |
| Record waste | Yes | Insert RLS | restaurant | — | DB test | **Partial** |
| Resolve alerts | Yes | Mark read | — | — | Unverified | **Partial** |
| Invite staff | **No UI** | RPC `can_manage_invite` | — | — | SQL tests | **Backend only** (owners use Settings) |
| Invite manager | **No** | Invites MANAGER/STAFF only CHECK | — | — | migration | **Blocked by design** |
| Manage assignments | **No UI** | Owner settings only | — | — | — | **Missing for manager** |
| Manage locations | **No** | OWNER RLS | — | — | — | **Missing** |
| Audit Center | **No** | Owner route | — | — | — | **Missing** |
| Billing | **No** | Blocked | — | — | S9-03 | **Blocked** |

---

## Location restrictions

| Layer | Behavior |
|-------|----------|
| UI location picker | Filters queries via `currentLocation` in many pages |
| RLS (sessions, invoices child) | `user_can_access_location` for scoped tables |
| RLS (`locations` SELECT) | **`is_member_of(restaurant_id)` only** — manager sees ALL locations in restaurant (DEF-LOCAL-001) |
| Assignments | Manager A1 seeded A1-only; leak is API not UI |

---

## Permission flags inventory

From `user_location_assignments` / `useLocationPermissions`:

| Flag | Used in UI (verified) | Used in SQL RPC |
|------|----------------------|-----------------|
| `can_approve_orders` | SmartOrder.tsx | `can_approve_order_amount` |
| `can_see_costs` | **Rarely** | `has_location_permission` (not widely in RLS) |
| `can_see_food_cost_pct` | Dashboard.tsx | `has_location_permission` |
| `can_see_inventory_value` | Dashboard.tsx | `has_location_permission` |
| `can_edit_par` | PAR pages (partial) | `has_location_permission` |
| `order_approval_threshold` | SmartOrder.tsx | `can_approve_order_amount` |

**Unused flags on dashboard:** `can_see_costs` does not hide Profit Risk or spend KPIs.

---

## Verdict

The manager is currently a **restricted owner experience** with **isolated permission flags on smart order and two KPI cards**, not a proper operational product.

**Missing for usable manager MVP:**
- Action queue (counts to approve, invoices to receive, delivery issues)
- Location-scoped data enforcement at RLS on `locations`
- Cost visibility enforced at data-fetch layer
- Settings access for team invite (if managers should invite staff)
- Dedicated navigation prioritizing exceptions over KPIs
