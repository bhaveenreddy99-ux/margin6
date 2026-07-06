-- Manager/staff invite flow — Slice 2: create_invite (SECURITY DEFINER).
--
-- The ONLY writer of a new restaurant_invites row (the table has no client INSERT
-- policy/grant). SECURITY DEFINER so it can insert while still enforcing the caller's
-- permission via auth.uid() (which reflects the CALLER even under DEFINER).
--
-- Permissions (enforced here — the escalation-prevention point):
--   * invite STAFF    → caller must be OWNER or MANAGER of p_restaurant_id
--   * invite MANAGER  → caller must be OWNER of p_restaurant_id
--   * invite OWNER    → never (also blocked by the table role CHECK)
-- Because the checks are keyed on p_restaurant_id, a caller cannot invite into a
-- restaurant they are not OWNER/MANAGER of.
--
-- Token: 256-bit base64url token generated here and RETURNED to the caller (for the
-- email link); only its sha256 hash is stored. The plaintext is never persisted.
-- Dedup: the partial-unique index (one pending invite per restaurant+email) surfaces
-- as a clear 23505 error (rotation is handled by the separate resend RPC in Slice 3.5).

CREATE OR REPLACE FUNCTION public.create_invite(
  p_restaurant_id           uuid,
  p_email                   text,
  p_role                    public.app_role,
  p_location_id             uuid,
  p_can_see_costs           boolean DEFAULT false,
  p_can_see_food_cost_pct   boolean DEFAULT false,
  p_can_see_inventory_value boolean DEFAULT false,
  p_can_approve_orders      boolean DEFAULT false,
  p_can_edit_par            boolean DEFAULT false,
  p_order_approval_threshold numeric DEFAULT NULL
)
RETURNS TABLE(invite_id uuid, token text, expires_at timestamptz)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_caller  uuid := auth.uid();
  v_email   text := lower(trim(p_email));
  v_token   text;
  v_hash    bytea;
  v_expires timestamptz := now() + interval '7 days';
  v_id      uuid;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING errcode = '42501';
  END IF;

  -- ── Permission enforcement ─────────────────────────────────────────────────
  IF p_role = 'STAFF'::public.app_role THEN
    IF NOT has_restaurant_role_any(p_restaurant_id,
                                   ARRAY['OWNER'::public.app_role, 'MANAGER'::public.app_role]) THEN
      RAISE EXCEPTION 'only an owner or manager can invite staff' USING errcode = '42501';
    END IF;
  ELSIF p_role = 'MANAGER'::public.app_role THEN
    IF NOT has_restaurant_role(p_restaurant_id, 'OWNER'::public.app_role) THEN
      RAISE EXCEPTION 'only an owner can invite a manager' USING errcode = '42501';
    END IF;
  ELSE
    RAISE EXCEPTION 'invalid invite role: % (only MANAGER or STAFF)', p_role USING errcode = '22023';
  END IF;

  -- ── Validation ─────────────────────────────────────────────────────────────
  IF NOT EXISTS (SELECT 1 FROM public.locations l
                 WHERE l.id = p_location_id AND l.restaurant_id = p_restaurant_id) THEN
    RAISE EXCEPTION 'location does not belong to this restaurant' USING errcode = '22023';
  END IF;

  IF v_email = '' OR v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' THEN
    RAISE EXCEPTION 'invalid email address' USING errcode = '22023';
  END IF;

  -- ── Token (plaintext returned; only the hash is stored) ────────────────────
  v_token := translate(encode(extensions.gen_random_bytes(32), 'base64'), '+/=', '-_');
  v_hash  := sha256(v_token::bytea);

  BEGIN
    INSERT INTO public.restaurant_invites (
      restaurant_id, role, location_id, invited_email, token_hash, expires_at, status,
      can_see_costs, can_see_food_cost_pct, can_see_inventory_value,
      can_approve_orders, can_edit_par, order_approval_threshold, invited_by
    ) VALUES (
      p_restaurant_id, p_role, p_location_id, v_email, v_hash, v_expires, 'pending',
      p_can_see_costs, p_can_see_food_cost_pct, p_can_see_inventory_value,
      p_can_approve_orders, p_can_edit_par, p_order_approval_threshold, v_caller
    )
    RETURNING id INTO v_id;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'a pending invite already exists for % at this restaurant', v_email
      USING errcode = '23505', hint = 'revoke or resend the existing invite';
  END;

  RETURN QUERY SELECT v_id, v_token, v_expires;
END;
$$;

REVOKE ALL ON FUNCTION public.create_invite(uuid, text, public.app_role, uuid, boolean, boolean, boolean, boolean, boolean, numeric) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.create_invite(uuid, text, public.app_role, uuid, boolean, boolean, boolean, boolean, boolean, numeric) TO authenticated;

NOTIFY pgrst, 'reload schema';
