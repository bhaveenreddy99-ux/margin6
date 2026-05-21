-- ═══════════════════════════════════════════════════════════════════════════
-- Public demo seed
--
-- Creates a single permanent restaurant viewable by anonymous visitors at
-- /demo-live. Idempotent: safe to re-run; data seeded only on first apply.
--
-- After running:
--   • Service user 'demo@restaurantiq.internal' exists (never logs in).
--   • Restaurant "Demo Kitchen" exists with full seeded data.
--   • anon role has SELECT-only access scoped to the demo restaurant.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. Service user ────────────────────────────────────────────────────────
INSERT INTO auth.users (
  instance_id, id, aud, role, email,
  encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at,
  confirmation_token, recovery_token, email_change_token_new, email_change
) VALUES (
  '00000000-0000-0000-0000-000000000000',
  'a0000000-0000-0000-0000-000000000001',
  'authenticated', 'authenticated',
  'demo@restaurantiq.internal',
  '$2a$10$DISABLED.DISABLED.DISABLED.DISABLED.DISABLED.DISABLED.DI',
  now(),
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{"display_name":"RestaurantIQ Public Demo"}'::jsonb,
  now(), now(), '', '', '', ''
) ON CONFLICT (id) DO NOTHING;

-- ── 2. Restaurant + owner membership ───────────────────────────────────────
INSERT INTO public.restaurants (id, name)
VALUES ('b0000000-0000-0000-0000-000000000001', 'Demo Kitchen')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.restaurant_members (restaurant_id, user_id, role)
VALUES (
  'b0000000-0000-0000-0000-000000000001',
  'a0000000-0000-0000-0000-000000000001',
  'OWNER'
) ON CONFLICT DO NOTHING;

-- ── 3. Seed all demo data (idempotent: skip if invoices already present) ──
DO $$
DECLARE
  v_user_id       uuid := 'a0000000-0000-0000-0000-000000000001';
  v_restaurant_id uuid := 'b0000000-0000-0000-0000-000000000001';
  v_location_id   uuid;
  v_inv_main      uuid;
  v_inv_bar       uuid;
  v_par_main_wk   uuid;
  v_par_main_we   uuid;
  v_par_bar_wk    uuid;
  v_par_bar_we    uuid;
  v_session_main  uuid;
  v_session_bar   uuid;
  v_smart_main    uuid;
  v_smart_bar     uuid;
  v_purchase_main uuid;
  v_purchase_bar  uuid;
  v_invoice_sysco uuid;
  v_invoice_pfg   uuid;
  v_week_start    date;
  v_last_week     date;
BEGIN
  IF EXISTS (SELECT 1 FROM public.invoices WHERE restaurant_id = v_restaurant_id) THEN
    RAISE NOTICE 'Public demo already seeded; skipping data inserts.';
    RETURN;
  END IF;

  -- Location
  INSERT INTO public.locations (restaurant_id, name, is_active)
  VALUES (v_restaurant_id, 'Demo Kitchen', true)
  RETURNING id INTO v_location_id;

  -- Inventory lists
  INSERT INTO public.inventory_lists (restaurant_id, name, created_by)
  VALUES (v_restaurant_id, 'Main Kitchen', v_user_id) RETURNING id INTO v_inv_main;
  INSERT INTO public.inventory_lists (restaurant_id, name, created_by)
  VALUES (v_restaurant_id, 'Bar', v_user_id) RETURNING id INTO v_inv_bar;

  -- Catalog items: Main Kitchen
  INSERT INTO public.inventory_catalog_items (restaurant_id, inventory_list_id, item_name, category, unit, default_par_level, default_unit_cost) VALUES
    (v_restaurant_id, v_inv_main, 'Chicken Breast', 'Cooler', 'lbs', 50, 4.50),
    (v_restaurant_id, v_inv_main, 'Ground Beef', 'Cooler', 'lbs', 40, 5.00),
    (v_restaurant_id, v_inv_main, 'French Fries', 'Frozen', 'bags', 30, 3.00),
    (v_restaurant_id, v_inv_main, 'Burger Buns', 'Dry', 'packs', 25, 2.00),
    (v_restaurant_id, v_inv_main, 'Lettuce', 'Cooler', 'heads', 20, 1.50),
    (v_restaurant_id, v_inv_main, 'Tomatoes', 'Cooler', 'lbs', 15, 2.00),
    (v_restaurant_id, v_inv_main, 'Cooking Oil', 'Dry', 'gallons', 10, 8.00),
    (v_restaurant_id, v_inv_main, 'Ice Cream', 'Frozen', 'tubs', 12, 6.00);

  -- Catalog items: Bar
  INSERT INTO public.inventory_catalog_items (restaurant_id, inventory_list_id, item_name, category, unit, default_par_level, default_unit_cost) VALUES
    (v_restaurant_id, v_inv_bar, 'Vodka', 'Dry', 'bottles', 10, 18.00),
    (v_restaurant_id, v_inv_bar, 'Rum', 'Dry', 'bottles', 8, 15.00),
    (v_restaurant_id, v_inv_bar, 'Orange Juice', 'Cooler', 'gallons', 6, 4.00),
    (v_restaurant_id, v_inv_bar, 'Lime', 'Cooler', 'bags', 5, 3.00),
    (v_restaurant_id, v_inv_bar, 'Ice', 'Frozen', 'bags', 20, 2.50);

  -- PAR guides
  INSERT INTO public.par_guides (restaurant_id, inventory_list_id, name, created_by)
  VALUES (v_restaurant_id, v_inv_main, 'Weekday PAR', v_user_id) RETURNING id INTO v_par_main_wk;

  INSERT INTO public.par_guide_items (par_guide_id, item_name, category, unit, par_level) VALUES
    (v_par_main_wk, 'Chicken Breast', 'Cooler', 'lbs', 50),
    (v_par_main_wk, 'Ground Beef', 'Cooler', 'lbs', 40),
    (v_par_main_wk, 'French Fries', 'Frozen', 'bags', 30),
    (v_par_main_wk, 'Burger Buns', 'Dry', 'packs', 25),
    (v_par_main_wk, 'Lettuce', 'Cooler', 'heads', 20),
    (v_par_main_wk, 'Tomatoes', 'Cooler', 'lbs', 15),
    (v_par_main_wk, 'Cooking Oil', 'Dry', 'gallons', 10),
    (v_par_main_wk, 'Ice Cream', 'Frozen', 'tubs', 12);

  INSERT INTO public.par_guides (restaurant_id, inventory_list_id, name, created_by)
  VALUES (v_restaurant_id, v_inv_main, 'Weekend PAR', v_user_id) RETURNING id INTO v_par_main_we;

  INSERT INTO public.par_guide_items (par_guide_id, item_name, category, unit, par_level) VALUES
    (v_par_main_we, 'Chicken Breast', 'Cooler', 'lbs', 70),
    (v_par_main_we, 'Ground Beef', 'Cooler', 'lbs', 55),
    (v_par_main_we, 'French Fries', 'Frozen', 'bags', 45),
    (v_par_main_we, 'Burger Buns', 'Dry', 'packs', 35),
    (v_par_main_we, 'Lettuce', 'Cooler', 'heads', 30),
    (v_par_main_we, 'Tomatoes', 'Cooler', 'lbs', 20),
    (v_par_main_we, 'Cooking Oil', 'Dry', 'gallons', 15),
    (v_par_main_we, 'Ice Cream', 'Frozen', 'tubs', 18);

  INSERT INTO public.par_guides (restaurant_id, inventory_list_id, name, created_by)
  VALUES (v_restaurant_id, v_inv_bar, 'Bar Weekday', v_user_id) RETURNING id INTO v_par_bar_wk;

  INSERT INTO public.par_guide_items (par_guide_id, item_name, category, unit, par_level) VALUES
    (v_par_bar_wk, 'Vodka', 'Dry', 'bottles', 10),
    (v_par_bar_wk, 'Rum', 'Dry', 'bottles', 8),
    (v_par_bar_wk, 'Orange Juice', 'Cooler', 'gallons', 6),
    (v_par_bar_wk, 'Lime', 'Cooler', 'bags', 5),
    (v_par_bar_wk, 'Ice', 'Frozen', 'bags', 20);

  INSERT INTO public.par_guides (restaurant_id, inventory_list_id, name, created_by)
  VALUES (v_restaurant_id, v_inv_bar, 'Bar Weekend', v_user_id) RETURNING id INTO v_par_bar_we;

  INSERT INTO public.par_guide_items (par_guide_id, item_name, category, unit, par_level) VALUES
    (v_par_bar_we, 'Vodka', 'Dry', 'bottles', 15),
    (v_par_bar_we, 'Rum', 'Dry', 'bottles', 12),
    (v_par_bar_we, 'Orange Juice', 'Cooler', 'gallons', 10),
    (v_par_bar_we, 'Lime', 'Cooler', 'bags', 8),
    (v_par_bar_we, 'Ice', 'Frozen', 'bags', 30);

  -- Inventory sessions: 2-weeks-ago + today
  INSERT INTO public.inventory_sessions (restaurant_id, location_id, inventory_list_id, name, status, created_by, approved_by, approved_at)
  VALUES (v_restaurant_id, v_location_id, v_inv_main, 'Two Weeks Ago Count', 'APPROVED', v_user_id, v_user_id, now() - interval '14 days');

  INSERT INTO public.inventory_sessions (restaurant_id, location_id, inventory_list_id, name, status, created_by, approved_by, approved_at)
  VALUES (v_restaurant_id, v_location_id, v_inv_main, 'Opening Count', 'APPROVED', v_user_id, v_user_id, now())
  RETURNING id INTO v_session_main;

  INSERT INTO public.inventory_session_items (session_id, item_name, category, unit, current_stock, par_level, unit_cost) VALUES
    (v_session_main, 'Chicken Breast', 'Cooler', 'lbs', 20, 50, 4.50),
    (v_session_main, 'Ground Beef', 'Cooler', 'lbs', 35, 40, 5.00),
    (v_session_main, 'French Fries', 'Frozen', 'bags', 10, 30, 3.00),
    (v_session_main, 'Burger Buns', 'Dry', 'packs', 22, 25, 2.00),
    (v_session_main, 'Lettuce', 'Cooler', 'heads', 8, 20, 1.50),
    (v_session_main, 'Tomatoes', 'Cooler', 'lbs', 12, 15, 2.00),
    (v_session_main, 'Cooking Oil', 'Dry', 'gallons', 3, 10, 8.00),
    (v_session_main, 'Ice Cream', 'Frozen', 'tubs', 5, 12, 6.00);

  INSERT INTO public.inventory_sessions (restaurant_id, location_id, inventory_list_id, name, status, created_by, approved_by, approved_at)
  VALUES (v_restaurant_id, v_location_id, v_inv_bar, 'Bar Opening', 'APPROVED', v_user_id, v_user_id, now())
  RETURNING id INTO v_session_bar;

  INSERT INTO public.inventory_session_items (session_id, item_name, category, unit, current_stock, par_level, unit_cost) VALUES
    (v_session_bar, 'Vodka', 'Dry', 'bottles', 4, 10, 18.00),
    (v_session_bar, 'Rum', 'Dry', 'bottles', 6, 8, 15.00),
    (v_session_bar, 'Orange Juice', 'Cooler', 'gallons', 2, 6, 4.00),
    (v_session_bar, 'Lime', 'Cooler', 'bags', 3, 5, 3.00),
    (v_session_bar, 'Ice', 'Frozen', 'bags', 8, 20, 2.50);

  -- Smart orders
  INSERT INTO public.smart_order_runs (restaurant_id, location_id, session_id, inventory_list_id, par_guide_id, created_by)
  VALUES (v_restaurant_id, v_location_id, v_session_main, v_inv_main, v_par_main_wk, v_user_id)
  RETURNING id INTO v_smart_main;

  INSERT INTO public.smart_order_run_items (run_id, item_name, suggested_order, risk, current_stock, par_level, unit_cost) VALUES
    (v_smart_main, 'Chicken Breast', 30, 'RED', 20, 50, 4.50),
    (v_smart_main, 'Ground Beef', 5, 'YELLOW', 35, 40, 5.00),
    (v_smart_main, 'French Fries', 20, 'RED', 10, 30, 3.00),
    (v_smart_main, 'Burger Buns', 3, 'YELLOW', 22, 25, 2.00),
    (v_smart_main, 'Lettuce', 12, 'RED', 8, 20, 1.50),
    (v_smart_main, 'Tomatoes', 3, 'YELLOW', 12, 15, 2.00),
    (v_smart_main, 'Cooking Oil', 7, 'RED', 3, 10, 8.00),
    (v_smart_main, 'Ice Cream', 7, 'RED', 5, 12, 6.00);

  INSERT INTO public.smart_order_runs (restaurant_id, location_id, session_id, inventory_list_id, par_guide_id, created_by)
  VALUES (v_restaurant_id, v_location_id, v_session_bar, v_inv_bar, v_par_bar_wk, v_user_id)
  RETURNING id INTO v_smart_bar;

  INSERT INTO public.smart_order_run_items (run_id, item_name, suggested_order, risk, current_stock, par_level, unit_cost) VALUES
    (v_smart_bar, 'Vodka', 6, 'RED', 4, 10, 18.00),
    (v_smart_bar, 'Rum', 2, 'YELLOW', 6, 8, 15.00),
    (v_smart_bar, 'Orange Juice', 4, 'RED', 2, 6, 4.00),
    (v_smart_bar, 'Lime', 2, 'YELLOW', 3, 5, 3.00),
    (v_smart_bar, 'Ice', 12, 'RED', 8, 20, 2.50);

  -- Purchase history
  INSERT INTO public.purchase_history (restaurant_id, location_id, inventory_list_id, smart_order_run_id, created_by)
  VALUES (v_restaurant_id, v_location_id, v_inv_main, v_smart_main, v_user_id) RETURNING id INTO v_purchase_main;

  INSERT INTO public.purchase_history_items (purchase_history_id, item_name, quantity, unit_cost, total_cost) VALUES
    (v_purchase_main, 'Chicken Breast', 30, 4.50, 135.00),
    (v_purchase_main, 'Ground Beef', 5, 5.00, 25.00),
    (v_purchase_main, 'French Fries', 20, 3.00, 60.00),
    (v_purchase_main, 'Burger Buns', 3, 2.00, 6.00),
    (v_purchase_main, 'Lettuce', 12, 1.50, 18.00),
    (v_purchase_main, 'Tomatoes', 3, 2.00, 6.00),
    (v_purchase_main, 'Cooking Oil', 7, 8.00, 56.00),
    (v_purchase_main, 'Ice Cream', 7, 6.00, 42.00);

  INSERT INTO public.purchase_history (restaurant_id, location_id, inventory_list_id, smart_order_run_id, created_by)
  VALUES (v_restaurant_id, v_location_id, v_inv_bar, v_smart_bar, v_user_id) RETURNING id INTO v_purchase_bar;

  INSERT INTO public.purchase_history_items (purchase_history_id, item_name, quantity, unit_cost, total_cost) VALUES
    (v_purchase_bar, 'Vodka', 6, 18.00, 108.00),
    (v_purchase_bar, 'Rum', 2, 15.00, 30.00),
    (v_purchase_bar, 'Orange Juice', 4, 4.00, 16.00),
    (v_purchase_bar, 'Lime', 2, 3.00, 6.00),
    (v_purchase_bar, 'Ice', 12, 2.50, 30.00);

  -- Confirmed invoices (within last few days so they appear in "this_week" + "30_days")
  INSERT INTO public.invoices (
    restaurant_id, vendor_name, invoice_number, invoice_date,
    status, receipt_status, invoice_subtotal, invoice_tax, invoice_total,
    location_id, created_by
  ) VALUES (
    v_restaurant_id, 'Sysco', 'SYS-8841', current_date - interval '1 day',
    'confirmed', 'confirmed', 795.00, 52.50, 847.50,
    v_location_id, v_user_id
  ) RETURNING id INTO v_invoice_sysco;

  INSERT INTO public.invoices (
    restaurant_id, vendor_name, invoice_number, invoice_date,
    status, receipt_status, invoice_subtotal, invoice_tax, invoice_total,
    location_id, created_by
  ) VALUES (
    v_restaurant_id, 'Performance Food Group', 'PFG-441982', current_date - interval '2 days',
    'confirmed', 'confirmed', 388.00, 24.00, 412.00,
    v_location_id, v_user_id
  ) RETURNING id INTO v_invoice_pfg;

  INSERT INTO public.invoice_items (invoice_id, item_name, quantity_invoiced, unit_cost, total_cost) VALUES
    (v_invoice_sysco, 'Chicken Breast', 30, 5.20, 156.00),
    (v_invoice_sysco, 'Ground Beef',    20, 5.00, 100.00),
    (v_invoice_sysco, 'Tomatoes',       20, 2.55,  51.00),
    (v_invoice_sysco, 'Cooking Oil',     8, 9.40,  75.20),
    (v_invoice_sysco, 'French Fries',   25, 3.00,  75.00);

  INSERT INTO public.invoice_items (invoice_id, item_name, quantity_invoiced, unit_cost, total_cost) VALUES
    (v_invoice_pfg, 'Chicken Breast', 20, 4.50, 90.00),
    (v_invoice_pfg, 'Ground Beef',    15, 5.00, 75.00),
    (v_invoice_pfg, 'Tomatoes',       18, 2.00, 36.00);

  -- Price-hike line comparisons for Sysco
  INSERT INTO public.invoice_line_comparisons (
    invoice_id, item_name, po_qty, po_unit_cost,
    invoiced_qty, invoiced_unit_cost, received_qty, status
  ) VALUES
    (v_invoice_sysco, 'Chicken Breast', 30, 4.50, 30, 5.20, 30, 'price_mismatch'),
    (v_invoice_sysco, 'Cooking Oil',     8, 8.00,  8, 9.40,  8, 'price_mismatch'),
    (v_invoice_sysco, 'Tomatoes',       20, 2.00, 20, 2.55, 20, 'price_mismatch');

  -- Waste log
  INSERT INTO public.waste_log (
    restaurant_id, location_id, item_name, quantity, reason,
    unit_cost, total_cost, logged_by, logged_at
  ) VALUES
    (v_restaurant_id, v_location_id, 'Tomatoes',       3, 'spoiled',        2.00, 6.00, v_user_id, now() - interval '1 day'),
    (v_restaurant_id, v_location_id, 'Chicken Breast', 2, 'prep_waste',     4.50, 9.00, v_user_id, now() - interval '1 day'),
    (v_restaurant_id, v_location_id, 'Ice Cream',      1, 'over_portioned', 6.00, 6.00, v_user_id, now() - interval '2 days'),
    (v_restaurant_id, v_location_id, 'Lettuce',        2, 'spoiled',        1.50, 3.00, v_user_id, now() - interval '2 days'),
    (v_restaurant_id, v_location_id, 'Cooking Oil',    1, 'other',          8.00, 8.00, v_user_id, now() - interval '3 days');

  -- Weekly sales (this week + last week)
  v_week_start := date_trunc('week', current_date)::date;
  v_last_week  := v_week_start - interval '7 days';

  INSERT INTO public.weekly_sales (
    restaurant_id, location_id, week_start, gross_sales, entry_method, entered_by_user_id
  ) VALUES
    (v_restaurant_id, v_location_id, v_week_start, 12400.00, 'manual_weekly', v_user_id),
    (v_restaurant_id, v_location_id, v_last_week,  11850.00, 'manual_weekly', v_user_id);

  -- Shrink alert notification
  INSERT INTO public.notifications (
    restaurant_id, location_id, user_id, type, title, message, severity, data
  ) VALUES (
    v_restaurant_id, v_location_id, v_user_id,
    'SHRINK_ALERT',
    '2 items with abnormal usage',
    'Chicken Breast and Tomatoes flagged',
    'WARNING',
    jsonb_build_object(
      'items', jsonb_build_array(
        jsonb_build_object('item_name', 'Chicken Breast', 'dollar_impact', 76.50, 'type', 'HIGH_USAGE'),
        jsonb_build_object('item_name', 'Tomatoes',       'dollar_impact',  8.00, 'type', 'COUNT_VARIANCE')
      )
    )
  );

  RAISE NOTICE 'Public demo seeded for restaurant %', v_restaurant_id;
END $$;

-- ── 4. RLS: anon SELECT policies scoped to the demo restaurant ────────────

GRANT USAGE ON SCHEMA public TO anon;

DROP POLICY IF EXISTS "Public demo read restaurants"               ON public.restaurants;
DROP POLICY IF EXISTS "Public demo read locations"                 ON public.locations;
DROP POLICY IF EXISTS "Public demo read inventory_lists"           ON public.inventory_lists;
DROP POLICY IF EXISTS "Public demo read inventory_catalog_items"   ON public.inventory_catalog_items;
DROP POLICY IF EXISTS "Public demo read inventory_sessions"        ON public.inventory_sessions;
DROP POLICY IF EXISTS "Public demo read inventory_session_items"   ON public.inventory_session_items;
DROP POLICY IF EXISTS "Public demo read smart_order_runs"          ON public.smart_order_runs;
DROP POLICY IF EXISTS "Public demo read smart_order_run_items"     ON public.smart_order_run_items;
DROP POLICY IF EXISTS "Public demo read invoices"                  ON public.invoices;
DROP POLICY IF EXISTS "Public demo read invoice_items"             ON public.invoice_items;
DROP POLICY IF EXISTS "Public demo read invoice_line_comparisons"  ON public.invoice_line_comparisons;
DROP POLICY IF EXISTS "Public demo read waste_log"                 ON public.waste_log;
DROP POLICY IF EXISTS "Public demo read weekly_sales"              ON public.weekly_sales;
DROP POLICY IF EXISTS "Public demo read notifications"             ON public.notifications;
DROP POLICY IF EXISTS "Public demo read purchase_history"          ON public.purchase_history;
DROP POLICY IF EXISTS "Public demo read purchase_history_items"    ON public.purchase_history_items;

CREATE POLICY "Public demo read restaurants" ON public.restaurants
  FOR SELECT TO anon
  USING (id = 'b0000000-0000-0000-0000-000000000001'::uuid);

CREATE POLICY "Public demo read locations" ON public.locations
  FOR SELECT TO anon
  USING (restaurant_id = 'b0000000-0000-0000-0000-000000000001'::uuid);

CREATE POLICY "Public demo read inventory_lists" ON public.inventory_lists
  FOR SELECT TO anon
  USING (restaurant_id = 'b0000000-0000-0000-0000-000000000001'::uuid);

CREATE POLICY "Public demo read inventory_catalog_items" ON public.inventory_catalog_items
  FOR SELECT TO anon
  USING (restaurant_id = 'b0000000-0000-0000-0000-000000000001'::uuid);

CREATE POLICY "Public demo read inventory_sessions" ON public.inventory_sessions
  FOR SELECT TO anon
  USING (restaurant_id = 'b0000000-0000-0000-0000-000000000001'::uuid);

CREATE POLICY "Public demo read inventory_session_items" ON public.inventory_session_items
  FOR SELECT TO anon
  USING (EXISTS (
    SELECT 1 FROM public.inventory_sessions s
    WHERE s.id = inventory_session_items.session_id
      AND s.restaurant_id = 'b0000000-0000-0000-0000-000000000001'::uuid
  ));

CREATE POLICY "Public demo read smart_order_runs" ON public.smart_order_runs
  FOR SELECT TO anon
  USING (restaurant_id = 'b0000000-0000-0000-0000-000000000001'::uuid);

CREATE POLICY "Public demo read smart_order_run_items" ON public.smart_order_run_items
  FOR SELECT TO anon
  USING (EXISTS (
    SELECT 1 FROM public.smart_order_runs r
    WHERE r.id = smart_order_run_items.run_id
      AND r.restaurant_id = 'b0000000-0000-0000-0000-000000000001'::uuid
  ));

CREATE POLICY "Public demo read invoices" ON public.invoices
  FOR SELECT TO anon
  USING (restaurant_id = 'b0000000-0000-0000-0000-000000000001'::uuid);

CREATE POLICY "Public demo read invoice_items" ON public.invoice_items
  FOR SELECT TO anon
  USING (EXISTS (
    SELECT 1 FROM public.invoices i
    WHERE i.id = invoice_items.invoice_id
      AND i.restaurant_id = 'b0000000-0000-0000-0000-000000000001'::uuid
  ));

CREATE POLICY "Public demo read invoice_line_comparisons" ON public.invoice_line_comparisons
  FOR SELECT TO anon
  USING (EXISTS (
    SELECT 1 FROM public.invoices i
    WHERE i.id = invoice_line_comparisons.invoice_id
      AND i.restaurant_id = 'b0000000-0000-0000-0000-000000000001'::uuid
  ));

CREATE POLICY "Public demo read waste_log" ON public.waste_log
  FOR SELECT TO anon
  USING (restaurant_id = 'b0000000-0000-0000-0000-000000000001'::uuid);

CREATE POLICY "Public demo read weekly_sales" ON public.weekly_sales
  FOR SELECT TO anon
  USING (restaurant_id = 'b0000000-0000-0000-0000-000000000001'::uuid);

CREATE POLICY "Public demo read notifications" ON public.notifications
  FOR SELECT TO anon
  USING (restaurant_id = 'b0000000-0000-0000-0000-000000000001'::uuid);

CREATE POLICY "Public demo read purchase_history" ON public.purchase_history
  FOR SELECT TO anon
  USING (restaurant_id = 'b0000000-0000-0000-0000-000000000001'::uuid);

CREATE POLICY "Public demo read purchase_history_items" ON public.purchase_history_items
  FOR SELECT TO anon
  USING (EXISTS (
    SELECT 1 FROM public.purchase_history ph
    WHERE ph.id = purchase_history_items.purchase_history_id
      AND ph.restaurant_id = 'b0000000-0000-0000-0000-000000000001'::uuid
  ));

GRANT SELECT ON public.restaurants               TO anon;
GRANT SELECT ON public.locations                 TO anon;
GRANT SELECT ON public.inventory_lists           TO anon;
GRANT SELECT ON public.inventory_catalog_items   TO anon;
GRANT SELECT ON public.inventory_sessions        TO anon;
GRANT SELECT ON public.inventory_session_items   TO anon;
GRANT SELECT ON public.smart_order_runs          TO anon;
GRANT SELECT ON public.smart_order_run_items     TO anon;
GRANT SELECT ON public.invoices                  TO anon;
GRANT SELECT ON public.invoice_items             TO anon;
GRANT SELECT ON public.invoice_line_comparisons  TO anon;
GRANT SELECT ON public.waste_log                 TO anon;
GRANT SELECT ON public.weekly_sales              TO anon;
GRANT SELECT ON public.notifications             TO anon;
GRANT SELECT ON public.purchase_history          TO anon;
GRANT SELECT ON public.purchase_history_items    TO anon;

NOTIFY pgrst, 'reload schema';
