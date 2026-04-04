-- Drop conflicting policy before 
-- workflow migration recreates it.
-- Safe to run multiple times.

DROP POLICY IF EXISTS "Members can update delivery issues" 
  ON public.delivery_issues;
