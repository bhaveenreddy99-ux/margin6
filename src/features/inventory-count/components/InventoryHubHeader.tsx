import { ChevronRight, MapPin, Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";

type LocationLike = { id: string; name: string };

type InventoryHubHeaderProps = {
  locations: LocationLike[];
  currentLocation: LocationLike | null | undefined;
  onLocationChange: (loc: LocationLike | null) => void;
  hasInProgressSession: boolean;
  onStartOrContinue: () => void;
  /** When true, Start / Continue count is disabled (e.g. owner must pick a specific location). */
  startActionDisabled?: boolean;
};

export function InventoryHubHeader({
  locations,
  currentLocation,
  onLocationChange,
  hasInProgressSession,
  onStartOrContinue,
  startActionDisabled = false,
}: InventoryHubHeaderProps) {
  return (
    <>
      <Breadcrumb>
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbLink href="/app/dashboard">Home</BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbPage>Inventory Management</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>

      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <h1 className="text-xl lg:text-2xl font-bold tracking-tight">Inventory Management</h1>
          <p className="text-sm text-muted-foreground mt-1 max-w-xl">
            Manage counts, reviews, and history.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 shrink-0">
          {locations.length > 1 && (
            <Select
              value={currentLocation?.id || "all"}
              onValueChange={(v) => {
                if (v === "all") {
                  onLocationChange(null);
                } else {
                  const loc = locations.find((l) => l.id === v);
                  if (loc) onLocationChange(loc);
                }
              }}
            >
              <SelectTrigger className="h-10 w-44 text-xs gap-1.5">
                <MapPin className="h-3.5 w-3.5 shrink-0" />
                <SelectValue placeholder="All locations" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All locations</SelectItem>
                {locations.map((l) => (
                  <SelectItem key={l.id} value={l.id}>
                    {l.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <Button
            className="bg-gradient-orange text-white shadow-orange hover:opacity-90 gap-2 h-10 min-h-11 px-5 text-xs font-semibold"
            disabled={startActionDisabled}
            onClick={onStartOrContinue}
          >
            {hasInProgressSession ? (
              <>
                <ChevronRight className="h-4 w-4" /> Continue count
              </>
            ) : (
              <>
                <Play className="h-4 w-4" /> Start new count
              </>
            )}
          </Button>
        </div>
      </div>
    </>
  );
}
