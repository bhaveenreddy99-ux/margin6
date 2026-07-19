# 02 — Feature Inventory (Phase 3)

Status legend: **Prod-ready** (works + server-enforced), **Functional** (works, gaps in enforcement/observability), **Partial** (incomplete), **Mock/Stub** (not real), **Dead** (present but unused).

Role model: `app_role = OWNER | MANAGER | STAFF` (`20260212001141`). Six per-location flags (`can_see_costs`, `can_see_food_cost_pct`, `can_see_inventory_value`, `can_approve_orders`, `can_edit_par`, `order_approval_threshold`) live on `user_location_assignments`/`user_invites` and are **UI-enforced only** unless noted.

---

## F1 — Authentication & Account
- **Purpose:** Email/password auth, signup, password reset.
- **Roles:** all.
- **Pages:** `Login`, `Signup`, `ForgotPassword`, `ResetPassword`.
- **Tables/RPC:** `supabase.auth.*`; `profiles` (created by `handle_new_user` trigger); `get_invite_preview` RPC for invite-aware signup.
- **Status:** **Functional.** Missing: MFA, SSO, email verification enforcement not traced. Password change on Settings collects "current password" but does not verify it (`Settings.tsx`).

## F2 — Multi-Restaurant / Multi-Tenant Portfolio
- **Purpose:** A user can belong to multiple restaurants with a role each; switch between them; portfolio rollup.
- **Roles:** all; owners see all restaurants they own.
- **Pages:** `MyRestaurants`, `AppHeader` switcher.
- **Hooks/Domain:** `RestaurantContext`, `loadRestaurantPortfolioSummaries.ts`.
- **Tables/RPC:** `restaurant_members`, `restaurants`, `user_ui_state`, `create_restaurant_with_owner`, `delete_restaurant_cascade`.
- **Status:** **Functional.** Isolation via RLS `is_member_of`. `/app/restaurants/new` is not role-gated (any member can create a restaurant).

## F3 — Restaurant Creation & Onboarding
- **Purpose:** Create a restaurant (+ optional demo seed), seed settings/location, generate an inbound invoice email address; onboarding checklist.
- **Pages:** `onboarding/CreateRestaurant`, `Demo`, `OnboardingChecklist`.
- **Tables/RPC:** `create_restaurant_with_owner` (SECURITY DEFINER, seeds owner membership + optional demo graph), `restaurant_settings`, `locations`.
- **Status:** **Functional.**

## F4 — Team Invitations & Role Management
- **Purpose:** Invite teammates by email with a role + location + permission flags; accept/preview/list/revoke/resend.
- **Roles:** OWNER (and MANAGER for limited invites) create; invited user accepts.
- **Pages:** `AcceptInvite`, `Signup` (invite-aware), team section in `Settings`/`useLocationSettings`.
- **Edge/RPC:** `send-invite` edge fn (OWNER check + Resend email); RPCs `create_invite`, `accept_invite`, `list_invites`, `revoke_invite`, `resend_invite`, `get_invite_preview`, `accept_user_invites`, plus legacy `invitations` table + accept trigger.
- **Tables:** `restaurant_invites` (new, hardened, role can't be OWNER, token hashed), `user_invites` (legacy w/ permission flags), `invitations` (legacy).
- **Status:** **Functional**, but **two/three parallel invite mechanisms coexist** (`invitations`, `user_invites`, `restaurant_invites`) — see Technical Debt.

## F5 — Location Management & Permissions
- **Purpose:** Locations per restaurant; per-user location assignments with role + 6 permission flags; internal auto-selection.
- **Pages:** `Settings` (locations/team); no user-facing location picker.
- **Hooks/RPC:** `useLocationPermissions`, `get_location_permissions`, `user_accessible_location_ids`, `user_can_access_location`, `location_settings`.
- **Status:** **Functional (UI) / Partial (enforcement).** SELECT policies are location-scoped; **write policies largely are not** and permission flags are UI-only.

## F6 — Inventory List & Catalog Management
- **Purpose:** Build inventory lists, catalog items (with pack size, unit cost, PAR, vendor, product number), categories/category-sets, drag-drop ordering, import/export.
- **Roles:** OWNER/MANAGER (StaffRestricted route); STAFF blocked in UI only.
- **Pages:** `ListManagement`, `inventory/Import`.
- **Hooks/Domain:** `useListManagementData/Actions`, `useCategoryMapping`, `catalog-identity`, `pack-parser`.
- **Tables:** `inventory_lists`, `inventory_catalog_items`, `list_categories`, `list_category_sets`, `list_item_category_map`, `custom_lists/_items`, `import_templates`, `import_runs`, `inventory_import_files`.
- **Status:** **Functional.** Catalog/list CRUD is `is_member_of` (any role writable via API). Two category systems exist (legacy `categories`/`inventory_items`/`par_items` vs current `list_categories` map).

## F7 — Inventory Counting (Sessions + Zones)
- **Purpose:** Session-based counting with status lifecycle (`IN_PROGRESS → IN_REVIEW → APPROVED`), universal count input (count in cases/units/weight), per-zone counting with normalization + reconciliation, phone/tablet/desktop views, offline guards.
- **Roles:** all (STAFF explicitly allowed).
- **Pages:** `EnterInventory` → `InventoryCountPage` (feature module: 17 components, 8 hooks).
- **Domain:** `sessionWorkflow`, `sessionSelectors`, `zoneCounting`, `zoneReconcile`, `loadSessionItemsWithZones`, `planningUnitMeta`, `inventory-conversions`.
- **Tables/RPC:** `inventory_sessions`, `inventory_session_items`, `inventory_session_item_zones`; approval via `approve_inventory_session_atomic`.
- **Status:** **Prod-ready-ish.** Approved counts immutable (UI lock + approval-only-from-IN_REVIEW in RPC). Session delete restricted post-hardening. Server-side immutability of approved *items* is UI-enforced (NOT VERIFIED as DB-trigger-enforced).

## F8 — Inventory Review & Approval
- **Purpose:** Manager reviews in-review sessions, adjusts risk/order, approves (atomic) or sends back; reopen policy blocks reopening if downstream effects exist.
- **Roles:** OWNER/MANAGER.
- **Pages:** `inventory/Review`, `inventory/Approved`.
- **RPC:** `approve_inventory_session_atomic` (checks OWNER/MANAGER + status + duplicate lines; creates smart-order run atomically).
- **Status:** **Prod-ready.** Approval is server-authorized (one of the few fully-aligned write paths).

## F9 — PAR Guides & Suggestions
- **Purpose:** Maintain PAR levels per item (guides), sync to catalog defaults, suggest PAR changes, request PAR changes via notification.
- **Roles:** OWNER/MANAGER (UI `can_edit_par` flag).
- **Pages:** `ParHub` → `PARManagement`, `PARSuggestions`.
- **Domain:** `parGuideLevels`, `parHealth`, `catalogParSync`.
- **Tables:** `par_guides`, `par_guide_items` (write now Manager+ after `20260624000003`), `par_settings`, legacy `par_items`.
- **Status:** **Functional.** PAR resolution precedence: guide-by-catalog-id → guide-by-name → session PAR → catalog default → none.

## F10 — Smart Order (Suggested Ordering)
- **Purpose:** From an approved count, compute suggested order quantities (case-based), risk-band items, pick a single vendor, and submit a PO.
- **Roles:** OWNER/MANAGER; submit gated by `can_approve_orders` + `order_approval_threshold` (UI) **and** `submit_smart_order` RPC (server, post-hardening).
- **Pages:** `SmartOrder`.
- **Domain:** `smartOrderFromSession`, `reorderEngine`, `casePlanningEngine`, `smartOrderVendor`, `invoiceCostLookup`, `riskThresholds`.
- **Tables/RPC:** `smart_order_runs`, `smart_order_run_items`, `smart_order_settings`, `submit_smart_order` (enforces approval), `generate_po_number`, `purchase_orders`, `purchase_order_items`.
- **Status:** **Prod-ready-ish.** Approval enforcement added `20260623000006`. Vendor selection blocks multi-vendor runs.

## F11 — Purchase Orders & Purchase History
- **Purpose:** POs generated from smart orders; purchase history timeline (PO + invoices + legacy).
- **Pages:** `PurchaseHistory`.
- **Tables/RPC:** `purchase_orders`, `purchase_order_items`, `purchase_history`, `purchase_history_items` (write Manager+ post-hardening), `generate_po_number`, `restaurant_counters`.
- **Status:** **Functional.**

## F12 — Invoice Ingestion & Parsing
- **Purpose:** Get supplier invoices in via (a) manual upload, (b) inbound email, (c) vendor import (mock); parse with AI into header + line items; store PDF.
- **Pages:** `Invoices` (upload/create/edit), `VendorConnectTab`.
- **Edge:** `parse-invoice` (Anthropic Claude; auth via service-key OR user membership), `inbound-invoice-email` (Resend webhook, Svix-verified), `vendor-import-invoices*` (mock).
- **Tables/RPC:** `invoices`, `invoice_items`, `invoice_ingestions`, storage `invoice-uploads`, `failed_inbound_emails` (dead-letter), `get_delivery_issue_pos`.
- **Status:** **Functional.** Real AI parsing. Inbound email returns 200 on attachment-download failure (can silently drop).

## F13 — Invoice Review, 3-Way Compare & Receiving
- **Purpose:** Reconcile invoice lines vs PO vs received qty; detect qty/price/total variance; report issues; confirm receipt (updates stock + last cost).
- **Roles:** OWNER/MANAGER; receipt confirm now manager-enforced (RPC).
- **Pages:** `InvoiceReview` + `ComparisonTable`, `ConfirmReceiptDialog`, `ReportIssueSheet`.
- **Domain:** `buildComparisonRows`, `invoiceReviewSelectors`, `receivingEngine`, `resolveInvoiceLineCatalogMatch`, `strongMatchInvoiceItems`, `invoice-comparison`.
- **Tables/RPC:** `invoice_line_comparisons`, `delivery_issues`, `stock_movements`, `confirm_invoice_receipt` (SECURITY DEFINER, manager check + received-qty→cases conversion + price sync + notifications), `reprocess_invoice_item_stock`, `get_invoice_stock_audit`, `get_pack_unit_issues`, `normalize_received_qty_to_cases`.
- **Status:** **Prod-ready-ish.** Strong matching by SKU/product-number/name; tolerances qty(1%/0.01), price(1%/0.01), total(1%/1). Cost columns NOT gated by `can_see_costs`.

## F14 — Invoice → Catalog Cost & Stock Sync
- **Purpose:** Confirming receipt updates catalog `default_unit_cost` (last paid cost) and increments stock via `stock_movements`; trigger `trg_sync_catalog_price_on_receive` keeps catalog price in sync.
- **Status:** **Functional.** DB-rule: "invoice receipt drives last paid cost."

## F15 — Waste Logging
- **Purpose:** Log wasted items (qty/unit/reason/cost) → feeds shrinkage/profit-leak KPIs.
- **Roles:** all (STAFF allowed).
- **Pages:** `WasteLog`.
- **Domain:** `recordedWasteValue`, `wasteMetricsAggregate`, `wasteDrilldownRows`.
- **Tables:** `waste_log` (write `is_member_of`; `total_cost` client-set).
- **Status:** **Functional.** Client-set cost is a data-integrity risk for KPIs.

## F16 — Sales Entry
- **Purpose:** Weekly/daily sales entry (gross, tax, comps, discounts, net) for food-cost % denominator.
- **Roles:** OWNER/MANAGER (write reasserted Manager+ `20260623000003`).
- **Pages:** `Sales`.
- **Domain:** `upsertSales`, `loadSalesForWeek`.
- **Tables:** `weekly_sales`, `daily_sales` (+ daily→weekly aggregation trigger).
- **Status:** **Prod-ready-ish** (server-enforced write role).

## F17 — Trust-First KPI Dashboard
- **Purpose:** Owner/manager dashboard: money lost, food cost %, inventory value, reorder need, overstock/cash-trap, price-hike alerts, shrinkage, profit leaks — each with **confidence badges** and a **data-quality score**.
- **Pages:** `Dashboard`, `DashboardRouter`, cards (`ProfitLeaksCard`, `PriceHikeAlertsCard`, `ShrinkageAlertCard`, `OverstockCashTrapCard`, `ProfitRiskWidget`), `DrilldownSheet`, explainability sheets.
- **Domain:** `dashboard/*` loaders + `buildDashboardSnapshot`, `dashboardTrustFormulas`, `dataQuality/*`.
- **Status:** **Functional & differentiated.** Fails loudly (error flags) rather than showing false `$0`. Cost KPIs UI-masked by flags but underlying tables API-readable.

## F18 — Employee (STAFF) Dashboard
- **Purpose:** Count-only view; no financial data even fetched (money dashboard is lazy-loaded past the STAFF check).
- **Pages:** `EmployeeDashboard`, `useEmployeeCountStatus`.
- **Status:** **Prod-ready.** Good privacy-by-design (STAFF never downloads KPI code).

## F19 — Notifications & Alerts
- **Purpose:** In-app + email alerts: low stock, price change, invoice parsed, count reminders/overdue, digests, shrinkage, weekly loss.
- **Pages:** `Notifications`; settings `AlertSettings`, `ReminderSettings`, `InventorySchedule`.
- **Edge/RPC:** `process-notifications` (cron worker), `dispatch-app-notifications` (event), `create_member_notifications` (RPC-only insert, type allowlist), `notify_delivery_issues`, `notify_pack_conversion_failures`.
- **Tables:** `notifications` (insert RPC-only after hardening), `notification_preferences`, `alert_recipients`, `reminders`, `reminder_targets`.
- **Status:** **Functional.** Realtime feed. Timezone handling uses fixed offsets (no DST). `notification_preferences` writable by any member.

## F20 — Billing & Subscription (Stripe)
- **Purpose:** 14-day trial + $99/mo subscription; checkout; webhook state sync; trial banner; entitlement resolution.
- **Roles:** OWNER only.
- **Pages:** `Billing`, `Pricing`, `TrialBanner`.
- **Edge:** `create-checkout-session` (OWNER check), `stripe-webhook` (signature verify).
- **Domain:** `resolveEntitlement` (single source of truth).
- **Tables:** `restaurants.{subscription_status, trial_ends_at, stripe_customer_id, stripe_subscription_id}` (`20260521000001`).
- **Status:** **Built but enforcement OFF.** `SUBSCRIPTION_LAUNCH_CUTOFF = 2027-01-01` grandfathers all; `readOnly` posture computed but never acted upon. Pricing label inconsistency noted historically ($69.99 vs $99).

## F21 — Public Demo & Leak Audit (lead-gen)
- **Purpose:** `/demo-live` read-only dashboard; `/audit` anonymous invoice "leak audit" (upload → AI parse → estimated weekly loss + PDF).
- **Edge:** `portfolio-dashboard` (deprecated), `audit-invoice-anon` (no caller auth; uses service role to call parse-invoice).
- **Status:** **Functional (marketing).** `audit-invoice-anon` unauthenticated AI fan-out is a cost/abuse surface.

## F22 — Settings & Audit Center
- **Purpose:** Restaurant settings, inventory/PAR/smart-order settings, templates, destructive delete; KPI explainability/audit center.
- **Roles:** OWNER (route) — but many settings tables are Manager+ writable at RLS.
- **Pages:** `Settings`, `settings/AuditCenter`.
- **Status:** **Functional.** UI/RLS mismatch on settings write (Manager+ can write via API).

## F23 — Export (PDF / Excel)
- **Purpose:** Export tables/dashboards to PDF (jsPDF) / xlsx.
- **Components:** `ExportButtons`, `lib/export-utils`.
- **Status:** **Functional**, client-side (no server export authz).

---

## Dead / stub / partial features (verified)

| Item | State | Evidence |
|---|---|---|
| **Recipes** (`recipeCostEngine`, `useRecipeData/Actions`) | **Partial/Dead-ish.** Recipe DB tables were created (`20260417000002`) then **dropped** (`20260502000001_drop_unused_recipe_tables`). Hooks/engine remain; no recipe tables in schema/types. | migrations + `types.ts` (no recipe tables) |
| `buildMoneyLeakSnapshot` (reports) | **Dead** — only referenced by its test, no runtime import. | subagent finding |
| `orders` / `order_items` / `usage_events` | **Legacy/near-dead.** Superseded by `purchase_orders`/`smart_order_runs`; `usage_events` cleanup migrations exist. | migrations `20260307000005`, `20260327000001` |
| `categories` / `inventory_items` / `par_items` | **Legacy** first-gen list model, superseded by catalog + `list_categories`. | types + list-management code |
| `vendor-import-invoices*` edge functions | **Mock** — return `is_mock: true`, no real vendor API. | function bodies |
| `portfolio-dashboard` edge function | **Deprecated** but still called by PublicDemo. | function header comment |
| `invoiceStatusLifecycle.shouldPersistDerivedStatus` | Exists but duplicated inline in hook rather than imported. | subagent finding |

## Missing pieces per feature (summary)
- **No server-side enforcement of per-location permission flags** (F5/F10/F13/F22).
- **No MFA/SSO/email-verification enforcement** (F1).
- **Billing enforcement not wired** (F20).
- **Vendor integrations are mock** (F12).
- **Recipes not usable** (dropped tables).
