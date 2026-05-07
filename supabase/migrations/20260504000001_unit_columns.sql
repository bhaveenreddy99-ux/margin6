-- Phase 3: Make unit/cost/PAR meaning explicit in key tables.
-- All columns are nullable TEXT with safe defaults so existing rows are unaffected.
-- No backfill conversion is attempted -- defaults represent the canonical model assumption.

-- waste_log: record the unit the staff member used when logging waste
ALTER TABLE public.waste_log
  ADD COLUMN IF NOT EXISTS quantity_unit TEXT DEFAULT 'case';

-- par_guide_items: record the unit PAR levels are expressed in
ALTER TABLE public.par_guide_items
  ADD COLUMN IF NOT EXISTS par_unit TEXT DEFAULT 'case';

-- inventory_session_items: record the unit current_stock is expressed in
ALTER TABLE public.inventory_session_items
  ADD COLUMN IF NOT EXISTS stock_unit TEXT DEFAULT 'case';

-- inventory_catalog_items: record the unit default_unit_cost is expressed in
ALTER TABLE public.inventory_catalog_items
  ADD COLUMN IF NOT EXISTS cost_unit TEXT DEFAULT 'case';

-- Comments for schema clarity
COMMENT ON COLUMN public.waste_log.quantity_unit            IS 'Unit the quantity was entered in when logging waste (case, lb, each, etc.)';
COMMENT ON COLUMN public.par_guide_items.par_unit           IS 'Unit the par_level is expressed in -- always case in the canonical model';
COMMENT ON COLUMN public.inventory_session_items.stock_unit IS 'Unit current_stock is expressed in -- always case in the canonical model';
COMMENT ON COLUMN public.inventory_catalog_items.cost_unit  IS 'Unit default_unit_cost is expressed per -- always case in the canonical model';
