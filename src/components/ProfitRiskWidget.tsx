import { useCallback, useState } from "react";
import { format } from "date-fns";
import { Link } from "react-router-dom";
import {
  AlertCircle,
  AlertTriangle,
  Calculator,
  ChevronRight,
  Package,
  Trash2,
  TrendingUp,
  type LucideIcon,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { DrilldownSheet, type DrilldownRow } from "@/components/DrilldownSheet";
import {
  KpiExplainSheet,
  buildMoneyLostExplain,
  type KpiExplainPayload,
  type KpiConfidenceSnapshot,
} from "@/components/explainability";
import { dashboardSpendRangeFromFilter } from "@/domain/dashboard/dashboardSelectors";
import type { DashboardTimeFilter } from "@/domain/dashboard/dashboardTypes";
import {
  PROFIT_RISK_EMPTY_SUBTITLE,
  PROFIT_RISK_EMPTY_TITLE,
  PROFIT_RISK_HERO_SUBTITLE,
  PROFIT_RISK_HERO_TITLE,
  PROFIT_RISK_ROW_OVERSTOCK,
  PROFIT_RISK_ROW_PRICE,
  PROFIT_RISK_ROW_SHRINKAGE,
  PROFIT_RISK_ROW_WASTE,
} from "@/domain/dashboard/profitRiskLabels";
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
  sourceTables: string;
};

export interface ProfitRiskWidgetProps {
  recordedWasteValue: number;
  priceIncreaseImpact: number;
  overstockValue: number;
  shrinkageValue: number;
  restaurantId: string;
  locationId: string | null | undefined;
  timeFilter: DashboardTimeFilter;
  lastSessionDate: Date | null;
  periodLabel: string;
  confidenceSnapshot: KpiConfidenceSnapshot;
  daysSinceLastCount: number | null;
  /** PAR not configured for any counted item — overstock can't be measured. */
  noParConfigured?: boolean;
}

function formatDollars(n: number): string {
  return `$${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

export function ProfitRiskWidget({
  recordedWasteValue,
  priceIncreaseImpact,
  overstockValue,
  shrinkageValue,
  restaurantId,
  locationId,
  timeFilter,
  lastSessionDate,
  periodLabel,
  confidenceSnapshot,
  daysSinceLastCount,
  noParConfigured = false,
}: ProfitRiskWidgetProps) {
  const [openMetric, setOpenMetric] = useState<MetricKey | null>(null);
  const [rows, setRows] = useState<DrilldownRow[]>([]);
  const [rowsLoading, setRowsLoading] = useState(false);
  const [explainOpen, setExplainOpen] = useState(false);
  const [explainPayload, setExplainPayload] = useState<KpiExplainPayload | null>(null);
  const [explainLoading, setExplainLoading] = useState(false);

  const total =
    recordedWasteValue + priceIncreaseImpact + overstockValue + shrinkageValue;

  const metrics: Record<MetricKey, MetricDef> = {
    waste: {
      title: PROFIT_RISK_ROW_WASTE,
      icon: Trash2,
      value: recordedWasteValue,
      formula: "Σ waste_log.total_cost (period) via dollarsForWasteRow — same as Dashboard",
      sourceTables: "waste_log, inventory_catalog_items, inventory_session_items",
    },
    priceHike: {
      title: PROFIT_RISK_ROW_PRICE,
      icon: TrendingUp,
      value: priceIncreaseImpact,
      formula:
        "Σ (new_cost − old_cost) × qty from PRICE_INCREASE notifications + invoice price mismatches",
      sourceTables: "notifications, invoice_line_comparisons, invoices",
    },
    overstock: {
      title: PROFIT_RISK_ROW_OVERSTOCK,
      icon: Package,
      value: overstockValue,
      formula:
        "Σ max(on_hand − par, 0) × unit_cost on latest APPROVED count (zone-deduped, PAR required)",
      sourceTables: "inventory_sessions, inventory_session_items, par_guide_items",
    },
    shrinkage: {
      title: PROFIT_RISK_ROW_SHRINKAGE,
      icon: AlertTriangle,
      value: shrinkageValue,
      formula:
        "Σ notifications.data.items[].dollar_impact where type IN ('SHRINK_ALERT', 'COUNT_VARIANCE')",
      sourceTables: "notifications",
    },
  };

  const handleOpenRow = async (key: MetricKey) => {
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

  const openHeroExplain = useCallback(async () => {
    const base = buildMoneyLostExplain({
      snapshot: confidenceSnapshot,
      daysSinceLastCount,
      periodLabel,
    });
    setExplainPayload(base);
    setExplainOpen(true);
    setExplainLoading(true);
    try {
      const { startDate, endDate } = dashboardSpendRangeFromFilter(timeFilter);
      const loc = locationId ?? undefined;
      const [wasteRows, priceRows, overRows, shrinkRows] = await Promise.all([
        recordedWasteValue > 0
          ? fetchWasteBreakdown(restaurantId, loc, startDate, endDate)
          : Promise.resolve([]),
        priceIncreaseImpact > 0
          ? fetchPriceHikeBreakdown(restaurantId, loc, startDate, endDate)
          : Promise.resolve([]),
        overstockValue > 0 ? fetchOverstockBreakdown(restaurantId, loc) : Promise.resolve([]),
        shrinkageValue > 0
          ? fetchShrinkageBreakdown(restaurantId, loc, startDate, endDate)
          : Promise.resolve([]),
      ]);

      const itemBreakdown = [
        ...wasteRows.slice(0, 5).map((r) => ({ label: `${PROFIT_RISK_ROW_WASTE}: ${r.label}`, value: formatDollars(r.value) })),
        ...priceRows.slice(0, 5).map((r) => ({ label: `${PROFIT_RISK_ROW_PRICE}: ${r.label}`, value: formatDollars(r.value) })),
        ...overRows.slice(0, 5).map((r) => ({ label: `${PROFIT_RISK_ROW_OVERSTOCK}: ${r.label}`, value: formatDollars(r.value) })),
        ...shrinkRows.slice(0, 5).map((r) => ({ label: `${PROFIT_RISK_ROW_SHRINKAGE}: ${r.label}`, value: formatDollars(r.value) })),
      ];

      setExplainPayload({
        ...base,
        lastUpdated: lastSessionDate
          ? `Count ${format(lastSessionDate, "MMM d, yyyy")} · ${periodLabel}`
          : periodLabel,
        calculationSteps: [
          ...(base.calculationSteps ?? []),
          ...(itemBreakdown.length > 0
            ? [{ label: "—", value: "Top line items (tap rows below for full list)" }]
            : []),
          ...itemBreakdown,
        ],
      });
    } finally {
      setExplainLoading(false);
    }
  }, [
    confidenceSnapshot,
    daysSinceLastCount,
    lastSessionDate,
    locationId,
    overstockValue,
    periodLabel,
    priceIncreaseImpact,
    recordedWasteValue,
    restaurantId,
    shrinkageValue,
    timeFilter,
  ]);

  if (total <= 0) {
    return (
      <Card className="border-muted/50">
        <CardContent className="p-6 text-center">
          <AlertCircle className="mx-auto h-8 w-8 text-muted-foreground/40 mb-2" />
          <p className="text-sm font-semibold text-foreground">{PROFIT_RISK_EMPTY_TITLE}</p>
          <p className="text-xs text-muted-foreground mt-1">{PROFIT_RISK_EMPTY_SUBTITLE}</p>
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

  const current = openMetric ? metrics[openMetric] : null;
  const metricOrder: MetricKey[] = ["waste", "priceHike", "overstock", "shrinkage"];

  return (
    <>
      <Card className="border-destructive/15 bg-gradient-to-br from-destructive/5 to-transparent">
        <CardContent className="p-6 sm:p-7">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-destructive/80">
                <AlertTriangle className="h-3.5 w-3.5" />
                {PROFIT_RISK_HERO_TITLE}
              </div>
              <p className="mt-3 text-4xl sm:text-5xl font-extrabold tracking-tight tabular-nums text-destructive">
                {formatDollars(total)}
              </p>
              <p className="mt-1.5 text-xs text-muted-foreground max-w-lg">{PROFIT_RISK_HERO_SUBTITLE}</p>
            </div>
            <Button
              variant="outline"
              size="sm"
              className="shrink-0 h-8 text-xs"
              onClick={() => void openHeroExplain()}
              disabled={explainLoading}
            >
              <Calculator className="h-3.5 w-3.5 mr-1" />
              View math
            </Button>
          </div>

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
                  onClick={() => void handleOpenRow(k)}
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
        title={current ? `${current.title} — line breakdown` : ""}
        rows={rows}
        formula={current?.formula ?? ""}
        loading={rowsLoading}
      />

      <KpiExplainSheet
        open={explainOpen}
        onOpenChange={setExplainOpen}
        payload={explainPayload}
      />
    </>
  );
}

/** @deprecated Use ProfitRiskWidget */
export const MoneyLostWidget = ProfitRiskWidget;
