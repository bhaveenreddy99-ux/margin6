import { useEffect, useState, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useRestaurant } from "@/contexts/RestaurantContext";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Package, AlertTriangle, TrendingUp, TrendingDown, ShoppingCart,
  Building2, Bell, DollarSign, BarChart3, Sparkles,
  ClipboardCheck, Clock, CheckCircle2, Zap, ArrowRight,
  CalendarDays, Activity, Receipt, Trash2
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { format, differenceInDays, startOfDay } from "date-fns";
import { getRisk, computeOrderQty } from "@/lib/inventory-utils";
import { computeUsageAnalytics, computePARRecommendations, type ComputedUsageItem, type PARRecommendation } from "@/lib/usage-analytics";
import { resolvePurchaseHistoryBusinessDate } from "@/lib/purchase-history-source";
import { fetchInvoiceDocumentIdsForRestaurant } from "@/lib/procurement-dedupe";

// ─── Today's Briefing ───
function TodaysBriefing({
  timeFilter,
  setTimeFilter,
  onStartInventory,
  stockStatus,
  pendingInvoices,
  daysSinceLastCount,
}: {
  timeFilter: string;
  setTimeFilter: (v: string) => void;
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
      </div>
      <div className="flex items-center gap-3 shrink-0">
        <Select value={timeFilter} onValueChange={setTimeFilter}>
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
  icon: any;
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
      <CardContent className="p-5">
        <div className="flex items-start justify-between">
          <div className={`flex h-10 w-10 items-center justify-center rounded-xl ${a.bg}`}>
            <Icon className={`h-5 w-5 ${a.text}`} />
          </div>
          {change !== undefined && (
            <div className={`flex items-center gap-0.5 text-[11px] font-semibold ${change >= 0 ? "text-success" : "text-destructive"}`}>
              {change >= 0 ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
              {Math.abs(change)}%
            </div>
          )}
        </div>
        <div className="mt-3">
          <p className="text-2xl font-bold tracking-tight font-display">{value}</p>
          <p className="text-xs text-muted-foreground mt-0.5">{label}</p>
        </div>
        {changeLabel && (
          <p className="text-[11px] text-muted-foreground/70 mt-1">{changeLabel}</p>
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
  navigate,
}: {
  criticalCount: number;
  pendingApprovals: number;
  daysSinceLastCount: number | null;
  recommendationsCount: number;
  todayWasteCount: number;
  deliveryIssueCount: number;
  navigate: (path: string) => void;
}) {
  const items = [
    {
      icon: AlertTriangle,
      label: `${criticalCount} Critical Items Below PAR`,
      color: "text-destructive",
      bg: "bg-destructive/6",
      path: "/app/smart-order",
      show: criticalCount > 0,
    },
    {
      icon: Clock,
      label: `${pendingApprovals} Pending Invoice${pendingApprovals !== 1 ? "s" : ""}`,
      color: "text-primary",
      bg: "bg-primary/6",
      path: "/app/invoices",
      show: pendingApprovals > 0,
    },
    {
      icon: CalendarDays,
      label: "No count in 7+ days — time to count",
      color: "text-warning",
      bg: "bg-warning/6",
      path: "/app/inventory/enter",
      show: daysSinceLastCount !== null && daysSinceLastCount >= 7,
    },
    {
      icon: TrendingUp,
      label: `${recommendationsCount} PAR adjustment${recommendationsCount !== 1 ? "s" : ""} suggested`,
      color: "text-primary",
      bg: "bg-primary/6",
      path: "/app/par/suggestions",
      show: recommendationsCount > 0,
    },
    {
      icon: Trash2,
      label: "No waste logged today — remind staff",
      color: "text-muted-foreground",
      bg: "bg-muted/30",
      path: "/app/waste-log",
      show: daysSinceLastCount !== null && daysSinceLastCount <= 1 && todayWasteCount === 0,
    },
    {
      icon: AlertTriangle,
      label: `${deliveryIssueCount} order${deliveryIssueCount !== 1 ? 's' : ''} with delivery issues`,
      color: "text-destructive",
      bg: "bg-destructive/6",
      path: "/app/invoices",
      show: deliveryIssueCount > 0,
    },
  ].filter((i) => i.show);

  return (
    <Card className="hover:shadow-md transition-all duration-200">
      <div className="flex items-center gap-2 p-5 pb-3">
        <Bell className="h-4 w-4 text-warning" />
        <h3 className="text-sm font-bold tracking-tight">Needs Attention</h3>
        {items.length > 0 && (
          <Badge variant="secondary" className="text-[10px] ml-1 h-5">{items.length}</Badge>
        )}
      </div>
      <CardContent className="pt-0 pb-4 px-5">
        {items.length === 0 ? (
          <div className="flex flex-col items-center py-8 text-center">
            <CheckCircle2 className="h-10 w-10 text-success/30 mb-3" />
            <p className="text-sm font-medium text-muted-foreground">All clear</p>
            <p className="text-xs text-muted-foreground/60 mt-0.5">No actions needed right now</p>
          </div>
        ) : (
          <div className="space-y-1">
            {items.map((item, i) => (
              <button
                key={i}
                onClick={() => navigate(item.path)}
                className="w-full flex items-center gap-3 py-2.5 px-3 rounded-lg hover:bg-muted/40 transition-colors text-left group"
              >
                <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${item.bg}`}>
                  <item.icon className={`h-4 w-4 ${item.color}`} />
                </div>
                <span className="text-sm font-medium flex-1">{item.label}</span>
                <ArrowRight className="h-3.5 w-3.5 text-muted-foreground/40 group-hover:text-foreground transition-colors" />
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
}: {
  topReorder: any[];
  redCount: number;
  yellowCount: number;
  reorderValue: number;
  navigate: (path: string) => void;
}) {
  const riskBadge = (ratio: number) => {
    if (ratio < 0.5) return <Badge variant="destructive" className="text-[10px] font-medium w-12 justify-center">LOW</Badge>;
    if (ratio < 1) return <Badge className="bg-warning text-warning-foreground text-[10px] font-medium w-12 justify-center">MED</Badge>;
    return <Badge className="bg-success text-success-foreground text-[10px] font-medium w-12 justify-center">OK</Badge>;
  };

  const hasItems = topReorder.length > 0;

  return (
    <Card className="hover:shadow-md transition-all duration-200">
      <div className="flex items-center justify-between p-5 pb-3">
        <div className="flex-1 min-w-0">
          {hasItems ? (
            <div className="flex items-center gap-3 flex-wrap">
              <div>
                <p className="text-sm font-bold tracking-tight">
                  Order Needed:
                  {redCount > 0 && <span className="text-destructive ml-1">{redCount} Critical</span>}
                  {redCount > 0 && yellowCount > 0 && <span className="text-muted-foreground">, </span>}
                  {yellowCount > 0 && <span className="text-warning">{yellowCount} Low</span>}
                </p>
                {reorderValue > 0 && (
                  <p className="text-[11px] text-muted-foreground mt-0.5">
                    Est. reorder value: <span className="font-semibold text-foreground font-mono">${reorderValue.toFixed(0)}</span>
                  </p>
                )}
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-primary shrink-0" />
              <h3 className="text-sm font-bold tracking-tight">Smart Order Suggestions</h3>
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
                  <TableHead className="text-[11px] font-semibold uppercase tracking-wider text-right">On Hand</TableHead>
                  <TableHead className="text-[11px] font-semibold uppercase tracking-wider text-right">PAR</TableHead>
                  <TableHead className="text-[11px] font-semibold uppercase tracking-wider text-right">Order Qty</TableHead>
                  <TableHead className="text-[11px] font-semibold uppercase tracking-wider text-center">Risk</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {topReorder.slice(0, 5).map((item, i) => (
                  <TableRow key={i} className="hover:bg-muted/20">
                    <TableCell className="text-sm font-medium">{item.item_name}</TableCell>
                    <TableCell className="text-sm text-right font-mono">{item.current_stock}</TableCell>
                    <TableCell className="text-sm text-right font-mono text-muted-foreground">{item.par_level}</TableCell>
                    <TableCell className="text-sm text-right font-mono font-semibold">{item.suggestedOrder}</TableCell>
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
function WasteSnapshot({ entries, navigate }: { entries: any[]; navigate: (p: string) => void }) {
  const totalQty = entries.reduce((sum, e) => sum + Number(e.quantity), 0);
  const lastThree = entries.slice(0, 3);

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
              {lastThree.map((entry, i) => (
                <div key={i} className="flex items-center gap-2 py-1.5 px-2 rounded hover:bg-muted/30 transition-colors">
                  <span className="text-[10px] text-muted-foreground font-mono shrink-0 w-14">
                    {format(new Date(entry.logged_at), "h:mm a")}
                  </span>
                  <span className="text-sm font-medium flex-1 truncate">{entry.item_name}</span>
                  <span className="text-xs font-mono text-muted-foreground shrink-0">×{entry.quantity}</span>
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground shrink-0">
                    {(entry.reason as string).replace(/_/g, " ")}
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
              <p className="text-[11px] text-muted-foreground/50 mt-3">Inventory value per approved session</p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ─── Spend Overview ───
function SpendOverview({ restaurantId, locationId, navigate }: { restaurantId: string; locationId?: string; navigate: (p: string) => void }) {
  const [spendData, setSpendData] = useState<{ thisWeek: number; thisMonth: number; vendors: { name: string; total: number }[] }>({
    thisWeek: 0, thisMonth: 0, vendors: [],
  });

  useEffect(() => {
    const fetchSpend = async () => {
      const now = new Date();
      const weekStart = new Date(now.getTime() - 7 * 86400000);
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

      const invoiceDocIds = await fetchInvoiceDocumentIdsForRestaurant(restaurantId);

      let invSpendQuery = supabase
        .from("invoices")
        .select("id, vendor_name, created_at, invoice_date")
        .eq("restaurant_id", restaurantId)
        .eq("status", "confirmed");

      if (locationId) {
        invSpendQuery = invSpendQuery.eq("location_id", locationId);
      }

      const { data: invoiceSpendRows } = await invSpendQuery;
      const invoicesInMonth = (invoiceSpendRows ?? []).filter(
        (r) => resolvePurchaseHistoryBusinessDate(r) >= monthStart,
      );
      const invoiceIdsMonth = invoicesInMonth.map((r) => r.id);

      const costByDoc: Record<string, number> = {};
      if (invoiceIdsMonth.length > 0) {
        const { data: invLineCosts } = await supabase
          .from("invoice_items")
          .select("invoice_id, total_cost")
          .in("invoice_id", invoiceIdsMonth);
        (invLineCosts ?? []).forEach((i) => {
          costByDoc[i.invoice_id] = (costByDoc[i.invoice_id] || 0) + Number(i.total_cost || 0);
        });
      }

      let phQuery = supabase
        .from("purchase_history")
        .select("id, vendor_name, created_at, invoice_date")
        .eq("restaurant_id", restaurantId)
        .in("invoice_status", ["COMPLETE", "POSTED"]);

      if (locationId) {
        phQuery = phQuery.eq("location_id", locationId);
      }

      const { data: recentPH } = await phQuery;
      const filteredPH = (recentPH ?? [])
        .filter((p) => !invoiceDocIds.has(p.id))
        .filter((p) => resolvePurchaseHistoryBusinessDate(p) >= monthStart);

      if (filteredPH.length > 0) {
        const phIds = filteredPH.map((p) => p.id);
        const { data: phItems } = await supabase
          .from("purchase_history_items")
          .select("purchase_history_id, total_cost")
          .in("purchase_history_id", phIds);
        (phItems ?? []).forEach((i) => {
          costByDoc[i.purchase_history_id] =
            (costByDoc[i.purchase_history_id] || 0) + Number(i.total_cost || 0);
        });
      }

      if (!invoicesInMonth.length && !filteredPH.length) {
        setSpendData({ thisWeek: 0, thisMonth: 0, vendors: [] });
        return;
      }

      let thisWeek = 0;
      let thisMonth = 0;
      const vendorMap: Record<string, number> = {};

      invoicesInMonth.forEach((p) => {
        const cost = costByDoc[p.id] || 0;
        const businessDate = resolvePurchaseHistoryBusinessDate(p);
        thisMonth += cost;
        if (businessDate >= weekStart) thisWeek += cost;
        const vn = p.vendor_name || "Unknown";
        vendorMap[vn] = (vendorMap[vn] || 0) + cost;
      });

      filteredPH.forEach((p) => {
        const cost = costByDoc[p.id] || 0;
        const businessDate = resolvePurchaseHistoryBusinessDate(p);
        thisMonth += cost;
        if (businessDate >= weekStart) thisWeek += cost;
        const vn = p.vendor_name || "Unknown";
        vendorMap[vn] = (vendorMap[vn] || 0) + cost;
      });

      const vendors = Object.entries(vendorMap)
        .map(([name, total]) => ({ name, total }))
        .sort((a, b) => b.total - a.total)
        .slice(0, 5);

      setSpendData({ thisWeek, thisMonth, vendors });
    };
    fetchSpend();
  }, [restaurantId, locationId]);

  if (spendData.thisMonth === 0) return null;

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
        <div className="grid grid-cols-2 gap-4 mb-4">
          <div className="rounded-lg bg-muted/30 p-3">
            <p className="text-[11px] text-muted-foreground mb-1">This Week</p>
            <p className="text-lg font-bold font-mono">${spendData.thisWeek.toFixed(0)}</p>
          </div>
          <div className="rounded-lg bg-muted/30 p-3">
            <p className="text-[11px] text-muted-foreground mb-1">This Month</p>
            <p className="text-lg font-bold font-mono">${spendData.thisMonth.toFixed(0)}</p>
          </div>
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
function MultiLocationView({ restaurants, navigate, setCurrentRestaurant }: { restaurants: any[]; navigate: any; setCurrentRestaurant: any }) {
  const sorted = useMemo(() => {
    return [...restaurants].sort((a, b) => b.red - a.red);
  }, [restaurants]);

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
function PortfolioDashboard({ setCurrentRestaurant }: { setCurrentRestaurant: (r: any) => void }) {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [timeFilter, setTimeFilter] = useState("this_week");
  const navigate = useNavigate();

  useEffect(() => {
    const fetchPortfolio = async () => {
      setLoading(true);
      const { data: session } = await supabase.auth.getSession();
      const token = session?.session?.access_token;
      if (!token) { setLoading(false); return; }
      try {
        const res = await supabase.functions.invoke("portfolio-dashboard");
        if (res.data) setData(res.data);
      } catch (e) {
        console.error("Portfolio fetch error:", e);
      }
      setLoading(false);
    };
    fetchPortfolio();
  }, []);

  if (loading) {
    return (
      <div className="space-y-5 animate-fade-in">
        <Skeleton className="h-14 rounded-xl" />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">{[1, 2, 3, 4].map(i => <Skeleton key={i} className="h-28 rounded-xl" />)}</div>
        <div className="grid gap-5 lg:grid-cols-2">{[1, 2].map(i => <Skeleton key={i} className="h-64 rounded-xl" />)}</div>
      </div>
    );
  }

  const totals = data?.totals || { red: 0, yellow: 0, green: 0 };
  const restaurants = data?.restaurants || [];
  const totalItems = totals.red + totals.yellow + totals.green;
  const portfolioOverstockValue = totals.overstockValue ?? totals.wasteExposure ?? 0;

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold tracking-tight font-display">Portfolio Dashboard</h1>
          <p className="text-sm text-muted-foreground mt-0.5">{restaurants.length} location{restaurants.length !== 1 ? "s" : ""} · Overview</p>
        </div>
      </div>

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
        <KpiCard icon={DollarSign} label="Spend This Month" value={totals.spendMonth > 0 ? `$${totals.spendMonth.toFixed(0)}` : "$0"} accent="success" changeLabel="From completed invoices" />
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

// ─── Single Restaurant Dashboard ───
function SingleDashboard() {
  const { currentRestaurant, currentLocation } = useRestaurant();
  const navigate = useNavigate();
  const [stockStatus, setStockStatus] = useState({ red: 0, yellow: 0, green: 0 });
  const [topReorder, setTopReorder] = useState<any[]>([]);
  const [highUsage, setHighUsage] = useState<ComputedUsageItem[]>([]);
  const [recommendations, setRecommendations] = useState<PARRecommendation[]>([]);
  const [loading, setLoading] = useState(true);
  const [timeFilter, setTimeFilter] = useState("this_week");
  const [inventoryValue, setInventoryValue] = useState(0);
  const [missingCostCount, setMissingCostCount] = useState(0);
  const [trendData, setTrendData] = useState<{ label: string; value: number }[]>([]);
  const [pendingInvoices, setPendingInvoices] = useState(0);
  const [overstockValue, setOverstockValue] = useState(0);
  const [lastSessionDate, setLastSessionDate] = useState<Date | null>(null);
  const [lastSessionName, setLastSessionName] = useState<string | null>(null);
  const [todayWasteEntries, setTodayWasteEntries] = useState<any[]>([]);
  const [todayWasteCount, setTodayWasteCount] = useState(0);
  const [deliveryIssueCount, setDeliveryIssueCount] = useState(0);

  const daysSinceLastCount = lastSessionDate ? differenceInDays(new Date(), lastSessionDate) : null;

  useEffect(() => {
    if (!currentRestaurant) return;
    (async () => {
      const invoiceDocIds = await fetchInvoiceDocumentIdsForRestaurant(currentRestaurant.id);
      const [{ count: invPending }, { data: phRows }] = await Promise.all([
        supabase
          .from("invoices")
          .select("id", { count: "exact", head: true })
          .eq("restaurant_id", currentRestaurant.id)
          .in("status", ["draft", "review", "ready_to_receive"]),
        supabase
          .from("purchase_history")
          .select("id")
          .eq("restaurant_id", currentRestaurant.id)
          .in("invoice_status", ["DRAFT", "RECEIVED"]),
      ]);
      const phPending = (phRows ?? []).filter((p) => !invoiceDocIds.has(p.id)).length;
      setPendingInvoices((invPending ?? 0) + phPending);
    })();
  }, [currentRestaurant]);

  useEffect(() => {
    if (!currentRestaurant) return;
    supabase
      .rpc('get_delivery_issue_pos', { p_restaurant_id: currentRestaurant.id })
      .then(({ data }) => { if (data) setDeliveryIssueCount(data.length); });
  }, [currentRestaurant]);

  useEffect(() => {
    if (!currentRestaurant) return;
    const fetchData = async () => {
      setLoading(true);
      const rid = currentRestaurant.id;
      const locId = currentLocation?.id;

      // --- Latest approved session + items ---
      let sessionQuery = supabase
        .from("inventory_sessions")
        .select("id, approved_at, name")
        .eq("restaurant_id", rid)
        .eq("status", "APPROVED")
        .order("approved_at", { ascending: false })
        .limit(1);

      if (locId) {
        sessionQuery = sessionQuery.eq("location_id", locId);
      }

      const { data: sessions } = await sessionQuery;

      if (sessions && sessions.length > 0) {
        if (sessions[0].approved_at) {
          setLastSessionDate(new Date(sessions[0].approved_at));
        }
        if (sessions[0].name) {
          setLastSessionName(sessions[0].name);
        }

        const { data: items } = await supabase
          .from("inventory_session_items")
          .select("*")
          .eq("session_id", sessions[0].id);

        if (items) {
          let r = 0, y = 0, g = 0;
          let waste = 0;
          const reorderList = items.map(i => {
            const stock = Number(i.current_stock ?? 0);
            const par = Number(i.par_level ?? 0);
            const risk = getRisk(stock, par);
            if (risk.level === "RED") r++;
            else if (risk.level === "YELLOW") y++;
            else if (risk.level === "GREEN") g++;
            if (par > 0 && stock > par && i.unit_cost) {
              waste += (stock - par) * Number(i.unit_cost);
            }
            return { ...i, suggestedOrder: computeOrderQty(stock, par, i.unit, i.pack_size), ratio: par > 0 ? stock / par : 1 };
          });
          setStockStatus({ red: r, yellow: y, green: g });
          setOverstockValue(waste);
          setTopReorder(reorderList.sort((a, b) => b.suggestedOrder - a.suggestedOrder).slice(0, 8));

          const invVal = items.reduce((sum, i) => sum + Number(i.current_stock ?? 0) * (i.unit_cost || 0), 0);
          setInventoryValue(invVal);
          setMissingCostCount(items.filter(i => !i.unit_cost).length);
        }
      } else {
        setStockStatus({ red: 0, yellow: 0, green: 0 });
        setTopReorder([]);
        setInventoryValue(0);
        setMissingCostCount(0);
        setOverstockValue(0);
        setLastSessionDate(null);
        setLastSessionName(null);
      }

      // --- Inventory Value Trend: last 8 approved sessions ---
      let trendQuery = supabase
        .from("inventory_sessions")
        .select("id, approved_at")
        .eq("restaurant_id", rid)
        .eq("status", "APPROVED")
        .order("approved_at", { ascending: false })
        .limit(8);

      if (locId) {
        trendQuery = trendQuery.eq("location_id", locId);
      }

      const { data: trendSessions } = await trendQuery;

      if (trendSessions && trendSessions.length > 0) {
        const trendResults: { label: string; value: number }[] = [];
        for (const s of trendSessions) {
          const { data: sItems } = await supabase
            .from("inventory_session_items")
            .select("current_stock, unit_cost")
            .eq("session_id", s.id);
          const val = (sItems || []).reduce((sum, i) => sum + i.current_stock * (i.unit_cost || 0), 0);
          trendResults.push({
            label: s.approved_at ? format(new Date(s.approved_at), "MMM d") : "?",
            value: val,
          });
        }
        setTrendData(trendResults.reverse());
      } else {
        setTrendData([]);
      }

      // --- Computed Usage Analytics ---
      const computedUsage = await computeUsageAnalytics(rid, locId);
      setHighUsage(computedUsage);

      // --- PAR Recommendations ---
      const recs = await computePARRecommendations(rid, locId);
      setRecommendations(recs);

      // --- Today's waste entries ---
      try {
        const todayStart = startOfDay(new Date());
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data: wasteToday } = await (supabase as any)
          .from("waste_log")
          .select("item_name, quantity, reason, logged_at")
          .eq("restaurant_id", rid)
          .gte("logged_at", todayStart.toISOString())
          .order("logged_at", { ascending: false })
          .limit(20);
        setTodayWasteEntries((wasteToday as any[]) || []);
        setTodayWasteCount(((wasteToday as any[]) || []).length);
      } catch {
        setTodayWasteEntries([]);
        setTodayWasteCount(0);
      }

      setLoading(false);
    };
    fetchData();
  }, [currentRestaurant, currentLocation]);

  if (loading) {
    return (
      <div className="space-y-5 animate-fade-in">
        <Skeleton className="h-16 rounded-xl" />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">{[1, 2, 3, 4, 5].map(i => <Skeleton key={i} className="h-28 rounded-xl" />)}</div>
        <div className="grid gap-5 lg:grid-cols-2">{[1, 2].map(i => <Skeleton key={i} className="h-64 rounded-xl" />)}</div>
      </div>
    );
  }

  const reorderValue = topReorder.reduce((sum, item) => {
    const cost = item.unit_cost || 0;
    return sum + Math.round(item.suggestedOrder * 100) / 100 * cost;
  }, 0);

  const inventoryValueLabel = missingCostCount > 0
    ? `${missingCostCount} item${missingCostCount !== 1 ? "s" : ""} missing costs`
    : "From latest approved session";

  const lastCountAccent: "success" | "warning" | "destructive" =
    daysSinceLastCount === null ? "destructive"
    : daysSinceLastCount <= 2 ? "success"
    : daysSinceLastCount <= 5 ? "warning"
    : "destructive";

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

      {/* Today's Briefing */}
      <TodaysBriefing
        timeFilter={timeFilter}
        setTimeFilter={setTimeFilter}
        onStartInventory={() => navigate("/app/inventory/enter")}
        stockStatus={stockStatus}
        pendingInvoices={pendingInvoices}
        daysSinceLastCount={daysSinceLastCount}
      />

      {/* Executive KPI Cards — 5 cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <KpiCard
          icon={DollarSign}
          label="Inventory Value ($)"
          value={inventoryValue > 0 ? `$${inventoryValue.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}` : "$0"}
          accent="primary"
          changeLabel={inventoryValueLabel}
        />
        <KpiCard
          icon={AlertTriangle}
          label="At Risk Items"
          value={`${stockStatus.red + stockStatus.yellow}`}
          accent="destructive"
          changeLabel={`${stockStatus.red} critical · ${stockStatus.yellow} low`}
        />
        <KpiCard
          icon={Package}
          label="Overstock Value"
          value={overstockValue > 0 ? `$${overstockValue.toFixed(0)}` : "$0"}
          accent="warning"
          changeLabel="Estimated value above PAR"
        />
        <KpiCard
          icon={ShoppingCart}
          label="Smart Order Ready"
          value={reorderValue > 0 ? `$${reorderValue.toFixed(0)}` : "$0"}
          accent="success"
          changeLabel="Suggested reorder value"
        />
        <KpiCard
          icon={CalendarDays}
          label="Last Count"
          value={
            daysSinceLastCount === null
              ? "Never"
              : daysSinceLastCount === 0
              ? "Today"
              : `${daysSinceLastCount}d ago`
          }
          accent={lastCountAccent}
          changeLabel={lastSessionName ?? "No counts yet"}
        />
      </div>

      {/* Action Center + Smart Order */}
      <div className="grid gap-5 lg:grid-cols-2">
        <ActionCenter
          criticalCount={stockStatus.red}
          pendingApprovals={pendingInvoices}
          daysSinceLastCount={daysSinceLastCount}
          recommendationsCount={recommendations.length}
          todayWasteCount={todayWasteCount}
          deliveryIssueCount={deliveryIssueCount}
          navigate={navigate}
        />
        <SmartOrderPreview
          topReorder={topReorder}
          redCount={stockStatus.red}
          yellowCount={stockStatus.yellow}
          reorderValue={reorderValue}
          navigate={navigate}
        />
      </div>

      {/* Today's Waste Snapshot */}
      {currentRestaurant && (
        <WasteSnapshot entries={todayWasteEntries} navigate={navigate} />
      )}

      {/* Spend Overview */}
      {currentRestaurant && (
        <SpendOverview
          restaurantId={currentRestaurant.id}
          locationId={currentLocation?.id}
          navigate={navigate}
        />
      )}

      {/* Usage & Trends */}
      <AnalyticsSection highUsage={highUsage} trendData={trendData} />

      {/* AI Insights */}
      <RecommendationsPanel recommendations={recommendations} />
    </div>
  );
}

// ─── Main Dashboard Page ───
export default function DashboardPage() {
  const { isPortfolioMode, setCurrentRestaurant } = useRestaurant();

  if (isPortfolioMode) {
    return <PortfolioDashboard setCurrentRestaurant={setCurrentRestaurant} />;
  }

  return <SingleDashboard />;
}
