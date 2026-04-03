
-- Add brand_name column to inventory_catalog_items
ALTER TABLE public.inventory_catalog_items ADD COLUMN IF NOT EXISTS brand_name text;

-- Add brand_name column to inventory_session_items
ALTER TABLE public.inventory_session_items ADD COLUMN IF NOT EXISTS brand_name text;

-- Add brand_name column to purchase_history_items
ALTER TABLE public.purchase_history_items ADD COLUMN IF NOT EXISTS brand_name text;

-- Add brand_name column to par_guide_items
ALTER TABLE public.par_guide_items ADD COLUMN IF NOT EXISTS brand_name text;

-- Migrate any existing brand_name from metadata jsonb to the new column
UPDATE public.inventory_catalog_items
SET brand_name = metadata->>'brand_name'
WHERE metadata->>'brand_name' IS NOT NULL AND brand_name IS NULL;

-- Notify PostgREST to reload schema
NOTIFY pgrst, 'reload schema';
