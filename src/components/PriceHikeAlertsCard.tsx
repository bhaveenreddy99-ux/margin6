import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ChevronRight, Inbox, TrendingUp } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { supabase } from "@/integrations/supabase/client";
import { loadPriceIncreaseAlertRows } from "@/domain/dashboard/priceIncreaseFromNotifications";
import type { DashboardTimeFilter } from "@/domain/dashboard/dashboardTypes";

interface PriceHikeAlertsCardProps {
  restaurantId: string;
  locationId: string | null | undefined;
  timeFilter: DashboardTimeFilter;
}

function severityClasses(pct: number): string {
  if (pct > 20) {
    return "bg-rose-100 text-rose-700 border-rose-200 dark:bg-rose-950/40 dark:text-rose-200 dark:border-rose-900/40";
  }
  if (pct >= 10) {
    return "bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-950/40 dark:text-amber-200 dark:border-amber-900/40";
  }
  return "bg-yellow-100 text-yellow-800 border-yellow-200 dark:bg-yellow-950/40 dark:text-yellow-200 dark:border-yellow-900/40";
}

function periodLabel(filter: DashboardTimeFilter): string {
  switch (filter) {
    case "this_week":
      return "this week";
    case "last_week":
      return "last week";
    case "30_days":
      return "last 30 days";
  }
}

export function PriceHikeAlertsCard({
  restaurantId,
  locationId,
  timeFilter,
}: PriceHikeAlertsCardProps) {
  const navigate = useNavigate();
  const [rows, setRows] = useState<Awaited<ReturnType<typeof loadPriceIncreaseAlertRows>>>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const next = await loadPriceIncreaseAlertRows(
          supabase,
          restaurantId,
          locationId,
          timeFilter,
        );
        if (!cancelled) setRows(next);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [restaurantId, locationId, timeFilter]);

  return (
    <Card>
      <div className="flex items-center justify-between p-5 pb-3">
        <div className="flex items-center gap-2">
          <TrendingUp className="h-4 w-4 text-destructive" />
          <h3 className="text-sm font-bold tracking-tight">Price Hike Alerts</h3>
        </div>
        {!loading && rows.length > 0 && (
          <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            {rows.length} price hike{rows.length === 1 ? "" : "s"} {periodLabel(timeFilter)}
          </span>
        )}
      </div>
      <CardContent className="pt-0 pb-4 px-5">
        {loading ? (
          <div className="space-y-2">
            {[1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-12 rounded-lg" />
            ))}
          </div>
        ) : rows.length === 0 ? (
          <div className="flex flex-col items-center py-10 text-center">
            <Inbox className="h-8 w-8 text-muted-foreground/25 mb-2" />
            <p className="text-sm font-medium text-muted-foreground">
              No price hikes detected this period
            </p>
          </div>
        ) : (
          <ul className="space-y-1.5">
            {rows.map((row) => (
              <li key={row.id}>
                <button
                  type="button"
                  onClick={() => navigate("/app/invoices")}
                  className="w-full flex items-center gap-3 rounded-lg border border-border/40 px-3 py-2.5 text-left hover:bg-muted/40 hover:border-border transition-colors"
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold truncate">{row.item_name}</p>
                    <p className="text-xs text-muted-foreground truncate">
                      {row.vendor_name}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span
                      className={`px-1.5 py-0.5 rounded border text-[10px] font-bold ${severityClasses(row.pct_change)}`}
                    >
                      +{row.pct_change.toFixed(1)}%
                    </span>
                    <span className="text-sm font-bold font-mono tabular-nums text-destructive">
                      ${row.dollar_impact.toLocaleString(undefined, { maximumFractionDigits: 0 })}
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
  );
}
