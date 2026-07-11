# RPC exposure audit — SECURITY DEFINER inventory

**Scope:** `public` schema functions exposed via PostgREST on live project `margin6`  
**Method:** Live `pg_proc` grant inspection + repository migration body review  
**Date:** 2026-07-10

## Summary

| Category | Count (approx.) |
|----------|-----------------|
| SECURITY DEFINER functions in `public` | 52 |
| Callable by `anon` on production (pre-fix) | 38 |
| Callable by `authenticated` only | 14 |
| Intentionally public (capability / signup) | 2 (`get_invite_preview`, `create_restaurant_with_owner`) |
| Confirmed unintentional `anon` EXECUTE | 11 (corrected in repo migration `20260712000002`) |
| Trigger-only / should not be API-callable | 6+ (partially addressed) |

**Important:** Authenticated access to a SECURITY DEFINER function is not automatically a vulnerability. Each entry below notes **internal authorization** (auth.uid, membership, location, role).

## Least-privilege grant plan (not applied on production in this epic)

| Function class | Target grant |
|----------------|--------------|
| Signup / capability token | `anon, authenticated` where token or signup gate exists |
| Authenticated business RPCs | `authenticated` only; `REVOKE ALL FROM PUBLIC, anon` |
| RLS helper SQL functions used only inside policies | `authenticated` optional; **never `anon`** for location/permission readers |
| Trigger functions | `REVOKE ALL FROM PUBLIC, anon, authenticated` — triggers invoke as owner |

---

## Priority RPC review

### Invitation path

| Function | Signature | Owner | search_path | anon | authenticated | Frontend direct | Validates auth.uid | Validates membership | Intentionally public | Abuse scenario | Recommended grant |
|----------|-----------|-------|-------------|------|---------------|-----------------|-------------------|---------------------|---------------------|----------------|-------------------|
| `get_invite_preview` | `(p_token text)` | postgres | `public, pg_temp` | Yes | Yes | Accept invite page | N/A (token hash) | Via token row | **Yes** | Token brute force (256-bit mitigates) | `anon, authenticated` |
| `accept_invite` | `(p_token text)` | postgres | `public, pg_temp` | No | Yes | Settings / accept flow | Yes | Yes | No | — | `authenticated` |
| `accept_user_invites` | `()` | postgres | `public` | **Yes (unintentional)** | Yes | RestaurantContext boot | Yes | Yes | No | Unauthenticated invoke noop/error noise | **`authenticated` only** |
| `accept_pending_invitations` | `()` | postgres | `public` | **Yes (unintentional)** | Yes | Legacy boot | Yes | Yes | No | Legacy path abuse if body weak | **`authenticated` only** |
| `create_invite` | (restaurant, email, role, location, flags…) | postgres | `public, pg_temp` | No | Yes | Settings | Yes | Yes + role | No | — | `authenticated` |
| `list_invites` | `(p_restaurant_id uuid)` | postgres | `public, pg_temp` | No | Yes | Settings | Yes | Yes | No | — | `authenticated` |

**Legacy tables:** `invitations`, `user_invites`, `restaurant_invites` — see Phase 6 classification in epic completion report.

### Restaurant lifecycle

| Function | anon | authenticated | Internal auth | Recommended |
|----------|------|---------------|---------------|-------------|
| `create_restaurant_with_owner(p_name, p_is_demo)` | Yes | Yes | Signup gate in body | **Intentional** for onboarding |
| `delete_restaurant_cascade(p_restaurant_id)` | **Yes (critical)** | Yes | Owner check in body | **`authenticated` only** — anon must not delete |

### Invoice / receipt

| Function | anon | authenticated | Internal auth | Notes |
|----------|------|---------------|---------------|-------|
| `confirm_invoice_receipt(p_invoice_id, p_restaurant_id)` | **Yes (critical)** | Yes | `can_confirm_receipt(auth.uid(), …)` since `20260623000007` | Revoke anon — mutation |
| `confirm_invoice_receipt_legacy(...)` | **Yes (critical)** | Yes | Weaker legacy path | Revoke anon; classify **dead and exposed** — remove after caller audit |
| `reprocess_invoice_item_stock(p_invoice_item_id)` | **Yes (critical)** | Yes | Membership checks in body | **`authenticated` only** |
| `get_invoice_stock_audit(p_invoice_id)` | **Yes** | Yes | Invoice restaurant scope | **`authenticated` only** |

### Smart order

| Function | anon | authenticated | Internal auth | Notes |
|----------|------|---------------|---------------|-------|
| `submit_smart_order(p_run_id)` | **Yes (critical)** | Yes | `can_approve_order_amount` since `20260623000006` | Revoke anon |

### Location / permissions

| Function | anon | authenticated | Internal auth | Notes |
|----------|------|---------------|---------------|-------|
| `user_accessible_location_ids(p_uid)` | **Yes** | Yes | Reads assignments | **`authenticated` only** — anon can probe UUIDs |
| `user_can_access_location(p_uid, p_location_id)` | **Yes** | Yes | Assignment lookup | **`authenticated` only** |
| `get_location_permissions(p_uid, p_location_id)` | **Yes (regression)** | Yes | Assignment row | **`authenticated` only** — `20260623000005` revoke did not stick |
| `has_location_permission(p_uid, p_location_id, p_flag)` | No | Yes | OWNER short-circuit + ULA | Correct |
| `can_approve_order_amount(...)` | No | Yes | Role + threshold | Correct |
| `can_confirm_receipt(...)` | No | Yes | Manager+ role | Correct |

### Notifications

| Function | anon | authenticated | Notes |
|----------|------|---------------|-------|
| `create_member_notifications(...)` | No | Yes | Correct — server-side fan-out |

### Triggers / infrastructure (should not be PostgREST-callable)

| Function | anon (prod) | Recommendation |
|----------|-------------|----------------|
| `rls_auto_enable()` | Yes | **Revoke all API roles** — event trigger only |
| `handle_new_user()` | Yes | Revoke API execute; auth trigger only |
| `sync_catalog_price_on_receive()` | Yes | Trigger only |
| `notifications_dedupe_within_hour()` | Yes | Trigger only |
| `create_default_notification_preferences()` | Yes | Trigger only |

### RLS helper `*_restaurant_id(uuid)` family

~15 functions (`session_restaurant_id`, `invoice_restaurant_id`, …): **anon executable on production**. Used inside RLS policies; direct anon calls leak restaurant_id resolution for guessed UUIDs. **Low severity** but should be **`authenticated` only** in a later hardening pass (not all revoked in this epic to avoid dependency surprises).

---

## Confirmed issue vs intentional vs false positive

| Advisor / finding | Classification |
|-------------------|----------------|
| `confirm_invoice_receipt` anon EXECUTE | **Confirmed issue** — fixed in `20260712000002` |
| `get_invite_preview` anon EXECUTE | **Intentional exposure** |
| `create_restaurant_with_owner` anon EXECUTE | **Intentional exposure** |
| `is_member_of` anon EXECUTE | **Acceptable for now** — RLS helper; low direct impact |
| Mutable `search_path` on some functions | **Requires later investigation** per function; `get_invite_preview` already hardened in repo |
| `confirm_invoice_receipt_legacy` exposed | **Confirmed issue** — legacy; classify **dead and exposed** |
| `failed_inbound_emails` insert policy | **Requires later investigation** (not modified this epic) |
| `restaurant-logos` public listing | **Requires later investigation** (storage policy) |
| Leaked-password protection disabled | **Confirmed config gap** — enable in Supabase Auth dashboard |

---

## Frontend direct callers (verified)

| RPC | Frontend caller |
|-----|-----------------|
| `accept_user_invites` | `RestaurantContext.tsx` on boot |
| `get_invite_preview` | Accept invite / signup flow |
| `accept_invite` | Invite redemption |
| `create_invite`, `list_invites`, `resend_invite`, `revoke_invite` | Settings invite UI |
| `confirm_invoice_receipt` | Invoice review (authenticated client) |
| `submit_smart_order` | Smart order page |
| `approve_inventory_session_atomic` | Count approval (separate migration family) |

---

## Deployment note

Apply `20260712000002_revoke_unintentional_anon_rpc_exec.sql` on **staging first**. Smoke-test:

1. Signup / create restaurant (still uses authenticated after sign-in; verify pre-auth flows).
2. Invite accept page (anon `get_invite_preview` still works).
3. Invoice receipt confirm, smart order submit (authenticated).
4. Anonymous PostgREST calls to revoked functions return permission denied.

Do **not** bulk-revoke the `*_restaurant_id` helper family in the same release without an RLS policy audit.
