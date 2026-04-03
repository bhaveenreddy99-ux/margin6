
-- Drop the restrictive INSERT policy and recreate as PERMISSIVE
DROP POLICY IF EXISTS "Authenticated users can create restaurants" ON public.restaurants;
CREATE POLICY "Authenticated users can create restaurants"
ON public.restaurants
FOR INSERT
TO authenticated
WITH CHECK (auth.uid() IS NOT NULL);

-- Also fix restaurant_members INSERT policy (same issue)
DROP POLICY IF EXISTS "Owners can insert members" ON public.restaurant_members;
CREATE POLICY "Owners can insert members"
ON public.restaurant_members
FOR INSERT
TO authenticated
WITH CHECK (has_restaurant_role(restaurant_id, 'OWNER'::app_role) OR (auth.uid() = user_id));
