import type { ConfidenceLevel } from "@/domain/dataQuality/types";
import { confidenceLabel } from "@/domain/dataQuality";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

const levelStyles: Record<ConfidenceLevel, string> = {
  high: "border-success/30 bg-success/10 text-success",
  medium: "border-warning/30 bg-warning/10 text-warning",
  low: "border-destructive/30 bg-destructive/10 text-destructive",
};

type Props = {
  level: ConfidenceLevel;
  className?: string;
  compact?: boolean;
};

export function KpiConfidenceBadge({ level, className, compact }: Props) {
  return (
    <Badge
      variant="outline"
      className={cn(
        "font-normal tabular-nums",
        compact ? "text-[10px] px-1.5 py-0" : "text-[11px]",
        levelStyles[level],
        className,
      )}
    >
      {compact ? level.charAt(0).toUpperCase() + level.slice(1) : confidenceLabel(level)}
    </Badge>
  );
}
