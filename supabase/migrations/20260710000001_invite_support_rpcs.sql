-- Manager/staff invite flow — Slice 3.5: supporting RPCs (list / resend / revoke).
-- All SECURITY DEFINER, authenticated-only, scoped to the caller's restaurant role.
-- resend/revoke are role-scoped by the INVITE's role: OWNER manages any; MANAGER
-- manages STAFF invites only, never MANAGER invites.

-- Internal helper: can the CALLER manage an invite of role p_role in p_restaurant_id?
-- (auth.uid() reflects the caller even under DEFINER). Not client-callable.
CREATE OR REPLACE FUNCTION public.can_manage_invite(p_restaurant_id uuid, p_role public.app_role)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT CASE p_role
    WHEN 'STAFF'::public.app_role   THEN has_restaurant_role_any(p_restaurant_id, ARRAY['OWNER'::public.app_role,'MANAGER'::public.app_role])
    WHEN 'MANAGER'::public.app_role THEN has_restaurant_role(p_restaurant_id, 'OWNER'::public.app_role)
    ELSE false
  END;
$$;
REVOKE ALL ON FUNCTION public.can_manage_invite(uuid, public.app_role) FROM public, anon, authenticated;

-- ── list_invites ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.list_invites(p_restaurant_id uuid)
RETURNS TABLE(invite_id uuid, invited_email text, role public.app_role, location_id uuid,
              status public.restaurant_invite_status, expires_at timestamptz,
              created_at timestamptz, invited_by uuid)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not authenticated' USING errcode = '42501'; END IF;
  IF NOT has_restaurant_role_any(p_restaurant_id, ARRAY['OWNER'::public.app_role,'MANAGER'::public.app_role]) THEN
    RAISE EXCEPTION 'only an owner or manager can view invites' USING errcode = '42501';
  END IF;
  -- NOTE: token_hash is deliberately NOT selected — never exposed.
  RETURN QUERY
    SELECT i.id, i.invited_email, i.role, i.location_id, i.status, i.expires_at, i.created_at, i.invited_by
    FROM public.restaurant_invites i
    WHERE i.restaurant_id = p_restaurant_id
      AND i.status IN ('pending'::public.restaurant_invite_status, 'expired'::public.restaurant_invite_status)
    ORDER BY i.created_at DESC;
END;
$$;
REVOKE ALL ON FUNCTION public.list_invites(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.list_invites(uuid) TO authenticated;

-- ── resend_invite (fresh token = rotate; old token dies) ─────────────────────
CREATE OR REPLACE FUNCTION public.resend_invite(p_invite_id uuid)
RETURNS TABLE(token text, expires_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_inv     public.restaurant_invites;
  v_token   text;
  v_expires timestamptz := now() + interval '7 days';
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not authenticated' USING errcode = '42501'; END IF;

  SELECT * INTO v_inv FROM public.restaurant_invites i WHERE i.id = p_invite_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'invite not found' USING errcode = 'INV00'; END IF;

  IF NOT public.can_manage_invite(v_inv.restaurant_id, v_inv.role) THEN
    RAISE EXCEPTION 'not permitted to resend this invite' USING errcode = '42501';
  END IF;

  IF v_inv.status = 'accepted' THEN RAISE EXCEPTION 'this invite was already accepted' USING errcode = 'INV03'; END IF;
  IF v_inv.status = 'revoked'  THEN RAISE EXCEPTION 'this invite was revoked; create a new one' USING errcode = 'INV04'; END IF;

  v_token := translate(encode(extensions.gen_random_bytes(32), 'base64'), '+/=', '-_');

  UPDATE public.restaurant_invites i
     SET token_hash = sha256(v_token::bytea), expires_at = v_expires, status = 'pending'
   WHERE i.id = p_invite_id
     AND i.status IN ('pending'::public.restaurant_invite_status, 'expired'::public.restaurant_invite_status);
  IF NOT FOUND THEN RAISE EXCEPTION 'this invite is no longer resendable' USING errcode = 'INV03'; END IF;  -- race guard

  RETURN QUERY SELECT v_token, v_expires;
END;
$$;
REVOKE ALL ON FUNCTION public.resend_invite(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.resend_invite(uuid) TO authenticated;

-- ── revoke_invite ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.revoke_invite(p_invite_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_inv public.restaurant_invites;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not authenticated' USING errcode = '42501'; END IF;

  SELECT * INTO v_inv FROM public.restaurant_invites i WHERE i.id = p_invite_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'invite not found' USING errcode = 'INV00'; END IF;

  IF NOT public.can_manage_invite(v_inv.restaurant_id, v_inv.role) THEN
    RAISE EXCEPTION 'not permitted to revoke this invite' USING errcode = '42501';
  END IF;

  IF v_inv.status = 'accepted' THEN
    RAISE EXCEPTION 'cannot revoke an accepted invite (use member management)' USING errcode = 'INV03';
  END IF;

  IF v_inv.status = 'revoked' THEN RETURN; END IF;   -- idempotent no-op

  UPDATE public.restaurant_invites i SET status = 'revoked' WHERE i.id = p_invite_id;
END;
$$;
REVOKE ALL ON FUNCTION public.revoke_invite(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.revoke_invite(uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';
