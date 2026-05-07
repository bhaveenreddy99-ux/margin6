import { useRestaurant, type LocationPermissions } from "@/contexts/RestaurantContext";

const allDenied: LocationPermissions = {
  can_approve_orders: false,
  can_see_costs: false,
  can_see_food_cost_pct: false,
  can_see_inventory_value: false,
  can_edit_par: false,
  order_approval_threshold: null,
};

export function useLocationPermissions(): LocationPermissions {
  const { currentRestaurant, currentLocation, locationAssignments, locations } = useRestaurant();

  if (currentRestaurant?.role === "OWNER") {
    return {
      can_approve_orders: true,
      can_see_costs: true,
      can_see_food_cost_pct: true,
      can_see_inventory_value: true,
      can_edit_par: true,
      order_approval_threshold: null,
    };
  }

  if (currentLocation?.id) {
    const assignment = locationAssignments.find((a) => a.location_id === currentLocation.id);
    if (assignment) return assignment.permissions;
    return allDenied;
  }

  const scoped = locationAssignments.filter((a) =>
    locations.some((l) => l.id === a.location_id && l.restaurant_id === currentRestaurant?.id),
  );
  if (scoped.length === 0) return allDenied;

  const primary = scoped.find((a) => a.is_primary);
  return (primary ?? scoped[0]).permissions;
}
