import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Building2,
  Plus,
  ArrowRight,
  CalendarDays,
  AlertTriangle,
  Package,
  ChevronDown,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useRestaurant } from "@/contexts/RestaurantContext";
import {
  getRestaurantPortfolioStatus,
  loadRestaurantPortfolioSummaries,
  portfolioStatusLabel,
  type RestaurantPortfolioSummary,
  type RestaurantPortfolioStatus,
} from "@/domain/dashboard/loadRestaurantPortfolioSummaries";
import { formatDistanceToNow } from "date-fns";
import { cn } from "@/lib/utils";

function statusBadgeClass(status: RestaurantPortfolioStatus): string {
  switch (status) {
    case "active":
      return "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30";
    case "overdue":
      return "bg-amber-500/15 text-amber-800 dark:text-amber-200 border-amber-500/30";
    case "no_count":
      return "bg-destructive/10 text-destructive border-destructive/30";
    case "setup_needed":
      return "bg-muted text-muted-foreground border-border/60";
  }
}

function formatMoneyLost(summary: RestaurantPortfolioSummary | undefined): {
  label: string;
  className: string;
} {
  if (!summary || summary.moneyLost == null) {
    return { label: "—", className: "text-muted-foreground" };
  }
  if (summary.moneyLost > 0) {
    return {
      label: `$${summary.moneyLost.toLocaleString(undefined, { maximumFractionDigits: 0 })}`,
      className: "text-destructive font-semibold",
    };
  }
  return {
    label: "$0",
    className: "text-emerald-600 dark:text-emerald-400 font-semibold",
  };
}

function formatInventoryValue(summary: RestaurantPortfolioSummary | undefined): string {
  if (!summary || summary.inventoryValue == null) return "—";
  return `$${summary.inventoryValue.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

export default function MyRestaurantsPage() {
  const { restaurants, setCurrentRestaurant, loading } = useRestaurant();
  const navigate = useNavigate();
  const [summaries, setSummaries] = useState<Record<string, RestaurantPortfolioSummary>>({});
  const [summariesLoading, setSummariesLoading] = useState(true);
  // Silent-$0 fix: distinguish a failed portfolio load from an empty portfolio,
  // so we don't render every restaurant as "—" when the query actually failed.
  const [summariesError, setSummariesError] = useState(false);
  const [refetchKey, setRefetchKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    if (restaurants.length === 0) {
      setSummaries({});
      setSummariesError(false);
      setSummariesLoading(false);
      return;
    }

    const load = async () => {
      setSummariesLoading(true);
      const outcome = await loadRestaurantPortfolioSummaries(restaurants.map((r) => r.id));
      if (cancelled) return;
      if (outcome.status === "error") {
        setSummariesError(true);
        setSummaries({});
      } else {
        setSummariesError(false);
        setSummaries(outcome.value);
      }
      setSummariesLoading(false);
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, [restaurants, refetchKey]);

  const openRestaurant = (id: string) => {
    const r = restaurants.find((x) => x.id === id);
    if (!r) return;
    setCurrentRestaurant(r);
    navigate("/app/dashboard");
  };

  const comparisonRows = useMemo(() => {
    return restaurants
      .map((r) => ({
        restaurant: r,
        summary: summaries[r.id],
        status: getRestaurantPortfolioStatus(summaries[r.id] ?? {
          lastCountAt: null,
          moneyLost: null,
          inventoryValue: null,
          hasConfirmedInvoices: false,
        }),
      }))
      .sort((a, b) => (b.summary?.moneyLost ?? -1) - (a.summary?.moneyLost ?? -1));
  }, [restaurants, summaries]);

  const highestLossId = comparisonRows[0]?.summary?.moneyLost
    ? comparisonRows[0].restaurant.id
    : null;

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-48 rounded-lg" />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-44 rounded-xl" />
          ))}
        </div>
      </div>
    );
  }

  if (restaurants.length === 0) {
    return (
      <div className="space-y-6 animate-fade-in max-w-lg mx-auto text-center py-12">
        <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10 mx-auto">
          <Building2 className="h-8 w-8 text-primary" />
        </div>
        <div>
          <h1 className="text-xl font-bold tracking-tight font-display">My Restaurants</h1>
          <p className="text-sm text-muted-foreground mt-2">
            You don&apos;t have any restaurants yet. Create one to start tracking food cost and inventory.
          </p>
        </div>
        <Button
          className="bg-gradient-amber text-white shadow-amber"
          onClick={() => navigate("/app/restaurants/new")}
        >
          <Plus className="h-4 w-4 mr-1.5" />
          Add New Restaurant
        </Button>
      </div>
    );
  }

  const renderRestaurantCard = (r: (typeof restaurants)[0]) => {
    const s = summaries[r.id];
    const money = formatMoneyLost(s);
    const lastCountLabel =
      s?.lastCountAt
        ? formatDistanceToNow(new Date(s.lastCountAt), { addSuffix: true })
        : "No counts yet";
    const inventoryLabel = formatInventoryValue(s);

    return (
      <Card
        key={r.id}
        className="hover:shadow-md transition-all duration-200 flex flex-col"
      >
        <CardContent className="p-5 flex flex-col flex-1 gap-4">
          <div className="flex items-start justify-between gap-2">
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 shrink-0">
                <Building2 className="h-5 w-5 text-primary" />
              </div>
              <h2 className="text-base font-bold tracking-tight truncate">{r.name}</h2>
            </div>
            <Badge variant="secondary" className="text-[10px] shrink-0">
              {r.role}
            </Badge>
          </div>

          <div className="space-y-2 text-sm flex-1">
            <div className="flex items-center gap-2 text-muted-foreground">
              <AlertTriangle className="h-3.5 w-3.5 opacity-60" />
              <span className="text-xs">Money lost this week</span>
              <span
                className={cn(
                  "ml-auto font-mono tabular-nums text-xs",
                  money.className,
                )}
              >
                {summariesLoading ? (
                  <Skeleton className="inline-block h-4 w-12" />
                ) : (
                  money.label
                )}
              </span>
            </div>
            <div className="flex items-center gap-2 text-muted-foreground">
              <Package className="h-3.5 w-3.5 opacity-60" />
              <span className="text-xs">Inventory</span>
              <span className="ml-auto text-xs font-medium text-foreground font-mono tabular-nums">
                {summariesLoading ? (
                  <Skeleton className="inline-block h-4 w-16" />
                ) : (
                  inventoryLabel
                )}
              </span>
            </div>
            <div className="flex items-center gap-2 text-muted-foreground">
              <CalendarDays className="h-3.5 w-3.5 opacity-60" />
              <span className="text-xs">Last inventory count</span>
              <span className="ml-auto text-xs font-medium text-foreground">
                {summariesLoading ? (
                  <Skeleton className="inline-block h-4 w-20" />
                ) : (
                  lastCountLabel
                )}
              </span>
            </div>
          </div>

          <Button
            className="w-full bg-gradient-amber text-white shadow-amber"
            onClick={() => openRestaurant(r.id)}
          >
            Open
            <ArrowRight className="h-3.5 w-3.5 ml-1" />
          </Button>
        </CardContent>
      </Card>
    );
  };

  const addRestaurantCard = (prominent = false) => (
    <button
      type="button"
      onClick={() => navigate("/app/restaurants/new")}
      className={cn(
        "rounded-xl border-2 border-dashed transition-all duration-200 p-5 flex flex-col items-center justify-center gap-3 min-h-[200px] group",
        prominent
          ? "border-primary/40 bg-primary/[0.04] hover:border-primary hover:bg-primary/[0.08]"
          : "border-border/60 hover:border-primary/50 hover:bg-primary/[0.03]",
      )}
    >
      <div
        className={cn(
          "flex h-12 w-12 items-center justify-center rounded-xl transition-colors",
          prominent
            ? "bg-primary/15 group-hover:bg-primary/25"
            : "bg-primary/10 group-hover:bg-primary/20",
        )}
      >
        <Plus className="h-6 w-6 text-primary" />
      </div>
      <div className="text-center">
        <p className="text-sm font-semibold">Add New Restaurant</p>
        <p className="text-xs text-muted-foreground mt-0.5">
          {prominent ? "Same login — completely separate data" : "Set up another location"}
        </p>
      </div>
    </button>
  );

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-xl font-bold tracking-tight font-display">My Restaurants</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          {restaurants.length} restaurant{restaurants.length !== 1 ? "s" : ""}
        </p>
      </div>

      {summariesError && (
        <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-4 flex items-center justify-between gap-3">
          <p className="text-sm text-amber-700 dark:text-amber-400">
            Couldn&apos;t load your restaurant numbers. They&apos;re not $0 — the query failed.
          </p>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setRefetchKey((k) => k + 1)}
          >
            Retry
          </Button>
        </div>
      )}

      {restaurants.length === 1 ? (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {renderRestaurantCard(restaurants[0])}
          </div>

          <div className="rounded-xl border border-border/60 bg-muted/20 p-5 space-y-4">
            <div>
              <h2 className="text-sm font-semibold">Ready to add another restaurant?</h2>
              <p className="text-sm text-muted-foreground mt-1">
                Each restaurant is completely separate — different menu, different vendors,
                different numbers. Same login.
              </p>
            </div>
            <div className="max-w-sm">{addRestaurantCard(true)}</div>
            <Collapsible>
              <CollapsibleTrigger className="flex items-center gap-2 text-sm font-medium text-primary hover:underline">
                Why add another restaurant?
                <ChevronDown className="h-4 w-4" />
              </CollapsibleTrigger>
              <CollapsibleContent className="pt-3 text-sm text-muted-foreground space-y-1.5">
                <p>See all your restaurants in one view</p>
                <p>Compare money lost across locations</p>
                <p>One login for everything you own</p>
              </CollapsibleContent>
            </Collapsible>
          </div>
        </>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {restaurants.map((r) => renderRestaurantCard(r))}
            {addRestaurantCard()}
          </div>

          <div className="space-y-3">
            <h2 className="text-sm font-semibold tracking-tight">This Week — All Restaurants</h2>
            <div className="rounded-xl border border-border/60 overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/30 hover:bg-muted/30">
                    <TableHead>Restaurant</TableHead>
                    <TableHead className="text-right">Money Lost</TableHead>
                    <TableHead className="text-right hidden sm:table-cell">Inventory Value</TableHead>
                    <TableHead className="hidden md:table-cell">Last Count</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {comparisonRows.map(({ restaurant: r, summary: s, status }) => {
                    const money = formatMoneyLost(s);
                    const lastCountLabel =
                      s?.lastCountAt
                        ? formatDistanceToNow(new Date(s.lastCountAt), { addSuffix: true })
                        : "Never";
                    return (
                      <TableRow
                        key={r.id}
                        className={cn(
                          "cursor-pointer",
                          r.id === highestLossId && "border-l-4 border-l-destructive/70",
                        )}
                        onClick={() => openRestaurant(r.id)}
                      >
                        <TableCell className="font-medium">{r.name}</TableCell>
                        <TableCell className={cn("text-right font-mono tabular-nums text-sm", money.className)}>
                          {summariesLoading ? "…" : money.label}
                        </TableCell>
                        <TableCell className="text-right font-mono tabular-nums text-sm hidden sm:table-cell">
                          {summariesLoading ? "…" : formatInventoryValue(s)}
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground hidden md:table-cell">
                          {summariesLoading ? "…" : lastCountLabel}
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className={cn("text-[10px]", statusBadgeClass(status))}>
                            {portfolioStatusLabel(status)}
                          </Badge>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
