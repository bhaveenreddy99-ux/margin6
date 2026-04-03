
-- Create a server-side function to cascade-delete a restaurant and all related data
-- Only the OWNER can call this
CREATE OR REPLACE FUNCTION public.delete_restaurant_cascade(p_restaurant_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
BEGIN
  -- Verify caller is OWNER
  IF NOT EXISTS (
    SELECT 1 FROM public.restaurant_members
    WHERE restaurant_id = p_restaurant_id AND user_id = v_user_id AND role = 'OWNER'
  ) THEN
    RAISE EXCEPTION 'Only the restaurant owner can delete a restaurant';
  END IF;

  -- Delete smart_order_run_items via runs
  DELETE FROM public.smart_order_run_items WHERE run_id IN (
    SELECT id FROM public.smart_order_runs WHERE restaurant_id = p_restaurant_id
  );
  DELETE FROM public.smart_order_runs WHERE restaurant_id = p_restaurant_id;

  -- Delete purchase_history_items via purchase_history
  DELETE FROM public.purchase_history_items WHERE purchase_history_id IN (
    SELECT id FROM public.purchase_history WHERE restaurant_id = p_restaurant_id
  );
  DELETE FROM public.purchase_history WHERE restaurant_id = p_restaurant_id;

  -- Delete inventory_session_items via sessions
  DELETE FROM public.inventory_session_items WHERE session_id IN (
    SELECT id FROM public.inventory_sessions WHERE restaurant_id = p_restaurant_id
  );
  DELETE FROM public.inventory_sessions WHERE restaurant_id = p_restaurant_id;

  -- Delete par_guide_items via par_guides
  DELETE FROM public.par_guide_items WHERE par_guide_id IN (
    SELECT id FROM public.par_guides WHERE restaurant_id = p_restaurant_id
  );
  DELETE FROM public.par_guides WHERE restaurant_id = p_restaurant_id;

  -- Delete order_items via orders
  DELETE FROM public.order_items WHERE order_id IN (
    SELECT id FROM public.orders WHERE restaurant_id = p_restaurant_id
  );
  DELETE FROM public.orders WHERE restaurant_id = p_restaurant_id;

  -- Delete custom_list_items via custom_lists
  DELETE FROM public.custom_list_items WHERE list_id IN (
    SELECT id FROM public.custom_lists WHERE restaurant_id = p_restaurant_id
  );
  DELETE FROM public.custom_lists WHERE restaurant_id = p_restaurant_id;

  -- Delete usage_events
  DELETE FROM public.usage_events WHERE restaurant_id = p_restaurant_id;

  -- Delete import data
  DELETE FROM public.import_runs WHERE restaurant_id = p_restaurant_id;
  DELETE FROM public.import_templates WHERE restaurant_id = p_restaurant_id;
  DELETE FROM public.inventory_import_files WHERE restaurant_id = p_restaurant_id;

  -- Delete catalog items
  DELETE FROM public.inventory_catalog_items WHERE restaurant_id = p_restaurant_id;

  -- Delete inventory lists
  DELETE FROM public.inventory_lists WHERE restaurant_id = p_restaurant_id;

  -- Delete locations
  DELETE FROM public.locations WHERE restaurant_id = p_restaurant_id;

  -- Delete settings tables
  DELETE FROM public.restaurant_settings WHERE restaurant_id = p_restaurant_id;
  DELETE FROM public.inventory_settings WHERE restaurant_id = p_restaurant_id;
  DELETE FROM public.par_settings WHERE restaurant_id = p_restaurant_id;
  DELETE FROM public.smart_order_settings WHERE restaurant_id = p_restaurant_id;

  -- Delete members
  DELETE FROM public.restaurant_members WHERE restaurant_id = p_restaurant_id;

  -- Finally delete the restaurant
  DELETE FROM public.restaurants WHERE id = p_restaurant_id;
END;
$function$;
