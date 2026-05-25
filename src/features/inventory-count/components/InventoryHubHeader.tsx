import { ChevronRight, Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";

type InventoryHubHeaderProps = {
  hasInProgressSession: boolean;
  onStartOrContinue: () => void;
  /** When true, Start / Continue count is disabled (e.g. no active location available). */
  startActionDisabled?: boolean;
};

export function InventoryHubHeader({
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
