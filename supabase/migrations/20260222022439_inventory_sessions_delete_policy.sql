
-- Drop the existing restrictive delete policy that only allows IN_PROGRESS
DROP POLICY "Members can delete in-progress sessions" ON public.inventory_sessions;

-- Create a new policy that allows members to delete any session
CREATE POLICY "Members can delete sessions"
ON public.inventory_sessions
FOR DELETE
USING (is_member_of(restaurant_id));
