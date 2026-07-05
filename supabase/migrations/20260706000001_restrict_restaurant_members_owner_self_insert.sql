-- Close the restaurant_members OWNER self-insert escalation (S0-8 / S1-6 shape).
--
-- The INSERT policy "Owners can insert members" allowed
--   has_restaurant_role(restaurant_id,'OWNER') OR (auth.uid() = user_id)
-- The self-branch (auth.uid() = user_id) constrained NEITHER role NOR restaurant_id,
-- so any authenticated user could self-insert an OWNER row into ANY restaurant —
-- a cross-tenant OWNER takeover, including into an existing already-owned restaurant
-- (proven 3x via rolled-back impersonation on prod). There is no mitigating trigger.
--
-- Fix: drop ONLY the self-branch; keep the legitimate OWNER-role branch (an existing
-- owner may add members to their OWN restaurant). All real member creation flows
-- through SECURITY DEFINER functions (create_restaurant_with_owner, accept_user_invites,
-- accept_pending_invitations) which bypass RLS, and the frontend/edge functions do
-- ZERO direct restaurant_members inserts — so nothing legitimate breaks.

DROP POLICY IF EXISTS "Owners can insert members" ON public.restaurant_members;

CREATE POLICY "Owners can insert members"
  ON public.restaurant_members
  FOR INSERT
  TO authenticated
  WITH CHECK ( has_restaurant_role(restaurant_id, 'OWNER'::public.app_role) );

NOTIFY pgrst, 'reload schema';
