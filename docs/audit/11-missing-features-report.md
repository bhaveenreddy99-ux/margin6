# 11 — Missing Features Report

What is **not** implemented today (verified by absence in code), grouped by likelihood of being expected. This is descriptive, not a roadmap.

## A. Security / access-control gaps (present intent, missing enforcement)
- **Server-side enforcement of per-location permission flags.** `can_see_costs`, `can_approve_orders` (beyond threshold), `can_edit_par`, `can_see_food_cost_pct`, `can_see_inventory_value` exist in data + UI but are not read by RLS/RPC.
- **Location-scoped write policies.** Only SELECT is location-scoped.
- **Cost-column masking at the data layer.** Cost visibility is UI-only; costs are API-readable.
- **MFA / SSO / email-verification enforcement.** Not present.
- **Current-password verification** on password change. Collected, not checked.
- **Rate limiting / abuse protection** on public + AI endpoints.

## B. Billing (built, not active)
- **Billing enforcement.** `resolveEntitlement` computes `readOnly`/`covered` but nothing acts on it; `SUBSCRIPTION_LAUNCH_CUTOFF = 2027-01-01` grandfathers all accounts.
- **Plan tiers / seats / proration / dunning UI.** Single $99/mo price; no tier management.
- **Invoice/receipt history for the SaaS subscription itself** (Stripe portal link) — NOT VERIFIED present.

## C. Integrations (stubbed or absent)
- **Real vendor/distributor invoice import.** `vendor-import-*` return mock data only.
- **POS integration for sales.** Sales are manual weekly/daily entry only (consistent with product rules that exclude POS features).
- **Accounting export / GL sync.** Absent (consistent with product rules excluding accounting).
- **OCR provider fallback.** Single provider (Anthropic); no secondary/failover.

## D. Product features referenced but removed / incomplete
- **Recipes / recipe costing / menu food-cost.** Engine + hooks exist, but DB tables were **dropped** — feature is non-functional. (Also aligns with product rules to avoid menu management.)
- **Money-leak report snapshot** (`buildMoneyLeakSnapshot`) — implemented but not wired to any UI.
- **Dedicated "3-way match" reconciliation screen** beyond the invoice comparison table (README language implies more).
- **Legacy `orders`/`usage_events` usage-tracking / consumption analytics** — tables exist but flow is deprecated.

## E. Operational / platform features
- **Observability stack** (error tracking, metrics, tracing, uptime).
- **CI/CD pipeline** (no pipeline config found in repo).
- **Audit logging of user actions** (who changed what) — beyond `stock_movements`/version columns, no general audit trail.
- **Data export / GDPR delete for a user** (there is `delete_restaurant_cascade`, but no per-user data export).
- **Backup/restore runbook / DR docs.**
- **Admin/support console** (cross-tenant support tooling) — none; would need service-role tooling.

## F. UX / smaller gaps
- **User-facing location switcher** — intentionally omitted (location is internal); may be needed for multi-location managers.
- **Real query caching / optimistic UI at scale** — TanStack Query configured but unused.
- **Offline-first counting** — only an online/offline *guard* exists; no offline queue/sync.
- **Bulk operations / undo** across catalog/PAR — partial.

## Alignment with product strategy (per operating rules)
The product rules say to **win on** counting speed, simpler UI, better alerts, trusted dashboard, easier onboarding — and to **avoid** POS, accounting, menu management, and heavy analytics. Notably:
- **Consistent with strategy (correctly absent):** POS integration, accounting/GL, menu management. Recipes being dropped aligns with "avoid menu management."
- **Core-strategy gaps to prioritize:** the **trusted dashboard** and **better alerts** pillars are undermined by (a) client-set/UI-only cost integrity and (b) no observability on the alert pipeline. **Easier onboarding** is strong (onboarding checklist, demo, invite flows) but fragmented across 3 invite systems.

> Everything above is stated as *absent/incomplete in the current implementation*. Where a feature is intentionally excluded per product strategy, it is noted as such.
