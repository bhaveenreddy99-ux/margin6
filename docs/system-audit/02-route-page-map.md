# 02 — Route and Page Map

Every route from `src/App.tsx`. Status reflects **code inspection + local baseline 2026-07-10** where noted.

**Legend:** Auth = authentication required. Roles = effective access after route guards.

---

## Public routes

| URL | Component | Auth | Roles | Location | Main action | Status | Risks |
|-----|-----------|------|-------|----------|-------------|--------|-------|
| `/` | `Landing.tsx` | No | All | — | Marketing | Complete | — |
| `/pricing` | `Pricing.tsx` | No | All | — | Pricing info | Complete | — |
| `/login` | `Login.tsx` | No | All | — | `signInWithPassword` → `/app/dashboard` or onboarding | **Working** | Redirect logic if 0 restaurants |
| `/signup` | `Signup.tsx` | No | All | — | `signUp`; invite email lock via `get_invite_preview` | **Working** | Email confirm config-dependent |
| `/accept-invite` | `AcceptInvite.tsx` | Optional | Invitee | — | `get_invite_preview` + `accept_invite` RPC | **Working** | New invite system |
| `/forgot-password` | `ForgotPassword.tsx` | No | All | — | Reset email | **Working** | — |
| `/reset-password` | `ResetPassword.tsx` | No | All | — | Password update | **Working** | — |
| `/demo` | `Demo.tsx` | Yes (via redirect) | Demo users | — | Demo restaurant access | **Working** | Demo-only seed |
| `/demo-live` | `PublicDemo.tsx` | No | All | — | Public demo | Unverified | — |
| `/audit` | `LeakAudit.tsx` | No | All | — | Calls `audit-invoice-anon` edge fn | **Working** | Public parse endpoint |
| `/onboarding/create-restaurant` | `CreateRestaurant.tsx` | Yes | Authenticated | — | `create_restaurant_with_owner` RPC | **Working** | — |
| `*` | `NotFound.tsx` | No | All | — | 404 | Complete | — |

---

## App shell (`/app`)

| URL | Component | Auth | Roles | Location | Hooks / RPCs | Main action | Status | Risks |
|-----|-----------|------|-------|----------|--------------|-------------|--------|-------|
| `/app` | `SmartLanding` | Yes | All members | — | `useRestaurant` | Redirect ≥2 restaurants → `/restaurants`; else dashboard | **Working** | — |
| `/app/dashboard` | `DashboardRouter.tsx` | Yes | STAFF → EmployeeDashboard; OWNER/MANAGER → Dashboard | Current location | STAFF: `useEmployeeCountStatus`; Owner: `useDashboardData` + 8 loaders | KPIs vs count CTA | **Partial** | Owner KPI $0 in baseline |
| `/app/restaurants` | `MyRestaurants.tsx` | Yes | All | — | `restaurant_members` | Switch restaurant | **Working** | — |
| `/app/restaurants/new` | `CreateRestaurant.tsx` | Yes | All | — | `create_restaurant_with_owner` | Add restaurant | **Working** | — |
| `/app/inventory/lists` | `ListManagement.tsx` | Yes | OWNER/MANAGER | Scoped | `useListManagementData` | Manage lists, catalog | **Partial** | E2E smoke only |
| `/app/inventory/enter` | `EnterInventory.tsx` → `InventoryCountPage` | Yes | All | Required for count | `useSessionCommands`, zone pipeline | Count entry, submit | **Partial** | Qty input skip in baseline |
| `/app/inventory/review` | `Review.tsx` | Yes | OWNER/MANAGER | Scoped | `sessionWorkflow.approveInventorySession` | Approve/decline counts | **Partial** | Full reject flow not baseline-tested |
| `/app/inventory/approved` | `Approved.tsx` | Yes | OWNER/MANAGER | Scoped | `moveApprovedInventorySessionToReview` | View approved, reopen guarded | **Partial** | — |
| `/app/inventory/import/:listId` | `Import.tsx` | Yes | OWNER/MANAGER | — | Import templates, catalog | CSV import | Unverified | — |
| `/app/smart-order` | `SmartOrder.tsx` | Yes | OWNER/MANAGER | Scoped | `submit_smart_order`, `useLocationPermissions` | Edit/submit PO | **Partial** | Server enforces approval threshold |
| `/app/par` | `PARManagement.tsx` | Yes | OWNER/MANAGER | Scoped | PAR guides, `can_edit_par` | PAR management | Unverified UI | — |
| `/app/par/suggestions` | `PARSuggestions.tsx` | Yes | OWNER/MANAGER | Scoped | Usage analytics | PAR suggestions | Unverified UI | — |
| `/app/invoices` | `Invoices.tsx` | Yes | OWNER/MANAGER | Scoped | `useInvoicesData`, `useInvoiceActions` | List/create invoices | **Partial** | Review nav works in baseline |
| `/app/invoices/:id/review` | `InvoiceReview.tsx` | Yes | OWNER/MANAGER | Invoice location | `confirm_invoice_receipt`, comparisons | Review/post receipt | **Partial** | Confirm not baseline-tested |
| `/app/purchase-history` | `PurchaseHistory.tsx` | Yes | OWNER/MANAGER | — | `purchase_history` (legacy) | Historical PO view | Legacy | Dual PO model |
| `/app/waste-log` | `WasteLog.tsx` | Yes | All | Scoped | `waste_log` | Log waste | **Partial** | DB math verified; UI not baseline-tested |
| `/app/sales` | `Sales.tsx` | Yes | OWNER/MANAGER | Location | `weekly_sales`, `daily_sales` | Manual sales entry | Unverified UI | — |
| `/app/notifications` | `Notifications.tsx` | Yes | All | Restaurant | `useNotifications` | View/mark read | **Working** | — |
| `/app/settings` | `Settings.tsx` | Yes | OWNER only | Restaurant | `useLocationSettings`, team invites | Profile, team, locations | **Partial** | Large monolith page |
| `/app/billing` | `Billing.tsx` | Yes | OWNER only | — | Stripe checkout fn | Subscription | Unverified | — |
| `/app/settings/alerts` | `AlertSettings.tsx` | Yes | OWNER | — | `notification_preferences` | Alert config | Unverified | — |
| `/app/settings/reminders` | `ReminderSettings.tsx` | Yes | OWNER | — | `reminders` | Reminder config | Unverified | — |
| `/app/settings/audit` | `AuditCenter.tsx` | Yes | OWNER | — | Dashboard KPI audit | Trust verification | Unverified | — |

---

## Redirect-only routes

| URL | Target |
|-----|--------|
| `/app/orders` | `/app/invoices` |
| `/app/reports`, `/app/reports/compare` | `/app/dashboard` |
| `/app/staff`, `/app/locations`, `/app/settings/locations` | `/app/settings` |

---

## Missing routes (code exists, no route)

| Expected | Code exists | Evidence |
|----------|-------------|----------|
| `/app/recipes` | Hooks + domain | `useRecipeData.ts`; tables **dropped**; `recipes.smoke.spec.ts` fails |

---

## Page deep notes (major pages)

### Login (`Login.tsx`)
- **Why:** Authenticate users
- **Data:** Supabase Auth only
- **After success:** Count restaurants → dashboard or onboarding
- **Server protection:** N/A (public)
- **Mock data:** No

### DashboardRouter
- **Why:** Role-adaptive entry
- **STAFF sees:** Count CTA only — **no money fetch** (verified test: `dashboard-role-routing.test.tsx`)
- **OWNER/MANAGER sees:** Full `Dashboard.tsx` with `useDashboardData`
- **Risk:** Manager gets same financial surface as owner

### InventoryCountPage
- **Why:** Primary count workflow
- **Tables:** `inventory_sessions`, `inventory_session_items`, `inventory_session_item_zones`
- **Actions:** Create session, zone/legacy stock writes, submit for review
- **Server:** RLS on sessions; staff can submit IN_PROGRESS → IN_REVIEW
- **Failure:** Toast errors; optimistic status checks

### SmartOrder
- **Why:** Turn approved count into purchasable order
- **RPC:** `submit_smart_order(p_run_id)` creates `purchase_orders`
- **Approval gate:** Client `can_approve_orders` + threshold; server `can_approve_order_amount` in RPC (migration `20260623000006`)
- **Failure:** User-facing RPC error mapping

### InvoiceReview
- **Why:** Three-way match + receipt posting
- **RPC:** `confirm_invoice_receipt` — requires manager+ (`can_confirm_receipt`)
- **Pre-guards:** `validateReceivingBeforeConfirm`, confirmed received qty
- **Failure:** JSON `{success:false}` handled without throw

### Settings
- **Why:** Owner business configuration
- **Sections:** Profile, business, invoice email, inventory defaults, schedule, locations, team, audit
- **Team:** Merges `list_invites` RPC + legacy `invitations` table
- **Server:** Location CRUD owner-only; team via edge function

---

## Navigation source

Role-filtered sidebar: `src/components/AppSidebar.tsx`  
Route titles: `src/components/AppHeader.tsx` (`routeNames` map)
