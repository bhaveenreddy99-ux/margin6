ALTER TABLE public.purchase_orders
  ADD COLUMN IF NOT EXISTS location_id uuid
  REFERENCES public.locations(id);

CREATE INDEX IF NOT EXISTS idx_po_location_id
  ON public.purchase_orders(location_id);

UPDATE public.purchase_orders po
SET location_id = sor.location_id
FROM public.smart_order_runs sor
WHERE po.smart_order_run_id = sor.id
  AND sor.location_id IS NOT NULL
  AND po.location_id IS NULL;
