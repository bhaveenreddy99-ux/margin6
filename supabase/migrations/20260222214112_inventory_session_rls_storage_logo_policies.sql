
-- =============================================
-- FIX 1: Inventory session approval RLS bypass
-- =============================================

-- Drop the overly permissive update policy
DROP POLICY IF EXISTS "Members can update own in-progress sessions" ON public.inventory_sessions;

-- Staff can only update their own IN_PROGRESS sessions (submit for review but not approve)
CREATE POLICY "Staff can update in-progress sessions"
ON public.inventory_sessions
FOR UPDATE
TO authenticated
USING (
  is_member_of(restaurant_id) AND
  status = 'IN_PROGRESS' AND
  created_by = auth.uid()
)
WITH CHECK (
  status IN ('IN_PROGRESS', 'IN_REVIEW')
);

-- Managers and owners can update any session (including approving)
CREATE POLICY "Manager+ can update sessions"
ON public.inventory_sessions
FOR UPDATE
TO authenticated
USING (
  has_restaurant_role_any(restaurant_id, ARRAY['OWNER'::app_role, 'MANAGER'::app_role])
);

-- =============================================
-- FIX 2: Storage bucket policies - restrict to restaurant members
-- =============================================

DROP POLICY IF EXISTS "Managers can upload restaurant logos" ON storage.objects;
DROP POLICY IF EXISTS "Managers can update restaurant logos" ON storage.objects;
DROP POLICY IF EXISTS "Managers can delete restaurant logos" ON storage.objects;

-- Upload: verify membership via folder name = restaurant_id
CREATE POLICY "Members can upload restaurant logos"
ON storage.objects FOR INSERT
WITH CHECK (
  bucket_id = 'restaurant-logos'
  AND auth.uid() IS NOT NULL
  AND is_member_of((storage.foldername(name))[1]::uuid)
);

-- Update: verify membership
CREATE POLICY "Members can update restaurant logos"
ON storage.objects FOR UPDATE
USING (
  bucket_id = 'restaurant-logos'
  AND auth.uid() IS NOT NULL
  AND is_member_of((storage.foldername(name))[1]::uuid)
);

-- Delete: verify membership
CREATE POLICY "Members can delete restaurant logos"
ON storage.objects FOR DELETE
USING (
  bucket_id = 'restaurant-logos'
  AND auth.uid() IS NOT NULL
  AND is_member_of((storage.foldername(name))[1]::uuid)
);
