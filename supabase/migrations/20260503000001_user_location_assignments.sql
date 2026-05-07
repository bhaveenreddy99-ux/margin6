CREATE TABLE public.user_location_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL
    REFERENCES auth.users(id) ON DELETE CASCADE,
  location_id uuid NOT NULL
    REFERENCES public.locations(id) ON DELETE CASCADE,
  role public.app_role NOT NULL DEFAULT 'STAFF'::public.app_role,
  is_primary boolean NOT NULL DEFAULT false,
  can_approve_orders boolean NOT NULL DEFAULT true,
  can_see_costs boolean NOT NULL DEFAULT false,
  can_see_food_cost_pct boolean NOT NULL DEFAULT true,
  can_see_inventory_value boolean NOT NULL DEFAULT false,
  can_edit_par boolean NOT NULL DEFAULT true,
  order_approval_threshold numeric(10, 2) DEFAULT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, location_id)
);

CREATE INDEX idx_ula_user_id
  ON public.user_location_assignments(user_id);
CREATE INDEX idx_ula_location_id
  ON public.user_location_assignments(location_id);
CREATE INDEX idx_ula_primary
  ON public.user_location_assignments(user_id, is_primary)
  WHERE is_primary = true;

ALTER TABLE public.user_location_assignments
  ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ula_user_select"
  ON public.user_location_assignments
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "ula_owner_all"
  ON public.user_location_assignments
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.locations l
      JOIN public.restaurant_members rm
        ON rm.restaurant_id = l.restaurant_id
      WHERE l.id = user_location_assignments.location_id
        AND rm.user_id = auth.uid()
        AND rm.role = 'OWNER'::public.app_role
    )
  );
