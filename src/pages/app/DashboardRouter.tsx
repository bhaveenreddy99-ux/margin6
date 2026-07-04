import { lazy, Suspense } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { useRestaurant } from "@/contexts/RestaurantContext";
import { EmployeeDashboard } from "@/pages/app/dashboard/EmployeeDashboard";

// The owner/manager money-dashboard (with useDashboardData inside it) is lazy —
// a STAFF user never triggers this import, so the cost/KPI code is never even
// downloaded to their browser, and its data hook is never called.
const OwnerManagerDashboard = lazy(() => import("@/pages/app/Dashboard"));

function DashboardLoading() {
  return (
    <div className="space-y-4" data-testid="dashboard-loading">
      <Skeleton className="h-10 w-48 rounded-lg" />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {[1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-32 rounded-xl" />
        ))}
      </div>
    </div>
  );
}

/**
 * Adaptive dashboard entry (Phase 0). Branches by restaurant role:
 *  - STAFF        → count-only EmployeeDashboard (no money data fetched).
 *  - OWNER/MANAGER → the existing money dashboard.
 *
 * Trust/security invariant: while the role is still loading we render a neutral
 * loading state and NEVER the money view — a STAFF user must not see it even for
 * a single frame. Because OwnerManagerDashboard is only rendered past the
 * STAFF check, useDashboardData is never invoked for a STAFF user.
 */
export default function DashboardRouter() {
  const { currentRestaurant, loading } = useRestaurant();

  if (loading) {
    return <DashboardLoading />;
  }

  if (currentRestaurant?.role === "STAFF") {
    return <EmployeeDashboard />;
  }

  return (
    <Suspense fallback={<DashboardLoading />}>
      <OwnerManagerDashboard />
    </Suspense>
  );
}
