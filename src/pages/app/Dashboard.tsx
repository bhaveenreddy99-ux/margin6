import { useMemo, useState } from "react";
import { useRestaurant } from "@/contexts/RestaurantContext";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Package, AlertTriangle, TrendingUp, TrendingDown, ShoppingCart,
  Building2, Bell, DollarSign, BarChart3, Sparkles,
  ClipboardCheck, Clock, CheckCircle2, Zap, ArrowRight,
  CalendarDays, Activity, Receipt, Trash2, Truck,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useNavigate, Navigate, Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  format,
  differenceInDays,
} from "date-fns";
import type { ComputedUsageItem, PARRecommendation } from "@/lib/usage-analytics";
import {
  buildDashboardDisplayState,
  buildPortfolioSummary,
  buildProfitIntelligenceActions,
  dashboardSpendPeriodLabel,
  formatInventoryQty,
  sortPortfolioRestaurants,
  spendPeriodPlainName,
  spendPeriodSubtitle,
  summarizeWasteSnapshot,
} from "@/domain/dashboard/dashboardSelectors";
import type {
  DashboardTimeFilter,
  PortfolioDashboardTotals,
  PortfolioRestaurantRow,
  ProfitIntelligenceAction,
  TopReorderItem,
  WasteLogSnapshotRow,
} from "@/domain/dashboard/dashboardTypes";
import { STOCK_TRUTH_MESSAGE } from "@/lib/stockTruthCopy";
import { useDashboardData, usePortfolioDashboardData } from "@/hooks/useDashboardData";
import { useLocationPermissions } from "@/hooks/useLocationPermissions";

// ─── Today's Briefing ───
function TodaysBriefing({
  timeFilter,
  setTimeFilter,
  onStartInventory,
  stockStatus,
  pendingInvoices,
  daysSinceLastCount,
}: {
  timeFilter: DashboardTimeFilter;
  setTimeFilter: (value: DashboardTimeFilter) => void;
  onStartInventory: () => void;
  stockStatus: { red: number; yellow: number; green: number };
  pendingInvoices: number;
  daysSinceLastCount: number | null;
}) {
  const briefing =
    stockStatus.red > 0
      ? `⚠️ You have ${stockStatus.red} critical item${stockStatus.red !== 1 ? "s" : ""}. Order today before you run out.`
      : pendingInvoices > 0
      ? `📋 ${pendingInvoices} invoice${pendingInvoices !== 1 ? "s" : ""} waiting to be received.`
      : daysSinceLastCount !== null
      ? `✅ Everything looks good. Last count was ${daysSinceLastCount} day${daysSinceLastCount !== 1 ? "s" : ""} ago.`
      : `✅ Everything looks good. Complete your first inventory count to unlock insights.`;

  return (
    <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 p-4 rounded-xl bg-gradient-to-r from-amber-50 to-orange-50 dark:from-amber-950/30 dark:to-orange-950/30 border border-amber-200/60 dark:border-amber-800/40 shadow-sm">
      <div>
        <p className="text-[11px] text-amber-600/70 dark:text-amber-400/60 font-medium">
          {format(new Date(), "EEEE, MMM d")}
        </p>
        <p className="text-sm font-semibold text-foreground mt-0.5">{briefing}</p>
        {daysSinceLastCount !== null && (
          <p className="text-[10px] text-amber-900/65 dark:text-amber-100/45 mt-1.5 max-w-xl leading-relaxed">
            {STOCK_TRUTH_MESSAGE}
          </p>
        )}
      </div>
      <div className="flex items-center gap-3 shrink-0">
        <Select value={timeFilter} onValueChange={(value) => setTimeFilter(value as DashboardTimeFilter)}>
          <SelectTrigger className="w-[150px] h-9 text-xs font-medium bg-background">
            <CalendarDays className="h-3.5 w-3.5 mr-1.5 text-muted-foreground" />
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="this_week">This Week</SelectItem>
            <SelectItem value="last_week">Last Week</SelectItem>
            <SelectItem value="30_days">Last 30 Days</SelectItem>
          </SelectContent>
        </Select>
        <Button
          onClick={onStartInventory}
          className="bg-gradient-orange text-white shadow-orange hover:opacity-90 transition-opacity h-9 px-5 text-xs font-semibold"
        >
          <ClipboardCheck className="h-3.5 w-3.5 mr-1.5" />
          Start Inventory
        </Button>
      </div>
    </div>
  );
}

// ─── KPI Card ───
function KpiCard({
  icon: Icon,
  label,
  value,
  change,
  changeLabel,
  accent,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  change?: number;
  changeLabel?: string;
  accent: "destructive" | "warning" | "success" | "primary";
}) {
  const accentMap = {
    destructive: { bg: "bg-destructive/8", text: "text-destructive", border: "border-destructive/10" },
    warning: { bg: "bg-warning/8", text: "text-warning", border: "border-warning/10" },
    success: { bg: "bg-success/8", text: "text-success", border: "border-success/10" },
    primary: { bg: "bg-primary/8", text: "text-primary", border: "border-primary/10" },
  };
  const a = accentMap[accent];

  return (
    <Card className={`${a.border} hover:shadow-md transition-all duration-200`}>
      <CardContent className="p-5 flex flex-col h-full min-h-[132px]">
        <div className="flex items-start justify-between gap-2">
          <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${a.bg}`}>
            <Icon className={`h-5 w-5 ${a.text}`} />
          </div>
          {change !== undefined && (
            <div className={`flex items-center gap-0.5 text-[11px] font-semibold ${change >= 0 ? "text-success" : "text-destructive"}`}>
              {change >= 0 ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
              {Math.abs(change)}%
            </div>
          )}
        </div>
        <p className="text-xs font-medium text-muted-foreground mt-3 leading-snug">{label}</p>
        <p className="text-2xl sm:text-3xl font-bold tracking-tight font-display tabular-nums mt-1">{value}</p>
        {changeLabel && (
          <p className="text-xs text-muted-foreground/85 mt-2 leading-snug">{changeLabel}</p>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Action Center ───
function ActionCenter({
  criticalCount,
  pendingApprovals,
  daysSinceLastCount,
  recommendationsCount,
  todayWasteCount,
  deliveryIssueCount,
  profitIntelligenceActions,
  navigate,
}: {
  criticalCount: number;
  pendingApprovals: number;
  daysSinceLastCount: number | null;
  recommendationsCount: number;
  todayWasteCount: number;
  deliveryIssueCount: number;
  profitIntelligenceActions?: ProfitIntelligenceAction[];
  navigate: (path: string) => void;
}) {
  const intelShown = profitIntelligenceActions ?? [];

  const dotClass = (t: ProfitIntelligenceAction["type"]) =>
    t === "CRITICAL"
      ? "bg-destructive"
      : t === "WARNING"
        ? "bg-warning"
        : "bg-primary";

  const items = [
    {
      icon: AlertTriangle,
      label: `${criticalCount} item${criticalCount !== 1 ? "s" : ""} below PAR — open Smart Order`,
      color: "text-destructive",
      bg: "bg-destructive/6",
      path: "/app/smart-order",
      show: criticalCount > 0,
    },
    {
      icon: Clock,
      label: `${pendingApprovals} invoice${pendingApprovals !== 1 ? "s" : ""} waiting to receive`,
      color: "text-primary",
      bg: "bg-primary/6",
      path: "/app/invoices",
      show: pendingApprovals > 0,
    },
    {
      icon: CalendarDays,
      label: "It’s been 7+ days since your last count",
      color: "text-warning",
      bg: "bg-warning/6",
      path: "/app/inventory/enter",
      show: daysSinceLastCount !== null && daysSinceLastCount >= 7,
    },
    {
      icon: TrendingUp,
      label: `${recommendationsCount} PAR suggestion${recommendationsCount !== 1 ? "s" : ""} ready to review`,
      color: "text-primary",
      bg: "bg-primary/6",
      path: "/app/par/suggestions",
      show: recommendationsCount > 0,
    },
    {
      icon: Trash2,
      label: "No waste logged today — remind your team",
      color: "text-muted-foreground",
      bg: "bg-muted/30",
      path: "/app/waste-log",
      show: daysSinceLastCount !== null && daysSinceLastCount <= 1 && todayWasteCount === 0,
    },
    {
      icon: Truck,
      label: `${deliveryIssueCount} delivery issue${deliveryIssueCount !== 1 ? "s" : ""} to review`,
      color: "text-destructive",
      bg: "bg-destructive/6",
      path: "/app/invoices",
      show: deliveryIssueCount > 0,
    },
  ].filter((i) => i.show);

  const totalShown = intelShown.length + items.length;

  return (
    <Card className="hover:shadow-md transition-all duration-200 border-border/80">
      <div className="flex items-center gap-2 p-5 pb-2">
        <Bell className="h-4 w-4 text-warning" />
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-bold tracking-tight">What to do next</h3>
          <p className="text-[11px] text-muted-foreground mt-0.5">Highest-priority items first</p>
        </div>
        {totalShown > 0 && (
          <Badge variant="secondary" className="text-[10px] shrink-0 h-5">{totalShown}</Badge>
        )}
      </div>
      <CardContent className="pt-0 pb-4 px-5">
        {totalShown === 0 ? (
          <div className="flex flex-col items-center py-8 text-center">
            <CheckCircle2 className="h-10 w-10 text-success/30 mb-3" />
            <p className="text-sm font-medium text-muted-foreground">You’re in good shape</p>
            <p className="text-xs text-muted-foreground/60 mt-0.5">Nothing urgent right now</p>
          </div>
        ) : (
          <div className="space-y-3">
            {intelShown.length > 0 && (
              <div className="space-y-2">
                {intelShown.map((a, i) => (
                  <div
                    key={`intel-${i}`}
                    className={`flex items-start gap-3 py-2.5 px-3 rounded-lg border text-sm leading-snug ${
                      a.type === "CRITICAL"
                        ? "bg-destructive/[0.06] text-foreground border-destructive/15"
                        : a.type === "WARNING"
                          ? "bg-warning/[0.06] text-foreground border-warning/20"
                          : "bg-primary/[0.04] text-foreground border-primary/15"
                    }`}
                  >
                    <span
                      className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${dotClass(a.type)}`}
                      aria-hidden
                    />
                    <span className="font-medium flex-1">{a.message}</span>
                  </div>
                ))}
              </div>
            )}
            {intelShown.length > 0 && items.length > 0 && (
              <div className="border-t border-border/60 pt-3">
                <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-2 px-0.5">
                  Quick links
                </p>
              </div>
            )}
            {items.map((item, i) => (
              <button
                key={i}
                type="button"
                onClick={() => navigate(item.path)}
                className="w-full flex items-center gap-3 py-2.5 px-3 rounded-lg hover:bg-muted/40 transition-colors text-left group"
              >
                <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${item.bg}`}>
                  <item.icon className={`h-4 w-4 ${item.color}`} />
                </div>
                <span className="text-sm font-medium flex-1">{item.label}</span>
                <ArrowRight className="h-3.5 w-3.5 text-muted-foreground/40 group-hover:text-foreground transition-colors shrink-0" />
              </button>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Smart Order Preview ───
function SmartOrderPreview({
  topReorder,
  redCount,
  yellowCount,
  reorderValue,
  navigate,
  lastApprovedAt,
}: {
  topReorder: TopReorderItem[];
  redCount: number;
  yellowCount: number;
  reorderValue: number;
  navigate: (path: string) => void;
  lastApprovedAt: Date | null;
}) {
  const riskBadge = (ratio: number) => {
    if (ratio < 0.5) return <Badge variant="destructive" className="text-[10px] font-medium w-12 justify-center">LOW</Badge>;
    if (ratio < 1) return <Badge className="bg-warning text-warning-foreground text-[10px] font-medium w-12 justify-center">MED</Badge>;
    return <Badge className="bg-success text-success-foreground text-[10px] font-medium w-12 justify-center">OK</Badge>;
  };

  const hasItems = topReorder.length > 0;

  return (
    <Card className="hover:shadow-md transition-all duration-200">
      <div className="flex items-center justify-between p-5 pb-3 gap-3">
        <div className="flex-1 min-w-0">
          {hasItems ? (
            <div className="flex flex-col gap-0.5">
              <h3 className="text-sm font-bold tracking-tight">Smart Order</h3>
              <p className="text-[11px] text-muted-foreground">Top items to reorder today</p>
              {lastApprovedAt != null && (
                <p className="text-[10px] text-muted-foreground/75 mt-1">{STOCK_TRUTH_MESSAGE}</p>
              )}
              <p className="text-[11px] text-muted-foreground mt-1.5">
                {redCount > 0 && <span className="text-destructive font-medium">{redCount} critical</span>}
                {redCount > 0 && yellowCount > 0 && <span className="text-muted-foreground"> · </span>}
                {yellowCount > 0 && <span className="text-warning font-medium">{yellowCount} low</span>}
                {reorderValue > 0 && (
                  <>
                    <span className="text-muted-foreground"> · </span>
                    <span className="text-foreground font-semibold tabular-nums">
                      ${reorderValue.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                    </span>
                    <span className="text-muted-foreground"> est.</span>
                  </>
                )}
              </p>
            </div>
          ) : (
            <div className="flex flex-col gap-0.5">
              <div className="flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-primary shrink-0" />
                <h3 className="text-sm font-bold tracking-tight">Smart Order</h3>
              </div>
              <p className="text-[11px] text-muted-foreground">Top items to reorder today</p>
              {lastApprovedAt != null && (
                <p className="text-[10px] text-muted-foreground/75 mt-1">{STOCK_TRUTH_MESSAGE}</p>
              )}
            </div>
          )}
        </div>
        {hasItems && (
          <Button
            onClick={() => navigate("/app/smart-order")}
            className="bg-gradient-orange text-white shadow-orange hover:opacity-90 h-8 px-4 text-xs font-semibold shrink-0 ml-3"
          >
            Generate Smart Order
          </Button>
        )}
      </div>
      <CardContent className="pt-0 pb-4 px-5">
        {!hasItems ? (
          <div className="flex flex-col items-center py-10 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/6 mb-4">
              <Sparkles className="h-7 w-7 text-primary/40" />
            </div>
            <p className="text-sm font-semibold text-muted-foreground">No smart orders yet</p>
            <p className="text-xs text-muted-foreground/60 mt-1 max-w-[280px]">
              Complete and approve an inventory count to unlock AI-powered reorder suggestions based on your PAR levels and usage trends.
            </p>
            <Button
              variant="outline"
              size="sm"
              className="mt-4 text-xs h-8"
              onClick={() => navigate("/app/inventory/enter")}
            >
              Start Your First Count
            </Button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/20 hover:bg-muted/20">
                  <TableHead className="text-[11px] font-semibold uppercase tracking-wider">Item</TableHead>
                  <TableHead className="text-[11px] font-semibold uppercase tracking-wider text-right">On hand (count)</TableHead>
                  <TableHead className="text-[11px] font-semibold uppercase tracking-wider text-right">PAR</TableHead>
                  <TableHead className="text-[11px] font-semibold uppercase tracking-wider text-right">Order Qty</TableHead>
                  <TableHead className="text-[11px] font-semibold uppercase tracking-wider text-center">Risk</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {topReorder.slice(0, 8).map((item, i) => (
                  <TableRow key={i} className="hover:bg-muted/20">
                    <TableCell className="text-sm font-medium">{item.item_name}</TableCell>
                    <TableCell className="text-sm text-right font-mono tabular-nums">
                      {formatInventoryQty(Number(item.current_stock ?? 0))}
                    </TableCell>
                    <TableCell className="text-sm text-right font-mono text-muted-foreground tabular-nums">
                      {formatInventoryQty(Number(item.par_level ?? 0))}
                    </TableCell>
                    <TableCell className="text-sm text-right font-mono font-semibold tabular-nums">
                      {formatInventoryQty(item.suggestedOrder)}
                    </TableCell>
                    <TableCell className="text-center">{riskBadge(item.ratio)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Today's Waste Snapshot ───
function WasteSnapshot({ entries, navigate }: { entries: WasteLogSnapshotRow[]; navigate: (p: string) => void }) {
  const { totalQty, recentEntries } = summarizeWasteSnapshot(entries);

  return (
    <Card className="hover:shadow-md transition-all duration-200">
      <div className="flex items-center justify-between p-5 pb-3">
        <div className="flex items-center gap-2">
          <Trash2 className="h-4 w-4 text-warning" />
          <h3 className="text-sm font-bold tracking-tight">Today's Waste Log</h3>
          {entries.length > 0 && (
            <Badge variant="secondary" className="text-[10px] h-5 ml-1">{entries.length} entries</Badge>
          )}
        </div>
        <div className="flex items-center gap-2">
          {entries.length > 0 && (
            <Button variant="outline" size="sm" className="h-7 text-[10px]" onClick={() => navigate("/app/waste-log")}>
              View Full Log →
            </Button>
          )}
          <Button size="sm" className="h-7 text-[10px] bg-gradient-amber shadow-amber text-white" onClick={() => navigate("/app/waste-log")}>
            + Log Waste
          </Button>
        </div>
      </div>
      <CardContent className="pt-0 pb-4 px-5">
        {entries.length === 0 ? (
          <div className="flex items-center gap-2 py-4">
            <CheckCircle2 className="h-5 w-5 text-success shrink-0" />
            <p className="text-sm text-success font-medium">No waste logged today</p>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-4 mb-4">
              <div className="rounded-lg bg-muted/30 p-3">
                <p className="text-[11px] text-muted-foreground mb-1">Entries Today</p>
                <p className="text-lg font-bold tabular-nums">{entries.length}</p>
              </div>
              <div className="rounded-lg bg-muted/30 p-3">
                <p className="text-[11px] text-muted-foreground mb-1">Total Qty Wasted</p>
                <p className="text-lg font-bold tabular-nums text-warning">
                  {totalQty % 1 === 0 ? totalQty : totalQty.toFixed(1)}
                </p>
              </div>
            </div>
            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70 mb-2">Recent Entries</p>
            <div className="space-y-0.5">
              {recentEntries.map((entry, i) => (
                <div key={i} className="flex items-center gap-2 py-1.5 px-2 rounded hover:bg-muted/30 transition-colors">
                  <span className="text-[10px] text-muted-foreground font-mono shrink-0 w-14">
                    {format(new Date(entry.logged_at), "h:mm a")}
                  </span>
                  <span className="text-sm font-medium flex-1 truncate">{entry.item_name}</span>
                  <span className="text-xs font-mono text-muted-foreground shrink-0">×{entry.quantity}</span>
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground shrink-0">
                    {entry.reason.replace(/_/g, " ")}
                  </span>
                </div>
              ))}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Usage & Trend Analytics ───
function AnalyticsSection({ highUsage, trendData }: { highUsage: ComputedUsageItem[]; trendData: { label: string; value: number }[] }) {
  const maxTrendValue = Math.max(...trendData.map(d => d.value), 1);
  const maxUsage = Math.max(...highUsage.map(i => i.weekly_usage), 1);

  return (
    <div className="grid gap-5 lg:grid-cols-2">
      {/* High Usage Items */}
      <Card className="hover:shadow-md transition-all duration-200">
        <div className="flex items-center gap-2 p-5 pb-1">
          <TrendingUp className="h-4 w-4 text-primary" />
          <h3 className="text-sm font-bold tracking-tight">High Usage Items</h3>
          <Badge variant="secondary" className="text-[10px] h-5 ml-1">Computed</Badge>
        </div>
        <p className="text-[11px] text-muted-foreground px-5 pb-3">
          Usage computed between your last 2 approved counts
        </p>
        <CardContent className="pt-0 pb-4 px-5">
          {highUsage.length === 0 ? (
            <div className="flex flex-col items-center py-8 text-center">
              <TrendingUp className="h-8 w-8 text-muted-foreground/15 mb-3" />
              <p className="text-sm font-medium text-muted-foreground">No usage data yet</p>
              <p className="text-xs text-muted-foreground/60 mt-0.5">Complete 2+ approved inventory sessions to compute usage.</p>
            </div>
          ) : (
            <div className="space-y-0.5">
              {highUsage.slice(0, 8).map((item, i) => {
                const pct = Math.min((item.weekly_usage / maxUsage) * 100, 100);
                const barColor = pct > 90 ? "bg-destructive/60" : pct > 70 ? "bg-warning/60" : "bg-success/50";
                return (
                  <div key={i} className="py-2.5 px-3 rounded-lg hover:bg-muted/30 transition-colors">
                    <div className="flex items-center justify-between mb-1.5">
                      <div className="flex items-center gap-3">
                        <span className="text-[11px] font-mono text-muted-foreground/50 w-4">{i + 1}</span>
                        <span className="text-sm font-medium">{item.item_name}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-mono font-semibold">{item.weekly_usage.toFixed(1)}</span>
                        <span className="text-[10px] text-muted-foreground bg-muted/50 px-1.5 py-0.5 rounded">/wk</span>
                      </div>
                    </div>
                    <div className="h-1 w-full rounded-full bg-muted/40 ml-7">
                      <div
                        className={`h-full rounded-full transition-all ${barColor}`}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Inventory Value Trend */}
      <Card className="hover:shadow-md transition-all duration-200">
        <div className="flex items-center gap-2 p-5 pb-3">
          <BarChart3 className="h-4 w-4 text-primary" />
          <h3 className="text-sm font-bold tracking-tight">Inventory Value Trend</h3>
        </div>
        <CardContent className="pt-0 pb-4 px-5">
          {trendData.length < 2 ? (
            <div className="flex flex-col items-center py-8 text-center">
              <BarChart3 className="h-8 w-8 text-muted-foreground/15 mb-3" />
              <p className="text-sm font-medium text-muted-foreground">Not enough data yet</p>
              <p className="text-xs text-muted-foreground/60 mt-0.5">Complete at least 2 approved inventory sessions to see trends.</p>
            </div>
          ) : (
            <div className="flex flex-col items-center py-4">
              <div className="w-full h-32 flex items-end justify-between gap-1.5 px-2">
                {trendData.map((d, i) => (
                  <div key={i} className="flex-1 flex flex-col items-center gap-1">
                    <div
                      className="w-full rounded-t-md bg-primary/15 hover:bg-primary/25 transition-colors relative group"
                      style={{ height: `${Math.max((d.value / maxTrendValue) * 100, 4)}%` }}
                    >
                      <div className="absolute -top-6 left-1/2 -translate-x-1/2 hidden group-hover:block text-[9px] font-mono bg-popover border border-border px-1.5 py-0.5 rounded shadow-sm whitespace-nowrap">
                        ${d.value.toFixed(0)}
                      </div>
                    </div>
                    <span className="text-[9px] text-muted-foreground/50 font-mono">
                      {d.label}
                    </span>
                  </div>
                ))}
              </div>
              <p className="text-[11px] text-muted-foreground/50 mt-3">
                {STOCK_TRUTH_MESSAGE}
              </p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ─── Spend Overview ───
function SpendOverview({
  navigate,
  timeFilter,
  spendData,
}: {
  navigate: (p: string) => void;
  timeFilter: DashboardTimeFilter;
  spendData: { periodSpend: number; vendors: { name: string; total: number }[] } | null;
}) {
  if (!spendData || spendData.periodSpend === 0) return null;

  return (
    <Card className="hover:shadow-md transition-all duration-200">
      <div className="flex items-center justify-between p-5 pb-3">
        <div className="flex items-center gap-2">
          <Receipt className="h-4 w-4 text-primary" />
          <h3 className="text-sm font-bold tracking-tight">Spend Overview</h3>
        </div>
        <Button variant="outline" size="sm" className="h-7 text-[10px]" onClick={() => navigate("/app/invoices")}>
          View All Invoices
        </Button>
      </div>
      <CardContent className="pt-0 pb-4 px-5">
        <div className="rounded-lg bg-muted/30 p-3 mb-4">
          <p className="text-[11px] text-muted-foreground mb-1">{dashboardSpendPeriodLabel(timeFilter)}</p>
          <p className="text-lg font-bold font-mono">${spendData.periodSpend.toFixed(0)}</p>
        </div>
        {spendData.vendors.length > 0 && (
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70 mb-2">Top Vendors</p>
            <div className="space-y-1">
              {spendData.vendors.map((v, i) => (
                <div key={i} className="flex items-center justify-between py-1.5 px-2 rounded hover:bg-muted/30 transition-colors">
                  <span className="text-sm">{v.name}</span>
                  <span className="text-sm font-mono font-semibold">${v.total.toFixed(0)}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ─── PAR Recommendations Panel ───
function RecommendationsPanel({ recommendations }: { recommendations: PARRecommendation[] }) {
  const navigate = useNavigate();

  return (
    <Card className="border-border/60 hover:shadow-md transition-all duration-200">
      <div className="flex items-center justify-between p-5 pb-3">
        <div className="flex items-center gap-2">
          <Zap className="h-4 w-4 text-primary" />
          <h3 className="text-sm font-bold tracking-tight">Recommendations</h3>
          <Badge variant="secondary" className="text-[10px] h-5 ml-1">Rules-Based</Badge>
        </div>
        {recommendations.length > 0 && (
          <Button variant="outline" size="sm" className="h-7 text-[10px]" onClick={() => navigate("/app/par/suggestions")}>
            View All
          </Button>
        )}
      </div>
      <CardContent className="pt-0 pb-4 px-5">
        {recommendations.length === 0 ? (
          <div className="flex flex-col items-center py-8 text-center">
            <Sparkles className="h-8 w-8 text-muted-foreground/15 mb-3" />
            <p className="text-sm font-medium text-muted-foreground">No recommendations yet</p>
            <p className="text-xs text-muted-foreground/60 mt-0.5">Need 3+ approved sessions to generate PAR recommendations.</p>
          </div>
        ) : (
          <div className="space-y-1">
            {recommendations.slice(0, 5).map((rec, i) => (
              <div key={i} className="flex items-start gap-3 py-2.5 px-3 rounded-lg hover:bg-muted/30 transition-colors">
                {rec.type === "increase" ? (
                  <TrendingUp className="h-4 w-4 mt-0.5 shrink-0 text-destructive" />
                ) : rec.type === "decrease" ? (
                  <TrendingDown className="h-4 w-4 mt-0.5 shrink-0 text-warning" />
                ) : (
                  <Activity className="h-4 w-4 mt-0.5 shrink-0 text-primary" />
                )}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium">{rec.item_name}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">{rec.reason}</p>
                  <div className="flex items-center gap-2 mt-1">
                    <span className="text-[10px] font-mono text-muted-foreground">PAR {rec.current_par} → {rec.suggested_par}</span>
                    <Badge variant={rec.change_pct > 0 ? "destructive" : "secondary"} className="text-[9px] h-4">
                      {rec.change_pct > 0 ? "+" : ""}{rec.change_pct}%
                    </Badge>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Multi-Location Section ───
function MultiLocationView({
  restaurants,
  navigate,
  setCurrentRestaurant,
}: {
  restaurants: PortfolioRestaurantRow[];
  navigate: (path: string) => void;
  setCurrentRestaurant: (r: { id: string; name: string; role: string } | null) => void;
}) {
  const sorted = useMemo(() => sortPortfolioRestaurants(restaurants), [restaurants]);

  const maxValue = Math.max(...restaurants.map((r) => r.red + r.yellow + r.green), 1);

  return (
    <div className="space-y-5">
      {/* Location Performance */}
      <Card className="hover:shadow-md transition-all duration-200">
        <div className="flex items-center gap-2 p-5 pb-3">
          <Building2 className="h-4 w-4 text-primary" />
          <h3 className="text-sm font-bold tracking-tight">Location Performance</h3>
        </div>
        <CardContent className="pt-0 pb-5 px-5">
          {restaurants.length === 0 ? (
            <div className="empty-state py-8">
              <Building2 className="empty-state-icon h-8 w-8" />
              <p className="empty-state-title">No restaurants found</p>
            </div>
          ) : (
            <div className="space-y-3">
              {sorted.map((r) => {
                const total = r.red + r.yellow + r.green;
                const redPct = (r.red / Math.max(total, 1)) * 100;
                const yellowPct = (r.yellow / Math.max(total, 1)) * 100;
                const greenPct = (r.green / Math.max(total, 1)) * 100;
                const barWidth = (total / maxValue) * 100;

                return (
                  <button
                    key={r.id}
                    onClick={() => {
                      setCurrentRestaurant({ id: r.id, name: r.name, role: r.role });
                      navigate("/app/dashboard");
                    }}
                    className="w-full flex items-center gap-4 py-2.5 px-3 rounded-lg hover:bg-muted/30 transition-colors text-left group"
                  >
                    <span className="text-sm font-medium w-36 truncate">{r.name}</span>
                    <div className="flex-1 h-5 rounded-full bg-muted/30 overflow-hidden">
                      <div className="h-full flex" style={{ width: `${barWidth}%` }}>
                        {redPct > 0 && <div className="h-full bg-destructive/80" style={{ width: `${redPct}%` }} />}
                        {yellowPct > 0 && <div className="h-full bg-warning/80" style={{ width: `${yellowPct}%` }} />}
                        {greenPct > 0 && <div className="h-full bg-success/80" style={{ width: `${greenPct}%` }} />}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 text-[11px] font-mono shrink-0">
                      <span className="text-destructive">{r.red}</span>
                      <span className="text-warning">{r.yellow}</span>
                      <span className="text-success">{r.green}</span>
                    </div>
                    <ArrowRight className="h-3.5 w-3.5 text-muted-foreground/30 group-hover:text-foreground transition-colors shrink-0" />
                  </button>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Store Ranking */}
      <Card className="hover:shadow-md transition-all duration-200">
        <div className="flex items-center gap-2 p-5 pb-3">
          <BarChart3 className="h-4 w-4 text-primary" />
          <h3 className="text-sm font-bold tracking-tight">Store Ranking</h3>
        </div>
        <CardContent className="pt-0 pb-4 px-5">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/20 hover:bg-muted/20">
                <TableHead className="text-[11px] font-semibold uppercase tracking-wider">Restaurant</TableHead>
                <TableHead className="text-[11px] font-semibold uppercase tracking-wider text-center">Critical</TableHead>
                <TableHead className="text-[11px] font-semibold uppercase tracking-wider text-center">Low</TableHead>
                <TableHead className="text-[11px] font-semibold uppercase tracking-wider text-center">Orders</TableHead>
                <TableHead className="text-[11px] font-semibold uppercase tracking-wider">Last Approved</TableHead>
                <TableHead className="text-[11px] font-semibold uppercase tracking-wider text-center">Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sorted.map((r) => (
                <TableRow
                  key={r.id}
                  className="hover:bg-muted/20 cursor-pointer transition-colors"
                  onClick={() => {
                    setCurrentRestaurant({ id: r.id, name: r.name, role: r.role });
                    navigate("/app/dashboard");
                  }}
                >
                  <TableCell className="font-medium text-sm">{r.name}</TableCell>
                  <TableCell className="text-center">
                    {r.red > 0 ? <Badge variant="destructive" className="text-[10px]">{r.red}</Badge> : <span className="text-muted-foreground text-xs">0</span>}
                  </TableCell>
                  <TableCell className="text-center">
                    {r.yellow > 0 ? <Badge className="bg-warning text-warning-foreground text-[10px]">{r.yellow}</Badge> : <span className="text-muted-foreground text-xs">0</span>}
                  </TableCell>
                  <TableCell className="text-center text-sm font-mono">{r.recentOrders}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {r.lastApproved ? new Date(r.lastApproved).toLocaleDateString() : "—"}
                  </TableCell>
                  <TableCell className="text-center">
                    {r.red === 0 && r.yellow === 0 ? (
                      <Badge className="bg-success/10 text-success text-[10px] border-0">Best</Badge>
                    ) : r.red > 2 ? (
                      <Badge className="bg-destructive/10 text-destructive text-[10px] border-0">Needs Attention</Badge>
                    ) : (
                      <Badge variant="secondary" className="text-[10px]">OK</Badge>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

// ─── Portfolio Dashboard (All Restaurants) ───
function PortfolioDashboard({
  setCurrentRestaurant,
}: {
  setCurrentRestaurant: (r: { id: string; name: string; role: string } | null) => void;
}) {
  const [timeFilter, setTimeFilter] = useState<DashboardTimeFilter>("this_week");
  const navigate = useNavigate();
  const { restaurants: switcherRestaurants } = useRestaurant();
  const { data, loading } = usePortfolioDashboardData(timeFilter);

  if (loading) {
    return (
      <div className="space-y-5 animate-fade-in">
        <Skeleton className="h-14 rounded-xl" />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">{[1, 2, 3, 4].map(i => <Skeleton key={i} className="h-28 rounded-xl" />)}</div>
        <div className="grid gap-5 lg:grid-cols-2">{[1, 2].map(i => <Skeleton key={i} className="h-64 rounded-xl" />)}</div>
      </div>
    );
  }

  const totals: PortfolioDashboardTotals = data?.totals ?? { red: 0, yellow: 0, green: 0 };
  const restaurants: PortfolioRestaurantRow[] = data?.restaurants ?? [];
  const { totalItems, portfolioOverstockValue } = buildPortfolioSummary(totals);

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold tracking-tight font-display">Portfolio Dashboard</h1>
          <p className="text-sm text-muted-foreground mt-0.5">{restaurants.length} location{restaurants.length !== 1 ? "s" : ""} · Overview</p>
        </div>
      </div>

      <Alert className="border-amber-400/70 bg-amber-50 text-amber-900 dark:border-amber-600/50 dark:bg-amber-950/40 dark:text-amber-100 [&>svg]:text-amber-600 dark:[&>svg]:text-amber-400">
        <AlertTriangle className="h-4 w-4" />
        <AlertTitle className="text-sm font-semibold">Do not use for ordering decisions</AlertTitle>
        <AlertDescription className="text-sm leading-snug">
          Portfolio rollups (stock levels, spend, overstock) are approximate and can differ from individual site dashboards.
          {" "}Open a single restaurant for accurate data before placing orders or making purchasing decisions.
          {switcherRestaurants.length > 0 ? (
            <Button
              type="button"
              variant="link"
              className="h-auto p-0 pl-1 text-sm font-semibold text-amber-800 dark:text-amber-300 underline-offset-2"
              onClick={() => setCurrentRestaurant(switcherRestaurants[0])}
            >
              Open a restaurant →
            </Button>
          ) : null}
        </AlertDescription>
      </Alert>

      <TodaysBriefing
        timeFilter={timeFilter}
        setTimeFilter={setTimeFilter}
        onStartInventory={() => navigate("/app/inventory/enter")}
        stockStatus={totals}
        pendingInvoices={0}
        daysSinceLastCount={null}
      />

      {/* KPI Cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard icon={Package} label="Total Items Tracked" value={totalItems.toLocaleString()} accent="primary" />
        <KpiCard icon={AlertTriangle} label="At Risk Items" value={String(totals.red + totals.yellow)} accent="destructive" changeLabel={`${totals.red} critical · ${totals.yellow} low`} />
        <KpiCard
          icon={Package}
          label="Overstock Value"
          value={portfolioOverstockValue > 0 ? `$${portfolioOverstockValue.toFixed(0)}` : "$0"}
          accent="warning"
          changeLabel="Estimated value above PAR"
        />
        <KpiCard
          icon={DollarSign}
          label={dashboardSpendPeriodLabel(timeFilter)}
          value={totals.spendMonth > 0 ? `$${totals.spendMonth.toFixed(0)}` : "$0"}
          accent="success"
          changeLabel="From completed invoices"
        />
      </div>

      {/* Action Center + AI Insights */}
      <div className="grid gap-5 lg:grid-cols-2">
        <ActionCenter
          criticalCount={totals.red}
          pendingApprovals={0}
          daysSinceLastCount={null}
          recommendationsCount={0}
          todayWasteCount={0}
          deliveryIssueCount={0}
          navigate={navigate}
        />
        <RecommendationsPanel recommendations={[]} />
      </div>

      {/* Multi-Location Section */}
      <MultiLocationView restaurants={restaurants} navigate={navigate} setCurrentRestaurant={setCurrentRestaurant} />
    </div>
  );
}

// ─── Profit & Loss Intelligence ───
function ProfitLossIntelligence({
  overstockValue,
  recordedWasteValue,
  recordedWasteCount,
  priceIncreaseImpact,
  deliveryIssuesCount,
  missingParCount,
  topReorder,
  todayWasteEntries,
  navigate,
}: {
  overstockValue: number;
  recordedWasteValue: number;
  recordedWasteCount: number;
  priceIncreaseImpact: number;
  deliveryIssuesCount: number;
  missingParCount: number;
  topReorder: TopReorderItem[];
  todayWasteEntries: WasteLogSnapshotRow[];
  navigate: (path: string) => void;
}) {
  const totalSavingsOpportunity = overstockValue + recordedWasteValue + priceIncreaseImpact;
  const criticalStockItems = topReorder.filter((item) => item.ratio <= 0.2);

  const lossSignals: Array<{
    icon: LucideIcon;
    label: string;
    value: string;
    accent: string;
    route: string;
  }> = [];

  try {
    if (overstockValue > 0) {
      lossSignals.push({
        icon: Package,
        label: "Overstock exposure",
        value: `$${overstockValue.toLocaleString(undefined, { maximumFractionDigits: 0 })}`,
        accent: "text-warning",
        route: "/app/inventory/enter",
      });
    }
    if (priceIncreaseImpact > 0) {
      lossSignals.push({
        icon: TrendingUp,
        label: "Price increase impact",
        value: `$${priceIncreaseImpact.toLocaleString(undefined, { maximumFractionDigits: 0 })}`,
        accent: "text-destructive",
        route: "/app/invoices",
      });
    }
    if (recordedWasteValue > 0) {
      lossSignals.push({
        icon: Trash2,
        label: "Recorded waste value",
        value: `$${recordedWasteValue.toLocaleString(undefined, { maximumFractionDigits: 0 })}`,
        accent: "text-warning",
        route: "/app/waste",
      });
    } else if (recordedWasteCount > 0) {
      lossSignals.push({
        icon: Trash2,
        label: "Waste entries (no cost data)",
        value: `${recordedWasteCount} entr${recordedWasteCount !== 1 ? "ies" : "y"}`,
        accent: "text-muted-foreground",
        route: "/app/waste",
      });
    }
    if (criticalStockItems.length > 0) {
      lossSignals.push({
        icon: AlertTriangle,
        label: `${criticalStockItems.length} item${criticalStockItems.length !== 1 ? "s" : ""} near stock-out`,
        value: "Critical",
        accent: "text-destructive",
        route: "/app/smart-order",
      });
    }
    if (deliveryIssuesCount > 0) {
      lossSignals.push({
        icon: Truck,
        label: "Unresolved delivery issues",
        value: String(deliveryIssuesCount),
        accent: "text-orange-500",
        route: "/app/invoices",
      });
    }
  } catch (_) {
    // best effort
  }

  const suggestions: Array<{
    label: string;
    description: string;
    route: string;
    cta: string;
  }> = [];

  try {
    if (overstockValue > 0) {
      suggestions.push({
        label: "Reduce overstock",
        description: `$${overstockValue.toLocaleString(undefined, { maximumFractionDigits: 0 })} tied up above PAR — pause reorders on those items.`,
        route: "/app/inventory/enter",
        cta: "Count inventory",
      });
    }
    if (missingParCount > 0) {
      suggestions.push({
        label: "Set missing PAR levels",
        description: `${missingParCount} item${missingParCount !== 1 ? "s" : ""} have no PAR — reorder guidance is incomplete.`,
        route: "/app/catalog",
        cta: "Open catalog",
      });
    }
    if (deliveryIssuesCount > 0) {
      suggestions.push({
        label: "Resolve delivery issues",
        description: `${deliveryIssuesCount} invoice${deliveryIssuesCount !== 1 ? "s" : ""} flagged with discrepancies.`,
        route: "/app/invoices",
        cta: "Review invoices",
      });
    }
    if (priceIncreaseImpact > 0) {
      suggestions.push({
        label: "Review price increase alerts",
        description: `Vendors charged $${priceIncreaseImpact.toLocaleString(undefined, { maximumFractionDigits: 0 })} above PO prices.`,
        route: "/app/invoices",
        cta: "Review invoices",
      });
    }
    if (recordedWasteCount > 0) {
      suggestions.push({
        label: "Review waste log",
        description: `${recordedWasteCount} waste entr${recordedWasteCount !== 1 ? "ies" : "y"} recorded — identify patterns to reduce losses.`,
        route: "/app/waste",
        cta: "Open waste log",
      });
    }
    suggestions.push({
      label: "Build a smart order",
      description: "Generate a data-driven order based on current PAR gaps.",
      route: "/app/smart-order",
      cta: "Start order",
    });
  } catch (_) {
    // best effort
  }

  if (lossSignals.length === 0 && suggestions.length <= 1) return null;

  return (
    <section className="mt-8 space-y-4" aria-labelledby="dash-pnl-heading">
      <h2 id="dash-pnl-heading" className="text-sm font-semibold tracking-tight text-foreground">
        Profit &amp; Loss Intelligence
      </h2>

      {totalSavingsOpportunity > 0 && (
        <div className="rounded-lg border border-success/25 bg-success/[0.05] px-4 py-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <DollarSign className="h-4 w-4 text-success shrink-0" />
            <p className="text-sm font-medium">
              <span className="font-bold text-success">
                ${totalSavingsOpportunity.toLocaleString(undefined, { maximumFractionDigits: 0 })}
              </span>
              {" "}potential savings identified this period
            </p>
          </div>
          <Badge className="bg-success/10 text-success border-0 text-[10px] shrink-0">Take Action</Badge>
        </div>
      )}

      <div className="grid gap-5 lg:grid-cols-2">
        {/* High Loss Products */}
        <Card className="hover:shadow-md transition-all duration-200">
          <div className="flex items-center gap-2 p-5 pb-3">
            <TrendingDown className="h-4 w-4 text-destructive" />
            <h3 className="text-sm font-bold tracking-tight">High Loss Products</h3>
          </div>
          <CardContent className="pt-0 pb-4 px-5">
            {lossSignals.length === 0 ? (
              <div className="flex flex-col items-center py-8 text-center">
                <CheckCircle2 className="h-8 w-8 text-success/30 mb-3" />
                <p className="text-sm font-medium text-muted-foreground">No loss signals detected</p>
                <p className="text-xs text-muted-foreground/60 mt-0.5">Keep counting — you're on track.</p>
              </div>
            ) : (
              <div className="space-y-0.5">
                {lossSignals.map((signal, i) => {
                  const Icon = signal.icon;
                  return (
                    <button
                      key={i}
                      onClick={() => navigate(signal.route)}
                      className="w-full flex items-center gap-3 py-2.5 px-3 rounded-lg hover:bg-muted/30 transition-colors text-left group"
                    >
                      <span className="text-[11px] font-mono text-muted-foreground/40 w-4 shrink-0">{i + 1}</span>
                      <Icon className={`h-4 w-4 shrink-0 ${signal.accent}`} />
                      <span className="text-sm flex-1 min-w-0 truncate">{signal.label}</span>
                      <span className={`text-sm font-mono font-semibold shrink-0 ${signal.accent}`}>{signal.value}</span>
                      <ArrowRight className="h-3 w-3 text-muted-foreground/20 group-hover:text-foreground/40 transition-colors shrink-0" />
                    </button>
                  );
                })}
                {todayWasteEntries.length > 0 && (
                  <div className="mt-2 pt-2 border-t border-border/40">
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/50 mb-1.5 px-3">
                      Today&apos;s waste
                    </p>
                    {todayWasteEntries.slice(0, 3).map((e, i) => (
                      <div key={i} className="flex items-center gap-3 py-1.5 px-3 text-xs text-muted-foreground">
                        <span className="flex-1 truncate">{e.item_name}</span>
                        <span className="font-mono">{Number(e.quantity).toFixed(1)}</span>
                        {e.reason && (
                          <Badge variant="secondary" className="text-[9px] h-4">{e.reason}</Badge>
                        )}
                      </div>
                    ))}
                    {todayWasteEntries.length > 3 && (
                      <p className="text-[11px] text-muted-foreground/50 px-3 mt-1">
                        +{todayWasteEntries.length - 3} more
                      </p>
                    )}
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Savings Suggestions */}
        <Card className="hover:shadow-md transition-all duration-200">
          <div className="flex items-center gap-2 p-5 pb-3">
            <Sparkles className="h-4 w-4 text-primary" />
            <h3 className="text-sm font-bold tracking-tight">Savings Suggestions</h3>
          </div>
          <CardContent className="pt-0 pb-4 px-5">
            <div className="space-y-1">
              {suggestions.map((s, i) => (
                <div
                  key={i}
                  className="flex items-start gap-3 py-2.5 px-3 rounded-lg hover:bg-muted/30 transition-colors"
                >
                  <span className="text-[10px] font-mono font-bold text-primary/50 mt-0.5 shrink-0">
                    {String.fromCharCode(65 + i)}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium">{s.label}</p>
                    <p className="text-xs text-muted-foreground mt-0.5 leading-snug">{s.description}</p>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 text-[10px] shrink-0 mt-0.5"
                    onClick={() => navigate(s.route)}
                  >
                    {s.cta}
                  </Button>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </section>
  );
}

// ─── Single Restaurant Dashboard ───
function SingleDashboard() {
  const { currentRestaurant, currentLocation, locations } = useRestaurant();
  const perms = useLocationPermissions();
  const navigate = useNavigate();
  const [timeFilter, setTimeFilter] = useState<DashboardTimeFilter>("this_week");
  const {
    stockStatus,
    topReorder,
    reorderSummary,
    highUsage,
    recommendations,
    loading,
    error,
    refetch,
    inventoryValue,
    missingCostCount,
    trendData,
    pendingInvoices,
    overstockValue,
    lastSessionDate,
    lastSessionName,
    todayWasteEntries,
    spendOverviewData,
    missingParCount,
    periodSpend,
    deliveryIssuesCount,
    priceIncreaseImpact,
    recordedWasteValue,
    recordedWasteCount,
    wasteItemsMissingCost,
  } = useDashboardData({
    currentRestaurantId: currentRestaurant?.id,
    currentLocationId: currentLocation?.id,
    timeFilter,
  });

  const daysSinceLastCount = lastSessionDate ? differenceInDays(new Date(), lastSessionDate) : null;

  const profitIntelligenceActions = useMemo((): ProfitIntelligenceAction[] => {
    return buildProfitIntelligenceActions({
      reorderSummary,
      deliveryIssuesCount,
      priceIncreaseImpact,
      missingParCount,
    });
  }, [reorderSummary, deliveryIssuesCount, priceIncreaseImpact, missingParCount]);

  const {
    reorderValue,
    criticalLowCount,
    unitsToReorder,
    inventoryValueLabel,
    lastCountAccent,
    lastCountLabel,
    lastCountDescription,
  } = useMemo(
    () =>
      buildDashboardDisplayState({
        reorderSummary,
        daysSinceLastCount,
        lastSessionDate,
        lastSessionName,
        missingCostCount,
      }),
    [reorderSummary, daysSinceLastCount, lastSessionDate, lastSessionName, missingCostCount],
  );

  if (loading) {
    return (
      <div className="space-y-6 animate-fade-in">
        <Skeleton className="h-16 rounded-xl" />
        <Skeleton className="h-5 w-40 rounded-md" />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-32 rounded-xl" />
          ))}
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-28 rounded-xl" />
          ))}
        </div>
        <div className="grid gap-5 lg:grid-cols-2">
          {[1, 2].map((i) => (
            <Skeleton key={i} className="h-72 rounded-xl" />
          ))}
        </div>
        <Skeleton className="h-5 w-32 rounded-md" />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-28 rounded-xl" />
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center gap-4 py-24 text-center">
        <AlertTriangle className="h-10 w-10 text-destructive/40" />
        <div>
          <p className="text-sm font-semibold">Dashboard data couldn't load</p>
          <p className="text-xs text-muted-foreground mt-1">Check your connection and try again.</p>
        </div>
        <Button variant="outline" size="sm" onClick={refetch}>Retry</Button>
      </div>
    );
  }

  const ownerActiveLocationCount =
    currentRestaurant?.role === "OWNER"
      ? locations.filter((l) => l.restaurant_id === currentRestaurant.id && l.is_active).length
      : 0;

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold tracking-tight font-display">Dashboard</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {currentRestaurant?.name}
            {currentLocation ? ` · ${currentLocation.name}` : ""}
          </p>
          {lastSessionDate && (
            <p className="text-xs text-muted-foreground/90 mt-1.5 max-w-2xl leading-snug">
              {STOCK_TRUTH_MESSAGE}
            </p>
          )}
        </div>
      </div>

      {currentRestaurant?.role === "OWNER" && ownerActiveLocationCount > 1 && currentLocation ? (
        <div className="rounded-lg border border-primary/15 bg-primary/[0.04] px-4 py-3 text-sm">
          <span className="text-muted-foreground">Viewing </span>
          <span className="font-medium text-foreground">{currentLocation.name}</span>
          <span className="text-muted-foreground"> — </span>
          <Link
            to="/app/dashboard/all"
            className="font-semibold text-primary hover:underline inline-flex items-center gap-1"
          >
            See all {ownerActiveLocationCount} locations
            <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>
      ) : null}

      {/* Today's Briefing */}
      <TodaysBriefing
        timeFilter={timeFilter}
        setTimeFilter={setTimeFilter}
        onStartInventory={() => navigate("/app/inventory/enter")}
        stockStatus={stockStatus}
        pendingInvoices={pendingInvoices}
        daysSinceLastCount={daysSinceLastCount}
      />

      {missingCostCount > 0 ? (
        <Alert className="border-amber-200/80 bg-amber-50/80 text-amber-950 dark:border-amber-800/60 dark:bg-amber-950/25 dark:text-amber-100/95 [&>svg]:text-amber-700 dark:[&>svg]:text-amber-400">
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>
            {missingCostCount} item{missingCostCount === 1 ? "" : "s"} missing cost. Inventory and reorder values may be understated.
          </AlertDescription>
        </Alert>
      ) : null}

      {/* Section 1 — Today's situation */}
      <section className="space-y-4" aria-labelledby="dash-today-heading">
        <h2 id="dash-today-heading" className="text-sm font-semibold tracking-tight text-foreground">
          Today&apos;s situation
        </h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <KpiCard
            icon={ShoppingCart}
            label="Reorder needed today"
            value={
              reorderValue > 0
                ? `$${reorderValue.toLocaleString(undefined, { maximumFractionDigits: 0 })}`
                : "$0"
            }
            accent="success"
            changeLabel={
              reorderSummary?.missingCostCount
                ? `excl. ${reorderSummary.missingCostCount} items — no cost data`
                : "Estimated to reach PAR levels"
            }
          />
          <KpiCard
            icon={AlertTriangle}
            label="Critical low stock items"
            value={String(criticalLowCount)}
            accent="destructive"
            changeLabel="May stock out soon"
          />
          <KpiCard
            icon={Package}
            label="Overstock at risk"
            value={
              overstockValue > 0
                ? `$${overstockValue.toLocaleString(undefined, { maximumFractionDigits: 0 })}`
                : "$0"
            }
            accent="warning"
            changeLabel={
              reorderSummary?.missingCostCount
                ? `excl. ${reorderSummary.missingCostCount} items — no cost data`
                : "Inventory above PAR"
            }
          />
          <KpiCard
            icon={Receipt}
            label={dashboardSpendPeriodLabel(timeFilter)}
            value={
              periodSpend > 0
                ? `$${periodSpend.toLocaleString(undefined, { maximumFractionDigits: 0 })}`
                : "$0"
            }
            accent="primary"
            changeLabel={spendPeriodSubtitle(timeFilter)}
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <KpiCard
            icon={DollarSign}
            label="Inventory value"
            value={
              !perms.can_see_inventory_value
                ? "—"
                : inventoryValue > 0
                  ? `$${inventoryValue.toLocaleString(undefined, { maximumFractionDigits: 0 })}`
                  : "$0"
            }
            accent="primary"
            changeLabel={inventoryValueLabel}
          />
          <KpiCard
            icon={ClipboardCheck}
            label="Units to reorder"
            value={unitsToReorder > 0 ? formatInventoryQty(unitsToReorder) : "0"}
            accent="primary"
            changeLabel={`${stockStatus.yellow} low-stock items (not critical)`}
          />
          <KpiCard
            icon={CalendarDays}
            label="Last count"
            value={lastCountLabel}
            accent={lastCountAccent}
            changeLabel={lastCountDescription}
          />
        </div>

        <div className="grid gap-5 lg:grid-cols-2">
          <ActionCenter
            criticalCount={stockStatus.red}
            pendingApprovals={pendingInvoices}
            daysSinceLastCount={daysSinceLastCount}
            recommendationsCount={recommendations.length}
            todayWasteCount={todayWasteEntries.length}
            deliveryIssueCount={deliveryIssuesCount}
            profitIntelligenceActions={profitIntelligenceActions}
            navigate={navigate}
          />
          <SmartOrderPreview
            topReorder={topReorder}
            redCount={stockStatus.red}
            yellowCount={stockStatus.yellow}
            reorderValue={reorderValue}
            navigate={navigate}
            lastApprovedAt={lastSessionDate}
          />
        </div>
      </section>

      {/* Section 2 — This period */}
      <section className="mt-8 space-y-4" aria-labelledby="dash-period-heading">
        <h2 id="dash-period-heading" className="text-sm font-semibold tracking-tight text-foreground">
          This period
        </h2>
        <p className="text-xs text-muted-foreground -mt-2">
          Same window as the spend card: {spendPeriodPlainName(timeFilter)}.
        </p>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <KpiCard
            icon={Receipt}
            label={dashboardSpendPeriodLabel(timeFilter)}
            value={
              periodSpend > 0
                ? `$${periodSpend.toLocaleString(undefined, { maximumFractionDigits: 0 })}`
                : "$0"
            }
            accent="success"
            changeLabel={spendPeriodSubtitle(timeFilter)}
          />
          <KpiCard
            icon={Truck}
            label="Delivery issues"
            value={String(deliveryIssuesCount)}
            accent={deliveryIssuesCount > 0 ? "destructive" : "primary"}
            changeLabel="Invoice discrepancies caught this period"
          />
          <KpiCard
            icon={TrendingUp}
            label="Price increase impact"
            value={
              priceIncreaseImpact > 0
                ? `$${priceIncreaseImpact.toLocaleString(undefined, { maximumFractionDigits: 0 })}`
                : "$0"
            }
            accent="warning"
            changeLabel="vs. PO prices — flagged automatically"
          />
        </div>
      </section>

      {/* Section 3 — Loss & waste */}
      <section className="mt-8 space-y-4" aria-labelledby="dash-loss-heading">
        <h2 id="dash-loss-heading" className="text-sm font-semibold tracking-tight text-foreground">
          Loss &amp; waste
        </h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <KpiCard
            icon={Trash2}
            label="Recorded waste"
            value={
              recordedWasteValue > 0
                ? `$${recordedWasteValue.toLocaleString(undefined, { maximumFractionDigits: 0 })}`
                : recordedWasteCount > 0
                  ? `${recordedWasteCount} entr${recordedWasteCount !== 1 ? "ies" : "y"}`
                  : "$0"
            }
            accent="warning"
            changeLabel={
              recordedWasteCount === 0
                ? "No waste logged in this period"
                : wasteItemsMissingCost > 0
                  ? `excl. ${wasteItemsMissingCost} entr${wasteItemsMissingCost !== 1 ? "ies" : "y"} — no cost data`
                  : recordedWasteValue > 0
                    ? "From logged costs when available"
                    : "Add catalog links on waste entries to estimate dollars"
            }
          />
          <KpiCard
            icon={AlertTriangle}
            label="Items missing PAR"
            value={String(missingParCount)}
            accent={missingParCount > 0 ? "destructive" : "primary"}
            changeLabel={STOCK_TRUTH_MESSAGE}
          />
          <KpiCard
            icon={Package}
            label="Overstock at risk"
            value={
              overstockValue > 0
                ? `$${overstockValue.toLocaleString(undefined, { maximumFractionDigits: 0 })}`
                : "$0"
            }
            accent="warning"
            changeLabel="Same as above — dollars tied up above PAR"
          />
        </div>
      </section>

      <ProfitLossIntelligence
        overstockValue={overstockValue}
        recordedWasteValue={recordedWasteValue}
        recordedWasteCount={recordedWasteCount}
        priceIncreaseImpact={priceIncreaseImpact}
        deliveryIssuesCount={deliveryIssuesCount}
        missingParCount={missingParCount}
        topReorder={topReorder}
        todayWasteEntries={todayWasteEntries}
        navigate={navigate}
      />

      <div className="mt-10 space-y-8 border-t border-border/60 pt-10">
        {/* Today's Waste Snapshot */}
        {currentRestaurant && (
          <WasteSnapshot entries={todayWasteEntries} navigate={navigate} />
        )}

        {/* Spend Overview */}
        {currentRestaurant && (
          <SpendOverview navigate={navigate} timeFilter={timeFilter} spendData={spendOverviewData} />
        )}

        {/* Usage & Trends */}
        <AnalyticsSection highUsage={highUsage} trendData={trendData} />

        {/* AI Insights */}
        <RecommendationsPanel recommendations={recommendations} />
      </div>
    </div>
  );
}

// ─── Main Dashboard Page ───
export default function DashboardPage() {
  const {
    isPortfolioMode,
    setCurrentRestaurant,
    currentRestaurant,
    currentLocation,
    locations,
    loading,
  } = useRestaurant();

  if (loading) {
    return (
      <div className="space-y-6 animate-fade-in">
        <Skeleton className="h-16 rounded-xl" />
        <Skeleton className="h-5 w-40 rounded-md" />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-32 rounded-xl" />
          ))}
        </div>
      </div>
    );
  }

  if (isPortfolioMode) {
    return <PortfolioDashboard setCurrentRestaurant={setCurrentRestaurant} />;
  }

  const ownerActiveLocs =
    currentRestaurant?.role === "OWNER"
      ? locations.filter((l) => l.restaurant_id === currentRestaurant.id && l.is_active)
      : [];

  if (currentRestaurant?.role === "OWNER" && ownerActiveLocs.length > 1 && !currentLocation) {
    return <Navigate to="/app/dashboard/all" replace />;
  }

  return <SingleDashboard />;
}
