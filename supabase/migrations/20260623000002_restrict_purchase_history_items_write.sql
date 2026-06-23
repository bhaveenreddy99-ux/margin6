-- S0-6: Restrict purchase_history_items writes to Manager+ (fix the lying policy).
--
-- Problem: the INSERT and DELETE policies were NAMED "Manager+ can create/delete
-- purchase history items" but their conditions used is_member_of(...), so any
-- restaurant member — including STAFF — could forge or delete purchase-history line
-- items via the PostgREST API. Those rows hold realized vendor cost/quantity data
-- feeding Period Spend, Food Cost %, and price comparisons. There was also NO UPDATE
-- policy, so the Manager+ invoice-review catalog-mapping update was silently blocked.
--
-- Fix: make the child match the (already-correct) parent purchase_history model —
-- INSERT/UPDATE/DELETE = Manager+ (OWNER/MANAGER); SELECT stays any-member. Reuses
-- existing helpers has_restaurant_role_any / purchase_history_restaurant_id. No app
-- or UI change. Creation via SECURITY DEFINER RPCs (smart-order submit, confirm
-- receipt, PO sync) bypasses RLS and is unaffected; STAFF simply lose the direct
-- table-API write they should never have had.

-- ── INSERT: was is_member_of under a "Manager+" name → now actually Manager+ ──
DROP POLICY IF EXISTS "Manager+ can create purchase history items" ON public.purchase_history_items;
CREATE POLICY "Manager+ can create purchase history items"
  ON public.purchase_history_items FOR INSERT TO authenticated
  WITH CHECK (
    has_restaurant_role_any(
      purchase_history_restaurant_id(purchase_history_id),
      ARRAY['OWNER'::public.app_role, 'MANAGER'::public.app_role]
    )
  );

-- ── DELETE: same fix ─────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Manager+ can delete purchase history items" ON public.purchase_history_items;
CREATE POLICY "Manager+ can delete purchase history items"
  ON public.purchase_history_items FOR DELETE TO authenticated
  USING (
    has_restaurant_role_any(
      purchase_history_restaurant_id(purchase_history_id),
      ARRAY['OWNER'::public.app_role, 'MANAGER'::public.app_role]
    )
  );

-- ── UPDATE: add for parent-parity (repairs the Manager+ invoice-review mapping) ──
DROP POLICY IF EXISTS "Manager+ can update purchase history items" ON public.purchase_history_items;
CREATE POLICY "Manager+ can update purchase history items"
  ON public.purchase_history_items FOR UPDATE TO authenticated
  USING (
    has_restaurant_role_any(
      purchase_history_restaurant_id(purchase_history_id),
      ARRAY['OWNER'::public.app_role, 'MANAGER'::public.app_role]
    )
  )
  WITH CHECK (
    has_restaurant_role_any(
      purchase_history_restaurant_id(purchase_history_id),
      ARRAY['OWNER'::public.app_role, 'MANAGER'::public.app_role]
    )
  );

-- SELECT policy ("Members can view purchase history items", is_member_of) is left
-- unchanged intentionally — any member may view, matching the parent.

NOTIFY pgrst, 'reload schema';
