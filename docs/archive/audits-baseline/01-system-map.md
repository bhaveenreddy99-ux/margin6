# Margin6 System Map (Read-Only Audit)

**Date:** 2026-07-10  
**Scope:** Repository structure, runtime, architecture layers  
**Mode:** Read-only — no code changes

---

## Stack Summary

| Layer | Technology | Evidence |
|-------|------------|----------|
| Frontend | React 18 + TypeScript + Vite 5 | `package.json`, `vite.config.ts` |
| Routing | React Router v6 (lazy routes) | `src/App.tsx` |
| Styling | Tailwind 3 + shadcn/ui (Radix) | `tailwind.config.ts`, `components.json` |
| Backend | Supabase Postgres 17, Auth, Storage, Edge Functions | `supabase/config.toml` |
| Payments | Stripe (checkout + webhook) | `supabase/functions/create-checkout-session`, `stripe-webhook` |
| Deploy | Vercel SPA rewrites | `vercel.json` |
| Unit tests | Vitest + Testing Library (58 files, 601 tests) | `vitest.config.ts`, run 2026-07-10 |
| E2E | Playwright (30 specs) | `playwright.config.ts`, `tests/e2e/` |
| CI | **None** | No `.github/workflows/` |

---

## Directory Responsibilities

```
margin6/
├── src/                    # Application source (346 files)
│   ├── domain/             # Pure business logic (78 files) — canonical KPI/math
│   ├── features/           # Feature slices (inventory-count, invoice-review)
│   ├── pages/              # Route-level UI (37 files)
│   ├── hooks/              # Data orchestration (22 files)
│   ├── components/         # Shared UI (84 files)
│   ├── contexts/           # Auth + Restaurant + DemoRole global state
│   ├── integrations/       # Supabase client + generated types
│   └── test/               # Vitest unit/integration tests
├── supabase/
│   ├── migrations/         # 131 SQL migrations (Feb–Jul 2026)
│   ├── functions/          # 12 edge functions + 6 shared modules
│   └── tests/              # 6 SQL smoke tests (invite, RLS)
├── tests/e2e/              # Playwright specs
├── docs/                   # Architecture, investigations, KPI registry (61 .md)
└── scripts/                # Pack parsing, seed utilities
```

---

## Architecture Layers

### 1. Frontend (Presentation)
- **Entry:** `index.html` → `src/main.tsx` → `src/app-entry.tsx` → `App.tsx`
- **Layout:** `src/layouts/AppLayout.tsx`
- **Route guards:** `ProtectedRoute`, `OwnerRoute`, `StaffRestrictedRoute`
- **Adaptive dashboard:** `DashboardRouter.tsx` — STAFF never loads money dashboard bundle

### 2. Domain Layer (`src/domain/`)
17 modules: `dashboard`, `inventory`, `invoices`, `ordering`, `par`, `waste`, `sales`, `invites`, `subscription`, etc.

**Confirmed pattern:** Financial KPI loaders return `LoadOutcome<T>` (`src/domain/dashboard/loadOutcome.ts`).

**Canonical dollar engine:** `src/domain/inventory/casePlanningEngine.ts`

### 3. Data Access
- **Primary:** Direct `supabase.from()` / `supabase.rpc()` in hooks and pages
- **React Query:** Installed, provider wired in `App.tsx`, **zero `useQuery`/`useMutation` usage** (Confirmed)
- **Generated types:** `src/integrations/supabase/types.ts`

### 4. Supabase Database
- **58 active tables**, 7 enums, ~50+ SECURITY DEFINER functions
- **RLS:** Enabled on all public tables (per migration history; production verification required)
- **Auth helpers:** `is_member_of`, `has_restaurant_role`, `has_location_permission`, `can_confirm_receipt`

### 5. Edge Functions (12)

| Function | verify_jwt (config.toml) | Classification |
|----------|--------------------------|----------------|
| `send-email` | false | Internal (service-role gate in code) |
| `send-invite` | false | User-authenticated (Bearer forwarded) |
| `parse-invoice` | false | Custom auth (`parseInvoiceAuth.ts`) |
| `inbound-invoice-email` | false | Webhook/custom auth |
| `portfolio-dashboard` | false | Unclear — needs review |
| `vendor-import-*` | false | Unclear |
| `process-notifications` | true | Scheduled/service |
| `dispatch-app-notifications` | true | Service |
| `create-checkout-session` | true | User-authenticated |
| `stripe-webhook` | default | External webhook |
| `audit-invoice-anon` | default | Public/anon |

### 6. State Management
- **React Context:** `AuthContext`, `RestaurantContext` (membership, locations, permissions)
- **Local state:** Pages/hooks
- **Persistence:** Supabase auth in localStorage

---

## Major Routes (`src/App.tsx`)

| Route | Guard | Primary role |
|-------|-------|--------------|
| `/login`, `/signup`, `/accept-invite` | Public | All |
| `/onboarding/create-restaurant` | Protected | New owner |
| `/app/dashboard` | Protected | All (STAFF → EmployeeDashboard) |
| `/app/inventory/enter` | Protected | Employee count |
| `/app/inventory/review`, `/approved` | StaffRestricted | Manager+ |
| `/app/inventory/lists` | StaffRestricted | Manager+ |
| `/app/smart-order`, `/par`, `/invoices` | StaffRestricted | Manager+ |
| `/app/settings` | **OwnerRoute** | Owner only |
| `/app/billing`, `/settings/audit` | OwnerRoute | Owner |

**Suspected gap:** Team/invite UI lives in `Settings.tsx` with manager support, but `/app/settings` is **OwnerRoute-only** — managers cannot reach Team tab via routing (Confirmed in `App.tsx:138`, `OwnerRoute.tsx`).

---

## Deployment

- **Frontend:** Vercel (`vercel.json` SPA rewrite)
- **Backend:** Supabase project `ogbnctyctoujzdcfphad` (referenced in config)
- **No CI workflows** in repository
- **Migration drift:** Documented in `MARGIN6_DEPLOY_RECONCILIATION.md` (repo filenames ≠ prod ledger versions for some invite migrations)

---

## Generated / Hygiene Artifacts

| Path | Status |
|------|--------|
| `dist/` | Build output (present locally) |
| `src/integrations/supabase/types.ts` | Generated types (committed) |
| `supabase/schema-snapshot-2026-05-20.sql` | Point-in-time snapshot |
| `MARGIN6_*.md` | Handoff/status docs (untracked in git status snapshot) |
| `.env.local` | Local secrets (gitignored; not inspected for values) |

---

## Dead / Legacy Areas

- **Three invite systems coexist:** `invitations`, `user_invites`, `restaurant_invites` (no DROP migration)
- **Legacy `invitations`:** Plaintext token, no email on insert from old UI path
- **Recipes module:** Tables dropped (`20260502000001_drop_unused_recipe_tables.sql`); some UI may remain excluded in tsconfig
- **Reports routes:** Redirect to dashboard (`App.tsx:129-130`)
