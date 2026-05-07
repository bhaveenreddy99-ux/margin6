# RestaurantIQ — UI inventory & demo guide

> Generated from the codebase (routes, layouts, `AppSidebar`, `AppHeader`, and page components).  
> **Status legend:** **✅ Demo-safe** = polished enough to show; **⚠️ Show with warning** = works but call out data/limitations; **❌ Don’t show** = rough, empty without setup, or risky in front of investors.

---

## Global shell (all `/app/*` routes)

| Item | Details |
|------|--------|
| **Layout** | `src/layouts/AppLayout.tsx` — collapsible `SidebarProvider`, `AppSidebar`, `AppHeader`, scrollable `main` |
| **Route guard** | `src/components/ProtectedRoute.tsx` — full-page spinner on cold start; unauthenticated → `/login`; no restaurants → `/demo` |
| **Owner-only routes** | `src/components/OwnerRoute.tsx` — non-`OWNER` → redirect `/app/dashboard` with loading spinner while restaurant context loads |
| **Toasts** | `Toaster` (shadcn) + Sonner app-wide in `App.tsx` |

### Navigation structure (`src/components/AppSidebar.tsx`)

| Group | Items (path) |
|-------|----------------|
| **Overview** | Dashboard → `/app/dashboard` |
| **Inventory** | List Management → `/app/inventory/lists`; Inventory Management → `/app/inventory/enter`; PAR → `/app/par`; Smart Order → `/app/smart-order`; Recipes → `/app/recipes`; Purchase History → `/app/purchase-history` |
| **Operations** | Invoices (Receiving) → `/app/invoices`; Waste Log → `/app/waste-log` |
| **Insights** | Reports → `/app/reports`; Notifications → `/app/notifications` |
| **Admin** (only if `effectiveRole === "OWNER"`) | Users & Permissions → `/app/staff`; Settings → `/app/settings` |

**Not in the sidebar (deep links / hub):** `/app/inventory/review`, `/app/inventory/approved`, `/app/inventory/import/:listId`, `/app/invoices/:id/review`, `/app/settings/alerts`, `/app/settings/reminders` (all reachable via header switcher, buttons, or URL).

### Header (`src/components/AppHeader.tsx`)

- **Sidebar trigger** (mobile / collapsed).
- **Page title** (derived from path; `/app/par` shows “PAR”).
- **Restaurant switcher** — single restaurant, list, or **“All Restaurants”** (portfolio) when `OWNER`/`MANAGER` (`canPortfolio`).
- **Location switcher** (when multiple locations) — not detailed in stub; part of same header cluster.
- **Demo role switcher** (`src/components/DemoRoleSwitcher.tsx`) — only if demo restaurant name contains `demo`/`test` or `localStorage` `demo_mode === "true"`: toggles **OWNER** vs **MANAGER** effective UI without separate users.

### User roles (app behavior)

| Role | Enforced in DB / membership | In-app routing |
|------|----------------------------|----------------|
| **OWNER** | `restaurant_members.role` | Full app including **Admin** nav, `/app/staff`, `/app/settings` (+ alert/reminder settings routes) |
| **MANAGER** | | Portfolio “All Restaurants” in header; **not** in `OwnerRoute` — `/app/staff` and `/app/settings` redirect to dashboard |
| **STAFF** | | Sidebar shows STAFF as MANAGER for nav grouping (`effectiveRole`); stricter feature gates inside pages (e.g. inventory count hub: **staff menu** mode) |

**Note:** `OwnerRoute` uses real `currentRestaurant?.role === "OWNER"`, not the demo role switcher—demo role affects UI in some children but **cannot** open owner routes if the real role is not OWNER.

### Mobile vs desktop

| Concern | Behavior |
|---------|----------|
| **Breakpoint** | `useIsMobile` &lt; 768px; `useIsTablet` 768–1023px; `useIsCompact` = phone or tablet |
| **Sidebar** | `SidebarTrigger` in header; collapsible pattern |
| **Page-specific** | `InventoryCountPage`, `PARManagementPage`, `PARSuggestionsPage`, etc. branch on `useIsCompact()` for layout density / responsive tables |

### Loading, error, and empty (cross-cutting)

| Pattern | Where |
|---------|--------|
| **App boot** | `ProtectedRoute` full-page centered spinner (cold start) |
| **Data fetch** | `Skeleton` (many pages: Dashboard, Invoices, List Management, …) |
| **Errors** | `toast` (Sonner); `RootErrorBoundary` + `main.tsx` bootstrap catch for hard failures; inline fetch errors (e.g. Reports `fetchError`) |
| **Empty** | Page-specific copy (e.g. notifications “no notifications”, sessions empty) |

---

## Main pages (detailed)

### Dashboard (single restaurant)

| Field | Value |
|--------|--------|
| **Route** | `/app/dashboard` |
| **File** | `src/pages/app/Dashboard.tsx` |
| **Purpose** | Operational “today” view: stock risk, spend, waste, invoices, quick actions, PAR hints when `!isPortfolioMode` and a restaurant is selected. |
| **Components** | `Card`, KPI blocks, `TodaysBriefing`, time filter `Select`, Recharts/sections via `useDashboardData`, domain selectors from `src/domain/dashboard/` |
| **Screenshot description** | Gradient briefing strip, KPI cards (inventory value, risk, waste, etc.), section cards with charts or tables, “Start inventory” CTA, optional alerts (e.g. missing cost). |
| **Key UI** | Time range (this week / last week / 30 days), tables, badges, `Alert` for data quality, navigation buttons to other flows. |
| **Interactive** | Change time filter; buttons navigate (e.g. start inventory, drill-ins); portfolio switch happens in **header**, not on this page alone. |
| **Data** | Restaurant-scoped metrics from `useDashboardData` + `buildDashboardDisplayState` / selectors. |
| **Status** | **✅ Demo-safe** with **⚠️** if demo data is thin (explain stock truth / approved session dependency). |

---

### Dashboard (portfolio / multi-location)

| Field | Value |
|--------|--------|
| **Route** | Same `/app/dashboard` when header = **“All Restaurants”** (`isPortfolioMode`) |
| **File** | `src/pages/app/Dashboard.tsx` (`PortfolioDashboard` + `usePortfolioDashboardData`) |
| **Purpose** | Roll-up health across units; “open a restaurant” / row actions may drill into a single store. |
| **Components** | `PortfolioDashboard` sub-views, `Badge`, `Table`, `Button`, beta/warning `Alert` where present |
| **Screenshot description** | Portfolio totals, per-restaurant table, risk/summary copy; CTA to pick a store for detail. |
| **Status** | **⚠️ Show with warning** — clarify multi-tenant story and that row-level data depends on Supabase/edge. |

---

### Inventory Counting (Inventory Management)

| Field | Value |
|--------|--------|
| **Route** | `/app/inventory/enter` |
| **File** | `src/pages/app/inventory/EnterInventory.tsx` → `src/features/inventory-count/pages/InventoryCountPage.tsx` |
| **Purpose** | Create/open sessions, enter counts (table / zone strips), submit for review, PAR guides, staff vs manager flows. |
| **Components** | `InventoryHubHeader`, `InventoryHubSessions`, `InventorySessionEditor`, `VirtualizedDesktopCategoryBody`, `UniversalCountInput` variants, `InventoryCountHubModals`, `InventoryCountHubReviewSection`, `InventoryCountHubApprovedSection` |
| **Screenshot description** | Hub: list/session cards, schedules, review/approved sections; editor: large categorized table, search, status filters, zone UI on supported rows, submit/review modals. |
| **Key UI** | Tables, text inputs, dialogs, compact vs desktop layouts, online/offline hint via `useOnlineStatus`. |
| **Interactive** | Count entry, save, submit for review, clear/delete session, smart order from session, staff PAR/price request flows. |
| **Data** | Sessions, catalog items, PAR maps, locations — from `useInventoryCountData` + session commands. |
| **Status** | **✅ Demo-safe** for the happy path; **⚠️** if zones/PAR/legacy data incomplete. |
| **Known UI issues** | Very large surface; virtualized list + zone strip complexity — test on the device you demo. |

---

### Inventory Review

| Field | Value |
|--------|--------|
| **Route** | `/app/inventory/review` |
| **File** | `src/pages/app/inventory/Review.tsx` |
| **Purpose** | Manager approves or sends back sessions in `IN_REVIEW`; line-level review with risk, PAR, filters. |
| **Components** | `Tabs`, `Table`, `Dialog` / `AlertDialog`, `Collapsible`, `Input`, `Badge` |
| **Screenshot description** | Session list or open session detail, category groups, Approve / Decline, filters (all/critical/low/ok/no par). |
| **Interactive** | Approve, decline with note, open session from `?session=` query. |
| **Data** | `inventory_sessions` + items with approved PAR join paths. |
| **Status** | **✅ Demo-safe** with a prepared session in review. **Not in sidebar** — use hub link or direct URL. |
| **Known** | URL `?session=` deep link supported. |

---

### Smart Order

| Field | Value |
|--------|--------|
| **Route** | `/app/smart-order` |
| **File** | `src/pages/app/SmartOrder.tsx` |
| **Purpose** | View generated smart order **runs**, edit lines, export, submit; vendor grouping messages. |
| **Components** | `Table`, `Select`, `ExportButtons`, `ItemIdentityBlock`, `Switch` (show green/no PAR), `AlertDialog` |
| **Screenshot description** | List of runs; detail table with risk colors, need/qty, vendor blocks; `STOCK_TRUTH_MESSAGE` style copy may appear. |
| **Interactive** | Select run, edit PAR/cost, delete run, export PDF/CSV, submit (with multi-vendor validation). |
| **Data** | `smart_order_runs`, `smart_order_run_items`, catalog, settings. |
| **Status** | **✅ Demo-safe** if at least one run exists; **⚠️** else empty. |

---

### Invoices (Receiving)

| Field | Value |
|--------|--------|
| **Route** | `/app/invoices` |
| **File** | `src/pages/app/Invoices.tsx` |
| **Purpose** | List purchases/invoices, create (manual/photo/PDF), edit, link PO/smart order, vendor connect tab. |
| **Components** | `Tabs`, `InvoiceItemsTable`, `VendorConnectTab`, `Dialog`, filters, `useInvoicesData` / `useInvoiceActions` |
| **Screenshot description** | Card layout + main table of invoices; modals for create and detail; status badges. |
| **Interactive** | Filter by date/status, open editor, upload, link delivery issues, navigate to review. |
| **Data** | Purchases, catalog, locations, smart orders, vendor mappings. |
| **Status** | **✅ Demo-safe**; camera/file flows **⚠️** test in environment first. |

---

### Invoice Review

| Field | Value |
|--------|--------|
| **Route** | `/app/invoices/:id/review` |
| **File** | `src/pages/app/InvoiceReview.tsx` |
| **Purpose** | Receiving check: compare PO/invoice lines, received qty, report issues, confirm receipt. |
| **Components** | `ComparisonTable`, `ConfirmReceiptDialog`, `ReportIssueSheet`, hooks `useInvoiceReviewData` / `useInvoiceReviewActions` |
| **Screenshot description** | Comparison grid, line statuses, issue counts, **Confirm receipt** / **Report issue** flows. |
| **Interactive** | Edit received qty, save mappings, confirm, report short-ship, etc. |
| **Data** | Invoice, PO items, comparison rows, issues. |
| **Status** | **✅ Demo-safe** with a realistic invoice+PO; **❌** avoid if `reviewDocKind`/data half-configured. |

---

### Purchase History

| Field | Value |
|--------|--------|
| **Route** | `/app/purchase-history` |
| **File** | `src/pages/app/PurchaseHistory.tsx` |
| **Purpose** | Unified timeline of **POs, invoices, legacy** procurement rows; filter by list/date/source. |
| **Components** | `Tabs`, `Table`, `Breadcrumb`, `DropdownMenu`, `Skeleton` |
| **Screenshot description** | Tabbed or filtered list with source badges, links out to related invoice/order. |
| **Interactive** | Search, view modes, open linked routes. |
| **Data** | `purchase_orders`, `invoices`, deduped/legacy per `src/lib/procurement-dedupe` patterns. |
| **Status** | **⚠️ Show with warning** — explain mixed legacy + new rows so numbers don’t confuse. |

---

### Catalog / List Management

| Field | Value |
|--------|--------|
| **Route** | `/app/inventory/lists` |
| **File** | `src/pages/app/ListManagement.tsx` |
| **Purpose** | Multiple lists, drag-drop categories, item grid, import wizard, issues panel, create/edit item sheets. |
| **Components** | `@hello-pangea/dnd`, `Sheet`, `Dialog`, `Tabs`, `DataTable` patterns, `useListManagementData` / `useListManagementActions` |
| **Screenshot description** | Heavy UI: list picker, category strips, item table, import progress, “issues” with quick fix. |
| **Interactive** | Drag categories, inline edits, import mapping, delete, go to import route for a list. |
| **Data** | `inventory_lists`, `inventory_catalog_items`, import mappings. |
| **Status** | **⚠️ Show with warning** — powerful but easy to get lost; prepare a small demo list. |

---

### Waste Log

| Field | Value |
|--------|--------|
| **Route** | `/app/waste-log` |
| **File** | `src/pages/app/WasteLog.tsx` |
| **Purpose** | Log waste with reason, quantity, $ impact; filter by date/employee/reason; manager vs staff capabilities. |
| **Components** | `Table`, `Sheet`, `Select`, `Textarea`, `AlertDialog` |
| **Screenshot description** | Summary strip + table of entries; add sheet with reason chips (emoji + badge). |
| **Interactive** | Add/edit/delete (where allowed), filter, export if present. |
| **Data** | Waste entries, catalog, employees. |
| **Status** | **✅ Demo-safe** for a few hand-entered lines. |

---

### Reports

| Field | Value |
|--------|--------|
| **Route** | `/app/reports` |
| **File** | `src/pages/app/Reports.tsx` |
| **Purpose** | Scope: single / all / compare; KPIs, **Recharts** bar/line, top items, PAR suggestion teaser. |
| **Components** | `Card`, `BarChart` / `LineChart` (`recharts`), `Skeleton` |
| **Screenshot description** | Report scope controls, chart cards, top items table, stock-truth / PAR copy from domain helpers. |
| **Interactive** | Change scope, navigate hooks to inventory/PAR. |
| **Data** | Approved sessions, trends, `computePARSuggestionCount`. |
| **Status** | **✅ Demo-safe** if at least one approved session exists; else empty charts **⚠️**. |

---

### Settings

| Field | Value |
|--------|--------|
| **Route** | `/app/settings` (and in-page sections) |
| **File** | `src/pages/app/Settings.tsx` |
| **Purpose** | Left nav sections: business profile, invoice email, locations, inventory defaults, users, schedule (manager+), advanced PAR / smart order / imports / danger (owner for danger). |
| **Components** | Large single file + `InventoryScheduleSection` import; per-section subcomponents. |
| **Screenshot description** | Two-column settings layout; dense forms, switches, tables for locations and users. |
| **Route guard** | **Wrapped in `OwnerRoute`** — **only true OWNER** can open (`/app/settings`); managers are redirected. |
| **Status** | **⚠️ Show with warning** for demos — many sections; **managers in product may expect access** but route is owner-only in code. |

---

### Settings — Alerts & Reminders (separate paths)

| Route | File | Purpose |
|-------|------|---------|
| `/app/settings/alerts` | `src/pages/app/settings/AlertSettings.tsx` | In-app + email, digest, low-stock toggles, recipient modes |
| `/app/settings/reminders` | `src/pages/app/settings/ReminderSettings.tsx` | Reminder / scheduling preferences |

**Guard:** `OwnerRoute` for both. **Status:** **⚠️** — requires `notification_preferences` and email pipeline understanding for honest demo.

---

### Staff Management (Users & Permissions)

| Field | Value |
|--------|--------|
| **Route** | `/app/staff` |
| **File** | `src/pages/app/Staff.tsx` |
| **Purpose** | List members, pending invitations, invite by email + role via `send-invite` edge function. |
| **Components** | `Table`, `Dialog`, `Select`, `Badge` |
| **Screenshot description** | Members + invitations tables; invite modal. |
| **Interactive** | Invite, (remove flows if any in full file). |
| **Status** | **⚠️** — test invite in **non-prod**; don’t mass-invite in live. **Owner-only** route. |

---

### Recipes

| Field | Value |
|--------|--------|
| **Route** | `/app/recipes` |
| **File** | `src/pages/app/Recipes.tsx` |
| **Purpose** | Recipe list, ingredients, **food cost %** vs threshold, add/edit/delete recipes. |
| **Components** | `useRecipeData` / `useRecipeActions`, `Table`, `Dialog`, `Skeleton`, cost engine from `src/domain/recipes/` |
| **Screenshot description** | Recipe cards/table, cost badges (good/warn), ingredient editor. |
| **Data** | Recipes, ingredients, linked catalog. |
| **Status** | **✅ Demo-safe** with 1–2 recipes; **⚠️** if catalog not linked. |

---

### PAR — Manage (hub)

| Field | Value |
|--------|--------|
| **Route** | `/app/par` (index under hub) |
| **Shell** | `src/pages/app/ParHub.tsx` — tabs **Manage** / **Suggestions** |
| **Page** | `src/pages/app/PARManagement.tsx` |
| **Purpose** | Select list & PAR **guide**, edit PAR levels, bulk %, import, export, link guides, filters (missing/set). |
| **Components** | `PARImportDialog`, `ItemIdentityBlock`, `Table`, `Dialog`, `DropdownMenu` |
| **Status** | **✅/⚠️** — great with seeded guides; wide table, compact mode on small screens. |

---

### PAR — Suggestions

| Field | Value |
|--------|--------|
| **Route** | `/app/par/suggestions` |
| **File** | `src/pages/app/PARSuggestions.tsx` |
| **Purpose** | Run analytics-driven PAR **suggestions**, filter health, select rows, apply, notify. |
| **Components** | `Table`, `Checkbox`, `Dialog`, `Skeleton` |
| **Status** | **⚠️** — depends on count history; explain confidence tiers. |

---

## Supplemental app screens (worth listing)

| **PAGE** | **Route** | **File** | **Notes** | **Status** |
|----------|-----------|----------|------------|------------|
| Approved sessions | `/app/inventory/approved` | `src/pages/app/inventory/Approved.tsx` | Read-only + “move back to review” for managers; export | **✅/⚠️** |
| List import | `/app/inventory/import/:listId` | `src/pages/app/inventory/Import.tsx` | Column mapping, preview, vendor presets | **⚠️** |
| Notifications | `/app/notifications` | `src/pages/app/Notifications.tsx` | Tabs all/critical/reminders, mark read | **✅** if notifications exist |
| Auth / marketing | `/`, `/login`, `/signup`, `/demo`, etc. | `src/pages/*` | Out of “main app” scope; landing is static-only now | N/A |

---

## Summary table (demo readiness)

| Screen | Status |
|--------|--------|
| Dashboard (single) | ✅ (⚠️ if no data) |
| Dashboard (portfolio) | ⚠️ |
| Inventory Counting | ✅ (⚠️ complexity) |
| Inventory Review | ✅ |
| Smart Order | ✅ (⚠️ if empty) |
| Invoices | ✅ (⚠️ uploads) |
| Invoice Review | ✅ (❌ if misconfigured) |
| Purchase History | ⚠️ |
| List Management | ⚠️ |
| Waste Log | ✅ |
| Reports | ✅ (⚠️ if no sessions) |
| Settings (all owner routes) | ⚠️ (owner-only) |
| Staff | ⚠️ (invites) |
| Recipes | ✅ |
| PAR Manage / Suggestions | ✅ / ⚠️ |

---

## Known global caveats (founder view)

1. **Owner vs manager settings gap** — `OwnerRoute` locks `/app/staff` and `/app/settings` to **OWNER**; parts of `SettingsPage` copy reference manager capabilities while the route may block managers.
2. **Review / Approved** — not in sidebar; train demo flow through **Inventory Management** hub.
3. **Portfolio mode** — header switch to “All Restaurants”; metrics come from `usePortfolioDashboardData` and related edge cases (e.g. unassigned `location_id`) — use **⚠️** language in pitch.
4. **Demo role switcher** — does not grant owner routes; only UI that reads demo context.
5. **Data dependency** — many screens need **approved inventory sessions**, **invoices**, or **PAR guides** to look alive; seed or prepare accounts before investor demos.

---

*End of UI inventory. Update this file when routes or major components change.*
