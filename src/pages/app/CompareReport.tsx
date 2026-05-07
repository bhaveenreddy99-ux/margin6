import { useMemo, useState } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { formatDistanceToNow } from "date-fns";
import { ArrowDownRight, ArrowRight, ArrowUpRight, CheckCircle2 } from "lucide-react";
import { useRestaurant } from "@/contexts/RestaurantContext";
import {
  useAllLocationsSummary,
  getFoodCostStatus,
  type DateRange,
  type LocationSummary,
} from "@/hooks/useAllLocationsSummary";
import { useLocationAlerts, type LocationAlert } from "@/hooks/useLocationAlerts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
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

function fmtCurrency(n: number) {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

function EstMark() {
  return <span className="text-[10px] text-muted-foreground align-super ml-0.5">Est.</span>;
}

function statusBadgeLabel(s: LocationSummary["food_cost_status"]) {
  switch (s) {
    case "good":
      return "Good";
    case "warning":
      return "Warning";
    default:
      return "Critical";
  }
}

function statusBadgeClass(s: LocationSummary["food_cost_status"]) {
  switch (s) {
    case "good":
      return "border-green-300 text-green-700 bg-green-50 dark:bg-green-950/30";
    case "warning":
      return "border-amber-300 text-amber-800 bg-amber-50 dark:bg-amber-950/30";
    default:
      return "border-red-300 text-red-700 bg-red-50 dark:bg-red-950/30";
  }
}

function vsTargetClass(diff: number | null): string {
  if (diff == null) return "text-muted-foreground";
  if (diff < 0) return "text-green-600 dark:text-green-400";
  if (diff < 3) return "text-amber-600 dark:text-amber-400";
  return "text-red-600 dark:text-red-400";
}

function complianceBarClass(ratio: number): string {
  if (ratio >= 1) return "bg-green-500/90";
  if (ratio >= 0.5) return "bg-amber-500/90";
  return "bg-red-500/90";
}

function alertCardClass(sev: LocationAlert["severity"]) {
  switch (sev) {
    case "critical":
      return "border-red-200 bg-red-50/80 hover:bg-red-50 dark:border-red-900/50 dark:bg-red-950/25";
    case "warning":
      return "border-amber-200 bg-amber-50/80 hover:bg-amber-50 dark:border-amber-900/50 dark:bg-amber-950/25";
    default:
      return "border-blue-200 bg-blue-50/80 hover:bg-blue-50 dark:border-blue-900/50 dark:bg-blue-950/25";
  }
}

function severityDotClass(sev: LocationAlert["severity"]) {
  switch (sev) {
    case "critical":
      return "bg-red-600";
    case "warning":
      return "bg-amber-600";
    default:
      return "bg-blue-600";
  }
}

export default function CompareReport() {
  const navigate = useNavigate();
  const { currentRestaurant, activeRestaurantIds } = useRestaurant();
  const [dateRange, setDateRange] = useState<DateRange>("30d");

  const summary = useAllLocationsSummary("all_brands", dateRange);
  const { alerts, loading: alertsExtraLoading } = useLocationAlerts(activeRestaurantIds, summary.locations);
  const alertsFeedLoading = summary.loading || alertsExtraLoading;

  const sortedRank = useMemo(() => {
    const copy = [...summary.locations];
    copy.sort((a, b) => {
      const fa = a.food_cost_pct;
      const fb = b.food_cost_pct;
      if (fa == null && fb == null) return a.location_name.localeCompare(b.location_name);
      if (fa == null) return 1;
      if (fb == null) return -1;
      return fa - fb;
    });
    return copy;
  }, [summary.locations]);

  const complianceSorted = useMemo(() => {
    const copy = [...summary.locations];
    copy.sort((a, b) => {
      if (a.count_overdue !== b.count_overdue) return a.count_overdue ? -1 : 1;
      const ra = a.counts_expected_this_period > 0 ? a.counts_this_period / a.counts_expected_this_period : 0;
      const rb = b.counts_expected_this_period > 0 ? b.counts_this_period / b.counts_expected_this_period : 0;
      return ra - rb;
    });
    return copy;
  }, [summary.locations]);

  const wasteSorted = useMemo(() => {
    const copy = [...summary.locations];
    copy.sort((a, b) => b.waste_in_period - a.waste_in_period);
    return copy;
  }, [summary.locations]);

  const maxWaste = useMemo(() => wasteSorted.reduce((m, l) => Math.max(m, l.waste_in_period), 0), [wasteSorted]);

  const avgTarget =
    summary.locations.length > 0
      ? summary.locations.reduce((s, l) => s + l.food_cost_target_pct, 0) / summary.locations.length
      : 30;

  const latestCountAny = summary.locations.reduce<string | null>((acc, l) => {
    if (!l.last_count_date) return acc;
    if (!acc || new Date(l.last_count_date) > new Date(acc)) return l.last_count_date;
    return acc;
  }, null);

  const summaryAvgStatus = getFoodCostStatus(summary.avg_food_cost_pct, avgTarget, latestCountAny);

  if (currentRestaurant?.role !== "OWNER") {
    return <Navigate to="/app/dashboard" replace />;
  }

  if (summary.loading && summary.locations.length === 0) {
    return (
      <div className="space-y-6 animate-fade-in">
        <Skeleton className="h-10 w-full max-w-lg rounded-lg" />
        <Skeleton className="h-40 rounded-xl" />
        <Skeleton className="h-64 rounded-xl" />
      </div>
    );
  }

  if (summary.error) {
    return (
      <div className="space-y-4">
        <p className="text-sm text-destructive">{summary.error}</p>
        <Button variant="outline" size="sm" onClick={() => summary.refetch()}>
          Retry
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-8 animate-fade-in">
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div>
          <h1 className="text-xl font-bold tracking-tight font-display">Cross-location comparison</h1>
          <p className="text-sm text-muted-foreground mt-1">Food cost, counts, waste, and alerts across your portfolio.</p>
        </div>
        <div className="flex items-center gap-1 p-1 rounded-lg bg-muted/60 border border-border/50 w-fit shrink-0">
          {(["7d", "30d", "90d"] as DateRange[]).map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => setDateRange(r)}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                dateRange === r ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {r === "7d" ? "7 days" : r === "30d" ? "30 days" : "90 days"}
            </button>
          ))}
        </div>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Alerts feed</CardTitle>
          <p className="text-xs text-muted-foreground font-normal">Critical and warning alerts across all locations.</p>
        </CardHeader>
        <CardContent className="space-y-3">
          {alertsFeedLoading ? (
            <Skeleton className="h-24 rounded-lg" />
          ) : alerts.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 py-10 text-center">
              <CheckCircle2 className="h-10 w-10 text-green-500/80" />
              <p className="text-sm font-medium text-green-700 dark:text-green-400">No alerts — all locations on track</p>
            </div>
          ) : (
            alerts.map((a) => (
              <button
                key={a.id}
                type="button"
                onClick={() => navigate(a.action_url)}
                className={`w-full text-left rounded-xl border px-4 py-3 flex gap-3 items-start transition-colors cursor-pointer ${alertCardClass(a.severity)}`}
              >
                <span className={`mt-1.5 h-2 w-2 rounded-full shrink-0 ${severityDotClass(a.severity)}`} />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold leading-snug">{a.title}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">{a.description}</p>
                  <p className="text-[11px] text-muted-foreground mt-1.5">
                    {a.restaurant_name ? `${a.restaurant_name} · ` : ""}
                    {a.location_name}
                  </p>
                </div>
                <div className="text-right shrink-0 pt-0.5">
                  <p className="text-[11px] text-muted-foreground whitespace-nowrap">
                    {formatDistanceToNow(new Date(a.created_at), { addSuffix: true })}
                  </p>
                  <p className="text-xs font-medium text-primary mt-1 flex items-center justify-end gap-0.5">
                    View <ArrowRight className="h-3 w-3" />
                  </p>
                </div>
              </button>
            ))
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Food cost ranking</CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          <p className="text-[11px] text-muted-foreground text-center mb-3">
            * Food cost % is estimated. Add sales data per location for accurate tracking.
          </p>
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/20">
                <TableHead className="text-xs w-10">Rank</TableHead>
                <TableHead className="text-xs">Location</TableHead>
                <TableHead className="text-xs">Brand</TableHead>
                <TableHead className="text-xs text-right">Est. food cost %</TableHead>
                <TableHead className="text-xs text-right">vs Target</TableHead>
                <TableHead className="text-xs text-right">Trend</TableHead>
                <TableHead className="text-xs">Last count</TableHead>
                <TableHead className="text-xs">Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sortedRank.map((loc, i) => {
                const diff = loc.food_cost_pct != null ? loc.food_cost_pct - loc.food_cost_target_pct : null;
                const trend = loc.food_cost_trend;
                const vsDisp =
                  diff != null ? `${diff >= 0 ? "+" : ""}${diff.toFixed(1)}%` : "—";
                return (
                  <TableRow key={loc.location_id}>
                    <TableCell className="text-xs text-muted-foreground">{i + 1}</TableCell>
                    <TableCell className="text-sm">
                      <span className="block text-[10px] text-muted-foreground">{loc.restaurant_name}</span>
                      <span className="font-medium">{loc.location_name}</span>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">{loc.brand ?? "—"}</TableCell>
                    <TableCell className="text-sm text-right font-mono font-semibold">
                      {loc.food_cost_pct != null ? (
                        <>
                          {`${loc.food_cost_pct.toFixed(1)}%`}
                          <EstMark />
                        </>
                      ) : (
                        "—"
                      )}
                    </TableCell>
                    <TableCell className={`text-xs text-right font-mono ${vsTargetClass(diff)}`}>{vsDisp}</TableCell>
                    <TableCell className="text-xs text-right font-mono">
                      {trend == null ? (
                        "—"
                      ) : (
                        <span
                          className={
                            trend > 0
                              ? "text-red-600 dark:text-red-400 inline-flex items-center justify-end gap-0.5"
                              : "text-green-600 dark:text-green-400 inline-flex items-center justify-end gap-0.5"
                          }
                        >
                          {trend > 0 ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
                          {`${trend >= 0 ? "+" : ""}${trend.toFixed(1)}% WoW`}
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {loc.last_count_date ? new Date(loc.last_count_date).toLocaleDateString() : "—"}
                    </TableCell>
                    <TableCell className="text-xs">
                      <Badge variant="outline" className={`text-[10px] ${statusBadgeClass(loc.food_cost_status)}`}>
                        {statusBadgeLabel(loc.food_cost_status)}
                      </Badge>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Count compliance</CardTitle>
          <p className="text-xs text-muted-foreground font-normal">Which locations are on schedule for this period.</p>
        </CardHeader>
        <CardContent className="space-y-4">
          {complianceSorted.map((loc) => {
            const exp = Math.max(1, loc.counts_expected_this_period);
            const ratio = loc.counts_this_period / exp;
            return (
              <div key={loc.location_id} className="rounded-lg border border-border/60 p-4 space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="text-sm font-semibold">{loc.location_name}</p>
                    <p className="text-[11px] text-muted-foreground">{loc.brand ?? "—"}</p>
                  </div>
                  {loc.count_overdue ? (
                    <Badge variant="outline" className="text-[10px] border-red-300 text-red-700 bg-red-50">
                      Overdue
                    </Badge>
                  ) : null}
                </div>
                <div className="h-2 rounded-full bg-muted/60 overflow-hidden">
                  <div className={`h-full rounded-full ${complianceBarClass(ratio)}`} style={{ width: `${Math.min(100, ratio * 100)}%` }} />
                </div>
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>
                    {loc.counts_this_period} of {loc.counts_expected_this_period} counts completed
                  </span>
                  <span>{loc.last_count_date ? new Date(loc.last_count_date).toLocaleDateString() : "—"}</span>
                </div>
              </div>
            );
          })}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Waste comparison</CardTitle>
          <p className="text-xs text-muted-foreground font-normal">Waste by location this period.</p>
        </CardHeader>
        <CardContent className="space-y-4">
          {wasteSorted.map((loc, idx) => {
            const w = loc.waste_in_period;
            const widthPct = maxWaste > 0 ? (w / maxWaste) * 100 : 0;
            const n = wasteSorted.length;
            let barColor = "bg-amber-500/85";
            if (w <= 0) barColor = "bg-green-500/85";
            else if (n === 1) barColor = "bg-amber-500/85";
            else if (idx === 0) barColor = "bg-red-500/85";
            else if (idx === n - 1) barColor = "bg-green-500/85";
            return (
              <div key={loc.location_id} className="space-y-1.5">
                <div className="flex justify-between text-sm">
                  <span className="font-medium">{loc.location_name}</span>
                  <span className="font-mono text-xs">{fmtCurrency(w)}</span>
                </div>
                <div className="h-2 rounded-full bg-muted/60 overflow-hidden">
                  <div className={`h-full rounded-full ${barColor}`} style={{ width: `${Math.max(4, widthPct)}%` }} />
                </div>
              </div>
            );
          })}
        </CardContent>
      </Card>

      <div className="rounded-xl border border-border/60 bg-muted/20 p-4 text-center">
        <p className="text-xs text-muted-foreground">
          Portfolio avg est. food cost{" "}
          <span className={`font-semibold ${summaryAvgStatus === "good" ? "text-green-600" : summaryAvgStatus === "warning" ? "text-amber-600" : "text-red-600"}`}>
            {summary.avg_food_cost_pct != null ? `${summary.avg_food_cost_pct.toFixed(1)}%` : "—"}
          </span>
          {summary.avg_food_cost_pct != null ? <EstMark /> : null}
        </p>
      </div>

      <div className="flex justify-end">
        <Button variant="ghost" size="sm" className="text-xs" asChild>
          <Link to="/app/reports">← Reports</Link>
        </Button>
      </div>
    </div>
  );
}
