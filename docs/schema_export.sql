-- =============================================================================
-- RestaurantIQ — Complete Database Schema Export
-- Generated: 2026-03-27
-- Source: 53 Supabase migration files + generated TypeScript types
-- =============================================================================


-- =============================================================================
-- CUSTOM TYPES / ENUMS
-- =============================================================================

CREATE TYPE public.app_role AS ENUM (
  'OWNER',
  'MANAGER',
  'STAFF'
);

CREATE TYPE public.session_status AS ENUM (
  'IN_PROGRESS',
  'IN_REVIEW',
  'APPROVED'
);

CREATE TYPE public.order_status AS ENUM (
  'PENDING',
  'PREP',
  'READY',
  'COMPLETED',
  'CANCELED'
);

CREATE TYPE public.invitation_status AS ENUM (
  'PENDING',
  'ACCEPTED',
  'EXPIRED',
  'REVOKED'
);

CREATE TYPE public.notification_severity AS ENUM (
  'INFO',
  'WARNING',
  'CRITICAL'
);

CREATE TYPE public.email_digest_mode AS ENUM (
  'IMMEDIATE',
  'DAILY_DIGEST'
);

CREATE TYPE public.recipients_mode AS ENUM (
  'OWNERS_MANAGERS',
  'ALL',
  'CUSTOM'
);


-- =============================================================================
-- SECURITY DEFINER HELPER FUNCTIONS (used in RLS policies)
-- =============================================================================

-- Returns true if the current user is a member of the given restaurant.
CREATE OR REPLACE FUNCTION public.is_member_of(r_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.restaurant_members
    WHERE restaurant_id = r_id AND user_id = auth.uid()
  )
$$;

-- Returns true if the current user has the given role in the given restaurant.
CREATE OR REPLACE FUNCTION public.has_restaurant_role(r_id UUID, _role public.app_role)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.restaurant_members
    WHERE restaurant_id = r_id AND user_id = auth.uid() AND role = _role
  )
$$;

-- Returns true if the current user has any of the given roles in the given restaurant.
CREATE OR REPLACE FUNCTION public.has_restaurant_role_any(r_id UUID, _roles public.app_role[])
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.restaurant_members
    WHERE restaurant_id = r_id AND user_id = auth.uid() AND role = ANY(_roles)
  )
$$;

-- Resolves parent restaurant_id from a child record (used in RLS policies).
CREATE OR REPLACE FUNCTION public.session_restaurant_id(s_id UUID)
RETURNS UUID LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT restaurant_id FROM public.inventory_sessions WHERE id = s_id
$$;

CREATE OR REPLACE FUNCTION public.par_guide_restaurant_id(pg_id UUID)
RETURNS UUID LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT restaurant_id FROM public.par_guides WHERE id = pg_id
$$;

CREATE OR REPLACE FUNCTION public.custom_list_restaurant_id(cl_id UUID)
RETURNS UUID LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT restaurant_id FROM public.custom_lists WHERE id = cl_id
$$;

CREATE OR REPLACE FUNCTION public.order_restaurant_id(o_id UUID)
RETURNS UUID LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT restaurant_id FROM public.orders WHERE id = o_id
$$;

CREATE OR REPLACE FUNCTION public.smart_order_run_restaurant_id(sr_id UUID)
RETURNS UUID LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT restaurant_id FROM public.smart_order_runs WHERE id = sr_id
$$;

CREATE OR REPLACE FUNCTION public.purchase_history_restaurant_id(ph_id UUID)
RETURNS UUID LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT restaurant_id FROM public.purchase_history WHERE id = ph_id
$$;

CREATE OR REPLACE FUNCTION public.list_category_restaurant_id(lc_list_id UUID)
RETURNS UUID LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT restaurant_id FROM public.inventory_lists WHERE id = lc_list_id
$$;

CREATE OR REPLACE FUNCTION public.list_item_map_restaurant_id(p_list_id UUID)
RETURNS UUID LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT restaurant_id FROM public.inventory_lists WHERE id = p_list_id
$$;

CREATE OR REPLACE FUNCTION public.reminder_restaurant_id(r_id UUID)
RETURNS UUID LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT restaurant_id FROM public.reminders WHERE id = r_id
$$;

CREATE OR REPLACE FUNCTION public.alert_pref_restaurant_id(pref_id UUID)
RETURNS UUID LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT restaurant_id FROM public.notification_preferences WHERE id = pref_id
$$;

CREATE OR REPLACE FUNCTION public.invitation_restaurant_id(inv_id UUID)
RETURNS UUID LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT restaurant_id FROM public.invitations WHERE id = inv_id
$$;


-- =============================================================================
-- TABLES
-- (ordered so each table is defined before the tables that reference it)
-- =============================================================================

-- ---------------------------------------------------------------------------
-- profiles
-- Mirror of auth.users; auto-created via trigger on signup.
-- ---------------------------------------------------------------------------
CREATE TABLE public.profiles (
  id         UUID        PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email      TEXT        NOT NULL,
  full_name  TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own profile"
  ON public.profiles FOR SELECT TO authenticated
  USING (auth.uid() = id);

CREATE POLICY "Users can insert own profile"
  ON public.profiles FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = id);

CREATE POLICY "Users can update own profile"
  ON public.profiles FOR UPDATE TO authenticated
  USING     (auth.uid() = id)
  WITH CHECK (auth.uid() = id);


-- ---------------------------------------------------------------------------
-- restaurants
-- Top-level tenant entity; every other table scopes to this.
-- ---------------------------------------------------------------------------
CREATE TABLE public.restaurants (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  name       TEXT        NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.restaurants ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can view their restaurants"
  ON public.restaurants FOR SELECT TO authenticated
  USING (public.is_member_of(id));

CREATE POLICY "Authenticated users can create restaurants"
  ON public.restaurants FOR INSERT TO authenticated
  WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "Owners can update restaurants"
  ON public.restaurants FOR UPDATE TO authenticated
  USING     (public.has_restaurant_role(id, 'OWNER'))
  WITH CHECK (public.has_restaurant_role(id, 'OWNER'));


-- ---------------------------------------------------------------------------
-- restaurant_members
-- Maps users to restaurants with a role; primary access-control join table.
-- ---------------------------------------------------------------------------
CREATE TABLE public.restaurant_members (
  id                  UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id       UUID            NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  user_id             UUID            NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role                public.app_role NOT NULL DEFAULT 'STAFF',
  default_location_id UUID,           -- FK added later; references locations(id)
  created_at          TIMESTAMPTZ     NOT NULL DEFAULT now(),
  UNIQUE (user_id, restaurant_id)
);

ALTER TABLE public.restaurant_members ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can view co-members"
  ON public.restaurant_members FOR SELECT TO authenticated
  USING (public.is_member_of(restaurant_id));

CREATE POLICY "Owners can insert members"
  ON public.restaurant_members FOR INSERT TO authenticated
  WITH CHECK (
    public.has_restaurant_role(restaurant_id, 'OWNER')
    OR (auth.uid() = user_id)
  );

CREATE POLICY "Owners can update members"
  ON public.restaurant_members FOR UPDATE TO authenticated
  USING     (public.has_restaurant_role(restaurant_id, 'OWNER'))
  WITH CHECK (public.has_restaurant_role(restaurant_id, 'OWNER'));

CREATE POLICY "Owners can delete members"
  ON public.restaurant_members FOR DELETE TO authenticated
  USING (public.has_restaurant_role(restaurant_id, 'OWNER'));


-- ---------------------------------------------------------------------------
-- locations
-- Physical locations (e.g. separate kitchens, storage areas) within a restaurant.
-- ---------------------------------------------------------------------------
CREATE TABLE public.locations (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id UUID        NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  name          TEXT        NOT NULL,
  address       TEXT,
  city          TEXT,
  state         TEXT,
  zip           TEXT,
  is_active     BOOLEAN     NOT NULL DEFAULT true,
  is_default    BOOLEAN     NOT NULL DEFAULT false,
  storage_types JSONB,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.locations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can view locations"
  ON public.locations FOR SELECT TO authenticated
  USING (is_member_of(restaurant_id));

CREATE POLICY "Manager+ can insert locations"
  ON public.locations FOR INSERT TO authenticated
  WITH CHECK (has_restaurant_role_any(restaurant_id, ARRAY['OWNER'::app_role, 'MANAGER'::app_role]));

CREATE POLICY "Manager+ can update locations"
  ON public.locations FOR UPDATE TO authenticated
  USING     (has_restaurant_role_any(restaurant_id, ARRAY['OWNER'::app_role, 'MANAGER'::app_role]))
  WITH CHECK (has_restaurant_role_any(restaurant_id, ARRAY['OWNER'::app_role, 'MANAGER'::app_role]));

CREATE POLICY "Manager+ can delete locations"
  ON public.locations FOR DELETE TO authenticated
  USING (has_restaurant_role_any(restaurant_id, ARRAY['OWNER'::app_role, 'MANAGER'::app_role]));


-- ---------------------------------------------------------------------------
-- restaurant_settings
-- Per-restaurant display / operational settings (one row per restaurant).
-- ---------------------------------------------------------------------------
CREATE TABLE public.restaurant_settings (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id  UUID        NOT NULL UNIQUE REFERENCES public.restaurants(id) ON DELETE CASCADE,
  timezone       TEXT        NOT NULL DEFAULT 'America/Chicago',
  currency       TEXT        NOT NULL DEFAULT 'USD',
  date_format    TEXT        NOT NULL DEFAULT 'MM/DD/YYYY',
  logo_url       TEXT,
  address        TEXT,
  phone          TEXT,
  business_email TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.restaurant_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can view settings"
  ON public.restaurant_settings FOR SELECT TO authenticated
  USING (is_member_of(restaurant_id));

CREATE POLICY "Manager+ can insert settings"
  ON public.restaurant_settings FOR INSERT TO authenticated
  WITH CHECK (has_restaurant_role_any(restaurant_id, ARRAY['OWNER'::app_role, 'MANAGER'::app_role]));

CREATE POLICY "Manager+ can update settings"
  ON public.restaurant_settings FOR UPDATE TO authenticated
  USING     (has_restaurant_role_any(restaurant_id, ARRAY['OWNER'::app_role, 'MANAGER'::app_role]))
  WITH CHECK (has_restaurant_role_any(restaurant_id, ARRAY['OWNER'::app_role, 'MANAGER'::app_role]));

CREATE POLICY "Owner can delete settings"
  ON public.restaurant_settings FOR DELETE TO authenticated
  USING (has_restaurant_role(restaurant_id, 'OWNER'::app_role));


-- ---------------------------------------------------------------------------
-- restaurant_counters
-- Per-restaurant monotonically-increasing counters (PO sequence, etc.).
-- Direct DML is blocked; all writes go through generate_po_number().
-- ---------------------------------------------------------------------------
CREATE TABLE public.restaurant_counters (
  restaurant_id UUID   NOT NULL PRIMARY KEY REFERENCES public.restaurants(id) ON DELETE CASCADE,
  po_sequence   BIGINT NOT NULL DEFAULT 0
);

ALTER TABLE public.restaurant_counters ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can view restaurant counters"
  ON public.restaurant_counters FOR SELECT TO authenticated
  USING (is_member_of(restaurant_id));


-- ---------------------------------------------------------------------------
-- inventory_lists
-- Named lists of catalog items that staff count during inventory sessions.
-- ---------------------------------------------------------------------------
CREATE TABLE public.inventory_lists (
  id                   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id        UUID        NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  location_id          UUID        REFERENCES public.locations(id),
  name                 TEXT        NOT NULL,
  active_category_mode TEXT        NOT NULL DEFAULT 'list',
  created_by           UUID        REFERENCES auth.users(id),
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.inventory_lists ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can view inventory lists"
  ON public.inventory_lists FOR SELECT TO authenticated
  USING (is_member_of(restaurant_id));

CREATE POLICY "Members can create inventory lists"
  ON public.inventory_lists FOR INSERT TO authenticated
  WITH CHECK (is_member_of(restaurant_id));

CREATE POLICY "Manager+ can update inventory lists"
  ON public.inventory_lists FOR UPDATE TO authenticated
  USING     (has_restaurant_role_any(restaurant_id, ARRAY['OWNER'::app_role, 'MANAGER'::app_role]))
  WITH CHECK (has_restaurant_role_any(restaurant_id, ARRAY['OWNER'::app_role, 'MANAGER'::app_role]));

CREATE POLICY "Manager+ can delete inventory lists"
  ON public.inventory_lists FOR DELETE TO authenticated
  USING (has_restaurant_role_any(restaurant_id, ARRAY['OWNER'::app_role, 'MANAGER'::app_role]));


-- ---------------------------------------------------------------------------
-- list_category_sets
-- Groups of category labels that can be applied to an inventory list.
-- ---------------------------------------------------------------------------
CREATE TABLE public.list_category_sets (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  list_id    UUID        NOT NULL REFERENCES public.inventory_lists(id) ON DELETE CASCADE,
  set_type   TEXT        NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.list_category_sets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can view category sets"
  ON public.list_category_sets FOR SELECT TO authenticated
  USING (is_member_of(list_category_restaurant_id(list_id)));

CREATE POLICY "Members can create category sets"
  ON public.list_category_sets FOR INSERT TO authenticated
  WITH CHECK (is_member_of(list_category_restaurant_id(list_id)));

CREATE POLICY "Members can update category sets"
  ON public.list_category_sets FOR UPDATE TO authenticated
  USING     (is_member_of(list_category_restaurant_id(list_id)))
  WITH CHECK (is_member_of(list_category_restaurant_id(list_id)));

CREATE POLICY "Members can delete category sets"
  ON public.list_category_sets FOR DELETE TO authenticated
  USING (is_member_of(list_category_restaurant_id(list_id)));


-- ---------------------------------------------------------------------------
-- list_categories
-- Individual named categories within a list (for per-list category organisation).
-- ---------------------------------------------------------------------------
CREATE TABLE public.list_categories (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  list_id         UUID        NOT NULL REFERENCES public.inventory_lists(id) ON DELETE CASCADE,
  category_set_id UUID        REFERENCES public.list_category_sets(id) ON DELETE SET NULL,
  name            TEXT        NOT NULL,
  sort_order      INTEGER     NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.list_categories ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can view list categories"
  ON public.list_categories FOR SELECT TO authenticated
  USING (is_member_of(list_category_restaurant_id(list_id)));

CREATE POLICY "Members can create list categories"
  ON public.list_categories FOR INSERT TO authenticated
  WITH CHECK (is_member_of(list_category_restaurant_id(list_id)));

CREATE POLICY "Members can update list categories"
  ON public.list_categories FOR UPDATE TO authenticated
  USING     (is_member_of(list_category_restaurant_id(list_id)))
  WITH CHECK (is_member_of(list_category_restaurant_id(list_id)));

CREATE POLICY "Members can delete list categories"
  ON public.list_categories FOR DELETE TO authenticated
  USING (is_member_of(list_category_restaurant_id(list_id)));


-- ---------------------------------------------------------------------------
-- inventory_catalog_items
-- Master item catalog per restaurant/list. Source of truth for item metadata.
-- ---------------------------------------------------------------------------
CREATE TABLE public.inventory_catalog_items (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id     UUID        NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  inventory_list_id UUID        REFERENCES public.inventory_lists(id) ON DELETE SET NULL,
  list_category_id  UUID        REFERENCES public.list_categories(id) ON DELETE SET NULL,
  item_name         TEXT        NOT NULL,
  category          TEXT,
  unit              TEXT,
  pack_size         TEXT,
  brand_name        TEXT,
  vendor_name       TEXT,
  vendor_sku        TEXT,
  product_number    TEXT,
  default_par_level NUMERIC,
  default_unit_cost NUMERIC,
  metadata          JSONB,
  sort_order        INTEGER     NOT NULL DEFAULT 0,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.inventory_catalog_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can view catalog items"
  ON public.inventory_catalog_items FOR SELECT TO authenticated
  USING (is_member_of(restaurant_id));

CREATE POLICY "Members can create catalog items"
  ON public.inventory_catalog_items FOR INSERT TO authenticated
  WITH CHECK (is_member_of(restaurant_id));

CREATE POLICY "Members can update catalog items"
  ON public.inventory_catalog_items FOR UPDATE TO authenticated
  USING     (is_member_of(restaurant_id))
  WITH CHECK (is_member_of(restaurant_id));

CREATE POLICY "Members can delete catalog items"
  ON public.inventory_catalog_items FOR DELETE TO authenticated
  USING (is_member_of(restaurant_id));


-- ---------------------------------------------------------------------------
-- list_item_category_map
-- Many-to-many: maps catalog items to categories within a specific list/set.
-- ---------------------------------------------------------------------------
CREATE TABLE public.list_item_category_map (
  id              UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  list_id         UUID    NOT NULL REFERENCES public.inventory_lists(id) ON DELETE CASCADE,
  category_set_id UUID    NOT NULL REFERENCES public.list_category_sets(id) ON DELETE CASCADE,
  catalog_item_id UUID    NOT NULL REFERENCES public.inventory_catalog_items(id) ON DELETE CASCADE,
  category_id     UUID    REFERENCES public.list_categories(id) ON DELETE SET NULL,
  item_sort_order INTEGER NOT NULL DEFAULT 0
);

ALTER TABLE public.list_item_category_map ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can view item category map"
  ON public.list_item_category_map FOR SELECT TO authenticated
  USING (is_member_of(list_item_map_restaurant_id(list_id)));

CREATE POLICY "Members can create item category map"
  ON public.list_item_category_map FOR INSERT TO authenticated
  WITH CHECK (is_member_of(list_item_map_restaurant_id(list_id)));

CREATE POLICY "Members can update item category map"
  ON public.list_item_category_map FOR UPDATE TO authenticated
  USING     (is_member_of(list_item_map_restaurant_id(list_id)))
  WITH CHECK (is_member_of(list_item_map_restaurant_id(list_id)));

CREATE POLICY "Members can delete item category map"
  ON public.list_item_category_map FOR DELETE TO authenticated
  USING (is_member_of(list_item_map_restaurant_id(list_id)));


-- ---------------------------------------------------------------------------
-- inventory_sessions
-- A single counting event against an inventory list.
-- ---------------------------------------------------------------------------
CREATE TABLE public.inventory_sessions (
  id                UUID                  PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id     UUID                  NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  inventory_list_id UUID                  NOT NULL REFERENCES public.inventory_lists(id) ON DELETE CASCADE,
  location_id       UUID                  REFERENCES public.locations(id),
  name              TEXT                  NOT NULL,
  status            public.session_status NOT NULL DEFAULT 'IN_PROGRESS',
  created_by        UUID                  REFERENCES auth.users(id),
  approved_by       UUID                  REFERENCES auth.users(id),
  approved_at       TIMESTAMPTZ,
  updated_at        TIMESTAMPTZ           NOT NULL DEFAULT now()
);

ALTER TABLE public.inventory_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can view sessions"
  ON public.inventory_sessions FOR SELECT TO authenticated
  USING (is_member_of(restaurant_id));

CREATE POLICY "Members can create sessions"
  ON public.inventory_sessions FOR INSERT TO authenticated
  WITH CHECK (is_member_of(restaurant_id));

CREATE POLICY "Manager+ can update sessions"
  ON public.inventory_sessions FOR UPDATE TO authenticated
  USING     (has_restaurant_role_any(restaurant_id, ARRAY['OWNER'::app_role, 'MANAGER'::app_role]))
  WITH CHECK (has_restaurant_role_any(restaurant_id, ARRAY['OWNER'::app_role, 'MANAGER'::app_role]));

CREATE POLICY "Members can delete sessions"
  ON public.inventory_sessions FOR DELETE TO authenticated
  USING (is_member_of(restaurant_id));


-- ---------------------------------------------------------------------------
-- inventory_session_items
-- Line items counted in a specific inventory session.
-- ---------------------------------------------------------------------------
CREATE TABLE public.inventory_session_items (
  id              UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id      UUID    NOT NULL REFERENCES public.inventory_sessions(id) ON DELETE CASCADE,
  catalog_item_id UUID    REFERENCES public.inventory_catalog_items(id) ON DELETE SET NULL,
  item_name       TEXT    NOT NULL,
  category        TEXT,
  unit            TEXT,
  pack_size       TEXT,
  brand_name      TEXT,
  vendor_name     TEXT,
  vendor_sku      TEXT,
  current_stock   NUMERIC NOT NULL DEFAULT 0,
  par_level       NUMERIC NOT NULL DEFAULT 0,
  lead_time_days  INTEGER,
  unit_cost       NUMERIC,
  metadata        JSONB
);

ALTER TABLE public.inventory_session_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can view session items"
  ON public.inventory_session_items FOR SELECT TO authenticated
  USING (is_member_of(session_restaurant_id(session_id)));

CREATE POLICY "Members can create session items"
  ON public.inventory_session_items FOR INSERT TO authenticated
  WITH CHECK (is_member_of(session_restaurant_id(session_id)));

CREATE POLICY "Members can update session items"
  ON public.inventory_session_items FOR UPDATE TO authenticated
  USING     (is_member_of(session_restaurant_id(session_id)))
  WITH CHECK (is_member_of(session_restaurant_id(session_id)));

CREATE POLICY "Members can delete session items"
  ON public.inventory_session_items FOR DELETE TO authenticated
  USING (is_member_of(session_restaurant_id(session_id)));


-- ---------------------------------------------------------------------------
-- inventory_settings
-- Per-restaurant inventory configuration (one row per restaurant).
-- ---------------------------------------------------------------------------
CREATE TABLE public.inventory_settings (
  id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id         UUID        NOT NULL UNIQUE REFERENCES public.restaurants(id) ON DELETE CASCADE,
  default_location_id   UUID        REFERENCES public.locations(id),
  categories            JSONB       NOT NULL DEFAULT '[]',
  units                 JSONB       NOT NULL DEFAULT '[]',
  auto_category_enabled BOOLEAN     NOT NULL DEFAULT false,
  autosave_enabled      BOOLEAN     NOT NULL DEFAULT true,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.inventory_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can view inv settings"
  ON public.inventory_settings FOR SELECT TO authenticated
  USING (is_member_of(restaurant_id));

CREATE POLICY "Manager+ can insert inv settings"
  ON public.inventory_settings FOR INSERT TO authenticated
  WITH CHECK (has_restaurant_role_any(restaurant_id, ARRAY['OWNER'::app_role, 'MANAGER'::app_role]));

CREATE POLICY "Manager+ can update inv settings"
  ON public.inventory_settings FOR UPDATE TO authenticated
  USING     (has_restaurant_role_any(restaurant_id, ARRAY['OWNER'::app_role, 'MANAGER'::app_role]))
  WITH CHECK (has_restaurant_role_any(restaurant_id, ARRAY['OWNER'::app_role, 'MANAGER'::app_role]));


-- ---------------------------------------------------------------------------
-- par_guides
-- Named PAR (Par-As-Required) level reference sheets.
-- ---------------------------------------------------------------------------
CREATE TABLE public.par_guides (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id     UUID        NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  inventory_list_id UUID        REFERENCES public.inventory_lists(id),
  location_id       UUID        REFERENCES public.locations(id),
  name              TEXT        NOT NULL,
  created_by        UUID        REFERENCES auth.users(id),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.par_guides ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can view PAR guides"
  ON public.par_guides FOR SELECT TO authenticated
  USING (is_member_of(restaurant_id));

CREATE POLICY "Manager+ can create PAR guides"
  ON public.par_guides FOR INSERT TO authenticated
  WITH CHECK (has_restaurant_role_any(restaurant_id, ARRAY['OWNER'::app_role, 'MANAGER'::app_role]));

CREATE POLICY "Manager+ can update PAR guides"
  ON public.par_guides FOR UPDATE TO authenticated
  USING     (has_restaurant_role_any(restaurant_id, ARRAY['OWNER'::app_role, 'MANAGER'::app_role]))
  WITH CHECK (has_restaurant_role_any(restaurant_id, ARRAY['OWNER'::app_role, 'MANAGER'::app_role]));

CREATE POLICY "Manager+ can delete PAR guides"
  ON public.par_guides FOR DELETE TO authenticated
  USING (has_restaurant_role_any(restaurant_id, ARRAY['OWNER'::app_role, 'MANAGER'::app_role]));


-- ---------------------------------------------------------------------------
-- par_guide_items
-- Line items in a PAR guide.
-- ---------------------------------------------------------------------------
CREATE TABLE public.par_guide_items (
  id           UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  par_guide_id UUID    NOT NULL REFERENCES public.par_guides(id) ON DELETE CASCADE,
  item_name    TEXT    NOT NULL,
  category     TEXT,
  unit         TEXT,
  brand_name   TEXT,
  par_level    NUMERIC NOT NULL DEFAULT 0
);

ALTER TABLE public.par_guide_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can view PAR items"
  ON public.par_guide_items FOR SELECT TO authenticated
  USING (is_member_of(par_guide_restaurant_id(par_guide_id)));

CREATE POLICY "Manager+ can create PAR items"
  ON public.par_guide_items FOR INSERT TO authenticated
  WITH CHECK (is_member_of(par_guide_restaurant_id(par_guide_id)));

CREATE POLICY "Manager+ can update PAR items"
  ON public.par_guide_items FOR UPDATE TO authenticated
  USING     (is_member_of(par_guide_restaurant_id(par_guide_id)))
  WITH CHECK (is_member_of(par_guide_restaurant_id(par_guide_id)));

CREATE POLICY "Manager+ can delete PAR items"
  ON public.par_guide_items FOR DELETE TO authenticated
  USING (is_member_of(par_guide_restaurant_id(par_guide_id)));


-- ---------------------------------------------------------------------------
-- par_settings
-- Per-restaurant PAR calculation settings (one row per restaurant).
-- ---------------------------------------------------------------------------
CREATE TABLE public.par_settings (
  id                       UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id            UUID        NOT NULL UNIQUE REFERENCES public.restaurants(id) ON DELETE CASCADE,
  default_lead_time_days   INTEGER     NOT NULL DEFAULT 2,
  default_reorder_threshold NUMERIC    NOT NULL DEFAULT 1.0,
  auto_apply_last_par      BOOLEAN     NOT NULL DEFAULT false,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.par_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can view par settings"
  ON public.par_settings FOR SELECT TO authenticated
  USING (is_member_of(restaurant_id));

CREATE POLICY "Manager+ can insert par settings"
  ON public.par_settings FOR INSERT TO authenticated
  WITH CHECK (has_restaurant_role_any(restaurant_id, ARRAY['OWNER'::app_role, 'MANAGER'::app_role]));

CREATE POLICY "Manager+ can update par settings"
  ON public.par_settings FOR UPDATE TO authenticated
  USING     (has_restaurant_role_any(restaurant_id, ARRAY['OWNER'::app_role, 'MANAGER'::app_role]))
  WITH CHECK (has_restaurant_role_any(restaurant_id, ARRAY['OWNER'::app_role, 'MANAGER'::app_role]));


-- ---------------------------------------------------------------------------
-- categories
-- Global category tags for inventory items within a restaurant.
-- ---------------------------------------------------------------------------
CREATE TABLE public.categories (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id UUID        NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  name          TEXT        NOT NULL,
  sort_order    INTEGER     NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.categories ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can view categories"
  ON public.categories FOR SELECT TO authenticated USING (is_member_of(restaurant_id));

CREATE POLICY "Members can create categories"
  ON public.categories FOR INSERT TO authenticated WITH CHECK (is_member_of(restaurant_id));

CREATE POLICY "Members can update categories"
  ON public.categories FOR UPDATE TO authenticated
  USING     (is_member_of(restaurant_id))
  WITH CHECK (is_member_of(restaurant_id));

CREATE POLICY "Members can delete categories"
  ON public.categories FOR DELETE TO authenticated USING (is_member_of(restaurant_id));


-- ---------------------------------------------------------------------------
-- inventory_items
-- Legacy per-restaurant item records (linked to categories).
-- ---------------------------------------------------------------------------
CREATE TABLE public.inventory_items (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id UUID        NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  category_id   UUID        NOT NULL REFERENCES public.categories(id) ON DELETE RESTRICT,
  item_name     TEXT        NOT NULL,
  item_number   TEXT,
  pack_size     TEXT        NOT NULL,
  unit_price    NUMERIC     NOT NULL DEFAULT 0,
  sort_order    INTEGER     NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.inventory_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can view inventory items"
  ON public.inventory_items FOR SELECT TO authenticated USING (is_member_of(restaurant_id));

CREATE POLICY "Members can create inventory items"
  ON public.inventory_items FOR INSERT TO authenticated WITH CHECK (is_member_of(restaurant_id));

CREATE POLICY "Members can update inventory items"
  ON public.inventory_items FOR UPDATE TO authenticated
  USING     (is_member_of(restaurant_id))
  WITH CHECK (is_member_of(restaurant_id));

CREATE POLICY "Members can delete inventory items"
  ON public.inventory_items FOR DELETE TO authenticated USING (is_member_of(restaurant_id));


-- ---------------------------------------------------------------------------
-- par_items
-- PAR levels linked to legacy inventory_items + categories.
-- ---------------------------------------------------------------------------
CREATE TABLE public.par_items (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id     UUID        NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  inventory_item_id UUID        NOT NULL REFERENCES public.inventory_items(id) ON DELETE CASCADE,
  category_id       UUID        NOT NULL REFERENCES public.categories(id) ON DELETE RESTRICT,
  par_level         NUMERIC     NOT NULL DEFAULT 0,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.par_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can view par items"
  ON public.par_items FOR SELECT TO authenticated USING (is_member_of(restaurant_id));

CREATE POLICY "Members can create par items"
  ON public.par_items FOR INSERT TO authenticated WITH CHECK (is_member_of(restaurant_id));

CREATE POLICY "Members can update par items"
  ON public.par_items FOR UPDATE TO authenticated
  USING     (is_member_of(restaurant_id))
  WITH CHECK (is_member_of(restaurant_id));

CREATE POLICY "Members can delete par items"
  ON public.par_items FOR DELETE TO authenticated USING (is_member_of(restaurant_id));


-- ---------------------------------------------------------------------------
-- custom_lists
-- Ad-hoc shopping/task lists (not tied to inventory sessions).
-- ---------------------------------------------------------------------------
CREATE TABLE public.custom_lists (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id UUID        NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  name          TEXT        NOT NULL,
  categories    JSONB,
  created_by    UUID        REFERENCES auth.users(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.custom_lists ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can view custom lists"
  ON public.custom_lists FOR SELECT TO authenticated USING (is_member_of(restaurant_id));

CREATE POLICY "Members can create custom lists"
  ON public.custom_lists FOR INSERT TO authenticated WITH CHECK (is_member_of(restaurant_id));

CREATE POLICY "Members can update custom lists"
  ON public.custom_lists FOR UPDATE TO authenticated
  USING     (is_member_of(restaurant_id))
  WITH CHECK (is_member_of(restaurant_id));

CREATE POLICY "Members can delete custom lists"
  ON public.custom_lists FOR DELETE TO authenticated USING (is_member_of(restaurant_id));


-- ---------------------------------------------------------------------------
-- custom_list_items
-- Items belonging to a custom list.
-- ---------------------------------------------------------------------------
CREATE TABLE public.custom_list_items (
  id         UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  list_id    UUID    NOT NULL REFERENCES public.custom_lists(id) ON DELETE CASCADE,
  item_name  TEXT    NOT NULL,
  category   TEXT,
  quantity   NUMERIC,
  unit       TEXT,
  sort_order INTEGER
);

ALTER TABLE public.custom_list_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can view list items"
  ON public.custom_list_items FOR SELECT TO authenticated
  USING (is_member_of(custom_list_restaurant_id(list_id)));

CREATE POLICY "Members can create list items"
  ON public.custom_list_items FOR INSERT TO authenticated
  WITH CHECK (is_member_of(custom_list_restaurant_id(list_id)));

CREATE POLICY "Members can update list items"
  ON public.custom_list_items FOR UPDATE TO authenticated
  USING     (is_member_of(custom_list_restaurant_id(list_id)))
  WITH CHECK (is_member_of(custom_list_restaurant_id(list_id)));

CREATE POLICY "Members can delete list items"
  ON public.custom_list_items FOR DELETE TO authenticated
  USING (is_member_of(custom_list_restaurant_id(list_id)));


-- ---------------------------------------------------------------------------
-- import_templates
-- Saved column-mapping configurations for vendor file imports.
-- ---------------------------------------------------------------------------
CREATE TABLE public.import_templates (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id     UUID        NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  inventory_list_id UUID        REFERENCES public.inventory_lists(id) ON DELETE SET NULL,
  name              TEXT        NOT NULL,
  vendor_name       TEXT,
  file_type         TEXT,
  header_fingerprint TEXT,
  mapping_json      JSONB       NOT NULL DEFAULT '{}',
  last_used_at      TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.import_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can view import templates"
  ON public.import_templates FOR SELECT TO authenticated USING (is_member_of(restaurant_id));

CREATE POLICY "Members can create import templates"
  ON public.import_templates FOR INSERT TO authenticated WITH CHECK (is_member_of(restaurant_id));

CREATE POLICY "Members can update import templates"
  ON public.import_templates FOR UPDATE TO authenticated
  USING     (is_member_of(restaurant_id))
  WITH CHECK (is_member_of(restaurant_id));

CREATE POLICY "Members can delete import templates"
  ON public.import_templates FOR DELETE TO authenticated USING (is_member_of(restaurant_id));


-- ---------------------------------------------------------------------------
-- import_runs
-- Audit log of catalog import operations.
-- ---------------------------------------------------------------------------
CREATE TABLE public.import_runs (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id     UUID        NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  inventory_list_id UUID        REFERENCES public.inventory_lists(id) ON DELETE SET NULL,
  template_id       UUID        REFERENCES public.import_templates(id) ON DELETE SET NULL,
  file_name         TEXT        NOT NULL,
  vendor_name       TEXT,
  mapping_used_json JSONB       NOT NULL DEFAULT '{}',
  confidence_score  NUMERIC,
  created_count     INTEGER,
  updated_count     INTEGER,
  skipped_count     INTEGER,
  warnings_json     JSONB,
  uploaded_by       UUID        REFERENCES auth.users(id),
  uploaded_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.import_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can view import runs"
  ON public.import_runs FOR SELECT TO authenticated USING (is_member_of(restaurant_id));

CREATE POLICY "Members can create import runs"
  ON public.import_runs FOR INSERT TO authenticated WITH CHECK (is_member_of(restaurant_id));

CREATE POLICY "Members can delete import runs"
  ON public.import_runs FOR DELETE TO authenticated USING (is_member_of(restaurant_id));


-- ---------------------------------------------------------------------------
-- inventory_import_files
-- Tracks raw vendor files uploaded for catalog import.
-- ---------------------------------------------------------------------------
CREATE TABLE public.inventory_import_files (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id     UUID        NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  inventory_list_id UUID        NOT NULL REFERENCES public.inventory_lists(id) ON DELETE CASCADE,
  file_name         TEXT        NOT NULL,
  file_type         TEXT,
  row_count         INTEGER,
  created_count     INTEGER,
  skipped_count     INTEGER,
  mapping_json      JSONB,
  uploaded_by       UUID        REFERENCES auth.users(id),
  uploaded_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.inventory_import_files ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can view import files"
  ON public.inventory_import_files FOR SELECT TO authenticated USING (is_member_of(restaurant_id));

CREATE POLICY "Members can create import files"
  ON public.inventory_import_files FOR INSERT TO authenticated WITH CHECK (is_member_of(restaurant_id));

CREATE POLICY "Members can delete import files"
  ON public.inventory_import_files FOR DELETE TO authenticated USING (is_member_of(restaurant_id));


-- ---------------------------------------------------------------------------
-- orders
-- Restaurant orders (kitchen workflow).
-- ---------------------------------------------------------------------------
CREATE TABLE public.orders (
  id            UUID                 PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id UUID                 NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  location_id   UUID                 REFERENCES public.locations(id),
  created_by    UUID                 REFERENCES auth.users(id),
  status        public.order_status  NOT NULL DEFAULT 'PENDING',
  created_at    TIMESTAMPTZ          NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ          NOT NULL DEFAULT now()
);

ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can view orders"
  ON public.orders FOR SELECT TO authenticated USING (is_member_of(restaurant_id));

CREATE POLICY "Members can create orders"
  ON public.orders FOR INSERT TO authenticated WITH CHECK (is_member_of(restaurant_id));

CREATE POLICY "Members can update orders"
  ON public.orders FOR UPDATE TO authenticated
  USING     (is_member_of(restaurant_id))
  WITH CHECK (is_member_of(restaurant_id));

CREATE POLICY "Members can delete orders"
  ON public.orders FOR DELETE TO authenticated USING (is_member_of(restaurant_id));


-- ---------------------------------------------------------------------------
-- order_items
-- Line items belonging to an order.
-- ---------------------------------------------------------------------------
CREATE TABLE public.order_items (
  id              UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id        UUID    NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  catalog_item_id UUID    REFERENCES public.inventory_catalog_items(id) ON DELETE SET NULL,
  item_name       TEXT    NOT NULL,
  quantity        NUMERIC NOT NULL DEFAULT 0,
  unit            TEXT
);

ALTER TABLE public.order_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can view order items"
  ON public.order_items FOR SELECT TO authenticated
  USING (is_member_of(order_restaurant_id(order_id)));

CREATE POLICY "Members can create order items"
  ON public.order_items FOR INSERT TO authenticated
  WITH CHECK (is_member_of(order_restaurant_id(order_id)));

CREATE POLICY "Members can update order items"
  ON public.order_items FOR UPDATE TO authenticated
  USING     (is_member_of(order_restaurant_id(order_id)))
  WITH CHECK (is_member_of(order_restaurant_id(order_id)));

CREATE POLICY "Members can delete order items"
  ON public.order_items FOR DELETE TO authenticated
  USING (is_member_of(order_restaurant_id(order_id)));


-- ---------------------------------------------------------------------------
-- smart_order_runs
-- An AI-generated order suggestion run based on an inventory session vs PAR.
-- ---------------------------------------------------------------------------
CREATE TABLE public.smart_order_runs (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id     UUID        NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  session_id        UUID        NOT NULL REFERENCES public.inventory_sessions(id) ON DELETE CASCADE,
  inventory_list_id UUID        REFERENCES public.inventory_lists(id),
  location_id       UUID        REFERENCES public.locations(id),
  par_guide_id      UUID        REFERENCES public.par_guides(id),
  created_by        UUID        REFERENCES auth.users(id),
  po_number         TEXT        UNIQUE,
  status            TEXT,
  submitted_at      TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.smart_order_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can view smart order runs"
  ON public.smart_order_runs FOR SELECT TO authenticated USING (is_member_of(restaurant_id));

CREATE POLICY "Members can create smart order runs"
  ON public.smart_order_runs FOR INSERT TO authenticated WITH CHECK (is_member_of(restaurant_id));

CREATE POLICY "Members can delete smart order runs"
  ON public.smart_order_runs FOR DELETE TO authenticated USING (is_member_of(restaurant_id));


-- ---------------------------------------------------------------------------
-- smart_order_run_items
-- Suggested order quantities per item in a smart order run.
-- ---------------------------------------------------------------------------
CREATE TABLE public.smart_order_run_items (
  id              UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id          UUID    NOT NULL REFERENCES public.smart_order_runs(id) ON DELETE CASCADE,
  catalog_item_id UUID    REFERENCES public.inventory_catalog_items(id) ON DELETE SET NULL,
  item_name       TEXT    NOT NULL,
  suggested_order NUMERIC NOT NULL DEFAULT 0,
  risk            TEXT    NOT NULL DEFAULT 'GREEN',
  current_stock   NUMERIC NOT NULL DEFAULT 0,
  par_level       NUMERIC NOT NULL DEFAULT 0,
  pack_size       TEXT,
  unit_cost       NUMERIC,
  brand_name      TEXT
);

ALTER TABLE public.smart_order_run_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can view run items"
  ON public.smart_order_run_items FOR SELECT TO authenticated
  USING (is_member_of(smart_order_run_restaurant_id(run_id)));

CREATE POLICY "Members can create run items"
  ON public.smart_order_run_items FOR INSERT TO authenticated
  WITH CHECK (is_member_of(smart_order_run_restaurant_id(run_id)));

CREATE POLICY "Members can delete run items"
  ON public.smart_order_run_items FOR DELETE TO authenticated
  USING (is_member_of(smart_order_run_restaurant_id(run_id)));


-- ---------------------------------------------------------------------------
-- smart_order_settings
-- Per-restaurant smart order thresholds and automation settings.
-- ---------------------------------------------------------------------------
CREATE TABLE public.smart_order_settings (
  id                          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id               UUID        NOT NULL UNIQUE REFERENCES public.restaurants(id) ON DELETE CASCADE,
  red_threshold               NUMERIC     NOT NULL DEFAULT 0.25,
  yellow_threshold            NUMERIC     NOT NULL DEFAULT 0.5,
  auto_calculate_cost         BOOLEAN     NOT NULL DEFAULT true,
  auto_create_purchase_history BOOLEAN    NOT NULL DEFAULT true,
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.smart_order_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can view so settings"
  ON public.smart_order_settings FOR SELECT TO authenticated USING (is_member_of(restaurant_id));

CREATE POLICY "Manager+ can insert so settings"
  ON public.smart_order_settings FOR INSERT TO authenticated
  WITH CHECK (has_restaurant_role_any(restaurant_id, ARRAY['OWNER'::app_role, 'MANAGER'::app_role]));

CREATE POLICY "Manager+ can update so settings"
  ON public.smart_order_settings FOR UPDATE TO authenticated
  USING     (has_restaurant_role_any(restaurant_id, ARRAY['OWNER'::app_role, 'MANAGER'::app_role]))
  WITH CHECK (has_restaurant_role_any(restaurant_id, ARRAY['OWNER'::app_role, 'MANAGER'::app_role]));


-- ---------------------------------------------------------------------------
-- purchase_history
-- Invoice / PO header records linking smart orders to received invoices.
-- ---------------------------------------------------------------------------
CREATE TABLE public.purchase_history (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id       UUID        NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  inventory_list_id   UUID        REFERENCES public.inventory_lists(id),
  location_id         UUID        REFERENCES public.locations(id),
  smart_order_run_id  UUID        REFERENCES public.smart_order_runs(id),
  vendor_name         TEXT,
  invoice_number      TEXT,
  invoice_date        DATE,
  invoice_status      TEXT        NOT NULL DEFAULT 'RECEIVED',
  po_number           TEXT,
  receipt_status      TEXT        CHECK (receipt_status IN ('pending','reviewing','confirmed','issues_reported')),
  pdf_url             TEXT,
  created_by          UUID        REFERENCES auth.users(id),
  confirmed_at        TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (restaurant_id, smart_order_run_id)
);

CREATE INDEX idx_purchase_history_po_number         ON public.purchase_history (po_number);
CREATE INDEX idx_purchase_history_smart_order_run_id ON public.purchase_history (smart_order_run_id);

ALTER TABLE public.purchase_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can view purchase history"
  ON public.purchase_history FOR SELECT TO authenticated USING (is_member_of(restaurant_id));

CREATE POLICY "Manager+ can create purchase history"
  ON public.purchase_history FOR INSERT TO authenticated
  WITH CHECK (has_restaurant_role_any(restaurant_id, ARRAY['OWNER'::app_role, 'MANAGER'::app_role]));

CREATE POLICY "Manager+ can update purchase history"
  ON public.purchase_history FOR UPDATE TO authenticated
  USING     (has_restaurant_role_any(restaurant_id, ARRAY['OWNER'::app_role, 'MANAGER'::app_role]))
  WITH CHECK (has_restaurant_role_any(restaurant_id, ARRAY['OWNER'::app_role, 'MANAGER'::app_role]));

CREATE POLICY "Manager+ can delete purchase history"
  ON public.purchase_history FOR DELETE TO authenticated
  USING (has_restaurant_role_any(restaurant_id, ARRAY['OWNER'::app_role, 'MANAGER'::app_role]));


-- ---------------------------------------------------------------------------
-- purchase_history_items
-- Invoice line items matched/parsed from a vendor invoice.
-- ---------------------------------------------------------------------------
CREATE TABLE public.purchase_history_items (
  id                  UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_history_id UUID    NOT NULL REFERENCES public.purchase_history(id) ON DELETE CASCADE,
  catalog_item_id     UUID    REFERENCES public.inventory_catalog_items(id) ON DELETE SET NULL,
  item_name           TEXT    NOT NULL,
  quantity            NUMERIC NOT NULL DEFAULT 0,
  unit_cost           NUMERIC,
  total_cost          NUMERIC,
  pack_size           TEXT,
  brand_name          TEXT,
  vendor_sku          TEXT,
  match_status        TEXT    NOT NULL DEFAULT 'unmatched'
);

ALTER TABLE public.purchase_history_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can view purchase history items"
  ON public.purchase_history_items FOR SELECT TO authenticated
  USING (is_member_of(purchase_history_restaurant_id(purchase_history_id)));

CREATE POLICY "Manager+ can create purchase history items"
  ON public.purchase_history_items FOR INSERT TO authenticated
  WITH CHECK (is_member_of(purchase_history_restaurant_id(purchase_history_id)));

CREATE POLICY "Manager+ can delete purchase history items"
  ON public.purchase_history_items FOR DELETE TO authenticated
  USING (is_member_of(purchase_history_restaurant_id(purchase_history_id)));


-- ---------------------------------------------------------------------------
-- invoice_line_comparisons
-- Line-by-line diff between a submitted smart order (PO) and the actual invoice.
-- qty_diff and cost_diff are STORED generated columns.
-- ---------------------------------------------------------------------------
CREATE TABLE public.invoice_line_comparisons (
  id                       UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_history_id      UUID    NOT NULL REFERENCES public.purchase_history(id) ON DELETE CASCADE,
  purchase_history_item_id UUID    REFERENCES public.purchase_history_items(id) ON DELETE SET NULL,
  smart_order_run_id       UUID    REFERENCES public.smart_order_runs(id) ON DELETE SET NULL,
  catalog_item_id          UUID    REFERENCES public.inventory_catalog_items(id) ON DELETE SET NULL,
  item_name                TEXT    NOT NULL,
  po_qty                   NUMERIC,
  po_unit_cost             NUMERIC,
  po_total_cost            NUMERIC,
  invoiced_qty             NUMERIC,
  invoiced_unit_cost       NUMERIC,
  invoiced_total_cost      NUMERIC,
  qty_diff   NUMERIC GENERATED ALWAYS AS (invoiced_qty - po_qty) STORED,
  cost_diff  NUMERIC GENERATED ALWAYS AS (invoiced_unit_cost - po_unit_cost) STORED,
  total_diff NUMERIC GENERATED ALWAYS AS (invoiced_total_cost - po_total_cost) STORED,
  status     TEXT    NOT NULL DEFAULT 'ok'
             CHECK (status IN ('ok','qty_mismatch','price_mismatch','missing_from_invoice','extra_on_invoice','unmatched')),
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_invoice_line_comparisons_purchase_history_id
  ON public.invoice_line_comparisons (purchase_history_id);

ALTER TABLE public.invoice_line_comparisons ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can view invoice line comparisons"
  ON public.invoice_line_comparisons FOR SELECT TO authenticated
  USING (is_member_of(purchase_history_restaurant_id(purchase_history_id)));

CREATE POLICY "Members can create invoice line comparisons"
  ON public.invoice_line_comparisons FOR INSERT TO authenticated
  WITH CHECK (is_member_of(purchase_history_restaurant_id(purchase_history_id)));

CREATE POLICY "Members can update invoice line comparisons"
  ON public.invoice_line_comparisons FOR UPDATE TO authenticated
  USING     (is_member_of(purchase_history_restaurant_id(purchase_history_id)))
  WITH CHECK (is_member_of(purchase_history_restaurant_id(purchase_history_id)));

CREATE POLICY "Members can delete invoice line comparisons"
  ON public.invoice_line_comparisons FOR DELETE TO authenticated
  USING (is_member_of(purchase_history_restaurant_id(purchase_history_id)));


-- ---------------------------------------------------------------------------
-- delivery_issues
-- User-reported problems found during receipt/invoice review.
-- ---------------------------------------------------------------------------
CREATE TABLE public.delivery_issues (
  id                         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_history_id        UUID        NOT NULL REFERENCES public.purchase_history(id) ON DELETE CASCADE,
  invoice_line_comparison_id UUID        REFERENCES public.invoice_line_comparisons(id) ON DELETE SET NULL,
  catalog_item_id            UUID        REFERENCES public.inventory_catalog_items(id) ON DELETE SET NULL,
  restaurant_id              UUID        REFERENCES public.restaurants(id),
  item_name                  TEXT        NOT NULL,
  issue_type                 TEXT        NOT NULL
                             CHECK (issue_type IN ('short_shipped','damaged','wrong_item','price_discrepancy','other')),
  notes                      TEXT,
  reported_by                UUID        REFERENCES auth.users(id),
  reported_at                TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_delivery_issues_purchase_history_id
  ON public.delivery_issues (purchase_history_id);

ALTER TABLE public.delivery_issues ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can view delivery issues"
  ON public.delivery_issues FOR SELECT TO authenticated
  USING (is_member_of(purchase_history_restaurant_id(purchase_history_id)));

CREATE POLICY "Members can create delivery issues"
  ON public.delivery_issues FOR INSERT TO authenticated
  WITH CHECK (is_member_of(purchase_history_restaurant_id(purchase_history_id)));

CREATE POLICY "Members can update delivery issues"
  ON public.delivery_issues FOR UPDATE TO authenticated
  USING     (is_member_of(purchase_history_restaurant_id(purchase_history_id)))
  WITH CHECK (is_member_of(purchase_history_restaurant_id(purchase_history_id)));

CREATE POLICY "Members can delete delivery issues"
  ON public.delivery_issues FOR DELETE TO authenticated
  USING (is_member_of(purchase_history_restaurant_id(purchase_history_id)));


-- ---------------------------------------------------------------------------
-- vendor_item_mappings
-- Learned dictionary: vendor invoice line name → catalog item.
-- ---------------------------------------------------------------------------
CREATE TABLE public.vendor_item_mappings (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id    UUID        NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  catalog_item_id  UUID        NOT NULL REFERENCES public.inventory_catalog_items(id) ON DELETE CASCADE,
  vendor_name      TEXT        NOT NULL,
  vendor_item_name TEXT        NOT NULL,
  vendor_sku       TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (restaurant_id, vendor_name, vendor_item_name)
);

CREATE UNIQUE INDEX uq_vendor_item_mappings_sku
  ON public.vendor_item_mappings (restaurant_id, vendor_name, vendor_sku)
  WHERE vendor_sku IS NOT NULL;

CREATE INDEX idx_vendor_item_mappings_restaurant_vendor
  ON public.vendor_item_mappings (restaurant_id, vendor_name);

ALTER TABLE public.vendor_item_mappings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can view vendor item mappings"
  ON public.vendor_item_mappings FOR SELECT TO authenticated USING (is_member_of(restaurant_id));

CREATE POLICY "Members can create vendor item mappings"
  ON public.vendor_item_mappings FOR INSERT TO authenticated WITH CHECK (is_member_of(restaurant_id));

CREATE POLICY "Members can update vendor item mappings"
  ON public.vendor_item_mappings FOR UPDATE TO authenticated
  USING     (is_member_of(restaurant_id))
  WITH CHECK (is_member_of(restaurant_id));

CREATE POLICY "Members can delete vendor item mappings"
  ON public.vendor_item_mappings FOR DELETE TO authenticated USING (is_member_of(restaurant_id));


-- ---------------------------------------------------------------------------
-- usage_events
-- Tracks item consumption (linked to kitchen orders).
-- ---------------------------------------------------------------------------
CREATE TABLE public.usage_events (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id UUID        NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  order_id      UUID        REFERENCES public.orders(id),
  item_name     TEXT        NOT NULL,
  quantity_used NUMERIC     NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.usage_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can view usage events"
  ON public.usage_events FOR SELECT TO authenticated USING (is_member_of(restaurant_id));

CREATE POLICY "Members can create usage events"
  ON public.usage_events FOR INSERT TO authenticated WITH CHECK (is_member_of(restaurant_id));

CREATE POLICY "Members can delete usage events"
  ON public.usage_events FOR DELETE TO authenticated USING (is_member_of(restaurant_id));


-- ---------------------------------------------------------------------------
-- waste_log
-- Tracks food/inventory waste events.
-- ---------------------------------------------------------------------------
CREATE TABLE public.waste_log (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id   UUID        NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  catalog_item_id UUID        REFERENCES public.inventory_catalog_items(id),
  item_name       TEXT        NOT NULL,
  quantity        NUMERIC     NOT NULL CHECK (quantity > 0),
  unit_cost       NUMERIC,
  total_cost      NUMERIC,
  reason          TEXT        NOT NULL,
  notes           TEXT,
  logged_by       UUID        NOT NULL REFERENCES auth.users(id),
  logged_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX waste_log_restaurant_logged_at
  ON public.waste_log (restaurant_id, logged_at DESC);

ALTER TABLE public.waste_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "waste_log_read"
  ON public.waste_log FOR SELECT TO authenticated USING (is_member_of(restaurant_id));

CREATE POLICY "waste_log_insert"
  ON public.waste_log FOR INSERT TO authenticated
  WITH CHECK (is_member_of(restaurant_id) AND logged_by = auth.uid());

CREATE POLICY "waste_log_delete"
  ON public.waste_log FOR DELETE TO authenticated
  USING (has_restaurant_role_any(restaurant_id, ARRAY['OWNER'::app_role, 'MANAGER'::app_role]));


-- ---------------------------------------------------------------------------
-- notifications
-- In-app notification inbox per user.
-- ---------------------------------------------------------------------------
CREATE TABLE public.notifications (
  id            UUID                        PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id UUID                        NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  location_id   UUID                        REFERENCES public.locations(id),
  user_id       UUID                        NOT NULL,
  type          TEXT                        NOT NULL,
  title         TEXT                        NOT NULL,
  message       TEXT                        NOT NULL,
  severity      public.notification_severity NOT NULL DEFAULT 'INFO',
  data          JSONB,
  read_at       TIMESTAMPTZ,
  emailed_at    TIMESTAMPTZ,
  created_at    TIMESTAMPTZ                 NOT NULL DEFAULT now()
);

-- Prevents duplicate DELIVERY_ISSUE notifications per (user, PO).
CREATE UNIQUE INDEX uq_notifications_delivery_issue_per_user
  ON public.notifications (user_id, (data->>'purchase_history_id'))
  WHERE type = 'DELIVERY_ISSUE';

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own notifications"
  ON public.notifications FOR SELECT TO authenticated USING (auth.uid() = user_id);

CREATE POLICY "Members can create notifications"
  ON public.notifications FOR INSERT TO authenticated WITH CHECK (is_member_of(restaurant_id));

CREATE POLICY "Users can update own notifications"
  ON public.notifications FOR UPDATE TO authenticated
  USING     (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);


-- ---------------------------------------------------------------------------
-- notification_preferences
-- Per-restaurant / per-user notification channel and digest settings.
-- ---------------------------------------------------------------------------
CREATE TABLE public.notification_preferences (
  id                UUID                        PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id     UUID                        NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  location_id       UUID                        REFERENCES public.locations(id),
  user_id           UUID,
  channel_in_app    BOOLEAN                     NOT NULL DEFAULT true,
  channel_email     BOOLEAN                     NOT NULL DEFAULT false,
  low_stock_yellow  BOOLEAN                     NOT NULL DEFAULT true,
  low_stock_red     BOOLEAN                     NOT NULL DEFAULT true,
  email_digest_mode public.email_digest_mode    NOT NULL DEFAULT 'IMMEDIATE',
  recipients_mode   public.recipients_mode      NOT NULL DEFAULT 'OWNERS_MANAGERS',
  digest_hour       INTEGER                     NOT NULL DEFAULT 8,
  timezone          TEXT                        NOT NULL DEFAULT 'America/Chicago',
  created_at        TIMESTAMPTZ                 NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ                 NOT NULL DEFAULT now()
);

ALTER TABLE public.notification_preferences ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can view notification prefs"
  ON public.notification_preferences FOR SELECT TO authenticated USING (is_member_of(restaurant_id));

CREATE POLICY "Members can insert notification prefs"
  ON public.notification_preferences FOR INSERT TO authenticated WITH CHECK (is_member_of(restaurant_id));

CREATE POLICY "Members can update notification prefs"
  ON public.notification_preferences FOR UPDATE TO authenticated
  USING     (is_member_of(restaurant_id))
  WITH CHECK (is_member_of(restaurant_id));


-- ---------------------------------------------------------------------------
-- alert_recipients
-- Users who receive alerts for a notification preference.
-- ---------------------------------------------------------------------------
CREATE TABLE public.alert_recipients (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  notification_pref_id UUID NOT NULL REFERENCES public.notification_preferences(id) ON DELETE CASCADE,
  user_id              UUID NOT NULL
);

ALTER TABLE public.alert_recipients ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can view alert recipients"
  ON public.alert_recipients FOR SELECT TO authenticated
  USING (is_member_of(alert_pref_restaurant_id(notification_pref_id)));

CREATE POLICY "Members can insert alert recipients"
  ON public.alert_recipients FOR INSERT TO authenticated
  WITH CHECK (is_member_of(alert_pref_restaurant_id(notification_pref_id)));

CREATE POLICY "Members can delete alert recipients"
  ON public.alert_recipients FOR DELETE TO authenticated
  USING (is_member_of(alert_pref_restaurant_id(notification_pref_id)));


-- ---------------------------------------------------------------------------
-- reminders
-- Scheduled inventory reminder configurations.
-- ---------------------------------------------------------------------------
CREATE TABLE public.reminders (
  id                    UUID                   PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id         UUID                   NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  inventory_list_id     UUID                   REFERENCES public.inventory_lists(id),
  location_id           UUID                   REFERENCES public.locations(id),
  name                  TEXT                   NOT NULL,
  days_of_week          JSONB                  NOT NULL DEFAULT '[]',
  time_of_day           TIME                   NOT NULL DEFAULT '08:00',
  timezone              TEXT                   NOT NULL DEFAULT 'America/Chicago',
  recipients_mode       public.recipients_mode NOT NULL DEFAULT 'OWNERS_MANAGERS',
  reminder_lead_minutes INTEGER                NOT NULL DEFAULT 30,
  lock_after_hours      NUMERIC,
  auto_create_session   BOOLEAN                NOT NULL DEFAULT false,
  is_enabled            BOOLEAN                NOT NULL DEFAULT true,
  created_by            UUID                   REFERENCES auth.users(id),
  created_at            TIMESTAMPTZ            NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ            NOT NULL DEFAULT now()
);

ALTER TABLE public.reminders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Manager+ can view reminders"
  ON public.reminders FOR SELECT TO authenticated USING (is_member_of(restaurant_id));

CREATE POLICY "Manager+ can create reminders"
  ON public.reminders FOR INSERT TO authenticated
  WITH CHECK (has_restaurant_role_any(restaurant_id, ARRAY['OWNER'::app_role, 'MANAGER'::app_role]));

CREATE POLICY "Manager+ can update reminders"
  ON public.reminders FOR UPDATE TO authenticated
  USING     (has_restaurant_role_any(restaurant_id, ARRAY['OWNER'::app_role, 'MANAGER'::app_role]))
  WITH CHECK (has_restaurant_role_any(restaurant_id, ARRAY['OWNER'::app_role, 'MANAGER'::app_role]));

CREATE POLICY "Manager+ can delete reminders"
  ON public.reminders FOR DELETE TO authenticated
  USING (has_restaurant_role_any(restaurant_id, ARRAY['OWNER'::app_role, 'MANAGER'::app_role]));


-- ---------------------------------------------------------------------------
-- reminder_targets
-- Users targeted by a specific reminder.
-- ---------------------------------------------------------------------------
CREATE TABLE public.reminder_targets (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reminder_id UUID NOT NULL REFERENCES public.reminders(id) ON DELETE CASCADE,
  user_id     UUID NOT NULL
);

ALTER TABLE public.reminder_targets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can view reminder targets"
  ON public.reminder_targets FOR SELECT TO authenticated
  USING (is_member_of(reminder_restaurant_id(reminder_id)));

CREATE POLICY "Manager+ can create reminder targets"
  ON public.reminder_targets FOR INSERT TO authenticated
  WITH CHECK (is_member_of(reminder_restaurant_id(reminder_id)));

CREATE POLICY "Manager+ can delete reminder targets"
  ON public.reminder_targets FOR DELETE TO authenticated
  USING (is_member_of(reminder_restaurant_id(reminder_id)));


-- ---------------------------------------------------------------------------
-- invitations
-- Email-based invitations to join a restaurant.
-- ---------------------------------------------------------------------------
CREATE TABLE public.invitations (
  id            UUID                      PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id UUID                      NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  email         TEXT                      NOT NULL,
  role          public.app_role           NOT NULL DEFAULT 'STAFF',
  status        public.invitation_status  NOT NULL DEFAULT 'PENDING',
  token         TEXT                      NOT NULL DEFAULT gen_random_uuid()::TEXT,
  invited_by    UUID                      NOT NULL,
  expires_at    TIMESTAMPTZ               NOT NULL DEFAULT (now() + INTERVAL '7 days'),
  accepted_at   TIMESTAMPTZ,
  created_at    TIMESTAMPTZ               NOT NULL DEFAULT now()
);

ALTER TABLE public.invitations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can view invitations"
  ON public.invitations FOR SELECT TO authenticated USING (is_member_of(restaurant_id));

CREATE POLICY "Owners can insert invitations"
  ON public.invitations FOR INSERT TO authenticated
  WITH CHECK (has_restaurant_role(restaurant_id, 'OWNER'::app_role));

CREATE POLICY "Owners can update invitations"
  ON public.invitations FOR UPDATE TO authenticated
  USING     (has_restaurant_role(restaurant_id, 'OWNER'::app_role))
  WITH CHECK (has_restaurant_role(restaurant_id, 'OWNER'::app_role));

CREATE POLICY "Owners can delete invitations"
  ON public.invitations FOR DELETE TO authenticated
  USING (has_restaurant_role(restaurant_id, 'OWNER'::app_role));


-- ---------------------------------------------------------------------------
-- user_ui_state
-- Per-user client-side UI state (selected restaurant, location, etc.).
-- ---------------------------------------------------------------------------
CREATE TABLE public.user_ui_state (
  id                     UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                UUID        NOT NULL,
  selected_restaurant_id UUID        REFERENCES public.restaurants(id),
  selected_location_id   UUID        REFERENCES public.locations(id),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.user_ui_state ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own ui state"
  ON public.user_ui_state FOR SELECT TO authenticated USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own ui state"
  ON public.user_ui_state FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own ui state"
  ON public.user_ui_state FOR UPDATE TO authenticated
  USING     (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);


-- ---------------------------------------------------------------------------
-- vendor_integrations
-- Vendor API credentials and integration config.
-- ---------------------------------------------------------------------------
CREATE TABLE public.vendor_integrations (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id     UUID        NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  location_id       UUID        REFERENCES public.locations(id),
  vendor_name       TEXT        NOT NULL,
  is_enabled        BOOLEAN     NOT NULL DEFAULT false,
  api_key_encrypted TEXT,
  account_id        TEXT,
  customer_number   TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.vendor_integrations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can view vendor integrations"
  ON public.vendor_integrations FOR SELECT TO authenticated USING (is_member_of(restaurant_id));

CREATE POLICY "Manager+ can create vendor integrations"
  ON public.vendor_integrations FOR INSERT TO authenticated
  WITH CHECK (has_restaurant_role_any(restaurant_id, ARRAY['OWNER'::app_role, 'MANAGER'::app_role]));

CREATE POLICY "Manager+ can update vendor integrations"
  ON public.vendor_integrations FOR UPDATE TO authenticated
  USING     (has_restaurant_role_any(restaurant_id, ARRAY['OWNER'::app_role, 'MANAGER'::app_role]))
  WITH CHECK (has_restaurant_role_any(restaurant_id, ARRAY['OWNER'::app_role, 'MANAGER'::app_role]));

CREATE POLICY "Manager+ can delete vendor integrations"
  ON public.vendor_integrations FOR DELETE TO authenticated
  USING (has_restaurant_role_any(restaurant_id, ARRAY['OWNER'::app_role, 'MANAGER'::app_role]));


-- =============================================================================
-- TRIGGERS
-- =============================================================================

-- Auto-create profile row when a new user signs up.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name)
  VALUES (NEW.id, NEW.email, COALESCE(NEW.raw_user_meta_data->>'full_name', ''));
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();


-- =============================================================================
-- STORED FUNCTIONS / RPCs
-- =============================================================================

-- Creates a new restaurant and assigns the calling user as OWNER atomically.
CREATE OR REPLACE FUNCTION public.create_restaurant_with_owner(
  p_name    TEXT,
  p_is_demo BOOLEAN DEFAULT false
)
RETURNS SETOF public.restaurants
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_restaurant public.restaurants;
BEGIN
  INSERT INTO public.restaurants (name) VALUES (p_name) RETURNING * INTO v_restaurant;
  INSERT INTO public.restaurant_members (restaurant_id, user_id, role)
    VALUES (v_restaurant.id, auth.uid(), 'OWNER');
  RETURN NEXT v_restaurant;
END;
$$;

-- Cascades deletion of a restaurant and all its data.
CREATE OR REPLACE FUNCTION public.delete_restaurant_cascade(p_restaurant_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT has_restaurant_role(p_restaurant_id, 'OWNER') THEN
    RAISE EXCEPTION 'Access denied';
  END IF;
  DELETE FROM public.restaurants WHERE id = p_restaurant_id;
END;
$$;

-- Atomically increments the PO sequence and returns a formatted PO number.
-- Format: PO-YYYYMMDD-NNNN
CREATE OR REPLACE FUNCTION public.generate_po_number(p_restaurant_id UUID)
RETURNS TEXT LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_seq BIGINT;
BEGIN
  INSERT INTO public.restaurant_counters (restaurant_id, po_sequence) VALUES (p_restaurant_id, 1)
  ON CONFLICT (restaurant_id)
  DO UPDATE SET po_sequence = restaurant_counters.po_sequence + 1
  RETURNING po_sequence INTO v_seq;
  RETURN 'PO-' || to_char(now(), 'YYYYMMDD') || '-' || lpad(v_seq::TEXT, 4, '0');
END;
$$;

-- Submits a smart order run, generates a PO number, and upserts purchase_history.
-- Returns: { purchase_history_id, po_number }
CREATE OR REPLACE FUNCTION public.submit_smart_order(p_run_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
-- (see migration 20260306000005_po_number_generation.sql for full body)
$$ LANGUAGE plpgsql;

-- Confirms receipt of an invoice, updating receipt_status and confirmed_at.
-- Returns: { success, purchase_history_id }
CREATE OR REPLACE FUNCTION public.confirm_invoice_receipt(
  p_invoice_id    UUID,
  p_restaurant_id UUID
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
-- (see migration 20260305000002_confirm_receipt_and_po_sync.sql for full body)
$$ LANGUAGE plpgsql;

-- Inserts DELIVERY_ISSUE notifications for OWNER/MANAGER members.
-- Idempotent via ON CONFLICT DO NOTHING.
-- Returns: { notified, missing_count, partial_count, price_mismatch_count }
CREATE OR REPLACE FUNCTION public.notify_delivery_issues(p_purchase_history_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
-- (see migration 20260307000001_delivery_issue_notifications.sql for full body)
$$ LANGUAGE plpgsql;

-- Returns unresolved delivery issue POs for a restaurant.
-- Returns TABLE(purchase_history_id, po_number, issue_count)
CREATE OR REPLACE FUNCTION public.get_delivery_issue_pos(p_restaurant_id UUID)
RETURNS TABLE (purchase_history_id UUID, po_number TEXT, issue_count BIGINT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
-- (see migration 20260307000001_delivery_issue_notifications.sql for full body)
$$ LANGUAGE plpgsql;


-- =============================================================================
-- FOREIGN KEY SUMMARY
-- =============================================================================
--
-- profiles.id                              → auth.users(id)
-- restaurant_members.restaurant_id         → restaurants(id)
-- restaurant_members.user_id               → auth.users(id)
-- restaurant_members.default_location_id   → locations(id)
-- restaurant_settings.restaurant_id        → restaurants(id)   [UNIQUE]
-- restaurant_counters.restaurant_id        → restaurants(id)   [PK]
-- locations.restaurant_id                  → restaurants(id)
-- inventory_lists.restaurant_id            → restaurants(id)
-- inventory_lists.location_id              → locations(id)
-- list_category_sets.list_id               → inventory_lists(id)
-- list_categories.list_id                  → inventory_lists(id)
-- list_categories.category_set_id          → list_category_sets(id)
-- inventory_catalog_items.restaurant_id    → restaurants(id)
-- inventory_catalog_items.inventory_list_id → inventory_lists(id)
-- inventory_catalog_items.list_category_id → list_categories(id)
-- list_item_category_map.list_id           → inventory_lists(id)
-- list_item_category_map.category_set_id   → list_category_sets(id)
-- list_item_category_map.catalog_item_id   → inventory_catalog_items(id)
-- list_item_category_map.category_id       → list_categories(id)
-- inventory_sessions.restaurant_id         → restaurants(id)
-- inventory_sessions.inventory_list_id     → inventory_lists(id)
-- inventory_sessions.location_id           → locations(id)
-- inventory_session_items.session_id       → inventory_sessions(id)
-- inventory_session_items.catalog_item_id  → inventory_catalog_items(id)
-- inventory_settings.restaurant_id         → restaurants(id)   [UNIQUE]
-- inventory_settings.default_location_id   → locations(id)
-- par_guides.restaurant_id                 → restaurants(id)
-- par_guides.inventory_list_id             → inventory_lists(id)
-- par_guides.location_id                   → locations(id)
-- par_guide_items.par_guide_id             → par_guides(id)
-- par_settings.restaurant_id               → restaurants(id)   [UNIQUE]
-- categories.restaurant_id                 → restaurants(id)
-- inventory_items.restaurant_id            → restaurants(id)
-- inventory_items.category_id              → categories(id)
-- par_items.restaurant_id                  → restaurants(id)
-- par_items.inventory_item_id              → inventory_items(id)
-- par_items.category_id                    → categories(id)
-- custom_lists.restaurant_id               → restaurants(id)
-- custom_list_items.list_id                → custom_lists(id)
-- import_templates.restaurant_id           → restaurants(id)
-- import_templates.inventory_list_id       → inventory_lists(id)
-- import_runs.restaurant_id                → restaurants(id)
-- import_runs.inventory_list_id            → inventory_lists(id)
-- import_runs.template_id                  → import_templates(id)
-- inventory_import_files.restaurant_id     → restaurants(id)
-- inventory_import_files.inventory_list_id → inventory_lists(id)
-- orders.restaurant_id                     → restaurants(id)
-- orders.location_id                       → locations(id)
-- order_items.order_id                     → orders(id)
-- order_items.catalog_item_id              → inventory_catalog_items(id)
-- smart_order_runs.restaurant_id           → restaurants(id)
-- smart_order_runs.session_id              → inventory_sessions(id)
-- smart_order_runs.inventory_list_id       → inventory_lists(id)
-- smart_order_runs.location_id             → locations(id)
-- smart_order_runs.par_guide_id            → par_guides(id)
-- smart_order_run_items.run_id             → smart_order_runs(id)
-- smart_order_run_items.catalog_item_id    → inventory_catalog_items(id)
-- smart_order_settings.restaurant_id       → restaurants(id)   [UNIQUE]
-- purchase_history.restaurant_id           → restaurants(id)
-- purchase_history.inventory_list_id       → inventory_lists(id)
-- purchase_history.location_id             → locations(id)
-- purchase_history.smart_order_run_id      → smart_order_runs(id)
-- purchase_history_items.purchase_history_id → purchase_history(id)
-- purchase_history_items.catalog_item_id   → inventory_catalog_items(id)
-- invoice_line_comparisons.purchase_history_id      → purchase_history(id)
-- invoice_line_comparisons.purchase_history_item_id → purchase_history_items(id)
-- invoice_line_comparisons.smart_order_run_id       → smart_order_runs(id)
-- invoice_line_comparisons.catalog_item_id          → inventory_catalog_items(id)
-- delivery_issues.purchase_history_id               → purchase_history(id)
-- delivery_issues.invoice_line_comparison_id        → invoice_line_comparisons(id)
-- delivery_issues.catalog_item_id                   → inventory_catalog_items(id)
-- delivery_issues.restaurant_id                     → restaurants(id)
-- vendor_item_mappings.restaurant_id                → restaurants(id)
-- vendor_item_mappings.catalog_item_id              → inventory_catalog_items(id)
-- usage_events.restaurant_id                        → restaurants(id)
-- usage_events.order_id                             → orders(id)
-- waste_log.restaurant_id                           → restaurants(id)
-- waste_log.catalog_item_id                         → inventory_catalog_items(id)
-- notifications.restaurant_id                       → restaurants(id)
-- notifications.location_id                         → locations(id)
-- notification_preferences.restaurant_id            → restaurants(id)
-- notification_preferences.location_id              → locations(id)
-- alert_recipients.notification_pref_id             → notification_preferences(id)
-- reminders.restaurant_id                           → restaurants(id)
-- reminders.inventory_list_id                       → inventory_lists(id)
-- reminders.location_id                             → locations(id)
-- reminder_targets.reminder_id                      → reminders(id)
-- invitations.restaurant_id                         → restaurants(id)
-- user_ui_state.selected_restaurant_id              → restaurants(id)
-- user_ui_state.selected_location_id                → locations(id)
-- vendor_integrations.restaurant_id                 → restaurants(id)
-- vendor_integrations.location_id                   → locations(id)
