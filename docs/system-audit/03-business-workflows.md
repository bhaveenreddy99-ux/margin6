# 03 — Business Workflows

End-to-end traces from verified code paths. **Production-ready** = code + tests exist and baseline/E2E not contradicting.

---

## Full flow sequence diagram

```
Signup/Login
    → accept_user_invites (if pending)
    → restaurant_members loaded
    → user_ui_state restores restaurant/location
    → [Owner] create_restaurant_with_owner
    → [Owner] send-invite edge fn → restaurant_invites
    → AcceptInvite → accept_invite RPC → member + user_location_assignments

Inventory list setup (ListManagement)
    → inventory_lists, inventory_catalog_items, list_categories

Count: createInventorySession → IN_PROGRESS
    → zone/legacy stock writes → inventory_session_items (+ zones)
    → submitInventorySessionForReview → IN_REVIEW
    → dispatchAppNotification COUNT_SUBMITTED

Review: approveInventorySession
    → prepareSmartOrderFromSession (TS math)
    → approve_inventory_session_atomic RPC → APPROVED + smart_order_runs
    → LOW_STOCK notifications + COUNT_APPROVED + SMART_ORDER_READY

Smart Order UI: edit run items
    → submit_smart_order RPC → purchase_orders + items

Invoice intake: draft invoice + items (+ parse-invoice)
    → save RECEIVED → status review, receipt_status reviewing
    → insertComparisonRows → invoice_line_comparisons
    → notify_delivery_issues

Receipt: confirm_invoice_receipt RPC
    → stock_movements (receive)
    → catalog cost updates
    → PRICE_INCREASE notifications
    → status confirmed

Dashboard: useDashboardData loaders → buildDashboardSnapshot
Waste: waste_log insert (any member)
Alerts: notifications + process-notifications cron (email digest)
```

---

## Step-by-step matrix

| # | Step | Trigger | Logic location | Tables read | Tables written | RPC/Edge | Auth | Tests | Ready? |
|---|------|---------|----------------|-------------|----------------|----------|------|-------|--------|
| 1 | Signup | Form submit | `Signup.tsx` | — | auth.users, profiles (trigger) | — | Public | Unverified | **Partial** |
| 2 | Restaurant create | Onboarding form | `CreateRestaurant.tsx` | — | restaurants, members, locations, settings | `create_restaurant_with_owner` | Authenticated | Unverified | **Working** |
| 3 | Location create | Settings | `useLocationSettings.ts` | locations | locations, location_settings | — | OWNER | Unverified | **Working** |
| 4 | Team invite | Settings team | `sendTeamInvite.ts` | — | restaurant_invites | `send-invite` fn | OWNER/MANAGER | SQL tests | **Working** |
| 5 | Invite accept | `/accept-invite` | `AcceptInvite.tsx` | restaurant_invites | members, assignments | `accept_invite` | Authenticated | SQL tests | **Working** |
| 6 | Membership | Login | `RestaurantContext` | restaurant_members | — | `accept_user_invites` | JWT | authz-parity | **Working** |
| 7 | Location assignment | Settings | `useLocationSettings.ts` | ula | user_location_assignments | — | OWNER | authz-parity | **Working** |
| 8 | List setup | ListManagement | hooks + domain | lists, catalog | inventory_lists, catalog | — | MANAGER+ | list-management tests | **Partial** |
| 9 | Count create | Enter inventory | `createInventorySession` | lists | inventory_sessions | — | Member + location | workflow test | **Working** |
| 10 | Count entry | Session editor | zone pipeline | session_items, zones | session_items, zones | — | Member | baseline SKIP | **Partial** |
| 11 | Count submit | Submit button | `submitInventorySessionForReview` | sessions | sessions (IN_REVIEW) | — | Staff RLS | workflow test | **Working** |
| 12 | Count review | Review page | UI list | sessions | — | — | MANAGER+ route | baseline PASS queue | **Partial** |
| 13 | Count approve | Approve btn | `approveInventorySession` | sessions, par | sessions, smart_order_* | `approve_inventory_session_atomic` | RPC MANAGER+ | workflow + SQL smoke | **Working** |
| 14 | Inventory snapshot | Approval | RPC + TS | session_items | smart_order_run_items | atomic RPC | MANAGER+ | zone-count tests | **Working** (no stock_movement) |
| 15 | PAR calc | Approval/smart order | `parGuideLevels.ts`, `itemView.ts` | par_guide_items | — | — | — | canonicalParResolver test | **Working** |
| 16 | Smart order gen | On approval | `smartOrderFromSession.ts` | session items | smart_order_runs | atomic RPC | MANAGER+ | smart-order-from-session | **Working** |
| 17 | Order edit | SmartOrder page | `SmartOrder.tsx` | run_items | run_items (direct) | — | MANAGER+ | Unverified | **Partial** |
| 18 | Order submit | Submit btn | `SmartOrder.tsx` | runs | purchase_orders | `submit_smart_order` | `can_approve_order_amount` | Unverified | **Partial** |
| 19 | Order approval | Threshold | RPC | ula, members | PO status | `submit_smart_order` | Server threshold | authz-parity | **Working** |
| 20 | Delivery receiving | Invoice review | `useInvoiceReviewActions` | comparisons | comparisons (received_qty) | — | MANAGER+ | invoice-review-actions | **Partial** |
| 21 | Invoice upload | Invoices intake | `useInvoiceActions` | — | invoices, items, ingestions | `parse-invoice` | MANAGER+ | parse-invoice-auth test | **Working** |
| 22 | Invoice parse | File upload | edge fn | — | — | `parse-invoice` (Claude) | JWT member | parse-invoice-auth | **Working** |
| 23 | Line correction | Review UI | mapping handlers | catalog | invoice_items, comparisons | — | MANAGER+ | invoice tests | **Partial** |
| 24 | Order vs invoice | First review load | `buildComparisonRows` | PO, invoice | invoice_line_comparisons | — | MANAGER+ | build-comparison-rows | **Working** |
| 25 | Delivery vs invoice | Comparison status | `invoice-comparison.ts` | comparisons | — | — | — | invoice-comparison test | **Working** |
| 26 | Receipt confirm | Post button | `handleConfirmReceipt` | comparisons | invoices, stock, catalog | `confirm_invoice_receipt` | `can_confirm_receipt` | invoice-review-actions | **Partial** (not E2E) |
| 27 | Inventory update | Receipt | RPC (server) | comparisons | stock_movements | confirm RPC | MANAGER+ | **Not baseline tested** | **Unverified** |
| 28 | Catalog cost update | Receipt | RPC (server) | invoice_items | inventory_catalog_items | confirm RPC | MANAGER+ | Unverified | **Unverified** |
| 29 | Price change | Receipt | RPC (server) | — | notifications | confirm RPC | Service | price-increase-notif test | **Partial** (UI empty) |
| 30 | Waste entry | WasteLog | `WasteLog.tsx` | catalog | waste_log | — | Member insert RLS | recorded-waste-value | **Partial** |
| 31 | Alert generation | Various | RPCs, edge fns | — | notifications | create_member_notifications, confirm RPC | Mixed | create-member-notif test | **Partial** |
| 32 | Notification delivery | Cron / dispatch | `process-notifications`, `dispatch-app-notifications` | notifications, prefs | notifications (read_at) | Edge fns | Service role | process-notifications-auth | **Partial** |
| 33 | Dashboard calc | Dashboard mount | `useDashboardData` | Many | — | — | OWNER/MANAGER | dashboard-trust-* | **Broken UI trust** |
| 34 | Audit display | AuditCenter | Settings | loaders | — | — | OWNER | audit-center test | **Unverified** |

---

## State machines (verified enums)

### `inventory_sessions.status` (`session_status`)
`IN_PROGRESS` → `IN_REVIEW` → `APPROVED` (reopen to IN_REVIEW guarded if downstream POs/invoices)

### `invoices.status`
`draft` → `review` → `confirmed` (+ `ready_to_receive` in schema but **not set by app**)

### `invoices.receipt_status`
`pending` → `reviewing` → `confirmed` | `issues_reported`

### `purchase_orders.status`
`draft` | `submitted` | `partially_received` | `closed` | `cancelled`

---

## Failure behaviors (verified patterns)

| Action | Failure mode |
|--------|--------------|
| Count submit | Toast; status unchanged if RLS/optimistic lock fails |
| Approve | Throws if duplicate items, empty smart order, RPC auth fail |
| submit_smart_order | Toast with mapped message; threshold/permission errors from RPC |
| confirm_invoice_receipt | JSON `{success:false}` or PostgREST error; UI shows message |
| Invite accept | Terminal states: expired, revoked, used, invalid token |

---

## Mock / demo paths

| Path | Evidence |
|------|----------|
| `/demo` | Demo restaurant via `create_restaurant_with_owner(p_is_demo:true)` |
| Vendor import tabs | `is_mock: true` in edge function responses |
| `DemoRoleSwitcher` | UI-only role override in demo mode |
