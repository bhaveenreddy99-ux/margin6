-- =============================================================================
-- Notifications deduplication: suppress duplicate inserts within 1 hour.
--
-- Bug: cron-driven publishers (process-notifications) re-fire the same alert
-- on every run, so users see "Inventory Approved — 124 items need attention"
-- three times in a row. There's no DB-side guard, so client-side fixes can
-- only mask the problem.
--
-- Approach: a BEFORE INSERT trigger that quietly drops any insert that has a
-- matching (restaurant_id, user_id, type) row within the last hour. The
-- partial-bucket approach (rather than a UNIQUE constraint) keeps semantics
-- right when the same alert legitimately recurs on a later day.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.notifications_dedupe_within_hour()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.notifications n
    WHERE n.restaurant_id = NEW.restaurant_id
      AND n.user_id       = NEW.user_id
      AND n.type          = NEW.type
      AND n.created_at    > now() - interval '1 hour'
  ) THEN
    -- Skip the duplicate insert. Returning NULL from a BEFORE row trigger
    -- aborts the insert silently — callers still receive a successful response.
    RETURN NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS notifications_dedupe_within_hour ON public.notifications;
CREATE TRIGGER notifications_dedupe_within_hour
BEFORE INSERT ON public.notifications
FOR EACH ROW
EXECUTE FUNCTION public.notifications_dedupe_within_hour();

-- Supporting index so the dedupe check is cheap (sub-ms on hot path).
CREATE INDEX IF NOT EXISTS idx_notifications_dedupe_lookup
  ON public.notifications (restaurant_id, user_id, type, created_at DESC);

NOTIFY pgrst, 'reload schema';
