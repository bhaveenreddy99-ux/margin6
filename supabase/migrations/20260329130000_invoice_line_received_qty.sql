-- Three-way match: PO vs billed vs physically received
ALTER TABLE public.invoice_line_comparisons
  ADD COLUMN IF NOT EXISTS received_qty numeric;

UPDATE public.invoice_line_comparisons
SET received_qty = invoiced_qty
WHERE received_qty IS NULL
  AND invoiced_qty IS NOT NULL;

ALTER TABLE public.invoice_line_comparisons
  DROP CONSTRAINT IF EXISTS invoice_line_comparisons_status_check;

ALTER TABLE public.invoice_line_comparisons
  ADD CONSTRAINT invoice_line_comparisons_status_check
  CHECK (status IN (
    'ok',
    'qty_mismatch',
    'price_mismatch',
    'total_mismatch',
    'missing_from_invoice',
    'extra_on_invoice',
    'unmatched',
    'received_short',
    'received_over'
  ));
