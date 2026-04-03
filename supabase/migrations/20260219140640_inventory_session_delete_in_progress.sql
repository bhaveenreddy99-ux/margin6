-- Allow members to delete in-progress sessions
CREATE POLICY "Members can delete in-progress sessions"
ON public.inventory_sessions
FOR DELETE
USING (
  is_member_of(restaurant_id)
  AND status = 'IN_PROGRESS'
);