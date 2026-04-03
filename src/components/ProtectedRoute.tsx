import { useRef } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useRestaurant } from "@/contexts/RestaurantContext";
import { Navigate } from "react-router-dom";

export function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, loading: authLoading } = useAuth();
  const { restaurants, loading: restLoading } = useRestaurant();
  const hasBooted = useRef(false);

  const isLoading = authLoading || restLoading;

  // Mark as booted once we've fully resolved at least once
  if (!isLoading) hasBooted.current = true;

  // Only show full-page spinner on cold start (before any data has loaded)
  if (isLoading && !hasBooted.current) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    );
  }

  // After boot: auth checks run even during background loading (token refresh)
  if (!user) return <Navigate to="/login" replace />;
  if (restaurants.length === 0) return <Navigate to="/demo" replace />;

  return <>{children}</>;
}
