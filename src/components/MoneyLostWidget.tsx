import { useState } from "react";
import { Link } from "react-router-dom";
import {
  AlertCircle,
  AlertTriangle,
  ChevronRight,
  Package,
  Trash2,
  TrendingUp,
  type LucideIcon,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { DrilldownSheet, type DrilldownRow } from "@/components/DrilldownSheet";
import { dashboardSpendRangeFromFilter } from "@/domain/dashboard/dashboardSelectors";
import type { DashboardTimeFilter } from "@/domain/dashboard/dashboardTypes";
import {
  fetchOverstockBreakdown,
  fetchPriceHikeBreakdown,
  fetchShrinkageBreakdown,
  fetchWasteBreakdown,
} from "@/hooks/useMathBreakdown";

type MetricKey = "waste" | "priceHike" | "overstock" | "shrinkage";

type MetricDef = {
  title: string;
  icon: LucideIcon;
  value: number;
  formula: string;
};

interface MoneyLostWidgetProps {
  recordedWasteValue: number;
  priceIncreaseImpact: number;
  overstockValue: number;
  shrinkageValue: number;
  restaurantId: string;
  locationId: string | null | undefined;
  timeFilter: DashboardTimeFilter;
  /** PAR not configured for any counted item — overstock can't be measured. */
  noParConfigured?: boolean;
}

function formatDollars(n: number): string {
  return `$${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

export function MoneyLostWidget({
  recordedWasteValue,
  priceIncreaseImpact,
  overstockValue,
  shrinkageValue,
  restaurantId,
  locationId,
  timeFilter,
  noParConfigured = false,
}: MoneyLostWidgetProps) {
  const [openMetric, setOpenMetric] = useState<MetricKey | null>(null);
  const [rows, setRows] = useState<DrilldownRow[]>([]);
  const [rowsLoading, setRowsLoading] = useState(false);

  const total =
    recordedWasteValue + priceIncreaseImpact + overstockValue + shrinkageValue;

  if (total <= 0) {
    return (
      <Card className="border-muted/50">
        <CardContent className="p-6 text-center">
          <AlertCircle className="mx-auto h-8 w-8 text-muted-foreground/40 mb-2" />
          <p className="text-sm font-semibold text-foreground">No loss data yet</p>
          <p className="text-xs text-muted-foreground mt-1">
            Upload your first invoice to start tracking.
          </p>
          {noParConfigured && (
            <Link
              to="/app/par"
              className="mt-4 inline-flex items-center gap-1.5 rounded-md border border-amber-300/70 bg-amber-50/80 px-2.5 py-1.5 text-[11px] font-medium text-amber-900 hover:bg-amber-100 transition-colors dark:border-amber-700/50 dark:bg-amber-950/30 dark:text-amber-100"
            >
              <AlertTriangle className="h-3 w-3" />
              Set PAR levels for accurate overstock tracking
              <ChevronRight className="h-3 w-3" />
            </Link>
          )}
        </CardContent>
      </Card>
    );
  }

  const metrics: Record<MetricKey, MetricDef> = {
    waste: {
      title: "Waste",
      icon: Trash2,
      value: recordedWasteValue,
      formula:
        "Σ waste_log.total_cost where logged_at within period (and location_id if scoped)",
    },
    priceHike: {
      title: "Price hikes",
      icon: TrendingUp,
      value: priceIncreaseImpact,
      formula:
        "Σ (invoiced_unit_cost − po_unit_cost) × received_qty across invoice_line_comparisons where status = 'price_mismatch' and invoice.invoice_date within period",
    },
    overstock: {
      title: "Overstock",
      icon: Package,
      value: overstockValue,
      formula:
        "Σ (current_stock − par_level) × unit_cost across the latest APPROVED inventory_session_items where current_stock > par_level",
    },
    shrinkage: {
      title: "Shrinkage",
      icon: AlertTriangle,
      value: shrinkageValue,
      formula:
        "Σ notifications.data.items[].dollar_impact where type IN ('SHRINK_ALERT', 'COUNT_VARIANCE') and created_at within period",
    },
  };

  const handleOpen = async (key: MetricKey) => {
    setOpenMetric(key);
    setRows([]);
    setRowsLoading(true);
    try {
      const { startDate, endDate } = dashboardSpendRangeFromFilter(timeFilter);
      const loc = locationId ?? undefined;
      let result: DrilldownRow[] = [];
      switch (key) {
        case "waste":
          result = await fetchWasteBreakdown(restaurantId, loc, startDate, endDate);
          break;
        case "priceHike":
          result = await fetchPriceHikeBreakdown(restaurantId, loc, startDate, endDate);
          break;
        case "overstock":
          result = await fetchOverstockBreakdown(restaurantId, loc);
          break;
        case "shrinkage":
          result = await fetchShrinkageBreakdown(restaurantId, loc, startDate, endDate);
          break;
      }
      setRows(result);
    } finally {
      setRowsLoading(false);
    }
  };

  const current = openMetric ? metrics[openMetric] : null;
  const metricOrder: MetricKey[] = ["waste", "priceHike", "overstock", "shrinkage"];

  return (
    <>
      <Card className="border-destructive/15 bg-gradient-to-br from-destructive/5 to-transparent">
        <CardContent className="p-6 sm:p-7">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-destructive/80">
            <AlertTriangle className="h-3.5 w-3.5" />
            Money Lost This Period
          </div>
          <p className="mt-3 text-4xl sm:text-5xl font-extrabold tracking-tight tabular-nums text-destructive">
            {formatDollars(total)}
          </p>
          <p className="mt-1.5 text-xs text-muted-foreground">
            estimated loss this period · tap any row to see the math
          </p>

          {noParConfigured && (
            <Link
              to="/app/par"
              className="mt-3 inline-flex items-center gap-1.5 rounded-md border border-amber-300/70 bg-amber-50/80 px-2.5 py-1.5 text-[11px] font-medium text-amber-900 hover:bg-amber-100 transition-colors dark:border-amber-700/50 dark:bg-amber-950/30 dark:text-amber-100"
            >
              <AlertTriangle className="h-3 w-3" />
              Set PAR levels for accurate overstock tracking
              <ChevronRight className="h-3 w-3" />
            </Link>
          )}

          <div className="mt-5 grid grid-cols-1 sm:grid-cols-2 gap-2">
            {metricOrder.map((k) => {
              const m = metrics[k];
              const Icon = m.icon;
              return (
                <button
                  key={k}
                  type="button"
                  onClick={() => handleOpen(k)}
                  className="flex items-center justify-between gap-3 rounded-lg border border-border/40 bg-background/60 px-3 py-2 text-left hover:bg-background hover:border-border transition-colors"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    <span className="text-xs font-medium truncate">{m.title}</span>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <span className="text-sm font-bold font-mono tabular-nums">
                      {formatDollars(m.value)}
                    </span>
                    <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/60" />
                  </div>
                </button>
              );
            })}
          </div>
        </CardContent>
      </Card>

      <DrilldownSheet
        open={openMetric !== null}
        onOpenChange={(o) => {
          if (!o) setOpenMetric(null);
        }}
        title={current ? `${current.title} — Show your math` : ""}
        rows={rows}
        formula={current?.formula ?? ""}
        loading={rowsLoading}
      />
    </>
  );
}
