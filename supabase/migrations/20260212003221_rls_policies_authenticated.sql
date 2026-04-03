
-- Fix: Convert all RESTRICTIVE policies to PERMISSIVE (default)
-- Drop and recreate all policies as PERMISSIVE

-- restaurants
DROP POLICY IF EXISTS "Authenticated users can create restaurants" ON public.restaurants;
DROP POLICY IF EXISTS "Members can view their restaurants" ON public.restaurants;
DROP POLICY IF EXISTS "Owners can update restaurants" ON public.restaurants;

CREATE POLICY "Authenticated users can create restaurants" ON public.restaurants FOR INSERT TO authenticated WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "Members can view their restaurants" ON public.restaurants FOR SELECT TO authenticated USING (is_member_of(id));
CREATE POLICY "Owners can update restaurants" ON public.restaurants FOR UPDATE TO authenticated USING (has_restaurant_role(id, 'OWNER'::app_role));

-- restaurant_members
DROP POLICY IF EXISTS "Owners can insert members" ON public.restaurant_members;
DROP POLICY IF EXISTS "Members can view co-members" ON public.restaurant_members;
DROP POLICY IF EXISTS "Owners can update members" ON public.restaurant_members;
DROP POLICY IF EXISTS "Owners can delete members" ON public.restaurant_members;

CREATE POLICY "Owners can insert members" ON public.restaurant_members FOR INSERT TO authenticated WITH CHECK (has_restaurant_role(restaurant_id, 'OWNER'::app_role) OR (auth.uid() = user_id));
CREATE POLICY "Members can view co-members" ON public.restaurant_members FOR SELECT TO authenticated USING (is_member_of(restaurant_id));
CREATE POLICY "Owners can update members" ON public.restaurant_members FOR UPDATE TO authenticated USING (has_restaurant_role(restaurant_id, 'OWNER'::app_role));
CREATE POLICY "Owners can delete members" ON public.restaurant_members FOR DELETE TO authenticated USING (has_restaurant_role(restaurant_id, 'OWNER'::app_role));

-- profiles
DROP POLICY IF EXISTS "Users can view own profile" ON public.profiles;
DROP POLICY IF EXISTS "Users can update own profile" ON public.profiles;
DROP POLICY IF EXISTS "Users can insert own profile" ON public.profiles;

CREATE POLICY "Users can view own profile" ON public.profiles FOR SELECT TO authenticated USING (auth.uid() = id);
CREATE POLICY "Users can update own profile" ON public.profiles FOR UPDATE TO authenticated USING (auth.uid() = id);
CREATE POLICY "Users can insert own profile" ON public.profiles FOR INSERT TO authenticated WITH CHECK (auth.uid() = id);

-- inventory_lists
DROP POLICY IF EXISTS "Members can view inventory lists" ON public.inventory_lists;
DROP POLICY IF EXISTS "Members can create inventory lists" ON public.inventory_lists;
DROP POLICY IF EXISTS "Manager+ can update inventory lists" ON public.inventory_lists;
DROP POLICY IF EXISTS "Manager+ can delete inventory lists" ON public.inventory_lists;

CREATE POLICY "Members can view inventory lists" ON public.inventory_lists FOR SELECT TO authenticated USING (is_member_of(restaurant_id));
CREATE POLICY "Members can create inventory lists" ON public.inventory_lists FOR INSERT TO authenticated WITH CHECK (is_member_of(restaurant_id));
CREATE POLICY "Manager+ can update inventory lists" ON public.inventory_lists FOR UPDATE TO authenticated USING (has_restaurant_role_any(restaurant_id, ARRAY['OWNER'::app_role, 'MANAGER'::app_role]));
CREATE POLICY "Manager+ can delete inventory lists" ON public.inventory_lists FOR DELETE TO authenticated USING (has_restaurant_role_any(restaurant_id, ARRAY['OWNER'::app_role, 'MANAGER'::app_role]));

-- inventory_sessions
DROP POLICY IF EXISTS "Members can view sessions" ON public.inventory_sessions;
DROP POLICY IF EXISTS "Members can create sessions" ON public.inventory_sessions;
DROP POLICY IF EXISTS "Members can update own in-progress sessions" ON public.inventory_sessions;

CREATE POLICY "Members can view sessions" ON public.inventory_sessions FOR SELECT TO authenticated USING (is_member_of(restaurant_id));
CREATE POLICY "Members can create sessions" ON public.inventory_sessions FOR INSERT TO authenticated WITH CHECK (is_member_of(restaurant_id));
CREATE POLICY "Members can update own in-progress sessions" ON public.inventory_sessions FOR UPDATE TO authenticated USING (is_member_of(restaurant_id));

-- inventory_session_items
DROP POLICY IF EXISTS "Members can view session items" ON public.inventory_session_items;
DROP POLICY IF EXISTS "Members can create session items" ON public.inventory_session_items;
DROP POLICY IF EXISTS "Members can update session items" ON public.inventory_session_items;
DROP POLICY IF EXISTS "Members can delete session items" ON public.inventory_session_items;

CREATE POLICY "Members can view session items" ON public.inventory_session_items FOR SELECT TO authenticated USING (is_member_of(session_restaurant_id(session_id)));
CREATE POLICY "Members can create session items" ON public.inventory_session_items FOR INSERT TO authenticated WITH CHECK (is_member_of(session_restaurant_id(session_id)));
CREATE POLICY "Members can update session items" ON public.inventory_session_items FOR UPDATE TO authenticated USING (is_member_of(session_restaurant_id(session_id)));
CREATE POLICY "Members can delete session items" ON public.inventory_session_items FOR DELETE TO authenticated USING (is_member_of(session_restaurant_id(session_id)));

-- par_guides
DROP POLICY IF EXISTS "Members can view PAR guides" ON public.par_guides;
DROP POLICY IF EXISTS "Manager+ can create PAR guides" ON public.par_guides;
DROP POLICY IF EXISTS "Manager+ can update PAR guides" ON public.par_guides;
DROP POLICY IF EXISTS "Manager+ can delete PAR guides" ON public.par_guides;

CREATE POLICY "Members can view PAR guides" ON public.par_guides FOR SELECT TO authenticated USING (is_member_of(restaurant_id));
CREATE POLICY "Manager+ can create PAR guides" ON public.par_guides FOR INSERT TO authenticated WITH CHECK (has_restaurant_role_any(restaurant_id, ARRAY['OWNER'::app_role, 'MANAGER'::app_role]));
CREATE POLICY "Manager+ can update PAR guides" ON public.par_guides FOR UPDATE TO authenticated USING (has_restaurant_role_any(restaurant_id, ARRAY['OWNER'::app_role, 'MANAGER'::app_role]));
CREATE POLICY "Manager+ can delete PAR guides" ON public.par_guides FOR DELETE TO authenticated USING (has_restaurant_role_any(restaurant_id, ARRAY['OWNER'::app_role, 'MANAGER'::app_role]));

-- par_guide_items
DROP POLICY IF EXISTS "Members can view PAR items" ON public.par_guide_items;
DROP POLICY IF EXISTS "Manager+ can create PAR items" ON public.par_guide_items;
DROP POLICY IF EXISTS "Manager+ can update PAR items" ON public.par_guide_items;
DROP POLICY IF EXISTS "Manager+ can delete PAR items" ON public.par_guide_items;

CREATE POLICY "Members can view PAR items" ON public.par_guide_items FOR SELECT TO authenticated USING (is_member_of(par_guide_restaurant_id(par_guide_id)));
CREATE POLICY "Manager+ can create PAR items" ON public.par_guide_items FOR INSERT TO authenticated WITH CHECK (is_member_of(par_guide_restaurant_id(par_guide_id)));
CREATE POLICY "Manager+ can update PAR items" ON public.par_guide_items FOR UPDATE TO authenticated USING (is_member_of(par_guide_restaurant_id(par_guide_id)));
CREATE POLICY "Manager+ can delete PAR items" ON public.par_guide_items FOR DELETE TO authenticated USING (is_member_of(par_guide_restaurant_id(par_guide_id)));

-- custom_lists
DROP POLICY IF EXISTS "Members can view custom lists" ON public.custom_lists;
DROP POLICY IF EXISTS "Members can create custom lists" ON public.custom_lists;
DROP POLICY IF EXISTS "Members can update custom lists" ON public.custom_lists;
DROP POLICY IF EXISTS "Members can delete custom lists" ON public.custom_lists;

CREATE POLICY "Members can view custom lists" ON public.custom_lists FOR SELECT TO authenticated USING (is_member_of(restaurant_id));
CREATE POLICY "Members can create custom lists" ON public.custom_lists FOR INSERT TO authenticated WITH CHECK (is_member_of(restaurant_id));
CREATE POLICY "Members can update custom lists" ON public.custom_lists FOR UPDATE TO authenticated USING (is_member_of(restaurant_id));
CREATE POLICY "Members can delete custom lists" ON public.custom_lists FOR DELETE TO authenticated USING (is_member_of(restaurant_id));

-- custom_list_items
DROP POLICY IF EXISTS "Members can view list items" ON public.custom_list_items;
DROP POLICY IF EXISTS "Members can create list items" ON public.custom_list_items;
DROP POLICY IF EXISTS "Members can update list items" ON public.custom_list_items;
DROP POLICY IF EXISTS "Members can delete list items" ON public.custom_list_items;

CREATE POLICY "Members can view list items" ON public.custom_list_items FOR SELECT TO authenticated USING (is_member_of(custom_list_restaurant_id(list_id)));
CREATE POLICY "Members can create list items" ON public.custom_list_items FOR INSERT TO authenticated WITH CHECK (is_member_of(custom_list_restaurant_id(list_id)));
CREATE POLICY "Members can update list items" ON public.custom_list_items FOR UPDATE TO authenticated USING (is_member_of(custom_list_restaurant_id(list_id)));
CREATE POLICY "Members can delete list items" ON public.custom_list_items FOR DELETE TO authenticated USING (is_member_of(custom_list_restaurant_id(list_id)));

-- orders
DROP POLICY IF EXISTS "Members can view orders" ON public.orders;
DROP POLICY IF EXISTS "Members can create orders" ON public.orders;
DROP POLICY IF EXISTS "Members can update orders" ON public.orders;

CREATE POLICY "Members can view orders" ON public.orders FOR SELECT TO authenticated USING (is_member_of(restaurant_id));
CREATE POLICY "Members can create orders" ON public.orders FOR INSERT TO authenticated WITH CHECK (is_member_of(restaurant_id));
CREATE POLICY "Members can update orders" ON public.orders FOR UPDATE TO authenticated USING (is_member_of(restaurant_id));

-- order_items
DROP POLICY IF EXISTS "Members can view order items" ON public.order_items;
DROP POLICY IF EXISTS "Members can create order items" ON public.order_items;
DROP POLICY IF EXISTS "Members can update order items" ON public.order_items;

CREATE POLICY "Members can view order items" ON public.order_items FOR SELECT TO authenticated USING (is_member_of(order_restaurant_id(order_id)));
CREATE POLICY "Members can create order items" ON public.order_items FOR INSERT TO authenticated WITH CHECK (is_member_of(order_restaurant_id(order_id)));
CREATE POLICY "Members can update order items" ON public.order_items FOR UPDATE TO authenticated USING (is_member_of(order_restaurant_id(order_id)));

-- smart_order_runs
DROP POLICY IF EXISTS "Members can view smart order runs" ON public.smart_order_runs;
DROP POLICY IF EXISTS "Members can create smart order runs" ON public.smart_order_runs;

CREATE POLICY "Members can view smart order runs" ON public.smart_order_runs FOR SELECT TO authenticated USING (is_member_of(restaurant_id));
CREATE POLICY "Members can create smart order runs" ON public.smart_order_runs FOR INSERT TO authenticated WITH CHECK (is_member_of(restaurant_id));

-- smart_order_run_items
DROP POLICY IF EXISTS "Members can view run items" ON public.smart_order_run_items;
DROP POLICY IF EXISTS "Members can create run items" ON public.smart_order_run_items;

CREATE POLICY "Members can view run items" ON public.smart_order_run_items FOR SELECT TO authenticated USING (is_member_of(smart_order_run_restaurant_id(run_id)));
CREATE POLICY "Members can create run items" ON public.smart_order_run_items FOR INSERT TO authenticated WITH CHECK (is_member_of(smart_order_run_restaurant_id(run_id)));

-- usage_events
DROP POLICY IF EXISTS "Members can view usage events" ON public.usage_events;
DROP POLICY IF EXISTS "Members can create usage events" ON public.usage_events;

CREATE POLICY "Members can view usage events" ON public.usage_events FOR SELECT TO authenticated USING (is_member_of(restaurant_id));
CREATE POLICY "Members can create usage events" ON public.usage_events FOR INSERT TO authenticated WITH CHECK (is_member_of(restaurant_id));
