import { AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Shown in place of a KPI value when its underlying query FAILED (as opposed to a
 * genuine zero). Presentational only — the surrounding row/button wires up the
 * retry so we never nest interactive elements. (Silent-$0 trust fix.)
 */
export function KpiCouldNotLoad({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 text-xs font-medium text-amber-600 dark:text-amber-500",
        className,
      )}
    >
      <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
      Couldn&apos;t calculate — tap to retry
    </span>
  );
}
