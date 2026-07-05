import { useNavigate } from "react-router-dom";
import { ClipboardList, ArrowRight, MapPin, Building2 } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useRestaurant } from "@/contexts/RestaurantContext";
import { useEmployeeCountStatus } from "@/hooks/useEmployeeCountStatus";

/**
 * STAFF dashboard: the count task ONLY. No money, no KPIs, no P&L. This is what a
 * line employee sees instead of the owner money-dashboard — it both fits the role
 * and closes the staff-sees-owner-dashboard data-exposure hole (this component
 * never mounts useDashboardData, so no cost data is fetched for a STAFF user).
 */
export function EmployeeDashboard() {
  const navigate = useNavigate();
  const { currentRestaurant, currentLocation } = useRestaurant();
  const { loading, lastCountAt, inProgressSessionId } = useEmployeeCountStatus(currentRestaurant?.id);

  const hasLocation = !!currentLocation;
  const resuming = !!inProgressSessionId;

  const lastCountLabel = lastCountAt
    ? `Last count ${formatDistanceToNow(new Date(lastCountAt), { addSuffix: true })}`
    : "No counts yet";

  return (
    <div className="space-y-6 animate-fade-in max-w-lg mx-auto">
      <div className="flex items-center gap-2.5">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 shrink-0">
          <Building2 className="h-5 w-5 text-primary" />
        </div>
        <div className="min-w-0">
          <h1 className="text-xl font-bold tracking-tight font-display truncate">
            {currentRestaurant?.name ?? "Your restaurant"}
          </h1>
          {currentLocation && (
            <p className="text-xs text-muted-foreground flex items-center gap-1">
              <MapPin className="h-3 w-3" /> {currentLocation.name}
            </p>
          )}
        </div>
      </div>

      {!hasLocation ? (
        // Onboarding dead-end guard: don't show a disabled button with no explanation.
        <Card>
          <CardContent className="p-6 text-center space-y-2">
            <ClipboardList className="h-8 w-8 text-muted-foreground mx-auto" />
            <p className="text-sm font-medium">You're not assigned to a location yet</p>
            <p className="text-sm text-muted-foreground">
              Ask your manager to assign you a location so you can start counting.
            </p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-6 flex flex-col items-center text-center gap-4">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10">
              <ClipboardList className="h-7 w-7 text-primary" />
            </div>
            <div className="space-y-1">
              <h2 className="text-base font-semibold">
                {resuming ? "You have a count in progress" : "Ready to count?"}
              </h2>
              <p className="text-sm text-muted-foreground">
                {loading ? (
                  <Skeleton className="inline-block h-4 w-32" />
                ) : resuming ? (
                  "Pick up where you left off."
                ) : (
                  lastCountLabel
                )}
              </p>
            </div>
            <Button
              size="lg"
              className="w-full bg-gradient-amber text-white shadow-amber"
              onClick={() => navigate("/app/inventory/enter")}
            >
              {resuming ? "Continue count" : "Start count"}
              <ArrowRight className="h-4 w-4 ml-1.5" />
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
