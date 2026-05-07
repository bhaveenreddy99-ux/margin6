ALTER TABLE public.waste_log
  ADD COLUMN IF NOT EXISTS location_id uuid
  REFERENCES public.locations(id);

CREATE INDEX IF NOT EXISTS idx_waste_log_location_id
  ON public.waste_log(location_id);

UPDATE public.waste_log wl
SET location_id = inv.default_location_id
FROM public.inventory_settings inv
WHERE inv.restaurant_id = wl.restaurant_id
  AND inv.default_location_id IS NOT NULL
  AND wl.location_id IS NULL;
