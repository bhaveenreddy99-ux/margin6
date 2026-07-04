-- S0-7: Defensive re-assertion of weekly_sales / daily_sales WRITE policies.
--
-- IMPORTANT — THIS IS A NO-OP / ASSERTION MIGRATION, NOT A BUG FIX.
-- The source policies in 20260518000001_sales_entry.sql ALREADY enforce Manager+
-- (has_restaurant_role_any(OWNER,MANAGER)) plus membership + location scoping on
-- every write. The trust-first-roadmap S0-7 / role-permission-matrix G4 claim that
-- these clauses were `is_member_of` (a "lying policy" like purchase_history_items)
-- is STALE/INCORRECT — there is NO leak in source. See
-- docs/investigations/s0-7-weekly-sales-write-rls.md.
--
-- Why ship a migration at all: the deployed database cannot be inspected from the
-- repo. If any environment ever had a looser policy applied (an older draft, or a
-- manual ALTER POLICY), this idempotently DROP/CREATEs the SAME Manager+ write
-- policies so the running DB is GUARANTEED to match correct source in every
-- environment. The conditions below are copied verbatim from 20260518000001 — this
-- migration must not weaken or alter the posture, only re-assert it.
--
-- SELECT (read-gate) policies are intentionally left untouched (out of S0-7 scope).
-- Reuses existing helpers is_member_of / user_can_access_location /
-- has_restaurant_role_any. No app or UI change.

-- ── weekly_sales (write policies) ─────────────────────────────────────────────
DROP POLICY IF EXISTS "Managers+ can insert weekly sales" ON public.weekly_sales;
CREATE POLICY "Managers+ can insert weekly sales"
  ON public.weekly_sales FOR INSERT TO authenticated
  WITH CHECK (
    is_member_of(restaurant_id)
    AND user_can_access_location(auth.uid(), location_id)
    AND has_restaurant_role_any(restaurant_id, ARRAY['OWNER'::public.app_role, 'MANAGER'::public.app_role])
  );

DROP POLICY IF EXISTS "Managers+ can update weekly sales" ON public.weekly_sales;
CREATE POLICY "Managers+ can update weekly sales"
  ON public.weekly_sales FOR UPDATE TO authenticated
  USING (
    is_member_of(restaurant_id)
    AND user_can_access_location(auth.uid(), location_id)
    AND has_restaurant_role_any(restaurant_id, ARRAY['OWNER'::public.app_role, 'MANAGER'::public.app_role])
  )
  WITH CHECK (
    is_member_of(restaurant_id)
    AND user_can_access_location(auth.uid(), location_id)
    AND has_restaurant_role_any(restaurant_id, ARRAY['OWNER'::public.app_role, 'MANAGER'::public.app_role])
  );

DROP POLICY IF EXISTS "Managers+ can delete weekly sales" ON public.weekly_sales;
CREATE POLICY "Managers+ can delete weekly sales"
  ON public.weekly_sales FOR DELETE TO authenticated
  USING (
    is_member_of(restaurant_id)
    AND user_can_access_location(auth.uid(), location_id)
    AND has_restaurant_role_any(restaurant_id, ARRAY['OWNER'::public.app_role, 'MANAGER'::public.app_role])
  );

-- ── daily_sales (write policies) ──────────────────────────────────────────────
DROP POLICY IF EXISTS "Managers+ can insert daily sales" ON public.daily_sales;
CREATE POLICY "Managers+ can insert daily sales"
  ON public.daily_sales FOR INSERT TO authenticated
  WITH CHECK (
    is_member_of(restaurant_id)
    AND user_can_access_location(auth.uid(), location_id)
    AND has_restaurant_role_any(restaurant_id, ARRAY['OWNER'::public.app_role, 'MANAGER'::public.app_role])
  );

DROP POLICY IF EXISTS "Managers+ can update daily sales" ON public.daily_sales;
CREATE POLICY "Managers+ can update daily sales"
  ON public.daily_sales FOR UPDATE TO authenticated
  USING (
    is_member_of(restaurant_id)
    AND user_can_access_location(auth.uid(), location_id)
    AND has_restaurant_role_any(restaurant_id, ARRAY['OWNER'::public.app_role, 'MANAGER'::public.app_role])
  )
  WITH CHECK (
    is_member_of(restaurant_id)
    AND user_can_access_location(auth.uid(), location_id)
    AND has_restaurant_role_any(restaurant_id, ARRAY['OWNER'::public.app_role, 'MANAGER'::public.app_role])
  );

DROP POLICY IF EXISTS "Managers+ can delete daily sales" ON public.daily_sales;
CREATE POLICY "Managers+ can delete daily sales"
  ON public.daily_sales FOR DELETE TO authenticated
  USING (
    is_member_of(restaurant_id)
    AND user_can_access_location(auth.uid(), location_id)
    AND has_restaurant_role_any(restaurant_id, ARRAY['OWNER'::public.app_role, 'MANAGER'::public.app_role])
  );

NOTIFY pgrst, 'reload schema';
