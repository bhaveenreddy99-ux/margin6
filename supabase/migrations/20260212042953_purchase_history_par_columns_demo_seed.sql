
-- 1. Add inventory_list_id to par_guides
ALTER TABLE public.par_guides ADD COLUMN IF NOT EXISTS inventory_list_id uuid REFERENCES public.inventory_lists(id);

-- 2. Add inventory_list_id and par_guide_id to smart_order_runs
ALTER TABLE public.smart_order_runs ADD COLUMN IF NOT EXISTS inventory_list_id uuid REFERENCES public.inventory_lists(id);
ALTER TABLE public.smart_order_runs ADD COLUMN IF NOT EXISTS par_guide_id uuid REFERENCES public.par_guides(id);

-- 3. Add unit_cost to smart_order_run_items
ALTER TABLE public.smart_order_run_items ADD COLUMN IF NOT EXISTS unit_cost numeric;

-- 4. Create purchase_history table
CREATE TABLE IF NOT EXISTS public.purchase_history (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  restaurant_id uuid NOT NULL REFERENCES public.restaurants(id),
  inventory_list_id uuid REFERENCES public.inventory_lists(id),
  smart_order_run_id uuid REFERENCES public.smart_order_runs(id),
  vendor_name text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  created_by uuid
);

ALTER TABLE public.purchase_history ENABLE ROW LEVEL SECURITY;

-- RLS for purchase_history
CREATE POLICY "Members can view purchase history"
  ON public.purchase_history FOR SELECT
  USING (public.is_member_of(restaurant_id));

CREATE POLICY "Manager+ can create purchase history"
  ON public.purchase_history FOR INSERT
  WITH CHECK (public.has_restaurant_role_any(restaurant_id, ARRAY['OWNER'::app_role, 'MANAGER'::app_role]));

CREATE POLICY "Manager+ can delete purchase history"
  ON public.purchase_history FOR DELETE
  USING (public.has_restaurant_role_any(restaurant_id, ARRAY['OWNER'::app_role, 'MANAGER'::app_role]));

-- 5. Create purchase_history_items table
CREATE TABLE IF NOT EXISTS public.purchase_history_items (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  purchase_history_id uuid NOT NULL REFERENCES public.purchase_history(id) ON DELETE CASCADE,
  item_name text NOT NULL,
  quantity numeric NOT NULL DEFAULT 0,
  unit_cost numeric,
  total_cost numeric
);

ALTER TABLE public.purchase_history_items ENABLE ROW LEVEL SECURITY;

-- Helper function for purchase_history RLS
CREATE OR REPLACE FUNCTION public.purchase_history_restaurant_id(ph_id uuid)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT restaurant_id FROM public.purchase_history WHERE id = ph_id
$$;

CREATE POLICY "Members can view purchase history items"
  ON public.purchase_history_items FOR SELECT
  USING (public.is_member_of(public.purchase_history_restaurant_id(purchase_history_id)));

CREATE POLICY "Manager+ can create purchase history items"
  ON public.purchase_history_items FOR INSERT
  WITH CHECK (public.is_member_of(public.purchase_history_restaurant_id(purchase_history_id)));

-- 6. Grant permissions
GRANT ALL ON public.purchase_history TO authenticated;
GRANT ALL ON public.purchase_history TO anon;
GRANT ALL ON public.purchase_history_items TO authenticated;
GRANT ALL ON public.purchase_history_items TO anon;

-- 7. Update the demo seeding function
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
  END IF;

  RETURN new_restaurant;
END;
$function$;

-- Notify PostgREST to reload schema
NOTIFY pgrst, 'reload schema';
