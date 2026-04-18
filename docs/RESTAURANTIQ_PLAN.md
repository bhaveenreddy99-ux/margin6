RestaurantIQ — Master Product & Architecture Plan
1. Product Definition

RestaurantIQ is a multi-restaurant back-of-house operations platform.

It is NOT:

POS
customer ordering
reservations
front-of-house

It IS:

inventory management
PAR management
smart ordering
purchasing
invoice matching
receiving workflow
waste tracking
alerts & notifications
analytics & dashboards

Primary users:

restaurant owners
managers
kitchen leads
inventory staff

Primary goal:
Control food cost and inventory across multiple restaurants.

Primary wedge:
RestaurantIQ helps restaurants:

count faster
know what to order
catch supplier price changes
detect low/high stock
trust inventory numbers
2. Core Workflow (Canonical)

This is the real-life canonical workflow.

Step 1 — Item Master

Restaurant creates catalog:

item name
pack size
UOM
vendor
cost

Tables:

inventory_catalog_items
inventory_lists
list_categories
Step 2 — PAR Setup

User defines PAR levels.

Tables:

par_guides
par_guide_items
Step 3 — Inventory Count

Staff counts inventory.

Tables:

inventory_sessions
inventory_session_items

Flow:
Create session → Enter counts → Submit → Approve → Lock

Approved counts become baseline truth.

Step 4 — Smart Order

System calculates suggested order.

Formula:

target = par + usage_buffer
order = target - on_hand

Adjusted for:

pack size
case rounding
vendor minimums
UOM conversion

Tables:

smart_order_runs
smart_order_run_items
Step 5 — Purchase Order

Smart order becomes purchase order.

Tables:

purchase_orders
purchase_order_items
Step 6 — Invoice Upload

User uploads invoice.

Edge Function:
parse-invoice

Tables:

invoices
invoice_items
Step 7 — Invoice Matching

System compares:

PO vs Invoice

Checks:

missing items
quantity mismatch
price mismatch

Tables:

invoice_line_comparisons
delivery_issues
Step 8 — Receipt Confirmation

User confirms delivery.

System:

updates last paid cost
logs discrepancies
updates inventory truth
Step 9 — Waste Logging

User logs waste.

Table:

waste_log
Step 10 — Alerts & Dashboard

System alerts:

low stock
overstock
price increase
price decrease
missing items
waste spikes

Tables:

notifications
notification_preferences
alert_recipients
reminders
3. Inventory Truth Rules

Inventory must follow one source of truth.

On Hand:

on_hand =
approved_count
+ received
- waste
- adjustments

Never:

recomputed in UI
overwritten silently
based on orders
4. Price Truth Rules

Last Paid Cost:

last_paid_cost =
most recent confirmed invoice receipt cost

Must:

normalize pack size
normalize unit
track history
5. Smart Order Rules
target = PAR + expected usage
suggested = max(target - on_hand, 0)

Then apply:

pack size rounding
vendor minimums
UOM conversion
6. Stock Risk Rules

LOW

on_hand < reorder threshold

OK

healthy range

HIGH

on_hand > max threshold
7. Canonical Tables

Tenant

restaurants
restaurant_members
profiles
locations

Inventory

inventory_catalog_items
inventory_lists
list_categories
list_item_category_map

PAR

par_guides
par_guide_items

Counts

inventory_sessions
inventory_session_items

Smart Orders

smart_order_runs
smart_order_run_items

Purchasing

purchase_orders
purchase_order_items

Invoices

invoices
invoice_items

Invoice Matching

invoice_line_comparisons
delivery_issues

Vendors

vendor_item_mappings
vendor_integrations

Waste

waste_log

Notifications

notifications
notification_preferences
alert_recipients
reminders
8. Transitional Tables (Do Not Expand)
purchase_history
purchase_history_items

These are legacy procurement tables.

Future truth:
purchase_orders + invoices

9. Deprecated Tables (Old Architecture)

Do not expand:

categories
inventory_items
par_items
custom_lists
custom_list_items
10. Backend Ownership Rules

Must live in backend/domain:

smart order calculation
risk calculation
usage calculation
price change detection
invoice comparison
dashboard totals
reporting aggregation
alert generation

Frontend only:

display
filtering
formatting
UI interactions
11. Multi-Tenant Rules

Every table includes:

restaurant_id

Optional:

location_id

RLS must enforce:

user can only access their restaurant

12. Known Problems (Current App)

These must be fixed:

duplicate calculation logic
unsafe receipt logic
fake usage from orders
duplicate PAR engines
weak invoice matching
name-based matching
missing pack-size conversions
inconsistent dashboard
missing audit logs
fragmented price truth
no inventory ledger
giant page components
13. Architecture Rules

Cursor must follow:

Do not create duplicate tables
Use canonical tables only
Do not move logic to frontend
Prefer domain layer calculations
Preserve multi-tenant safety
Prefer item_id over name
One source of truth per calculation
Fix one issue at a time
Extract logic before rewriting
Backend authoritative
14. Folder Architecture
src/domain/inventory
src/domain/pricing
src/domain/ordering
src/domain/alerts
src/domain/dashboard
src/types

Pages must NOT contain core logic.

15. Stabilization Phase

Before new features:

fix lint issues
remove any types
remove unsafe casts
centralize inventory logic
centralize pricing logic
centralize alerts
clean dashboard metrics
split giant files
16. Execution Order

Phase 1

Fix EnterInventory.tsx
Fix InvoiceReview.tsx
Fix Invoices.tsx
Fix Dashboard.tsx

Phase 2

Create inventory rules
Create pricing rules
Create ordering rules
Create alert rules
Create dashboard metrics

Phase 3

Connect count workflow
Connect smart order
Connect invoice workflow
Connect notifications
Connect dashboard

Phase 4

Split giant files
Clean hooks
Extract services

Phase 5

Add inventory ledger
Add price history
Tighten item identity

Phase 6

polish dashboard
improve alerts
improve suggested order UX
17. Competitive Strategy

We compete by:

faster counting
simpler UI
better alerts
trusted dashboard
easier onboarding

We DO NOT compete by:

POS features
accounting system
menu management
enterprise analytics
18. Future Features

Planned:

vendor master table
price history
audit logs
stock movement ledger
receiving workflow
substitution tracking
credit tracking
location inventory
scheduled ordering
AI forecasting
19. Final App Goal

RestaurantIQ becomes:

"A fast, trustworthy inventory and purchasing platform that helps restaurants know what to count, what to order, and where money is leaking."

Not:

POS
ordering system
menu manager