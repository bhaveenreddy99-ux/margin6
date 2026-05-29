import { useState } from "react";
import { ChevronRight, Inbox, TrendingDown } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { DrilldownSheet, type DrilldownRow } from "@/components/DrilldownSheet";
import type { ProfitLeakItem, ProfitLeakReason } from "@/domain/dashboard/dashboardTypes";

interface ProfitLeaksCardProps {
  items: ProfitLeakItem[];
  loading: boolean;
}

const REASON_STYLE: Record<ProfitLeakReason, string> = {
  Waste: "bg-rose-100 text-rose-700 dark:bg-rose-950/40 dark:text-rose-200",
  "Price Hike":
    "bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-200",
  Overstock:
    "bg-sky-100 text-sky-700 dark:bg-sky-950/40 dark:text-sky-200",
  Shrinkage:
    "bg-violet-100 text-violet-700 dark:bg-violet-950/40 dark:text-violet-200",
};

const REASON_FORMULA: Record<ProfitLeakReason, string> = {
  Waste:
    "Σ waste_log.total_cost grouped by item_name (period scoped)",
  "Price Hike":
    "Σ (invoiced_unit_cost − po_unit_cost) × invoiced_qty grouped by item_name (status = 'price_mismatch', invoices in period) plus PRICE_INCREASE notifications",
  Overstock:
    "(current_stock − par_level) × unit_cost on the latest APPROVED session, item-by-item",
  Shrinkage:
    "Σ notifications.data.items[].dollar_impact grouped by item_name (type IN 'SHRINK_ALERT','COUNT_VARIANCE')",
};

function formatDollars(n: number, fractionDigits = 0): string {
  return `$${n.toLocaleString(undefined, { maximumFractionDigits: fractionDigits })}`;
}

export function ProfitLeaksCard({ items, loading }: ProfitLeaksCardProps) {
  const [openLeak, setOpenLeak] = useState<ProfitLeakItem | null>(null);

  const drilldownRows: DrilldownRow[] = openLeak?.breakdown ?? [];

  return (
    <>
      <Card>
        <div className="flex items-center gap-2 p-5 pb-3">
          <TrendingDown className="h-4 w-4 text-destructive" />
          <h3 className="text-sm font-bold tracking-tight">Top Profit Leaks</h3>
        </div>
        <CardContent className="pt-0 pb-4 px-5">
          {loading ? (
            <div className="space-y-2">
              {[1, 2, 3, 4, 5].map((i) => (
                <Skeleton key={i} className="h-12 rounded-lg" />
              ))}
            </div>
          ) : items.length === 0 ? (
            <div className="flex flex-col items-center py-10 text-center">
              <Inbox className="h-8 w-8 text-muted-foreground/25 mb-2" />
              <p className="text-sm font-medium text-muted-foreground">
                No leak data yet.
              </p>
              <p className="text-xs text-muted-foreground/70 mt-1">
                Upload an invoice or log waste to populate this list.
              </p>
            </div>
          ) : (
            <ul className="space-y-1.5">
              {items.map((leak, idx) => (
                <li key={`${leak.item_name}-${leak.reason}`}>
                  <button
                    type="button"
                    onClick={() => setOpenLeak(leak)}
                    className="w-full flex items-center gap-3 rounded-lg border border-border/40 px-3 py-2.5 text-left hover:bg-muted/40 hover:border-border transition-colors"
                  >
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-muted text-[11px] font-bold text-muted-foreground tabular-nums">
                      {idx + 1}
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold truncate">
                        {leak.item_name}
                      </p>
                      <span
                        className={`inline-block mt-1 px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wider ${REASON_STYLE[leak.reason]}`}
                      >
                        {leak.reason}
                      </span>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <span className="text-sm font-bold font-mono tabular-nums text-destructive">
                        {formatDollars(leak.total)}
                      </span>
                      <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/60" />
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <DrilldownSheet
        open={openLeak !== null}
        onOpenChange={(o) => {
          if (!o) setOpenLeak(null);
        }}
        title={
          openLeak
            ? `${openLeak.item_name} — ${openLeak.reason}`
            : ""
        }
        rows={drilldownRows}
        formula={openLeak ? REASON_FORMULA[openLeak.reason] : ""}
        loading={false}
      />
    </>
  );
}
