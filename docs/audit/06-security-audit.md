# 06 — Security Audit (Phase 7)

> **Method:** Static audit of source, migrations, snapshot, and edge functions. **Live/runtime DB grants, cron rows, and deployed `verify_jwt` settings are NOT VERIFIED.** Ratings reflect the *current* codebase, which is **post the `s0-*` June-2026 hardening wave** that closed most of the P0s in the historical `docs/role-permission-matrix.md`.

## Rating summary

| Area | Rating | One-line |
|---|---|---|
| Authentication | **Safe** | Supabase Auth, session persistence, sensible flows (MFA absent). |
| Authorization (RPC) | **Safe (mostly)** | Sensitive RPCs now carry internal role/approval checks. |
| Authorization (RLS reads) | **Safe** | Every table RLS-on; SELECT scoped by membership + location. |
| Authorization (RLS writes) | **Needs Review** | Many writes are `is_member_of`-only; per-location flags unenforced. |
| Multi-tenant (restaurant) isolation | **Safe** | Enforced by RLS via `restaurant_members`. |
| Multi-location isolation | **Needs Review** | SELECT location-scoped; most writes not location-scoped. |
| Edge function auth | **Safe (mostly)** | JWT / service-role / webhook-signature verification present. |
| Legacy `anon` grants | **High Risk** | Definer helpers still `EXECUTE`-granted to anon; default privileges grant to anon. |
| Secrets management | **Needs Review** | Server secrets via env; anon key public (fine); some verbose logging. |
| Rate limiting | **High Risk** | None on unauthenticated AI endpoint (`audit-invoice-anon`). |
| Input validation / injection | **Safe** | Parameterized supabase-js; no raw SQL from client; edge validates shapes. |
| Privilege escalation | **Needs Review** | Check-less definer helpers; UI-only permission flags. |
| Billing enforcement | **Informational** | Intentionally OFF. |

---

## 1. Authentication — **Safe**
- Supabase email/password (`AuthContext` via `onAuthStateChange`), localStorage session, auto-refresh (`client.ts`).
- Password reset flow present. **Gaps:** no MFA/SSO; Settings "current password" is collected but not verified before change; email-verification enforcement NOT VERIFIED.

## 2. Authorization model (four layers)
1. **UI** route guards (`ProtectedRoute`/`OwnerRoute`/`StaffRestrictedRoute`) + in-component flag gates.
2. **PostgREST** — anything RLS permits is reachable via `supabase-js` regardless of UI.
3. **RLS** — the real table gate.
4. **RPC** — SECURITY DEFINER functions with (now) internal checks.

**Core truth:** the six per-location permission flags (`can_see_costs`, `can_approve_orders`, `can_edit_par`, `can_see_food_cost_pct`, `can_see_inventory_value`, `order_approval_threshold`) are **UI-only** except `order_approval_threshold`, which `submit_smart_order` now enforces server-side via `can_approve_order_amount`.

## 3. RLS — reads **Safe**, writes **Needs Review**
- **Enabled on all ~60 tables.** SELECT policies scope by `is_member_of(restaurant_id)` and, for invoice/PO/sales/location children, by `user_can_access_location`.
- **Write gaps (current):** `inventory_catalog_items`, `custom_lists/_items`, `list_categories/_sets/_map`, `inventory_session_items` (I/U), `vendor_item_mappings`, `alert_recipients`, `reminder_targets`, `notification_preferences`, and `waste_log` are writable by **any member (incl. STAFF) via API**. Route guards hide these from STAFF in the UI only.
- **Location writes not scoped:** most write policies check membership/role but not location, so a MANAGER of one location can write another location's rows in the same restaurant (SELECT is scoped, writes generally aren't).

### Historically-fixed write leaks (verified remediated)
| Was P0/P1 (2026-06-22 matrix) | Current state | Fix migration |
|---|---|---|
| Smart-order submit bypassed approval | Enforced in RPC | `20260623000006` |
| Confirm-receipt no manager check | Manager-enforced | `20260623000007` |
| Notification insert for arbitrary user | INSERT RPC-only, recipient must be member | `20260623000004` |
| `purchase_history_items` write open | Manager+ | `20260623000002` |
| `weekly_sales`/`daily_sales` write open | Manager+ reasserted | `20260623000003` |
| Inventory session delete open | Restricted (manager+ or own-in-progress) | `20260623000001` |
| `par_guide_items` write open | Manager+ | `20260624000003` |
| `restaurant_members` self-insert | Removed | `20260706000001` |

## 4. RPC permissions — **Safe (mostly)**
SECURITY DEFINER functions with verified internal authorization:
- `create_restaurant_with_owner` — requires `auth.uid()`.
- `approve_inventory_session_atomic` — SECURITY **INVOKER**; checks caller==user, OWNER/MANAGER, status.
- `submit_smart_order` — `is_member_of` + `can_approve_order_amount` (amount from DB, not client).
- `confirm_invoice_receipt` / `_legacy` — `can_confirm_receipt` (manager/owner) before any write.
- `create_member_notifications` — caller membership + type allowlist + recipient-must-be-member; anon revoked.
- Invite RPCs (`create_invite`, `accept_invite`, `list_invites`, `revoke_invite`, `resend_invite`) — role checks via `can_manage_invite`; anon revoked; `get_invite_preview` intentionally anon (token capability).
- `delete_restaurant_cascade` — explicit owner check.

**Privilege-escalation flags:**
- `generate_po_number` — **no internal auth check** and (per snapshot) still granted to `anon`. Anon/any member could increment counters.
- `get_location_permissions(p_uid, p_location_id)` — `p_uid` is arbitrary input, not bound to `auth.uid()` (anon revoked post-`20260623000005`, but any authenticated user can query another user's permissions for a location).
- `*_restaurant_id` helper family — check-less lookups (intended for policy use) still granted to anon per snapshot; leak object→restaurant mapping given a known id.

## 5. Edge function permissions — **Safe (mostly)**
| Function | `verify_jwt` | In-code auth |
|---|---|---|
| `process-notifications` | true | service-role JWT check (`serviceAuth`) |
| `dispatch-app-notifications` | true | JWT user + membership |
| `create-checkout-session` | true | JWT user + OWNER check |
| `parse-invoice` | false | token triage: service-key OR user+membership |
| `inbound-invoice-email` | false | Svix webhook signature (fails closed) |
| `send-invite` | false | JWT claims + OWNER check |
| `send-email` | false | **substring** service-key check (weak) |
| `portfolio-dashboard` | false | JWT user (anon client) |
| `vendor-import-*` | false | JWT claims only (mock data) |
| `audit-invoice-anon` | *(absent from config.toml — NOT VERIFIED)* | **none** (public) |
| `stripe-webhook` | *(absent — deploy `--no-verify-jwt`)* | Stripe signature verify |

**Concerns:**
- `serviceAuth` decodes JWT **without signature verification** — safe *only* if gateway `verify_jwt=true`. Config drift would allow a forged `role=service_role` token. (Blast radius: mass writes/emails across all restaurants.)
- `send-email` uses `authHeader.includes(serviceKey)` (substring) rather than strict bearer equality.
- `audit-invoice-anon` and `stripe-webhook` have **no `config.toml` stanza** — effective JWT setting NOT VERIFIED.

## 6. Multi-tenant / cross-restaurant isolation — **Safe**
All operational tables carry `restaurant_id` and RLS requires `is_member_of`. A user cannot read another restaurant's rows. The isolation root is `restaurant_members`, whose writes are now Owner-only.

## 7. Cross-location isolation — **Needs Review**
SELECT is location-scoped for invoices/POs/sales/locations via `user_can_access_location`. **Writes generally are not location-scoped**, so within one restaurant a manager could write rows for a location they aren't assigned to.

## 8. Storage — **Safe / Needs Review**
- `invoice-uploads` private, member-by-folder — good.
- `restaurant-logos` **public** — logos are world-readable (acceptable for logos; confirm no PII uploaded there).

## 9. Service-role usage
Service role appears in: `parse-invoice`, `inbound-invoice-email`, `audit-invoice-anon`, `process-notifications`, `dispatch-app-notifications`, `send-email`, `create-checkout-session`, `stripe-webhook`, and the cron job. Usage is generally scoped to intended operations, but the broad key is present in each runtime — compromise of any function with a leaked key is high-impact.

## 10. Anonymous access — **High Risk (legacy grants)**
- `revoke_anon_dml` migrations removed anon INSERT/UPDATE/DELETE on tables.
- Anon still has table `SELECT` grants (per snapshot) — **but RLS blocks anon reads** (no `auth.uid()`), so not a data leak.
- **Anon still has `EXECUTE` on many SECURITY DEFINER functions** (initial schema + default privileges), including check-less helpers (`generate_po_number`, `*_restaurant_id`). This is the main anonymous-surface concern. Newer RPCs correctly revoke anon.
- `audit-invoice-anon` is a genuine unauthenticated endpoint (see rate limiting).

## 11. Secrets & API keys — **Needs Review**
- Client: only public anon key + URL (`.env.example`) — correct.
- Server secrets via `Deno.env.get`: `SUPABASE_SERVICE_ROLE_KEY`, `ANTHROPIC_API_KEY`, `RESEND_API_KEY`, `RESEND_WEBHOOK_SECRET`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_ID`.
- **Verbose logging** in `inbound-invoice-email` logs payload/attachment metadata; `send-email` returns raw Resend errors. Minor leakage risk.

## 12. Rate limiting — **High Risk**
No application-level rate limiting anywhere. Most exposed: `audit-invoice-anon` (unauthenticated) fans out to `parse-invoice` → Anthropic using the **service role** — an abuse/cost-amplification vector. `parse-invoice` has no PDF size cap before the AI call.

## 13. Input validation / injection — **Safe**
- All client DB access via `supabase-js` (parameterized) — no raw SQL injection surface from the client.
- Edge functions validate method/shape/size/type.
- Fuzzy `ilike("%name%")` in `matchInvoiceCatalogItems` is a data-integrity (mismatch) risk, not injection.

## 14. Privilege escalation — **Needs Review**
- UI-only permission flags (any member can perform flagged actions via API).
- Check-less definer helpers callable by anon/authenticated.
- `get_location_permissions` not bound to `auth.uid()`.

---

## Findings ranked

### Critical
- *(None currently open that are both unauthenticated and data-destructive — the June hardening closed the previously-Critical RPC/edge P0s. `audit-invoice-anon` cost-abuse is High, not Critical, as it doesn't expose tenant data.)*

### High
- **H1** Legacy `anon` `EXECUTE` grants on SECURITY DEFINER helpers (esp. `generate_po_number`, `*_restaurant_id`) + default privileges to anon.
- **H2** No rate limiting; `audit-invoice-anon` unauthenticated AI fan-out via service role; no PDF size cap in `parse-invoice`.
- **H3** `serviceAuth` trust is coupled to gateway `verify_jwt=true` (no signature verify) — config-drift = forgeable service identity.

### Medium
- **M1** Many table writes are `is_member_of`-only (STAFF can write catalog/lists/session items/vendor mappings/waste/prefs/recipients via API).
- **M2** Cross-location write isolation absent (writes not location-scoped).
- **M3** Per-location permission flags unenforced server-side (except approval threshold).
- **M4** `send-email` weak substring auth check.
- **M5** `inbound-invoice-email` SSRF surface (unbounded `attachment.download_url` fetch) + returns 200 on attachment failure (silent drop) + verbose logging.
- **M6** `waste_log.total_cost` and cost columns client-set / not gated by `can_see_costs`.
- **M7** Settings/locations/reminders RLS is Manager+ while UI is OWNER-only (MANAGER can edit "owner" settings via API).

### Low
- **L1** `restaurant-logos` bucket public.
- **L2** Fixed-offset timezone handling in alerts (no DST) — correctness, minor security relevance.
- **L3** No email verification enforcement / no MFA.
- **L4** Password-change does not verify current password.

## Recommendations (priority order)
1. Revoke anon `EXECUTE` on all definer functions except `get_invite_preview`; tighten default privileges (H1).
2. Add rate limiting + size caps to `audit-invoice-anon`/`parse-invoice`; consider a captcha/quotas (H2).
3. Add explicit `config.toml` entries for `audit-invoice-anon` and `stripe-webhook`; keep `verify_jwt=true` invariants documented and monitored (H3).
4. Bring RLS write policies + per-location flags into parity with the UI, especially catalog/settings and location scoping (M1–M3, M7).
5. Add host allowlist + non-200 on failure for inbound email; reduce logging (M5).
6. Server-derive `waste_log` cost; gate cost columns by `can_see_costs` at RLS or via a costed view (M6).
