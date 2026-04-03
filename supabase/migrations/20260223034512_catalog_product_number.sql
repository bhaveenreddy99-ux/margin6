-- Add product_number column to inventory_catalog_items
ALTER TABLE public.inventory_catalog_items 
ADD COLUMN IF NOT EXISTS product_number text;

-- Copy existing vendor_sku data to product_number
UPDATE public.inventory_catalog_items 
SET product_number = UPPER(TRIM(vendor_sku))
WHERE vendor_sku IS NOT NULL AND vendor_sku != '';

-- Add index for faster matching
CREATE INDEX IF NOT EXISTS idx_catalog_items_product_number 
ON public.inventory_catalog_items (product_number);

-- Notify PostgREST to reload schema
NOTIFY pgrst, 'reload schema';
