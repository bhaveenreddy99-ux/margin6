#!/usr/bin/env node
/**
 * RestaurantIQ Full Workflow Test Seed
 * 
 * Simulates: "Midwest Franchise Group" with 3 Schlotzsky's locations
 * 
 * Owner:   Marcus Rivera
 * Manager: Jordan Lee (manages all 3 stores)
 * Staff:   Sam Patel
 * 
 * Creates:
 *   - 1 restaurant with 3 locations
 *   - 20 catalog items across 5 categories
 *   - PAR guide with levels for all items
 *   - 4 inventory sessions (2 approved Naperville, 1 approved Aurora, 1 in-review Bolingbrook)
 *   - 1 smart order run + submitted PO (Naperville)
 *   - 2 invoices (1 confirmed Sysco, 1 with issues US Foods)
 *   - Notifications (LOW_STOCK, DELIVERY_ISSUE, PRICE_INCREASE, REMINDER)
 *   - Waste log entries
 */

const { createClient } = require('@supabase/supabase-js');

// ─── Configuration ──────────────────────────────────────────────────────────
const SUPABASE_URL = process.env.SUPABASE_URL || 'http://127.0.0.1:54321';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_SERVICE_ROLE_KEY) {
  console.error('❌ SUPABASE_SERVICE_ROLE_KEY environment variable required');
  console.log('\nUsage:');
  console.log('  SUPABASE_SERVICE_ROLE_KEY="your-key" node seed-test-data.js\n');
  console.log('Get your service role key from Supabase dashboard → Settings → API');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false }
});

// ─── Stable UUIDs ───────────────────────────────────────────────────────────
const IDs = {
  restaurant: 'aaaaaaaa-0000-0000-0000-000000000001',
  
  locations: {
    naperville:   'bbbbbbbb-0000-0000-0000-000000000001',
    aurora:       'bbbbbbbb-0000-0000-0000-000000000002',
    bolingbrook:  'bbbbbbbb-0000-0000-0000-000000000003',
  },

  users: {
    owner:   '00000000-0000-0000-0000-000000000001',
    manager: '00000000-0000-0000-0000-000000000002',
    staff:   '00000000-0000-0000-0000-000000000003',
  },

  inventory_list: 'dddddddd-0000-0000-0000-000000000001',
  par_guide:      'dddddddd-0000-0000-0000-000000000002',

  sessions: {
    naperville_week1: 'eeeeeeee-0000-0000-0000-000000000001',
    naperville_week2: 'eeeeeeee-0000-0000-0000-000000000002',
    aurora_approved:  'eeeeeeee-0000-0000-0000-000000000003',
    bolingbrook_review: 'eeeeeeee-0000-0000-0000-000000000004',
  },

  smart_order_run: 'ffffffff-0000-0000-0000-000000000001',
  purchase_order:  'ffffffff-0000-0000-0000-000000000002',

  invoices: {
    sysco_confirmed: '11111111-0000-0000-0000-000000000001',
    usfoods_issues:  '11111111-0000-0000-0000-000000000002',
  },
};

// ─── Catalog Items (20 SKUs across 5 categories) ───────────────────────────
const CATALOG = [
  // Proteins
  { name: 'Chicken Breast', category: 'Proteins', unit: 'case', unit_cost: 89.00, par: 12 },
  { name: 'Sliced Turkey', category: 'Proteins', unit: 'case', unit_cost: 72.50, par: 8 },
  { name: 'Pastrami', category: 'Proteins', unit: 'case', unit_cost: 95.00, par: 6 },
  { name: 'Bacon', category: 'Proteins', unit: 'case', unit_cost: 68.00, par: 10 },

  // Dairy
  { name: 'Cheddar Cheese', category: 'Dairy', unit: 'case', unit_cost: 42.00, par: 15 },
  { name: 'Swiss Cheese', category: 'Dairy', unit: 'case', unit_cost: 48.00, par: 12 },
  { name: 'Cream Cheese', category: 'Dairy', unit: 'case', unit_cost: 32.00, par: 8 },
  { name: 'Sour Cream', category: 'Dairy', unit: 'case', unit_cost: 28.00, par: 10 },

  // Produce
  { name: 'Lettuce', category: 'Produce', unit: 'case', unit_cost: 24.00, par: 20 },
  { name: 'Tomatoes', category: 'Produce', unit: 'case', unit_cost: 32.00, par: 18 },
  { name: 'Onions', category: 'Produce', unit: 'case', unit_cost: 18.00, par: 12 },
  { name: 'Pickles', category: 'Produce', unit: 'case', unit_cost: 22.00, par: 10 },

  // Dry Goods
  { name: 'Sourdough Bread', category: 'Dry Goods', unit: 'case', unit_cost: 38.00, par: 25 },
  { name: 'Wheat Bread', category: 'Dry Goods', unit: 'case', unit_cost: 35.00, par: 20 },
  { name: 'Chips', category: 'Dry Goods', unit: 'case', unit_cost: 28.00, par: 30 },
  { name: 'Cookies', category: 'Dry Goods', unit: 'case', unit_cost: 24.00, par: 15 },

  // Beverages
  { name: 'Coca-Cola Syrup', category: 'Beverages', unit: 'case', unit_cost: 52.00, par: 8 },
  { name: 'Sprite Syrup', category: 'Beverages', unit: 'case', unit_cost: 48.00, par: 6 },
  { name: 'Iced Tea Mix', category: 'Beverages', unit: 'case', unit_cost: 36.00, par: 10 },
  { name: 'Lemonade Mix', category: 'Beverages', unit: 'case', unit_cost: 32.00, par: 8 },
];

// ─── Helper Functions ───────────────────────────────────────────────────────
function uuid() {
  return crypto.randomUUID();
}

function log(emoji, message) {
  console.log(`${emoji} ${message}`);
}

function nowISO() {
  return new Date().toISOString();
}

function daysAgo(days) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString();
}

// ─── Seed Script ────────────────────────────────────────────────────────────
async function seed() {
  log('🚀', 'Starting RestaurantIQ test data seed...\n');

  try {
    // ── 1. Create restaurant ────────────────────────────────────────────────
    log('🏢', 'Creating restaurant: Midwest Franchise Group');
    await supabase.from('restaurants').upsert({
      id: IDs.restaurant,
      name: 'Midwest Franchise Group',
      created_at: daysAgo(90),
    });

    // ── 2. Create 3 locations ───────────────────────────────────────────────
    log('📍', 'Creating 3 Schlotzsky\'s locations');
    await supabase.from('locations').upsert([
      {
        id: IDs.locations.naperville,
        restaurant_id: IDs.restaurant,
        name: 'Schlotzsky\'s Naperville',
        address: '123 Main St, Naperville, IL 60540',
        is_active: true,
        created_at: daysAgo(90),
      },
      {
        id: IDs.locations.aurora,
        restaurant_id: IDs.restaurant,
        name: 'Schlotzsky\'s Aurora',
        address: '456 Oak Ave, Aurora, IL 60506',
        is_active: true,
        created_at: daysAgo(90),
      },
      {
        id: IDs.locations.bolingbrook,
        restaurant_id: IDs.restaurant,
        name: 'Schlotzsky\'s Bolingbrook',
        address: '789 Weber Rd, Bolingbrook, IL 60440',
        is_active: true,
        created_at: daysAgo(90),
      },
    ]);

    // ── 3. Create users (owner, manager, staff) ────────────────────────────
    log('👥', 'Creating users (owner, manager, staff)');
    
    // Note: In production you'd create these via Supabase Auth
    // For testing, we'll create profiles + memberships directly
    await supabase.from('profiles').upsert([
      {
        id: IDs.users.owner,
        email: 'owner@midwestfg.com',
        full_name: 'Marcus Rivera',
        created_at: daysAgo(90),
      },
      {
        id: IDs.users.manager,
        email: 'manager@midwestfg.com',
        full_name: 'Jordan Lee',
        created_at: daysAgo(90),
      },
      {
        id: IDs.users.staff,
        email: 'staff@midwestfg.com',
        full_name: 'Sam Patel',
        created_at: daysAgo(30),
      },
    ]);

    await supabase.from('restaurant_members').upsert([
      {
        restaurant_id: IDs.restaurant,
        user_id: IDs.users.owner,
        role: 'OWNER',
        created_at: daysAgo(90),
      },
      {
        restaurant_id: IDs.restaurant,
        user_id: IDs.users.manager,
        role: 'MANAGER',
        created_at: daysAgo(90),
      },
      {
        restaurant_id: IDs.restaurant,
        user_id: IDs.users.staff,
        role: 'STAFF',
        created_at: daysAgo(30),
      },
    ]);

    // ── 4. Create catalog items ─────────────────────────────────────────────
    log('📦', `Creating ${CATALOG.length} catalog items`);
    
    const catalogRows = CATALOG.map((item, index) => ({
      id: `cccccccc-0000-0000-0000-0000000000${String(index + 1).padStart(2, '0')}`,
      restaurant_id: IDs.restaurant,
      item_name: item.name,
      category: item.category,
      unit: item.unit,
      unit_cost: item.unit_cost,
      default_unit_cost: item.unit_cost,
      created_at: daysAgo(85),
    }));

    await supabase.from('inventory_catalog_items').upsert(catalogRows);

    // ── 5. Create inventory list ────────────────────────────────────────────
    log('📋', 'Creating inventory list');
    await supabase.from('inventory_lists').upsert({
      id: IDs.inventory_list,
      restaurant_id: IDs.restaurant,
      name: 'Master Inventory',
      created_by: IDs.users.manager,
      created_at: daysAgo(85),
    });

    // ── 6. Create PAR guide ─────────────────────────────────────────────────
    log('🎯', 'Creating PAR guide with levels for all items');
    await supabase.from('par_guides').upsert({
      id: IDs.par_guide,
      restaurant_id: IDs.restaurant,
      name: 'Standard PAR Levels',
      created_by: IDs.users.manager,
      created_at: daysAgo(80),
    });

    const parItems = CATALOG.map((item, index) => ({
      par_guide_id: IDs.par_guide,
      catalog_item_id: catalogRows[index].id,
      item_name: item.name,
      category: item.category,
      unit: item.unit,
      par_level: item.par,
    }));

    await supabase.from('par_guide_items').upsert(parItems);

    log('✅', 'Base setup complete\n');
    log('📊', 'Building inventory sessions...');

    // ── 7. Inventory Sessions ───────────────────────────────────────────────
    
    // Session 1: Naperville approved (2 weeks ago)
    await createInventorySession({
      id: IDs.sessions.naperville_week1,
      location_id: IDs.locations.naperville,
      name: 'Week 1 Count - Naperville',
      status: 'APPROVED',
      created_at: daysAgo(14),
      approved_at: daysAgo(14),
      approved_by: IDs.users.manager,
      stockLevels: {
        'Chicken Breast': 10,
        'Sliced Turkey': 6,
        'Cheddar Cheese': 14,
        'Lettuce': 18,
        'Sourdough Bread': 22,
        'Coca-Cola Syrup': 7,
        // Rest at PAR
      },
    });

    // Session 2: Naperville approved (this week) - LOW STOCK
    await createInventorySession({
      id: IDs.sessions.naperville_week2,
      location_id: IDs.locations.naperville,
      name: 'Week 2 Count - Naperville',
      status: 'APPROVED',
      created_at: daysAgo(2),
      approved_at: daysAgo(2),
      approved_by: IDs.users.manager,
      stockLevels: {
        'Chicken Breast': 3,  // RED (PAR 12)
        'Sliced Turkey': 2,    // RED (PAR 8)
        'Pastrami': 1,         // RED (PAR 6)
        'Cheddar Cheese': 8,   // YELLOW (PAR 15)
        'Lettuce': 10,         // YELLOW (PAR 20)
        'Sourdough Bread': 12, // YELLOW (PAR 25)
        'Coca-Cola Syrup': 4,  // YELLOW (PAR 8)
        'Sprite Syrup': 3,     // YELLOW (PAR 6)
        // Rest at PAR
      },
    });

    // Session 3: Aurora approved - healthy stock
    await createInventorySession({
      id: IDs.sessions.aurora_approved,
      location_id: IDs.locations.aurora,
      name: 'Weekly Count - Aurora',
      status: 'APPROVED',
      created_at: daysAgo(3),
      approved_at: daysAgo(3),
      approved_by: IDs.users.manager,
      stockLevels: {
        'Cheddar Cheese': 24, // OVERSTOCK (PAR 15)
        // Rest at PAR
      },
    });

    // Session 4: Bolingbrook in review
    await createInventorySession({
      id: IDs.sessions.bolingbrook_review,
      location_id: IDs.locations.bolingbrook,
      name: 'Weekly Count - Bolingbrook',
      status: 'IN_REVIEW',
      created_at: daysAgo(1),
      stockLevels: {}, // All at PAR
    });

    log('✅', 'Inventory sessions created\n');

    // ── 8. Smart Order + PO ─────────────────────────────────────────────────
    log('🤖', 'Creating smart order run + submitted PO (Naperville)');
    
    await supabase.from('smart_order_runs').upsert({
      id: IDs.smart_order_run,
      restaurant_id: IDs.restaurant,
      session_id: IDs.sessions.naperville_week2,
      inventory_list_id: IDs.inventory_list,
      location_id: IDs.locations.naperville,
      po_number: 'PO-2026-001',
      vendor_name: 'Sysco Chicago',
      status: 'submitted',
      created_by: IDs.users.manager,
      created_at: daysAgo(1),
      submitted_at: daysAgo(1),
    });

    const smartOrderItems = [
      { item: 'Chicken Breast', suggested: 9, risk: 'RED' },
      { item: 'Sliced Turkey', suggested: 6, risk: 'RED' },
      { item: 'Pastrami', suggested: 5, risk: 'RED' },
      { item: 'Cheddar Cheese', suggested: 7, risk: 'YELLOW' },
      { item: 'Lettuce', suggested: 10, risk: 'YELLOW' },
      { item: 'Sourdough Bread', suggested: 13, risk: 'YELLOW' },
      { item: 'Coca-Cola Syrup', suggested: 4, risk: 'YELLOW' },
      { item: 'Sprite Syrup', suggested: 3, risk: 'YELLOW' },
    ];

    for (const orderItem of smartOrderItems) {
      const catalogItem = catalogRows.find(c => c.item_name === orderItem.item);
      await supabase.from('smart_order_run_items').insert({
        run_id: IDs.smart_order_run,
        catalog_item_id: catalogItem.id,
        item_name: orderItem.item,
        suggested_order: orderItem.suggested,
        risk: orderItem.risk,
        current_stock: 0, // Will be computed
        par_level: CATALOG.find(c => c.name === orderItem.item).par,
        unit_cost: catalogItem.unit_cost,
      });
    }

    await supabase.from('purchase_orders').upsert({
      id: IDs.purchase_order,
      restaurant_id: IDs.restaurant,
      location_id: IDs.locations.naperville,
      po_number: 'PO-2026-001',
      vendor_name: 'Sysco Chicago',
      status: 'submitted',
      smart_order_run_id: IDs.smart_order_run,
      created_from_session_id: IDs.sessions.naperville_week2,
      inventory_list_id: IDs.inventory_list,
      created_by: IDs.users.manager,
      created_at: daysAgo(1),
      submitted_at: daysAgo(1),
    });

    log('✅', 'Smart order + PO created\n');

    // ── 9. Invoices ─────────────────────────────────────────────────────────
    log('🧾', 'Creating invoices (Sysco confirmed, US Foods with issues)');

    // Invoice 1: Sysco confirmed
    await supabase.from('invoices').upsert({
      id: IDs.invoices.sysco_confirmed,
      restaurant_id: IDs.restaurant,
      location_id: IDs.locations.naperville,
      purchase_order_id: IDs.purchase_order,
      vendor_name: 'Sysco Chicago',
      invoice_number: 'SYS-847392',
      invoice_date: daysAgo(0),
      invoice_subtotal: 1087.50,
      invoice_tax: 97.88,
      invoice_total: 1185.38,
      status: 'confirmed',
      receipt_status: 'confirmed',
      confirmed_at: nowISO(),
      created_by: IDs.users.manager,
      created_at: daysAgo(0),
    });

    // Add invoice items for Sysco
    const syscoItems = smartOrderItems.map(item => {
      const catalogItem = catalogRows.find(c => c.item_name === item.item);
      return {
        invoice_id: IDs.invoices.sysco_confirmed,
        catalog_item_id: catalogItem.id,
        item_name: item.item,
        quantity: item.suggested,
        unit_cost: catalogItem.unit_cost,
        total_cost: item.suggested * catalogItem.unit_cost,
        match_status: 'MATCHED',
      };
    });

    await supabase.from('invoice_items').upsert(syscoItems);

    // Invoice 2: US Foods with issues (Aurora)
    await supabase.from('invoices').upsert({
      id: IDs.invoices.usfoods_issues,
      restaurant_id: IDs.restaurant,
      location_id: IDs.locations.aurora,
      vendor_name: 'US Foods',
      invoice_number: 'USF-592847',
      invoice_date: daysAgo(1),
      invoice_subtotal: 842.00,
      invoice_tax: 75.78,
      invoice_total: 917.78,
      status: 'review',
      receipt_status: 'issues_reported',
      created_by: IDs.users.manager,
      created_at: daysAgo(1),
    });

    const usfoodsItemsCatalog = [
      { item: 'Chicken Breast', qty: 10, cost: 96.00 }, // PRICE INCREASE
      { item: 'Swiss Cheese', qty: 8, cost: 48.00 },
      { item: 'Lettuce', qty: 15, cost: 24.00 },
      // Tomatoes MISSING from invoice
    ];

    for (const item of usfoodsItemsCatalog) {
      const catalogItem = catalogRows.find(c => c.item_name === item.item);
      await supabase.from('invoice_items').insert({
        invoice_id: IDs.invoices.usfoods_issues,
        catalog_item_id: catalogItem.id,
        item_name: item.item,
        quantity: item.qty,
        unit_cost: item.cost,
        total_cost: item.qty * item.cost,
        match_status: 'MATCHED',
      });
    }

    // Add delivery issue for missing tomatoes
    await supabase.from('delivery_issues').insert({
      invoice_id: IDs.invoices.usfoods_issues,
      catalog_item_id: catalogRows.find(c => c.item_name === 'Tomatoes').id,
      item_name: 'Tomatoes',
      issue_type: 'missing',
      notes: 'Expected 12 cases, received 0',
    });

    log('✅', 'Invoices created\n');

    // ── 10. Notifications ───────────────────────────────────────────────────
    log('🔔', 'Creating notifications');

    await supabase.from('notifications').upsert([
      {
        restaurant_id: IDs.restaurant,
        location_id: IDs.locations.naperville,
        user_id: IDs.users.owner,
        type: 'LOW_STOCK',
        title: '3 critical items at Naperville',
        message: 'Chicken Breast, Sliced Turkey, Pastrami are critically low — order today',
        severity: 'CRITICAL',
        created_at: daysAgo(2),
      },
      {
        restaurant_id: IDs.restaurant,
        location_id: IDs.locations.naperville,
        user_id: IDs.users.manager,
        type: 'LOW_STOCK',
        title: '3 critical items at Naperville',
        message: 'Chicken Breast, Sliced Turkey, Pastrami are critically low — order today',
        severity: 'CRITICAL',
        created_at: daysAgo(2),
      },
      {
        restaurant_id: IDs.restaurant,
        location_id: IDs.locations.aurora,
        user_id: IDs.users.owner,
        type: 'DELIVERY_ISSUE',
        title: 'Delivery Issues Detected',
        message: '1 missing item on USF-592847. Review the invoice to resolve.',
        severity: 'CRITICAL',
        data: { invoice_id: IDs.invoices.usfoods_issues },
        created_at: daysAgo(1),
      },
      {
        restaurant_id: IDs.restaurant,
        location_id: IDs.locations.aurora,
        user_id: IDs.users.owner,
        type: 'PRICE_INCREASE',
        title: '1 item price increase on latest invoice',
        message: 'Chicken Breast: $89.00 to $96.00 (+7.9%)',
        severity: 'WARNING',
        data: { invoice_id: IDs.invoices.usfoods_issues },
        created_at: daysAgo(1),
      },
      {
        restaurant_id: IDs.restaurant,
        location_id: IDs.locations.bolingbrook,
        user_id: IDs.users.manager,
        type: 'REMINDER',
        title: 'Friday EOD Inventory Due',
        message: 'Weekly inventory count for Bolingbrook is overdue',
        severity: 'INFO',
        created_at: daysAgo(3),
      },
    ]);

    log('✅', 'Notifications created\n');

    // ── 11. Waste log entries ───────────────────────────────────────────────
    log('🗑️', 'Creating waste log entries');

    await supabase.from('waste_log').upsert([
      {
        restaurant_id: IDs.restaurant,
        location_id: IDs.locations.naperville,
        catalog_item_id: catalogRows.find(c => c.item_name === 'Lettuce').id,
        item_name: 'Lettuce',
        quantity: 2,
        reason: 'spoiled',
        notes: 'Wilted overnight',
        logged_by: IDs.users.staff,
        logged_at: daysAgo(1),
      },
      {
        restaurant_id: IDs.restaurant,
        location_id: IDs.locations.aurora,
        catalog_item_id: catalogRows.find(c => c.item_name === 'Tomatoes').id,
        item_name: 'Tomatoes',
        quantity: 1,
        reason: 'damaged',
        notes: 'Crushed in delivery',
        logged_by: IDs.users.staff,
        logged_at: daysAgo(2),
      },
    ]);

    log('✅', 'Waste log entries created\n');

    log('🎉', 'Seed complete!\n');
    log('📊', 'Summary:');
    log('  ', `Restaurant: Midwest Franchise Group`);
    log('  ', `Locations: 3 (Naperville, Aurora, Bolingbrook)`);
    log('  ', `Users: 3 (Owner, Manager, Staff)`);
    log('  ', `Catalog items: ${CATALOG.length}`);
    log('  ', `Inventory sessions: 4 (2 approved, 1 approved, 1 in-review)`);
    log('  ', `Smart orders: 1 submitted PO`);
    log('  ', `Invoices: 2 (1 confirmed, 1 with issues)`);
    log('  ', `Notifications: 5`);
    log('  ', `Waste entries: 2\n`);

    log('🔑', 'Test credentials:');
    log('  ', `Owner:   owner@midwestfg.com`);
    log('  ', `Manager: manager@midwestfg.com`);
    log('  ', `Staff:   staff@midwestfg.com\n`);

    log('🌐', 'Next steps:');
    log('  ', `1. Push the 2 pending migrations: supabase db push`);
    log('  ', `2. Open http://localhost:8080 and view the dashboard`);
    log('  ', `3. Check Naperville dashboard for LOW STOCK alerts`);
    log('  ', `4. Review Aurora invoice with delivery issues`);
    log('  ', `5. Approve the Bolingbrook inventory session\n`);

  } catch (error) {
    console.error('\n❌ Seed failed:', error.message);
    console.error(error);
    process.exit(1);
  }
}

// ─── Helper: Create Inventory Session ──────────────────────────────────────
async function createInventorySession({ 
  id, 
  location_id, 
  name, 
  status, 
  created_at, 
  approved_at, 
  approved_by, 
  stockLevels 
}) {
  await supabase.from('inventory_sessions').upsert({
    id,
    restaurant_id: IDs.restaurant,
    location_id,
    inventory_list_id: IDs.inventory_list,
    name,
    status,
    created_by: IDs.users.manager,
    created_at,
    updated_at: approved_at || created_at,
    approved_at,
    approved_by,
  });

  // Create session items
  const sessionItems = [];
  for (const item of CATALOG) {
    const catalogId = `cccccccc-0000-0000-0000-0000000000${String(CATALOG.indexOf(item) + 1).padStart(2, '0')}`;
    sessionItems.push({
      session_id: id,
      catalog_item_id: catalogId,
      item_name: item.name,
      category: item.category,
      unit: item.unit,
      current_stock: stockLevels[item.name] ?? item.par,
      par_level: item.par,
      unit_cost: item.unit_cost,
    });
  }

  await supabase.from('inventory_session_items').upsert(sessionItems);
}

// ─── Run ────────────────────────────────────────────────────────────────────
seed();
