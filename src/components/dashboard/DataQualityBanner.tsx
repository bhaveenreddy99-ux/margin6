import { Link } from "react-router-dom";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Shield, ChevronRight } from "lucide-react";
import {
  computeDataQualityScore,
  dataQualityBandLabel,
  type DataQualityInput,
} from "@/domain/dataQuality";

type Props = {
  input: DataQualityInput;
};

export function DataQualityBanner({ input }: Props) {
  const result = computeDataQualityScore(input);
  const topIssues = result.issues.slice(0, 3);

  if (result.band === "excellent") {
    return (
      <Alert className="border-success/20 bg-success/5">
        <Shield className="h-4 w-4 text-success" />
        <AlertTitle className="text-sm">
          Data quality: {dataQualityBandLabel(result.band)} ({result.score}/100)
        </AlertTitle>
        <AlertDescription className="text-xs">
          Your dashboard numbers are backed by fresh counts and complete cost data.
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <Alert className="border-amber-200/80 bg-amber-50/80 dark:border-amber-800/60 dark:bg-amber-950/25">
      <Shield className="h-4 w-4 text-amber-700 dark:text-amber-400" />
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 w-full">
        <div>
          <AlertTitle className="text-sm text-amber-950 dark:text-amber-100">
            Data quality: {dataQualityBandLabel(result.band)} ({result.score}/100)
          </AlertTitle>
          <AlertDescription className="text-xs text-amber-900/80 dark:text-amber-100/70 mt-1 space-y-1">
            {topIssues.map((issue) => (
              <span key={issue.code} className="block">
                {issue.message}
              </span>
            ))}
          </AlertDescription>
        </div>
        <Button variant="outline" size="sm" className="shrink-0 h-8 text-xs" asChild>
          <Link to="/app/settings/audit">
            Audit Center
            <ChevronRight className="h-3.5 w-3.5 ml-1" />
          </Link>
        </Button>
      </div>
    </Alert>
  );
}
