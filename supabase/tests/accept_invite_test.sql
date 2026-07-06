-- Slice 3 test for accept_invite (run with Slices 1+2+3 applied). Rolled back.
-- Uses create_invite to mint real tokens, then exercises every accept path and
-- asserts the DISTINCT error contract (INV00 not-found / INV01 wrong-email /
-- INV02 expired / INV03 used / INV04 revoked) the accept page will branch on.
BEGIN;
CREATE TEMP TABLE _t(name text, pass boolean, detail text);
DO $$
DECLARE
  v_rid uuid := 'aaaaaaaa-0000-0000-0000-000000000001';
  v_owner uuid; v_manager uuid; v_staff uuid;
  v_owner_email text; v_manager_email text; v_staff_email text;
  v_loc uuid; v_tok text; n int; ok boolean; v_role public.app_role; v_detail text;
BEGIN
  SELECT user_id INTO v_owner   FROM public.restaurant_members WHERE restaurant_id=v_rid AND role='OWNER'   LIMIT 1;
  SELECT user_id INTO v_manager FROM public.restaurant_members WHERE restaurant_id=v_rid AND role='MANAGER' LIMIT 1;
  SELECT user_id INTO v_staff   FROM public.restaurant_members WHERE restaurant_id=v_rid AND role='STAFF'   LIMIT 1;
  SELECT lower(email) INTO v_owner_email   FROM auth.users WHERE id=v_owner;
  SELECT lower(email) INTO v_manager_email FROM auth.users WHERE id=v_manager;
  SELECT lower(email) INTO v_staff_email   FROM auth.users WHERE id=v_staff;
  SELECT id INTO v_loc FROM public.locations WHERE restaurant_id=v_rid LIMIT 1;

  -- ── Case 1: NEW USER JOINS (+ exact-grant / escalation-proof) ──────────────
  DELETE FROM public.user_location_assignments WHERE user_id=v_staff;
  DELETE FROM public.restaurant_members WHERE user_id=v_staff AND restaurant_id=v_rid;

  PERFORM set_config('request.jwt.claims', json_build_object('sub',v_owner::text,'email',v_owner_email,'role','authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT token INTO v_tok FROM public.create_invite(v_rid, v_staff_email, 'STAFF'::public.app_role, v_loc, p_can_see_costs => true);
  RESET ROLE;

  PERFORM set_config('request.jwt.claims', json_build_object('sub',v_staff::text,'email',v_staff_email,'role','authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    PERFORM ai.restaurant_id FROM public.accept_invite(v_tok) ai;
    RESET ROLE;
    SELECT (
      EXISTS (SELECT 1 FROM public.restaurant_members m WHERE m.user_id=v_staff AND m.restaurant_id=v_rid AND m.role='STAFF' AND m.default_location_id=v_loc)
      AND EXISTS (SELECT 1 FROM public.user_location_assignments u WHERE u.user_id=v_staff AND u.location_id=v_loc AND u.role='STAFF' AND u.can_see_costs=true)
      AND EXISTS (SELECT 1 FROM public.restaurant_invites i WHERE i.invited_email=v_staff_email AND i.status='accepted' AND i.accepted_by=v_staff)
    ) INTO ok;
    INSERT INTO _t VALUES ('new user joins: membership+location created with EXACT invited role/restaurant/location', coalesce(ok,false), '');
  EXCEPTION WHEN OTHERS THEN RESET ROLE; INSERT INTO _t VALUES ('new user joins', false, 'ERROR '||SQLSTATE||' '||SQLERRM); END;

  -- ── Case 2: ALREADY-ACCEPTED (single-use; atomic guard blocks concurrent) → INV03 ──
  PERFORM set_config('request.jwt.claims', json_build_object('sub',v_staff::text,'email',v_staff_email,'role','authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    PERFORM count(*) FROM public.accept_invite(v_tok);
    RESET ROLE; INSERT INTO _t VALUES ('single-use: re-accepting a used token → INV03', false, 'ALLOWED');
  EXCEPTION WHEN OTHERS THEN RESET ROLE; INSERT INTO _t VALUES ('single-use: re-accepting a used token → INV03', SQLSTATE='INV03', 'got '||SQLSTATE); END;

  -- ── Case 3: WRONG EMAIL → INV01, DETAIL carries invited_email ──────────────
  PERFORM set_config('request.jwt.claims', json_build_object('sub',v_owner::text,'email',v_owner_email,'role','authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT token INTO v_tok FROM public.create_invite(v_rid, 'nobody@example.com', 'STAFF'::public.app_role, v_loc);
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', json_build_object('sub',v_staff::text,'email',v_staff_email,'role','authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    PERFORM count(*) FROM public.accept_invite(v_tok);   -- staff's email != nobody@
    RESET ROLE; INSERT INTO _t VALUES ('wrong email → INV01 + DETAIL=invited_email', false, 'ALLOWED');
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_detail = PG_EXCEPTION_DETAIL;
    RESET ROLE;
    INSERT INTO _t VALUES ('wrong email → INV01 + DETAIL=invited_email', (SQLSTATE='INV01' AND v_detail='nobody@example.com'), 'code='||SQLSTATE||' detail='||coalesce(v_detail,'<none>'));
  END;

  -- ── Case 4: EXPIRED → INV02 ────────────────────────────────────────────────
  PERFORM set_config('request.jwt.claims', json_build_object('sub',v_owner::text,'email',v_owner_email,'role','authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT token INTO v_tok FROM public.create_invite(v_rid, 'expired-inv@example.com', 'STAFF'::public.app_role, v_loc);
  RESET ROLE;
  UPDATE public.restaurant_invites SET expires_at = now() - interval '1 hour' WHERE token_hash = sha256(v_tok::bytea);
  PERFORM set_config('request.jwt.claims', json_build_object('sub',v_owner::text,'email',v_owner_email,'role','authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    PERFORM count(*) FROM public.accept_invite(v_tok);
    RESET ROLE; INSERT INTO _t VALUES ('expired invite → INV02', false, 'ALLOWED');
  EXCEPTION WHEN OTHERS THEN RESET ROLE; INSERT INTO _t VALUES ('expired invite → INV02', SQLSTATE='INV02', 'got '||SQLSTATE); END;

  -- ── Case 5: REVOKED → INV04 ────────────────────────────────────────────────
  PERFORM set_config('request.jwt.claims', json_build_object('sub',v_owner::text,'email',v_owner_email,'role','authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT token INTO v_tok FROM public.create_invite(v_rid, 'revoked-inv@example.com', 'STAFF'::public.app_role, v_loc);
  RESET ROLE;
  UPDATE public.restaurant_invites SET status='revoked' WHERE token_hash = sha256(v_tok::bytea);
  PERFORM set_config('request.jwt.claims', json_build_object('sub',v_owner::text,'email',v_owner_email,'role','authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    PERFORM count(*) FROM public.accept_invite(v_tok);
    RESET ROLE; INSERT INTO _t VALUES ('revoked invite → INV04', false, 'ALLOWED');
  EXCEPTION WHEN OTHERS THEN RESET ROLE; INSERT INTO _t VALUES ('revoked invite → INV04', SQLSTATE='INV04', 'got '||SQLSTATE); END;

  -- ── Case 6: NOT-FOUND (unknown token) → INV00 ──────────────────────────────
  PERFORM set_config('request.jwt.claims', json_build_object('sub',v_owner::text,'email',v_owner_email,'role','authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    PERFORM count(*) FROM public.accept_invite('this-token-does-not-exist');
    RESET ROLE; INSERT INTO _t VALUES ('unknown token → INV00', false, 'ALLOWED');
  EXCEPTION WHEN OTHERS THEN RESET ROLE; INSERT INTO _t VALUES ('unknown token → INV00', SQLSTATE='INV00', 'got '||SQLSTATE); END;

  -- ── Case 7: EXISTING MEMBER re-accept → idempotent, role NOT mutated ────────
  PERFORM set_config('request.jwt.claims', json_build_object('sub',v_owner::text,'email',v_owner_email,'role','authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT token INTO v_tok FROM public.create_invite(v_rid, v_manager_email, 'STAFF'::public.app_role, v_loc);
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', json_build_object('sub',v_manager::text,'email',v_manager_email,'role','authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    PERFORM count(*) FROM public.accept_invite(v_tok);
    RESET ROLE;
    SELECT count(*) INTO n FROM public.restaurant_members WHERE user_id=v_manager AND restaurant_id=v_rid;
    SELECT role INTO v_role FROM public.restaurant_members WHERE user_id=v_manager AND restaurant_id=v_rid;
    INSERT INTO _t VALUES ('existing member re-accept: idempotent, no dup, role unchanged (stays MANAGER)', (n=1 AND v_role='MANAGER'), 'count='||n||' role='||v_role);
  EXCEPTION WHEN OTHERS THEN RESET ROLE; INSERT INTO _t VALUES ('existing member re-accept: idempotent', false, 'ERROR '||SQLSTATE||' '||SQLERRM); END;
END $$;
SELECT CASE WHEN pass THEN 'PASS' ELSE 'FAIL' END||'  '||name||'  ('||detail||')' AS result FROM _t;
SELECT count(*) FILTER (WHERE NOT pass)||' failures / '||count(*)||' checks' AS summary FROM _t;
ROLLBACK;
