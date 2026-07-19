# 12 — Founder PRD (Generated ONLY from Verified Implementation)

> This PRD describes **what exists today in code** — not aspirations. It is reverse-engineered from the implementation so a founder can speak precisely about the current product. Anything not in code is under "Not built."

## 1. Product

**Margin6** (product rules name it *RestaurantIQ*) is a multi-tenant SaaS that helps independent restaurant operators run inventory, purchasing, invoice reconciliation, smart ordering, alerts, and a trust-first KPI dashboard — replacing spreadsheets. Web SPA (React/Vite) on Supabase, deployed on Vercel.

**Positioning (per operating strategy):** win on faster counting, simpler UI, better alerts, a trusted dashboard, and easier onboarding — explicitly *not* on POS, accounting, menu management, or heavy analytics.

## 2. Users & roles (implemented)
- **OWNER** — full access (all permission flags hard-true in UI); only role for Settings/Billing/Alerts/Reminders/Audit.
- **MANAGER** — operational management; per-location permission flags; approves counts/orders/receipts.
- **STAFF** — counting + waste logging; count-only dashboard; no financial data downloaded.
- **Multi-restaurant, multi-location:** a user can belong to several restaurants (role each) and be assigned to specific locations with six permission flags. Location is an internal concept (no user-facing picker).

## 3. Core product loop (implemented end-to-end)
```
Count  →  Approve  →  Smart Order  →  Purchase Order  →  Invoice (upload/email/AI-parse)
      →  Receive / compare (PO vs invoiced vs received)  →  Stock + last-cost update
      →  Alerts  →  Trust dashboard  →  Billing
```

## 4. Current features (built)
1. **Auth & multi-tenant onboarding** — signup/login/reset, invite-based team onboarding, demo workspace, onboarding checklist, per-restaurant inbound invoice email address.
2. **Inventory lists & catalog** — lists, catalog items (pack size, unit cost, PAR, vendor, product number), categories/category-sets, spreadsheet import with templates, drag-drop, export.
3. **Session-based counting** — status lifecycle (In-progress → In-review → Approved), universal count input (cases/units/weight), per-zone counting with normalization & reconciliation, phone/tablet/desktop views, offline guard, approved-count immutability.
4. **Review & atomic approval** — manager review, duplicate-line guard, atomic approval RPC that also creates the smart-order run; guarded reopen.
5. **PAR management** — guides, per-item PAR, suggestions, catalog sync, PAR-change requests.
6. **Smart Order** — case-based suggested quantities, R/Y/G risk banding, single-vendor gate, server-enforced order-approval limits, PO generation with sequenced PO numbers.
7. **Purchasing** — purchase orders + purchase-history timeline.
8. **Invoices** — manual upload, inbound-email ingestion (signature-verified), AI parsing (Claude), storage of source files.
9. **Receiving & reconciliation** — PO↔invoiced↔received comparison with qty/price/total variance tolerances, issue reporting, manager-enforced receipt confirmation that updates stock and last-paid cost.
10. **Waste logging** — reasoned waste with valuation feeding shrinkage/profit-leak KPIs.
11. **Sales entry** — weekly/daily sales for food-cost %.
12. **Trust-first dashboard** — money lost, food cost %, inventory value, reorder need, overstock/cash-trap, price-hike alerts, shrinkage, profit leaks — each with **confidence badges** and a **data-quality score**; STAFF get a count-only dashboard.
13. **Notifications & alerts** — in-app (realtime) + email; low-stock, price-change, invoice-parsed, count reminders/overdue, digests, shrinkage, weekly-loss; hourly cron engine.
14. **Billing** — Stripe checkout + webhook state sync + 14-day trial + entitlement model (enforcement currently off).
15. **Lead-gen** — public live demo + anonymous "invoice leak audit."

## 5. Current architecture (built)
- **Frontend:** React 18 + TypeScript + Vite (SWC), React Router 6 (lazy), Tailwind + shadcn/ui, Recharts, jsPDF/xlsx export. State via React contexts + hooks (direct Supabase calls; TanStack Query configured but unused for fetching).
- **Backend:** Supabase — Postgres 17 (RLS + ~52 SECURITY DEFINER RPCs + triggers), Auth, Storage (2 buckets), 12 Edge Functions (Deno), pg_cron/pg_net.
- **Integrations:** Anthropic Claude (invoice parsing), Resend (inbound + outbound email), Stripe (billing).
- **Deploy:** Vercel (SPA) + Supabase.

## 6. Current database (built)
~60 tables across tenancy, inventory/catalog, counting sessions/zones, PAR, ordering/purchasing, invoices/receiving, sales, waste, notifications, invites, and billing columns on `restaurants`. RLS enabled on every table; multi-tenant isolation via `restaurant_members`; location scoping via assignment helpers. 131 migrations. (Full catalog: [05](./05-database-documentation.md).)

## 7. Current security posture (built)
- Multi-tenant isolation and read scoping: **strong** (RLS on all tables).
- Sensitive RPCs (approve, submit order, confirm receipt, notifications, invites) carry internal role/approval checks after the June-2026 hardening wave.
- Edge functions verify JWT / service-role / webhook signatures (with noted exceptions).
- **Known residual risk:** per-location permission flags are UI-only; many table writes are `is_member_of`-only; legacy anon `EXECUTE` grants persist; no rate limiting; minimal observability. (Full: [06](./06-security-audit.md).)

## 8. Current workflows (built)
Restaurant creation, invite send/accept, location setup, list/catalog setup, PAR setup, counting, approval, smart order, order approval/PO, invoice upload/email/parse, review/compare, receiving, waste, notifications, dashboard, billing, settings. (Full: [03](./03-workflow-documentation.md).)

## 9. Current limitations (built-in constraints)
- Cost/permission visibility is UI-enforced, not server-enforced.
- Alerts scheduling uses fixed timezone offsets (no DST).
- Vendor integrations are mock; recipes are dropped; some legacy tables/screens are superseded.
- Sales and much reference data are manual entry.
- No offline queue (only an online/offline guard).

## 10. Current technical debt (top)
Authorization divergence (UI vs RLS), anon definer grants, oversized pages, no observability, missing write-path/RLS tests, three parallel invite systems, stale generated types. (Full: [09](./09-technical-debt-report.md).)

## 11. Current production readiness
**≈5.5/10 — advanced beta / demo-grade.** Solid architecture, features, and data model; needs authorization parity, observability, write-path tests, and CI/CD before broad multi-tenant production launch and before enabling billing enforcement. (Full: [10](./10-production-readiness-report.md).)

## 12. Not built / missing (so the founder isn't over-claiming)
- No MFA/SSO; no server-enforced per-location permissions; no rate limiting.
- Billing enforcement is **off**; single price tier.
- No real vendor/POS/accounting integrations; recipes non-functional.
- No observability/monitoring/CI-CD/audit-log/DR runbook in-repo.
- No offline-first counting; no real query caching. (Full: [11](./11-missing-features-report.md).)

## 13. Honest one-liner for a founder
> "Margin6 is a working, well-architected restaurant inventory-to-invoice-to-dashboard SaaS with a mature Postgres/RLS backend and a trust-first KPI layer. Its core loop is complete and demo-ready. Before scaling to paying multi-tenant customers we need to close the gap between what the UI implies and what the database enforces, add monitoring, and turn on billing."

---
*Every claim above is traceable to the implementation; items that could not be verified from code are labeled `NOT VERIFIED` in the underlying documents (see the [audit index](./README.md)).*
