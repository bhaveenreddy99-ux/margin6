# 01 — Architecture Guide (Phases 1–2)

## Part A — Repository Overview

### Top-level layout

| Path | Purpose | Notes |
|---|---|---|
| `src/` | React SPA source | 37 pages, 73 domain files, 22 hooks, 46 UI primitives |
| `supabase/` | Backend-as-code | 131 migrations, 12 edge functions, config, seeds, SQL tests |
| `scripts/` | Dev/ops scripts | pack parsing, sales smoke tests, inbound-invoice test, security smoke |
| `tests/` | Playwright E2E | 13 specs + a "human audit" harness |
| `docs/` | Design/investigation docs | includes prior audits (not source of truth) |
| `public/` | Static assets | — |
| Root configs | `vite.config.ts`, `tsconfig*.json`, `tailwind.config.ts`, `eslint.config.js`, `vitest.config.ts`, `playwright.config.ts`, `vercel.json`, `components.json`, `.env.example` | Vite + SWC, path alias `@`→`src`, manual vendor chunks |

There is **no separate backend service**. "Backend" = Supabase Postgres (RLS + RPC + triggers + cron) plus Deno Edge Functions. "Shared" code between frontend and backend is minimal — edge functions have their own `_shared/` and do **not** import from `src/`.

### `src/` structure (frontend)

| Folder | Responsibility |
|---|---|
| `src/pages/**` | Route components. `pages/app/**` = authenticated app; root-level = public/marketing/auth. Pages orchestrate hooks + domain; per architecture rules they should not hold business logic. |
| `src/features/inventory-count/**` | The largest feature, self-contained: `pages/`, `components/` (17), `hooks/` (8), `queries/`, `commands/`, `types/`, plus the zone write pipeline. |
| `src/features/invoice-review/**` | Invoice receiving UI components (ComparisonTable, ConfirmReceiptDialog, ReportIssueSheet). |
| `src/domain/**` | **Business logic layer** (73 files). Pure functions + some data-access orchestration. Areas: `inventory`, `invoices`, `ordering`, `par`, `dashboard`, `dataQuality`, `waste`, `notifications`, `sales`, `recipes`, `reports`, `subscription`, `catalog`, `locations`, `metrics`, `invites`. |
| `src/hooks/**` | React hooks that load/mutate data via Supabase and expose state to pages (22). |
| `src/data/invoice/**` | Thin data-access for invoice review docs / comparison inserts. |
| `src/contexts/**` | `AuthContext` (Supabase session), `RestaurantContext` (restaurants, locations, per-location assignments, UI-state persistence). |
| `src/components/**` | Shared UI: `ui/` (shadcn primitives, 46), dashboard cards, explainability, invoices, inventory, par, route guards, chrome. |
| `src/layouts/AppLayout.tsx` | Sidebar + header + `<Outlet/>` shell for `/app`. |
| `src/integrations/supabase/**` | `client.ts` (typed Supabase client) + `types.ts` (generated DB types — 3.7k lines). |
| `src/lib/**` | Utilities: unit conversions, pack parser, invoice totals/comparison, formatting, export (PDF/xlsx), constants, vendor presets, usage analytics. |
| `src/types/`, `src/test/**` | Shared types placeholder; 58 vitest files + fixtures + setup. |
| `src/main.tsx`, `src/app-entry.tsx`, `src/App.tsx`, `src/RootErrorBoundary.tsx` | Bootstrap, providers, router, top-level error boundary. |

### `supabase/` structure (backend)

| Folder/File | Purpose |
|---|---|
| `migrations/*.sql` | 131 ordered migrations = the DB source of truth (schema, RLS, RPC, triggers, grants, cron, storage). |
| `functions/<name>/index.ts` | 12 Deno edge functions. |
| `functions/_shared/*` | 6 shared modules (email, invoice matching, auth helpers, unit cost). |
| `config.toml` | Per-function `verify_jwt` settings + project id + Postgres major version 17. |
| `schema-snapshot-2026-05-20.sql` | Full snapshot (7.2k lines) — useful for final-state RLS/grants. |
| `demo_seed_public.sql` | Demo data seeding. |
| `tests/*.sql` | pgTAP-style SQL tests for invite RPCs + RLS. |
| `.temp/` | Supabase CLI link metadata. |

### Build / tooling

- **Vite 5 + `@vitejs/plugin-react-swc`**, dev server on `:8080`, manual vendor chunking (`react`, `supabase`, `query`, `ui`, `charts`, `pdf`) and `chunkSizeWarningLimit: 600` (`vite.config.ts`).
- **TypeScript 5.8**, path alias `@ → ./src`.
- **ESLint 9 flat config**; notable: `@typescript-eslint/no-unused-vars: "off"` and `react-refresh/only-export-components: warn` (`eslint.config.js`).
- **Vitest** (jsdom) for units; **Playwright** for E2E.
- **Deploy:** Vercel SPA rewrite (`/(.*) → /`), sitemap plugin for public routes, host `margin6.com`.

## Part B — Application Architecture (layers)

```
Browser (SPA)
  │
  ▼
React 18 + Vite  ── RootErrorBoundary (src/app-entry.tsx)
  │
  ▼
Providers:  QueryClientProvider ▸ TooltipProvider ▸ BrowserRouter
            ▸ AuthProvider ▸ RestaurantProvider ▸ DemoRoleProvider   (src/App.tsx)
  │
  ▼
React Router 6 (lazy routes)
  │  Public routes  ────────────────┐
  │  /app (ProtectedRoute)          │
  │     └─ AppLayout (sidebar/header)
  │         └─ OwnerRoute / StaffRestrictedRoute guards
  ▼
Pages (src/pages/**, src/features/**/pages)
  │  (orchestration only — no business logic by rule)
  ▼
Business Hooks (src/hooks/**, src/features/**/hooks)
  │  useEffect + useState + direct Supabase calls (NOT TanStack Query)
  ▼
Domain layer (src/domain/**)         ← pure functions: risk, reorder, PAR,
  │                                     invoice matching/variance, dashboard
  │                                     trust, data-quality, waste, entitlement
  ▼
Supabase JS client (src/integrations/supabase/client.ts, typed <Database>)
  │
  ├──▶ PostgREST (tables)  ── guarded by Row Level Security
  ├──▶ RPC (SECURITY DEFINER functions with internal auth)
  ├──▶ Storage (buckets: restaurant-logos [public], invoice-uploads [private])
  └──▶ Edge Functions (functions.invoke / fetch)
             │
             ├─ parse-invoice ─────▶ Anthropic Claude (OCR/extract)
             ├─ inbound-invoice-email ◀── Resend inbound webhook (Svix-signed)
             ├─ send-email / _shared ─▶ Resend (outbound)
             ├─ process-notifications ◀── pg_cron (hourly, service-role JWT)
             ├─ dispatch-app-notifications  (event notifications)
             ├─ create-checkout-session / stripe-webhook ─▶ Stripe
             └─ portfolio-dashboard, audit-invoice-anon, vendor-import-* (mock)
  │
  ▼
Postgres (17): tables + triggers (handle_new_user, price sync on receive,
  session versioning, sales aggregation, notification dedupe) + pg_cron + pg_net
```

### Layer responsibilities & dependencies

**1. Browser / React shell (`src/app-entry.tsx`, `src/main.tsx`, `src/App.tsx`).**
Mounts providers and the router. `RootErrorBoundary` wraps the tree to prevent blank-page crashes. `QueryClient` is created with `staleTime 5m`, `gcTime 10m`, `retry 1`, `refetchOnWindowFocus/Mount: false` — but see the caveat below.

**2. Auth (`src/contexts/AuthContext.tsx`).**
Subscribes to `supabase.auth.onAuthStateChange` (relies on `INITIAL_SESSION`), exposes `session/user/loading/signOut`. Session persisted in `localStorage` with auto-refresh (`client.ts`).

**3. Tenancy (`src/contexts/RestaurantContext.tsx`).**
The multi-tenant nerve center. On login it calls `rpc("accept_user_invites")`, loads `restaurant_members` (→ restaurants + role), conditionally loads `user_location_assignments` (per-location role + 6 permission flags) for MANAGER/STAFF, restores `user_ui_state` (selected restaurant/location), and auto-selects a location (STAFF/MANAGER scoped to assignments; OWNER falls back to first active). **Location is an internal concept — users never see a location picker.**

**4. Routing & guards (`src/App.tsx`, `src/components/*Route.tsx`).**
- `ProtectedRoute`: requires `user`; if no restaurants → `/demo`.
- `StaffRestrictedRoute`: blocks `currentRestaurant.role === "STAFF"` from manager pages.
- `OwnerRoute`: OWNER-only (Settings/Billing/Alerts/Reminders/Audit).
- `SmartLanding`: ≥2 restaurants → `/app/restaurants`, else `/app/dashboard`.
- `DashboardRouter`: STAFF → count-only `EmployeeDashboard`; OWNER/MANAGER → lazy money `Dashboard` (so KPI code never ships to STAFF).

**5. Pages (`src/pages/**`).**
Route-level orchestration. Some pages call Supabase directly (e.g. `Review`, `Approved`, `PARManagement`, `SmartOrder`, `Settings`), others delegate to hooks. This is a partial deviation from the "no data access in pages" rule (see Technical Debt).

**6. Business hooks (`src/hooks/**`, `src/features/inventory-count/hooks/**`).**
Load and mutate data. **Verified data pattern: NOT TanStack Query.** No `useQuery`/`useMutation` exists in `src`; hooks use `useEffect` + `useState` + direct `supabase.from/rpc/functions.invoke`. Some hooks memo-cache via refs (`useDashboardData`). `useNotifications` uses a Supabase Realtime subscription for live inserts.

**7. Domain (`src/domain/**`).**
Pure calculation + selectors, plus some data-loading orchestration modules (e.g. `loadInventoryMetrics.ts`, `sessionWorkflow.ts` do call Supabase — a mild architecture deviation). This is where the "one source of truth per calculation" rule is enforced.

**8. Supabase client (`src/integrations/supabase/client.ts`).**
Single typed client (`createClient<Database>`). Reads `VITE_SUPABASE_URL` / `VITE_SUPABASE_PUBLISHABLE_KEY`; falls back to local dev values. The publishable (anon) key is public by design.

**9. Data plane (Postgres via PostgREST + RPC).**
Tables gated by RLS. Complex/atomic/authorization-bearing operations go through SECURITY DEFINER RPCs. See [05 — Database](./05-database-documentation.md) and [07 — API & RPC](./07-api-and-rpc-documentation.md).

**10. Storage.** `restaurant-logos` (public) and `invoice-uploads` (private, member-by-folder policies).

**11. Edge functions + integrations.** See [08 — Edge Functions](./08-edge-function-documentation.md). External systems: Anthropic, Resend, Stripe.

**12. Scheduling.** `pg_cron` + `pg_net` run `process-notifications` hourly with a service-role bearer token stored in DB settings.

### Key architectural observations

- **Backend is the true system of record**; the SPA is a thin (if rich) client. This makes RLS/RPC correctness the dominant security concern.
- **Business logic centralization is real and unusually disciplined** for an app this size, aided by an in-repo skill (`.cursor/skills/react-page-refactor-clean-architecture`).
- **The generated `types.ts` is stale** relative to migrations (missing `restaurants` billing columns and `restaurant_invites`), so code casts around it in places (`useSubscription.ts`). Treat migrations as authoritative.
