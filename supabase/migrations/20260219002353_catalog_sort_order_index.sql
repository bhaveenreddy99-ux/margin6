
-- Add sort_order to inventory_catalog_items for drag-drop reorder support
ALTER TABLE public.inventory_catalog_items ADD COLUMN IF NOT EXISTS sort_order integer NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS idx_catalog_items_sort_order ON public.inventory_catalog_items (inventory_list_id, sort_order);
