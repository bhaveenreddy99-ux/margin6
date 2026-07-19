# Core Workflows Audit

**Date:** 2026-07-10  
**Mode:** Read-only code trace

---

## Core Loop Truth Table

| Step | UI | Backend | Auth | Tests | Failure handling | Status |
|------|-----|---------|------|-------|------------------|--------|
| Owner signup | `Signup.tsx` | Supabase Auth + profile trigger | Auth | Partial E2E | Auth errors shown | **Partially verified** |
| Create restaurant | `CreateRestaurant.tsx` | `create_restaurant_with_owner` RPC | Authenticated | SQL tests | Toast on error | **Verified in code** |
| Create location | `Settings.tsx` Locations | `locations` INSERT | Owner | Weak | Toast | **Verified** |
| Import catalog | `Import.tsx`, `ListManagement.tsx` | Direct table writes | Member RLS | Partial | Mixed `any` | **Partial** |
| Invite manager/staff | `Settings.tsx` Team | `send-invite` → `create_invite` | Owner/Manager | SQL invite tests | LoadOutcome N/A; legacy path silent | **Partial — deploy/cache issues** |
| Accept invite | `AcceptInvite.tsx` | `get_invite_preview`, `accept_invite` | Public preview + auth accept | SQL + local smoke | INV00–INV04 states | **Code verified; prod Jul 2026** |
| Employee count | `InventorySessionEditor.tsx` | Sessions/items/zones | Member | Zone tests | Autosave hooks | **Strong unit tests** |
| Submit count | Count UI | Session status → IN_REVIEW | Member | Partial | Network retry partial | **Partial** |
| Approve count | `Review` page | `approve_inventory_session_atomic` | Manager+ RPC | authz-parity | RPC error toast | **Strong** |
| Approved snapshot | DB session APPROVED | Immutable basis for KPIs | DELETE restricted Jun 2026 | authz tests | — | **Verified in migrations** |
| Smart order | `SmartOrder.tsx` | Domain + `submit_smart_order` | Manager+ RPC | smart-order tests | — | **Verified** |
| Upload invoice | `Invoices.tsx` | Storage + ingestions | Member | E2E skip-heavy | — | **Partial** |
| Parse invoice | Edge `parse-invoice` | AI extraction | Custom auth | parse-invoice-auth tests | — | **Partial** |
| Review invoice | `InvoiceReview.tsx` + feature | Selectors in domain | StaffRestricted route | invoice-review tests | — | **Strong UI/domain split** |
| Confirm receipt | Invoice Review | `confirm_invoice_receipt` | Manager+ RPC | authz tests | Idempotent guards in RPC | **Verified in code** |
| Post inventory | Receipt RPC | `stock_movements` | Server | Weak integration | — | **Inferred** |
| Update cost | Receipt RPC | Catalog + history | Server | Partial | — | **Inferred** |
| Dashboard KPIs | `DashboardRouter` → `Dashboard.tsx` | `useDashboardData` → domain loaders | UI masks costs | 601 unit tests | LoadOutcome on main dashboard | **Strong with gaps** |

---

## Onboarding State Machine (Inferred from code)

```
Signup → Auth user created
  → ProtectedRoute: no restaurants? → /demo OR /onboarding/create-restaurant
  → create_restaurant_with_owner → owner membership + default location (RPC)
  → RestaurantContext refetch → /app/dashboard
  → STAFF invite accept → accept_invite → membership + location assignment
```

**Dead ends identified:**
- User with membership but **no location assignment** — location-scoped features may fail (documented in `MARGIN6_MASTER_STATUS.md`)
- Manager invited but **Settings route Owner-only** — cannot access Team UI
- Legacy invite — no email, no `/accept-invite` link

---

## Inventory Count Workflow

### Session lifecycle
- **Create:** `src/domain/inventory/sessionWorkflow.ts`, feature hooks
- **Statuses:** IN_PROGRESS, IN_REVIEW, APPROVED (enum `session_status`)
- **Approve:** RPC `approve_inventory_session_atomic` — atomic, manager+ only
- **Delete:** Jun 2026 policy — manager+ any status; staff only IN_PROGRESS

### Mixed units example (`2 cases + 8 lb`, 1 case = 40 lb, $2.50/lb)
**Engine:** `casePlanningEngine.ts`, `inventory-conversions.ts`, zone counting

```
8 lb / 40 lb/case = 0.2 cases
Total = 2 + 0.2 = 2.2 cases
Value = 2.2 × $100/case = $220 (if $2.50/lb × 40 lb/case)
Missing conversion → throws "Unit not allowed" (not guessed)
```

**Tests:** `src/test/casePlanningEngine.test.ts` (35 tests), `inventory-conversions.test.ts`

### Concurrency / mobile
- Autosave in session editor (feature hooks)
- Two-tab / concurrent: **Not strongly tested** (Missing)
- Approved immutability: **Server-side DELETE policy** (Jun 2026)

---

## PAR & Smart Order

**Canonical reorder:** `src/domain/inventory/reorderEngine.ts` → `computeSuggestedOrderCases`, `computeLineReorderValue`

```
suggested_cases = ceil(max(0, par - stock))
```

**Open PO quantities:** Investigated in smart order migrations — PO workflow exists; double-order risk **Suspected** without full trace of open PO deduction in reorder formula (needs line-by-line read of `reorderEngine.ts` and smart order loader).

**Approval bypass:** `submit_smart_order` enforces `can_approve_order_amount` (Jun 2026) — staff blocked at RPC (Confirmed in authz tests).

---

## Invoice & Receipt

**Path:** Upload/email → `invoice_ingestions` → `parse-invoice` edge → review UI → `confirm_invoice_receipt`

**AI output:** Treated as proposed — human review before post (UI gates)

**Idempotency:** Receipt RPC has status guards; redeployed multiple times (Mar–Jul 2026 migrations)

**Price impact sources (double-count risk):**
1. `invoice_line_comparisons` → dashboard selectors
2. `PRICE_INCREASE` notifications → `priceIncreaseFromNotifications.ts`
3. Receipt RPC may emit notifications

**Suspected:** Same price change may appear in comparisons AND notifications (Partial — tests exist for notification parsing only).

---

## Invite Flow (Jul 2026 incident learnings)

| Path | Email sent? | Accept page? |
|------|-------------|--------------|
| Legacy `invitations.insert` | **No** | No (wrong table) |
| Secure `send-invite` | Yes | `/accept-invite` |
| Legacy cancel → REVOKED | Fails if duplicate REVOKED row | Bug |

**Frontend fix (local, may not be deployed):** Legacy cancel uses DELETE instead of REVOKED update.
