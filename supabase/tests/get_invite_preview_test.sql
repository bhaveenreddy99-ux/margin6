-- Slice 4a test (run with Slices 1+2+3+3.5 + get_invite_preview applied). Rolled back.
BEGIN;
CREATE TEMP TABLE _t(name text, pass boolean, detail text);
DO $$
DECLARE
  v_rid uuid := 'aaaaaaaa-0000-0000-0000-000000000001';
  v_owner uuid; v_loc uuid;
  v_id uuid; v_tok text;
  v_email text; v_rname text; v_role public.app_role;
  v_status public.restaurant_invite_status; v_exp timestamptz;
  n int;
BEGIN
  SELECT user_id INTO v_owner FROM public.restaurant_members WHERE restaurant_id=v_rid AND role='OWNER' LIMIT 1;
  SELECT id INTO v_loc FROM public.locations WHERE restaurant_id=v_rid LIMIT 1;

  -- Mint a pending invite as OWNER and capture the plaintext token.
  PERFORM set_config('request.jwt.claims', json_build_object('sub',v_owner::text,'role','authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT invite_id, token INTO v_id, v_tok
    FROM public.create_invite(v_rid,'preview@example.com','STAFF'::public.app_role, v_loc);
  RESET ROLE;

  -- P1: valid token → correct, complete preview row
  SELECT invited_email, restaurant_name, role, status, expires_at
    INTO v_email, v_rname, v_role, v_status, v_exp
    FROM public.get_invite_preview(v_tok);
  INSERT INTO _t VALUES ('preview: valid token returns the invite',
     v_email='preview@example.com' AND v_role='STAFF'::public.app_role
       AND v_status='pending'::public.restaurant_invite_status
       AND v_rname IS NOT NULL AND v_exp > now(),
     coalesce(v_email,'(null)')||' / '||coalesce(v_rname,'(null)')||' / '||coalesce(v_status::text,'(null)'));

  -- P2: garbage / non-matching token → 0 rows (UI treats as invalid link)
  SELECT count(*) INTO n FROM public.get_invite_preview('definitely-not-a-real-token');
  INSERT INTO _t VALUES ('preview: garbage token returns nothing', n=0, 'rows '||n);

  -- P3: callable PRE-AUTH by anon (the not-logged-in new-user path)
  SET LOCAL ROLE anon;
  SELECT count(*) INTO n FROM public.get_invite_preview(v_tok);
  RESET ROLE;
  INSERT INTO _t VALUES ('preview: callable by anon (pre-auth)', n=1, 'rows '||n);

  -- P4: NON-CONSUMING — the invite is still pending after previewing
  SELECT status INTO v_status FROM public.restaurant_invites WHERE id=v_id;
  INSERT INTO _t VALUES ('preview: non-consuming (still pending)',
     v_status='pending'::public.restaurant_invite_status, coalesce(v_status::text,'(null)'));

  -- P5: a revoked invite is still previewable, with status reflecting it (so the
  --     accept page can show "this invite was revoked" instead of a blank dead-end)
  PERFORM set_config('request.jwt.claims', json_build_object('sub',v_owner::text,'role','authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  PERFORM public.revoke_invite(v_id);
  RESET ROLE;
  SELECT status INTO v_status FROM public.get_invite_preview(v_tok);
  INSERT INTO _t VALUES ('preview: revoked invite still previewable w/ status',
     v_status='revoked'::public.restaurant_invite_status, coalesce(v_status::text,'(null)'));
END $$;
SELECT CASE WHEN pass THEN 'PASS' ELSE 'FAIL' END||'  '||name||'  ('||detail||')' AS result FROM _t;
SELECT count(*) FILTER (WHERE NOT pass)||' failures / '||count(*)||' checks' AS summary FROM _t;
ROLLBACK;
