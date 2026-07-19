# 03 — Workflow Documentation (Phase 4)

Each workflow documents: **UI → Validation → Business logic → DB writes → Notifications → Edge functions → Security → Failure handling.** All claims are from implementation.

---

## W1 — Restaurant creation
- **UI:** `Demo.tsx` ("Create demo") or `onboarding/CreateRestaurant.tsx` (real). Name input → submit.
- **Validation:** Name required (client).
- **Business logic / DB:** `rpc("create_restaurant_with_owner", { p_name, p_is_demo })` — SECURITY DEFINER; requires `auth.uid()`; inserts `restaurants` + `restaurant_members` (OWNER); when `p_is_demo`, seeds a demo graph. Then client upserts `restaurant_settings`, inserts a default `locations` row, reads back generated `invoice_email`.
- **Notifications:** none.
- **Edge fn:** none.
- **Security:** RPC auth-gated; caller becomes OWNER.
- **Failure:** RPC errors surfaced via toast; partial-seed risk if client-side settings/location inserts fail after RPC succeeds.

## W2 — Restaurant invitation (send)
- **UI:** Team section (`Settings`/`useLocationSettings`).
- **Validation:** email + role + location; role cannot be OWNER (`restaurant_invites` constraint).
- **Business logic:** RPC `create_invite` (role-specific authorization: OWNER can invite any non-owner; MANAGER limited; validates location ownership) **or** legacy `send-invite` edge fn (OWNER check) which inserts `invitations` and emails via Resend.
- **DB:** `restaurant_invites` (hashed token) or `invitations`/`user_invites`.
- **Notifications/Edge:** `send-invite` sends Resend email with an `app_url`-based accept link (**caller-controlled base URL** — phishing surface).
- **Security:** RPC/`send-invite` both check OWNER (+MANAGER rules for `create_invite`). anon revoked on new RPCs.
- **Failure:** if email fails, invite still persists (`email_sent: false`).

## W3 — Accept invitation
- **UI:** `/accept-invite` (`AcceptInvite.tsx`) — phase machine: loading/invalid/expired/used/revoked/ready.
- **Validation:** token preview via `rpc("get_invite_preview")` (anon-callable by token).
- **Business logic:** authenticated user calls `rpc("accept_invite", { p_token })` — matches token hash, pending, unexpired, email match; creates membership + location assignment with the invite's role/flags. On first login, `RestaurantContext` also calls `accept_user_invites` (legacy path).
- **DB:** `restaurant_members`, `user_location_assignments`, `restaurant_invites.status`.
- **Security:** requires auth + email match; role/location taken from invite row (no client escalation).
- **Failure:** explicit UI phases for each invalid state.

## W4 — Location setup
- **UI:** `Settings` locations panel. **No end-user location picker** — location is internal.
- **DB:** `locations` (Manager+ RLS), `location_settings` (count frequency, food-cost target, invoice email, brand).
- **Business logic:** `RestaurantContext` auto-selects location: MANAGER/STAFF scoped to `user_location_assignments` (primary first); OWNER first active. Persisted in `user_ui_state`.
- **Security:** SELECT location-scoped via `user_can_access_location`; writes Manager+ (looser than OWNER-only UI).

## W5 — Inventory list / catalog setup
- **UI:** `ListManagement` (create lists, add catalog items, categories, drag-drop) + `Import` (spreadsheet mapping).
- **Validation:** catalog length constraints (`20260212031105`); pack-size parsed by `pack-parser`.
- **DB:** `inventory_lists`, `inventory_catalog_items`, `list_categories`, `list_category_sets`, `list_item_category_map`, `import_templates`, `import_runs`, `inventory_import_files`.
- **Edge/Notifications:** none.
- **Security:** all `is_member_of` (any role via API); route StaffRestricted.
- **Failure:** import previews mapping; confidence score stored on `import_runs`.

## W6 — PAR guide setup
- **UI:** `PARManagement` — create guide, set per-item PAR levels, "sync to catalog defaults."
- **Business logic:** `catalogParSync` maps guide rows to catalog by id → name; `parGuideLevels` builds resolution maps.
- **DB:** `par_guides`, `par_guide_items` (write Manager+), `par_settings`.
- **Security:** UI `can_edit_par` (cosmetic); RLS Manager+ after hardening.

## W7 — Inventory counting
- **UI:** `InventoryCountPage` — start/continue session; per-item count via `UniversalCountInput` (cases/units/weight); per-zone strip (`SessionItemZoneCountStrip`); phone/tablet/desktop layouts; offline guard (`navigator.onLine`).
- **Validation:** zone unit must match planning or base count unit; negative/non-finite rejected; first zone write on a line with legacy total requires explicit "replaces legacy total" ack.
- **Business logic:** `zoneCounting`/`zoneReconcile`: parent `current_stock` = Σ normalized zone rows, else legacy; conversions via `inventory-conversions` + `pack-parser`.
- **DB:** `inventory_sessions` (status), `inventory_session_items` (versioned via `trg_session_item_version`), `inventory_session_item_zones`.
- **Notifications/Edge:** on submit, `dispatch-app-notifications` (`COUNT_SUBMITTED`) — fire-and-forget.
- **Security:** all roles; writes gated `IN_PROGRESS` (UI lock for IN_REVIEW/APPROVED). Delete restricted post-hardening.
- **Failure:** offline writes blocked; optimistic status updates enforce expected current status.

## W8 — Inventory approval
- **UI:** `Review.tsx` — manager reviews IN_REVIEW sessions, tweaks risk/order, Approve/Decline.
- **Validation:** duplicate-line guard (same non-empty SKU, or name-only when both lack SKU) blocks approval.
- **Business logic / DB:** `rpc("approve_inventory_session_atomic", { p_session_id, p_user_id, p_par_guide_id?, p_run_items? })` — checks caller == user_id, OWNER/MANAGER role, status == IN_REVIEW; sets APPROVED + `approved_at/by`; atomically creates a `smart_order_runs` row (+ items) and may strip catalog links; returns `{ run_id, location_id, catalog_links_stripped }`.
- **Notifications:** `COUNT_APPROVED` / `SMART_ORDER_READY` via `dispatch-app-notifications`; low-stock member notifications via `create_member_notifications` when red/yellow > 0.
- **Security:** **server-authorized** (role check inside RPC). Approved counts immutable (UI + approval-only-from-review).
- **Failure:** reopen (`moveApprovedInventorySessionToReview`) blocked if downstream runs/POs/invoices/low-stock notifications exist unless explicit override.

## W9 — Smart Order generation
- **UI:** `SmartOrder.tsx` — auto-created run from approval, or manual; shows red/yellow/green items, suggested case quantities, costs (UI-gated by `can_see_costs`).
- **Business logic:** `smartOrderFromSession` + `reorderEngine` + `casePlanningEngine`: `need = par − stock`; `suggested = ceil(need)` if `par>0 && need>0` else 0; risk via thresholds (red<50%, yellow<100%). Cost = latest invoice cost (`invoiceCostLookup`) else catalog default.
- **DB:** `smart_order_runs`, `smart_order_run_items`.
- **Security:** StaffRestricted; run CRUD `is_member_of`.

## W10 — Order approval & Purchase Order submit
- **UI:** `SmartOrder` submit — gated by `can_approve_orders` + `order_approval_threshold` (UI).
- **Validation:** `smartOrderVendor` blocks multi-vendor runs and runs with no resolvable vendor.
- **Business logic / DB:** `rpc("submit_smart_order", { p_run_id })` — SECURITY DEFINER; `is_member_of` lock **+ approval gate** `can_approve_order_amount` (amount computed from DB rows, not client); generates PO number (`generate_po_number` + `restaurant_counters`); creates `purchase_orders` + `purchase_order_items`; marks run submitted.
- **Notifications:** low-stock / order-ready.
- **Security:** approval enforcement added `20260623000006` (server-side amount check).
- **Failure:** serialized submit (`20260327000004`) prevents double-submit races.

## W11 — Invoice upload (manual)
- **UI:** `Invoices.tsx` upload dialog (image/PDF).
- **Business logic:** `useInvoiceActions` → `normalizeImageOrientation` → `functions.invoke("parse-invoice")`.
- **DB/Storage:** `invoices` (draft), `invoice_items`, `invoice_ingestions`, storage `invoice-uploads`.
- **Edge:** `parse-invoice` (Anthropic Claude; user path checks `restaurant_members` membership).
- **Security:** StaffRestricted; parse-invoice requires valid JWT + membership (or service key).
- **Failure:** parse errors surfaced; size/type validation client + server.

## W12 — Invoice ingestion (inbound email)
- **UI:** none (server). Each restaurant has an `invoice_email` address.
- **Edge:** `inbound-invoice-email` — Svix signature verify (`RESEND_WEBHOOK_SECRET`); resolve restaurant by `restaurant_settings.invoice_email`; dedupe; create draft `invoices`; upload attachment; call `parse-invoice`; insert `invoice_items`; compare vs last PO for missing items; notify.
- **DB:** `invoices`, `invoice_items`, `invoice_ingestions`, `notifications`, `failed_inbound_emails` (dead-letter), reads `purchase_orders`/`_items`.
- **Security:** webhook signature verified (fails closed if secret unset). **SSRF surface:** fetches `attachment.download_url` with no host allowlist. Returns 200 on attachment failure (can drop silently).

## W13 — Invoice parsing (AI)
- **Edge:** `parse-invoice` → Anthropic Messages API with a tool schema; returns structured header + line items.
- **Security:** JWT triage (no token → 401; token == service key → service mode; else validate user + membership).
- **Failure:** 429 passthrough on AI rate limit; 422 if no tool output; **no PDF size cap before AI call** (cost risk).

## W14 — Invoice confirmation / review / 3-way compare
- **UI:** `InvoiceReview.tsx` + `ComparisonTable` — per-line PO vs invoiced vs received; edit received qty; map unmatched to catalog; report issue.
- **Business logic:** `buildComparisonRows` (match via SKU/product-number/name; auto-fill received=invoiced unconfirmed; synthetic `missing_from_invoice` rows); `invoice-comparison` variance (qty 1%/0.01, price 1%/0.01, total 1%/1); status precedence received_short/over → qty → price → total → ok.
- **DB:** `invoice_line_comparisons`, `delivery_issues`.
- **Security:** StaffRestricted; comparison writes `is_member_of`; cost columns NOT gated.

## W15 — Receiving (confirm receipt)
- **UI:** `ConfirmReceiptDialog` — blocked until all real lines have confirmed received qty.
- **Business logic / DB:** `rpc("confirm_invoice_receipt", { p_invoice_id, p_restaurant_id })` — SECURITY DEFINER; **manager/owner check** (`can_confirm_receipt`, added `20260623000007`); converts received qty → cases (`normalize_received_qty_to_cases`); inserts `stock_movements` (increments stock); updates catalog `default_unit_cost` (last paid cost); creates notifications; marks invoice confirmed.
- **Triggers:** `trg_sync_catalog_price_on_receive` on `stock_movements`.
- **Security:** manager-enforced at RPC (post-hardening). Pack-conversion failures → `notify_pack_conversion_failures`.
- **Failure:** conversion failures flagged (`conversion_status`), audited via `get_pack_unit_issues` / `get_invoice_stock_audit`.

## W16 — Waste logging
- **UI:** `WasteLog.tsx` — item, qty/unit, reason, optional cost.
- **Business logic:** `recordedWasteValue` valuation precedence: `total_cost` → `unit_cost*qty` → catalog default → latest session cost.
- **DB:** `waste_log` (insert/delete `is_member_of`; `total_cost` client-set).
- **Security:** all roles; client-set cost is an integrity risk to KPIs.

## W17 — Notifications (generation + delivery)
- **Cron:** `pg_cron` hourly → `process-notifications` (service-role JWT) → low-stock, reminders, overdue counts, digests, shrink/variance, weekly loss, price-hike emails via `send-email`/Resend.
- **Event:** `dispatch-app-notifications` on count submit/approve + smart-order ready.
- **DB:** `notifications` (insert **RPC-only** via `create_member_notifications`, type allowlist), `notification_preferences`, `alert_recipients`.
- **UI:** `Notifications.tsx` (realtime feed, mark-read); prefs in `AlertSettings`.
- **Security:** insert spoofing fixed (RPC-only, recipient must be member). Timezone via fixed offsets (no DST).

## W18 — Dashboard (view)
- **UI:** `DashboardRouter` → STAFF `EmployeeDashboard` (count-only) or OWNER/MANAGER `Dashboard`.
- **Business logic:** `useDashboardData` runs `dashboard/*` loaders → `buildDashboardSnapshot`; each KPI carries a confidence level + the data-quality banner.
- **DB:** reads latest APPROVED session, invoices/purchase history, waste, notifications, sales.
- **Security:** money view lazy-loaded past STAFF check; cost KPIs UI-masked by flags. Fails loudly (error flags), never fake `$0`.

## W19 — Billing / Subscription
- **UI:** `Billing.tsx` — `auth.getSession()` → `functions.invoke("create-checkout-session")` (OWNER check) → Stripe Checkout.
- **Edge:** `stripe-webhook` updates `restaurants.subscription_status` on checkout completed / subscription deleted / payment failed.
- **Business logic:** `resolveEntitlement` computes covered/readOnly; `TrialBanner` shows countdown.
- **Security:** OWNER-only route + RPC; webhook signature-verified.
- **State:** enforcement OFF (grandfather cutoff 2027-01-01).

## W20 — User settings / role management / location permissions
- **UI:** `Settings` (OWNER route) — restaurant/inventory/PAR/smart-order settings, team, destructive delete (`delete_restaurant_cascade`).
- **Security:** route OWNER-only, but many settings tables are **Manager+ writable at RLS** (mismatch); per-location flags UI-only.

---

## Cross-workflow failure-handling patterns (verified)
- **Fire-and-forget notifications:** dispatch errors logged, never block the workflow (`dispatchAppNotifications`).
- **Best-effort edge writes:** `process-notifications`, `matchInvoiceCatalogItems`, inbound email often don't inspect Supabase errors → silent partial failure risk.
- **Loud dashboard failures:** dashboard loaders set per-KPI error flags instead of rendering false zeros.
- **Optimistic-with-guard session transitions:** enforce expected current status to avoid clobbering concurrent edits.
