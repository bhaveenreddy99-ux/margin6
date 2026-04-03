
-- Drop the existing overly permissive INSERT policy on restaurants
DROP POLICY IF EXISTS "Authenticated users can create restaurants" ON public.restaurants;

-- Create the SECURITY DEFINER function for restaurant creation
CREATE OR REPLACE FUNCTION public.create_restaurant_with_owner(
  p_name text,
  p_is_demo boolean DEFAULT false
)
RETURNS public.restaurants
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  new_restaurant public.restaurants;
  v_user_id uuid := auth.uid();
  v_inv_list_id uuid;
  v_par_guide_id uuid;
  v_session_id uuid;
  v_order_id uuid;
  v_smart_run_id uuid;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Create the restaurant
  INSERT INTO public.restaurants (name)
  VALUES (p_name)
  RETURNING * INTO new_restaurant;

  -- Add the creator as OWNER
  INSERT INTO public.restaurant_members (restaurant_id, user_id, role)
  VALUES (new_restaurant.id, v_user_id, 'OWNER');

  -- Seed demo data if requested
  IF p_is_demo THEN
    -- Inventory list
    INSERT INTO public.inventory_lists (restaurant_id, name, created_by)
    VALUES (new_restaurant.id, 'Main Kitchen', v_user_id)
    RETURNING id INTO v_inv_list_id;

    -- PAR guide
    INSERT INTO public.par_guides (restaurant_id, name, created_by)
    VALUES (new_restaurant.id, 'Standard PAR', v_user_id)
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

    -- Approved inventory session
    INSERT INTO public.inventory_sessions (restaurant_id, inventory_list_id, name, status, created_by, approved_by, approved_at)
    VALUES (new_restaurant.id, v_inv_list_id, 'Opening Count', 'APPROVED', v_user_id, v_user_id, now())
    RETURNING id INTO v_session_id;

    INSERT INTO public.inventory_session_items (session_id, item_name, category, unit, current_stock, par_level, unit_cost) VALUES
      (v_session_id, 'Chicken Breast', 'Cooler', 'lbs', 20, 50, 4.5),
      (v_session_id, 'Ground Beef', 'Cooler', 'lbs', 35, 40, 5.0),
      (v_session_id, 'French Fries', 'Frozen', 'bags', 10, 30, 3.0),
      (v_session_id, 'Burger Buns', 'Dry', 'packs', 22, 25, 2.0),
      (v_session_id, 'Lettuce', 'Cooler', 'heads', 8, 20, 1.5),
      (v_session_id, 'Tomatoes', 'Cooler', 'lbs', 12, 15, 2.0),
      (v_session_id, 'Cooking Oil', 'Dry', 'gallons', 3, 10, 8.0),
      (v_session_id, 'Ice Cream', 'Frozen', 'tubs', 5, 12, 6.0);

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

    -- Smart order run
    INSERT INTO public.smart_order_runs (restaurant_id, session_id, created_by)
    VALUES (new_restaurant.id, v_session_id, v_user_id)
    RETURNING id INTO v_smart_run_id;

    INSERT INTO public.smart_order_run_items (run_id, item_name, suggested_order, risk, current_stock, par_level) VALUES
      (v_smart_run_id, 'Chicken Breast', 30, 'RED', 20, 50),
      (v_smart_run_id, 'Ground Beef', 5, 'YELLOW', 35, 40),
      (v_smart_run_id, 'French Fries', 20, 'RED', 10, 30),
      (v_smart_run_id, 'Burger Buns', 3, 'YELLOW', 22, 25),
      (v_smart_run_id, 'Lettuce', 12, 'RED', 8, 20),
      (v_smart_run_id, 'Tomatoes', 3, 'YELLOW', 12, 15),
      (v_smart_run_id, 'Cooking Oil', 7, 'RED', 3, 10),
      (v_smart_run_id, 'Ice Cream', 7, 'RED', 5, 12);
  END IF;

  RETURN new_restaurant;
END;
$$;
