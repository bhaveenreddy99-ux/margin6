-- Extend SELECT policies with location-scoped access for MANAGER/STAFF via user_can_access_location.
-- Policy names must match existing migrations exactly.

DROP POLICY IF EXISTS "Members can view sessions" ON public.inventory_sessions;
CREATE POLICY "Members can view sessions"
  ON public.inventory_sessions
  FOR SELECT TO authenticated
  USING (
    is_member_of(restaurant_id)
    AND (
      location_id IS NULL
      OR user_can_access_location(auth.uid(), location_id)
    )
  );

DROP POLICY IF EXISTS "Members can view invoices" ON public.invoices;
CREATE POLICY "Members can view invoices"
  ON public.invoices
  FOR SELECT TO authenticated
  USING (
    is_member_of(restaurant_id)
    AND (
      location_id IS NULL
      OR user_can_access_location(auth.uid(), location_id)
    )
  );

DROP POLICY IF EXISTS "Members can view smart order runs" ON public.smart_order_runs;
CREATE POLICY "Members can view smart order runs"
  ON public.smart_order_runs
  FOR SELECT TO authenticated
  USING (
    is_member_of(restaurant_id)
    AND (
      location_id IS NULL
      OR user_can_access_location(auth.uid(), location_id)
    )
  );

DROP POLICY IF EXISTS "Members can view orders" ON public.orders;
CREATE POLICY "Members can view orders"
  ON public.orders
  FOR SELECT TO authenticated
  USING (
    is_member_of(restaurant_id)
    AND (
      location_id IS NULL
      OR user_can_access_location(auth.uid(), location_id)
    )
  );

DROP POLICY IF EXISTS "waste_log_read" ON public.waste_log;
CREATE POLICY "waste_log_read"
  ON public.waste_log
  FOR SELECT TO authenticated
  USING (
    is_member_of(restaurant_id)
    AND (
      location_id IS NULL
      OR user_can_access_location(auth.uid(), location_id)
    )
  );
