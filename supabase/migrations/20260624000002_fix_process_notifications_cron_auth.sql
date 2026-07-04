-- Prereq for deploying the hardened process-notifications (S0-2): its new handler
-- requires Authorization = 'Bearer <service-role-key>', but the existing
-- process-notifications-hourly cron sends the bare JWT. This rewrites ONLY the
-- Authorization header value to add the 'Bearer ' prefix. The key is read from the
-- current job definition and never appears in this file. Idempotent + reversible.
--
-- ORDERING: apply this BEFORE deploying the new process-notifications edge function.
-- Until both land, the old (un-hardened) function stays live and S0-2 remains open.

DO $$
DECLARE
  v_jobid  bigint;
  v_cmd    text;
BEGIN
  SELECT jobid, command INTO v_jobid, v_cmd
  FROM cron.job
  WHERE jobname = 'process-notifications-hourly';

  IF v_jobid IS NULL THEN
    RAISE EXCEPTION 'cron job process-notifications-hourly not found';
  END IF;

  -- Only act if the Bearer prefix isn't already present (idempotent).
  IF v_cmd !~ '''Authorization'',\s*''Bearer ' THEN
    v_cmd := regexp_replace(
      v_cmd,
      '(''Authorization'',\s*'')(eyJ)',   -- the bare service-role JWT
      '\1Bearer \2'
    );

    PERFORM cron.alter_job(job_id => v_jobid, command => v_cmd);
  END IF;
END $$;
