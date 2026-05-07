-- Allow restaurant members to read profiles of teammates in the same restaurant.
-- Without this, nested selects like restaurant_members(...profiles(...)) fail for owners/managers,
-- breaking useLocationSettings and Locations & Team.

CREATE POLICY "Members can view co-member profiles"
  ON public.profiles
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.restaurant_members rm_self
      INNER JOIN public.restaurant_members rm_other
        ON rm_other.restaurant_id = rm_self.restaurant_id
       AND rm_other.user_id = public.profiles.id
      WHERE rm_self.user_id = auth.uid()
    )
  );

COMMENT ON POLICY "Members can view co-member profiles" ON public.profiles IS
  'Team directory: same-restaurant members can read each other''s profile rows (e.g. email, full_name).';
