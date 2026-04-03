
-- Create inventory_import_files table for tracking imports
CREATE TABLE public.inventory_import_files (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  restaurant_id UUID NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  inventory_list_id UUID NOT NULL REFERENCES public.inventory_lists(id) ON DELETE CASCADE,
  file_name TEXT NOT NULL,
  file_type TEXT DEFAULT 'csv',
  uploaded_by UUID,
  uploaded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  row_count INT DEFAULT 0,
  created_count INT DEFAULT 0,
  skipped_count INT DEFAULT 0,
  mapping_json JSONB DEFAULT '{}'::jsonb
);

ALTER TABLE public.inventory_import_files ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can view import files"
  ON public.inventory_import_files FOR SELECT
  USING (public.is_member_of(restaurant_id));

CREATE POLICY "Members can create import files"
  ON public.inventory_import_files FOR INSERT
  WITH CHECK (public.is_member_of(restaurant_id));

-- Add catalog_item_id to order_items (optional link)
ALTER TABLE public.order_items
  ADD COLUMN IF NOT EXISTS catalog_item_id UUID REFERENCES public.inventory_catalog_items(id);

-- Grant permissions
GRANT SELECT, INSERT ON public.inventory_import_files TO authenticated;
GRANT SELECT, INSERT ON public.inventory_import_files TO anon;

-- Refresh PostgREST cache
NOTIFY pgrst, 'reload schema';
