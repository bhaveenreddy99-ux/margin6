import { useEffect, useState, useCallback } from "react";
import { useRestaurant } from "@/contexts/RestaurantContext";
import { useLocationPermissions } from "@/hooks/useLocationPermissions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { BarChart, Bar, LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from "recharts";
import {
  BarChart3, AlertTriangle, Package, TrendingUp, DollarSign,
  Building2, ArrowRight, CheckCircle2
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import { STOCK_TRUTH_MESSAGE } from "@/lib/stockTruthCopy";
import { loadInventoryMetrics } from "@/domain/dashboard/loadInventoryMetrics";

function fmt(v: number) { return v.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }); }

// ─── Single Restaurant Report ─────────────────────────────────────────────────
function SingleReport({
  restaurantId,
  locationId,
  canSeeFoodCostPct = true,
  canSeeInventoryValue = true,
}: {
  restaurantId: string;
  locationId?: string | null;
  canSeeFoodCostPct?: boolean;
  canSeeInventoryValue?: boolean;
}) {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState(false);
  const [kpis, setKpis] = useState({ value: 0, red: 0, yellow: 0, green: 0, sessions: 0 });
  const [trend, setTrend] = useState<{ week: string; value: number }[]>([]);
  const [topItems, setTopItems] = useState<{ item_name: string; total_value: number; current_stock: number; unit: string }[]>([]);
  const [parMetrics, setParMetrics] = useState<{ total: number; major: number; top5: string[] } | null>(null);
  const [lastApprovedAt, setLastApprovedAt] = useState<string | null>(null);

  const fetch = useCallback(async () => {
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

  useEffect(() => { fetch(); }, [fetch]);

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
      <Button variant="outline" size="sm" onClick={fetch}>Retry</Button>
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
        <p className="text-[11px] text-muted-foreground leading-snug px-0.5">
          {STOCK_TRUTH_MESSAGE}
        </p>
      )}
      {/* KPI cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-xl border border-primary/15 bg-card hover:shadow-md transition-all duration-200 p-5">
          <div className="flex items-start justify-between gap-2 mb-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/8">
              <DollarSign className="h-5 w-5 text-primary" />
            </div>
          </div>
          <p className="text-xs font-medium text-muted-foreground">Inventory Value</p>
          <p className="text-3xl font-bold tracking-tight tabular-nums mt-1">{canSeeInventoryValue ? fmt(kpis.value) : "—"}</p>
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

      {/* PAR Suggestions Summary */}
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
                  <p className="text-[11px] text-muted-foreground mt-0.5">
                    Top items: {parMetrics.top5.join(", ")}
                  </p>
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
        {/* Trend chart: hidden unless viewer may see food-cost context and inventory dollars (axes/tooltip). */}
        {trend.length > 1 && (
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><TrendingUp className="h-4 w-4 text-primary" />Inventory Value Trend</CardTitle></CardHeader>
            <CardContent>
              {canSeeFoodCostPct && canSeeInventoryValue ? (
                <ResponsiveContainer width="100%" height={180}>
                  <LineChart data={trend}>
                    <XAxis dataKey="week" tick={{ fontSize: 10 }} tickLine={false} axisLine={false} />
                    <YAxis tick={{ fontSize: 10 }} tickLine={false} axisLine={false} tickFormatter={v => `$${(v / 1000).toFixed(0)}k`} />
                    <Tooltip formatter={(v: number) => [fmt(v), "Value"]} labelStyle={{ fontSize: 11 }} contentStyle={{ fontSize: 11, borderRadius: 8 }} />
                    <Line type="monotone" dataKey="value" stroke="hsl(var(--primary))" strokeWidth={2} dot={{ r: 3, fill: "hsl(var(--primary))" }} />
                  </LineChart>
                </ResponsiveContainer>
              ) : (
                <p className="text-sm text-muted-foreground py-10 text-center">Food cost trend hidden</p>
              )}
            </CardContent>
          </Card>
        )}

        {/* Top items by value */}
        {topItems.length > 0 && (
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><DollarSign className="h-4 w-4 text-primary" />Top Items by Value</CardTitle></CardHeader>
            <CardContent>
              <div className="space-y-2">
                {topItems.map((item, i) => (
                  <div key={i} className="flex items-center justify-between text-sm py-1">
                    <span className="text-muted-foreground truncate flex-1 mr-2">{item.item_name}</span>
                    <span className="font-mono font-semibold text-xs">{canSeeInventoryValue ? fmt(item.total_value) : "—"}</span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}

// ─── Main Reports Page ────────────────────────────────────────────────────────
export default function ReportsPage() {
  const { currentRestaurant, currentLocation } = useRestaurant();
  const {
    can_see_food_cost_pct: canSeeFoodCostPct,
    can_see_inventory_value: canSeeInventoryValue,
  } = useLocationPermissions();

  return (
    <div className="space-y-5 animate-fade-in">
      <div className="page-header">
        <div>
          <h1 className="page-title">Reports</h1>
          <p className="page-description">{currentRestaurant?.name || "Select a restaurant"}</p>
        </div>
      </div>

      {currentRestaurant && (
        <SingleReport
          restaurantId={currentRestaurant.id}
          locationId={currentLocation?.id}
          canSeeFoodCostPct={canSeeFoodCostPct}
          canSeeInventoryValue={canSeeInventoryValue}
        />
      )}
      {!currentRestaurant && (
        <Card><CardContent className="empty-state py-16">
          <Building2 className="empty-state-icon" />
          <p className="empty-state-title">Select a restaurant</p>
          <p className="empty-state-description">Use the restaurant switcher in the top bar.</p>
        </CardContent></Card>
      )}
    </div>
  );
}
