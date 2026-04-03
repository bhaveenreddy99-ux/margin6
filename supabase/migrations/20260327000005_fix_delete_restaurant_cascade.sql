-- Refresh delete_restaurant_cascade so it removes newer non-cascading
-- restaurant children first, then lets ON DELETE CASCADE handle the rest.

CREATE OR REPLACE FUNCTION public.delete_restaurant_cascade(p_restaurant_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.restaurant_members
    WHERE restaurant_id = p_restaurant_id
      AND user_id = v_user_id
      AND role = 'OWNER'
  ) THEN
    RAISE EXCEPTION 'Only the restaurant owner can delete a restaurant';
  END IF;

  -- Direct restaurant children without ON DELETE CASCADE must be removed first.
  DELETE FROM public.vendor_integrations
  WHERE restaurant_id = p_restaurant_id;

  DELETE FROM public.purchase_history
  WHERE restaurant_id = p_restaurant_id;

  DELETE FROM public.import_runs
  WHERE restaurant_id = p_restaurant_id;

  DELETE FROM public.import_templates
  WHERE restaurant_id = p_restaurant_id;

  DELETE FROM public.inventory_import_files
  WHERE restaurant_id = p_restaurant_id;

  DELETE FROM public.inventory_catalog_items
  WHERE restaurant_id = p_restaurant_id;

  DELETE FROM public.restaurants
  WHERE id = p_restaurant_id;
END;
$function$;

NOTIFY pgrst, 'reload schema';
