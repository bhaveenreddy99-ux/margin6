-- Slice 3.5 test (run with Slices 1+2+3+3.5 applied). Rolled back.
BEGIN;
CREATE TEMP TABLE _t(name text, pass boolean, detail text);
DO $$
DECLARE
  v_rid uuid := 'aaaaaaaa-0000-0000-0000-000000000001';
  v_owner uuid; v_manager uuid; v_staff uuid;
  v_owner_email text; v_manager_email text; v_staff_email text; v_loc uuid;
  v_id uuid; v_tok text; v_tok2 text; n int; ok boolean; v_hash bytea; v_exp timestamptz;
  v_rm_id uuid; v_vm_id uuid; v_v2_id uuid; v_acc_id uuid;
BEGIN
  SELECT user_id INTO v_owner   FROM public.restaurant_members WHERE restaurant_id=v_rid AND role='OWNER'   LIMIT 1;
  SELECT user_id INTO v_manager FROM public.restaurant_members WHERE restaurant_id=v_rid AND role='MANAGER' LIMIT 1;
  SELECT user_id INTO v_staff   FROM public.restaurant_members WHERE restaurant_id=v_rid AND role='STAFF'   LIMIT 1;
  SELECT lower(email) INTO v_owner_email   FROM auth.users WHERE id=v_owner;
  SELECT lower(email) INTO v_manager_email FROM auth.users WHERE id=v_manager;
  SELECT lower(email) INTO v_staff_email   FROM auth.users WHERE id=v_staff;
  SELECT id INTO v_loc FROM public.locations WHERE restaurant_id=v_rid LIMIT 1;

  -- ===== LIST =====
  PERFORM set_config('request.jwt.claims', json_build_object('sub',v_owner::text,'role','authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  PERFORM public.create_invite(v_rid,'list1@example.com','STAFF'::public.app_role, v_loc);
  PERFORM public.create_invite(v_rid,'list2@example.com','STAFF'::public.app_role, v_loc);
  -- L1: OWNER lists
  SELECT count(*) INTO n FROM public.list_invites(v_rid) WHERE invited_email IN ('list1@example.com','list2@example.com');
  RESET ROLE;
  INSERT INTO _t VALUES ('list: OWNER sees pending invites', n=2, 'saw '||n);

  -- L2: MANAGER lists
  PERFORM set_config('request.jwt.claims', json_build_object('sub',v_manager::text,'role','authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO n FROM public.list_invites(v_rid);
  RESET ROLE;
  INSERT INTO _t VALUES ('list: MANAGER sees invites', n>=2, 'saw '||n);

  -- L3: non-member rejected
  PERFORM set_config('request.jwt.claims', json_build_object('sub',gen_random_uuid()::text,'role','authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    SELECT count(*) INTO n FROM public.list_invites(v_rid);
    RESET ROLE; INSERT INTO _t VALUES ('list: non-member rejected', false, 'ALLOWED');
  EXCEPTION WHEN OTHERS THEN RESET ROLE; INSERT INTO _t VALUES ('list: non-member rejected', SQLSTATE='42501', 'got '||SQLSTATE); END;

  -- ===== RESEND =====
  -- R1: OWNER resends STAFF → fresh token, old token dies (INV00), expiry reset
  PERFORM set_config('request.jwt.claims', json_build_object('sub',v_owner::text,'role','authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT invite_id, token INTO v_id, v_tok FROM public.create_invite(v_rid,'r1@example.com','STAFF'::public.app_role, v_loc);
  SELECT token INTO v_tok2 FROM public.resend_invite(v_id);   -- fresh token
  RESET ROLE;
  SELECT token_hash, expires_at INTO v_hash, v_exp FROM public.restaurant_invites WHERE id=v_id;
  ok := (v_hash = sha256(v_tok2::bytea)) AND (v_hash <> sha256(v_tok::bytea))
        AND (v_exp BETWEEN now()+interval '6 days' AND now()+interval '8 days');
  INSERT INTO _t VALUES ('resend: rotates token + resets expiry', ok, '');
  -- old token no longer accepts
  PERFORM set_config('request.jwt.claims', json_build_object('sub',v_owner::text,'email',v_owner_email,'role','authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    PERFORM count(*) FROM public.accept_invite(v_tok);   -- OLD token
    RESET ROLE; INSERT INTO _t VALUES ('resend: OLD token no longer works → INV00', false, 'ALLOWED');
  EXCEPTION WHEN OTHERS THEN RESET ROLE; INSERT INTO _t VALUES ('resend: OLD token no longer works → INV00', SQLSTATE='INV00', 'got '||SQLSTATE); END;

  -- R2: MANAGER resends a STAFF invite → ok
  PERFORM set_config('request.jwt.claims', json_build_object('sub',v_owner::text,'role','authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT invite_id INTO v_id FROM public.create_invite(v_rid,'r2@example.com','STAFF'::public.app_role, v_loc);
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', json_build_object('sub',v_manager::text,'role','authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    PERFORM token FROM public.resend_invite(v_id);
    RESET ROLE; INSERT INTO _t VALUES ('resend: MANAGER can resend a STAFF invite', true, 'ok');
  EXCEPTION WHEN OTHERS THEN RESET ROLE; INSERT INTO _t VALUES ('resend: MANAGER can resend a STAFF invite', false, 'ERR '||SQLSTATE); END;

  -- R3/R4: MANAGER invite — manager canNOT resend, owner CAN
  PERFORM set_config('request.jwt.claims', json_build_object('sub',v_owner::text,'role','authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT invite_id INTO v_rm_id FROM public.create_invite(v_rid,'rm@example.com','MANAGER'::public.app_role, v_loc);
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', json_build_object('sub',v_manager::text,'role','authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    PERFORM token FROM public.resend_invite(v_rm_id);
    RESET ROLE; INSERT INTO _t VALUES ('resend scoping: MANAGER canNOT resend a MANAGER invite', false, 'ALLOWED');
  EXCEPTION WHEN OTHERS THEN RESET ROLE; INSERT INTO _t VALUES ('resend scoping: MANAGER canNOT resend a MANAGER invite', SQLSTATE='42501', 'got '||SQLSTATE); END;
  PERFORM set_config('request.jwt.claims', json_build_object('sub',v_owner::text,'role','authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    PERFORM token FROM public.resend_invite(v_rm_id);
    RESET ROLE; INSERT INTO _t VALUES ('resend scoping: OWNER CAN resend a MANAGER invite', true, 'ok');
  EXCEPTION WHEN OTHERS THEN RESET ROLE; INSERT INTO _t VALUES ('resend scoping: OWNER CAN resend a MANAGER invite', false, 'ERR '||SQLSTATE); END;

  -- R5: resend an ACCEPTED invite → INV03
  PERFORM set_config('request.jwt.claims', json_build_object('sub',v_owner::text,'role','authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT invite_id, token INTO v_acc_id, v_tok FROM public.create_invite(v_rid, v_staff_email, 'STAFF'::public.app_role, v_loc);
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', json_build_object('sub',v_staff::text,'email',v_staff_email,'role','authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  PERFORM ai.restaurant_id FROM public.accept_invite(v_tok) ai;   -- now accepted
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', json_build_object('sub',v_owner::text,'role','authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    PERFORM token FROM public.resend_invite(v_acc_id);
    RESET ROLE; INSERT INTO _t VALUES ('resend: accepted invite rejected → INV03', false, 'ALLOWED');
  EXCEPTION WHEN OTHERS THEN RESET ROLE; INSERT INTO _t VALUES ('resend: accepted invite rejected → INV03', SQLSTATE='INV03', 'got '||SQLSTATE); END;

  -- R6: resend a REVOKED invite → INV04
  PERFORM set_config('request.jwt.claims', json_build_object('sub',v_owner::text,'role','authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT invite_id INTO v_id FROM public.create_invite(v_rid,'r6@example.com','STAFF'::public.app_role, v_loc);
  PERFORM public.revoke_invite(v_id);
  BEGIN
    PERFORM token FROM public.resend_invite(v_id);
    RESET ROLE; INSERT INTO _t VALUES ('resend: revoked invite rejected → INV04', false, 'ALLOWED');
  EXCEPTION WHEN OTHERS THEN RESET ROLE; INSERT INTO _t VALUES ('resend: revoked invite rejected → INV04', SQLSTATE='INV04', 'got '||SQLSTATE); END;

  -- ===== REVOKE =====
  -- V1: OWNER revokes STAFF → accept with that token now INV04
  PERFORM set_config('request.jwt.claims', json_build_object('sub',v_owner::text,'role','authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT invite_id, token INTO v_id, v_tok FROM public.create_invite(v_rid,'v1@example.com','STAFF'::public.app_role, v_loc);
  PERFORM public.revoke_invite(v_id);
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', json_build_object('sub',v_owner::text,'email',v_owner_email,'role','authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    PERFORM count(*) FROM public.accept_invite(v_tok);
    RESET ROLE; INSERT INTO _t VALUES ('revoke: token then accept → INV04', false, 'ALLOWED');
  EXCEPTION WHEN OTHERS THEN RESET ROLE; INSERT INTO _t VALUES ('revoke: token then accept → INV04', SQLSTATE='INV04', 'got '||SQLSTATE); END;

  -- V2: MANAGER revokes a STAFF invite → ok
  PERFORM set_config('request.jwt.claims', json_build_object('sub',v_owner::text,'role','authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT invite_id INTO v_v2_id FROM public.create_invite(v_rid,'v2@example.com','STAFF'::public.app_role, v_loc);
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', json_build_object('sub',v_manager::text,'role','authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    PERFORM public.revoke_invite(v_v2_id);
    RESET ROLE;
    SELECT (status='revoked') INTO ok FROM public.restaurant_invites WHERE id=v_v2_id;
    INSERT INTO _t VALUES ('revoke: MANAGER can revoke a STAFF invite', ok, '');
  EXCEPTION WHEN OTHERS THEN RESET ROLE; INSERT INTO _t VALUES ('revoke: MANAGER can revoke a STAFF invite', false, 'ERR '||SQLSTATE); END;

  -- V3/V4: MANAGER invite — manager canNOT revoke, owner CAN
  PERFORM set_config('request.jwt.claims', json_build_object('sub',v_owner::text,'role','authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT invite_id INTO v_vm_id FROM public.create_invite(v_rid,'vm@example.com','MANAGER'::public.app_role, v_loc);
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', json_build_object('sub',v_manager::text,'role','authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    PERFORM public.revoke_invite(v_vm_id);
    RESET ROLE; INSERT INTO _t VALUES ('revoke scoping: MANAGER canNOT revoke a MANAGER invite', false, 'ALLOWED');
  EXCEPTION WHEN OTHERS THEN RESET ROLE; INSERT INTO _t VALUES ('revoke scoping: MANAGER canNOT revoke a MANAGER invite', SQLSTATE='42501', 'got '||SQLSTATE); END;
  PERFORM set_config('request.jwt.claims', json_build_object('sub',v_owner::text,'role','authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    PERFORM public.revoke_invite(v_vm_id);
    RESET ROLE; INSERT INTO _t VALUES ('revoke scoping: OWNER CAN revoke a MANAGER invite', true, 'ok');
  EXCEPTION WHEN OTHERS THEN RESET ROLE; INSERT INTO _t VALUES ('revoke scoping: OWNER CAN revoke a MANAGER invite', false, 'ERR '||SQLSTATE); END;

  -- V5: revoke an already-revoked invite → clean no-op
  PERFORM set_config('request.jwt.claims', json_build_object('sub',v_owner::text,'role','authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    PERFORM public.revoke_invite(v_v2_id);   -- already revoked
    RESET ROLE; INSERT INTO _t VALUES ('revoke: already-revoked is a clean no-op', true, 'ok');
  EXCEPTION WHEN OTHERS THEN RESET ROLE; INSERT INTO _t VALUES ('revoke: already-revoked is a clean no-op', false, 'ERR '||SQLSTATE); END;

  -- V6: revoke an ACCEPTED invite → INV03
  PERFORM set_config('request.jwt.claims', json_build_object('sub',v_owner::text,'role','authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    PERFORM public.revoke_invite(v_acc_id);   -- accepted earlier
    RESET ROLE; INSERT INTO _t VALUES ('revoke: accepted invite rejected → INV03', false, 'ALLOWED');
  EXCEPTION WHEN OTHERS THEN RESET ROLE; INSERT INTO _t VALUES ('revoke: accepted invite rejected → INV03', SQLSTATE='INV03', 'got '||SQLSTATE); END;
END $$;
SELECT CASE WHEN pass THEN 'PASS' ELSE 'FAIL' END||'  '||name||'  ('||detail||')' AS result FROM _t;
SELECT count(*) FILTER (WHERE NOT pass)||' failures / '||count(*)||' checks' AS summary FROM _t;
ROLLBACK;
