
-- 1) Category sets table: stores one row per (list, mode) combination
CREATE TABLE public.list_category_sets (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  list_id uuid NOT NULL REFERENCES public.inventory_lists(id) ON DELETE CASCADE,
  set_type text NOT NULL CHECK (set_type IN ('custom_ai', 'user_manual')),
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  UNIQUE(list_id, set_type)
);

ALTER TABLE public.list_category_sets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can view category sets"
  ON public.list_category_sets FOR SELECT
  USING (is_member_of(list_category_restaurant_id(list_id)));

CREATE POLICY "Members can create category sets"
  ON public.list_category_sets FOR INSERT
  WITH CHECK (is_member_of(list_category_restaurant_id(list_id)));

CREATE POLICY "Members can update category sets"
  ON public.list_category_sets FOR UPDATE
  USING (is_member_of(list_category_restaurant_id(list_id)));

CREATE POLICY "Members can delete category sets"
  ON public.list_category_sets FOR DELETE
  USING (is_member_of(list_category_restaurant_id(list_id)));

-- 2) Add category_set_id to list_categories
ALTER TABLE public.list_categories
  ADD COLUMN category_set_id uuid REFERENCES public.list_category_sets(id) ON DELETE CASCADE;

-- 3) Item-category mapping table: stores per-set assignments
CREATE TABLE public.list_item_category_map (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  list_id uuid NOT NULL REFERENCES public.inventory_lists(id) ON DELETE CASCADE,
  category_set_id uuid NOT NULL REFERENCES public.list_category_sets(id) ON DELETE CASCADE,
  catalog_item_id uuid NOT NULL REFERENCES public.inventory_catalog_items(id) ON DELETE CASCADE,
  category_id uuid REFERENCES public.list_categories(id) ON DELETE SET NULL,
  item_sort_order integer NOT NULL DEFAULT 0
);

ALTER TABLE public.list_item_category_map ENABLE ROW LEVEL SECURITY;

-- Helper function for RLS
CREATE OR REPLACE FUNCTION public.list_item_map_restaurant_id(p_list_id uuid)
  RETURNS uuid
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$ SELECT restaurant_id FROM public.inventory_lists WHERE id = p_list_id $$;

CREATE POLICY "Members can view item category map"
  ON public.list_item_category_map FOR SELECT
  USING (is_member_of(list_item_map_restaurant_id(list_id)));

CREATE POLICY "Members can create item category map"
  ON public.list_item_category_map FOR INSERT
  WITH CHECK (is_member_of(list_item_map_restaurant_id(list_id)));

CREATE POLICY "Members can update item category map"
  ON public.list_item_category_map FOR UPDATE
  USING (is_member_of(list_item_map_restaurant_id(list_id)));

CREATE POLICY "Members can delete item category map"
  ON public.list_item_category_map FOR DELETE
  USING (is_member_of(list_item_map_restaurant_id(list_id)));

-- Unique constraint: one mapping per item per category set
CREATE UNIQUE INDEX idx_list_item_category_map_unique
  ON public.list_item_category_map(category_set_id, catalog_item_id);

-- 4) Add active_category_mode to inventory_lists
ALTER TABLE public.inventory_lists
  ADD COLUMN active_category_mode text NOT NULL DEFAULT 'list_order'
  CHECK (active_category_mode IN ('list_order', 'custom_ai', 'user_manual', 'recently_purchased'));
