
-- 1) restaurant_settings
CREATE TABLE public.restaurant_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id uuid NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  business_email text,
  phone text,
  address text,
  currency text NOT NULL DEFAULT 'USD',
  timezone text NOT NULL DEFAULT 'America/New_York',
  date_format text NOT NULL DEFAULT 'MM/DD/YYYY',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(restaurant_id)
);
ALTER TABLE public.restaurant_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Members can view settings" ON public.restaurant_settings FOR SELECT USING (is_member_of(restaurant_id));
CREATE POLICY "Manager+ can insert settings" ON public.restaurant_settings FOR INSERT WITH CHECK (has_restaurant_role_any(restaurant_id, ARRAY['OWNER'::app_role, 'MANAGER'::app_role]));
CREATE POLICY "Manager+ can update settings" ON public.restaurant_settings FOR UPDATE USING (has_restaurant_role_any(restaurant_id, ARRAY['OWNER'::app_role, 'MANAGER'::app_role]));
CREATE POLICY "Owner can delete settings" ON public.restaurant_settings FOR DELETE USING (has_restaurant_role(restaurant_id, 'OWNER'::app_role));

-- 2) locations
CREATE TABLE public.locations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id uuid NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  name text NOT NULL,
  address text,
  city text,
  state text,
  zip text,
  storage_types jsonb DEFAULT '["Cooler","Freezer","Dry Storage","Bar"]'::jsonb,
  is_default boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.locations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Members can view locations" ON public.locations FOR SELECT USING (is_member_of(restaurant_id));
CREATE POLICY "Manager+ can insert locations" ON public.locations FOR INSERT WITH CHECK (has_restaurant_role_any(restaurant_id, ARRAY['OWNER'::app_role, 'MANAGER'::app_role]));
CREATE POLICY "Manager+ can update locations" ON public.locations FOR UPDATE USING (has_restaurant_role_any(restaurant_id, ARRAY['OWNER'::app_role, 'MANAGER'::app_role]));
CREATE POLICY "Manager+ can delete locations" ON public.locations FOR DELETE USING (has_restaurant_role_any(restaurant_id, ARRAY['OWNER'::app_role, 'MANAGER'::app_role]));

-- 3) inventory_settings
CREATE TABLE public.inventory_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id uuid NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  default_location_id uuid REFERENCES public.locations(id) ON DELETE SET NULL,
  categories jsonb NOT NULL DEFAULT '["Frozen","Cooler","Dry","Bar","Produce","Dairy"]'::jsonb,
  units jsonb NOT NULL DEFAULT '["kg","lb","oz","case","each","liter","gallon"]'::jsonb,
  auto_category_enabled boolean NOT NULL DEFAULT false,
  autosave_enabled boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(restaurant_id)
);
ALTER TABLE public.inventory_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Members can view inv settings" ON public.inventory_settings FOR SELECT USING (is_member_of(restaurant_id));
CREATE POLICY "Manager+ can insert inv settings" ON public.inventory_settings FOR INSERT WITH CHECK (has_restaurant_role_any(restaurant_id, ARRAY['OWNER'::app_role, 'MANAGER'::app_role]));
CREATE POLICY "Manager+ can update inv settings" ON public.inventory_settings FOR UPDATE USING (has_restaurant_role_any(restaurant_id, ARRAY['OWNER'::app_role, 'MANAGER'::app_role]));

-- 4) par_settings
CREATE TABLE public.par_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id uuid NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  default_lead_time_days integer NOT NULL DEFAULT 2,
  default_reorder_threshold numeric NOT NULL DEFAULT 80,
  auto_apply_last_par boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(restaurant_id)
);
ALTER TABLE public.par_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Members can view par settings" ON public.par_settings FOR SELECT USING (is_member_of(restaurant_id));
CREATE POLICY "Manager+ can insert par settings" ON public.par_settings FOR INSERT WITH CHECK (has_restaurant_role_any(restaurant_id, ARRAY['OWNER'::app_role, 'MANAGER'::app_role]));
CREATE POLICY "Manager+ can update par settings" ON public.par_settings FOR UPDATE USING (has_restaurant_role_any(restaurant_id, ARRAY['OWNER'::app_role, 'MANAGER'::app_role]));

-- 5) smart_order_settings
CREATE TABLE public.smart_order_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id uuid NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  auto_create_purchase_history boolean NOT NULL DEFAULT true,
  auto_calculate_cost boolean NOT NULL DEFAULT true,
  red_threshold numeric NOT NULL DEFAULT 50,
  yellow_threshold numeric NOT NULL DEFAULT 100,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(restaurant_id)
);
ALTER TABLE public.smart_order_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Members can view so settings" ON public.smart_order_settings FOR SELECT USING (is_member_of(restaurant_id));
CREATE POLICY "Manager+ can insert so settings" ON public.smart_order_settings FOR INSERT WITH CHECK (has_restaurant_role_any(restaurant_id, ARRAY['OWNER'::app_role, 'MANAGER'::app_role]));
CREATE POLICY "Manager+ can update so settings" ON public.smart_order_settings FOR UPDATE USING (has_restaurant_role_any(restaurant_id, ARRAY['OWNER'::app_role, 'MANAGER'::app_role]));

-- 6) Add optional location_id to inventory_lists, inventory_sessions, smart_order_runs, restaurant_members
ALTER TABLE public.inventory_lists ADD COLUMN location_id uuid REFERENCES public.locations(id) ON DELETE SET NULL;
ALTER TABLE public.inventory_sessions ADD COLUMN location_id uuid REFERENCES public.locations(id) ON DELETE SET NULL;
ALTER TABLE public.smart_order_runs ADD COLUMN location_id uuid REFERENCES public.locations(id) ON DELETE SET NULL;
ALTER TABLE public.restaurant_members ADD COLUMN default_location_id uuid REFERENCES public.locations(id) ON DELETE SET NULL;
