# System overview

**Status:** Architecture authority (2026-07-11)

---

## Layers

```text
Browser (Vite + React 18 + TypeScript)
    ↕ TanStack Query / Supabase JS client
Supabase PostgREST + Auth + Storage + Realtime
    ↕ RLS policies + SECURITY DEFINER RPCs
PostgreSQL 17
Edge Functions (Deno) — email, parse-invoice, send-invite, notifications, …
External: Stripe, Resend, Claude (invoice parse)
Deploy: Vercel (SPA) + Supabase (backend)
```

---

## Frontend structure

| Path | Purpose |
|------|---------|
| `src/pages/` | Route-level UI (thin) |
| `src/domain/` | Business logic (calculations, loaders, workflows) |
| `src/features/` | Feature modules (e.g. inventory count) |
| `src/hooks/` | Data hooks |
| `src/components/` | Shared UI |
| `src/contexts/` | Auth, restaurant, location |

**Rule:** Calculations live in `src/domain/*`, not page components.

---

## Backend structure

| Path | Purpose |
|------|---------|
| `supabase/migrations/` | Schema, RLS, RPCs |
| `supabase/functions/` | Edge Functions |
| `supabase/tests/` | SQL regression tests |

---

## Multi-tenancy

- Tenant = **restaurant** (`restaurant_id`)
- **Location** scoping via `location_id` + `user_location_assignments`
- **RLS** on tenant tables; helpers: `is_member_of`, `user_can_access_location`, `has_location_permission`

**Known defect:** `locations` SELECT on production may not scope managers to assigned locations (see status docs).

---

## Role routing

- `DashboardRouter` — STAFF → `EmployeeDashboard`; OWNER/MANAGER → money `Dashboard`
- `OwnerRoute` / `StaffRestrictedRoute` — route-level gates (not sufficient alone)

---

## Current vs intended

| Topic | Current | Intended |
|-------|---------|----------|
| Manager dashboard | Shared owner view | Location-scoped ops worklist (future) |
| Order record | PO + purchase_history coexist | `purchase_orders` authoritative |
| On-hand truth | Latest **approved count** | Same until continuous ledger approved |
| Stock movements | Audit ledger | Not live on-hand until explicit approval |

See [`data-source-of-truth.md`](data-source-of-truth.md).
