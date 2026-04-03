
-- Waste Log table
CREATE TABLE IF NOT EXISTS public.waste_log (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id UUID NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  item_name     TEXT NOT NULL,
  quantity      NUMERIC NOT NULL CHECK (quantity > 0),
  reason        TEXT NOT NULL,
  notes         TEXT,
  logged_by     UUID NOT NULL REFERENCES auth.users(id),
  logged_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Index for fast per-restaurant queries sorted by time
CREATE INDEX IF NOT EXISTS waste_log_restaurant_logged_at
  ON public.waste_log (restaurant_id, logged_at DESC);

-- RLS
ALTER TABLE public.waste_log ENABLE ROW LEVEL SECURITY;

-- Members of the restaurant can read all entries
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'waste_log' AND policyname = 'waste_log_read') THEN
    CREATE POLICY "waste_log_read" ON public.waste_log FOR SELECT USING (is_member_of(restaurant_id));
  END IF;
END $$;

-- Any member can insert their own entries
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'waste_log' AND policyname = 'waste_log_insert') THEN
    CREATE POLICY "waste_log_insert" ON public.waste_log FOR INSERT WITH CHECK (is_member_of(restaurant_id) AND logged_by = auth.uid());
  END IF;
END $$;

-- Only managers / owners can delete entries
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'waste_log' AND policyname = 'waste_log_delete') THEN
    CREATE POLICY "waste_log_delete" ON public.waste_log FOR DELETE USING (
      is_member_of(restaurant_id)
      AND EXISTS (
        SELECT 1 FROM public.restaurant_members
        WHERE restaurant_id = waste_log.restaurant_id
          AND user_id = auth.uid()
          AND role IN ('OWNER', 'MANAGER')
      )
    );
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
