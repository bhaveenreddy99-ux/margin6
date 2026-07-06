-- Slice 1 test for restaurant_invites (run against a DB with the migration applied).
-- Proves RLS visibility (OWNER/MANAGER see, STAFF/non-member don't), that writes are
-- DEFINER-only (no client INSERT even as OWNER), and every constraint. Rolled back —
-- persists nothing. Uses the seeded restaurant + its OWNER/MANAGER/STAFF members.
BEGIN;
CREATE TEMP TABLE _t(name text, pass boolean, detail text);
DO $$
DECLARE
  v_rid uuid := 'aaaaaaaa-0000-0000-0000-000000000001';
  v_owner uuid; v_manager uuid; v_staff uuid; v_outsider uuid := gen_random_uuid();
  v_loc uuid; v_invite uuid; n int;
BEGIN
  SELECT user_id INTO v_owner   FROM public.restaurant_members WHERE restaurant_id=v_rid AND role='OWNER'   LIMIT 1;
  SELECT user_id INTO v_manager FROM public.restaurant_members WHERE restaurant_id=v_rid AND role='MANAGER' LIMIT 1;
  SELECT user_id INTO v_staff   FROM public.restaurant_members WHERE restaurant_id=v_rid AND role='STAFF'   LIMIT 1;
  SELECT id      INTO v_loc     FROM public.locations          WHERE restaurant_id=v_rid LIMIT 1;

  -- seed one invite AS postgres (simulates the future SECURITY DEFINER create RPC)
  INSERT INTO public.restaurant_invites (restaurant_id, role, location_id, invited_email, token_hash, expires_at, invited_by)
  VALUES (v_rid, 'STAFF', v_loc, 'newhire@example.com', sha256('tok-1'::bytea), now()+interval '7 days', v_owner)
  RETURNING id INTO v_invite;

  -- ── RLS SELECT visibility ─────────────────────────────────────────────
  PERFORM set_config('request.jwt.claims', json_build_object('sub',v_owner::text,'role','authenticated')::text, true);
  SET LOCAL ROLE authenticated; SELECT count(*) INTO n FROM public.restaurant_invites WHERE id=v_invite; RESET ROLE;
  INSERT INTO _t VALUES ('RLS: OWNER can view invite', n=1, 'saw '||n);

  PERFORM set_config('request.jwt.claims', json_build_object('sub',v_manager::text,'role','authenticated')::text, true);
  SET LOCAL ROLE authenticated; SELECT count(*) INTO n FROM public.restaurant_invites WHERE id=v_invite; RESET ROLE;
  INSERT INTO _t VALUES ('RLS: MANAGER can view invite', n=1, 'saw '||n);

  PERFORM set_config('request.jwt.claims', json_build_object('sub',v_staff::text,'role','authenticated')::text, true);
  SET LOCAL ROLE authenticated; SELECT count(*) INTO n FROM public.restaurant_invites WHERE id=v_invite; RESET ROLE;
  INSERT INTO _t VALUES ('RLS: STAFF (member, not O/M) canNOT view', n=0, 'saw '||n);

  PERFORM set_config('request.jwt.claims', json_build_object('sub',v_outsider::text,'role','authenticated')::text, true);
  SET LOCAL ROLE authenticated; SELECT count(*) INTO n FROM public.restaurant_invites WHERE id=v_invite; RESET ROLE;
  INSERT INTO _t VALUES ('RLS: non-member canNOT view', n=0, 'saw '||n);

  -- ── writes are DEFINER-only: direct client INSERT blocked even for OWNER ──
  PERFORM set_config('request.jwt.claims', json_build_object('sub',v_owner::text,'role','authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    INSERT INTO public.restaurant_invites (restaurant_id, role, location_id, invited_email, token_hash, expires_at, invited_by)
    VALUES (v_rid,'STAFF',v_loc,'x@example.com',sha256('tok-2'::bytea),now()+interval '7 days',v_owner);
    RESET ROLE; INSERT INTO _t VALUES ('WRITE: direct client INSERT blocked (DEFINER-only)', false, 'ALLOWED - should be blocked');
  EXCEPTION WHEN OTHERS THEN RESET ROLE; INSERT INTO _t VALUES ('WRITE: direct client INSERT blocked (DEFINER-only)', true, 'blocked '||SQLSTATE);
  END;

  -- ── CHECK: role can never be OWNER ──
  BEGIN
    INSERT INTO public.restaurant_invites (restaurant_id, role, location_id, invited_email, token_hash, expires_at, invited_by)
    VALUES (v_rid,'OWNER',v_loc,'owner@example.com',sha256('tok-3'::bytea),now()+interval '7 days',v_owner);
    INSERT INTO _t VALUES ('CHECK: role=OWNER rejected', false, 'ALLOWED - CHECK failed');
  EXCEPTION WHEN check_violation THEN INSERT INTO _t VALUES ('CHECK: role=OWNER rejected', true, 'rejected');
  END;

  -- ── CHECK: email must be lowercase ──
  BEGIN
    INSERT INTO public.restaurant_invites (restaurant_id, role, location_id, invited_email, token_hash, expires_at, invited_by)
    VALUES (v_rid,'STAFF',v_loc,'MixedCase@Example.com',sha256('tok-3b'::bytea),now()+interval '7 days',v_owner);
    INSERT INTO _t VALUES ('CHECK: non-lowercase email rejected', false, 'ALLOWED - CHECK failed');
  EXCEPTION WHEN check_violation THEN INSERT INTO _t VALUES ('CHECK: non-lowercase email rejected', true, 'rejected');
  END;

  -- ── UNIQUE: duplicate token_hash rejected ──
  BEGIN
    INSERT INTO public.restaurant_invites (restaurant_id, role, location_id, invited_email, token_hash, expires_at, invited_by)
    VALUES (v_rid,'STAFF',v_loc,'dup-token@example.com',sha256('tok-1'::bytea),now()+interval '7 days',v_owner);
    INSERT INTO _t VALUES ('UNIQUE: duplicate token_hash rejected', false, 'ALLOWED');
  EXCEPTION WHEN unique_violation THEN INSERT INTO _t VALUES ('UNIQUE: duplicate token_hash rejected', true, 'rejected');
  END;

  -- ── PARTIAL-UNIQUE: 2nd PENDING invite for same (restaurant,email) rejected ──
  BEGIN
    INSERT INTO public.restaurant_invites (restaurant_id, role, location_id, invited_email, token_hash, expires_at, invited_by)
    VALUES (v_rid,'STAFF',v_loc,'newhire@example.com',sha256('tok-4'::bytea),now()+interval '7 days',v_owner);
    INSERT INTO _t VALUES ('PARTIAL-UNIQUE: 2nd pending invite same email rejected', false, 'ALLOWED');
  EXCEPTION WHEN unique_violation THEN INSERT INTO _t VALUES ('PARTIAL-UNIQUE: 2nd pending invite same email rejected', true, 'rejected');
  END;

  -- ── PARTIAL-UNIQUE: re-invite allowed once the prior is no longer pending ──
  UPDATE public.restaurant_invites SET status='revoked' WHERE id=v_invite;
  BEGIN
    INSERT INTO public.restaurant_invites (restaurant_id, role, location_id, invited_email, token_hash, expires_at, invited_by)
    VALUES (v_rid,'STAFF',v_loc,'newhire@example.com',sha256('tok-5'::bytea),now()+interval '7 days',v_owner);
    INSERT INTO _t VALUES ('PARTIAL-UNIQUE: re-invite allowed after prior revoked', true, 'allowed');
  EXCEPTION WHEN OTHERS THEN INSERT INTO _t VALUES ('PARTIAL-UNIQUE: re-invite allowed after prior revoked', false, 'blocked '||SQLSTATE);
  END;
END $$;
SELECT CASE WHEN pass THEN 'PASS' ELSE 'FAIL' END||'  '||name||'  ('||detail||')' AS result FROM _t;
SELECT count(*) FILTER (WHERE NOT pass)||' failures / '||count(*)||' checks' AS summary FROM _t;
ROLLBACK;
