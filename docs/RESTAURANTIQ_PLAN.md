RestaurantIQ — Product & Architecture Plan
1. Product Definition

RestaurantIQ is a multi-restaurant back-of-house operations platform.

It is NOT:

POS
customer ordering system
reservations
front-of-house

It IS:

inventory management
PAR management
smart ordering
purchase tracking
invoice matching
receiving workflow
waste tracking
notifications
analytics

Primary users:

restaurant owners
managers
kitchen leads
inventory staff

The goal:
control food cost and inventory across multiple restaurants

2. Core Workflow (Real Life)

This is the canonical workflow.

Step 1 — Item Master

Restaurant creates item catalog:

item name
item number
pack size
UOM
vendor
cost

Tables:

inventory_catalog_items
inventory_lists
list_categories
Step 2 — PAR Setup

User defines PAR levels

Tables:

par_guides
par_guide_items
Step 3 — Inventory Count

Staff counts inventory

Tables:

inventory_sessions
inventory_session_items

Flow:
Create session → Enter counts → Submit → Approve

Step 4 — Smart Order

System calculates:

order_qty = par - stock

Adjusted for:

pack size
case rounding
vendor minimums

Tables:

smart_order_runs
smart_order_run_items
Step 5 — Purchase Order

Smart order becomes PO

Tables:

purchase_history
purchase_history_items
Step 6 — Invoice Upload

User uploads invoice

Edge Function:
parse-invoice

Data:

items
qty
price
totals
Step 7 — Invoice Matching

System compares:

PO vs Invoice

Checks:

missing items
qty mismatch
price mismatch

Tables:

invoice_line_comparisons
delivery_issues
Step 8 — Receipt Confirmation

User confirms delivery

System:

updates purchase history
logs discrepancies
Step 9 — Waste Logging

User logs waste

Table:

waste_log
Step 10 — Notifications

System alerts:

low stock
price changes
missing items
waste spikes

Tables:

notifications
notification_preferences
3. Canonical Data Model (Use These Tables)

These are the real core tables:

Tenant
restaurants
restaurant_members
locations
profiles
Inventory
inventory_lists
inventory_catalog_items
list_categories
list_category_sets
list_item_category_map
PAR
par_guides
par_guide_items
Counts
inventory_sessions
inventory_session_items
Smart Order
smart_order_runs
smart_order_run_items
Purchasing
purchase_history
purchase_history_items
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
4. Deprecated / Legacy Tables (Do NOT Expand)

These exist but should not be expanded:

categories
inventory_items
par_items
custom_lists
custom_list_items

They belong to old architecture.

5. Critical Calculation Rules

These calculations must have one source of truth

Stock Risk
LOW  = stock < par
OK   = stock >= par
HIGH = stock > par * threshold
Smart Order
order = ceil((par - stock) / pack_size)

Must include:

pack size
rounding
vendor min
UOM conversion
Usage
usage = previous_stock + received - current_stock

NOT:
based on orders

Invoice Variance
qty_diff   = invoice_qty - po_qty
price_diff = invoice_price - po_price
total_diff = line_total_invoice - line_total_po
6. Backend Ownership Rules

These must live in backend:

smart order calculation
risk calculation
PAR suggestions
usage analytics
invoice comparison
dashboard totals
reporting aggregation

Frontend only:

display
formatting
filtering
UI logic
7. Multi-Tenant Rules

Every table must include:

restaurant_id

Optional:

location_id

RLS must enforce:

user can only access their restaurant

8. Known Problems (Current App)

These must be fixed:

duplicate calculation logic
unsafe receipt logic
fake usage data from orders
duplicate PAR engines
weak invoice matching
name-based item matching
missing pack-size conversions
inconsistent reports
missing audit logs
9. Architecture Rules

Cursor must follow:

Do not create duplicate tables
Use canonical tables only
Do not move logic to frontend
Prefer SQL / RPC for calculations
Preserve multi-tenant safety
Prefer item_id over item name
One calculation source of truth
Do not invent new workflows
Use migrations for schema changes
Keep backend authoritative
10. Future Features

Planned:

vendor master table
price history
audit logs
stock movement ledger
receiving workflow
substitution tracking
credit tracking
location-level inventory
scheduled ordering
AI forecasting
11. App Goal

RestaurantIQ should become:

"Inventory + Purchasing + Receiving platform for restaurants"

Not:

POS
ordering
menu management