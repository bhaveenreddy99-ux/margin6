import { useEffect, useMemo, useState } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { useRestaurant } from "@/contexts/RestaurantContext";
import { useLocationPermissions } from "@/hooks/useLocationPermissions";
import {
  useAllLocationsSummary,
  getFoodCostStatus,
  type DashboardMode,
  type LocationSummary,
} from "@/hooks/useAllLocationsSummary";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { MapPin, ArrowRight, AlertTriangle, UtensilsCrossed } from "lucide-react";
import { differenceInDays, formatDistanceToNow } from "date-fns";

function fmtCurrency(n: number) {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

function EstMark() {
  return <span className="text-[10px] text-muted-foreground align-super ml-0.5">Est.</span>;
}

function statusBorderClass(s: LocationSummary["food_cost_status"]) {
  switch (s) {
    case "good":
      return "border-green-200 bg-green-50/50 dark:border-green-900/40 dark:bg-green-950/20";
    case "warning":
      return "border-amber-200 bg-amber-50/50 dark:border-amber-900/40 dark:bg-amber-950/20";
    default:
      return "border-red-200 bg-red-50/50 dark:border-red-900/40 dark:bg-red-950/20";
  }
}

function statusTextClass(s: LocationSummary["food_cost_status"]) {
  switch (s) {
    case "good":
      return "text-green-600 dark:text-green-400";
    case "warning":
      return "text-amber-600 dark:text-amber-400";
    default:
      return "text-red-600 dark:text-red-400";
  }
}

function statusBadgeLabel(s: LocationSummary["food_cost_status"]) {
  switch (s) {
    case "good":
      return "GOOD";
    case "warning":
      return "WARN";
    default:
      return "CRITICAL";
  }
}

export default function AllLocationsDashboard() {
  const navigate = useNavigate();
  const {
    currentRestaurant,
    setCurrentRestaurant,
    setCurrentLocation,
    restaurants,
    activeRestaurantIds,
  } = useRestaurant();
  const perms = useLocationPermissions();

  const [mode, setMode] = useState<DashboardMode>("restaurant");

  const showAllBrandsToggle = activeRestaurantIds.length > 1;

  useEffect(() => {
    if (mode === "restaurant" && !currentRestaurant?.id && activeRestaurantIds.length > 0) {
      setMode("all_brands");
    }
  }, [mode, currentRestaurant?.id, activeRestaurantIds.length]);

  const summary = useAllLocationsSummary(mode);

  const sortedForRank = useMemo(() => {
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

  const gridLocations = useMemo(() => summary.locations.slice(0, 15), [summary.locations]);

  const countedInWindow = summary.locations.filter((l) => !l.count_overdue && l.last_count_date).length;
  const overdueCount = summary.locations.filter((l) => l.count_overdue).length;
  const totalLocs = summary.total_locations;

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

  const openLocation = (row: LocationSummary) => {
    const r = restaurants.find((x) => x.id === row.restaurant_id);
    if (r) setCurrentRestaurant({ id: r.id, name: r.name, role: r.role });
    setCurrentLocation({
      id: row.location_id,
      name: row.location_name,
      restaurant_id: row.restaurant_id,
      is_default: false,
      is_active: true,
    });
    navigate("/app/dashboard");
  };

  if (currentRestaurant?.role !== "OWNER") {
    return <Navigate to="/app/dashboard" replace />;
  }

  if (summary.loading) {
    return (
      <div className="space-y-6 animate-fade-in">
        <Skeleton className="h-10 w-full max-w-md rounded-lg" />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-28 rounded-xl" />
          ))}
        </div>
        <div className="grid gap-4 grid-cols-1 md:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-64 rounded-xl" />
          ))}
        </div>
      </div>
    );
  }

  if (summary.error) {
    return (
      <div className="flex flex-col items-center justify-center gap-4 py-24 text-center">
        <AlertTriangle className="h-10 w-10 text-destructive/40" />
        <p className="text-sm font-semibold">Could not load location data. Try refreshing.</p>
        <Button variant="outline" size="sm" onClick={() => summary.refetch()}>
          Retry
        </Button>
      </div>
    );
  }

  if (summary.locations.length === 0) {
    return (
      <Card>
        <CardContent className="empty-state py-16">
          <MapPin className="empty-state-icon" />
          <p className="empty-state-title">No locations found</p>
          <p className="empty-state-description">Add locations in Settings to get started.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-bold tracking-tight font-display">All locations</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {mode === "restaurant" ? currentRestaurant?.name : "All brands"} · {summary.total_locations} location
            {summary.total_locations !== 1 ? "s" : ""}
          </p>
        </div>
        {showAllBrandsToggle ? (
          <div className="flex items-center gap-1 p-1 rounded-lg bg-muted/60 border border-border/50 w-fit">
            <button
              type="button"
              onClick={() => setMode("restaurant")}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                mode === "restaurant" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              Within Restaurant
            </button>
            <button
              type="button"
              onClick={() => setMode("all_brands")}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                mode === "all_brands" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              All Brands
            </button>
          </div>
        ) : null}
      </div>

      {/* Summary bar */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card className={`${statusBorderClass(summaryAvgStatus)} border-2`}>
          <CardContent className="p-5">
            <p className="text-xs font-medium text-muted-foreground">Avg food cost %</p>
            <p className={`text-2xl font-bold tabular-nums mt-1 ${statusTextClass(summaryAvgStatus)}`}>
              {summary.avg_food_cost_pct != null ? (
                <>
                  {`${summary.avg_food_cost_pct.toFixed(1)}%`}
                  <EstMark />
                </>
              ) : (
                "—"
              )}
            </p>
            <p className="text-xs text-muted-foreground mt-2">{summary.total_locations} locations tracked</p>
          </CardContent>
        </Card>
        {perms.can_see_inventory_value ? (
          <Card>
            <CardContent className="p-5">
              <p className="text-xs font-medium text-muted-foreground">Total inventory value</p>
              <p className="text-2xl font-bold tabular-nums mt-1">{fmtCurrency(summary.total_inventory_value)}</p>
              <p className="text-xs text-muted-foreground mt-2">Across {summary.total_locations} locations</p>
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardContent className="p-5">
              <p className="text-xs font-medium text-muted-foreground">Total inventory value</p>
              <p className="text-2xl font-bold tabular-nums mt-1 text-muted-foreground">—</p>
              <p className="text-xs text-muted-foreground mt-2">Hidden for your role</p>
            </CardContent>
          </Card>
        )}
        <Card
          className={
            overdueCount === 0
              ? "border-green-200 bg-green-50/40 dark:border-green-900/35"
              : overdueCount <= 2
                ? "border-amber-200 bg-amber-50/40 dark:border-amber-900/35"
                : "border-red-200 bg-red-50/40 dark:border-red-900/35"
          }
        >
          <CardContent className="p-5">
            <p className="text-xs font-medium text-muted-foreground">Count compliance</p>
            <p className="text-2xl font-bold tabular-nums mt-1">
              {countedInWindow} / {totalLocs}
            </p>
            <p className="text-xs text-muted-foreground mt-2">Within last 72 hours</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5">
            <p className="text-xs font-medium text-muted-foreground">Total waste this week</p>
            <p className="text-2xl font-bold tabular-nums mt-1">{fmtCurrency(summary.total_waste_this_week)}</p>
            <p className="text-xs text-muted-foreground mt-2">— vs last week</p>
            <p className="text-[11px] text-muted-foreground mt-1">
              {summary.total_pending_orders} pending smart order{summary.total_pending_orders !== 1 ? "s" : ""}
            </p>
          </CardContent>
        </Card>
      </div>
      <p className="text-[11px] text-muted-foreground mt-2 text-center">
        * Food cost % is estimated. Add sales data per location for accurate tracking.
      </p>

      <div className="grid gap-4 grid-cols-1 md:grid-cols-2 lg:grid-cols-3">
        {gridLocations.map((loc) => {
          const pct =
            loc.food_cost_pct != null && loc.food_cost_target_pct > 0
              ? Math.min(100, (loc.food_cost_pct / loc.food_cost_target_pct) * 100)
              : 0;
          const daysAgo = loc.last_count_date
            ? differenceInDays(new Date(), new Date(loc.last_count_date))
            : null;
          return (
            <Card key={loc.location_id} className={`border-2 transition-shadow hover:shadow-md ${statusBorderClass(loc.food_cost_status)}`}>
              <CardHeader className="pb-2 space-y-1">
                {mode === "all_brands" && (
                  <p className="text-[10px] text-muted-foreground font-medium uppercase tracking-wide">{loc.restaurant_name}</p>
                )}
                <div className="flex items-start justify-between gap-2">
                  <CardTitle className="text-sm font-semibold leading-tight">{loc.location_name}</CardTitle>
                  <Badge
                    variant="outline"
                    className={`text-[9px] shrink-0 ${
                      loc.food_cost_status === "good"
                        ? "border-green-300 text-green-700 bg-green-50"
                        : loc.food_cost_status === "warning"
                          ? "border-amber-300 text-amber-800 bg-amber-50"
                          : "border-red-300 text-red-700 bg-red-50"
                    }`}
                  >
                    {statusBadgeLabel(loc.food_cost_status)}
                  </Badge>
                </div>
                {loc.brand ? (
                  <Badge variant="secondary" className="text-[10px] w-fit">
                    {loc.brand}
                  </Badge>
                ) : null}
              </CardHeader>
              <CardContent className="space-y-3 pt-0">
                <div>
                  <div className="flex justify-between text-xs mb-1">
                    <span className="text-muted-foreground">Food cost %</span>
                    <span className={`font-mono font-semibold ${statusTextClass(loc.food_cost_status)}`}>
                      {loc.food_cost_pct != null ? (
                        <>
                          {`${loc.food_cost_pct.toFixed(1)}%`}
                          <EstMark />
                        </>
                      ) : (
                        "—"
                      )}
                      <span className="text-muted-foreground font-normal"> vs {loc.food_cost_target_pct}%</span>
                    </span>
                  </div>
                  <div className="h-2 rounded-full bg-muted/60 overflow-hidden">
                    <div
                      className={`h-full rounded-full ${
                        loc.food_cost_status === "good"
                          ? "bg-green-500/80"
                          : loc.food_cost_status === "warning"
                            ? "bg-amber-500/80"
                            : "bg-red-500/80"
                      }`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div className="rounded-md bg-muted/30 p-2">
                    <p className="text-[10px] text-muted-foreground">Inventory</p>
                    <p className="font-mono font-semibold">
                      {perms.can_see_inventory_value && loc.inventory_value != null
                        ? fmtCurrency(loc.inventory_value)
                        : "—"}
                    </p>
                  </div>
                  <div className="rounded-md bg-muted/30 p-2">
                    <p className="text-[10px] text-muted-foreground">Waste / wk</p>
                    <p className="font-mono font-semibold">{fmtCurrency(loc.waste_this_week ?? 0)}</p>
                  </div>
                </div>
                <div className="text-[11px] text-muted-foreground">
                  Last count:{" "}
                  {loc.last_count_date
                    ? `${daysAgo != null ? `${daysAgo}d ago` : formatDistanceToNow(new Date(loc.last_count_date), { addSuffix: true })}`
                    : "—"}
                </div>
                {loc.count_overdue ? (
                  <p className="text-[11px] font-medium text-red-600 dark:text-red-400">OVERDUE — exceeds {loc.count_overdue_hrs ?? 72}h</p>
                ) : null}
                <Button variant="outline" size="sm" className="w-full gap-1 text-xs" onClick={() => openLocation(loc)}>
                  Open location
                  <ArrowRight className="h-3 w-3" />
                </Button>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <UtensilsCrossed className="h-4 w-4 text-primary" />
            Food cost ranking
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/20">
                <TableHead className="text-xs w-10">#</TableHead>
                <TableHead className="text-xs">Location</TableHead>
                <TableHead className="text-xs">Brand</TableHead>
                <TableHead className="text-xs text-right">Est. food cost %</TableHead>
                <TableHead className="text-xs text-right">vs target</TableHead>
                <TableHead className="text-xs">Last count</TableHead>
                <TableHead className="text-xs">Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sortedForRank.map((loc, i) => {
                const vs =
                  loc.food_cost_pct != null ? (loc.food_cost_pct - loc.food_cost_target_pct).toFixed(1) + "%" : "—";
                return (
                  <TableRow key={loc.location_id}>
                    <TableCell className="text-xs text-muted-foreground">{i + 1}</TableCell>
                    <TableCell className="text-sm">
                      {mode === "all_brands" && (
                        <span className="block text-[10px] text-muted-foreground">{loc.restaurant_name}</span>
                      )}
                      <span className="font-medium">{loc.location_name}</span>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">{loc.brand ?? "—"}</TableCell>
                    <TableCell className={`text-sm text-right font-mono font-semibold ${statusTextClass(loc.food_cost_status)}`}>
                      {loc.food_cost_pct != null ? (
                        <>
                          {`${loc.food_cost_pct.toFixed(1)}%`}
                          <EstMark />
                        </>
                      ) : (
                        "—"
                      )}
                    </TableCell>
                    <TableCell className="text-xs text-right font-mono">{vs}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {loc.last_count_date ? new Date(loc.last_count_date).toLocaleDateString() : "—"}
                    </TableCell>
                    <TableCell className="text-xs">
                      <span className={statusTextClass(loc.food_cost_status)}>{statusBadgeLabel(loc.food_cost_status)}</span>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button variant="ghost" size="sm" className="text-xs" asChild>
          <Link to="/app/dashboard">← Back to dashboard</Link>
        </Button>
      </div>
    </div>
  );
}
