# 00 — Executive Summary

## What Margin6 is (verified)

Margin6 is a **multi-tenant SaaS for independent restaurant inventory, purchasing, invoice reconciliation, smart ordering, alerts, and trust-first KPI dashboards.** It is a **Vite + React 18 + TypeScript single-page app** backed entirely by **Supabase** (Postgres + Auth + Storage + Edge Functions), deployed on **Vercel** (`vercel.json`), with **Stripe** billing, **Resend** email, and **Anthropic Claude** for invoice OCR/parsing.

The core operating loop implemented in code is:

```
Count → Approve → Smart Order → Purchase Order → Invoice (upload/email/parse)
→ Receive/3-way compare → Stock + last-cost update → Alerts → Dashboard → Billing
```

Every stage of that loop exists in the implementation and is wired end-to-end.

## Overall verdict

**Margin6 is a genuinely substantial, feature-complete-for-demo application with a mature database and a recently-hardened security posture. It is _not yet_ a fully production-hardened multi-tenant SaaS.** The gap is concentrated in: (a) authorization consistency between the UI and the database, (b) observability/monitoring, (c) automated test depth for write paths, and (d) billing enforcement (built but intentionally OFF).

- **Architecture:** Clean and intentional. Business logic is genuinely extracted into `src/domain/**` (73 files) as mostly-pure functions, with a documented "single source of truth per calculation" discipline. Strong.
- **Database:** Very mature — 131 migrations, ~60 tables, ~52 SECURITY DEFINER functions, RLS enabled on every table, atomic approval/order RPCs, pg_cron alerting. This is the strongest part of the system.
- **Security:** Materially improved. The `s0-*` remediation wave (June 2026) closed the historically-documented P0s: `submit_smart_order` now enforces approval limits, `confirm_invoice_receipt` enforces manager role, notification inserts are RPC-only, sensitive edge functions verify JWT/service-role/webhook signatures. **Residual risk remains** (see below).
- **Frontend:** Polished, role-adaptive (STAFF vs OWNER/MANAGER dashboards), lazy-loaded, with error boundaries and offline guards. **Note:** despite the README, TanStack Query is configured but **not used for fetching** — the real pattern is `useEffect` + `useState` + direct Supabase calls.
- **Testing:** Good *unit* coverage of pure domain logic (58 vitest files) and 13 Playwright E2E specs, but **write-path authorization and RLS are largely unverified by automated tests.**

## Headline findings

### Strengths (verified)
1. **Domain-driven design is real.** Calculations (risk banding, reorder qty, food-cost %, data-quality score, waste valuation, invoice variance) live in pure functions with dedicated tests. (`src/domain/**`, `src/test/**`)
2. **Atomic, authorization-bearing RPCs.** `approve_inventory_session_atomic`, `submit_smart_order`, `confirm_invoice_receipt` each contain internal role/approval checks and transactional writes. (`supabase/migrations/2026041822…`, `20260623000006`, `20260623000007`)
3. **Trust-first dashboard.** KPIs carry confidence levels and data-quality scoring; loaders fail *loudly* (error flags) rather than silently rendering `$0`. (`src/domain/dataQuality/*`, `src/domain/dashboard/buildDashboardSnapshot.ts`)
4. **Multi-tenant isolation via RLS on every table**, using `is_member_of` / `has_restaurant_role*` / location helpers. (`schema-snapshot-2026-05-20.sql`, `20260503000005_location_rls_helpers.sql`)

### Residual risks (verified, current state)
1. **Per-location permission flags are cosmetic.** `can_see_costs`, `can_approve_orders`, `can_edit_par`, etc. are enforced only in the UI; **no RLS/RPC reads them** except where a role check was added. A crafted `supabase-js`/REST call bypasses them. (`src/hooks/useLocationPermissions.ts`; confirmed against policies)
2. **Many write policies are `is_member_of`-only (any role incl. STAFF).** Catalog, custom lists, list categories, session items, vendor mappings, reminders/recipients, and `notification_preferences` are writable by any authenticated member via API. The June hardening fixed the *highest-risk* tables (sales, purchase_history_items, par_guide_items, session delete, notifications insert) but not the general catalog/settings surface.
3. **Legacy `anon` grants persist.** The initial schema granted `EXECUTE` to `anon` on many SECURITY DEFINER helpers (e.g. `generate_po_number`, `*_restaurant_id`) and default privileges still grant to `anon`. RLS blocks table reads for anon, but check-less definer helpers callable by anon are a **Needs-Review** surface. (`schema-snapshot-2026-05-20.sql` grants section)
4. **Billing is built but enforcement is intentionally OFF.** `resolveEntitlement` computes posture; `SUBSCRIPTION_LAUNCH_CUTOFF = 2027-01-01` grandfathers everyone. Nothing acts on `readOnly` yet. (`src/domain/subscription/resolveEntitlement.ts`)
5. **Observability is minimal.** No structured logging/metrics/tracing/error-tracking service is wired; edge functions log to console; many best-effort writes ignore errors.

### Notable inconsistencies between docs and implementation
- README says **"State Management: TanStack Query"** — in reality the app uses `useEffect`/`useState` + direct Supabase; `useQuery`/`useMutation` are not used anywhere in `src`.
- README says **"3-way PO matching"** — implementation does PO↔Invoice↔Received comparison (`invoice_line_comparisons`), which is effectively 3-way, but there is no separate "ordered vs received vs invoiced" reconciliation UI beyond the invoice review comparison table.
- Product is called **Margin6** in code, **RestaurantIQ** in the operating rules.

## One-paragraph recommendation

Prioritize **authorization parity** (make RLS/RPC enforce the same rules the UI implies, especially the per-location flags and the catalog/settings write surface), **lock down legacy `anon` execute grants**, and **add write-path + RLS integration tests**. Then wire **observability** (error tracking + edge-function logging) before enabling **billing enforcement**. The product logic itself is sound and well-organized; the remaining work is hardening and operational maturity, not redesign.
