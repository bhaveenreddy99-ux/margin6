
-- Add category and sort_order to custom_list_items
ALTER TABLE public.custom_list_items 
  ADD COLUMN IF NOT EXISTS category text,
  ADD COLUMN IF NOT EXISTS sort_order integer DEFAULT 0;

-- Add categories array to custom_lists for managing category names
ALTER TABLE public.custom_lists 
  ADD COLUMN IF NOT EXISTS categories jsonb DEFAULT '[]'::jsonb;
