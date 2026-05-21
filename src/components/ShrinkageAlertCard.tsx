import { useEffect, useMemo, useState } from "react";
import { formatDistanceToNow } from "date-fns";
import { AlertTriangle, ChevronRight, Inbox } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { DrilldownSheet, type DrilldownRow } from "@/components/DrilldownSheet";
import { supabase } from "@/integrations/supabase/client";
import { dashboardSpendRangeFromFilter } from "@/domain/dashboard/dashboardSelectors";
import type { DashboardTimeFilter } from "@/domain/dashboard/dashboardTypes";

interface ShrinkageAlertCardProps {
  restaurantId: string;
  locationId: string | null | undefined;
  timeFilter: DashboardTimeFilter;
}

type ShrinkType = "HIGH_USAGE" | "COUNT_VARIANCE" | "OTHER";

type ShrinkRow = {
  key: string;
  notification_id: string;
  item_name: string;
  type: ShrinkType;
  dollar_impact: number;
  created_at: string;
  parent_label: string;
  parent_breakdown: DrilldownRow[];
};

function fmtDollars(n: number): string {
  return `$${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

function typeBadge(t: ShrinkType): { text: string; classes: string } {
  if (t === "HIGH_USAGE") {
    return {
      text: "Abnormal Usage",
      classes:
        "bg-rose-100 text-rose-700 border-rose-200 dark:bg-rose-950/40 dark:text-rose-200 dark:border-rose-900/40",
    };
  }
  if (t === "COUNT_VARIANCE") {
    return {
      text: "Count Gap",
      classes:
        "bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-950/40 dark:text-amber-200 dark:border-amber-900/40",
    };
  }
  return {
    text: "Variance",
    classes:
      "bg-muted text-muted-foreground border-border",
  };
}

function fmtAgo(value: string): string {
  try {
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return "—";
    return formatDistanceToNow(d, { addSuffix: true });
  } catch {
    return "—";
  }
}

export function ShrinkageAlertCard({
  restaurantId,
  locationId,
  timeFilter,
}: ShrinkageAlertCardProps) {
  const [rows, setRows] = useState<ShrinkRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [openRow, setOpenRow] = useState<ShrinkRow | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const { startDate, endDate } = dashboardSpendRangeFromFilter(timeFilter);
        let q = supabase
          .from("notifications")
          .select("id, created_at, type, title, data")
          .eq("restaurant_id", restaurantId)
          .in("type", ["SHRINK_ALERT", "COUNT_VARIANCE"])
          .gte("created_at", startDate)
          .lte("created_at", endDate)
          .order("created_at", { ascending: false })
          .limit(10);
        if (locationId) q = q.eq("location_id", locationId);

        const { data } = (await q) as unknown as {
          data: Array<{
            id: string;
            created_at: string | null;
            type: string | null;
            title: string | null;
            data: { items?: unknown } | null;
          }> | null;
        };

        if (cancelled) return;

        const next: ShrinkRow[] = [];
        for (const n of data ?? []) {
          const itemsRaw = Array.isArray(n.data?.items) ? n.data.items : [];
          const items = (itemsRaw as Array<{
            item_name?: string;
            dollar_impact?: number | string;
            type?: string;
          }>);

          const parentBreakdown: DrilldownRow[] = items
            .map((it) => {
              const impact = Number(it?.dollar_impact);
              return {
                label: (it?.item_name ?? "—").toString(),
                value: Number.isFinite(impact) && impact > 0 ? impact : 0,
                date: fmtAgo(n.created_at ?? ""),
                source: it?.type ?? n.type ?? "shrinkage",
              };
            })
            .filter((r) => r.value > 0);

          for (let i = 0; i < items.length; i++) {
            const it = items[i];
            const impact = Number(it?.dollar_impact);
            if (!Number.isFinite(impact) || impact <= 0) continue;
            const rawType = (it?.type ?? "").toString();
            const normalized: ShrinkType =
              rawType === "HIGH_USAGE"
                ? "HIGH_USAGE"
                : rawType === "COUNT_VARIANCE"
                  ? "COUNT_VARIANCE"
                  : "OTHER";
            next.push({
              key: `${n.id}-${i}`,
              notification_id: n.id,
              item_name: (it?.item_name ?? "—").toString(),
              type: normalized,
              dollar_impact: impact,
              created_at: n.created_at ?? new Date().toISOString(),
              parent_label: n.title ?? "Variance event",
              parent_breakdown: parentBreakdown,
            });
          }
        }
        next.sort((a, b) => b.dollar_impact - a.dollar_impact);
        setRows(next);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [restaurantId, locationId, timeFilter]);

  const totalImpact = useMemo(
    () => rows.reduce((acc, r) => acc + r.dollar_impact, 0),
    [rows],
  );

  return (
    <>
      <Card>
        <div className="flex items-start justify-between p-5 pb-3 gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-amber-600" />
              <h3 className="text-sm font-bold tracking-tight">Variance & Shrinkage</h3>
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              Items where counted stock doesn't match expected usage
            </p>
          </div>
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
                No variance detected — counts are matching expected usage
              </p>
            </div>
          ) : (
            <>
              <ul className="space-y-1.5">
                {rows.map((row) => {
                  const badge = typeBadge(row.type);
                  return (
                    <li key={row.key}>
                      <button
                        type="button"
                        onClick={() => setOpenRow(row)}
                        className="w-full flex items-center gap-3 rounded-lg border border-border/40 px-3 py-2.5 text-left hover:bg-muted/40 hover:border-border transition-colors"
                      >
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold truncate">{row.item_name}</p>
                          <div className="flex items-center gap-2 mt-1">
                            <span
                              className={`px-1.5 py-0.5 rounded border text-[10px] font-bold ${badge.classes}`}
                            >
                              {badge.text}
                            </span>
                            <span className="text-[11px] text-muted-foreground">
                              {fmtAgo(row.created_at)}
                            </span>
                          </div>
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          <span className="text-sm font-bold font-mono tabular-nums text-amber-700 dark:text-amber-300">
                            {fmtDollars(row.dollar_impact)}
                          </span>
                          <span className="text-[10px] uppercase tracking-wider text-muted-foreground/70">
                            unaccounted
                          </span>
                          <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/60 ml-1" />
                        </div>
                      </button>
                    </li>
                  );
                })}
              </ul>
              <div className="mt-4 border-t pt-3 flex items-center justify-between">
                <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Total
                </span>
                <span className="text-base font-bold font-mono tabular-nums text-amber-700 dark:text-amber-300">
                  {fmtDollars(totalImpact)} total unaccounted this period
                </span>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <DrilldownSheet
        open={openRow !== null}
        onOpenChange={(o) => {
          if (!o) setOpenRow(null);
        }}
        title={openRow ? `${openRow.parent_label} — Show your math` : ""}
        rows={openRow?.parent_breakdown ?? []}
        formula="dollar_impact extracted from notifications.data.items where type IN ('SHRINK_ALERT', 'COUNT_VARIANCE')"
        loading={false}
      />
    </>
  );
}
