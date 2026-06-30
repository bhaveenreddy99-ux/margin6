-- S1-6: Restrict par_guide_items writes to Manager+ (fix the lying policy).
--
-- Problem: the INSERT / UPDATE / DELETE policies were NAMED "Manager+ can ... PAR
-- items" but their conditions used is_member_of(par_guide_restaurant_id(...)), so
-- any restaurant member — including STAFF — could create, edit, or delete PAR
-- levels via the PostgREST API. PAR levels are the targets that drive reorder /
-- smart-order quantities, so a STAFF user could silently distort ordering.
--
-- Fix: make the child match the (already-correct) parent par_guides — all three
-- writes = Manager+ (OWNER/MANAGER); SELECT stays any-member. Same pattern as the
-- purchase_history_items fix (20260623000002). Reuses existing helpers
-- has_restaurant_role_any / par_guide_restaurant_id. No app or UI change.
--
-- NOTE: the user asked specifically about the UPDATE ("edit PAR") policy; this
-- migration also tightens INSERT and DELETE, which were open under the same lying
-- name — leaving them as is_member_of would still let STAFF add/remove PAR items.

DROP POLICY IF EXISTS "Manager+ can create PAR items" ON public.par_guide_items;
CREATE POLICY "Manager+ can create PAR items"
  ON public.par_guide_items FOR INSERT TO authenticated
  WITH CHECK (
    has_restaurant_role_any(
      par_guide_restaurant_id(par_guide_id),
      ARRAY['OWNER'::public.app_role, 'MANAGER'::public.app_role]
    )
  );

DROP POLICY IF EXISTS "Manager+ can update PAR items" ON public.par_guide_items;
CREATE POLICY "Manager+ can update PAR items"
  ON public.par_guide_items FOR UPDATE TO authenticated
  USING (
    has_restaurant_role_any(
      par_guide_restaurant_id(par_guide_id),
      ARRAY['OWNER'::public.app_role, 'MANAGER'::public.app_role]
    )
  )
  WITH CHECK (
    has_restaurant_role_any(
      par_guide_restaurant_id(par_guide_id),
      ARRAY['OWNER'::public.app_role, 'MANAGER'::public.app_role]
    )
  );

DROP POLICY IF EXISTS "Manager+ can delete PAR items" ON public.par_guide_items;
CREATE POLICY "Manager+ can delete PAR items"
  ON public.par_guide_items FOR DELETE TO authenticated
  USING (
    has_restaurant_role_any(
      par_guide_restaurant_id(par_guide_id),
      ARRAY['OWNER'::public.app_role, 'MANAGER'::public.app_role]
    )
  );

-- SELECT policy ("Members can view PAR items", is_member_of) is left unchanged
-- intentionally — any member may view PAR.

NOTIFY pgrst, 'reload schema';
