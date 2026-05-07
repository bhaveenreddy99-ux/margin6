-- Zone-level count lines for inventory session items (MVP: list_categories as zones).
-- Parent row inventory_session_items.current_stock remains the single item-level total
-- in the planning unit (e.g. cases) when downstream features read stock.
--
-- IF NOT EXISTS / DROP policy: idempotent for partial db push retries.

CREATE TABLE IF NOT EXISTS public.inventory_session_item_zones (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_item_id uuid NOT NULL REFERENCES public.inventory_session_items(id) ON DELETE CASCADE,
  list_category_id uuid NOT NULL REFERENCES public.list_categories(id) ON DELETE CASCADE,
  entered_qty numeric NOT NULL DEFAULT 0,
  entered_unit text NOT NULL,
  normalized_qty numeric NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT inventory_session_item_zones_qty_non_negative CHECK (entered_qty >= 0),
  CONSTRAINT inventory_session_item_zones_normalized_non_negative CHECK (normalized_qty >= 0),
  CONSTRAINT inventory_session_item_zones_unique_session_category UNIQUE (session_item_id, list_category_id)
);

CREATE INDEX IF NOT EXISTS idx_inventory_session_item_zones_session_item_id
  ON public.inventory_session_item_zones(session_item_id);

CREATE INDEX IF NOT EXISTS idx_inventory_session_item_zones_list_category_id
  ON public.inventory_session_item_zones(list_category_id);

-- RLS: same restaurant membership as parent session item.
CREATE OR REPLACE FUNCTION public.session_item_restaurant_id(p_session_item_id uuid)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT s.restaurant_id
  FROM public.inventory_session_items isi
  JOIN public.inventory_sessions s ON s.id = isi.session_id
  WHERE isi.id = p_session_item_id
$$;

ALTER TABLE public.inventory_session_item_zones ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Members can view session item zones" ON public.inventory_session_item_zones;
CREATE POLICY "Members can view session item zones"
  ON public.inventory_session_item_zones FOR SELECT TO authenticated
  USING (is_member_of(session_item_restaurant_id(session_item_id)));

DROP POLICY IF EXISTS "Members can create session item zones" ON public.inventory_session_item_zones;
CREATE POLICY "Members can create session item zones"
  ON public.inventory_session_item_zones FOR INSERT TO authenticated
  WITH CHECK (is_member_of(session_item_restaurant_id(session_item_id)));

DROP POLICY IF EXISTS "Members can update session item zones" ON public.inventory_session_item_zones;
CREATE POLICY "Members can update session item zones"
  ON public.inventory_session_item_zones FOR UPDATE TO authenticated
  USING     (is_member_of(session_item_restaurant_id(session_item_id)))
  WITH CHECK (is_member_of(session_item_restaurant_id(session_item_id)));

DROP POLICY IF EXISTS "Members can delete session item zones" ON public.inventory_session_item_zones;
CREATE POLICY "Members can delete session item zones"
  ON public.inventory_session_item_zones FOR DELETE TO authenticated
  USING (is_member_of(session_item_restaurant_id(session_item_id)));
