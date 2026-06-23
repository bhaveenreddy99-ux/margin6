-- S0-8: Stop forged notifications / KPI pollution.
--
-- Problem: the notifications INSERT policy was `is_member_of(restaurant_id)` with
-- no user_id/type/severity guard, so ANY member could forge a notification to any
-- user (incl. CRITICAL alerts) and insert SHRINK_ALERT/COUNT_VARIANCE rows that
-- directly inflate the Shrinkage KPI (loadShrinkageValue.ts sums their
-- data.items[].dollar_impact). The legitimate client flows, however, are
-- cross-user (STAFF → managers for PAR/price requests; low-stock alerts on
-- approval), so a self-only RLS tightening would break real features.
--
-- Fix: route the four legitimate client creates through this SECURITY DEFINER RPC
-- (validates caller membership, filters recipients to members, enforces a strict
-- client type allowlist that EXCLUDES all KPI/server-only types, stamps provenance),
-- then DROP the direct client INSERT policy entirely. Server creators
-- (process-notifications cron, dispatch-app-notifications / inbound-invoice-email
-- edge fns) use the service-role key and bypass RLS — unaffected. The existing
-- BEFORE INSERT dedupe trigger still applies to RPC inserts.

CREATE OR REPLACE FUNCTION public.create_member_notifications(
  p_restaurant_id uuid,
  p_recipient_ids uuid[],
  p_type     text,
  p_severity text,
  p_title    text,
  p_message  text,
  p_data     jsonb DEFAULT '{}'::jsonb
)
RETURNS integer                 -- number of rows attempted (dedupe trigger may drop some)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_count  int  := 0;
  v_rid    uuid;
BEGIN
  -- Caller must be an authenticated member of the target restaurant.
  IF v_caller IS NULL OR NOT is_member_of(p_restaurant_id) THEN
    RAISE EXCEPTION 'not a member of this restaurant';
  END IF;

  -- Client may only create these benign request/alert types. All KPI/server-only
  -- types (SHRINK_ALERT, COUNT_VARIANCE, WEEKLY_DIGEST, PRICE_INCREASE, REMINDER,
  -- COUNT_*, SMART_ORDER_READY, etc.) are rejected here and remain server-only.
  IF p_type NOT IN ('PAR_CHANGE_REQUEST', 'PRICE_CHANGE_REQUEST', 'PAR_SUGGESTIONS', 'LOW_STOCK') THEN
    RAISE EXCEPTION 'notification type % is not allowed from the client', p_type;
  END IF;

  IF p_recipient_ids IS NULL THEN
    RETURN 0;
  END IF;

  FOREACH v_rid IN ARRAY p_recipient_ids LOOP
    -- Recipients must themselves be members of the restaurant.
    IF EXISTS (
      SELECT 1 FROM public.restaurant_members m
      WHERE m.restaurant_id = p_restaurant_id AND m.user_id = v_rid
    ) THEN
      INSERT INTO public.notifications (restaurant_id, user_id, type, severity, title, message, data)
      VALUES (
        p_restaurant_id, v_rid, p_type, p_severity, p_title, p_message,
        coalesce(p_data, '{}'::jsonb) || jsonb_build_object('source_user_id', v_caller)
      );
      v_count := v_count + 1;   -- the dedupe trigger may still silently drop the row
    END IF;
  END LOOP;

  RETURN v_count;
END;
$$;

-- Only authenticated users may execute it (RLS-style entry point); never anon/public.
REVOKE ALL ON FUNCTION public.create_member_notifications(uuid, uuid[], text, text, text, text, jsonb) FROM public;
REVOKE ALL ON FUNCTION public.create_member_notifications(uuid, uuid[], text, text, text, text, jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.create_member_notifications(uuid, uuid[], text, text, text, text, jsonb) TO authenticated;

-- Lock down direct client INSERT: all creation now goes via this RPC (definer) or
-- via the service-role server functions (which bypass RLS). No authenticated INSERT
-- policy remains, so a member can no longer forge notifications directly.
-- SELECT / UPDATE policies (self-only: auth.uid() = user_id) are intentionally kept.
DROP POLICY IF EXISTS "Members can create notifications" ON public.notifications;

NOTIFY pgrst, 'reload schema';
