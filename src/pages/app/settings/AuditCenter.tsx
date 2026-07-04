import { useMemo, useState } from "react";
import { format, differenceInDays } from "date-fns";
import { useRestaurant } from "@/contexts/RestaurantContext";
import { useDashboardData } from "@/hooks/useDashboardData";
import { useLocationPermissions } from "@/hooks/useLocationPermissions";
import { dashboardSpendPeriodLabel } from "@/domain/dashboard/dashboardSelectors";
import { computeMoneyLostTotal } from "@/domain/dashboard/dashboardTrustFormulas";
import {
  computeFoodCostConfidence,
  computeInventoryValueConfidence,
  computeMoneyLostConfidence,
  computeOverstockConfidence,
  computeReorderConfidence,
  computeDataQualityScore,
  dataQualityBandLabel,
} from "@/domain/dataQuality";
import {
  buildDataQualityInput,
  buildKpiConfidenceInput,
  buildFoodCostExplain,
  buildInventoryExplain,
  buildMoneyLostExplain,
  buildOverstockExplain,
  buildReorderExplain,
  KpiConfidenceBadge,
  KpiExplainSheet,
  type KpiExplainPayload,
} from "@/components/explainability";
import { DataQualityBanner } from "@/components/dashboard/DataQualityBanner";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Shield, Calculator, AlertTriangle } from "lucide-react";
import { buildDashboardDisplayState } from "@/domain/dashboard/dashboardSelectors";

type AuditRow = {
  metric: string;
  value: string;
  formula: string;
  sourceTables: string;
  lastUpdated: string;
  confidence: "high" | "medium" | "low";
  explain: () => KpiExplainPayload;
};

export default function AuditCenterPage() {
  const { currentRestaurant, currentLocation } = useRestaurant();
  const perms = useLocationPermissions();
  const [explainPayload, setExplainPayload] = useState<KpiExplainPayload | null>(null);
  const [explainOpen, setExplainOpen] = useState(false);

  const { loading, error, refetch, ...snapshot } = useDashboardData({
    currentRestaurantId: currentRestaurant?.id,
    currentLocationId: currentLocation?.id,
    timeFilter: "this_week",
  });

  const daysSinceLastCount = snapshot.lastSessionDate
    ? differenceInDays(new Date(), snapshot.lastSessionDate)
    : null;
  const periodLabel = dashboardSpendPeriodLabel("this_week");

  const qualityInput = useMemo(
    () =>
      buildDataQualityInput({
        snapshot,
        daysSinceLastCount,
      }),
    [snapshot, daysSinceLastCount],
  );

  const confidenceInput = useMemo(
    () => buildKpiConfidenceInput({ snapshot, daysSinceLastCount }),
    [snapshot, daysSinceLastCount],
  );

  const { reorderValue, criticalLowCount } = useMemo(
    () =>
      buildDashboardDisplayState({
        reorderSummary: snapshot.reorderSummary,
        daysSinceLastCount,
        lastSessionDate: snapshot.lastSessionDate,
        lastSessionName: snapshot.lastSessionName,
        missingCostCount: snapshot.missingCostCount,
      }),
    [snapshot, daysSinceLastCount],
  );

  const topOverstock = snapshot.overstockItems[0];
  const moneyLostTotal = computeMoneyLostTotal({
    recordedWasteValue: snapshot.recordedWasteValue,
    priceIncreaseImpact: snapshot.priceIncreaseImpact,
    overstockValue: snapshot.overstockValue,
    shrinkageValue: snapshot.shrinkageValue,
  });

  const lastUpdated = snapshot.lastSessionDate
    ? format(snapshot.lastSessionDate, "MMM d, yyyy")
    : periodLabel;

  const rows: AuditRow[] = useMemo(() => {
    const invConf = computeInventoryValueConfidence(confidenceInput);
    const osConf = computeOverstockConfidence(confidenceInput);
    const reConf = computeReorderConfidence(confidenceInput);
    const mlConf = computeMoneyLostConfidence(confidenceInput);
    const fcConf = computeFoodCostConfidence(confidenceInput);

    const fmtMoney = (n: number) =>
      Number.isFinite(n) ? `$${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}` : "—";

    return [
      {
        metric: "Inventory value",
        value: perms.can_see_inventory_value ? fmtMoney(snapshot.inventoryValue) : "—",
        formula: "Σ (on_hand × unit_cost)",
        sourceTables: "inventory_sessions, inventory_session_items",
        lastUpdated,
        confidence: invConf.level,
        explain: () =>
          buildInventoryExplain({
            snapshot,
            daysSinceLastCount,
            periodLabel,
            displayValue: snapshot.inventoryValue,
          }),
      },
      {
        metric: "Overstock exposure",
        value: fmtMoney(snapshot.overstockValue),
        formula: "Σ max(on_hand − par, 0) × unit_cost",
        sourceTables: "inventory_session_items, par_guide_items",
        lastUpdated,
        confidence: osConf.level,
        explain: () =>
          buildOverstockExplain({
            snapshot,
            daysSinceLastCount,
            periodLabel,
            topItem: topOverstock
              ? {
                  name: topOverstock.item_name,
                  onHand: topOverstock.current_stock,
                  par: topOverstock.par_level,
                  unitCost: topOverstock.unit_cost,
                  value: topOverstock.dollars,
                }
              : undefined,
          }),
      },
      {
        metric: "Reorder needed ($)",
        value: fmtMoney(reorderValue),
        formula: "Σ ceil(max(par − on_hand, 0)) × unit_cost",
        sourceTables: "inventory_session_items, par_guide_items",
        lastUpdated,
        confidence: reConf.level,
        explain: () =>
          buildReorderExplain({
            snapshot,
            daysSinceLastCount,
            periodLabel,
            reorderValue,
          }),
      },
      {
        metric: "Critical low stock",
        value: String(criticalLowCount),
        formula: "count items below red threshold",
        sourceTables: "inventory_session_items, smart_order_settings",
        lastUpdated,
        confidence: reConf.level,
        explain: () =>
          buildReorderExplain({
            snapshot,
            daysSinceLastCount,
            periodLabel,
            reorderValue,
          }),
      },
      {
        metric: "Recorded waste",
        value: fmtMoney(snapshot.recordedWasteValue),
        formula: "Σ waste_log total_cost (period)",
        sourceTables: "waste_log",
        lastUpdated: periodLabel,
        confidence: mlConf.level,
        explain: () => buildMoneyLostExplain({ snapshot, daysSinceLastCount, periodLabel }),
      },
      {
        metric: "Price increase impact",
        value: fmtMoney(snapshot.priceIncreaseImpact),
        formula: "Σ (new_cost − old_cost) × qty from notifications",
        sourceTables: "notifications",
        lastUpdated: periodLabel,
        confidence: mlConf.level,
        explain: () => buildMoneyLostExplain({ snapshot, daysSinceLastCount, periodLabel }),
      },
      {
        metric: "Shrinkage alerts",
        value: fmtMoney(snapshot.shrinkageValue),
        formula: "Σ shrinkage notification dollar impact",
        sourceTables: "notifications",
        lastUpdated: periodLabel,
        confidence: mlConf.level,
        explain: () => buildMoneyLostExplain({ snapshot, daysSinceLastCount, periodLabel }),
      },
      {
        metric: "Profit risk total",
        value: fmtMoney(moneyLostTotal),
        formula: "recorded waste + price hikes + overstock exposure + shrinkage alerts",
        sourceTables: "waste_log, notifications, inventory_session_items",
        lastUpdated,
        confidence: mlConf.level,
        explain: () => buildMoneyLostExplain({ snapshot, daysSinceLastCount, periodLabel }),
      },
      ...(perms.can_see_food_cost_pct
        ? [
            {
              metric: "Food cost %",
              value:
                snapshot.foodCostPct != null ? `${snapshot.foodCostPct.toFixed(1)}%` : "—",
              formula: "period spend ÷ weekly gross sales × 100",
              sourceTables: "invoices, weekly_sales",
              lastUpdated: periodLabel,
              confidence: fcConf.level,
              explain: () => buildFoodCostExplain({ snapshot, periodLabel }),
            } satisfies AuditRow,
          ]
        : []),
      {
        metric: "Period spend",
        value: fmtMoney(snapshot.periodSpend),
        formula: "Σ posted invoice totals (period)",
        sourceTables: "invoices",
        lastUpdated: periodLabel,
        confidence: fcConf.level,
        explain: () => buildFoodCostExplain({ snapshot, periodLabel }),
      },
    ];
  }, [
    confidenceInput,
    criticalLowCount,
    daysSinceLastCount,
    lastUpdated,
    moneyLostTotal,
    periodLabel,
    perms.can_see_food_cost_pct,
    perms.can_see_inventory_value,
    reorderValue,
    snapshot,
    topOverstock,
  ]);

  const openExplain = (payload: KpiExplainPayload) => {
    setExplainPayload(payload);
    setExplainOpen(true);
  };

  if (loading) {
    return (
      <div className="space-y-4 animate-fade-in">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }

  // T0-4: the Audit Center verifies numbers — it must never present unverified
  // data. On a load error, show an explicit error + Retry and render NO KPI
  // values, confidence badges, or data-quality score. Failure ≠ $0.
  if (error) {
    return (
      <div className="flex flex-col items-center justify-center gap-4 py-24 text-center animate-fade-in">
        <AlertTriangle className="h-10 w-10 text-destructive/40" />
        <div>
          <p className="text-sm font-semibold">Audit data couldn't load</p>
          <p className="text-xs text-muted-foreground mt-1">
            We won't show unverified numbers. Check your connection and try again.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={refetch}>
          Retry
        </Button>
      </div>
    );
  }

  const quality = computeDataQualityScore(qualityInput);

  return (
    <div className="animate-fade-in space-y-6 max-w-5xl">
      <div>
        <div className="flex items-center gap-2">
          <Shield className="h-5 w-5 text-primary" />
          <h1 className="page-title">Audit Center</h1>
        </div>
        <p className="page-description mt-1">
          Verify every important dashboard number — formula, source, and confidence in one place.
        </p>
      </div>

      <DataQualityBanner input={qualityInput} />

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Data quality score</CardTitle>
          <CardDescription>
            {dataQualityBandLabel(quality.band)} · {quality.score}/100
          </CardDescription>
        </CardHeader>
        <CardContent>
          {quality.issues.length === 0 ? (
            <p className="text-sm text-muted-foreground">No data quality issues detected.</p>
          ) : (
            <ul className="text-sm space-y-1.5 text-muted-foreground list-disc pl-4">
              {quality.issues.map((issue) => (
                <li key={issue.code}>{issue.message}</li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">KPI verification</CardTitle>
          <CardDescription>
            {currentRestaurant?.name}
            {currentLocation?.name ? ` · ${currentLocation.name}` : ""} · {periodLabel}
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0 sm:p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Metric</TableHead>
                <TableHead className="text-right">Value</TableHead>
                <TableHead className="hidden md:table-cell">Formula</TableHead>
                <TableHead className="hidden lg:table-cell">Source</TableHead>
                <TableHead>Updated</TableHead>
                <TableHead>Confidence</TableHead>
                <TableHead className="w-[100px]" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.metric}>
                  <TableCell className="font-medium text-sm">{row.metric}</TableCell>
                  <TableCell className="text-right tabular-nums text-sm">{row.value}</TableCell>
                  <TableCell className="hidden md:table-cell text-xs text-muted-foreground max-w-[180px] truncate">
                    {row.formula}
                  </TableCell>
                  <TableCell className="hidden lg:table-cell text-xs text-muted-foreground max-w-[160px] truncate">
                    {row.sourceTables}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                    {row.lastUpdated}
                  </TableCell>
                  <TableCell>
                    <KpiConfidenceBadge level={row.confidence} compact />
                  </TableCell>
                  <TableCell>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-8 text-xs px-2"
                      onClick={() => openExplain(row.explain())}
                    >
                      <Calculator className="h-3.5 w-3.5 mr-1" />
                      Math
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <KpiExplainSheet
        open={explainOpen}
        onOpenChange={setExplainOpen}
        payload={explainPayload}
      />
    </div>
  );
}
