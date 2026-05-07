-- MVP user invites: owner creates row; invitee accepts on login via RPC (no email).

CREATE TABLE public.user_invites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id uuid NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  email text NOT NULL,
  role public.app_role NOT NULL,
  location_id uuid NOT NULL REFERENCES public.locations(id) ON DELETE CASCADE,
  can_approve_orders boolean NOT NULL DEFAULT true,
  can_see_costs boolean NOT NULL DEFAULT false,
  can_see_food_cost_pct boolean NOT NULL DEFAULT true,
  can_see_inventory_value boolean NOT NULL DEFAULT false,
  can_edit_par boolean NOT NULL DEFAULT true,
  order_approval_threshold numeric(10, 2),
  status public.invitation_status NOT NULL DEFAULT 'PENDING'::public.invitation_status,
  invited_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  accepted_at timestamptz,
  CONSTRAINT user_invites_role_chk CHECK (role = ANY (ARRAY['MANAGER'::public.app_role, 'STAFF'::public.app_role]))
);

CREATE UNIQUE INDEX uq_user_invites_pending_restaurant_email
  ON public.user_invites (restaurant_id, lower(email))
  WHERE status = 'PENDING'::public.invitation_status;

CREATE INDEX idx_user_invites_email_pending
  ON public.user_invites (lower(email))
  WHERE status = 'PENDING'::public.invitation_status;

ALTER TABLE public.user_invites ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Owners can select user_invites"
  ON public.user_invites
  FOR SELECT TO authenticated
  USING (public.has_restaurant_role(restaurant_id, 'OWNER'::public.app_role));

CREATE POLICY "Owners can insert user_invites"
  ON public.user_invites
  FOR INSERT TO authenticated
  WITH CHECK (
    public.has_restaurant_role(restaurant_id, 'OWNER'::public.app_role)
    AND invited_by = auth.uid()
    AND EXISTS (
      SELECT 1
      FROM public.locations l
      WHERE l.id = user_invites.location_id
        AND l.restaurant_id = user_invites.restaurant_id
    )
  );

CREATE POLICY "Owners can update user_invites"
  ON public.user_invites
  FOR UPDATE TO authenticated
  USING (public.has_restaurant_role(restaurant_id, 'OWNER'::public.app_role))
  WITH CHECK (public.has_restaurant_role(restaurant_id, 'OWNER'::public.app_role));

CREATE POLICY "Owners can delete user_invites"
  ON public.user_invites
  FOR DELETE TO authenticated
  USING (public.has_restaurant_role(restaurant_id, 'OWNER'::public.app_role));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_invites TO authenticated;

-- Accept all pending invites for the signed-in user's email (SECURITY DEFINER: ULA insert is owner-only).
CREATE OR REPLACE FUNCTION public.accept_user_invites()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_email text;
  v_processed int := 0;
  r RECORD;
  v_existing_role public.app_role;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('processed', 0);
  END IF;

  SELECT lower(trim(u.email)) INTO v_email
  FROM auth.users u
  WHERE u.id = v_uid;

  IF v_email IS NULL OR length(v_email) = 0 THEN
    RETURN jsonb_build_object('processed', 0);
  END IF;

  FOR r IN
    SELECT ui.*
    FROM public.user_invites ui
    WHERE lower(trim(ui.email)) = v_email
      AND ui.status = 'PENDING'::public.invitation_status
  LOOP
    IF NOT EXISTS (
      SELECT 1
      FROM public.locations l
      WHERE l.id = r.location_id
        AND l.restaurant_id = r.restaurant_id
    ) THEN
      CONTINUE;
    END IF;

    SELECT rm.role INTO v_existing_role
    FROM public.restaurant_members rm
    WHERE rm.user_id = v_uid
      AND rm.restaurant_id = r.restaurant_id;

    IF FOUND AND v_existing_role = 'OWNER'::public.app_role THEN
      UPDATE public.user_invites
      SET status = 'ACCEPTED'::public.invitation_status,
          accepted_at = now()
      WHERE id = r.id;
      v_processed := v_processed + 1;
      CONTINUE;
    END IF;

    INSERT INTO public.restaurant_members (restaurant_id, user_id, role, default_location_id)
    VALUES (r.restaurant_id, v_uid, r.role, r.location_id)
    ON CONFLICT (user_id, restaurant_id) DO UPDATE
      SET role = EXCLUDED.role,
          default_location_id = COALESCE(EXCLUDED.default_location_id, restaurant_members.default_location_id);

    INSERT INTO public.user_location_assignments (
      user_id,
      location_id,
      role,
      is_primary,
      can_approve_orders,
      can_see_costs,
      can_see_food_cost_pct,
      can_see_inventory_value,
      can_edit_par,
      order_approval_threshold
    )
    VALUES (
      v_uid,
      r.location_id,
      r.role,
      true,
      r.can_approve_orders,
      r.can_see_costs,
      r.can_see_food_cost_pct,
      r.can_see_inventory_value,
      r.can_edit_par,
      r.order_approval_threshold
    )
    ON CONFLICT (user_id, location_id) DO UPDATE
      SET role = EXCLUDED.role,
          is_primary = true,
          can_approve_orders = EXCLUDED.can_approve_orders,
          can_see_costs = EXCLUDED.can_see_costs,
          can_see_food_cost_pct = EXCLUDED.can_see_food_cost_pct,
          can_see_inventory_value = EXCLUDED.can_see_inventory_value,
          can_edit_par = EXCLUDED.can_edit_par,
          order_approval_threshold = EXCLUDED.order_approval_threshold,
          updated_at = now();

    UPDATE public.user_invites
    SET status = 'ACCEPTED'::public.invitation_status,
        accepted_at = now()
    WHERE id = r.id;

    v_processed := v_processed + 1;
  END LOOP;

  RETURN jsonb_build_object('processed', v_processed);
END;
$$;

REVOKE ALL ON FUNCTION public.accept_user_invites() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.accept_user_invites() TO authenticated;

COMMENT ON TABLE public.user_invites IS 'Owner-created invites; accept_user_invites() applies membership + ULA on login.';
