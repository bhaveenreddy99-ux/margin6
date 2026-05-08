import { useCallback, useEffect, useMemo, useState } from "react";
import { useRestaurant } from "@/contexts/RestaurantContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Package, AlertTriangle, TrendingUp, TrendingDown, ShoppingCart,
  Building2, Bell, DollarSign, BarChart3, Sparkles,
  ClipboardCheck, Clock, CheckCircle2, Zap, ArrowRight,
  CalendarDays, Activity, Receipt, Trash2, Truck, ChevronDown,
  ArrowDownRight, ArrowUpRight,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useNavigate, Navigate, Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { BarChart, Bar, LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from "recharts";
import { useAllLocationsSummary, getFoodCostStatus, type DateRange, type LocationSummary } from "@/hooks/useAllLocationsSummary";
import { useLocationAlerts, type LocationAlert } from "@/hooks/useLocationAlerts";
import { loadInventoryMetrics } from "@/domain/dashboard/loadInventoryMetrics";
import {
  format,
  differenceInDays,
  formatDistanceToNow,
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

// ─── Shared currency formatter ───
function fmtCurrencyLoc(n: number) {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

function EstMark() {
  return <span className="text-[10px] text-muted-foreground align-super ml-0.5">Est.</span>;
}

function statusBadgeLabel(s: LocationSummary["food_cost_status"]) {
  switch (s) {
    case "good": return "Good";
    case "warning": return "Warning";
    default: return "Critical";
  }
}
function statusBadgeClass(s: LocationSummary["food_cost_status"]) {
  switch (s) {
    case "good": return "border-green-300 text-green-700 bg-green-50 dark:bg-green-950/30";
    case "warning": return "border-amber-300 text-amber-800 bg-amber-50 dark:bg-amber-950/30";
    default: return "border-red-300 text-red-700 bg-red-50 dark:bg-red-950/30";
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
    case "critical": return "border-red-200 bg-red-50/80 hover:bg-red-50 dark:border-red-900/50 dark:bg-red-950/25";
    case "warning": return "border-amber-200 bg-amber-50/80 hover:bg-amber-50 dark:border-amber-900/50 dark:bg-amber-950/25";
    default: return "border-blue-200 bg-blue-50/80 hover:bg-blue-50 dark:border-blue-900/50 dark:bg-blue-950/25";
  }
}
function severityDotClass(sev: LocationAlert["severity"]) {
  switch (sev) {
    case "critical": return "bg-red-600";
    case "warning": return "bg-amber-600";
    default: return "bg-blue-600";
  }
}

// ─── Reports Tab (inlined from SingleReport) ───
function DashboardReportsTab({
  restaurantId,
  locationId,
  canSeeFoodCostPct = true,
  canSeeInventoryValue = true,
  highUsage = [],
  parentTrendData = [],
  recommendations = [],
}: {
  restaurantId: string;
  locationId?: string | null;
  canSeeFoodCostPct?: boolean;
  canSeeInventoryValue?: boolean;
  highUsage?: ComputedUsageItem[];
  parentTrendData?: { label: string; value: number }[];
  recommendations?: PARRecommendation[];
}) {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState(false);
  const [kpis, setKpis] = useState({ value: 0, red: 0, yellow: 0, green: 0, sessions: 0 });
  const [trend, setTrend] = useState<{ week: string; value: number }[]>([]);
  const [topItems, setTopItems] = useState<{ item_name: string; total_value: number; current_stock: number; unit: string }[]>([]);
  const [parMetrics, setParMetrics] = useState<{ total: number; major: number; top5: string[] } | null>(null);
  const [lastApprovedAt, setLastApprovedAt] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    setFetchError(false);
    try {
      const metrics = await loadInventoryMetrics(restaurantId, locationId ?? undefined);
      setLastApprovedAt(metrics.lastSessionApprovedAtIso);
      setKpis({
        value: metrics.inventoryValue,
        red: metrics.stockStatus.red,
        yellow: metrics.stockStatus.yellow,
        green: metrics.stockStatus.green,
        sessions: metrics.lastSessionDate ? 1 : 0,
      });
      setTrend(metrics.trendData.map((p) => ({ week: p.label, value: p.value })));
      setTopItems(metrics.topItemsByValue);
      setParMetrics({
        total: metrics.recommendations.length,
        major: metrics.recommendations.filter((r) => Math.abs(r.change_pct) >= 20).length,
        top5: metrics.recommendations.slice(0, 5).map((r) => r.item_name),
      });
    } catch {
      setFetchError(true);
    } finally {
      setLoading(false);
    }
  }, [restaurantId, locationId]);

  useEffect(() => { loadData(); }, [loadData]);

  if (loading) return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-4">{[1, 2, 3, 4].map(i => <Skeleton key={i} className="h-24 rounded-xl" />)}</div>
      <Skeleton className="h-56 rounded-xl" />
    </div>
  );

  if (fetchError) return (
    <Card><CardContent className="flex flex-col items-center py-14 text-center gap-4">
      <AlertTriangle className="h-8 w-8 text-destructive/40" />
      <div>
        <p className="text-sm font-semibold">Couldn't load this report</p>
        <p className="text-xs text-muted-foreground mt-0.5">Check your connection and try again.</p>
      </div>
      <Button variant="outline" size="sm" onClick={loadData}>Retry</Button>
    </CardContent></Card>
  );

  if (kpis.sessions === 0) return (
    <Card><CardContent className="empty-state py-16">
      <BarChart3 className="empty-state-icon" />
      <p className="empty-state-title">No approved inventory yet</p>
      <p className="empty-state-description">Approve an inventory session to see reports.</p>
    </CardContent></Card>
  );

  return (
    <div className="space-y-5">
      {lastApprovedAt && (
        <p className="text-[11px] text-muted-foreground leading-snug px-0.5">{STOCK_TRUTH_MESSAGE}</p>
      )}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-xl border border-primary/15 bg-card hover:shadow-md transition-all duration-200 p-5">
          <div className="flex items-start justify-between gap-2 mb-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/8">
              <DollarSign className="h-5 w-5 text-primary" />
            </div>
          </div>
          <p className="text-xs font-medium text-muted-foreground">Inventory Value</p>
          <p className="text-3xl font-bold tracking-tight tabular-nums mt-1">{canSeeInventoryValue ? fmtCurrencyLoc(kpis.value) : "—"}</p>
          <p className="text-xs text-muted-foreground/70 mt-2">From last approved count</p>
        </div>
        <div className="rounded-xl border border-destructive/15 bg-card hover:shadow-md transition-all duration-200 p-5">
          <div className="flex items-start justify-between gap-2 mb-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-destructive/8">
              <AlertTriangle className="h-5 w-5 text-destructive" />
            </div>
          </div>
          <p className="text-xs font-medium text-muted-foreground">Critical Items</p>
          <p className="text-3xl font-bold tracking-tight tabular-nums text-destructive mt-1">{kpis.red}</p>
          <p className="text-xs text-muted-foreground/70 mt-2">Below 50% of PAR level</p>
        </div>
        <div className="rounded-xl border border-warning/15 bg-card hover:shadow-md transition-all duration-200 p-5">
          <div className="flex items-start justify-between gap-2 mb-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-warning/8">
              <Package className="h-5 w-5 text-warning" />
            </div>
          </div>
          <p className="text-xs font-medium text-muted-foreground">Low Stock</p>
          <p className="text-3xl font-bold tracking-tight tabular-nums text-warning mt-1">{kpis.yellow}</p>
          <p className="text-xs text-muted-foreground/70 mt-2">Between 50–100% of PAR</p>
        </div>
        <div className="rounded-xl border border-success/15 bg-card hover:shadow-md transition-all duration-200 p-5">
          <div className="flex items-start justify-between gap-2 mb-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-success/8">
              <CheckCircle2 className="h-5 w-5 text-success" />
            </div>
          </div>
          <p className="text-xs font-medium text-muted-foreground">Stocked OK</p>
          <p className="text-3xl font-bold tracking-tight tabular-nums text-success mt-1">{kpis.green}</p>
          <p className="text-xs text-muted-foreground/70 mt-2">At or above PAR level</p>
        </div>
      </div>

      {parMetrics && parMetrics.total > 0 && (
        <Card className="border-primary/20 bg-primary/3">
          <CardContent className="flex items-center justify-between p-4 gap-4 flex-wrap">
            <div className="flex items-center gap-3">
              <div className="h-9 w-9 rounded-xl bg-primary/10 flex items-center justify-center">
                <TrendingUp className="h-4 w-4 text-primary" />
              </div>
              <div>
                <p className="text-sm font-semibold">
                  {parMetrics.total} PAR change{parMetrics.total !== 1 ? "s" : ""} suggested from recent approved counts
                  {canSeeFoodCostPct && parMetrics.major > 0 && (
                    <span className="ml-2 text-[11px] font-normal text-destructive font-medium">• {parMetrics.major} major (≥20%)</span>
                  )}
                </p>
                {parMetrics.top5.length > 0 && (
                  <p className="text-[11px] text-muted-foreground mt-0.5">Top items: {parMetrics.top5.join(", ")}</p>
                )}
              </div>
            </div>
            <Button size="sm" variant="outline" className="gap-1.5 shrink-0 text-xs h-8"
              onClick={() => navigate("/app/par/suggestions")}>
              Review Suggestions <ArrowRight className="h-3 w-3" />
            </Button>
          </CardContent>
        </Card>
      )}

      <div className={trend.length > 1 ? "grid gap-5 lg:grid-cols-2" : "grid gap-5 grid-cols-1"}>
        {trend.length > 1 && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2"><TrendingUp className="h-4 w-4 text-primary" />Inventory Value Trend</CardTitle>
            </CardHeader>
            <CardContent>
              {canSeeFoodCostPct && canSeeInventoryValue ? (
                <ResponsiveContainer width="100%" height={180}>
                  <LineChart data={trend}>
                    <XAxis dataKey="week" tick={{ fontSize: 10 }} tickLine={false} axisLine={false} />
                    <YAxis tick={{ fontSize: 10 }} tickLine={false} axisLine={false} tickFormatter={v => `$${(v / 1000).toFixed(0)}k`} />
                    <Tooltip formatter={(v: number) => [fmtCurrencyLoc(v), "Value"]} labelStyle={{ fontSize: 11 }} contentStyle={{ fontSize: 11, borderRadius: 8 }} />
                    <Line type="monotone" dataKey="value" stroke="hsl(var(--primary))" strokeWidth={2} dot={{ r: 3, fill: "hsl(var(--primary))" }} />
                  </LineChart>
                </ResponsiveContainer>
              ) : (
                <p className="text-sm text-muted-foreground py-10 text-center">Food cost trend hidden</p>
              )}
            </CardContent>
          </Card>
        )}
        {topItems.length > 0 && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2"><DollarSign className="h-4 w-4 text-primary" />Top Items by Value</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {topItems.map((item, i) => (
                  <div key={i} className="flex items-center justify-between text-sm py-1">
                    <span className="text-muted-foreground truncate flex-1 mr-2">{item.item_name}</span>
                    <span className="font-mono font-semibold text-xs">{canSeeInventoryValue ? fmtCurrencyLoc(item.total_value) : "—"}</span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}
      </div>

      <AnalyticsSection highUsage={highUsage} trendData={parentTrendData} />
      <RecommendationsPanel recommendations={recommendations} />
    </div>
  );
}

// ─── Locations Tab (inlined from CompareReport) ───
function DashboardLocationsTab() {
  const navigate = useNavigate();
  const { activeRestaurantIds } = useRestaurant();
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
        <Button variant="outline" size="sm" onClick={() => summary.refetch()}>Retry</Button>
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
                const locTrend = loc.food_cost_trend;
                const vsDisp = diff != null ? `${diff >= 0 ? "+" : ""}${diff.toFixed(1)}%` : "—";
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
                        <>{`${loc.food_cost_pct.toFixed(1)}%`}<EstMark /></>
                      ) : "—"}
                    </TableCell>
                    <TableCell className={`text-xs text-right font-mono ${vsTargetClass(diff)}`}>{vsDisp}</TableCell>
                    <TableCell className="text-xs text-right font-mono">
                      {locTrend == null ? "—" : (
                        <span className={locTrend > 0
                          ? "text-red-600 dark:text-red-400 inline-flex items-center justify-end gap-0.5"
                          : "text-green-600 dark:text-green-400 inline-flex items-center justify-end gap-0.5"}>
                          {locTrend > 0 ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
                          {`${locTrend >= 0 ? "+" : ""}${locTrend.toFixed(1)}% WoW`}
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
                    <Badge variant="outline" className="text-[10px] border-red-300 text-red-700 bg-red-50">Overdue</Badge>
                  ) : null}
                </div>
                <div className="h-2 rounded-full bg-muted/60 overflow-hidden">
                  <div className={`h-full rounded-full ${complianceBarClass(ratio)}`} style={{ width: `${Math.min(100, ratio * 100)}%` }} />
                </div>
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>{loc.counts_this_period} of {loc.counts_expected_this_period} counts completed</span>
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
                  <span className="font-mono text-xs">{fmtCurrencyLoc(w)}</span>
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
    </div>
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
        <div className="grid gap-4 sm:grid-cols-2">
          {[1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-32 rounded-xl" />
          ))}
        </div>
        <div className="grid gap-5 lg:grid-cols-2">
          {[1, 2].map((i) => (
            <Skeleton key={i} className="h-72 rounded-xl" />
          ))}
        </div>
        <Skeleton className="h-12 rounded-lg" />
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
  const isOwner = currentRestaurant?.role === "OWNER";

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold tracking-tight font-display">Dashboard</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {currentRestaurant?.name}
            {currentLocation ? ` · ${currentLocation.name}` : ""}
          </p>
        </div>
      </div>

      {isOwner && ownerActiveLocationCount > 1 && currentLocation ? (
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

      <Tabs defaultValue="today">
        <TabsList className="sticky top-0 z-10 bg-background border-b border-border/40 rounded-none w-full justify-start px-0 mb-6">
          <TabsTrigger value="today" className="text-sm font-medium">Today</TabsTrigger>
          <TabsTrigger value="reports" className="text-sm font-medium">Reports</TabsTrigger>
          {isOwner && ownerActiveLocationCount > 1 && (
            <TabsTrigger value="locations" className="text-sm font-medium">Locations</TabsTrigger>
          )}
        </TabsList>

        <TabsContent value="today">
          <div className="space-y-6">
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

            <section className="space-y-4" aria-labelledby="dash-today-heading">
              <h2 id="dash-today-heading" className="text-sm font-semibold tracking-tight text-foreground">
                Today at a glance
              </h2>
              <div className="grid gap-4 sm:grid-cols-2">
                <KpiCard
                  icon={AlertTriangle}
                  label="Critical low stock items"
                  value={String(criticalLowCount)}
                  accent="destructive"
                  changeLabel="May stock out soon"
                />
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
                  icon={CalendarDays}
                  label="Last count"
                  value={lastCountLabel}
                  accent={lastCountAccent}
                  changeLabel={lastCountDescription}
                />
              </div>
            </section>

            <section className="space-y-4" aria-labelledby="dash-attention-heading">
              <h2 id="dash-attention-heading" className="text-sm font-semibold tracking-tight text-foreground">
                What needs attention
              </h2>
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

            {currentRestaurant && (
              <WasteSnapshot entries={todayWasteEntries} navigate={navigate} />
            )}

            {currentRestaurant && (
              <SpendOverview navigate={navigate} timeFilter={timeFilter} spendData={spendOverviewData} />
            )}
          </div>
        </TabsContent>

        <TabsContent value="reports">
          {currentRestaurant && (
            <DashboardReportsTab
              restaurantId={currentRestaurant.id}
              locationId={currentLocation?.id}
              canSeeFoodCostPct={perms.can_see_food_cost_pct}
              canSeeInventoryValue={perms.can_see_inventory_value}
              highUsage={highUsage}
              parentTrendData={trendData}
              recommendations={recommendations}
            />
          )}
        </TabsContent>

        {isOwner && ownerActiveLocationCount > 1 && (
          <TabsContent value="locations">
            <DashboardLocationsTab />
          </TabsContent>
        )}
      </Tabs>
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
