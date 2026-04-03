
-- Add invoice-related columns to purchase_history
ALTER TABLE public.purchase_history
  ADD COLUMN IF NOT EXISTS invoice_number text,
  ADD COLUMN IF NOT EXISTS invoice_date date,
  ADD COLUMN IF NOT EXISTS pdf_url text,
  ADD COLUMN IF NOT EXISTS invoice_status text NOT NULL DEFAULT 'COMPLETE';

-- Add matching columns to purchase_history_items
ALTER TABLE public.purchase_history_items
  ADD COLUMN IF NOT EXISTS catalog_item_id uuid REFERENCES public.inventory_catalog_items(id),
  ADD COLUMN IF NOT EXISTS match_status text NOT NULL DEFAULT 'MANUAL';

-- Allow members to update purchase_history (for invoice workflow)
CREATE POLICY "Manager+ can update purchase history"
  ON public.purchase_history
  FOR UPDATE
  USING (has_restaurant_role_any(restaurant_id, ARRAY['OWNER'::app_role, 'MANAGER'::app_role]));
