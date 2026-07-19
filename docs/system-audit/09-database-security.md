# 09 — Database and Security

**Scope:** Migrations through `20260711000001_get_invite_preview_rpc.sql`  
**Generated types:** `src/integrations/supabase/types.ts` (58 tables; stale vs migrations)

---

## Core entity relationships

```
restaurants ─┬─ restaurant_members ─ auth.users
             ├─ locations ─ user_location_assignments
             ├─ inventory_lists ─ inventory_sessions ─ inventory_session_items
             │                                      └─ inventory_session_item_zones
             ├─ par_guides ─ par_guide_items
             ├─ smart_order_runs ─ smart_order_run_items
             ├─ purchase_orders ─ purchase_order_items
             ├─ invoices ─ invoice_items ─ invoice_line_comparisons
             │            └─ delivery_issues
             ├─ stock_movements
             ├─ waste_log
             ├─ notifications
             └─ restaurant_invites (NOT in generated types)
```

**Legacy parallel:** `purchase_history`, `purchase_history_items`, `invitations`, `user_invites`

---

## Enums (8)

| Enum | Values |
|------|--------|
| `app_role` | OWNER, MANAGER, STAFF |
| `session_status` | IN_PROGRESS, IN_REVIEW, APPROVED |
| `order_status` | PENDING, PREP, READY, COMPLETED, CANCELED (POS legacy) |
| `invitation_status` | PENDING, ACCEPTED, EXPIRED, REVOKED |
| `restaurant_invite_status` | pending, accepted, revoked, expired |
| `notification_severity` | INFO, WARNING, CRITICAL |
| `email_digest_mode` | IMMEDIATE, DAILY_DIGEST |
| `recipients_mode` | OWNERS_MANAGERS, ALL, CUSTOM |

---

## RLS summary

- **466** `CREATE POLICY` statements across migrations (includes superseded)
- RLS enabled on all core tenant tables from initial migration
- **`anon` DML revoked** on public schema (`20260425130000_revoke_anon_dml.sql`)

### Key policies

| Table | SELECT rule | Issue |
|-------|-------------|-------|
| `restaurants` | `is_member_of(id)` | OK |
| `restaurant_members` | `is_member_of(restaurant_id)` | INSERT owner-only after fix |
| `locations` | `is_member_of(restaurant_id)` | **HIGH: no location assignment filter** |
| `inventory_sessions` | Member + location helpers (extended) | OK for sessions |
| `invoices` | `is_member_of` + child location match | OK |
| `restaurant_invites` | OWNER/MANAGER view; **no client write** | OK |
| `waste_log` | Member read; insert own; delete manager+ | OK |

---

## SECURITY DEFINER functions (sensitive)

| Function | Purpose | Hardening |
|----------|---------|-----------|
| `is_member_of`, `has_restaurant_role*` | Tenant checks | search_path set |
| `approve_inventory_session_atomic` | Approval | INVOKER + role check inside |
| `confirm_invoice_receipt` | Financial post | `can_confirm_receipt` |
| `submit_smart_order` | PO creation | `can_approve_order_amount` |
| `create_invite`, `accept_invite` | Invites | DEFINER writes |
| `create_member_notifications` | Alert insert | Type allowlist |
| `delete_restaurant_cascade` | Destructive | Owner gate inside |
| `get_invite_preview` | Pre-auth preview | Non-consuming |
| `user_can_access_location` | Location scope | Used in child RLS |

**Fixed escalation:** `20260706000001` removed self-insert OWNER on `restaurant_members`

**Anon revoke on:** `get_location_permissions` (`20260623000005`)

---

## Edge Functions and service role

| Function | Service role use | Public? |
|----------|------------------|---------|
| `send-invite` | Yes | JWT required |
| `parse-invoice` | Optional (email path) | JWT or service |
| `inbound-invoice-email` | Yes | Webhook secret |
| `audit-invoice-anon` | Yes (parse) | **Public CORS *** |
| `process-notifications` | Yes | Cron/service auth |
| `stripe-webhook` | Yes | Stripe signature |

---

## Storage buckets

- `restaurant-logos` — migration `20260220121430`
- Invoice uploads — `invoice_ingestions` migration references storage policies

---

## Security findings

| ID | Finding | Severity | Evidence |
|----|---------|----------|----------|
| SEC-01 | Manager reads unassigned location rows | **High** | `locations` policy `is_member_of`; baseline DEF-LOCAL-001 |
| SEC-02 | Manager dashboard loads spend KPIs without `can_see_costs` | **Medium** | `useDashboardData.ts` unconditional loaders |
| SEC-03 | Staff may read catalog costs via member RLS | **Medium** | Unverified in UI; catalog SELECT member policy |
| SEC-04 | Public audit endpoint uses service role parse | **Medium** | `audit-invoice-anon/index.ts` by design |
| SEC-05 | Three invite systems increase misconfig risk | **Medium** | invitations + user_invites + restaurant_invites |
| SEC-06 | Legacy purchase_history path bypasses pure invoice model | **Low** | Dual confirm paths |
| SEC-07 | restaurant_members INSERT self-branch | **Fixed Critical** | `20260706000001` |
| SEC-08 | anon DML on public tables | **Fixed** | `20260425130000` |
| SEC-09 | Token stored as hash only in restaurant_invites | **Informational** | `20260707000001` |
| SEC-10 | Invite cannot grant OWNER | **Informational** | CHECK constraint on restaurant_invites |

---

## Cross-tenant verification (baseline)

| Probe | Result |
|-------|--------|
| Owner A read Org B catalog | 0 rows ✓ |
| Owner B read Org A | 0 rows ✓ |
| Employee A1 read A2 sessions | 0 rows ✓ |
| Manager A1 read A2 location | **1 row ✗** |
| Owner A waste insert Org B | RLS violation ✓ |

Playwright: `tenant-isolation-local.spec.ts` — 3/3 PASS (JWT read probes)

---

## Recommendations (documentation only — not implemented)

1. Change `locations` SELECT to `user_can_access_location(auth.uid(), id)` for non-OWNER
2. Enforce `has_location_permission` in RLS for cost-bearing views or move to RPC-only reads
3. Retire `invitations` + `user_invites` after migration to `restaurant_invites`
4. Regenerate TypeScript types from live schema
5. Add audit log table for confirm_receipt and submit_smart_order (missing today)
