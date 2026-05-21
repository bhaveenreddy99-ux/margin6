import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  AlertTriangle, ArrowRight, ChefHat, DollarSign, Eye, Flame,
  Receipt, ShoppingCart, TrendingDown, TrendingUp,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { supabase } from "@/integrations/supabase/client";
import { useDashboardData } from "@/hooks/useDashboardData";
import { dashboardSpendPeriodLabel } from "@/domain/dashboard/dashboardSelectors";
import type { DashboardTimeFilter } from "@/domain/dashboard/dashboardTypes";

const DEMO_RESTAURANT_ID = "b0000000-0000-0000-0000-000000000001";
const TIME_FILTER: DashboardTimeFilter = "30_days";

// ── Local KpiCard (copied from Dashboard.tsx) ─────────────────────────────
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

// ── Local SpendOverview (copied from Dashboard.tsx, buttons removed) ──────
function SpendOverview({
  timeFilter,
  spendData,
}: {
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
                <div key={i} className="flex items-center justify-between py-1.5 px-2 rounded">
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

// ── Money Lost hero card ──────────────────────────────────────────────────
function MoneyLostHero({
  waste,
  priceHikes,
  overstock,
}: {
  waste: number;
  priceHikes: number;
  overstock: number;
}) {
  const total = waste + priceHikes + overstock;
  return (
    <Card className="border-destructive/15 bg-gradient-to-br from-destructive/5 to-transparent">
      <CardContent className="p-7 flex flex-col items-center text-center">
        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-destructive/80">
          <AlertTriangle className="h-3.5 w-3.5" />
          Money Lost This Period
        </div>
        <p className="mt-3 text-5xl sm:text-6xl font-extrabold tracking-tight tabular-nums text-destructive">
          ${total.toLocaleString(undefined, { maximumFractionDigits: 0 })}
        </p>
        <p className="mt-2 text-sm text-muted-foreground">estimated loss this period</p>
        <p className="mt-4 text-xs text-muted-foreground/85 font-mono">
          Waste ${waste.toLocaleString(undefined, { maximumFractionDigits: 0 })} ·
          {" "}Price hikes ${priceHikes.toLocaleString(undefined, { maximumFractionDigits: 0 })} ·
          {" "}Overstock ${overstock.toLocaleString(undefined, { maximumFractionDigits: 0 })}
        </p>
      </CardContent>
    </Card>
  );
}

// ── Top Profit Leaks ──────────────────────────────────────────────────────
function TopProfitLeaks() {
  const leaks = [
    { item: "Chicken Breast", amount: 76.5, why: "price hike + high usage" },
    { item: "Tomatoes",       amount: 19.0, why: "spoilage + price hike" },
    { item: "Cooking Oil",    amount: 11.2, why: "price hike" },
  ];
  return (
    <Card>
      <div className="flex items-center gap-2 p-5 pb-3">
        <Flame className="h-4 w-4 text-destructive" />
        <h3 className="text-sm font-bold tracking-tight">Top Profit Leaks</h3>
      </div>
      <CardContent className="pt-0 pb-4 px-5">
        <div className="space-y-2">
          {leaks.map((l) => (
            <div
              key={l.item}
              className="flex items-center justify-between py-2 px-3 rounded-lg border border-border/40"
            >
              <div className="min-w-0">
                <p className="text-sm font-semibold truncate">{l.item}</p>
                <p className="text-xs text-muted-foreground/85">{l.why}</p>
              </div>
              <p className="text-sm font-bold font-mono text-destructive shrink-0 ml-3">
                ${l.amount.toFixed(2)}
              </p>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

export default function PublicDemoPage() {
  const [locationId, setLocationId] = useState<string | null>(null);
  const [locationLoaded, setLocationLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("locations")
        .select("id")
        .eq("restaurant_id", DEMO_RESTAURANT_ID)
        .limit(1);
      if (cancelled) return;
      setLocationId(data?.[0]?.id ?? null);
      setLocationLoaded(true);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const {
    inventoryValue,
    stockStatus,
    reorderSummary,
    overstockValue,
    recordedWasteValue,
    priceIncreaseImpact,
    spendOverviewData,
    loading,
  } = useDashboardData({
    currentRestaurantId: locationLoaded ? DEMO_RESTAURANT_ID : null,
    currentLocationId: locationId,
    timeFilter: TIME_FILTER,
  });

  const reorderValue = reorderSummary?.totalReorderValue ?? 0;
  const criticalCount = stockStatus.red;

  return (
    <div className="min-h-screen bg-background">
      {/* ─── Banner ─────────────────────────────────────────────────────── */}
      <div className="sticky top-0 z-50 bg-gradient-to-r from-[hsl(25,95%,53%)] to-[hsl(38,92%,50%)] text-white shadow-md">
        <div className="container flex flex-col sm:flex-row items-center justify-between gap-3 py-3">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <Eye className="h-4 w-4" />
            You are viewing a live demo — data is read-only
          </div>
          <div className="flex items-center gap-2">
            <Link to="/signup">
              <Button size="sm" className="bg-white text-[hsl(25,95%,53%)] hover:bg-white/90 font-semibold">
                Start Free Trial
              </Button>
            </Link>
            <Link to="/login">
              <Button size="sm" variant="outline" className="border-white/40 text-white hover:bg-white/10 hover:text-white">
                Log In
              </Button>
            </Link>
          </div>
        </div>
      </div>

      {/* ─── Page header ────────────────────────────────────────────────── */}
      <div className="container py-8">
        <div className="flex items-center gap-2.5 mb-1">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-orange">
            <ChefHat className="h-4 w-4 text-white" />
          </div>
          <span className="text-lg font-bold tracking-tight">
            Restaurant<span className="text-gradient-orange">IQ</span>
          </span>
          <span className="mx-2 text-muted-foreground/30">/</span>
          <h1 className="text-lg font-bold tracking-tight">Demo Kitchen</h1>
        </div>
        <p className="text-sm text-muted-foreground mb-6">
          Live dashboard with real seeded data. Last 30 days.
        </p>

        {loading ? (
          <div className="py-24 text-center text-sm text-muted-foreground">Loading demo…</div>
        ) : (
          <div className="space-y-6 animate-fade-in">
            {/* Money Lost hero */}
            <MoneyLostHero
              waste={recordedWasteValue}
              priceHikes={priceIncreaseImpact}
              overstock={overstockValue}
            />

            {/* Top KPI cards */}
            <div className="grid gap-4 sm:grid-cols-3">
              <KpiCard
                icon={DollarSign}
                label="Inventory value"
                value={
                  inventoryValue > 0
                    ? `$${inventoryValue.toLocaleString(undefined, { maximumFractionDigits: 0 })}`
                    : "$0"
                }
                accent="primary"
                changeLabel="Across all storage zones"
              />
              <KpiCard
                icon={AlertTriangle}
                label="Critical low stock items"
                value={String(criticalCount)}
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
                changeLabel="Estimated to reach PAR levels"
              />
            </div>

            {/* Spend overview + Profit leaks */}
            <div className="grid gap-5 lg:grid-cols-2">
              <SpendOverview timeFilter={TIME_FILTER} spendData={spendOverviewData} />
              <TopProfitLeaks />
            </div>

            {/* Bottom CTA */}
            <Card className="bg-gradient-to-br from-[hsl(25,95%,53%)]/10 to-[hsl(38,92%,50%)]/5 border-[hsl(25,95%,53%)]/20">
              <CardContent className="p-8 text-center">
                <h2 className="text-2xl sm:text-3xl font-extrabold tracking-tight">
                  This is <span className="text-gradient-orange">your restaurant's</span> data —
                  <br className="hidden sm:block" /> tracked automatically every week.
                </h2>
                <p className="mt-3 text-sm text-muted-foreground max-w-xl mx-auto">
                  Stop losing thousands to spoilage, mispriced invoices, and overstock you didn't know about.
                </p>
                <div className="mt-6 flex flex-col sm:flex-row items-center justify-center gap-3">
                  <Link to="/signup">
                    <Button
                      size="lg"
                      className="bg-gradient-orange shadow-orange text-white gap-2 hover:opacity-90"
                    >
                      Start Free 14-Day Trial <ArrowRight className="h-4 w-4" />
                    </Button>
                  </Link>
                  <Link to="/login" className="text-sm text-muted-foreground hover:text-foreground underline">
                    Already have an account? Log in
                  </Link>
                </div>
              </CardContent>
            </Card>
          </div>
        )}
      </div>
    </div>
  );
}
