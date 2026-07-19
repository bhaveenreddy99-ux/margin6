# 08 — Edge Function Documentation (Phases 9–10)

12 Deno edge functions + 6 `_shared` modules (`supabase/functions/*`). `verify_jwt` per `config.toml`. External integrations: **Anthropic** (parse), **Resend** (email in + out), **Stripe** (billing).

## Function reference

### `parse-invoice` — Invoice AI parser
- **Purpose:** Extract structured invoice header + line items from image/PDF/base64 via Anthropic Claude tool-use.
- **Auth:** `verify_jwt=false`; in-code triage — no token → 401; token == service key → service mode (skip membership); else validate user + `restaurant_members` membership.
- **Integrations/secrets:** Anthropic `v1/messages`; `ANTHROPIC_API_KEY`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`.
- **Data:** reads `restaurant_members` (user path); no writes.
- **Failure:** 400 (bad input/size/type), 403 (non-member), 429 (AI rate limit passthrough), 422 (no tool output), 500.
- **Risk:** no PDF size cap before AI call (cost); service mode = exact service-key equality.

### `inbound-invoice-email` — Email → invoice ingestion
- **Purpose:** Receive Resend inbound email, route to restaurant, create draft invoice, store attachment, parse, insert items, compare vs last PO, notify.
- **Auth:** `verify_jwt=false`; **Svix signature verification** (`RESEND_WEBHOOK_SECRET`); fails closed if secret unset/invalid.
- **Data:** reads `restaurant_settings`, `purchase_orders/_items`, `restaurants`; writes `invoices`, `invoice_ingestions`, `invoice_items`, `notifications`; storage `invoice-uploads`.
- **Failure:** 200 `{ignored}` for unknown address; 200 `{success:false}` on attachment failure (**silent drop**); most partials warn-and-continue.
- **Risk:** SSRF (unbounded `attachment.download_url` fetch); verbose logging; no `failed_inbound_emails` write in this path.

### `process-notifications` — Alerts cron worker
- **Purpose:** Hourly alert engine: low stock, reminders, overdue counts, digests, shrink/variance, weekly loss, price-hike emails.
- **Auth:** `verify_jwt=true` + `serviceAuth` (requires `role=service_role` claim). Invoked by pg_cron with service-role bearer.
- **Integrations/secrets:** `send-email`/Resend via `_shared/margin6Email`; `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`.
- **Data:** broad reads across operational tables; writes `notifications`, auto-creates `inventory_sessions`.
- **Failure:** 401 auth, 500; sub-ops best-effort (errors often unchecked).
- **Risk:** `serviceAuth` doesn't verify JWT signature (relies on gateway); broad service-role blast radius; fixed timezone offsets (no DST).

### `dispatch-app-notifications` — Event notifications
- **Purpose:** `COUNT_SUBMITTED`, `COUNT_APPROVED`, `SMART_ORDER_READY` in-app/email notifications.
- **Auth:** `verify_jwt=true`; validates user + membership of the session's restaurant.
- **Data:** reads sessions/items/settings/profiles/members; writes `notifications`; emails via shared helper.
- **Risk:** membership-only (not role) for approval-type events; email failures not retried.

### `create-checkout-session` — Stripe checkout
- **Purpose:** Create Stripe Checkout session for subscription.
- **Auth:** `verify_jwt=true`; validates user via `getUser`; **OWNER-only** check against `restaurant_members`.
- **Integrations/secrets:** Stripe SDK; `STRIPE_SECRET_KEY`, `STRIPE_PRICE_ID`, `SUPABASE_*`.
- **Data:** reads `restaurant_members`, `restaurants`; no writes (Stripe holds state).
- **Failure:** 401/403/404/502/500 mapped.

### `stripe-webhook` — Billing state sync
- **Purpose:** Update `restaurants.subscription_status` from Stripe events (checkout completed → active + ids; subscription deleted → canceled; payment failed → past_due).
- **Auth:** no `config.toml` entry (deploy `--no-verify-jwt`); **Stripe signature verify** (`STRIPE_WEBHOOK_SECRET`).
- **Failure:** 400 bad signature; 500 handler errors.
- **Risk:** config drift (JWT accidentally on) would break webhook delivery.

### `send-email` — Outbound email
- **Purpose:** Shared Resend sender used by alert/invoice flows.
- **Auth:** `verify_jwt=false`; **`authHeader.includes(serviceKey)`** substring check (weak).
- **Integrations/secrets:** Resend `emails`; `RESEND_API_KEY`, `SUPABASE_SERVICE_ROLE_KEY`.
- **Risk:** substring auth; returns raw Resend error body.

### `send-invite` — Team invite email
- **Purpose:** Create `invitations` row + send Resend invite email.
- **Auth:** `verify_jwt=false`; JWT claims + **OWNER** check.
- **Data:** reads `restaurant_members`, `invitations`, `restaurants`, `profiles`; writes `invitations`.
- **Risk:** caller-controlled `app_url` in email link (phishing/open-redirect); accepts `role` from body (relies on DB constraints); invite persists even if email fails.

### `portfolio-dashboard` — Deprecated dashboard aggregate
- **Purpose:** Cross-restaurant KPI aggregation (used by `PublicDemo`).
- **Auth:** `verify_jwt=false`; JWT user via anon client.
- **Data:** read-only across many tables; heavy nested loops (perf).
- **Status:** deprecated; superseded by client `useDashboardData`.

### `audit-invoice-anon` — Public leak-audit
- **Purpose:** Anonymous invoice upload (≤2 files) → calls `parse-invoice` with service key → estimates weekly loss.
- **Auth:** **none** (public); no `config.toml` entry (NOT VERIFIED).
- **Risk:** **HIGH** — unauthenticated AI fan-out via service role; no rate limit; CORS `*`.

### `vendor-import-invoices` / `vendor-import-invoice-details` — Vendor import (MOCK)
- **Purpose:** Return vendor invoice list / details.
- **Auth:** `verify_jwt=false`; JWT claims only (no tenant scoping).
- **Status:** **Mock** (`is_mock:true`); no real vendor API. Acceptable only while static.

## `_shared` modules
| Module | Purpose | Notes |
|---|---|---|
| `margin6Email.ts` | Email templates + `sendMargin6Email` (→ `send-email`) + recipient/pref lookups | dedupe samples last 50 notifications (can miss under volume) |
| `matchInvoiceCatalogItems.ts` | SKU-then-fuzzy-name matching of invoice→catalog | no error checks; fuzzy `ilike` mismatch risk |
| `parseInvoiceAuth.ts` | Token classification for parse-invoice | service = exact key equality |
| `resolveInvoiceUnitCost.ts` | Weight-priced unit-cost correction | pure math, NaN-guarded |
| `serviceAuth.ts` | Service-role bearer validation | decodes JWT **without signature verify** |
| `webhookAuth.ts` | Extract Svix headers | verification done in caller |

## Integration data-flow summary
| Integration | Direction | Function(s) | Auth to third party | Failure handling |
|---|---|---|---|---|
| **Anthropic Claude** | out | `parse-invoice` (via `audit-invoice-anon`, `inbound-invoice-email`, `useInvoiceActions`) | `ANTHROPIC_API_KEY` | 429 passthrough; 422 on empty; no retry |
| **Resend (inbound)** | in | `inbound-invoice-email` | Svix `RESEND_WEBHOOK_SECRET` | fails closed on bad sig; 200 on attachment fail (drop) |
| **Resend (outbound)** | out | `send-email` ← `process-notifications`/`dispatch-app-notifications`/`send-invite` | `RESEND_API_KEY` | logged, not retried |
| **Stripe** | both | `create-checkout-session`, `stripe-webhook` | `STRIPE_SECRET_KEY`/`STRIPE_WEBHOOK_SECRET` | signature verify; standard status codes |
| **Vendor APIs** | out | `vendor-import-*` | none | mock only |
| **pg_cron/pg_net** | internal | → `process-notifications` | service-role bearer from DB settings | NOT VERIFIED at runtime |
