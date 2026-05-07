# RestaurantIQ Test Data Seed

Complete end-to-end test data for a 3-store franchise operation.

## What Gets Created

**Restaurant:** Midwest Franchise Group  
**Locations:** 3 Schlotzsky's stores (Naperville, Aurora, Bolingbrook)  
**Users:**
- Marcus Rivera (Owner) - `owner@midwestfg.com`
- Jordan Lee (Manager) - `manager@midwestfg.com`  
- Sam Patel (Staff) - `staff@midwestfg.com`

**Data:**
- 20 catalog items across 5 categories
- PAR guide with levels for all items
- 4 inventory sessions (3 approved, 1 in-review)
- 1 smart order run + submitted PO
- 2 invoices (1 confirmed, 1 with delivery issues)
- 5 notifications (LOW_STOCK, DELIVERY_ISSUE, PRICE_INCREASE, REMINDER)
- 2 waste log entries

## Prerequisites

1. **Push pending migrations first:**
   ```bash
   supabase db push
   ```

2. **Get your service role key:**
   - Go to Supabase dashboard → Settings → API
   - Copy the `service_role` key (NOT the `anon` key)

## Usage

### Run the seed:
```bash
SUPABASE_SERVICE_ROLE_KEY="your-service-role-key-here" node seed-test-data.js
```

### Reset and re-seed:
```bash
SUPABASE_SERVICE_ROLE_KEY="your-service-role-key-here" node teardown-test-data.js
SUPABASE_SERVICE_ROLE_KEY="your-service-role-key-here" node seed-test-data.js
```

## What to Test After Seeding

### Dashboard (Naperville)
- **Reorder needed:** ~$1,200 (8 items below PAR)
- **Critical low stock:** 3 RED items (Chicken, Turkey, Pastrami)
- **Overstock:** $0 (healthy inventory)
- **Spend This Week:** ~$1,185 (from Sysco invoice)

### Dashboard (Aurora)
- **Reorder needed:** $0 (healthy stock)
- **Overstock:** ~$378 (24 cases of Cheddar vs PAR 15)
- **Delivery Issue:** 1 missing item on US Foods invoice
- **Price Increase:** Chicken Breast $89 → $96 (+7.9%)

### Dashboard (Bolingbrook)
- **Session in review:** Weekly count waiting for manager approval

### Notifications
- 5 unread notifications across LOW_STOCK, DELIVERY_ISSUE, PRICE_INCREASE, REMINDER

### Smart Order
- Naperville has a submitted PO for 8 items totaling ~$1,200

### Invoices
- Sysco invoice confirmed (all items received)
- US Foods invoice with issues (missing tomatoes + price increase)

## Testing Workflow

1. Open dashboard → see Naperville low stock alerts
2. Click "Smart Order" → review suggested quantities
3. Go to Invoices → review US Foods delivery issues
4. Go to Notifications → see PRICE_INCREASE alert
5. Go to Inventory Management → approve Bolingbrook session
6. Switch between locations to see portfolio view

## Notes

- All timestamps are relative to current date
- Stock levels designed to trigger specific alerts
- Invoice #1 matches the smart order PO
- Invoice #2 intentionally has discrepancies for testing
