
-- Role enum
CREATE TYPE public.app_role AS ENUM ('OWNER', 'MANAGER', 'STAFF');

-- Inventory session status
CREATE TYPE public.session_status AS ENUM ('IN_PROGRESS', 'IN_REVIEW', 'APPROVED');

-- Order status
CREATE TYPE public.order_status AS ENUM ('PENDING', 'PREP', 'READY', 'COMPLETED', 'CANCELED');

-- Profiles
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  full_name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view own profile" ON public.profiles FOR SELECT USING (auth.uid() = id);
CREATE POLICY "Users can update own profile" ON public.profiles FOR UPDATE USING (auth.uid() = id);
CREATE POLICY "Users can insert own profile" ON public.profiles FOR INSERT WITH CHECK (auth.uid() = id);

-- Auto-create profile on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name)
  VALUES (NEW.id, NEW.email, COALESCE(NEW.raw_user_meta_data->>'full_name', ''));
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Restaurants
CREATE TABLE public.restaurants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.restaurants ENABLE ROW LEVEL SECURITY;

-- Restaurant members
CREATE TABLE public.restaurant_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id UUID NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.app_role NOT NULL DEFAULT 'STAFF',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, restaurant_id)
);
ALTER TABLE public.restaurant_members ENABLE ROW LEVEL SECURITY;

-- Security definer function for tenant membership check
CREATE OR REPLACE FUNCTION public.is_member_of(r_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.restaurant_members
    WHERE restaurant_id = r_id AND user_id = auth.uid()
  )
$$;

CREATE OR REPLACE FUNCTION public.has_restaurant_role(r_id UUID, _role public.app_role)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.restaurant_members
    WHERE restaurant_id = r_id AND user_id = auth.uid() AND role = _role
  )
$$;

CREATE OR REPLACE FUNCTION public.has_restaurant_role_any(r_id UUID, _roles public.app_role[])
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.restaurant_members
    WHERE restaurant_id = r_id AND user_id = auth.uid() AND role = ANY(_roles)
  )
$$;

-- Restaurant RLS
CREATE POLICY "Members can view their restaurants" ON public.restaurants
  FOR SELECT USING (public.is_member_of(id));
CREATE POLICY "Authenticated users can create restaurants" ON public.restaurants
  FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "Owners can update restaurants" ON public.restaurants
  FOR UPDATE USING (public.has_restaurant_role(id, 'OWNER'));

-- Restaurant members RLS
CREATE POLICY "Members can view co-members" ON public.restaurant_members
  FOR SELECT USING (public.is_member_of(restaurant_id));
CREATE POLICY "Owners can insert members" ON public.restaurant_members
  FOR INSERT WITH CHECK (
    public.has_restaurant_role(restaurant_id, 'OWNER')
    OR (auth.uid() = user_id) -- allow self-insert during onboarding
  );
CREATE POLICY "Owners can update members" ON public.restaurant_members
  FOR UPDATE USING (public.has_restaurant_role(restaurant_id, 'OWNER'));
CREATE POLICY "Owners can delete members" ON public.restaurant_members
  FOR DELETE USING (public.has_restaurant_role(restaurant_id, 'OWNER'));

-- Inventory Lists
CREATE TABLE public.inventory_lists (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id UUID NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.inventory_lists ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Members can view inventory lists" ON public.inventory_lists
  FOR SELECT USING (public.is_member_of(restaurant_id));
CREATE POLICY "Members can create inventory lists" ON public.inventory_lists
  FOR INSERT WITH CHECK (public.is_member_of(restaurant_id));
CREATE POLICY "Manager+ can update inventory lists" ON public.inventory_lists
  FOR UPDATE USING (public.has_restaurant_role_any(restaurant_id, ARRAY['OWNER','MANAGER']::public.app_role[]));
CREATE POLICY "Manager+ can delete inventory lists" ON public.inventory_lists
  FOR DELETE USING (public.has_restaurant_role_any(restaurant_id, ARRAY['OWNER','MANAGER']::public.app_role[]));

-- Inventory Sessions
CREATE TABLE public.inventory_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id UUID NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  inventory_list_id UUID NOT NULL REFERENCES public.inventory_lists(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  status public.session_status NOT NULL DEFAULT 'IN_PROGRESS',
  created_by UUID REFERENCES auth.users(id),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  approved_at TIMESTAMPTZ,
  approved_by UUID REFERENCES auth.users(id)
);
ALTER TABLE public.inventory_sessions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Members can view sessions" ON public.inventory_sessions
  FOR SELECT USING (public.is_member_of(restaurant_id));
CREATE POLICY "Members can create sessions" ON public.inventory_sessions
  FOR INSERT WITH CHECK (public.is_member_of(restaurant_id));
CREATE POLICY "Members can update own in-progress sessions" ON public.inventory_sessions
  FOR UPDATE USING (public.is_member_of(restaurant_id));

-- Inventory Session Items
CREATE TABLE public.inventory_session_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES public.inventory_sessions(id) ON DELETE CASCADE,
  item_name TEXT NOT NULL,
  category TEXT,
  unit TEXT,
  current_stock NUMERIC NOT NULL DEFAULT 0,
  par_level NUMERIC NOT NULL DEFAULT 0,
  lead_time_days INTEGER,
  unit_cost NUMERIC
);
ALTER TABLE public.inventory_session_items ENABLE ROW LEVEL SECURITY;

-- Need a function to get restaurant_id from session
CREATE OR REPLACE FUNCTION public.session_restaurant_id(s_id UUID)
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT restaurant_id FROM public.inventory_sessions WHERE id = s_id
$$;

CREATE POLICY "Members can view session items" ON public.inventory_session_items
  FOR SELECT USING (public.is_member_of(public.session_restaurant_id(session_id)));
CREATE POLICY "Members can create session items" ON public.inventory_session_items
  FOR INSERT WITH CHECK (public.is_member_of(public.session_restaurant_id(session_id)));
CREATE POLICY "Members can update session items" ON public.inventory_session_items
  FOR UPDATE USING (public.is_member_of(public.session_restaurant_id(session_id)));
CREATE POLICY "Members can delete session items" ON public.inventory_session_items
  FOR DELETE USING (public.is_member_of(public.session_restaurant_id(session_id)));

-- PAR Guides
CREATE TABLE public.par_guides (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id UUID NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.par_guides ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Members can view PAR guides" ON public.par_guides
  FOR SELECT USING (public.is_member_of(restaurant_id));
CREATE POLICY "Manager+ can create PAR guides" ON public.par_guides
  FOR INSERT WITH CHECK (public.has_restaurant_role_any(restaurant_id, ARRAY['OWNER','MANAGER']::public.app_role[]));
CREATE POLICY "Manager+ can update PAR guides" ON public.par_guides
  FOR UPDATE USING (public.has_restaurant_role_any(restaurant_id, ARRAY['OWNER','MANAGER']::public.app_role[]));
CREATE POLICY "Manager+ can delete PAR guides" ON public.par_guides
  FOR DELETE USING (public.has_restaurant_role_any(restaurant_id, ARRAY['OWNER','MANAGER']::public.app_role[]));

-- PAR Guide Items
CREATE TABLE public.par_guide_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  par_guide_id UUID NOT NULL REFERENCES public.par_guides(id) ON DELETE CASCADE,
  item_name TEXT NOT NULL,
  category TEXT,
  unit TEXT,
  par_level NUMERIC NOT NULL DEFAULT 0
);
ALTER TABLE public.par_guide_items ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.par_guide_restaurant_id(pg_id UUID)
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT restaurant_id FROM public.par_guides WHERE id = pg_id
$$;

CREATE POLICY "Members can view PAR items" ON public.par_guide_items
  FOR SELECT USING (public.is_member_of(public.par_guide_restaurant_id(par_guide_id)));
CREATE POLICY "Manager+ can create PAR items" ON public.par_guide_items
  FOR INSERT WITH CHECK (public.is_member_of(public.par_guide_restaurant_id(par_guide_id)));
CREATE POLICY "Manager+ can update PAR items" ON public.par_guide_items
  FOR UPDATE USING (public.is_member_of(public.par_guide_restaurant_id(par_guide_id)));
CREATE POLICY "Manager+ can delete PAR items" ON public.par_guide_items
  FOR DELETE USING (public.is_member_of(public.par_guide_restaurant_id(par_guide_id)));

-- Custom Lists
CREATE TABLE public.custom_lists (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id UUID NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.custom_lists ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Members can view custom lists" ON public.custom_lists
  FOR SELECT USING (public.is_member_of(restaurant_id));
CREATE POLICY "Members can create custom lists" ON public.custom_lists
  FOR INSERT WITH CHECK (public.is_member_of(restaurant_id));
CREATE POLICY "Members can update custom lists" ON public.custom_lists
  FOR UPDATE USING (public.is_member_of(restaurant_id));
CREATE POLICY "Members can delete custom lists" ON public.custom_lists
  FOR DELETE USING (public.is_member_of(restaurant_id));

-- Custom List Items
CREATE TABLE public.custom_list_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  list_id UUID NOT NULL REFERENCES public.custom_lists(id) ON DELETE CASCADE,
  item_name TEXT NOT NULL,
  quantity NUMERIC,
  unit TEXT
);
ALTER TABLE public.custom_list_items ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.custom_list_restaurant_id(cl_id UUID)
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT restaurant_id FROM public.custom_lists WHERE id = cl_id
$$;

CREATE POLICY "Members can view list items" ON public.custom_list_items
  FOR SELECT USING (public.is_member_of(public.custom_list_restaurant_id(list_id)));
CREATE POLICY "Members can create list items" ON public.custom_list_items
  FOR INSERT WITH CHECK (public.is_member_of(public.custom_list_restaurant_id(list_id)));
CREATE POLICY "Members can update list items" ON public.custom_list_items
  FOR UPDATE USING (public.is_member_of(public.custom_list_restaurant_id(list_id)));
CREATE POLICY "Members can delete list items" ON public.custom_list_items
  FOR DELETE USING (public.is_member_of(public.custom_list_restaurant_id(list_id)));

-- Orders
CREATE TABLE public.orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id UUID NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  created_by UUID REFERENCES auth.users(id),
  status public.order_status NOT NULL DEFAULT 'PENDING',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Members can view orders" ON public.orders
  FOR SELECT USING (public.is_member_of(restaurant_id));
CREATE POLICY "Members can create orders" ON public.orders
  FOR INSERT WITH CHECK (public.is_member_of(restaurant_id));
CREATE POLICY "Members can update orders" ON public.orders
  FOR UPDATE USING (public.is_member_of(restaurant_id));

-- Order Items
CREATE TABLE public.order_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  item_name TEXT NOT NULL,
  quantity NUMERIC NOT NULL DEFAULT 0,
  unit TEXT
);
ALTER TABLE public.order_items ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.order_restaurant_id(o_id UUID)
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT restaurant_id FROM public.orders WHERE id = o_id
$$;

CREATE POLICY "Members can view order items" ON public.order_items
  FOR SELECT USING (public.is_member_of(public.order_restaurant_id(order_id)));
CREATE POLICY "Members can create order items" ON public.order_items
  FOR INSERT WITH CHECK (public.is_member_of(public.order_restaurant_id(order_id)));
CREATE POLICY "Members can update order items" ON public.order_items
  FOR UPDATE USING (public.is_member_of(public.order_restaurant_id(order_id)));

-- Smart Order Runs
CREATE TABLE public.smart_order_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id UUID NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  session_id UUID NOT NULL REFERENCES public.inventory_sessions(id) ON DELETE CASCADE,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.smart_order_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Members can view smart order runs" ON public.smart_order_runs
  FOR SELECT USING (public.is_member_of(restaurant_id));
CREATE POLICY "Members can create smart order runs" ON public.smart_order_runs
  FOR INSERT WITH CHECK (public.is_member_of(restaurant_id));

-- Smart Order Run Items
CREATE TABLE public.smart_order_run_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id UUID NOT NULL REFERENCES public.smart_order_runs(id) ON DELETE CASCADE,
  item_name TEXT NOT NULL,
  suggested_order NUMERIC NOT NULL DEFAULT 0,
  risk TEXT NOT NULL DEFAULT 'GREEN',
  current_stock NUMERIC NOT NULL DEFAULT 0,
  par_level NUMERIC NOT NULL DEFAULT 0
);
ALTER TABLE public.smart_order_run_items ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.smart_order_run_restaurant_id(sr_id UUID)
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT restaurant_id FROM public.smart_order_runs WHERE id = sr_id
$$;

CREATE POLICY "Members can view run items" ON public.smart_order_run_items
  FOR SELECT USING (public.is_member_of(public.smart_order_run_restaurant_id(run_id)));
CREATE POLICY "Members can create run items" ON public.smart_order_run_items
  FOR INSERT WITH CHECK (public.is_member_of(public.smart_order_run_restaurant_id(run_id)));

-- Usage Events
CREATE TABLE public.usage_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id UUID NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  item_name TEXT NOT NULL,
  order_id UUID REFERENCES public.orders(id),
  quantity_used NUMERIC NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.usage_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Members can view usage events" ON public.usage_events
  FOR SELECT USING (public.is_member_of(restaurant_id));
CREATE POLICY "Members can create usage events" ON public.usage_events
  FOR INSERT WITH CHECK (public.is_member_of(restaurant_id));
