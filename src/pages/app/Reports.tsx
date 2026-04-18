import { useEffect, useState, useCallback } from "react";
import { format } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import { useRestaurant } from "@/contexts/RestaurantContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { BarChart, Bar, LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from "recharts";
import {
  BarChart3, AlertTriangle, Package, TrendingUp, DollarSign,
  Building2, ArrowRight, Trophy, ThumbsDown, CheckCircle2
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import { getRisk } from "@/lib/inventory-utils";
import { riskThresholdsFromSettings } from "@/domain/inventory/riskThresholds";
import { STOCK_TRUTH_MESSAGE } from "@/lib/stockTruthCopy";
import { computePARRecommendations } from "@/lib/usage-analytics";

type ReportScope = "single" | "all" | "compare";

function fmt(v: number) { return v.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }); }

// ─── PAR suggestion metric (lightweight, on-demand) ──────────────────────────
async function computePARSuggestionCount(restaurantId: string) {
  const recommendations = await computePARRecommendations(restaurantId);
  return {
    total: recommendations.length,
    major: recommendations.filter(r => Math.abs(r.change_pct) >= 20).length,
    top5: recommendations.slice(0, 5).map(r => r.item_name),
  };
}

// ─── Single Restaurant Report ─────────────────────────────────────────────────
function SingleReport({ restaurantId }: { restaurantId: string }) {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [kpis, setKpis] = useState({ value: 0, red: 0, yellow: 0, green: 0, sessions: 0 });
  const [trend, setTrend] = useState<{ week: string; value: number }[]>([]);
  const [topItems, setTopItems] = useState<{ item_name: string; total_value: number; current_stock: number; unit: string }[]>([]);
  const [parMetrics, setParMetrics] = useState<{ total: number; major: number; top5: string[] } | null>(null);
  const [lastApprovedAt, setLastApprovedAt] = useState<string | null>(null);

  const fetch = useCallback(async () => {
    setLoading(true);
    // Compute PAR suggestion metrics in parallel
    computePARSuggestionCount(restaurantId).then(m => setParMetrics(m));

    const { data: riskSettingsRow } = await supabase
      .from("smart_order_settings")
      .select("red_threshold, yellow_threshold")
      .eq("restaurant_id", restaurantId)
      .maybeSingle();
    const riskTh = riskThresholdsFromSettings(riskSettingsRow);

    // Latest approved session
    const { data: sessions } = await supabase
      .from("inventory_sessions")
      .select("id, approved_at")
      .eq("restaurant_id", restaurantId)
      .eq("status", "APPROVED")
      .order("approved_at", { ascending: false })
      .limit(1);

    if (sessions && sessions.length > 0) {
      setLastApprovedAt(sessions[0].approved_at ?? null);
      const { data: items } = await supabase
        .from("inventory_session_items")
        .select("*")
        .eq("session_id", sessions[0].id);

      if (items) {
        let red = 0, yellow = 0, green = 0, value = 0;
        items.forEach(i => {
          const risk = getRisk(Number(i.current_stock), i.par_level, riskTh).level;
          if (risk === "RED") red++;
          else if (risk === "YELLOW") yellow++;
          else if (risk === "GREEN") green++;
          if (i.unit_cost) value += Number(i.current_stock) * Number(i.unit_cost);
        });
        setKpis({ value, red, yellow, green, sessions: 1 });
        setTopItems(
          items
            .filter(i => i.unit_cost)
            .map(i => ({
              item_name: i.item_name,
              total_value: Number(i.current_stock) * Number(i.unit_cost!),
              current_stock: Number(i.current_stock),
              unit: i.unit || "",
            }))
            .sort((a, b) => b.total_value - a.total_value)
            .slice(0, 8)
        );
      }
    } else {
      setKpis({ value: 0, red: 0, yellow: 0, green: 0, sessions: 0 });
      setLastApprovedAt(null);
    }

    // Trend: last 8 approved sessions
    const { data: trendSessions } = await supabase
      .from("inventory_sessions")
      .select("id, approved_at")
      .eq("restaurant_id", restaurantId)
      .eq("status", "APPROVED")
      .order("approved_at", { ascending: false })
      .limit(8);

    if (trendSessions && trendSessions.length > 0) {
      const results: { week: string; value: number }[] = [];
      for (const s of trendSessions.reverse()) {
        const { data: sItems } = await supabase
          .from("inventory_session_items")
          .select("current_stock, unit_cost")
          .eq("session_id", s.id);
        const val = (sItems || []).reduce((sum, i) => {
          if (i.unit_cost) return sum + Number(i.current_stock) * Number(i.unit_cost);
          return sum;
        }, 0);
        results.push({
          week: new Date(s.approved_at!).toLocaleDateString("en-US", { month: "short", day: "numeric" }),
          value: val,
        });
      }
      setTrend(results);
    }

    setLoading(false);
  }, [restaurantId]);

  useEffect(() => { fetch(); }, [fetch]);

  if (loading) return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-4">{[1, 2, 3, 4].map(i => <Skeleton key={i} className="h-24 rounded-xl" />)}</div>
      <Skeleton className="h-56 rounded-xl" />
    </div>
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
      <div className="grid gap-3 sm:grid-cols-4">
        <Card className="border-primary/15">
          <CardContent className="flex items-center gap-3 p-5">
            <div className="h-10 w-10 rounded-xl bg-primary/8 flex items-center justify-center"><DollarSign className="h-5 w-5 text-primary" /></div>
            <div><p className="text-lg font-bold leading-tight">{fmt(kpis.value)}</p><p className="text-[11px] text-muted-foreground">Inventory Value</p></div>
          </CardContent>
        </Card>
        <Card className="border-destructive/15">
          <CardContent className="flex items-center gap-3 p-5">
            <div className="h-10 w-10 rounded-xl bg-destructive/8 flex items-center justify-center"><AlertTriangle className="h-5 w-5 text-destructive" /></div>
            <div><p className="text-lg font-bold leading-tight text-destructive">{kpis.red}</p><p className="text-[11px] text-muted-foreground">Critical Items</p></div>
          </CardContent>
        </Card>
        <Card className="border-warning/15">
          <CardContent className="flex items-center gap-3 p-5">
            <div className="h-10 w-10 rounded-xl bg-warning/8 flex items-center justify-center"><Package className="h-5 w-5 text-warning" /></div>
            <div><p className="text-lg font-bold leading-tight text-warning">{kpis.yellow}</p><p className="text-[11px] text-muted-foreground">Low Stock</p></div>
          </CardContent>
        </Card>
        <Card className="border-success/15">
          <CardContent className="flex items-center gap-3 p-5">
            <div className="h-10 w-10 rounded-xl bg-success/8 flex items-center justify-center"><CheckCircle2 className="h-5 w-5 text-success" /></div>
            <div><p className="text-lg font-bold leading-tight text-success">{kpis.green}</p><p className="text-[11px] text-muted-foreground">Stocked OK</p></div>
          </CardContent>
        </Card>
      </div>

      {/* PAR Suggestions Summary */}
      {parMetrics && parMetrics.total > 0 && (
        <Card className="border-primary/20 bg-primary/3">
          <CardContent className="flex items-center justify-between p-4 gap-4 flex-wrap">
            <div className="flex items-center gap-3">
              <div className="h-9 w-9 rounded-xl bg-primary/10 flex items-center justify-center">
                <TrendingUp className="h-4.5 w-4.5 text-primary" />
              </div>
              <div>
                <p className="text-sm font-semibold">
                  {parMetrics.total} PAR change{parMetrics.total !== 1 ? "s" : ""} suggested from recent approved counts
                  {parMetrics.major > 0 && (
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

      <div className="grid gap-5 lg:grid-cols-2">
        {/* Trend chart */}
        {trend.length > 1 && (
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><TrendingUp className="h-4 w-4 text-primary" />Inventory Value Trend</CardTitle></CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={180}>
                <LineChart data={trend}>
                  <XAxis dataKey="week" tick={{ fontSize: 10 }} tickLine={false} axisLine={false} />
                  <YAxis tick={{ fontSize: 10 }} tickLine={false} axisLine={false} tickFormatter={v => `$${(v / 1000).toFixed(0)}k`} />
                  <Tooltip formatter={(v: number) => [fmt(v), "Value"]} labelStyle={{ fontSize: 11 }} contentStyle={{ fontSize: 11, borderRadius: 8 }} />
                  <Line type="monotone" dataKey="value" stroke="hsl(var(--primary))" strokeWidth={2} dot={{ r: 3, fill: "hsl(var(--primary))" }} />
                </LineChart>
              </ResponsiveContainer>
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
                    <span className="font-mono font-semibold text-xs">{fmt(item.total_value)}</span>
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

// ─── Restaurant data loader for multi-restaurant reports ─────────────────────
async function loadRestaurantMetrics(rid: string, rname: string, rrole: string) {
  const { data: riskSettingsRow } = await supabase
    .from("smart_order_settings")
    .select("red_threshold, yellow_threshold")
    .eq("restaurant_id", rid)
    .maybeSingle();
  const riskTh = riskThresholdsFromSettings(riskSettingsRow);

  // Latest approved session
  const { data: sessions } = await supabase
    .from("inventory_sessions")
    .select("id, approved_at")
    .eq("restaurant_id", rid)
    .eq("status", "APPROVED")
    .order("approved_at", { ascending: false })
    .limit(2);

  let value = 0, prevValue = 0, red = 0, yellow = 0, green = 0, lastDate: string | null = null;

  if (sessions && sessions.length > 0) {
    lastDate = sessions[0].approved_at;

    const { data: items } = await supabase
      .from("inventory_session_items")
      .select("current_stock, par_level, unit_cost")
      .eq("session_id", sessions[0].id);

    (items || []).forEach(i => {
      const risk = getRisk(Number(i.current_stock), i.par_level, riskTh).level;
      if (risk === "RED") red++;
      else if (risk === "YELLOW") yellow++;
      else if (risk === "GREEN") green++;
      if (i.unit_cost) value += Number(i.current_stock) * Number(i.unit_cost);
    });

    // Previous session for % change
    if (sessions.length > 1) {
      const { data: prevItems } = await supabase
        .from("inventory_session_items")
        .select("current_stock, unit_cost")
        .eq("session_id", sessions[1].id);
      (prevItems || []).forEach(i => {
        if (i.unit_cost) prevValue += Number(i.current_stock) * Number(i.unit_cost);
      });
    }
  }

  const pctChange = prevValue > 0 ? ((value - prevValue) / prevValue) * 100 : 0;

  return { id: rid, name: rname, role: rrole, value, prevValue, pctChange, red, yellow, green, lastDate };
}

// ─── All Restaurants Report ───────────────────────────────────────────────────
function AllRestaurantsReport({ restaurants }: { restaurants: { id: string; name: string; role: string }[] }) {
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<any[]>([]);
  const navigate = useNavigate();
  const { setCurrentRestaurant } = useRestaurant();

  useEffect(() => {
    const fetch = async () => {
      setLoading(true);
      const results = await Promise.all(restaurants.map(r => loadRestaurantMetrics(r.id, r.name, r.role)));
      setRows(results.sort((a, b) => b.value - a.value));
      setLoading(false);
    };
    fetch();
  }, [restaurants]);

  if (loading) return (
    <div className="space-y-3">{[1, 2, 3].map(i => <Skeleton key={i} className="h-12 rounded-xl" />)}</div>
  );

  const totVal = rows.reduce((s, r) => s + r.value, 0);
  const totRed = rows.reduce((s, r) => s + r.red, 0);
  const totYellow = rows.reduce((s, r) => s + r.yellow, 0);

  const bestRow = rows.length > 0 ? rows.reduce((best, r) => r.red < best.red || (r.red === best.red && r.value > best.value) ? r : best, rows[0]) : null;
  const worstRow = rows.length > 1 ? rows.find(r => r.id !== bestRow?.id && (r.red > 0 || r.yellow > 0)) || rows[rows.length - 1] : null;

  return (
    <div className="space-y-5">
      {/* Summary bar */}
      <div className="grid gap-3 sm:grid-cols-3">
        <Card className="border-primary/15">
          <CardContent className="flex items-center gap-3 p-4">
            <DollarSign className="h-5 w-5 text-primary" />
            <div><p className="text-base font-bold">{fmt(totVal)}</p><p className="text-[11px] text-muted-foreground">Total Portfolio Value</p></div>
          </CardContent>
        </Card>
        <Card className="border-destructive/15">
          <CardContent className="flex items-center gap-3 p-4">
            <AlertTriangle className="h-5 w-5 text-destructive" />
            <div><p className="text-base font-bold text-destructive">{totRed}</p><p className="text-[11px] text-muted-foreground">Total Critical Items</p></div>
          </CardContent>
        </Card>
        <Card className="border-warning/15">
          <CardContent className="flex items-center gap-3 p-4">
            <Package className="h-5 w-5 text-warning" />
            <div><p className="text-base font-bold text-warning">{totYellow}</p><p className="text-[11px] text-muted-foreground">Total Low Stock</p></div>
          </CardContent>
        </Card>
      </div>

      {/* Ranked table */}
      <Card className="overflow-hidden">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2"><Building2 className="h-4 w-4 text-primary" />All Restaurants</CardTitle>
        </CardHeader>
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/30">
              <TableHead className="text-xs font-semibold w-6">#</TableHead>
              <TableHead className="text-xs font-semibold">Restaurant</TableHead>
              <TableHead className="text-xs font-semibold text-right">Inv. Value</TableHead>
              <TableHead className="text-xs font-semibold text-center">vs Previous</TableHead>
              <TableHead className="text-xs font-semibold text-center">Critical</TableHead>
              <TableHead className="text-xs font-semibold text-center">Low Stock</TableHead>
              <TableHead className="text-xs font-semibold">Last Count</TableHead>
              <TableHead className="text-xs font-semibold w-10"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r, i) => {
              const isBest = r.id === bestRow?.id;
              const isWorst = r.id === worstRow?.id;
              return (
                <TableRow
                  key={r.id}
                  className="hover:bg-muted/30 cursor-pointer transition-colors"
                  onClick={() => { setCurrentRestaurant({ id: r.id, name: r.name, role: r.role }); navigate("/app/reports"); }}
                >
                  <TableCell className="text-xs text-muted-foreground font-mono">{i + 1}</TableCell>
                  <TableCell className="font-medium text-sm">
                    <div className="flex items-center gap-2">
                      {r.name}
                      {isBest && <Badge className="text-[9px] bg-success/15 text-success border-success/30 border">Best</Badge>}
                      {isWorst && <Badge className="text-[9px] bg-destructive/10 text-destructive border-destructive/20 border">Needs Attention</Badge>}
                    </div>
                  </TableCell>
                  <TableCell className="text-right font-mono text-sm font-semibold">{r.value > 0 ? fmt(r.value) : "—"}</TableCell>
                  <TableCell className="text-center">
                    {r.prevValue > 0 ? (
                      <span className={`text-xs font-medium ${r.pctChange >= 0 ? "text-success" : "text-destructive"}`}>
                        {r.pctChange >= 0 ? "+" : ""}{r.pctChange.toFixed(1)}%
                      </span>
                    ) : <span className="text-xs text-muted-foreground">—</span>}
                  </TableCell>
                  <TableCell className="text-center">
                    {r.red > 0 ? <Badge variant="destructive" className="text-[10px]">{r.red}</Badge> : <span className="text-xs text-muted-foreground">0</span>}
                  </TableCell>
                  <TableCell className="text-center">
                    {r.yellow > 0 ? <Badge className="bg-warning text-warning-foreground text-[10px]">{r.yellow}</Badge> : <span className="text-xs text-muted-foreground">0</span>}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {r.lastDate ? new Date(r.lastDate).toLocaleDateString() : "—"}
                  </TableCell>
                  <TableCell>
                    <ArrowRight className="h-3.5 w-3.5 text-muted-foreground" />
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </Card>

      {/* Bar chart */}
      {rows.filter(r => r.value > 0).length > 1 && (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Inventory Value by Restaurant</CardTitle></CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={rows.filter(r => r.value > 0)} margin={{ left: 0, right: 8 }}>
                <XAxis dataKey="name" tick={{ fontSize: 10 }} tickLine={false} axisLine={false} />
                <YAxis tick={{ fontSize: 10 }} tickLine={false} axisLine={false} tickFormatter={v => `$${(v / 1000).toFixed(0)}k`} />
                <Tooltip formatter={(v: number) => [fmt(v), "Value"]} contentStyle={{ fontSize: 11, borderRadius: 8 }} />
                <Bar dataKey="value" radius={[4, 4, 0, 0]}>
                  {rows.filter(r => r.value > 0).map((r, i) => (
                    <Cell key={i} fill={r.id === bestRow?.id ? "hsl(var(--success))" : r.id === worstRow?.id ? "hsl(var(--destructive))" : "hsl(var(--primary))"} fillOpacity={0.8} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ─── Compare Report ───────────────────────────────────────────────────────────
function CompareReport({ restaurants }: { restaurants: { id: string; name: string; role: string }[] }) {
  const [selected, setSelected] = useState<string[]>(restaurants.slice(0, Math.min(3, restaurants.length)).map(r => r.id));
  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState<any[]>([]);

  const toggle = (id: string) => {
    setSelected(prev =>
      prev.includes(id)
        ? prev.filter(x => x !== id)
        : prev.length < 10 ? [...prev, id] : prev
    );
  };

  useEffect(() => {
    if (selected.length === 0) { setRows([]); return; }
    const fetch = async () => {
      setLoading(true);
      const chosen = restaurants.filter(r => selected.includes(r.id));
      const results = await Promise.all(chosen.map(r => loadRestaurantMetrics(r.id, r.name, r.role)));
      setRows(results.sort((a, b) => a.red - b.red || b.value - a.value));
      setLoading(false);
    };
    fetch();
  }, [selected, restaurants]);

  const bestRow = rows.length > 0 ? rows[0] : null;
  const worstRow = rows.length > 1 ? rows[rows.length - 1] : null;

  return (
    <div className="space-y-5">
      {/* Restaurant selector chips */}
      <div className="space-y-2">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Select restaurants to compare (max 10)</p>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setSelected(restaurants.map(r => r.id).slice(0, 10))}>Select All</Button>
          <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setSelected([])}>Clear</Button>
          {restaurants.map(r => (
            <button
              key={r.id}
              onClick={() => toggle(r.id)}
              className={`h-7 px-3 rounded-full text-xs font-medium border transition-all ${
                selected.includes(r.id)
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-background text-muted-foreground border-border hover:border-primary/50"
              }`}
            >
              {r.name}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="space-y-3">{[1, 2, 3].map(i => <Skeleton key={i} className="h-12 rounded-xl" />)}</div>
      ) : rows.length === 0 ? (
        <Card><CardContent className="empty-state py-12"><Building2 className="empty-state-icon" /><p className="empty-state-title">Select restaurants to compare</p></CardContent></Card>
      ) : (
        <div className="space-y-5">
          {/* Badges */}
          {(bestRow || worstRow) && (
            <div className="flex gap-3 flex-wrap">
              {bestRow && (
                <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-success/10 border border-success/20">
                  <Trophy className="h-4 w-4 text-success" />
                  <span className="text-xs font-semibold text-success">Best: {bestRow.name}</span>
                  <span className="text-[11px] text-muted-foreground">— {bestRow.red} critical</span>
                </div>
              )}
              {worstRow && worstRow.id !== bestRow?.id && (
                <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-destructive/10 border border-destructive/20">
                  <ThumbsDown className="h-4 w-4 text-destructive" />
                  <span className="text-xs font-semibold text-destructive">Needs Attention: {worstRow.name}</span>
                  <span className="text-[11px] text-muted-foreground">— {worstRow.red} critical</span>
                </div>
              )}
            </div>
          )}

          {/* Comparison table */}
          <Card className="overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/30">
                  <TableHead className="text-xs font-semibold">Restaurant</TableHead>
                  <TableHead className="text-xs font-semibold text-right">Inv. Value</TableHead>
                  <TableHead className="text-xs font-semibold text-center">vs Prev</TableHead>
                  <TableHead className="text-xs font-semibold text-center">Critical</TableHead>
                  <TableHead className="text-xs font-semibold text-center">Low Stock</TableHead>
                  <TableHead className="text-xs font-semibold text-center">OK</TableHead>
                  <TableHead className="text-xs font-semibold">Last Count</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map(r => {
                  const isBest = r.id === bestRow?.id;
                  const isWorst = r.id === worstRow?.id && worstRow.id !== bestRow?.id;
                  return (
                    <TableRow key={r.id} className={isBest ? "bg-success/5" : isWorst ? "bg-destructive/5" : ""}>
                      <TableCell className="font-medium text-sm">
                        <div className="flex items-center gap-2">
                          {isBest && <Trophy className="h-3.5 w-3.5 text-success" />}
                          {isWorst && <ThumbsDown className="h-3.5 w-3.5 text-destructive" />}
                          {r.name}
                        </div>
                      </TableCell>
                      <TableCell className="text-right font-mono text-sm font-semibold">{r.value > 0 ? fmt(r.value) : "—"}</TableCell>
                      <TableCell className="text-center">
                        {r.prevValue > 0 ? (
                          <span className={`text-xs font-medium ${r.pctChange >= 0 ? "text-success" : "text-destructive"}`}>
                            {r.pctChange >= 0 ? "+" : ""}{r.pctChange.toFixed(1)}%
                          </span>
                        ) : <span className="text-xs text-muted-foreground">—</span>}
                      </TableCell>
                      <TableCell className="text-center">
                        {r.red > 0 ? <Badge variant="destructive" className="text-[10px]">{r.red}</Badge> : <span className="text-xs text-muted-foreground">0</span>}
                      </TableCell>
                      <TableCell className="text-center">
                        {r.yellow > 0 ? <Badge className="bg-warning text-warning-foreground text-[10px]">{r.yellow}</Badge> : <span className="text-xs text-muted-foreground">0</span>}
                      </TableCell>
                      <TableCell className="text-center">
                        <span className="text-xs text-success font-medium">{r.green}</span>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {r.lastDate ? new Date(r.lastDate).toLocaleDateString() : "—"}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </Card>

          {/* Side-by-side bar chart */}
          {rows.filter(r => r.value > 0).length > 0 && (
            <div className="grid gap-5 md:grid-cols-2">
              <Card>
                <CardHeader className="pb-2"><CardTitle className="text-sm">Inventory Value</CardTitle></CardHeader>
                <CardContent>
                  <ResponsiveContainer width="100%" height={160}>
                    <BarChart data={rows} margin={{ left: 0, right: 8 }}>
                      <XAxis dataKey="name" tick={{ fontSize: 9 }} tickLine={false} axisLine={false} />
                      <YAxis tick={{ fontSize: 9 }} tickLine={false} axisLine={false} tickFormatter={v => `$${(v / 1000).toFixed(0)}k`} />
                      <Tooltip formatter={(v: number) => [fmt(v), "Value"]} contentStyle={{ fontSize: 11, borderRadius: 8 }} />
                      <Bar dataKey="value" radius={[4, 4, 0, 0]}>
                        {rows.map((r, i) => (
                          <Cell key={i} fill={r.id === bestRow?.id ? "hsl(var(--success))" : r.id === worstRow?.id ? "hsl(var(--destructive))" : "hsl(var(--primary))"} fillOpacity={0.8} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2"><CardTitle className="text-sm">Critical Items</CardTitle></CardHeader>
                <CardContent>
                  <ResponsiveContainer width="100%" height={160}>
                    <BarChart data={rows} margin={{ left: 0, right: 8 }}>
                      <XAxis dataKey="name" tick={{ fontSize: 9 }} tickLine={false} axisLine={false} />
                      <YAxis tick={{ fontSize: 9 }} tickLine={false} axisLine={false} allowDecimals={false} />
                      <Tooltip contentStyle={{ fontSize: 11, borderRadius: 8 }} />
                      <Bar dataKey="red" fill="hsl(var(--destructive))" fillOpacity={0.8} radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Main Reports Page ────────────────────────────────────────────────────────
export default function ReportsPage() {
  const { currentRestaurant, restaurants, isPortfolioMode } = useRestaurant();
  const [scope, setScope] = useState<ReportScope>("single");

  // Determine if user can access multi-restaurant views
  // OWNER/MANAGER can if they belong to multiple restaurants
  const canMulti = restaurants.length > 1 &&
    restaurants.some(r => r.role === "OWNER" || r.role === "MANAGER");

  // Reset scope when restaurant changes
  useEffect(() => {
    if (!canMulti) setScope("single");
  }, [canMulti]);

  return (
    <div className="space-y-5 animate-fade-in">
      <div className="page-header">
        <div>
          <h1 className="page-title">Reports</h1>
          <p className="page-description">
            {scope === "single" ? (currentRestaurant?.name || "Select a restaurant") : scope === "all" ? "All Restaurants" : "Compare Restaurants"}
          </p>
        </div>

        {/* Scope toggle — only shown in Reports, only for multi-restaurant managers/owners */}
        {canMulti && (
          <div className="flex items-center gap-1 p-1 rounded-lg bg-muted/60 border border-border/50">
            {(["single", "all", "compare"] as ReportScope[]).map(s => (
              <button
                key={s}
                onClick={() => setScope(s)}
                className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                  scope === s
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {s === "single" ? "Single" : s === "all" ? "All Restaurants" : "Compare"}
              </button>
            ))}
          </div>
        )}
      </div>

      {scope === "single" && currentRestaurant && <SingleReport restaurantId={currentRestaurant.id} />}
      {scope === "single" && !currentRestaurant && (
        <Card><CardContent className="empty-state py-16">
          <Building2 className="empty-state-icon" />
          <p className="empty-state-title">Select a restaurant</p>
          <p className="empty-state-description">Use the restaurant switcher in the top bar.</p>
        </CardContent></Card>
      )}
      {scope === "all" && canMulti && <AllRestaurantsReport restaurants={restaurants} />}
      {scope === "compare" && canMulti && <CompareReport restaurants={restaurants} />}
    </div>
  );
}
