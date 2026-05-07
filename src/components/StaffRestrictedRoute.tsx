import { useRestaurant } from "@/contexts/RestaurantContext";
import { Navigate } from "react-router-dom";

/**
 * Blocks restaurant_members STAFF from manager/cost-heavy routes.
 * OWNER and MANAGER pass through. Use with current restaurant selected.
 */
export function StaffRestrictedRoute({ children }: { children: React.ReactNode }) {
  const { currentRestaurant, loading } = useRestaurant();

  if (loading) {
    return (
      <div className="flex min-h-[300px] items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    );
  }

  if (currentRestaurant?.role === "STAFF") {
    return <Navigate to="/app/dashboard" replace />;
  }

  return <>{children}</>;
}
