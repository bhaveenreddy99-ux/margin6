-- Allow 'email' as a valid source_kind in invoice_ingestions
-- so the inbound-invoice-email edge function can insert rows.

ALTER TABLE public.invoice_ingestions
  DROP CONSTRAINT IF EXISTS invoice_ingestions_source_kind_check;

ALTER TABLE public.invoice_ingestions
  ADD CONSTRAINT invoice_ingestions_source_kind_check
  CHECK (source_kind IN ('file', 'photo', 'email'));

NOTIFY pgrst, 'reload schema';
