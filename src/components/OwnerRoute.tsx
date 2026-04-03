import { useRestaurant } from "@/contexts/RestaurantContext";
import { Navigate } from "react-router-dom";

/**
 * Route guard that only allows OWNER role.
 * STAFF and MANAGER are redirected to the dashboard.
 */
export function OwnerRoute({ children }: { children: React.ReactNode }) {
  const { currentRestaurant, loading } = useRestaurant();

  if (loading) {
    return (
      <div className="flex min-h-[300px] items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    );
  }

  if (currentRestaurant?.role !== "OWNER") {
    return <Navigate to="/app/dashboard" replace />;
  }

  return <>{children}</>;
}
