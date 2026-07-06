-- Slice 2 test for create_invite (run with the migration applied). Rolled back.
-- Proves: authorized invites succeed (+ hash-only storage), every unauthorized path
-- is rejected with the right SQLSTATE, validation works, and dedup is a clean error.
BEGIN;
CREATE TEMP TABLE _t(name text, pass boolean, detail text);
DO $$
DECLARE
  v_rid uuid := 'aaaaaaaa-0000-0000-0000-000000000001';
  v_owner uuid; v_manager uuid; v_staff uuid;
  v_loc uuid; v_other_rid uuid := gen_random_uuid();
  v_bad_loc uuid := gen_random_uuid(); v_outsider uuid := gen_random_uuid();
  v_id uuid; v_tok text; n int; ok boolean;
BEGIN
  SELECT user_id INTO v_owner   FROM public.restaurant_members WHERE restaurant_id=v_rid AND role='OWNER'   LIMIT 1;
  SELECT user_id INTO v_manager FROM public.restaurant_members WHERE restaurant_id=v_rid AND role='MANAGER' LIMIT 1;
  SELECT user_id INTO v_staff   FROM public.restaurant_members WHERE restaurant_id=v_rid AND role='STAFF'   LIMIT 1;
  SELECT id      INTO v_loc     FROM public.locations          WHERE restaurant_id=v_rid LIMIT 1;

  -- A) OWNER invites STAFF → success + hash-only storage
  PERFORM set_config('request.jwt.claims', json_build_object('sub',v_owner::text,'role','authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    SELECT ci.invite_id, ci.token INTO v_id, v_tok FROM public.create_invite(v_rid,'staff1@example.com','STAFF'::public.app_role, v_loc) ci;
    RESET ROLE;
    SELECT (token_hash = sha256(v_tok::bytea) AND status='pending' AND invited_email='staff1@example.com'
            AND role='STAFF' AND invited_by=v_owner AND expires_at BETWEEN now()+interval '6 days' AND now()+interval '8 days')
      INTO ok FROM public.restaurant_invites WHERE id=v_id;
    INSERT INTO _t VALUES ('OWNER invites STAFF: succeeds + sha256(token)=stored hash, plaintext not stored', coalesce(ok,false), 'id='||v_id);
  EXCEPTION WHEN OTHERS THEN RESET ROLE; INSERT INTO _t VALUES ('OWNER invites STAFF: succeeds', false, 'ERROR '||SQLSTATE||' '||SQLERRM); END;

  -- B) MANAGER invites STAFF → success
  PERFORM set_config('request.jwt.claims', json_build_object('sub',v_manager::text,'role','authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    SELECT ci.invite_id INTO v_id FROM public.create_invite(v_rid,'staff2@example.com','STAFF'::public.app_role, v_loc) ci;
    RESET ROLE; INSERT INTO _t VALUES ('MANAGER invites STAFF: succeeds', v_id IS NOT NULL, 'id='||v_id);
  EXCEPTION WHEN OTHERS THEN RESET ROLE; INSERT INTO _t VALUES ('MANAGER invites STAFF: succeeds', false, 'ERROR '||SQLSTATE||' '||SQLERRM); END;

  -- C) OWNER invites MANAGER → success
  PERFORM set_config('request.jwt.claims', json_build_object('sub',v_owner::text,'role','authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    SELECT ci.invite_id INTO v_id FROM public.create_invite(v_rid,'mgr1@example.com','MANAGER'::public.app_role, v_loc) ci;
    RESET ROLE; INSERT INTO _t VALUES ('OWNER invites MANAGER: succeeds', v_id IS NOT NULL, 'id='||v_id);
  EXCEPTION WHEN OTHERS THEN RESET ROLE; INSERT INTO _t VALUES ('OWNER invites MANAGER: succeeds', false, 'ERROR '||SQLSTATE||' '||SQLERRM); END;

  -- D) MANAGER invites MANAGER → rejected 42501
  PERFORM set_config('request.jwt.claims', json_build_object('sub',v_manager::text,'role','authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    SELECT count(*) INTO n FROM public.create_invite(v_rid,'m2@example.com','MANAGER'::public.app_role, v_loc);
    RESET ROLE; INSERT INTO _t VALUES ('MANAGER canNOT invite MANAGER (owner-only)', false, 'ALLOWED');
  EXCEPTION WHEN OTHERS THEN RESET ROLE; INSERT INTO _t VALUES ('MANAGER canNOT invite MANAGER (owner-only)', SQLSTATE='42501', 'got '||SQLSTATE); END;

  -- E) STAFF invites STAFF → rejected 42501
  PERFORM set_config('request.jwt.claims', json_build_object('sub',v_staff::text,'role','authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    SELECT count(*) INTO n FROM public.create_invite(v_rid,'s3@example.com','STAFF'::public.app_role, v_loc);
    RESET ROLE; INSERT INTO _t VALUES ('STAFF canNOT invite anyone', false, 'ALLOWED');
  EXCEPTION WHEN OTHERS THEN RESET ROLE; INSERT INTO _t VALUES ('STAFF canNOT invite anyone', SQLSTATE='42501', 'got '||SQLSTATE); END;

  -- F) non-member invites STAFF → rejected 42501
  PERFORM set_config('request.jwt.claims', json_build_object('sub',v_outsider::text,'role','authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    SELECT count(*) INTO n FROM public.create_invite(v_rid,'s4@example.com','STAFF'::public.app_role, v_loc);
    RESET ROLE; INSERT INTO _t VALUES ('non-member canNOT invite', false, 'ALLOWED');
  EXCEPTION WHEN OTHERS THEN RESET ROLE; INSERT INTO _t VALUES ('non-member canNOT invite', SQLSTATE='42501', 'got '||SQLSTATE); END;

  -- G) invite role OWNER → rejected 22023
  PERFORM set_config('request.jwt.claims', json_build_object('sub',v_owner::text,'role','authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    SELECT count(*) INTO n FROM public.create_invite(v_rid,'o@example.com','OWNER'::public.app_role, v_loc);
    RESET ROLE; INSERT INTO _t VALUES ('canNOT invite role=OWNER', false, 'ALLOWED');
  EXCEPTION WHEN OTHERS THEN RESET ROLE; INSERT INTO _t VALUES ('canNOT invite role=OWNER', SQLSTATE='22023', 'got '||SQLSTATE); END;

  -- H) OWNER invites into a restaurant they are NOT owner/manager of → rejected 42501
  PERFORM set_config('request.jwt.claims', json_build_object('sub',v_owner::text,'role','authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    SELECT count(*) INTO n FROM public.create_invite(v_other_rid,'x@example.com','STAFF'::public.app_role, v_loc);
    RESET ROLE; INSERT INTO _t VALUES ('canNOT invite into a restaurant you are not O/M of', false, 'ALLOWED');
  EXCEPTION WHEN OTHERS THEN RESET ROLE; INSERT INTO _t VALUES ('canNOT invite into a restaurant you are not O/M of', SQLSTATE='42501', 'got '||SQLSTATE); END;

  -- I) location not belonging to the restaurant → rejected 22023
  PERFORM set_config('request.jwt.claims', json_build_object('sub',v_owner::text,'role','authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    SELECT count(*) INTO n FROM public.create_invite(v_rid,'x2@example.com','STAFF'::public.app_role, v_bad_loc);
    RESET ROLE; INSERT INTO _t VALUES ('location must belong to the restaurant', false, 'ALLOWED');
  EXCEPTION WHEN OTHERS THEN RESET ROLE; INSERT INTO _t VALUES ('location must belong to the restaurant', SQLSTATE='22023', 'got '||SQLSTATE); END;

  -- J) malformed email → rejected 22023
  PERFORM set_config('request.jwt.claims', json_build_object('sub',v_owner::text,'role','authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    SELECT count(*) INTO n FROM public.create_invite(v_rid,'notanemail','STAFF'::public.app_role, v_loc);
    RESET ROLE; INSERT INTO _t VALUES ('malformed email rejected', false, 'ALLOWED');
  EXCEPTION WHEN OTHERS THEN RESET ROLE; INSERT INTO _t VALUES ('malformed email rejected', SQLSTATE='22023', 'got '||SQLSTATE); END;

  -- K) dedup: second pending invite same restaurant+email → clean 23505
  PERFORM set_config('request.jwt.claims', json_build_object('sub',v_owner::text,'role','authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    PERFORM ci.invite_id FROM public.create_invite(v_rid,'dupe@example.com','STAFF'::public.app_role, v_loc) ci;   -- first ok
    SELECT count(*) INTO n FROM public.create_invite(v_rid,'dupe@example.com','STAFF'::public.app_role, v_loc);     -- second dup
    RESET ROLE; INSERT INTO _t VALUES ('duplicate pending invite → clean 23505', false, 'ALLOWED 2nd');
  EXCEPTION WHEN OTHERS THEN RESET ROLE; INSERT INTO _t VALUES ('duplicate pending invite → clean 23505', SQLSTATE='23505', 'got '||SQLSTATE); END;
END $$;
SELECT CASE WHEN pass THEN 'PASS' ELSE 'FAIL' END||'  '||name||'  ('||detail||')' AS result FROM _t;
SELECT count(*) FILTER (WHERE NOT pass)||' failures / '||count(*)||' checks' AS summary FROM _t;
ROLLBACK;
