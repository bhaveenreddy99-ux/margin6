-- Allow members to delete import_runs for their restaurant
CREATE POLICY "Members can delete import runs"
ON public.import_runs
FOR DELETE
USING (is_member_of(restaurant_id));

-- Allow members to delete import_templates for cleanup
-- (already exists, but ensure it's there)

-- Also add delete policy for inventory_import_files if missing
CREATE POLICY "Members can delete import files"
ON public.inventory_import_files
FOR DELETE
USING (is_member_of(restaurant_id));