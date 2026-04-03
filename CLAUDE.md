# CLAUDE.md — RestaurantIQ Codebase Intelligence

This file is the single source of truth for any AI assistant or developer working on RestaurantIQ.
Read this entire file before touching any code. No exceptions.

Last updated: April 2026 — generated from full codebase analysis.

---

## 1. What this app is

**RestaurantIQ** is a multi-tenant B2B SaaS web app for restaurant back-office operations.

Target customer: Independent restaurant owners — both single-location and multi-location — who can't afford MarketMan ($200-400/mo) or Restaurant365 ($435+/mo). RestaurantIQ targets $49-$299/mo.

**Location model:**
- Single-location owners: full access on all plans — the majority of customers
- Multi-location owners: supported on all plans via the `locations` table — each location can have its own inventory sessions, PAR guides, and counts
- Location is optional — if a restaurant has no locations configured, all operations default to the restaurant level
- The schema already supports multi-location via `locations` table and optional `location_id` on `inventory_sessions`
- UI should never assume single-location — always check if locations exist and show location selector when they do

**What it does:**
- Inventory list management (what items a restaurant tracks)
- Physical inventory counts (sessions with submit/review/approve workflow)
- PAR management (target stock levels per item)
- Smart order generation (suggested orders from approved counts + PAR)
- Purchase orders (formal POs after smart order submit)
- Invoice receiving (vendor invoice matching against POs)
- Stock movements (append-only ledger of all inventory changes)
- Waste logging
- Reports and analytics
- Notifications and alerts

**What it is NOT:**
- Not a POS system
- Not a guest-facing ordering app
- Not a kitchen display system

**Competitors to benchmark against:** MarketMan, Restaurant365, BlueCart, Lightspeed.

---

## 2. Tech stack

| Layer | Technology | Version |
|-------|-----------|---------|
| Frontend | React | 18.3.1 |
| Language | TypeScript | 5.8.3 |
| Build | Vite | 5.4.19 |
| Routing | react-router-dom | 6.30.1 |
| UI components | shadcn/ui + Radix primitives | latest |
| Styling | Tailwind CSS | 3.4.17 |
| Icons | lucide-react | 0.462.0 |
| Backend | Supabase (Postgres + RLS + Edge Functions) | 2.95.3 |
| Server state | @tanstack/react-query | 5.83.0 (UNDERUSED — see §9) |
| Forms | react-hook-form + zod | 7.61.1 / 3.25.76 |
| Charts | recharts | 2.15.4 |
| Export | jspdf + jspdf-autotable + xlsx | latest |
| Toasts | sonner | 1.7.4 |
| Animations | framer-motion | 12.34.0 |
| Drag/drop | @hello-pangea/dnd | 18.0.1 |
| Theming | next-themes (dark mode) | 0.3.0 |
| Tests | Vitest + Testing Library | 3.2.4 |
| Dev server port | 8080 (vite.config.ts) | — |

**Path alias:** `@/*` → `src/*` — always use this, never relative paths from deep files.

**TypeScript strictness warning:** Root tsconfig has `noImplicitAny: false` and `strictNullChecks: false`. This means TypeScript will NOT catch many errors automatically. You must be manually strict. Never add `as any`. Always handle nulls explicitly.

---

## 3. Folder structure — every file mapped

```
restaurantIQ-main/
├── src/
│   ├── App.tsx                          # All routes + providers (QueryClient, ThemeProvider, AuthContext, RestaurantContext)
│   ├── main.tsx                         # Entry point
│   ├── vite-env.d.ts                    # Vite env types
│   │
│   ├── assets/                          # Static images/logos
│   │
│   ├── components/
│   │   ├── AppHeader.tsx                # Top navigation bar, restaurant switcher
│   │   ├── AppSidebar.tsx               # Left sidebar navigation
│   │   ├── DemoRoleSwitcher.tsx         # Demo mode role switcher
│   │   ├── ExportButtons.tsx            # PDF/CSV export buttons (reusable)
│   │   ├── ItemIdentityBlock.tsx        # Brand/identity display for line items
│   │   ├── NavLink.tsx                  # Sidebar nav link component
│   │   ├── OwnerRoute.tsx               # Route guard: owner only
│   │   ├── ParAlertsBanner.tsx          # PAR alerts banner (shown on dashboard/inventory)
│   │   ├── ProtectedRoute.tsx           # Route guard: authenticated users only
│   │   │
│   │   ├── invoices/
│   │   │   ├── InvoiceItemsTable.tsx    # Invoice line items table component
│   │   │   ├── types.ts                 # Invoice-specific TypeScript types
│   │   │   ├── useInvoiceMatching.ts    # Hook: PO vs invoice matching logic
│   │   │   └── VendorConnectTab.tsx     # Vendor integration connect UI
│   │   │
│   │   ├── par/
│   │   │   └── PARImportDialog.tsx      # Multi-step PAR import from spreadsheet
│   │   │
│   │   └── ui/                          # shadcn/ui components — DO NOT MODIFY THESE
│   │       └── [accordion, alert, avatar, badge, button, calendar, card,
│   │           carousel, chart, checkbox, collapsible, command, context-menu,
│   │           dialog, drawer, dropdown-menu, form, hover-card, input-otp,
│   │           input, label, menubar, navigation-menu, pagination, popover,
│   │           progress, radio-group, resizable, scroll-area, select,
│   │           separator, sheet, sidebar, skeleton, slider, sonner, switch,
│   │           table, tabs, textarea, toast, toaster, toggle-group, toggle,
│   │           tooltip, use-toast]
│   │
│   ├── contexts/
│   │   ├── AuthContext.tsx              # User session, auth state — wraps entire app
│   │   └── RestaurantContext.tsx        # Current restaurant, user role, locations — critical for all tenant queries
│   │
│   ├── hooks/
│   │   ├── use-mobile.tsx               # Responsive breakpoint hook
│   │   ├── use-toast.ts                 # Toast hook (sonner wrapper)
│   │   ├── useCategoryMapping.ts        # Maps items to their list categories
│   │   ├── useLastOrderDates.ts         # Last order date per item for smart order
│   │   └── useNotifications.ts          # In-app notification fetch + realtime
│   │
│   ├── integrations/supabase/
│   │   ├── client.ts                    # Supabase browser client — reads VITE_SUPABASE_URL + VITE_SUPABASE_PUBLISHABLE_KEY
│   │   └── types.ts                     # AUTO-GENERATED — run `supabase gen types` to regenerate after schema changes
│   │
│   ├── layouts/
│   │   └── AppLayout.tsx                # Authenticated app shell (sidebar + header + outlet)
│   │
│   ├── lib/
│   │   ├── catalog-identity.ts          # Normalize/match catalog item identity across tables
│   │   ├── export-utils.ts              # PDF/CSV export helpers
│   │   ├── inventory-utils.ts           # getRisk(), computeOrderQty() — CORE PAR/risk math
│   │   ├── invoice-comparison.ts        # PO vs invoice line comparison logic
│   │   ├── invoice-totals.ts            # Invoice total calculations
│   │   ├── procurement-dedupe.ts        # Unify PO + invoice + legacy purchase_history rows
│   │   ├── purchase-history-source.ts   # Purchase history data source abstraction
│   │   ├── usage-analytics.ts           # Usage windows, PAR suggestion engine, spend aggregation
│   │   ├── utils.ts                     # cn() utility (Tailwind class merging)
│   │   └── vendor-presets.ts            # Vendor column mapping presets for import
│   │
│   ├── pages/
│   │   ├── Demo.tsx                     # Demo mode landing
│   │   ├── ForgotPassword.tsx           # Password reset request
│   │   ├── Index.tsx                    # Root redirect
│   │   ├── Landing.tsx                  # Marketing landing page
│   │   ├── Login.tsx                    # Login page
│   │   ├── NotFound.tsx                 # 404
│   │   ├── ResetPassword.tsx            # Password reset form
│   │   ├── Signup.tsx                   # Signup — NOTE: invite token handling incomplete
│   │   │
│   │   ├── onboarding/
│   │   │   └── CreateRestaurant.tsx     # Restaurant creation onboarding step
│   │   │
│   │   └── app/
│   │       ├── Dashboard.tsx            # KPIs, summaries, PAR alerts
│   │       ├── InvoiceReview.tsx        # PO vs invoice compare, issues, confirm receipt — 23 as any casts
│   │       ├── Invoices.tsx             # Invoice list + create/upload
│   │       ├── ListManagement.tsx       # Catalog CRUD, categories, import — 13 as any casts
│   │       ├── Notifications.tsx        # In-app notifications list
│   │       ├── Orders.tsx               # LEGACY — redirects to /app/invoices, do not build here
│   │       ├── PARManagement.tsx        # PAR guides and levels management
│   │       ├── PARSuggestions.tsx       # PAR suggestions from usage history
│   │       ├── PurchaseHistory.tsx      # Unified PO + invoice + legacy rows — N+1 query issue
│   │       ├── Reports.tsx              # Analytics and reporting
│   │       ├── Settings.tsx             # Restaurant settings
│   │       ├── SmartOrder.tsx           # Edit run lines, submit → RPC
│   │       ├── Staff.tsx                # Staff/member management
│   │       ├── WasteLog.tsx             # Waste entries
│   │       │
│   │       ├── inventory/
│   │       │   ├── Approved.tsx         # Approved sessions (read only)
│   │       │   ├── EnterInventory.tsx   # Count sessions — 17 as any casts — P0 BUGS HERE
│   │       │   ├── Import.tsx           # File import for a list
│   │       │   └── Review.tsx           # Review queue for submitted counts
│   │       │
│   │       └── settings/
│   │           ├── AlertSettings.tsx    # Alert configuration
│   │           ├── InventorySchedule.tsx # Inventory schedule settings
│   │           └── ReminderSettings.tsx  # Reminder configuration
│   │
│   └── test/
│       ├── catalog-identity.test.ts
│       ├── example.test.ts
│       ├── inventory-utils.test.ts      # Tests for getRisk() and computeOrderQty()
│       ├── invoice-comparison.test.ts
│       ├── invoice-matching.test.ts
│       ├── invoice-totals.test.ts
│       ├── purchase-history-source.test.ts
│       ├── setup.ts
│       └── usage-analytics.test.ts
│
├── supabase/
│   ├── migrations/                      # SOURCE OF TRUTH for schema — apply in order
│   └── functions/
│       ├── parse-invoice/               # PDF/invoice extraction via AI
│       ├── portfolio-dashboard/         # Multi-location aggregated dashboard
│       ├── process-notifications/       # Scheduled notification processing (service role)
│       ├── send-email/                  # Email sending
│       ├── send-invite/                 # Invitation emails
│       ├── vendor-import-invoices/      # Vendor feed import
│       └── vendor-import-invoice-details/ # Vendor feed line detail import
│
└── docs/
    ├── RESTAURANTIQ_PLAN.md
    └── schema_export.sql
```

---

Items are ordered by the CASE from distributors like Sysco, US Foods, and PFG. Order quantities must always reflect case-pack logic. A restaurant does not order 7.3 lbs of chicken — they order 1 case (40 lbs) or 2 cases (80 lbs). Pack size on inventory_catalog_items must be respected in computeOrderQty() for case-based items.

## 4. Routes (defined in App.tsx)

| Route | Component | Access |
|-------|-----------|--------|
| `/` | Index.tsx | Public — redirects |
| `/landing` | Landing.tsx | Public |
| `/login` | Login.tsx | Public |
| `/signup` | Signup.tsx | Public |
| `/forgot-password` | ForgotPassword.tsx | Public |
| `/reset-password` | ResetPassword.tsx | Public |
| `/demo` | Demo.tsx | Public |
| `/app/dashboard` | Dashboard.tsx | Protected |
| `/app/inventory/lists` | ListManagement.tsx | Protected |
| `/app/inventory/enter` | EnterInventory.tsx | Protected |
| `/app/inventory/review` | Review.tsx | Protected |
| `/app/inventory/approved` | Approved.tsx | Protected |
| `/app/inventory/import/:listId` | Import.tsx | Protected |
| `/app/par` | PARManagement.tsx | Protected |
| `/app/par/suggestions` | PARSuggestions.tsx | Protected |
| `/app/smart-order` | SmartOrder.tsx | Protected |
| `/app/invoices` | Invoices.tsx | Protected |
| `/app/invoices/:id/review` | InvoiceReview.tsx | Protected |
| `/app/purchase-history` | PurchaseHistory.tsx | Protected |
| `/app/waste-log` | WasteLog.tsx | Protected |
| `/app/reports` | Reports.tsx | Protected |
| `/app/notifications` | Notifications.tsx | Protected |
| `/app/orders` | Orders.tsx | Protected — REDIRECTS to /app/invoices |
| `/app/staff` | Staff.tsx | Owner only |
| `/app/settings` | Settings.tsx | Owner only |
| `/app/settings/alerts` | AlertSettings.tsx | Owner only |
| `/app/settings/schedule` | InventorySchedule.tsx | Owner only |
| `/app/settings/reminders` | ReminderSettings.tsx | Owner only |

---

## 5. Database — tables, relationships, and rules

### 5.1 Tenant boundary

Every business table is scoped by `restaurant_id`. RLS policies use helpers:
- `is_member_of(restaurant_id)` — user is a member
- `has_restaurant_role_any(restaurant_id, roles[])` — user has specific role
- `*_restaurant_id()` — resolvers for current tenant

**Never query business tables without restaurant scope. Never hardcode restaurant_id or user_id.**

### 5.2 Current (v2) tables — USE THESE

```
restaurants                    — tenant root
restaurant_members             — user membership + role (OWNER/MANAGER/STAFF)
profiles                       — user profiles
locations                      — optional sub-locations per restaurant
restaurant_settings            — per-restaurant config
restaurant_counters            — atomic counters (e.g. PO numbering)
user_ui_state                  — per-user UI preferences

inventory_lists                — list containers (e.g. "Main Kitchen", "Bar")
inventory_catalog_items        — master item rows per list (USE THIS for items)
list_categories                — categories within a list
list_category_sets             — category groupings
list_item_category_map         — item → category mapping

inventory_sessions             — count session snapshots (IN_PROGRESS/IN_REVIEW/APPROVED)
inventory_session_items        — count lines per session

par_guides                     — PAR guide documents per list
par_guide_items                — PAR levels per item (CANONICAL PAR SOURCE)

smart_order_runs               — suggested order from approved session + PAR guide
smart_order_run_items          — line items for a smart order run

purchase_orders                — formal POs (draft/submitted/partially_received/closed/cancelled)
purchase_order_items           — PO line items

invoices                       — vendor invoices (draft/review/ready_to_receive/confirmed)
invoice_items                  — invoice line items
invoice_line_comparisons       — PO line vs invoice line comparison
delivery_issues                — receiving discrepancies

stock_movements                — APPEND-ONLY ledger of all inventory changes

waste_log                      — spoilage and loss records

notifications                  — in-app notifications
notification_preferences       — per-user notification settings
alert_recipients               — alert routing
reminders                      — scheduled reminders
reminder_targets               — reminder recipients

import_templates               — spreadsheet import column mappings
import_runs                    — import job tracking
inventory_import_files         — import file tracking (overlaps import_runs — use existing pattern)

vendor_integrations            — vendor API connections (currently mock)
vendor_item_mappings           — vendor SKU → catalog item mapping
```

### 5.3 Legacy tables — DO NOT BUILD NEW FEATURES ON THESE

```
inventory_items                — OLD item model, replaced by inventory_catalog_items
par_items                      — OLD PAR model, replaced by par_guide_items
categories                     — OLD category model, replaced by list_categories
purchase_history               — OLD procurement, partially replaced by purchase_orders
purchase_history_items         — OLD procurement lines
orders                         — KITCHEN orders, NOT purchase orders (confusing name)
order_items                    — kitchen order lines
usage_events                   — removed in migration 20260307000005
```

### 5.4 Critical naming confusion — READ THIS CAREFULLY

| Name | What it actually is | Common mistake |
|------|---------------------|----------------|
| `orders` table | Kitchen-style orders | Confusing it with purchase orders |
| `purchase_orders` table | Formal procurement POs | Correct name for purchasing |
| `inventory_items` | LEGACY — old item model | Using instead of inventory_catalog_items |
| `par_items` | LEGACY — old PAR model | Using instead of par_guide_items |
| `import_runs` vs `inventory_import_files` | Duplicate import tracking | Pick the one already used in the file you're editing |

### 5.5 Key relationships (read order for features)

```
inventory_lists
  └── inventory_catalog_items (items belong to a list)
        └── list_item_category_map → list_categories

inventory_sessions (linked to inventory_list_id, optional location_id)
  └── inventory_session_items → inventory_catalog_items

par_guides (linked to inventory_list_id)
  └── par_guide_items (PAR levels — CANONICAL SOURCE)

smart_order_runs (session_id FK + par_guide_id + inventory_list_id)
  └── smart_order_run_items (optional catalog_item_id)

purchase_orders (smart_order_run_id — often 1:1)
  └── purchase_order_items (optional smart_order_run_item_id + catalog_item_id)

invoices (optional purchase_order_id)
  └── invoice_items
        └── invoice_line_comparisons (ties PO lines to invoice lines)
              └── delivery_issues

stock_movements (catalog_item_id + optional invoice_id/invoice_item_id)
```

### 5.6 Postgres RPCs

| RPC | What it does | When to use |
|-----|-------------|-------------|
| `submit_smart_order(p_run_id)` | Creates/updates PO from smart order run | SmartOrder.tsx submit |
| `confirm_invoice_receipt(...)` | Confirms receiving, creates stock movements | InvoiceReview.tsx confirm |
| `notify_delivery_issues(...)` | Delivery issue notifications | InvoiceReview.tsx issues |
| `get_delivery_issue_pos(...)` | Issue/PO lookup | InvoiceReview.tsx |
| `generate_po_number(...)` | Atomic PO numbering | purchase_orders creation |
| `create_restaurant_with_owner` | Onboarding — creates restaurant + owner membership | CreateRestaurant.tsx |
| `delete_restaurant_cascade` | Full restaurant teardown | Settings.tsx danger zone |

**WARNING:** RPC bodies are redefined across migrations. The LAST migration in the chain defines current behavior. When in doubt, read the latest migration file for that RPC.

---

## 6. Core business logic — lib/ modules

### inventory-utils.ts — getRisk() and computeOrderQty()

This is the most critical file. Everything that shows risk status, order quantities, and PAR calculations flows through here.

**getRisk() — CANONICAL RISK CALCULATION**
- Input: `{ current_quantity, par_level }` where `par_level` MUST come from `par_guide_items.par_level` for the active guide
- Returns: `'critical' | 'low' | 'ok' | 'overstock' | 'no-par'`
- Returns `'no-par'` when `par_level` is null/undefined/0
- **Known P0 bug:** EnterInventory.tsx is passing the wrong `par_level` source — it reads from the wrong field instead of the linked par_guide. Fix: ensure par_level passed to getRisk() comes from par_guide_items joined through the active par_guide for the list.

**computeOrderQty()**
- Calculates suggested order quantity
- Known issue: pack size rounding not implemented — rounds to nearest unit, not pack size

### usage-analytics.ts — PAR suggestions engine

- Analyzes historical count data to suggest PAR levels
- Used by PARSuggestions.tsx
- Falls back to PAR-based suggestions when usage history < 14 days

### catalog-identity.ts — item matching

- Normalizes item names/SKUs for matching across tables
- Used when linking invoice items to catalog items

---

## 7. Authentication and roles

**Auth:** Supabase Auth. Session managed in AuthContext.tsx.

**Roles** (stored in `restaurant_members.app_role`):
- `OWNER` — full access including staff management, settings, financials
- `MANAGER` — operational access, can approve counts, edit PAR
- `STAFF` — count entry only, cannot see prices or financials

**Route guards:**
- `ProtectedRoute` — requires authenticated session
- `OwnerRoute` — requires OWNER role

**RLS is the real security layer.** Route guards are UI convenience only. RLS policies enforce data access at the database level.

**NEVER:**
- Put service role key in browser code
- Hardcode user_id or restaurant_id
- Bypass RLS
- Trust route guards alone for security

---

## 8. Environment variables

```
VITE_SUPABASE_URL              — Supabase project URL
VITE_SUPABASE_PUBLISHABLE_KEY  — Supabase anon/publishable key (safe for browser)
```

Stored in `.env.local` — this file MUST be gitignored.
**CRITICAL: If .env.local was ever committed, rotate Supabase keys immediately at supabase.com/dashboard.**
Never embed these values directly in source code.

---

## 9. Known bugs — P0 (fix before anything else)

### BUG 1: STATUS shows "NO PAR" despite correct PAR values
- **File:** `src/pages/app/inventory/EnterInventory.tsx`
- **Root cause:** `getRisk()` is receiving `par_level` from the wrong source. It's reading from `inventory_catalog_items.default_par_level` instead of `par_guide_items.par_level` from the linked par_guide (newest by created_at DESC).
- **Fix:** When loading inventory session items, join through `par_guides` (newest for this list) → `par_guide_items` to get the correct `par_level` for each item. Pass that value to `getRisk()`.
- **Test:** After fix, items with PAR values set in PARManagement.tsx should show correct risk status (critical/low/ok/overstock), not "NO PAR".

### BUG 2: All items group under single category instead of 8 categories
- **File:** `src/pages/app/inventory/EnterInventory.tsx`
- **Root cause:** The `groupBy` key used to group session items by category is reading from the wrong field. It needs to use `list_item_category_map` → `list_categories` for the correct category assignment.
- **Fix:** Ensure category grouping uses `list_item_category_map.category_id` joined to `list_categories.name`, not a legacy category field on the item itself.
- **Test:** After fix, 61 items should appear across 8 categories matching what's configured in ListManagement.tsx.

### BUG 3: computeOrderQty() ignores unit type — wrong order quantities
- **File:** `src/lib/inventory-utils.ts`
- **Root cause:** `computeOrderQty()` accepts `unit` and `packSize` parameters but never uses them. Always does `Math.ceil(needRaw)` regardless of unit type. Liquid/weight items (lb, gal, oz) should use decimal rounding, not ceiling.
- **Fix:** Add unit type branching — if `isDecimalUnitType(unit)` return `Math.round(needRaw × 100) / 100`, else `Math.ceil(needRaw)`.
- **Test:** After fix, run `npm test` — `src/test/inventory-utils.test.ts` should pass. A gallon item needing 2.5 gal should order 2.5, not 3.

### BUG 4: Three-dot menu needs role-based PAR/price editing
- **File:** `src/pages/app/inventory/EnterInventory.tsx`
- **Requirement:** STAFF role editing PAR/price fields should trigger manager notification instead of direct edit. MANAGER/OWNER can edit directly.
- **Fix:** Check role from RestaurantContext. If STAFF, show notification-trigger flow instead of direct save.

---

## 10. Known technical debt (ranked by impact)

### Critical
- `noImplicitAny: false` + `strictNullChecks: false` in tsconfig — TypeScript not fully protecting you
- `.env.local` potentially committed — rotate keys if so
- 150+ `as any` casts across codebase (worst: InvoiceReview 23, EnterInventory 17, ListManagement 13)

### High
- 20+ silent failures — Supabase errors swallowed with no toast or logging
- React Query installed but barely used — most screens do manual fetch with useEffect, causing inconsistent loading/error states and no caching
- N+1 query patterns in PurchaseHistory.tsx, ListManagement.tsx, Dashboard.tsx, PARSuggestions.tsx
- Smart order auto-creation logic duplicated in EnterInventory.tsx AND Review.tsx — fix both when changing

### Medium
- Legacy tables (inventory_items, par_items, categories) coexist with v2 tables in types.ts — confuses AI tools
- Mobile tables missing overflow-x-auto: Reports.tsx, SmartOrder.tsx, WasteLog.tsx, ListManagement.tsx
- Fixed widths without responsive variants in 9+ files
- invite token handling incomplete in Signup.tsx

### Low
- `import_runs` and `inventory_import_files` are duplicate import tracking tables
- `orders` table naming causes confusion (kitchen orders, not purchase orders)
- Commented-out dead code in several files

---

## 11. Missing features by priority

### P0 — Required before first paying customer
- [ ] Stripe billing + `subscriptions` table
- [ ] Onboarding wizard + `onboarding_progress` table
- [ ] Fix BUG 1: NO PAR status in EnterInventory
- [ ] Fix BUG 2: Category grouping in EnterInventory

### P1 — Required for retention
- [ ] Wire `par_settings.default_reorder_threshold` to `getRisk()` thresholds
- [ ] Fix stale smart order after Review edits
- [ ] Variance report (ordered vs received vs counted)
- [ ] Route ParList.tsx
- [ ] Fix invite token in Signup.tsx

### P2 — Growth features
- [ ] Welcome email via Resend
- [ ] Spanish UI for count entry (staff are often Spanish-speaking)
- [ ] Supplier price variance alerts
- [ ] Waste log in main nav
- [ ] Pagination on heavy tables (PurchaseHistory, ListManagement)
- [ ] Real vendor API (currently mock — Sysco or US Foods first)
- [ ] Live current_quantity on catalog items
- [ ] Food cost % (needs POS integration)
- [ ] NPS feedback
- [ ] Referral mechanic

---

## 12. Coding rules — follow these exactly

### TypeScript
- ZERO new `as any` casts — derive types from `src/integrations/supabase/types.ts`
- Handle nulls explicitly — do not assume data exists
- Use `Database['public']['Tables']['table_name']['Row']` for row types
- Props must have explicit TypeScript interfaces — no implicit any on props

### Supabase queries — always handle errors
```typescript
// CORRECT — always do this
const { data, error } = await supabase
  .from('inventory_catalog_items')
  .select('*')
  .eq('restaurant_id', restaurantId);

if (error) {
  toast.error('Failed to load items. Please try again.');
  console.error('inventory_catalog_items fetch error:', error);
  return;
}

// WRONG — never do this
const { data } = await supabase.from('inventory_catalog_items').select('*');
// (error ignored, data assumed to exist)
```

### Table usage rules
```
USE:     inventory_catalog_items    NEVER: inventory_items
USE:     par_guide_items            NEVER: par_items
USE:     list_categories            NEVER: categories (old)
USE:     purchase_orders            NEVER: orders (kitchen orders, not POs)
```

### Component rules
- Components over ~300 lines should be split when you are already touching them
- Mobile-first: every table needs `overflow-x-auto` wrapper
- Every destructive action needs a confirmation dialog
- Every loading state needs a skeleton or spinner — no blank content areas
- Every empty state must say what to do next, not just "No data"

### Error handling
- Every Supabase query: handle `error`, show `toast.error()`
- Every async function: `try/catch`
- Never swallow errors silently

### File change discipline
- Change ONE file at a time
- Run `npm run build` after every change
- Run `npm test` after changing lib/ files
- Never touch `src/components/ui/` — these are shadcn generated files

### Migrations
- Schema changes ONLY via `supabase/migrations/*.sql` files
- Name with timestamp prefix matching existing pattern: `YYYYMMDDHHMMSS_description.sql`
- After schema changes: regenerate `src/integrations/supabase/types.ts` with `supabase gen types typescript`
- Test full flow after changing: `submit_smart_order`, `confirm_invoice_receipt`, or RLS policies

### Security
- Never use service role key in browser code
- Never commit `.env.local`
- Never hardcode restaurant_id or user_id
- Every query must respect restaurant scope

---

## 13. Working protocol — follow every time

1. **Understand** — restate the problem in plain English before writing any code
2. **Plan** — list exactly which files will change and what changes in each
3. **Risk** — identify what could break and how to verify it won't
4. **Execute** — one file at a time, smallest possible diff
5. **Verify** — run `npm run build`, check for TypeScript errors, run relevant tests
6. **Review** — would a tired restaurant manager at 6am understand this UI?

**If asked to change multiple files at once: refuse and do them one at a time.**
**If build fails: fix the build before doing anything else.**
**If unsure about PAR source of truth: always use par_guide_items, never catalog defaults.**

---

## 14. Analytics and KPI formulas — verified against actual code

### Risk calculation (src/lib/inventory-utils.ts — getRisk())

```
percent     = Math.round((currentStock / parLevel) × 100)

NO_PAR      → parLevel is null, undefined, or <= 0
RED         → currentStock <= 0  (out of stock, 0% of PAR)
RED         → percent < redThresholdPercent   (default: 50%)
YELLOW      → percent < yellowThresholdPercent (default: 100%)
GREEN       → percent >= yellowThresholdPercent (fully stocked)
```

Thresholds come from `par_settings.default_reorder_threshold` — NOT hardcoded.
Default red = 50%, default yellow = 100% when no settings exist.
PAR level source MUST be `par_guide_items.par_level` — never `inventory_catalog_items.default_par_level`.

### Order quantity (src/lib/inventory-utils.ts — computeOrderQty())

```
needRaw     = parLevel − currentStock  (if <= 0, return 0)

Decimal units (lb, lbs, gal, gallon, oz, kg, liter, l):
  orderQty  = Math.round(needRaw × 100) / 100  (2 decimal places, no ceiling)

Whole units (cs, case, pk, pack, ea, each) OR pack size contains case/pack:
  orderQty  = Math.ceil(needRaw)  (always round UP, never down)

Default (unknown unit):
  orderQty  = Math.ceil(needRaw)
```

**KNOWN BUG — computeOrderQty() currently ignores unit and packSize parameters entirely.**
Current code does `return Math.ceil(needRaw)` for ALL items regardless of unit type.
Fix needed: use `isDecimalUnitType(unit)` to branch between decimal and ceiling rounding.
Do NOT use the current implementation as a reference — it is wrong.

### Raw need (computeNeedRaw())
```
needRaw = Math.round((parLevel − currentStock) × 100) / 100
```
Returns 0 if par <= 0 or stock >= par.

### Inventory value
```
value = SUM(quantity × unit_cost)
```
Null unit_cost → exclude item from total, show warning in UI. Never fabricate a cost.

### Food cost %
```
Food Cost % = (COGS / Total Revenue) × 100
COGS        = Opening Inventory Value + Purchases − Closing Inventory Value
```
If revenue data is missing → show "—", never show a fabricated %.
Revenue requires POS integration — not yet available. Show placeholder until wired.

### PAR variance
```
Variance    = current_quantity − par_level
Variance %  = (Variance / par_level) × 100  when par_level > 0
```
Understock (negative) → red. At PAR (0) → green. Overstock (positive) → amber.

### Waste cost
```
Waste Cost = SUM(waste_qty × unit_cost)
Waste % of purchases = (Waste Cost / Total Purchases) × 100  (week default)
```

### Order accuracy
```
Order Accuracy % = (items received as ordered / total items ordered) × 100
```
Calculated at line level where PO vs receipt data exists in `invoice_line_comparisons`.

### Inventory turnover
```
Turnover          = COGS / Average Inventory Value
Average Inv Value = (Opening Value + Closing Value) / 2
```
Target context: most restaurants aim for 4-8× per month by category.

### Reorder point (advanced — requires 14+ days history)
```
ROP = (Avg daily usage × Lead time days) + Safety stock
```
If usage history < 14 days → fall back to PAR-based suggestions only. Never fabricate ROP.

### Display rules
- Percentages: 1 decimal place (`toFixed(1)`)
- Currency: 2 decimal places with `$` prefix — use `formatCurrency()` from inventory-utils.ts
- Quantities: whole numbers for case/pack/each — use `formatNum()` from inventory-utils.ts
- Weight/liquid quantities (lb, gal, oz): 2 decimal places
- NEVER show a KPI from null/undefined data — show skeleton during load, "No data yet" when empty
- NEVER fabricate numbers — show "—" when data is genuinely missing

---

## 15. Migration history (newest to oldest — last migration wins for RPCs)

```
20260329120000  workflow_purchase_orders_invoices_stock     ← LATEST
20260328000001  inventory_sessions_counting_par_guide
20260327000007  backfill_missing_purchase_line_totals
20260327000006  separate_purchase_orders_from_purchase_history
20260327000005  fix_delete_restaurant_cascade
20260327000004  serialize_smart_order_submit
20260327000003  invoice_header_totals
20260327000002  safe_receipt_confirmation
20260327000001  cleanup_order_usage_events
20260307000006  invoice_line_total_variance
20260307000005  remove_order_usage_events
20260307000004  safe_receipt_staging_session
20260307000003  add_waste_costing
20260307000002  catalog_ids_for_receiving_and_analytics
20260307000001  delivery_issue_notifications
20260306000006  vendor_item_mappings
20260306000005  po_number_generation
20260306000004  rls_cleanup_remaining
20260306000003  rls_settings_notifications
20260306000002  rls_core_inventory
20260305000002  confirm_receipt_and_po_sync
20260305000001  smart_order_invoice_matching
20260228000001  waste_log
20260226000002  fix_smart_order_brand_name
20260226000001  smart_order_submit
[...earlier migrations establish base schema, RLS, catalog, sessions, PAR, notifications]
```

---

*This file should be updated whenever: schema changes, major architecture decisions are made, new bugs are confirmed, or features move between P0/P1/P2.*