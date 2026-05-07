INSERT INTO public.user_location_assignments (
  user_id, location_id, role, is_primary,
  can_approve_orders, can_see_costs,
  can_see_food_cost_pct, can_see_inventory_value,
  can_edit_par
)
SELECT
  rm.user_id,
  rm.default_location_id,
  rm.role,
  true,
  true, false, true, false, true
FROM public.restaurant_members rm
WHERE rm.role IN ('MANAGER'::public.app_role, 'STAFF'::public.app_role)
  AND rm.default_location_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.user_location_assignments ula
    WHERE ula.user_id = rm.user_id
      AND ula.location_id = rm.default_location_id
  );
