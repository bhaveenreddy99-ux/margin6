# 06 — Employee / Staff Experience

**Role:** `restaurant_members.role = 'STAFF'`  
**Dashboard:** `EmployeeDashboard.tsx` only — explicitly does **not** call `useDashboardData`

---

## Staff routes (verified)

| Route | Access | Notes |
|-------|--------|-------|
| `/app/dashboard` | Yes | Count-only EmployeeDashboard |
| `/app/inventory/enter` | Yes | Primary work surface |
| `/app/waste-log` | Yes | Insert allowed for all members |
| `/app/notifications` | Yes | Full notifications page |
| All StaffRestrictedRoute pages | **No** | Redirect to `/app/dashboard` |
| `/app/settings`, `/app/billing` | **No** | OwnerRoute + baseline S9-01/02 PASS |

**Sidebar (`AppSidebar.tsx`):** STAFF sees only Inventory Management (enter) + Waste Log + Notifications.

---

## Employee capability matrix

| Capability | UI | Backend | Location scoped | Tested | Status |
|------------|-----|---------|-----------------|--------|--------|
| View dashboard | Count CTA only | No money queries | Assignment required | employee-dashboard.test | **Working** |
| View costs | Hidden | RLS may still allow some SELECTs on catalog costs | — | — | **UI protected** |
| View inventory value | Hidden | Not fetched on dashboard | — | dashboard-role-routing | **Working** |
| Count inventory | Yes | Yes | Assignment + location on session | baseline SKIP entry | **Partial** |
| Submit count | Yes | RLS: IN_PROGRESS→IN_REVIEW | Creator/staff policy | workflow test | **Working** |
| Review count | **No** | RLS blocks | — | — | **Blocked** |
| Approve count | **No** | RPC requires MANAGER+ | — | SQL smoke | **Blocked** |
| Edit PAR | **No** | — | — | — | **Blocked** |
| Smart order | **No** | Route blocked | — | — | **Blocked** |
| Invoices | **No** | Route blocked | — | — | **Blocked** |
| Confirm receipt | **No** | RPC manager+ | — | — | **Blocked** |
| Record waste | Yes | Insert RLS | restaurant_id | DB audit | **Partial** |
| Resolve alerts | View only | Update read_at? | — | Unverified | **Partial** |
| Invite anyone | **No** | — | — | — | **Blocked** |
| Settings | **No** | OwnerRoute | — | S9-02 | **Blocked** |

---

## Location assignment behavior

- `EmployeeDashboard` shows dead-end if `!currentLocation`: "Ask your manager to assign you a location"
- Assignments loaded in `RestaurantContext` for STAFF/MANAGER from `user_location_assignments`
- `useEmployeeCountStatus` queries sessions for assigned scope

**Gap:** No UI for staff to see *which* lists/zones they own — enters hub and picks session.

---

## Count functionality

| Feature | Status | Evidence |
|---------|--------|----------|
| Open IN_PROGRESS session | PASS (baseline) | S1-03 |
| Zone strips | FAIL in baseline | 0 zone strips S1-07 |
| Qty number input | SKIP | DEF-LOCAL-003 |
| Mixed units (case + lb) | DB verified; UI blocked | audit chickenAnchor |
| Submit for review | Code path exists | `submitInventorySessionForReview` |
| Mobile layout | Login works | baseline mobile PASS nav |

**Session lock:** Staff cannot edit IN_REVIEW/APPROVED (`sessionLocked` in item commands).

---

## Cost / value protection (verified)

| Protection | Mechanism | Gap |
|------------|-----------|-----|
| No money dashboard | DashboardRouter branch | **Strong** |
| No smart order route | StaffRestrictedRoute | **Strong** |
| No invoice route | StaffRestrictedRoute | **Strong** |
| Catalog unit costs in count UI | May display depending on component | **Unverified** |
| Direct API catalog read | Member RLS | Staff is member — may read catalog costs |

---

## Missing for employee MVP

1. Reliable mobile/desktop count entry (zone or universal input)
2. Task list ("your counts due today")
3. Delivery receiving role (optional — not implemented for staff)
4. Invoice photo capture route for staff (not implemented)
5. Shortage/damage report without full invoice access
6. Personal activity history page
7. Offline/retry UX (Suite 11 not run)

---

## Verdict

Employees can **authenticate, land on a count-only dashboard, and navigate to enter inventory**, but **count entry persistence is unverified in E2E** and there is **no broader task workflow**.

Classification: **early MVP for counting only** — not a complete mobile-first employee product.
