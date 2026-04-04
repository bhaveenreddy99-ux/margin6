-- Ensure catalog_item_id exists on 
-- smart_order_run_items before 
-- workflow migration runs.
-- Safe to run multiple times (IF NOT EXISTS).

ALTER TABLE public.smart_order_run_items
  ADD COLUMN IF NOT EXISTS catalog_item_id 
  uuid REFERENCES public.inventory_catalog_items(id) 
  ON DELETE SET NULL;
