-- Optional PAR guide for read-only PAR display during counting (Inventory Management).

ALTER TABLE public.inventory_sessions
  ADD COLUMN IF NOT EXISTS counting_par_guide_id uuid REFERENCES public.par_guides(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_inventory_sessions_counting_par_guide_id
  ON public.inventory_sessions(counting_par_guide_id);

COMMENT ON COLUMN public.inventory_sessions.counting_par_guide_id IS
  'PAR guide selected in Inventory Management for optional read-only PAR column while counting.';

NOTIFY pgrst, 'reload schema';
