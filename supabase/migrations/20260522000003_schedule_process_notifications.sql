-- Schedule hourly process-notifications (shrinkage, low stock, Monday digest, etc.)
-- Idempotent: unschedule existing job before re-creating.

CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

DO $cron$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'process-notifications-hourly') THEN
    PERFORM cron.unschedule(
      (SELECT jobid FROM cron.job WHERE jobname = 'process-notifications-hourly' LIMIT 1)
    );
  END IF;
END
$cron$;

SELECT cron.schedule(
  'process-notifications-hourly',
  '0 * * * *',
  $$
  SELECT
    net.http_post(
      url := 'https://ogbnctyctoujzdcfphad.supabase.co/functions/v1/process-notifications',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || coalesce(
          current_setting('app.settings.service_role_key', true),
          current_setting('app.service_role_key', true),
          ''
        )
      ),
      body := '{}'::jsonb
    ) AS request_id;
  $$
);
