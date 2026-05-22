import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Building2, Plus, ArrowRight, CalendarDays, AlertTriangle } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useRestaurant } from "@/contexts/RestaurantContext";
import { supabase } from "@/integrations/supabase/client";
import { formatDistanceToNow } from "date-fns";

type RestaurantSummary = {
  lastCountAt: string | null;
  moneyLost: number | null;
};

export default function MyRestaurantsPage() {
  const { restaurants, setCurrentRestaurant, loading } = useRestaurant();
  const navigate = useNavigate();
  const [summaries, setSummaries] = useState<Record<string, RestaurantSummary>>({});
  const [summariesLoading, setSummariesLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    if (restaurants.length === 0) {
      setSummariesLoading(false);
      return;
    }

    const load = async () => {
      setSummariesLoading(true);
      const ids = restaurants.map((r) => r.id);

      const { data: sessions } = await supabase
        .from("inventory_sessions")
        .select("restaurant_id, approved_at")
        .in("restaurant_id", ids)
        .eq("status", "APPROVED")
        .order("approved_at", { ascending: false });

      if (cancelled) return;

      const lastByRestaurant: Record<string, string> = {};
      for (const row of sessions ?? []) {
        const rid = row.restaurant_id as string;
        if (!rid || !row.approved_at) continue;
        if (!lastByRestaurant[rid]) lastByRestaurant[rid] = row.approved_at as string;
      }

      const next: Record<string, RestaurantSummary> = {};
      for (const r of restaurants) {
        next[r.id] = {
          lastCountAt: lastByRestaurant[r.id] ?? null,
          moneyLost: null,
        };
      }
      setSummaries(next);
      setSummariesLoading(false);
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, [restaurants]);

  const openRestaurant = (id: string) => {
    const r = restaurants.find((x) => x.id === id);
    if (!r) return;
    setCurrentRestaurant(r);
    navigate("/app/dashboard");
  };

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

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-xl font-bold tracking-tight font-display">My Restaurants</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          {restaurants.length} restaurant{restaurants.length !== 1 ? "s" : ""}
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {restaurants.map((r) => {
          const s = summaries[r.id];
          const lastCountLabel =
            s?.lastCountAt
              ? formatDistanceToNow(new Date(s.lastCountAt), { addSuffix: true })
              : "No counts yet";
          const moneyLostLabel =
            s?.moneyLost != null
              ? `$${s.moneyLost.toLocaleString(undefined, { maximumFractionDigits: 0 })}`
              : "—";
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
                    <h2 className="text-base font-bold tracking-tight truncate">
                      {r.name}
                    </h2>
                  </div>
                  <Badge variant="secondary" className="text-[10px] shrink-0">
                    {r.role}
                  </Badge>
                </div>

                <div className="space-y-2 text-sm flex-1">
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <AlertTriangle className="h-3.5 w-3.5 opacity-60" />
                    <span className="text-xs">Money lost this week</span>
                    <span className="ml-auto font-mono font-semibold text-foreground tabular-nums">
                      {summariesLoading ? <Skeleton className="inline-block h-4 w-12" /> : moneyLostLabel}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <CalendarDays className="h-3.5 w-3.5 opacity-60" />
                    <span className="text-xs">Last inventory count</span>
                    <span className="ml-auto text-xs font-medium text-foreground">
                      {summariesLoading ? <Skeleton className="inline-block h-4 w-20" /> : lastCountLabel}
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
        })}

        <button
          type="button"
          onClick={() => navigate("/app/restaurants/new")}
          className="rounded-xl border-2 border-dashed border-border/60 hover:border-primary/50 hover:bg-primary/[0.03] transition-all duration-200 p-5 flex flex-col items-center justify-center gap-3 min-h-[200px] group"
        >
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10 group-hover:bg-primary/20 transition-colors">
            <Plus className="h-6 w-6 text-primary" />
          </div>
          <div className="text-center">
            <p className="text-sm font-semibold">Add New Restaurant</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Set up another location
            </p>
          </div>
        </button>
      </div>
    </div>
  );
}
