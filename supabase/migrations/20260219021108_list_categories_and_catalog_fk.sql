
-- Per-list categories (NOT global)
CREATE TABLE public.list_categories (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  list_id UUID NOT NULL REFERENCES public.inventory_lists(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.list_categories ENABLE ROW LEVEL SECURITY;

-- Helper function to get restaurant_id from list_id
CREATE OR REPLACE FUNCTION public.list_category_restaurant_id(lc_list_id uuid)
RETURNS uuid
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT restaurant_id FROM public.inventory_lists WHERE id = lc_list_id
$$;

-- RLS policies
CREATE POLICY "Members can view list categories"
ON public.list_categories FOR SELECT
USING (is_member_of(list_category_restaurant_id(list_id)));

CREATE POLICY "Members can create list categories"
ON public.list_categories FOR INSERT
WITH CHECK (is_member_of(list_category_restaurant_id(list_id)));

CREATE POLICY "Members can update list categories"
ON public.list_categories FOR UPDATE
USING (is_member_of(list_category_restaurant_id(list_id)));

CREATE POLICY "Members can delete list categories"
ON public.list_categories FOR DELETE
USING (is_member_of(list_category_restaurant_id(list_id)));

-- Add list_category_id to catalog items (nullable, no existing data affected)
ALTER TABLE public.inventory_catalog_items
ADD COLUMN list_category_id UUID REFERENCES public.list_categories(id) ON DELETE SET NULL;
