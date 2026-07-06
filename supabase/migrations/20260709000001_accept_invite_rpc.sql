-- Manager/staff invite flow — Slice 3: accept_invite (SECURITY DEFINER).
--
-- The invitee (already authenticated + email-confirmed) redeems a plaintext token.
-- Works for BOTH a brand-new user and an existing account — same RPC. Idempotent for
-- an already-member. Escalation-proof: role/restaurant/location come from the invite
-- ROW; the caller supplies ONLY the token.

CREATE OR REPLACE FUNCTION public.accept_invite(p_token text)
RETURNS TABLE(restaurant_id uuid, role public.app_role, location_id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
#variable_conflict use_column
DECLARE
  v_caller uuid := auth.uid();
  v_email  text := lower(auth.email());
  v_hash   bytea;
  v_inv    public.restaurant_invites;
  v_diag   public.restaurant_invites;
  v_is_primary boolean;
BEGIN
  IF v_caller IS NULL OR v_email IS NULL OR v_email = '' THEN
    RAISE EXCEPTION 'not authenticated' USING errcode = '42501';
  END IF;

  v_hash := sha256(p_token::bytea);

  -- ── Atomic single-use consume ──────────────────────────────────────────────
  -- token-match + pending + not-expired + email-bound, all in one row-locked UPDATE.
  UPDATE public.restaurant_invites i
     SET status = 'accepted', accepted_at = now(), accepted_by = v_caller
   WHERE i.token_hash = v_hash
     AND i.status = 'pending'
     AND i.expires_at > now()
     AND i.invited_email = v_email
  RETURNING i.* INTO v_inv;

  IF NOT FOUND THEN
    -- Classify the failure (read-only) into DISTINCT, catchable SQLSTATEs so the
    -- accept page (Slice 4) can branch on error.code and show the right message:
    --   INV00 not-found · INV01 wrong-email · INV02 expired · INV03 used · INV04 revoked
    SELECT * INTO v_diag FROM public.restaurant_invites WHERE token_hash = v_hash;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'invalid invite link' USING errcode = 'INV00';
    ELSIF v_diag.status = 'accepted' THEN
      RAISE EXCEPTION 'this invite has already been used' USING errcode = 'INV03';
    ELSIF v_diag.status = 'revoked' THEN
      RAISE EXCEPTION 'this invite has been revoked' USING errcode = 'INV04';
    ELSIF v_diag.status = 'expired' OR v_diag.expires_at <= now() THEN
      RAISE EXCEPTION 'this invite has expired' USING errcode = 'INV02';
    ELSE
      -- pending + not expired ⇒ email mismatch. Carry invited_email in DETAIL so the
      -- page can say "this invite is for <invited_email>" (the caller holds the token,
      -- which was emailed to that address — so this isn't a new disclosure).
      RAISE EXCEPTION 'this invite was sent to a different email address'
        USING errcode = 'INV01', detail = v_diag.invited_email;
    END IF;
  END IF;

  -- ── Grant EXACTLY what the invite specifies (never caller input) ───────────
  -- Idempotent: an existing membership is left as-is (role changes go through the
  -- separate member-management flow, not invites).
  INSERT INTO public.restaurant_members (restaurant_id, user_id, role, default_location_id)
  VALUES (v_inv.restaurant_id, v_caller, v_inv.role, v_inv.location_id)
  ON CONFLICT (user_id, restaurant_id) DO NOTHING;

  v_is_primary := NOT EXISTS (SELECT 1 FROM public.user_location_assignments WHERE user_id = v_caller);
  INSERT INTO public.user_location_assignments (
    user_id, location_id, role, is_primary,
    can_approve_orders, can_see_costs, can_see_food_cost_pct,
    can_see_inventory_value, can_edit_par, order_approval_threshold
  ) VALUES (
    v_caller, v_inv.location_id, v_inv.role, v_is_primary,
    v_inv.can_approve_orders, v_inv.can_see_costs, v_inv.can_see_food_cost_pct,
    v_inv.can_see_inventory_value, v_inv.can_edit_par, v_inv.order_approval_threshold
  )
  ON CONFLICT (user_id, location_id) DO NOTHING;

  RETURN QUERY SELECT v_inv.restaurant_id, v_inv.role, v_inv.location_id;
END;
$$;

REVOKE ALL ON FUNCTION public.accept_invite(text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.accept_invite(text) TO authenticated;

NOTIFY pgrst, 'reload schema';
