# Database & Security Audit

**Date:** 2026-07-10  
**Mode:** Read-only (migration + type analysis; production state not fully verifiable from repo alone)

---

## Entity Map (Confirmed from migrations + types)

### Tenancy & Identity
| Table | Tenant key | RLS | Notes |
|-------|------------|-----|-------|
| `restaurants` | `id` | Yes | Insert via `create_restaurant_with_owner` RPC only |
| `restaurant_members` | `restaurant_id` | Yes | INSERT owner-only after `20260706000001` |
| `profiles` | `id` (= auth user) | Yes | Coworker SELECT within restaurant |
| `locations` | `restaurant_id` | Yes | Multi-location |
| `user_location_assignments` | via `location_id` | Yes | Per-location role + permission flags |
| `location_settings` | via `location_id` | Yes | Brand, food cost target |

### Invites (THREE parallel systems — technical debt)
| Table | Status | Security model |
|-------|--------|----------------|
| `invitations` | Legacy, active | Plaintext `token uuid`; owner INSERT; member SELECT; **GRANT ALL TO anon** in original migration |
| `user_invites` | Legacy, active | Email-match on login; `accept_user_invites()` |
| `restaurant_invites` | New (Jul 2026) | `token_hash` only; DEFINER RPCs; hashed tokens |

### Inventory
| Table | Purpose | Immutability |
|-------|---------|--------------|
| `inventory_catalog_items` | Master catalog | Soft/active flags |
| `inventory_lists`, `inventory_items` | Location lists | CASCADE rules |
| `inventory_sessions` | Count sessions | Status machine: IN_PROGRESS → IN_REVIEW → APPROVED |
| `inventory_session_items` | Count lines | Zone support via `inventory_session_item_zones` |
| `par_guides`, `par_guide_items` | PAR targets | Manager+ write (Jun 2026 fix) |

### Orders & Invoices
| Table | Purpose |
|-------|---------|
| `smart_order_runs`, `smart_order_run_items` | Reorder recommendations |
| `purchase_orders`, `purchase_order_items` | PO workflow |
| `purchase_history`, `purchase_history_items` | Legacy/hybrid PO tracking |
| `invoices`, `invoice_items` | Invoice headers/lines |
| `invoice_ingestions` | Upload/email source |
| `invoice_line_comparisons` | Three-way match rows |
| `delivery_issues` | Discrepancy records |
| `stock_movements` | Receipt posting |
| `vendor_item_mappings` | Catalog matching |

### Financial / Ops
| Table | Purpose |
|-------|---------|
| `weekly_sales`, `daily_sales` | Sales entry |
| `waste_log` | Waste records |
| `notifications`, `notification_preferences` | Alerts |
| `restaurant_counters` | PO number generation |

---

## Security-Sensitive Migration Timeline

| Migration | Issue addressed | Complete in repo? | Prod proof |
|-----------|-----------------|-------------------|------------|
| `20260706000001_restrict_restaurant_members_owner_self_insert` | Cross-tenant OWNER self-insert | Yes | **Deployment uncertain from repo** |
| `20260623000004_notifications_create_rpc` | Notification spoofing | Yes | Uncertain |
| `20260623000006_submit_smart_order_enforce_approval` | Staff submit orders | Yes | Uncertain |
| `20260623000007_confirm_receipt_enforce_manager` | Receipt authorization | Yes | Uncertain |
| `20260623000001_restrict_inventory_session_delete` | Approved count deletion | Yes | Uncertain |
| `20260624000003_restrict_par_guide_items_write` | Staff PAR edits | Yes | Uncertain |
| `20260425130000_revoke_anon_dml` | Anon write revoke | Partial | Uncertain |
| `20260707000001`–`20260711000001` | Secure invite system | Yes | Partial (ledger drift) |

**Rule:** Migration file existence ≠ production deployment.

---

## RLS Patterns

### Dominant helpers
- `is_member_of(restaurant_id)` — any member
- `has_restaurant_role(restaurant_id, role)`
- `has_restaurant_role_any(restaurant_id, ARRAY[...])`
- Location-scoped: `user_can_access_location`, session/invoice FK resolvers

### Confirmed absence
- No `USING (true)` policies found across 131 migrations (Confirmed via grep)

### Known gaps (from docs + migrations)
1. **Per-location permission flags** (`can_see_costs`, etc.) are **UI-only** — not enforced in RLS/RPC (documented in `docs/role-permission-matrix.md`)
2. **STAFF catalog read:** Route blocked, RLS `is_member_of` allows SELECT (privilege leak at API layer)
3. **Legacy invitations anon grant** never explicitly revoked
4. **`get_invite_preview` GRANT TO anon** — intentional capability model; token is 256-bit

---

## SECURITY DEFINER Functions (Critical)

| Function | Auth check | Idempotency |
|----------|------------|-------------|
| `create_restaurant_with_owner` | Caller becomes owner | N/A |
| `approve_inventory_session_atomic` | Manager+ | Blocks double-approve |
| `submit_smart_order` | `can_approve_order_amount` | Idempotent upsert |
| `confirm_invoice_receipt` | `can_confirm_receipt` | Receipt status guards |
| `create_invite` / `accept_invite` | Role + email-bound | Single-use token consume |
| `delete_restaurant_cascade` | Owner | Destructive |
| `delete_inventory_list` | Owner/manager (post-fix) | Was anon-callable — fixed per docs |

Many older DEFINER functions lack explicit `REVOKE FROM PUBLIC` (Inferred risk).

---

## Authorization Matrix (Sensitive Operations)

| Operation | UI | RLS/RPC | Gap |
|-----------|-----|---------|-----|
| Create restaurant | ✅ | RPC | Any member can hit `/restaurants/new` (route unguarded) |
| Invite user (secure) | Owner Team UI | `create_invite` + `send-invite` | Manager Team UI blocked by OwnerRoute |
| Invite user (legacy) | Old cached UI | `invitations.insert` | **No email**; still callable if old JS cached |
| Accept invite | `/accept-invite` | `accept_invite` | Secure path deployed Jul 2026 |
| Approve count | Review page | `approve_inventory_session_atomic` | ✅ Server enforced |
| Submit smart order | Smart Order | `submit_smart_order` | ✅ Threshold enforced |
| Confirm receipt | Invoice Review | `confirm_invoice_receipt` | ✅ Manager+ enforced |
| View cost KPIs | UI flags | **No RLS on cost fields** | Staff can API-read underlying tables |
| Manage billing | OwnerRoute | Stripe columns on restaurants | Owner UPDATE policy |

---

## Attack Scenarios (Theoretical — do not exploit production)

1. **Crafted Supabase client call as STAFF** → read `inventory_catalog_items`, sessions, invoices (RLS member read)
2. **Legacy invite row** → no secure token; won't work on `/accept-invite` but may auto-accept on signup via trigger
3. **Cached old frontend** → legacy `invitations.insert` without email (Confirmed in production incident Jul 2026)
4. **Cancel legacy invite twice** → unique constraint `(restaurant_id, email, status)` blocks second REVOKED (Confirmed)

---

## ACCOUNTANT Role

**Status:** Not implemented. `app_role` enum = OWNER, MANAGER, STAFF only (`20260212001141_initial_schema_core_rls.sql`). No ACCOUNTANT references in `src/` (Confirmed grep).
