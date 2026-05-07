CREATE TABLE public.location_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  location_id uuid NOT NULL UNIQUE
    REFERENCES public.locations(id) ON DELETE CASCADE,
  brand text DEFAULT NULL,
  food_cost_target_pct numeric(5, 2) NOT NULL DEFAULT 30.0,
  count_frequency_days integer NOT NULL DEFAULT 3,
  count_overdue_alert_hrs integer NOT NULL DEFAULT 72,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_location_settings_location_id
  ON public.location_settings(location_id);

ALTER TABLE public.location_settings
  ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ls_member_select"
  ON public.location_settings
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.locations l
      JOIN public.restaurant_members rm
        ON rm.restaurant_id = l.restaurant_id
      WHERE l.id = location_settings.location_id
        AND rm.user_id = auth.uid()
    )
  );

CREATE POLICY "ls_manager_all"
  ON public.location_settings
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.locations l
      JOIN public.restaurant_members rm
        ON rm.restaurant_id = l.restaurant_id
      WHERE l.id = location_settings.location_id
        AND rm.user_id = auth.uid()
        AND rm.role IN ('OWNER'::public.app_role, 'MANAGER'::public.app_role)
    )
  );
