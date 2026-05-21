-- =============================================================================
-- Demo seed: money-intelligence rows
--
-- Extends create_restaurant_with_owner so a brand-new demo workspace shows
-- non-zero dollar amounts on the dashboard immediately:
--   • periodSpend          — driven by invoices + invoice_items
--   • priceIncreaseImpact  — driven by invoice_line_comparisons (status='price_mismatch')
--   • recordedWasteValue   — driven by waste_log (unit_cost, total_cost)
--   • weekly_sales         — seeded for 3 weeks (food-cost-% feature)
--   • SHRINK_ALERT         — 1 notification row so future shrinkage loader has data
--
-- Three deviations from the original task spec, justified by schema reality:
--   1. invoices.receipt_status='received' would violate the CHECK constraint
--      ('pending','reviewing','confirmed','issues_reported'). Using 'confirmed'.
--   2. invoice_items has no `unit` column locally. Omitted from inserts.
--   3. Default location is auto-created by the FRONTEND for the non-demo path
--      (CreateRestaurant.tsx) but NOT for the demo path (Demo.tsx never inserts
--      a location). The SELECT in the spec would return NULL for demo, breaking
--      the NOT NULL location_id constraint on weekly_sales. So this function
--      INSERTs the default location inside the p_is_demo block.
--
-- Everything outside the p_is_demo branch is byte-identical to the prior
-- definition in 20260212042953_purchase_history_par_columns_demo_seed.sql.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.create_restaurant_with_owner(p_name text, p_is_demo boolean DEFAULT false)
RETURNS restaurants
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  new_restaurant public.restaurants;
  v_user_id uuid := auth.uid();
  v_inv_list_id uuid;
  v_inv_list_id2 uuid;
  v_par_guide_id uuid;
  v_par_guide_id2 uuid;
  v_par_guide_id3 uuid;
  v_par_guide_id4 uuid;
  v_session_id uuid;
  v_session_id2 uuid;
  v_order_id uuid;
  v_smart_run_id uuid;
  v_smart_run_id2 uuid;
  v_purchase_id uuid;
  v_purchase_id2 uuid;
  v_location_id uuid;
  v_demo_inv1 uuid;
  v_demo_inv2 uuid;
  v_week_start date;
  v_last_week date;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  INSERT INTO public.restaurants (name) VALUES (p_name) RETURNING * INTO new_restaurant;
  INSERT INTO public.restaurant_members (restaurant_id, user_id, role) VALUES (new_restaurant.id, v_user_id, 'OWNER');

  IF p_is_demo THEN
    -- Inventory list 1: Main Kitchen
    INSERT INTO public.inventory_lists (restaurant_id, name, created_by)
    VALUES (new_restaurant.id, 'Main Kitchen', v_user_id)
    RETURNING id INTO v_inv_list_id;

    -- Inventory list 2: Bar
    INSERT INTO public.inventory_lists (restaurant_id, name, created_by)
    VALUES (new_restaurant.id, 'Bar', v_user_id)
    RETURNING id INTO v_inv_list_id2;

    -- Catalog items for Main Kitchen
    INSERT INTO public.inventory_catalog_items (restaurant_id, inventory_list_id, item_name, category, unit, default_par_level, default_unit_cost) VALUES
      (new_restaurant.id, v_inv_list_id, 'Chicken Breast', 'Cooler', 'lbs', 50, 4.50),
      (new_restaurant.id, v_inv_list_id, 'Ground Beef', 'Cooler', 'lbs', 40, 5.00),
      (new_restaurant.id, v_inv_list_id, 'French Fries', 'Frozen', 'bags', 30, 3.00),
      (new_restaurant.id, v_inv_list_id, 'Burger Buns', 'Dry', 'packs', 25, 2.00),
      (new_restaurant.id, v_inv_list_id, 'Lettuce', 'Cooler', 'heads', 20, 1.50),
      (new_restaurant.id, v_inv_list_id, 'Tomatoes', 'Cooler', 'lbs', 15, 2.00),
      (new_restaurant.id, v_inv_list_id, 'Cooking Oil', 'Dry', 'gallons', 10, 8.00),
      (new_restaurant.id, v_inv_list_id, 'Ice Cream', 'Frozen', 'tubs', 12, 6.00);

    -- Catalog items for Bar
    INSERT INTO public.inventory_catalog_items (restaurant_id, inventory_list_id, item_name, category, unit, default_par_level, default_unit_cost) VALUES
      (new_restaurant.id, v_inv_list_id2, 'Vodka', 'Dry', 'bottles', 10, 18.00),
      (new_restaurant.id, v_inv_list_id2, 'Rum', 'Dry', 'bottles', 8, 15.00),
      (new_restaurant.id, v_inv_list_id2, 'Orange Juice', 'Cooler', 'gallons', 6, 4.00),
      (new_restaurant.id, v_inv_list_id2, 'Lime', 'Cooler', 'bags', 5, 3.00),
      (new_restaurant.id, v_inv_list_id2, 'Ice', 'Frozen', 'bags', 20, 2.50);

    -- PAR guides for Main Kitchen (Weekday + Weekend)
    INSERT INTO public.par_guides (restaurant_id, inventory_list_id, name, created_by)
    VALUES (new_restaurant.id, v_inv_list_id, 'Weekday PAR', v_user_id)
    RETURNING id INTO v_par_guide_id;

    INSERT INTO public.par_guide_items (par_guide_id, item_name, category, unit, par_level) VALUES
      (v_par_guide_id, 'Chicken Breast', 'Cooler', 'lbs', 50),
      (v_par_guide_id, 'Ground Beef', 'Cooler', 'lbs', 40),
      (v_par_guide_id, 'French Fries', 'Frozen', 'bags', 30),
      (v_par_guide_id, 'Burger Buns', 'Dry', 'packs', 25),
      (v_par_guide_id, 'Lettuce', 'Cooler', 'heads', 20),
      (v_par_guide_id, 'Tomatoes', 'Cooler', 'lbs', 15),
      (v_par_guide_id, 'Cooking Oil', 'Dry', 'gallons', 10),
      (v_par_guide_id, 'Ice Cream', 'Frozen', 'tubs', 12);

    INSERT INTO public.par_guides (restaurant_id, inventory_list_id, name, created_by)
    VALUES (new_restaurant.id, v_inv_list_id, 'Weekend PAR', v_user_id)
    RETURNING id INTO v_par_guide_id2;

    INSERT INTO public.par_guide_items (par_guide_id, item_name, category, unit, par_level) VALUES
      (v_par_guide_id2, 'Chicken Breast', 'Cooler', 'lbs', 70),
      (v_par_guide_id2, 'Ground Beef', 'Cooler', 'lbs', 55),
      (v_par_guide_id2, 'French Fries', 'Frozen', 'bags', 45),
      (v_par_guide_id2, 'Burger Buns', 'Dry', 'packs', 35),
      (v_par_guide_id2, 'Lettuce', 'Cooler', 'heads', 30),
      (v_par_guide_id2, 'Tomatoes', 'Cooler', 'lbs', 20),
      (v_par_guide_id2, 'Cooking Oil', 'Dry', 'gallons', 15),
      (v_par_guide_id2, 'Ice Cream', 'Frozen', 'tubs', 18);

    -- PAR guides for Bar (Weekday + Weekend)
    INSERT INTO public.par_guides (restaurant_id, inventory_list_id, name, created_by)
    VALUES (new_restaurant.id, v_inv_list_id2, 'Bar Weekday', v_user_id)
    RETURNING id INTO v_par_guide_id3;

    INSERT INTO public.par_guide_items (par_guide_id, item_name, category, unit, par_level) VALUES
      (v_par_guide_id3, 'Vodka', 'Dry', 'bottles', 10),
      (v_par_guide_id3, 'Rum', 'Dry', 'bottles', 8),
      (v_par_guide_id3, 'Orange Juice', 'Cooler', 'gallons', 6),
      (v_par_guide_id3, 'Lime', 'Cooler', 'bags', 5),
      (v_par_guide_id3, 'Ice', 'Frozen', 'bags', 20);

    INSERT INTO public.par_guides (restaurant_id, inventory_list_id, name, created_by)
    VALUES (new_restaurant.id, v_inv_list_id2, 'Bar Weekend', v_user_id)
    RETURNING id INTO v_par_guide_id4;

    INSERT INTO public.par_guide_items (par_guide_id, item_name, category, unit, par_level) VALUES
      (v_par_guide_id4, 'Vodka', 'Dry', 'bottles', 15),
      (v_par_guide_id4, 'Rum', 'Dry', 'bottles', 12),
      (v_par_guide_id4, 'Orange Juice', 'Cooler', 'gallons', 10),
      (v_par_guide_id4, 'Lime', 'Cooler', 'bags', 8),
      (v_par_guide_id4, 'Ice', 'Frozen', 'bags', 30);

    -- Approved session for Main Kitchen
    INSERT INTO public.inventory_sessions (restaurant_id, inventory_list_id, name, status, created_by, approved_by, approved_at)
    VALUES (new_restaurant.id, v_inv_list_id, 'Opening Count', 'APPROVED', v_user_id, v_user_id, now())
    RETURNING id INTO v_session_id;

    INSERT INTO public.inventory_session_items (session_id, item_name, category, unit, current_stock, par_level, unit_cost) VALUES
      (v_session_id, 'Chicken Breast', 'Cooler', 'lbs', 20, 50, 4.50),
      (v_session_id, 'Ground Beef', 'Cooler', 'lbs', 35, 40, 5.00),
      (v_session_id, 'French Fries', 'Frozen', 'bags', 10, 30, 3.00),
      (v_session_id, 'Burger Buns', 'Dry', 'packs', 22, 25, 2.00),
      (v_session_id, 'Lettuce', 'Cooler', 'heads', 8, 20, 1.50),
      (v_session_id, 'Tomatoes', 'Cooler', 'lbs', 12, 15, 2.00),
      (v_session_id, 'Cooking Oil', 'Dry', 'gallons', 3, 10, 8.00),
      (v_session_id, 'Ice Cream', 'Frozen', 'tubs', 5, 12, 6.00);

    -- Approved session for Bar
    INSERT INTO public.inventory_sessions (restaurant_id, inventory_list_id, name, status, created_by, approved_by, approved_at)
    VALUES (new_restaurant.id, v_inv_list_id2, 'Bar Opening', 'APPROVED', v_user_id, v_user_id, now())
    RETURNING id INTO v_session_id2;

    INSERT INTO public.inventory_session_items (session_id, item_name, category, unit, current_stock, par_level, unit_cost) VALUES
      (v_session_id2, 'Vodka', 'Dry', 'bottles', 4, 10, 18.00),
      (v_session_id2, 'Rum', 'Dry', 'bottles', 6, 8, 15.00),
      (v_session_id2, 'Orange Juice', 'Cooler', 'gallons', 2, 6, 4.00),
      (v_session_id2, 'Lime', 'Cooler', 'bags', 3, 5, 3.00),
      (v_session_id2, 'Ice', 'Frozen', 'bags', 8, 20, 2.50);

    -- Smart order run for Main Kitchen
    INSERT INTO public.smart_order_runs (restaurant_id, session_id, inventory_list_id, par_guide_id, created_by)
    VALUES (new_restaurant.id, v_session_id, v_inv_list_id, v_par_guide_id, v_user_id)
    RETURNING id INTO v_smart_run_id;

    INSERT INTO public.smart_order_run_items (run_id, item_name, suggested_order, risk, current_stock, par_level, unit_cost) VALUES
      (v_smart_run_id, 'Chicken Breast', 30, 'RED', 20, 50, 4.50),
      (v_smart_run_id, 'Ground Beef', 5, 'YELLOW', 35, 40, 5.00),
      (v_smart_run_id, 'French Fries', 20, 'RED', 10, 30, 3.00),
      (v_smart_run_id, 'Burger Buns', 3, 'YELLOW', 22, 25, 2.00),
      (v_smart_run_id, 'Lettuce', 12, 'RED', 8, 20, 1.50),
      (v_smart_run_id, 'Tomatoes', 3, 'YELLOW', 12, 15, 2.00),
      (v_smart_run_id, 'Cooking Oil', 7, 'RED', 3, 10, 8.00),
      (v_smart_run_id, 'Ice Cream', 7, 'RED', 5, 12, 6.00);

    -- Purchase history from Main Kitchen smart order
    INSERT INTO public.purchase_history (restaurant_id, inventory_list_id, smart_order_run_id, created_by)
    VALUES (new_restaurant.id, v_inv_list_id, v_smart_run_id, v_user_id)
    RETURNING id INTO v_purchase_id;

    INSERT INTO public.purchase_history_items (purchase_history_id, item_name, quantity, unit_cost, total_cost) VALUES
      (v_purchase_id, 'Chicken Breast', 30, 4.50, 135.00),
      (v_purchase_id, 'Ground Beef', 5, 5.00, 25.00),
      (v_purchase_id, 'French Fries', 20, 3.00, 60.00),
      (v_purchase_id, 'Burger Buns', 3, 2.00, 6.00),
      (v_purchase_id, 'Lettuce', 12, 1.50, 18.00),
      (v_purchase_id, 'Tomatoes', 3, 2.00, 6.00),
      (v_purchase_id, 'Cooking Oil', 7, 8.00, 56.00),
      (v_purchase_id, 'Ice Cream', 7, 6.00, 42.00);

    -- Smart order run for Bar
    INSERT INTO public.smart_order_runs (restaurant_id, session_id, inventory_list_id, par_guide_id, created_by)
    VALUES (new_restaurant.id, v_session_id2, v_inv_list_id2, v_par_guide_id3, v_user_id)
    RETURNING id INTO v_smart_run_id2;

    INSERT INTO public.smart_order_run_items (run_id, item_name, suggested_order, risk, current_stock, par_level, unit_cost) VALUES
      (v_smart_run_id2, 'Vodka', 6, 'RED', 4, 10, 18.00),
      (v_smart_run_id2, 'Rum', 2, 'YELLOW', 6, 8, 15.00),
      (v_smart_run_id2, 'Orange Juice', 4, 'RED', 2, 6, 4.00),
      (v_smart_run_id2, 'Lime', 2, 'YELLOW', 3, 5, 3.00),
      (v_smart_run_id2, 'Ice', 12, 'RED', 8, 20, 2.50);

    -- Purchase history from Bar smart order
    INSERT INTO public.purchase_history (restaurant_id, inventory_list_id, smart_order_run_id, created_by)
    VALUES (new_restaurant.id, v_inv_list_id2, v_smart_run_id2, v_user_id)
    RETURNING id INTO v_purchase_id2;

    INSERT INTO public.purchase_history_items (purchase_history_id, item_name, quantity, unit_cost, total_cost) VALUES
      (v_purchase_id2, 'Vodka', 6, 18.00, 108.00),
      (v_purchase_id2, 'Rum', 2, 15.00, 30.00),
      (v_purchase_id2, 'Orange Juice', 4, 4.00, 16.00),
      (v_purchase_id2, 'Lime', 2, 3.00, 6.00),
      (v_purchase_id2, 'Ice', 12, 2.50, 30.00);

    -- Order
    INSERT INTO public.orders (restaurant_id, created_by, status)
    VALUES (new_restaurant.id, v_user_id, 'COMPLETED')
    RETURNING id INTO v_order_id;

    INSERT INTO public.order_items (order_id, item_name, quantity, unit) VALUES
      (v_order_id, 'Chicken Breast', 10, 'lbs'),
      (v_order_id, 'French Fries', 5, 'bags'),
      (v_order_id, 'Lettuce', 4, 'heads');

    -- Usage events
    INSERT INTO public.usage_events (restaurant_id, item_name, order_id, quantity_used) VALUES
      (new_restaurant.id, 'Chicken Breast', v_order_id, 10),
      (new_restaurant.id, 'French Fries', v_order_id, 5),
      (new_restaurant.id, 'Lettuce', v_order_id, 4);
    INSERT INTO public.usage_events (restaurant_id, item_name, quantity_used) VALUES
      (new_restaurant.id, 'Ground Beef', 8),
      (new_restaurant.id, 'Tomatoes', 3),
      (new_restaurant.id, 'Cooking Oil', 2);

    -- ─────────────────────────────────────────────────────────────────────────
    -- NEW: money-intelligence demo rows
    -- ─────────────────────────────────────────────────────────────────────────

    -- Default location (Demo.tsx does not auto-create one; weekly_sales needs it)
    INSERT INTO public.locations (restaurant_id, name, is_active)
    VALUES (new_restaurant.id, p_name, true)
    RETURNING id INTO v_location_id;

    -- Confirmed invoices
    INSERT INTO public.invoices (
      restaurant_id, vendor_name, invoice_number, invoice_date,
      status, receipt_status, invoice_subtotal, invoice_tax, invoice_total,
      location_id, created_by
    ) VALUES (
      new_restaurant.id, 'Sysco', 'SYS-8841', current_date - interval '1 day',
      'confirmed', 'confirmed', 795.00, 52.50, 847.50,
      v_location_id, v_user_id
    ) RETURNING id INTO v_demo_inv1;

    INSERT INTO public.invoices (
      restaurant_id, vendor_name, invoice_number, invoice_date,
      status, receipt_status, invoice_subtotal, invoice_tax, invoice_total,
      location_id, created_by
    ) VALUES (
      new_restaurant.id, 'Performance Food Group', 'PFG-441982', current_date - interval '2 days',
      'confirmed', 'confirmed', 388.00, 24.00, 412.00,
      v_location_id, v_user_id
    ) RETURNING id INTO v_demo_inv2;

    -- Invoice line items (no `unit` column on invoice_items; omitted)
    INSERT INTO public.invoice_items (invoice_id, item_name, quantity_invoiced, unit_cost, total_cost) VALUES
      (v_demo_inv1, 'Chicken Breast', 30, 5.20, 156.00),
      (v_demo_inv1, 'Ground Beef',    20, 5.00, 100.00),
      (v_demo_inv1, 'Tomatoes',       20, 2.55,  51.00),
      (v_demo_inv1, 'Cooking Oil',     8, 9.40,  75.20),
      (v_demo_inv1, 'French Fries',   25, 3.00,  75.00);

    INSERT INTO public.invoice_items (invoice_id, item_name, quantity_invoiced, unit_cost, total_cost) VALUES
      (v_demo_inv2, 'Chicken Breast', 20, 4.50, 90.00),
      (v_demo_inv2, 'Ground Beef',    15, 5.00, 75.00),
      (v_demo_inv2, 'Tomatoes',       18, 2.00, 36.00);

    -- Invoice line comparisons for Sysco price hikes (drives priceIncreaseImpact)
    INSERT INTO public.invoice_line_comparisons (
      invoice_id, item_name, po_qty, po_unit_cost,
      invoiced_qty, invoiced_unit_cost, received_qty, status
    ) VALUES
      (v_demo_inv1, 'Chicken Breast', 30, 4.50, 30, 5.20, 30, 'price_mismatch'),
      (v_demo_inv1, 'Cooking Oil',     8, 8.00,  8, 9.40,  8, 'price_mismatch'),
      (v_demo_inv1, 'Tomatoes',       20, 2.00, 20, 2.55, 20, 'price_mismatch');

    -- Waste log (drives recordedWasteValue)
    INSERT INTO public.waste_log (
      restaurant_id, location_id, item_name, quantity, reason,
      unit_cost, total_cost, logged_by, logged_at
    ) VALUES
      (new_restaurant.id, v_location_id, 'Tomatoes',       3, 'spoiled',        2.00, 6.00, v_user_id, now() - interval '1 day'),
      (new_restaurant.id, v_location_id, 'Chicken Breast', 2, 'prep_waste',     4.50, 9.00, v_user_id, now() - interval '1 day'),
      (new_restaurant.id, v_location_id, 'Ice Cream',      1, 'over_portioned', 6.00, 6.00, v_user_id, now() - interval '2 days'),
      (new_restaurant.id, v_location_id, 'Lettuce',        2, 'spoiled',        1.50, 3.00, v_user_id, now() - interval '2 days'),
      (new_restaurant.id, v_location_id, 'Cooking Oil',    1, 'other',          8.00, 8.00, v_user_id, now() - interval '3 days');

    -- Weekly sales (3 weeks)
    v_week_start := date_trunc('week', current_date)::date;
    v_last_week  := v_week_start - interval '7 days';

    INSERT INTO public.weekly_sales (
      restaurant_id, location_id, week_start, gross_sales, entry_method, entered_by_user_id
    ) VALUES
      (new_restaurant.id, v_location_id, v_week_start,                              12400.00, 'manual_weekly', v_user_id),
      (new_restaurant.id, v_location_id, v_last_week,                               11850.00, 'manual_weekly', v_user_id),
      (new_restaurant.id, v_location_id, (v_last_week - interval '7 days')::date,   10920.00, 'manual_weekly', v_user_id);

    -- Shrink alert notification (consumed by the future shrinkage loader)
    INSERT INTO public.notifications (
      restaurant_id, location_id, user_id, type, title, message, severity, data
    ) VALUES (
      new_restaurant.id, v_location_id, v_user_id,
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
  END IF;

  RETURN new_restaurant;
END;
$function$;

NOTIFY pgrst, 'reload schema';
