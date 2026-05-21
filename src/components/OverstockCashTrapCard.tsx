import { Inbox, Package } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import type { OverstockItem } from "@/domain/dashboard/dashboardTypes";

interface OverstockCashTrapCardProps {
  items: OverstockItem[];
}

function formatDollars(n: number): string {
  return `$${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

function formatNumber(n: number): string {
  return n.toLocaleString(undefined, { maximumFractionDigits: 1 });
}

export function OverstockCashTrapCard({ items }: OverstockCashTrapCardProps) {
  const total = items.reduce((acc, it) => acc + (Number.isFinite(it.dollars) ? it.dollars : 0), 0);
  const isEmpty = items.length === 0;

  return (
    <Card>
      <div className="flex items-center gap-2 p-5 pb-3">
        <Package className="h-4 w-4 text-amber-600" />
        <h3 className="text-sm font-bold tracking-tight">Cash Frozen in Overstock</h3>
      </div>
      <CardContent className="pt-0 pb-4 px-5">
        {isEmpty ? (
          <div className="flex flex-col items-center py-10 text-center">
            <Inbox className="h-8 w-8 text-muted-foreground/25 mb-2" />
            <p className="text-sm font-medium text-muted-foreground">
              No overstock detected — inventory is lean
            </p>
          </div>
        ) : (
          <>
            <div className="rounded-lg bg-amber-50/80 border border-amber-200/70 px-3 py-2.5 mb-3 dark:bg-amber-950/25 dark:border-amber-900/40">
              <p className="text-lg font-bold font-mono tabular-nums text-amber-900 dark:text-amber-100">
                {formatDollars(total)}
              </p>
              <p className="text-xs text-amber-800/80 dark:text-amber-200/70 mt-0.5">
                frozen in slow-moving inventory
              </p>
            </div>

            <ul className="space-y-1.5">
              {items.map((item) => (
                <li
                  key={item.item_name}
                  className="flex items-center gap-3 rounded-lg border border-border/40 px-3 py-2"
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold truncate">{item.item_name}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {formatNumber(item.units_over)} units over PAR
                    </p>
                  </div>
                  <span className="text-sm font-bold font-mono tabular-nums text-amber-700 dark:text-amber-300 shrink-0">
                    {formatDollars(item.dollars)}
                  </span>
                </li>
              ))}
            </ul>

            <p className="mt-4 text-xs text-muted-foreground text-center">
              Reduce orders on these items to free up cash
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}
