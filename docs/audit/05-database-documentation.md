# 05 — Database Documentation (Phase 6)

**Engine:** PostgreSQL 17 (`config.toml`). **Migrations:** 131 (`supabase/migrations`). **Generated types:** `src/integrations/supabase/types.ts` (authoritative for columns, **stale** for `restaurants` billing columns and `restaurant_invites`). **RLS:** enabled on every public table. Live DB introspection was not performed — statements derive from migrations + snapshot and are marked `NOT VERIFIED` where runtime state matters.

## Enums (`public`)
| Enum | Values |
|---|---|
| `app_role` | OWNER, MANAGER, STAFF |
| `session_status` | IN_PROGRESS, IN_REVIEW, APPROVED |
| `order_status` | PENDING, PREP, READY, COMPLETED, CANCELED |
| `invitation_status` | PENDING, ACCEPTED, EXPIRED, REVOKED |
| `notification_severity` | INFO, WARNING, CRITICAL |
| `email_digest_mode` | IMMEDIATE, DAILY_DIGEST |
| `recipients_mode` | OWNERS_MANAGERS, ALL, CUSTOM |
| `restaurant_invite_status` | pending, accepted, revoked, expired (`20260707000001`) |

## Table catalog (~60 tables)

Grouped by domain. For each: purpose, key relationships, write role (final RLS), business importance. "Members" = `is_member_of`; "Manager+" = `has_restaurant_role_any(OWNER,MANAGER)`.

### Tenancy & identity
| Table | Purpose | Key FKs | Write policy | Importance |
|---|---|---|---|---|
| `restaurants` | Tenant root (+ Stripe billing cols) | — | UPDATE Owners | Critical |
| `restaurant_members` | user↔restaurant role | restaurant | I/U/D Owners (self-insert removed `20260706000001`) | Critical (drives all RLS) |
| `profiles` | user profile (from `handle_new_user`) | auth.users | I/U own; SELECT own + co-member | High |
| `restaurant_settings` | per-restaurant config, `invoice_email`, logo | restaurant (1:1) | I/U Manager+, D Owner | High |
| `restaurant_counters` | PO sequence per restaurant | restaurant (1:1) | no direct write (RPC only) | Medium |
| `user_ui_state` | selected restaurant/location | restaurant, location | own-user | Medium |
| `locations` | physical/logical location | restaurant | I/U/D Manager+ | Critical |
| `location_settings` | count freq, food-cost target, invoice email | location (1:1) | ALL Manager+ | High |
| `user_location_assignments` | per-location role + 6 permission flags | location | ALL Owners | High (UI perms) |

### Invites (three parallel systems)
| Table | Purpose | Write policy | Notes |
|---|---|---|---|
| `restaurant_invites` | current invite (hashed token, role≠OWNER) | none direct (RPC) | SELECT Owner/Manager |
| `user_invites` | legacy invite w/ permission flags | Owners | superseded |
| `invitations` | legacy invite + accept trigger | I/U/D Owners | superseded |

### Inventory lists & catalog
| Table | Purpose | Write policy | Notes |
|---|---|---|---|
| `inventory_lists` | a countable list | I Members, U/D Manager+ | — |
| `inventory_catalog_items` | catalog item (pack, cost, PAR, vendor) | Members | central item record; **use `catalog_item_id`** |
| `list_categories` / `list_category_sets` / `list_item_category_map` | list categorization | Members | current category model |
| `custom_lists` / `custom_list_items` | ad-hoc lists | Members | — |
| `import_templates` / `import_runs` / `inventory_import_files` | spreadsheet import | Members | template fingerprinting |
| `categories` / `inventory_items` / `par_items` | **legacy** first-gen list model | Members | superseded |

### Counting sessions
| Table | Purpose | Write policy | Notes |
|---|---|---|---|
| `inventory_sessions` | count session + status | I Members; U staff-own-in-progress + Manager+; D manager+ or own-in-progress | approved immutable |
| `inventory_session_items` | counted line (versioned) | S/I/U Members; D restricted (`20260623000001`) | `trg_session_item_version` |
| `inventory_session_item_zones` | per-zone counts | Members | normalized_qty |

### PAR
| Table | Write policy | Notes |
|---|---|---|
| `par_guides` | I/U/D Manager+ | guide header |
| `par_guide_items` | I/U/D Manager+ (`20260624000003`) | `catalog_item_id` link |
| `par_settings` | I/U Manager+ | lead time, reorder threshold |

### Ordering & purchasing
| Table | Purpose | Write policy | Notes |
|---|---|---|---|
| `smart_order_runs` | a suggested-order run | S/I/D Members | created by approval RPC |
| `smart_order_run_items` | run line (risk, suggested qty) | S/I/D Members | — |
| `smart_order_settings` | red/yellow thresholds, auto flags | I/U Manager+ | — |
| `purchase_orders` | submitted PO | I/U/D Manager+ | from `submit_smart_order` |
| `purchase_order_items` | PO line | I/U/D Manager+ | — |
| `purchase_history` | procurement timeline | I/U/D Manager+ | PO + invoice + legacy |
| `purchase_history_items` | history line | I/U/D Manager+ (`20260623000002`) | — |
| `orders` / `order_items` / `usage_events` | **legacy** ordering | Members | near-dead |

### Invoices & receiving
| Table | Purpose | Write policy | Notes |
|---|---|---|---|
| `invoices` | invoice header (+ receipt_status) | I/U/D Manager+ | from upload/email |
| `invoice_items` | invoice line | I/U/D Manager+ | AI-parsed |
| `invoice_ingestions` | source file record | authenticated member | storage path |
| `invoice_line_comparisons` | PO↔invoice↔received compare | Members (parent EXISTS) | variance |
| `delivery_issues` | reported issues | Members | — |
| `stock_movements` | stock in/out ledger | S/I Members | receiving; `trg_sync_catalog_price_on_receive` |
| `vendor_integrations` | vendor API config (encrypted key) | I/U/D Manager+ | mock today |
| `vendor_item_mappings` | vendor item → catalog | Members | matching aid |
| `failed_inbound_emails` | dead-letter | SELECT none; INSERT service_role (`WITH CHECK true`) | — |

### Sales / waste
| Table | Purpose | Write policy | Notes |
|---|---|---|---|
| `weekly_sales` | weekly sales | I/U/D Manager+ (`20260623000003`) | food-cost denominator |
| `daily_sales` | daily sales | I/U/D Manager+ | daily→weekly agg trigger |
| `waste_log` | waste entries | I/D Members | `total_cost` client-set |

### Notifications
| Table | Purpose | Write policy | Notes |
|---|---|---|---|
| `notifications` | in-app feed | INSERT **RPC-only** (`20260623000004`); S/U own-user | idempotency_key, dedupe trigger |
| `notification_preferences` | channel/type prefs | S/I/U Members | any member editable |
| `alert_recipients` | custom recipients | I/D Members | — |
| `reminders` / `reminder_targets` | count reminders | Manager+ / I-D Manager+ | cron consumed |

## Relationships (high level)
- Everything hangs off `restaurants` via `restaurant_id`. Most operational tables also carry `location_id`.
- `inventory_sessions → inventory_session_items → inventory_session_item_zones`.
- Approval: `inventory_sessions → smart_order_runs → smart_order_run_items`.
- Ordering: `smart_order_runs → purchase_orders → purchase_order_items`; `purchase_order_items.smart_order_run_item_id` links back.
- Receiving: `purchase_orders → invoices → invoice_items → invoice_line_comparisons`; comparisons also reference `purchase_history(_items)` and `smart_order_runs`.
- Costing: `invoice_items`/`stock_movements → inventory_catalog_items.default_unit_cost`.

## Triggers (verified)
| Trigger | Table | Function | Effect |
|---|---|---|---|
| `on_auth_user_created` | `auth.users` | `handle_new_user` | bootstraps `profiles` |
| `on_user_created_accept_invitations` | `profiles` | `accept_pending_invitations` | auto-accept legacy invites |
| `trg_create_default_notification_preferences` | `restaurants` | — | seed prefs |
| `sync_par_category_on_item_update` | `inventory_items` | — | legacy PAR/category sync |
| `trg_session_item_version` | `inventory_session_items` | — | version increment |
| `trg_sync_catalog_price_on_receive` | `stock_movements` | — | catalog last-cost sync on receipt |
| `daily_sales_set_updated_at` / `weekly_sales_set_updated_at` | sales | — | updated_at |
| `daily_to_weekly_agg` | `daily_sales` | — | aggregate daily → weekly |
| `notifications_dedupe_within_hour` | `notifications` | — | dedupe (`20260522000002`) |

## RPC / DB functions
See [07 — API & RPC Documentation](./07-api-and-rpc-documentation.md) for full signatures. ~52 SECURITY DEFINER functions: authz helpers (`is_member_of`, `has_restaurant_role*`, `user_can_access_location`, `user_accessible_location_ids`, `get_location_permissions`, `can_approve_order_amount`, `can_confirm_receipt`, `can_manage_invite`), `*_restaurant_id` join helpers, and business RPCs (`create_restaurant_with_owner`, `approve_inventory_session_atomic` [SECURITY INVOKER], `submit_smart_order`, `confirm_invoice_receipt`(+`_legacy`), `create_member_notifications`, invite RPCs, `delete_restaurant_cascade`, `delete_inventory_list`, `generate_po_number`, `normalize_received_qty_to_cases`, `reprocess_invoice_item_stock`, `get_invoice_stock_audit`, `get_pack_unit_issues`, `get_delivery_issue_pos`, `notify_delivery_issues`, `notify_pack_conversion_failures`).

## Views
None (`types.ts` Views = `never`).

## Indexes (notable, from migrations)
- `20260508000001_performance_indexes`: `notifications(user_id, read_at)`, `notifications(restaurant_id, type)`, `alert_recipients(notification_pref_id)`, `smart_order_run_items(run_id)`, `stock_movements(catalog_item_id)`.
- `invoice_ingestions` indexes (`20260411130000`); sales indexes (`20260518000001`); partial Stripe indexes on `restaurants` (`20260521000001`); `restaurant_invites` unique token/index (`20260707000001`); catalog sort-order index (`20260219002353`).

## Constraints (notable)
- `restaurants_subscription_status_chk`: `subscription_status IN ('trial','active','past_due','canceled')`.
- Catalog/session string-length checks (`20260212031105`).
- Sales unique `(location_id, week_start)` / `(location_id, sale_date)` + entry-method checks.
- `restaurant_invites`: role ≠ OWNER, lowercased email, unique token hash.

## Storage buckets
| Bucket | Public | Policies |
|---|---|---|
| `restaurant-logos` | **public** | public SELECT; writes member-by-folder (restaurant UUID) (`20260222214112`) |
| `invoice-uploads` | private | authenticated + membership-by-folder (`20260411130000`) |

## Extensions & cron
- `pg_cron`, `pg_net` (`20260214040101`).
- Job `process-notifications-hourly` (`0 * * * *`) → `net.http_post` to the edge function with a service-role bearer from DB settings (`20260522000003`, prefix fixed `20260624000002`). Runtime `cron.job` state **NOT VERIFIED**.

## Per-table quick reference (purpose · read · write · referenced-by · importance)
> Full read/write op tracing lives in the Feature Inventory + Workflow docs; the table catalog above lists write roles. The **five most business-critical tables** are: `restaurant_members` (all RLS depends on it), `inventory_catalog_items` (item system of record + cost), `inventory_session_items` (count truth), `invoices`/`invoice_items` (cost + spend truth), and `restaurants` (tenant + billing).

## Schema-drift & dead-schema notes
- **Billing columns** `subscription_status`, `trial_ends_at`, `stripe_customer_id`, `stripe_subscription_id` exist on `restaurants` (`20260521000001`) but are **absent from generated types** → code casts (`useSubscription.ts`).
- **`restaurant_invites`** exists (`20260707000001`) but is absent from generated types.
- **Recipe tables** were created (`20260417000002`) then **dropped** (`20260502000001`).
- **Legacy tables** (`categories`, `inventory_items`, `par_items`, `orders`, `order_items`, `usage_events`) remain but are superseded.
