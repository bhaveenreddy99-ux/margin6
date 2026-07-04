# Margin6 — Role × Permission Matrix

> **Date:** 2026-06-22
> **Scope:** Every page × every operation (View / Create / Edit / Delete / Approve / Export) for OWNER, MANAGER, STAFF, evaluated across all four authorization layers (UI route/component gate, API/REST, RLS, RPC). Verified against source; no code modified.
> **Primary evidence:** [role-permission-audit.md](archive/role-permission-audit.md) (archived), `src/App.tsx`, `supabase/migrations/*rls*.sql`, `src/hooks/useLocationPermissions.ts`.

## Role model
`app_role` = **OWNER, MANAGER, STAFF** only (`20260212001141_initial_schema_core_rls.sql:3`). No ACCOUNTANT/ADMIN.
- **OWNER** — hard-coded all-permissions-true in UI (`useLocationPermissions.ts:15-24`).
- **MANAGER** — "Manager+" in RLS (`has_restaurant_role_any(OWNER,MANAGER)`); per-location flags read from `user_location_assignments`.
- **STAFF** — default role; `is_member_of` only.

## The four layers
1. **UI** — route guards (`ProtectedRoute`/`OwnerRoute`/`StaffRestrictedRoute`) + in-component flag gates (`can_see_costs`, `can_approve_orders`, `can_edit_par`).
2. **API/REST** — PostgREST: whatever RLS allows is reachable via `supabase-js` regardless of UI.
3. **RLS** — Postgres row policies (the real server gate for table CRUD).
4. **RPC** — SECURITY DEFINER functions (`submit_smart_order`, `approve_inventory_session_atomic`, `confirm_invoice_receipt`) carry their own checks.

> **Cross-cutting truth:** the six per-location permission flags are **UI-only** — no RLS or RPC reads them. They shape what the UI renders/sends but cannot stop a crafted API call (`role-permission-audit.md §1.2`).

## Legend (cell format `UI→API`)
- `✅` allowed · `❌` blocked · `n/a` operation not on page
- `UI→API` shows both layers. Mismatch markers:
  - **`❌→✅⚠️`** = UI blocks but API/RLS allows → **privilege leak** (the dangerous case)
  - **`✅→❌`** = UI offers but API blocks → broken UX
  - `✅→✅` / `❌→❌` = aligned

---

# PART A — Page × Operation × Role

### Dashboard · `/app/dashboard` · unguarded (all roles)
| Op | OWNER | MANAGER | STAFF | Notes |
|----|:-----:|:-------:|:-----:|-------|
| View | ✅→✅ | ✅→✅ | ✅→✅ | Cost KPIs (`can_see_inventory_value`/`can_see_food_cost_pct`) **UI-masked only**; tables API-readable ⚠️ |
| Create/Edit/Delete/Approve | n/a | n/a | n/a | Read-only |
| Export | n/a | n/a | n/a | No export control |

### My Restaurants · `/app/restaurants` · unguarded
| Op | OWNER | MANAGER | STAFF | Notes |
|----|:-----:|:-------:|:-----:|-------|
| View | ✅→✅ | ✅→✅ | ✅→✅ | Shows per-restaurant "Money Lost" (formula UNKNOWN) |
| Create (new restaurant) | ✅→✅ | ✅→✅ | ✅→✅ | `/restaurants/new` unguarded — any member can create |
| Edit/Delete restaurant | **UNKNOWN** | UNKNOWN | UNKNOWN | UI/RLS for restaurant edit/delete not traced — needs `restaurants` table policy |

### Inventory Count / Enter · `/app/inventory/enter` · **unguarded (STAFF allowed by design)**
| Op | OWNER | MANAGER | STAFF | Notes |
|----|:-----:|:-------:|:-----:|-------|
| View | ✅→✅ | ✅→✅ | ✅→✅ | |
| Create session / count | ✅→✅ | ✅→✅ | ✅→✅ | `inventory_sessions`/`_items` `is_member_of` |
| Edit counts | ✅→✅ | ✅→✅ | ✅→✅ | STAFF-entered `unit_cost` flows into reorder math |
| **Delete session** | ✅→✅ | ✅→✅ | **❌→✅⚠️** | UI hides delete for STAFF; RLS `is_member_of` (`20260306000002:253-255`) → STAFF deletes via API |
| Approve | n/a | n/a | n/a | Done on Review |
| Export | n/a | n/a | n/a | |

### Inventory Lists / Catalog · `/app/inventory/lists` · StaffRestricted
| Op | OWNER | MANAGER | STAFF | Notes |
|----|:-----:|:-------:|:-----:|-------|
| View | ✅→✅ | ✅→✅ | **❌→✅⚠️** | `inventory_catalog_items` SELECT `is_member_of`; STAFF route-blocked but API-readable |
| Create/Edit/Delete | ✅→✅ | ✅→✅ | **❌→✅⚠️** | Catalog/custom-lists full CRUD `is_member_of` (`§4.8`) |
| Export | ✅→✅ | ✅→✅ | ❌→✅ | `ExportButtons` client-side; STAFF can pull same data via API |

### Inventory Review · `/app/inventory/review` · StaffRestricted
| Op | OWNER | MANAGER | STAFF | Notes |
|----|:-----:|:-------:|:-----:|-------|
| View | ✅→✅ | ✅→✅ | **❌→✅⚠️** | sessions SELECT `is_member_of` (+location scope) |
| Edit | ✅→✅ | ✅→✅ | ❌→split | STAFF "in-progress only" + Manager+ full (`:361-365`) |
| **Approve** (RPC) | ✅→✅ | ✅→✅ | ❌→❌ | `approve_inventory_session_atomic` checks OWNER/MANAGER server-side ✅ |
| **Delete session** | ✅→✅ | ✅→✅ | **❌→✅⚠️** | RLS `is_member_of` leak (same as Count) |

### Inventory Approved · `/app/inventory/approved` · StaffRestricted
| Op | OWNER | MANAGER | STAFF | Notes |
|----|:-----:|:-------:|:-----:|-------|
| View | ✅→✅ | ✅→✅ | ❌→✅⚠️ | |
| Edit ("Suggested Order") | ✅→✅ | ✅→✅ | ❌ | Edits **not persisted** (`Approved.tsx:269-279`) |
| Export | ✅→✅ | ✅→✅ | ❌→✅ | `ExportButtons` present |

### PAR Management · `/app/par` (+ `/suggestions`) · StaffRestricted
| Op | OWNER | MANAGER | STAFF | Notes |
|----|:-----:|:-------:|:-----:|-------|
| View | ✅→✅ | ✅→✅ | ❌→✅⚠️ | |
| Create/Edit PAR | ✅→✅ | **flag→✅⚠️** | ❌→✅⚠️ | UI gates on `can_edit_par`; `par_settings` UPDATE Manager+, `par_guide_items` `is_member_of` → MANAGER w/ `can_edit_par:false` & STAFF can write via API |
| Delete | ✅→✅ | ✅→✅ | ❌→✅⚠️ | `par_guide_items` `is_member_of` |
| Export | ✅→✅ | ✅→✅ | ❌→✅ | `ExportButtons` present |

### Smart Order · `/app/smart-order` · StaffRestricted
| Op | OWNER | MANAGER | STAFF | Notes |
|----|:-----:|:-------:|:-----:|-------|
| View | ✅→✅ | ✅→✅ | ❌→✅⚠️ | Costs UI-gated by `can_see_costs` (UI-only) |
| Create/Edit run | ✅→✅ | ✅→✅ | ❌→✅⚠️ | `smart_order_runs` `is_member_of` |
| **Approve / Submit PO** (RPC) | ✅→✅ | **flag→✅⚠️** | **❌→✅⚠️** | UI gates `can_approve_orders`+`order_approval_threshold` (`SmartOrder.tsx:476-489`); **RPC `submit_smart_order` checks only `is_member_of`** (`20260327000004:20`) → any member submits any-size PO **(P0)** |
| Delete run | ✅→✅ | ✅→✅ | ❌→✅⚠️ | `smart_order_runs` delete `is_member_of` |
| Export | ✅→✅ | ✅→✅ | ❌→✅ | `ExportButtons` present |

### Invoices · `/app/invoices` · StaffRestricted
| Op | OWNER | MANAGER | STAFF | Notes |
|----|:-----:|:-------:|:-----:|-------|
| View | ✅→✅ | ✅→✅ | ❌→✅⚠️ | `invoices` SELECT `is_member_of` (+location) |
| **View costs** | ✅ | **✅ even if `can_see_costs:false`⚠️** | ❌→✅⚠️ | Cost columns **not gated** (`Invoices.tsx:945-953`) — flag ignored **(P1)** |
| Create (upload/parse) | ✅→✅ | ✅→✅ | ❌→✅⚠️ | **`parse-invoice` edge fn: no membership auth** — anyone with `Bearer x` **(P0)** |
| Edit/Delete | ✅→✅ | ✅→✅ | ❌→✅⚠️ | `invoices`/`invoice_items` `is_member_of` |
| Export | n/a | n/a | n/a | No export control |

### Invoice Review + Receipt Confirmation · `/app/invoices/:id/review` · StaffRestricted
| Op | OWNER | MANAGER | STAFF | Notes |
|----|:-----:|:-------:|:-----:|-------|
| View | ✅→✅ | ✅→✅ | ❌→✅⚠️ | Cost columns **not gated** (`ComparisonTable.tsx:327,333`) ⚠️ |
| Edit comparisons | ✅→✅ | ✅→✅ | ❌→✅⚠️ | `invoice_line_comparisons` `is_member_of` |
| **Approve (confirm receipt)** (RPC) | ✅→✅ | ✅→✅ | ❌→✅⚠️ | `confirm_invoice_receipt` is **membership-only**, no manager re-check (`20260524000001:36`); UI promises manager confirmation **(P0)** — overwrites cost, writes stock_movements |

### Purchase History · `/app/purchase-history` · StaffRestricted
| Op | OWNER | MANAGER | STAFF | Notes |
|----|:-----:|:-------:|:-----:|-------|
| View | ✅→✅ | ✅→✅ | ❌→✅⚠️ | `purchase_history` SELECT `is_member_of`; costs not gated ⚠️ |
| Create/Edit/Delete `purchase_history` | ✅→✅ | ✅→✅ | ❌→❌ | **Correct** — Manager+ (`:139-153`) ✅ |
| Create/Delete `purchase_history_items` | ✅→✅ | ✅→✅ | **❌→✅⚠️** | Policy *named* "Manager+" but clause `is_member_of` (`:172-179`) → STAFF writes line items via API **(P0)** |

### Sales · `/app/sales` · StaffRestricted
| Op | OWNER | MANAGER | STAFF | Notes |
|----|:-----:|:-------:|:-----:|-------|
| View | ✅→✅ | ✅→✅ | ❌→✅⚠️ | `weekly_sales` SELECT `is_member_of` |
| Create/Edit/Delete | ✅→✅ | ✅→✅ | **❌→✅⚠️** | **NEW LEAK** — policies *named* "Managers+ …" but clause is `is_member_of` (`20260518000001_sales_entry.sql:207-231`) → STAFF writes sales via API. Sales feed Food Cost %. |

### Waste Log · `/app/waste-log` · **unguarded (STAFF allowed)**
| Op | OWNER | MANAGER | STAFF | Notes |
|----|:-----:|:-------:|:-----:|-------|
| View | ✅→✅ | ✅→✅ | ✅→✅ | location-scoped SELECT |
| Create | ✅→✅ | ✅→✅ | ✅→✅ | `total_cost` **client-set** → STAFF can inflate Profit Risk input ⚠️ |
| Edit/Delete | ✅→✅ | ✅→✅ | ✅→✅ | `waste_log` `is_member_of` |
| Export | n/a | n/a | n/a | |

### Notifications · `/app/notifications` · unguarded
| Op | OWNER | MANAGER | STAFF | Notes |
|----|:-----:|:-------:|:-----:|-------|
| View | ✅→✅ | ✅→✅ | ✅→✅ | SELECT self-scoped `auth.uid()=user_id` ✅ |
| **Create** | ✅→✅ | ✅→✅ | **✅→✅⚠️** | INSERT `is_member_of` with **no `user_id` check** (`:198-200`) → any member forges a notification (incl. "CRITICAL") to any user **(P0)** |
| Edit/Delete (own) | ✅→✅ | ✅→✅ | ✅→✅ | self-scoped |
| Edit `notification_preferences` | ✅→✅ | ✅→✅ | **✅→✅⚠️** | `is_member_of` → any member (incl. STAFF) changes restaurant-wide alert prefs |

### Settings · `/app/settings` · **OwnerRoute**
| Op | OWNER | MANAGER | STAFF | Notes |
|----|:-----:|:-------:|:-----:|-------|
| View | ✅→✅ | ❌→(read varies) | ❌→❌ | Route blocks MANAGER & STAFF |
| Update settings | ✅→✅ | **❌→✅⚠️** | ❌→❌ | `restaurant_settings`/`inventory`/`par`/`smart_order` UPDATE **Manager+** (`20260306000003:32-35,…`) → MANAGER edits "owner-locked" settings via API **(P1)** |
| Delete settings | ✅→✅ | ❌→❌ | ❌→❌ | OWNER-only RLS ✅ |
| Locations CRUD | ✅→✅ | **❌→✅⚠️** | ❌→❌ | RLS Manager+ (`:59-73`); UI owner-only |
| Change password | ✅ | — | — | **"Current Password" collected but never verified** (`Settings.tsx:195-210`) ⚠️ |

### Billing · `/app/billing` · OwnerRoute
| Op | OWNER | MANAGER | STAFF | Notes |
|----|:-----:|:-------:|:-----:|-------|
| View / Checkout | ✅→✅ | ❌→❌ | ❌→❌ | `create-checkout-session` validates OWNER ✅. Price label inconsistent ($69.99 vs $99) ⚠️ |

### Alerts / Reminders · `/app/settings/alerts`,`/reminders` · OwnerRoute
| Op | OWNER | MANAGER | STAFF | Notes |
|----|:-----:|:-------:|:-----:|-------|
| View | ✅→✅ | ❌ | ❌ | Route owner-only |
| reminders CRUD | ✅→✅ | **❌→✅⚠️** | ❌→✅⚠️(SELECT) | reminders write **Manager+** (`:252-266`) via API; UI owner-only |
| alert_recipients / reminder_targets | ✅→✅ | ❌→✅⚠️ | ❌→✅⚠️ | `is_member_of` writes (`:284-316`) → any member manages recipients via API |

### Audit Center · `/app/settings/audit` · OwnerRoute
| Op | OWNER | MANAGER | STAFF | Notes |
|----|:-----:|:-------:|:-----:|-------|
| View | ✅→✅ | ❌ | ❌ | Read-only; **renders $0 "verified" on load error** (`AuditCenter.tsx:60`) ⚠️ |

---

# PART B — Action × Four-Layer detail (sensitive actions)

| Action | UI permission | API/REST | RLS | RPC | Aligned? |
|--------|---------------|----------|-----|-----|:--------:|
| Submit Smart Order PO | `can_approve_orders` + threshold (`SmartOrder.tsx:476-489`) | reachable | n/a (RPC) | **`is_member_of` only** (`20260327000004:20`) | ❌ |
| Approve inventory session | Manager+ UI | reachable | split update policy | **OWNER/MANAGER check** (`approve_inventory_session_atomic`) | ✅ |
| Confirm invoice receipt | "manager must confirm" copy (`InvoiceReview.tsx:188`) | reachable | n/a | **membership-only, no role/confirm re-check** (`20260524000001:36`) | ❌ |
| Delete inventory session | hidden for STAFF | reachable | **`is_member_of`** (`20260306000002:253-255`) | n/a | ❌ |
| Delete `purchase_history_items` | manager pages | reachable | **`is_member_of`** (named "Manager+", `:172-179`) | n/a | ❌ |
| Write `weekly_sales` | StaffRestricted route | reachable | **Manager+** — member AND location AND `has_restaurant_role_any(OWNER,MANAGER)` (`20260518000001:207-231`) | n/a | ✅ (claim corrected — S0-7) |
| Insert notification for any user | app flows | reachable | **`is_member_of`, no user_id check** (`20260306000003:198-200`) | n/a | ❌ |
| Update restaurant/locations settings | OwnerRoute | reachable | **Manager+** (`20260306000003:32-73`) | n/a | ❌ |
| View invoice costs | none (flag ignored) | reachable | `is_member_of` | n/a | ❌ |
| Parse invoice (AI) | upload UI | **public** | n/a | **Bearer-presence only** (`parse-invoice:147-153`) | ❌ |
| Trigger notification engine | n/a | **public** | n/a | **no auth** (`process-notifications`, verify_jwt=false) | ❌ |
| Ingest email invoice | n/a | **public** | n/a | **no webhook secret verified** (`inbound-invoice-email:155-308`) | ❌ |

---

# PART C — GAP TABLE (all confirmed mismatches, ranked)

| # | Gap | Layer pattern | Roles affected | Evidence | Priority |
|---|-----|---------------|----------------|----------|:--------:|
| G1 | Smart Order submit bypasses approval | UI gate, RPC open | STAFF, limited MANAGER | `20260327000004:20` vs `SmartOrder.tsx:476-489` | **P0** |
| G2 | Inventory session DELETE open | UI hides, RLS open | STAFF | `20260306000002:253-255` | **P0** |
| G3 | `purchase_history_items` write open (name lies) | RLS clause ≠ name | STAFF | `:172-179` | **P0** |
| ~~G4~~ | ~~`weekly_sales` write open (name lies)~~ **CORRECTED — not a leak**: clause enforces Manager+ (name accurate); the `is_member_of` claim was stale (S0-7) | — | — | `20260518000001:207-281` | — |
| G5 | Notification insert for arbitrary user | RLS no user_id check | any member | `20260306000003:198-200` | **P0** |
| G6 | `parse-invoice` no auth | edge fn public | anyone | `parse-invoice:147-153` | **P0** |
| G7 | `process-notifications` no auth | edge fn public | anyone | config.toml + body | **P0** |
| G8 | `inbound-invoice-email` no webhook auth | edge fn public | anyone | `:155-308` | **P0** |
| G9 | `confirm_invoice_receipt` no role/confirm re-check | RPC membership-only | any member | `20260524000001:36` | **P0** |
| G10 | Invoice/Review/PurchaseHistory costs not gated | UI flag missing | MANAGER w/ `can_see_costs:false` | `Invoices.tsx:945-953` | **P1** |
| G11 | Settings UPDATE Manager+ vs Owner-only route | RLS looser than UI | MANAGER | `20260306000003:32-35` | **P1** |
| G12 | Locations CRUD Manager+ vs Owner UI | RLS looser than UI | MANAGER | `:59-73` | **P1** |
| G13 | Reminders/alerts CRUD Manager+/`is_member_of` vs Owner UI | RLS looser than UI | MANAGER/STAFF | `:252-316` | **P1** |
| G14 | `notification_preferences` writable by any member | RLS open | STAFF | `:219-233` | **P1** |
| G15 | PAR write open vs `can_edit_par` UI flag | UI flag, RLS open | MANAGER/STAFF | `par_settings`/`par_guide_items` | **P1** |
| G16 | All 6 per-location flags are UI-only | no RLS/RPC enforcement | MANAGER/STAFF | `useLocationPermissions.ts` | **P1** |
| G17 | Read-only data (catalog/lists/sessions items) writable by STAFF via API | RLS `is_member_of` | STAFF | `§4.8` | **P2** |
| G18 | Write policies not location-scoped (only SELECT is) | RLS scope gap | MANAGER/STAFF | `20260503000006` | **P2** |
| G19 | vendor-import-* lack membership checks (mock today) | edge fn | any token | `§5` | **P2** |

## Pattern summary
- **Dominant pattern: RLS looser than UI** (G1–G5, G9–G15). The UI is the *only* real gate for most write paths; anyone using `supabase-js`/REST directly bypasses it.
- **One policy actively lied** — `purchase_history_items` (G3) was named "Manager+" but enforced `is_member_of` (fixed in S0-6). `weekly_sales` (G4) was originally listed here too, but on verification it **already enforces Manager+** — that claim was **stale/incorrect** (see S0-7). Lesson: review the clause, not the name.
- **Per-location permission flags are cosmetic** (G16) — `can_see_costs`, `can_approve_orders`, `can_edit_par` shape the UI but enforce nothing server-side.
- **Edge functions G6–G8 are unauthenticated** — exploitable without any account.

## UNKNOWNs (need a specific file to resolve)
| # | UNKNOWN | Needed |
|---|---------|--------|
| 1 | `restaurants` table edit/delete policies (My Restaurants) | Read the `restaurants` RLS migration |
| 2 | "Money Lost this week" data source on My Restaurants | `loadRestaurantPortfolioSummaries.ts` |
| 3 | Exact `confirm_invoice_receipt` body role logic | Full RPC migration read |
| 4 | `dispatch-app-notifications` body-level auth (config says verify_jwt=true) | Read function body |

> No application code was modified in producing this matrix.
