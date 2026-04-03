-- Preserve parsed invoice header amounts end to end by storing them on
-- purchase_history instead of recomputing them only from line items.

ALTER TABLE public.purchase_history
  ADD COLUMN IF NOT EXISTS invoice_subtotal numeric,
  ADD COLUMN IF NOT EXISTS invoice_tax numeric,
  ADD COLUMN IF NOT EXISTS invoice_total numeric;

NOTIFY pgrst, 'reload schema';
