-- Returns all location_ids accessible to a user.
-- OWNER: all active locations in all their restaurants.
-- MANAGER/STAFF: only their assigned locations.
CREATE OR REPLACE FUNCTION
  public.user_accessible_location_ids(p_uid uuid)
RETURNS SETOF uuid
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT l.id
  FROM public.locations l
  JOIN public.restaurant_members rm
    ON rm.restaurant_id = l.restaurant_id
  WHERE rm.user_id = p_uid
    AND rm.role = 'OWNER'::public.app_role
    AND l.is_active = true
  UNION
  SELECT ula.location_id
  FROM public.user_location_assignments ula
  WHERE ula.user_id = p_uid
$$;

CREATE OR REPLACE FUNCTION
  public.user_can_access_location(
    p_uid uuid,
    p_location_id uuid
  )
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT p_location_id IN (
    SELECT * FROM public.user_accessible_location_ids(p_uid)
  )
$$;

CREATE OR REPLACE FUNCTION
  public.get_location_permissions(
    p_uid uuid,
    p_location_id uuid
  )
RETURNS TABLE (
  can_approve_orders boolean,
  can_see_costs boolean,
  can_see_food_cost_pct boolean,
  can_see_inventory_value boolean,
  can_edit_par boolean,
  order_approval_threshold numeric
)
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT
    ula.can_approve_orders,
    ula.can_see_costs,
    ula.can_see_food_cost_pct,
    ula.can_see_inventory_value,
    ula.can_edit_par,
    ula.order_approval_threshold
  FROM public.user_location_assignments ula
  WHERE ula.user_id = p_uid
    AND ula.location_id = p_location_id
$$;

GRANT EXECUTE ON FUNCTION
  public.user_accessible_location_ids(uuid)
  TO authenticated;
GRANT EXECUTE ON FUNCTION
  public.user_can_access_location(uuid, uuid)
  TO authenticated;
GRANT EXECUTE ON FUNCTION
  public.get_location_permissions(uuid, uuid)
  TO authenticated;
