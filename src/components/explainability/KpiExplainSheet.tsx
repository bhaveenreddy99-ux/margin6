import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { KpiConfidenceBadge } from "./KpiConfidenceBadge";
import type { ConfidenceLevel } from "@/domain/dataQuality/types";

export type KpiExplainStep = {
  label: string;
  value: string;
};

export type KpiExplainPayload = {
  title: string;
  resultLabel: string;
  resultValue: string;
  formula: string;
  sourceTables: string[];
  lastUpdated: string;
  confidence: ConfidenceLevel;
  confidenceReasons: string[];
  sourceLines?: KpiExplainStep[];
  calculationSteps?: KpiExplainStep[];
};

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  payload: KpiExplainPayload | null;
};

export function KpiExplainSheet({ open, onOpenChange, payload }: Props) {
  if (!payload) return null;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-lg overflow-y-auto">
        <SheetHeader>
          <SheetTitle>{payload.title}</SheetTitle>
          <SheetDescription>
            How this number is calculated from your restaurant data.
          </SheetDescription>
        </SheetHeader>

        <div className="mt-6 space-y-6">
          <div className="rounded-lg border bg-muted/30 p-4">
            <p className="text-xs text-muted-foreground">{payload.resultLabel}</p>
            <p className="text-2xl font-bold tabular-nums mt-1">{payload.resultValue}</p>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <KpiConfidenceBadge level={payload.confidence} />
              <span className="text-[11px] text-muted-foreground">Updated: {payload.lastUpdated}</span>
            </div>
          </div>

          {payload.sourceLines && payload.sourceLines.length > 0 && (
            <section>
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
                Source data
              </h3>
              <dl className="space-y-2">
                {payload.sourceLines.map((line) => (
                  <div key={line.label} className="flex justify-between gap-4 text-sm">
                    <dt className="text-muted-foreground">{line.label}</dt>
                    <dd className="font-medium tabular-nums text-right">{line.value}</dd>
                  </div>
                ))}
              </dl>
            </section>
          )}

          <section>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
              Formula
            </h3>
            <p className="text-sm font-mono bg-muted/50 rounded-md px-3 py-2">{payload.formula}</p>
          </section>

          {payload.calculationSteps && payload.calculationSteps.length > 0 && (
            <section>
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
                Calculation steps
              </h3>
              <dl className="space-y-2">
                {payload.calculationSteps.map((step) => (
                  <div key={step.label} className="flex justify-between gap-4 text-sm">
                    <dt className="text-muted-foreground">{step.label}</dt>
                    <dd className="font-medium tabular-nums text-right">{step.value}</dd>
                  </div>
                ))}
              </dl>
            </section>
          )}

          <section>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
              Source tables
            </h3>
            <p className="text-sm">{payload.sourceTables.join(", ")}</p>
          </section>

          {payload.confidenceReasons.length > 0 && (
            <section>
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
                Confidence factors
              </h3>
              <ul className="text-sm space-y-1 list-disc pl-4 text-muted-foreground">
                {payload.confidenceReasons.map((reason) => (
                  <li key={reason}>{reason}</li>
                ))}
              </ul>
            </section>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
