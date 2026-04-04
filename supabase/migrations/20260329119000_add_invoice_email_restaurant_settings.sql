-- Unique inbound invoice address per restaurant (Sysco / US Foods / PFG, etc.)
ALTER TABLE public.restaurant_settings
  ADD COLUMN IF NOT EXISTS invoice_email TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS restaurant_settings_invoice_email_key
  ON public.restaurant_settings (invoice_email)
  WHERE invoice_email IS NOT NULL;
