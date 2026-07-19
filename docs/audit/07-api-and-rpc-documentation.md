# 07 — API & RPC Documentation (Phase 9)

There is **no REST/GraphQL API server**. The "API" is (1) Supabase **PostgREST** over RLS-guarded tables, (2) Postgres **RPC** functions, and (3) **Edge Functions** (documented separately in [08](./08-edge-function-documentation.md)).

## Data-access pattern (verified)
- Single typed client `supabase` (`src/integrations/supabase/client.ts`).
- **TanStack Query is configured but not used for data** — no `useQuery`/`useMutation` in `src`. Real pattern: `useEffect` + `useState` + direct `supabase.from(...).select/insert/update/delete`, `supabase.rpc(...)`, `supabase.functions.invoke(...)`.
- `QueryClient` defaults: `staleTime 5m`, `gcTime 10m`, `retry 1`, `refetchOnWindowFocus:false`, `refetchOnMount:false` (`App.tsx`).
- Ad-hoc caching via refs in `useDashboardData`. Realtime subscription in `useNotifications`.

## RPC catalog

Signatures from `types.ts` `Functions` + migrations. Auth column = internal check (all reachable via `supabase.rpc`).

### Business RPCs
| RPC | Args | Returns | Auth (internal) | Purpose |
|---|---|---|---|---|
| `create_restaurant_with_owner` | `p_name`, `p_is_demo?` | `restaurants` row | requires `auth.uid()` | Create tenant + OWNER membership (+demo seed). |
| `accept_user_invites` | — | `Json` | uses `auth.uid()` | Apply pending legacy invites on login. |
| `accept_invite` | `p_token` | `{restaurant_id, role, location_id}[]` | auth + email match | Consume `restaurant_invites` token. |
| `get_invite_preview` | `p_token` | invite preview[] | **anon allowed** (token capability) | Preview invite pre-login. |
| `create_invite` | (role, email, location, flags) | invite | OWNER / limited MANAGER | Create `restaurant_invites`. |
| `list_invites` | `p_restaurant_id` | invite[] | `can_manage_invite` | List invites. |
| `revoke_invite` | `p_invite_id` | void | `can_manage_invite` | Revoke. |
| `resend_invite` | (invite) | — | `can_manage_invite` | Resend. |
| `approve_inventory_session_atomic` | `p_session_id`, `p_user_id`, `p_par_guide_id?`, `p_run_items?` | `{run_id, location_id, catalog_links_stripped}[]` | caller==user + OWNER/MANAGER + status IN_REVIEW (SECURITY **INVOKER**) | Approve count + create smart-order run atomically. |
| `submit_smart_order` | `p_run_id` | `Json` | `is_member_of` + `can_approve_order_amount` | Generate PO from run. |
| `confirm_invoice_receipt` | `p_invoice_id`, `p_restaurant_id` | `Json` | `can_confirm_receipt` (manager/owner) | Receive: stock movements + last-cost + notifications. |
| `confirm_invoice_receipt_legacy` | same | `Json` | manager/owner | Legacy receive path. |
| `reprocess_invoice_item_stock` | `p_invoice_item_id` | `Json` | (definer) | Recompute stock for a line. |
| `create_member_notifications` | restaurant, recipients[], type, severity, title, message, data? | `number` | membership + type allowlist + recipient member | Only safe way to insert notifications. |
| `notify_delivery_issues` | `p_purchase_history_id` | `Json` | (definer) | Emit delivery-issue notifications. |
| `notify_pack_conversion_failures` | `p_failed_items`, `p_invoice_id` | `Json` | (definer) | Emit conversion-failure notifications. |
| `delete_inventory_list` | `list_id` | void | owner check (`20260624000001`) | Cascade-delete a list. |
| `delete_restaurant_cascade` | `p_restaurant_id` | void | owner check | Delete a whole tenant. |
| `generate_po_number` | `p_restaurant_id` | `text` | **none** ⚠ | Increment `restaurant_counters`, return PO#. |

### Read/analytics RPCs
| RPC | Args | Returns | Purpose |
|---|---|---|---|
| `get_delivery_issue_pos` | `p_restaurant_id` | `{issue_count, po_number, purchase_history_id}[]` | POs with open issues. |
| `get_invoice_stock_audit` | `p_invoice_id` | detailed per-line stock/cost audit[] | Receiving audit. |
| `get_pack_unit_issues` | `p_restaurant_id` | pack/conversion issue rows[] | Conversion diagnostics. |
| `get_location_permissions` | `p_location_id`, `p_uid` | permission flags[] | Per-location perms (⚠ `p_uid` unbound). |
| `normalize_received_qty_to_cases` | `p_pack_size`, `p_qty`, `p_unit` | `{cases, conv_status, ok, reason}[]` | Qty→cases (DB mirror of receivingEngine). |

### Authorization helper functions (used inside RLS/RPC)
`is_member_of(r_id)`, `has_restaurant_role(_role, r_id)`, `has_restaurant_role_any(_roles, r_id)`, `user_accessible_location_ids(p_uid)`, `user_can_access_location(p_location_id, p_uid)`, `can_approve_order_amount`, `can_confirm_receipt`, `can_manage_invite`, `has_location_permission`, and the `*_restaurant_id` join family (`invoice_restaurant_id`, `session_restaurant_id`, `session_item_restaurant_id`, `order_restaurant_id`, `par_guide_restaurant_id`, `purchase_history_restaurant_id`, `purchase_order_restaurant_id`, `reminder_restaurant_id`, `smart_order_run_restaurant_id`, `custom_list_restaurant_id`, `list_category_restaurant_id`, `list_item_map_restaurant_id`, `invitation_restaurant_id`, `alert_pref_restaurant_id`).

## PostgREST usage highlights (where each surface is hit)
- **Auth flows:** `Login`, `Signup`, `AcceptInvite`, `ResetPassword` (`supabase.auth.*`).
- **Tenancy:** `RestaurantContext` reads `restaurant_members(+restaurants)`, `user_location_assignments`, `user_ui_state`.
- **Inventory count:** `features/inventory-count/queries/inventoryCountQueries.ts` reads lists/sessions/items/zones/par; command hooks write.
- **Invoices:** `useInvoicesData` (+ `get_delivery_issue_pos`), `useInvoiceActions` (invoice/items/ingestions/storage + `parse-invoice`), `useInvoiceReviewData/Actions` (comparisons, `confirm_invoice_receipt`, delivery_issues).
- **Dashboard:** `useDashboardData` + `domain/dashboard/load*` (approved session, invoices, purchase history, waste, notifications, sales).
- **Settings:** `Settings.tsx` writes settings tables + `delete_restaurant_cascade`; `AlertSettings`/`ReminderSettings`/`InventorySchedule` write prefs/recipients/reminders.

## Error handling in the data layer
- Most hooks set local `error`/`loading` and toast on failure.
- Dashboard loaders return per-KPI error flags (no fake `$0`).
- Several write paths do **not** re-check `error` from supabase (best-effort) — see Technical Debt.
