
-- Add length constraints for inventory_catalog_items
ALTER TABLE public.inventory_catalog_items
ADD CONSTRAINT item_name_length CHECK (length(item_name) <= 200),
ADD CONSTRAINT category_length CHECK (category IS NULL OR length(category) <= 100),
ADD CONSTRAINT vendor_sku_length CHECK (vendor_sku IS NULL OR length(vendor_sku) <= 100),
ADD CONSTRAINT vendor_name_length CHECK (vendor_name IS NULL OR length(vendor_name) <= 200),
ADD CONSTRAINT unit_length CHECK (unit IS NULL OR length(unit) <= 50),
ADD CONSTRAINT pack_size_length CHECK (pack_size IS NULL OR length(pack_size) <= 100);

-- Add length constraints for inventory_session_items
ALTER TABLE public.inventory_session_items
ADD CONSTRAINT isi_item_name_length CHECK (length(item_name) <= 200),
ADD CONSTRAINT isi_category_length CHECK (category IS NULL OR length(category) <= 100),
ADD CONSTRAINT isi_vendor_sku_length CHECK (vendor_sku IS NULL OR length(vendor_sku) <= 100),
ADD CONSTRAINT isi_vendor_name_length CHECK (vendor_name IS NULL OR length(vendor_name) <= 200),
ADD CONSTRAINT isi_unit_length CHECK (unit IS NULL OR length(unit) <= 50),
ADD CONSTRAINT isi_pack_size_length CHECK (pack_size IS NULL OR length(pack_size) <= 100);
