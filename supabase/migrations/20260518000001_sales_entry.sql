-- =============================================================================
-- Sales entry: weekly_sales (canonical) + daily_sales (advanced opt-in).
--
-- Weekly is the default operator workflow. Daily auto-aggregates into weekly
-- via a trigger. When both exist for the same (location, week), manual weekly
-- entry always wins.
--
-- Read gate: per-user can_see_food_cost_pct on user_location_assignments,
-- with OWNER role bypass (mirrors useLocationPermissions FE behavior).
-- Write gate: OWNER or MANAGER role only; STAFF never writes sales.
--
-- TODO: default can_see_food_cost_pct = true for MANAGER assignments (separate PR).
-- TODO: link to audit_sales_changes (Workstream 1.7) for change tracking.
-- =============================================================================


-- ── Tables ────────────────────────────────────────────────────────────────────

CREATE TABLE public.weekly_sales (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id       UUID NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  location_id         UUID NOT NULL REFERENCES public.locations(id) ON DELETE CASCADE,
  week_start          DATE NOT NULL,
  gross_sales         NUMERIC(12,2) NOT NULL CHECK (gross_sales >= 0),
  net_sales           NUMERIC(12,2) CHECK (net_sales IS NULL OR net_sales >= 0),
  comps               NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (comps >= 0),
  discounts           NUMERIC(12,2) NOT NULL DEFAULT 0,
  tax                 NUMERIC(12,2) NOT NULL DEFAULT 0,
  entry_method        TEXT NOT NULL DEFAULT 'manual_weekly',
  is_partial          BOOLEAN NOT NULL DEFAULT FALSE,
  entered_by_user_id  UUID NOT NULL REFERENCES auth.users(id),
  entered_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (location_id, week_start)
);

CREATE TABLE public.daily_sales (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id       UUID NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  location_id         UUID NOT NULL REFERENCES public.locations(id) ON DELETE CASCADE,
  sale_date           DATE NOT NULL,
  gross_sales         NUMERIC(12,2) NOT NULL CHECK (gross_sales >= 0),
  net_sales           NUMERIC(12,2) CHECK (net_sales IS NULL OR net_sales >= 0),
  comps               NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (comps >= 0),
  discounts           NUMERIC(12,2) NOT NULL DEFAULT 0,
  tax                 NUMERIC(12,2) NOT NULL DEFAULT 0,
  entry_method        TEXT NOT NULL DEFAULT 'manual_daily',
  entered_by_user_id  UUID NOT NULL REFERENCES auth.users(id),
  entered_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (location_id, sale_date)
);


-- ── entry_method CHECK constraints ────────────────────────────────────────────
-- Hard-fail typo'd values at insert time. The aggregator trigger compares against
-- exact strings ('manual_weekly', 'manual_daily_aggregated') — a typo would
-- silently skip the manual-wins branch.

ALTER TABLE public.weekly_sales
  ADD CONSTRAINT weekly_sales_entry_method_check
  CHECK (entry_method IN ('manual_weekly', 'manual_daily_aggregated', 'csv', 'email_in', 'pos_api'));

ALTER TABLE public.daily_sales
  ADD CONSTRAINT daily_sales_entry_method_check
  CHECK (entry_method IN ('manual_daily', 'csv', 'email_in', 'pos_api'));


-- ── Indexes ───────────────────────────────────────────────────────────────────

CREATE INDEX idx_weekly_sales_restaurant_location_week
  ON public.weekly_sales (restaurant_id, location_id, week_start DESC);

CREATE INDEX idx_daily_sales_restaurant_location_date
  ON public.daily_sales (restaurant_id, location_id, sale_date DESC);


-- ── updated_at touch trigger ──────────────────────────────────────────────────
-- No project-wide set_updated_at() existed at migration time; defining a
-- sales-scoped helper to avoid colliding with any future generic function.

CREATE OR REPLACE FUNCTION public.set_sales_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$;

CREATE TRIGGER weekly_sales_set_updated_at
BEFORE UPDATE ON public.weekly_sales
FOR EACH ROW EXECUTE FUNCTION public.set_sales_updated_at();

CREATE TRIGGER daily_sales_set_updated_at
BEFORE UPDATE ON public.daily_sales
FOR EACH ROW EXECUTE FUNCTION public.set_sales_updated_at();


-- ── Daily → Weekly aggregation trigger ───────────────────────────────────────
--
-- After INSERT/UPDATE/DELETE on daily_sales:
--   • Manual weekly entry wins; never overwrite it.
--   • No daily rows for the week → delete trigger-owned weekly row.
--   • Else → upsert weekly row with summed components; is_partial when cnt < 7.

CREATE OR REPLACE FUNCTION public.aggregate_daily_to_weekly()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  target_date       DATE := COALESCE(NEW.sale_date, OLD.sale_date);
  week_monday       DATE := date_trunc('week', target_date)::DATE;
  target_location   UUID := COALESCE(NEW.location_id, OLD.location_id);
  target_restaurant UUID := COALESCE(NEW.restaurant_id, OLD.restaurant_id);
  existing_method   TEXT;
  agg               RECORD;
BEGIN
  SELECT entry_method INTO existing_method
  FROM public.weekly_sales
  WHERE location_id = target_location
    AND week_start = week_monday;

  -- Manual weekly entry wins; never overwrite it.
  IF existing_method = 'manual_weekly' THEN
    RETURN NULL;
  END IF;

  SELECT
    COUNT(*)                               AS cnt,
    COALESCE(SUM(gross_sales), 0)          AS gross,
    NULLIF(SUM(COALESCE(net_sales, 0)), 0) AS net,
    COALESCE(SUM(comps), 0)                AS comps,
    COALESCE(SUM(discounts), 0)            AS discounts,
    COALESCE(SUM(tax), 0)                  AS tax
  INTO agg
  FROM public.daily_sales
  WHERE location_id = target_location
    AND sale_date >= week_monday
    AND sale_date <  week_monday + INTERVAL '7 days';

  IF agg.cnt = 0 THEN
    -- Only delete rows the trigger created; never touch manual_weekly.
    DELETE FROM public.weekly_sales
    WHERE location_id = target_location
      AND week_start = week_monday
      AND entry_method = 'manual_daily_aggregated';
    RETURN NULL;
  END IF;

  INSERT INTO public.weekly_sales (
    restaurant_id, location_id, week_start,
    gross_sales, net_sales, comps, discounts, tax,
    entry_method, is_partial,
    entered_by_user_id, entered_at, updated_at
  ) VALUES (
    target_restaurant, target_location, week_monday,
    agg.gross, agg.net, agg.comps, agg.discounts, agg.tax,
    'manual_daily_aggregated', (agg.cnt < 7),
    COALESCE(NEW.entered_by_user_id, OLD.entered_by_user_id),
    NOW(), NOW()
  )
  ON CONFLICT (location_id, week_start) DO UPDATE SET
    gross_sales = EXCLUDED.gross_sales,
    net_sales   = EXCLUDED.net_sales,
    comps       = EXCLUDED.comps,
    discounts   = EXCLUDED.discounts,
    tax         = EXCLUDED.tax,
    is_partial  = EXCLUDED.is_partial,
    updated_at  = NOW()
  WHERE public.weekly_sales.entry_method = 'manual_daily_aggregated';

  RETURN NULL;
END;
$$;

CREATE TRIGGER daily_to_weekly_agg
AFTER INSERT OR UPDATE OR DELETE ON public.daily_sales
FOR EACH ROW EXECUTE FUNCTION public.aggregate_daily_to_weekly();


-- ── Row Level Security ────────────────────────────────────────────────────────

ALTER TABLE public.weekly_sales ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.daily_sales  ENABLE ROW LEVEL SECURITY;


-- weekly_sales ────────────────────────────────────────────────────────────────

CREATE POLICY "Members can view weekly sales"
  ON public.weekly_sales FOR SELECT TO authenticated
  USING (
    is_member_of(restaurant_id)
    AND user_can_access_location(auth.uid(), location_id)
    AND (
      has_restaurant_role_any(restaurant_id, ARRAY['OWNER'::app_role])
      OR EXISTS (
        SELECT 1 FROM public.user_location_assignments ula
        WHERE ula.user_id = auth.uid()
          AND ula.location_id = weekly_sales.location_id
          AND ula.can_see_food_cost_pct = true
      )
    )
  );

CREATE POLICY "Managers+ can insert weekly sales"
  ON public.weekly_sales FOR INSERT TO authenticated
  WITH CHECK (
    is_member_of(restaurant_id)
    AND user_can_access_location(auth.uid(), location_id)
    AND has_restaurant_role_any(restaurant_id, ARRAY['OWNER'::app_role, 'MANAGER'::app_role])
  );

CREATE POLICY "Managers+ can update weekly sales"
  ON public.weekly_sales FOR UPDATE TO authenticated
  USING (
    is_member_of(restaurant_id)
    AND user_can_access_location(auth.uid(), location_id)
    AND has_restaurant_role_any(restaurant_id, ARRAY['OWNER'::app_role, 'MANAGER'::app_role])
  )
  WITH CHECK (
    is_member_of(restaurant_id)
    AND user_can_access_location(auth.uid(), location_id)
    AND has_restaurant_role_any(restaurant_id, ARRAY['OWNER'::app_role, 'MANAGER'::app_role])
  );

CREATE POLICY "Managers+ can delete weekly sales"
  ON public.weekly_sales FOR DELETE TO authenticated
  USING (
    is_member_of(restaurant_id)
    AND user_can_access_location(auth.uid(), location_id)
    AND has_restaurant_role_any(restaurant_id, ARRAY['OWNER'::app_role, 'MANAGER'::app_role])
  );


-- daily_sales ─────────────────────────────────────────────────────────────────

CREATE POLICY "Members can view daily sales"
  ON public.daily_sales FOR SELECT TO authenticated
  USING (
    is_member_of(restaurant_id)
    AND user_can_access_location(auth.uid(), location_id)
    AND (
      has_restaurant_role_any(restaurant_id, ARRAY['OWNER'::app_role])
      OR EXISTS (
        SELECT 1 FROM public.user_location_assignments ula
        WHERE ula.user_id = auth.uid()
          AND ula.location_id = daily_sales.location_id
          AND ula.can_see_food_cost_pct = true
      )
    )
  );

CREATE POLICY "Managers+ can insert daily sales"
  ON public.daily_sales FOR INSERT TO authenticated
  WITH CHECK (
    is_member_of(restaurant_id)
    AND user_can_access_location(auth.uid(), location_id)
    AND has_restaurant_role_any(restaurant_id, ARRAY['OWNER'::app_role, 'MANAGER'::app_role])
  );

CREATE POLICY "Managers+ can update daily sales"
  ON public.daily_sales FOR UPDATE TO authenticated
  USING (
    is_member_of(restaurant_id)
    AND user_can_access_location(auth.uid(), location_id)
    AND has_restaurant_role_any(restaurant_id, ARRAY['OWNER'::app_role, 'MANAGER'::app_role])
  )
  WITH CHECK (
    is_member_of(restaurant_id)
    AND user_can_access_location(auth.uid(), location_id)
    AND has_restaurant_role_any(restaurant_id, ARRAY['OWNER'::app_role, 'MANAGER'::app_role])
  );

CREATE POLICY "Managers+ can delete daily sales"
  ON public.daily_sales FOR DELETE TO authenticated
  USING (
    is_member_of(restaurant_id)
    AND user_can_access_location(auth.uid(), location_id)
    AND has_restaurant_role_any(restaurant_id, ARRAY['OWNER'::app_role, 'MANAGER'::app_role])
  );


NOTIFY pgrst, 'reload schema';
