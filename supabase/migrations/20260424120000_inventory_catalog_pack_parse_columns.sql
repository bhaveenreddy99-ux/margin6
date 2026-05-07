-- Parsed pack_size metadata (Universal Pack Parser)
ALTER TABLE public.inventory_catalog_items
  ADD COLUMN IF NOT EXISTS units_per_case integer,
  ADD COLUMN IF NOT EXISTS unit_size numeric,
  ADD COLUMN IF NOT EXISTS unit_type text,
  ADD COLUMN IF NOT EXISTS total_per_case numeric,
  ADD COLUMN IF NOT EXISTS pack_parse_success boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.inventory_catalog_items.units_per_case IS
  'Parsed from pack_size: number of units per case (e.g., 6 from "6/5 Lb")';
COMMENT ON COLUMN public.inventory_catalog_items.unit_size IS
  'Parsed from pack_size: size of one unit (e.g., 5 lb in "6/5 Lb")';
COMMENT ON COLUMN public.inventory_catalog_items.unit_type IS
  'Canonical unit token from pack parser (e.g. lb, gal, each)';
COMMENT ON COLUMN public.inventory_catalog_items.total_per_case IS
  'units_per_case * unit_size when applicable';
COMMENT ON COLUMN public.inventory_catalog_items.pack_parse_success IS
  'True when parsePackSize returned parseSuccess for pack_size';
