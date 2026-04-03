
-- Add pack_size to smart_order_run_items
ALTER TABLE public.smart_order_run_items ADD COLUMN IF NOT EXISTS pack_size text;

-- Add pack_size to purchase_history_items
ALTER TABLE public.purchase_history_items ADD COLUMN IF NOT EXISTS pack_size text;
