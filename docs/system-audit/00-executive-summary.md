# 00 — Executive Summary

**Audit date:** 2026-07-10  
**Branch:** `main` @ `7750750`  
**Latest migration:** `supabase/migrations/20260711000001_get_invite_preview_rpc.sql`  
**Auditor method:** Read-only code, migration, and test inspection. No code changes.

---

## What Margin6 currently is

Margin6 is a **React + Vite + TypeScript SPA** backed by **Supabase (PostgreSQL + Auth + RLS + Edge Functions)**. It targets independent restaurant groups (2–10 locations) with a workflow:

**Count → Review/Approve → Smart Order → PO → Invoice → Receipt → Dashboard/Alerts**

The codebase is **production-oriented**, not a prototype: 131 migrations, 466 RLS policy statements, 46+ RPCs, 12 edge functions, 78 domain module files, 604 passing unit tests, and a 720-test Playwright catalog.

However, **role-specific product experiences are immature**. Owners and managers largely share the same money dashboard (`Dashboard.tsx`). Employees get a count-only dashboard (`EmployeeDashboard.tsx`). There is **no manager operations queue** or dedicated employee task list beyond counting.

---

## What genuinely works (verified)

| Area | Evidence |
|------|----------|
| Auth (login/signup/password reset) | `AuthContext`, Supabase Auth, pages in `src/pages/` |
| Restaurant onboarding | `create_restaurant_with_owner` RPC, `CreateRestaurant.tsx` |
| Multi-restaurant selection | `RestaurantContext`, `MyRestaurants.tsx`, `user_ui_state` |
| Location selection + assignments | `user_location_assignments`, `useLocationPermissions` |
| Secure invite flow (new) | `restaurant_invites`, `send-invite` edge fn, `AcceptInvite.tsx` |
| Inventory count UI + zones | `InventoryCountPage`, `inventory_session_item_zones` |
| Count submit / send-back | `sessionWorkflow.ts`, RLS on `inventory_sessions` |
| Count approval + smart order run | `approve_inventory_session_atomic` RPC |
| Smart order submit → PO | `submit_smart_order` RPC from `SmartOrder.tsx` |
| Invoice intake (manual/file/photo) | `useInvoiceActions.ts`, storage, `parse-invoice` (Claude) |
| Invoice review + comparison rows | `InvoiceReview.tsx`, `buildComparisonRows.ts` |
| Receipt confirm RPC | `confirm_invoice_receipt` with manager gate |
| Waste log CRUD | `waste_log` table, `WasteLog.tsx` |
| Notifications UI | `Notifications.tsx`, `notifications` table |
| STAFF financial isolation (dashboard) | `DashboardRouter.tsx` — STAFF never loads `useDashboardData` |
| Route guards (settings/billing) | `OwnerRoute`, `StaffRestrictedRoute` |
| Unit/domain test suite | 604/604 pass (`npm run test`) |
| Production build | `npm run build` succeeds |

---

## What is incomplete

| Gap | Severity |
|-----|----------|
| Owner dashboard shows $0 inventory despite approved count in DB (local baseline DEF-LOCAL-002) | P1 trust |
| Manager can SELECT unassigned locations via RLS (`is_member_of` not `user_can_access_location`) | P1 security |
| Employee count qty inputs not reachable in Playwright baseline (DEF-LOCAL-003) | P2 workflow |
| Receipt confirmation not exercised in baseline (DEF-LOCAL-008) | P2 financial |
| Price hike alert card empty despite seeded notification (DEF-LOCAL-009) | P2 alerts |
| `ready_to_receive` invoice status never set by app code | P2 lifecycle |
| Vendor invoice import is mock data only | P3 |
| No manager-specific dashboard or action queue | P2 product |
| No employee task assignment beyond count CTA | P2 product |
| Playwright not in CI; smoke tests stale selectors | P3 harness |
| Generated types stale vs migrations (`restaurant_invites`, dropped `recipes`) | P3 maintenance |

---

## What is risky

| Risk | Rating | Reference |
|------|--------|-----------|
| Location metadata leak for scoped managers | **High** | `locations` SELECT uses `is_member_of`; baseline DEF-LOCAL-001 |
| Most money KPIs lack `can_see_costs` gating | **Medium** | `Dashboard.tsx` — only inventory value + food cost % gated |
| Three parallel invite systems | **Medium** | `invitations`, `user_invites`, `restaurant_invites` |
| `audit-invoice-anon` public endpoint with service role parse | **Medium** | By design for `/audit`; CORS `*` |
| Typecheck fails (Deno import in app test) | **Medium** | CI quality gate |
| Legacy `purchase_history` + `purchase_orders` dual paths | **Medium** | Invoice review fallback, SmartOrder delete |
| Approval does not write stock movements | **Informational** | By design; receipt drives stock |

---

## Role readiness

| Role | Score (0–10) | Assessment |
|------|--------------|------------|
| **Owner** | 4 | Rich UI exists but dashboard trust broken in baseline; no cross-location comparison product |
| **Manager** | 3 | Restricted owner experience + permission flags; no ops queue; location leak |
| **Employee** | 4 | Count-only dashboard works; count entry UI unverified in automation; no receiving MVP |

---

## Pilot / commercial readiness

| Gate | Verdict |
|------|---------|
| Internal dogfood | **Conditional** — domain tests pass; UI trust gaps |
| Design partner demo | **No** — $0 dashboard undermines sellable metric |
| Paying customer | **No** — receipt integrity unproven in E2E |
| Broad launch | **No** |

Local baseline readiness score: **44/100** (`docs/testing/local/full-baseline-run/15-readiness-scorecard.md`).

---

## Top ten priorities

1. Fix dashboard inventory value aggregation (`loadInventoryMetrics` / location scope)
2. Fix `locations` RLS to use `user_can_access_location` for MANAGER/STAFF
3. Verify and fix employee count entry UI (desktop zones / inputs)
4. Execute receipt confirmation idempotency tests
5. Fix price hike alert card data path
6. Regenerate Supabase types; remove dead recipe code
7. Consolidate invite systems onto `restaurant_invites`
8. Add manager operations dashboard (action queue)
9. Enforce `can_see_costs` on all money KPI fetches
10. Wire Playwright smoke into CI with staging secrets

---

## Go / no-go

**NO-GO for external pilot** until P1 dashboard trust and location RLS are fixed and receipt confirmation is verified end-to-end.

**GO for continued internal development** on the existing architecture — do not rebuild; reconcile and harden.
