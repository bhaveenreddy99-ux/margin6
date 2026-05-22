import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { CheckCircle2, Circle, Rocket } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { supabase } from "@/integrations/supabase/client";

interface OnboardingChecklistProps {
  restaurantId: string;
  locationId?: string | null;
}

type Flags = {
  hasInvoice: boolean;
  hasApprovedCount: boolean;
  hasParGuide: boolean;
  hasWeekSales: boolean;
  hasAlertSetup: boolean;
};

const DEFAULT_FLAGS: Flags = {
  hasInvoice: false,
  hasApprovedCount: false,
  hasParGuide: false,
  hasWeekSales: false,
  hasAlertSetup: false,
};

function startOfIsoWeek(d: Date): Date {
  // Monday-anchored week, matching SQL date_trunc('week', ...). Returns a Date
  // representing 00:00:00 local time on the Monday of d's week.
  const copy = new Date(d);
  copy.setHours(0, 0, 0, 0);
  const day = copy.getDay(); // 0 = Sunday … 6 = Saturday
  const diff = (day + 6) % 7; // days since Monday
  copy.setDate(copy.getDate() - diff);
  return copy;
}

export function OnboardingChecklist({
  restaurantId,
  locationId,
}: OnboardingChecklistProps) {
  const navigate = useNavigate();
  const [flags, setFlags] = useState<Flags>(DEFAULT_FLAGS);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const weekStart = startOfIsoWeek(new Date()).toISOString().slice(0, 10);

      const invoiceQ = supabase
        .from("invoices")
        .select("id", { count: "exact", head: true })
        .eq("restaurant_id", restaurantId)
        .neq("status", "draft");

      let approvedQ = supabase
        .from("inventory_sessions")
        .select("id", { count: "exact", head: true })
        .eq("restaurant_id", restaurantId)
        .eq("status", "APPROVED");
      if (locationId) approvedQ = approvedQ.or(`location_id.eq.${locationId},location_id.is.null`);

      let parQ = supabase
        .from("par_guides")
        .select("id", { count: "exact", head: true })
        .eq("restaurant_id", restaurantId);
      if (locationId) parQ = parQ.or(`location_id.eq.${locationId},location_id.is.null`);

      const salesQ = supabase
        .from("weekly_sales")
        .select("id", { count: "exact", head: true })
        .eq("restaurant_id", restaurantId)
        .gte("week_start", weekStart);

      const prefsQ = supabase
        .from("notification_preferences")
        .select("id", { count: "exact", head: true })
        .eq("restaurant_id", restaurantId);

      const [inv, approved, par, sales, prefs] = await Promise.all([
        invoiceQ,
        approvedQ,
        parQ,
        salesQ,
        prefsQ,
      ]);

      if (cancelled) return;

      setFlags({
        hasInvoice: (inv.count ?? 0) > 0,
        hasApprovedCount: (approved.count ?? 0) > 0,
        hasParGuide: (par.count ?? 0) > 0,
        hasWeekSales: (sales.count ?? 0) > 0,
        hasAlertSetup: (prefs.count ?? 0) > 0,
      });
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [restaurantId, locationId]);

  if (loading) {
    return <Skeleton className="h-48 w-full rounded-xl" />;
  }

  const steps = [
    {
      title: "Upload your first invoice",
      description: "Forward a vendor invoice so we can track your spend",
      complete: flags.hasInvoice,
      actionLabel: "Upload Invoice",
      actionRoute: "/app/invoices",
    },
    {
      title: "Complete your first inventory count",
      description: "Count your stock so we can calculate what to reorder",
      complete: flags.hasApprovedCount,
      actionLabel: "Start Count",
      actionRoute: "/app/inventory/enter",
    },
    {
      title: "Set PAR levels for your items",
      description: "PAR levels tell us when you need to reorder",
      complete: flags.hasParGuide,
      actionLabel: "Set PAR Levels",
      actionRoute: "/app/par",
    },
    {
      title: "Enter this week's sales",
      description: "Add your weekly revenue so we can calculate food cost %",
      complete: flags.hasWeekSales,
      actionLabel: "Enter Sales",
      actionRoute: "/app/sales",
    },
    {
      title: "Set up notifications",
      description: "Get alerted when prices spike or stock runs low",
      complete: flags.hasAlertSetup,
      actionLabel: "Set Up",
      actionRoute: "/app/settings/alerts",
    },
  ];

  const completedCount = steps.filter((s) => s.complete).length;
  const totalSteps = steps.length;
  if (completedCount === totalSteps) return null;
  const pct = (completedCount / totalSteps) * 100;

  return (
    <Card className="border-l-4 border-orange-400">
      <CardContent className="p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-2.5 min-w-0">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-orange-400/10">
              <Rocket className="h-4 w-4 text-orange-500" />
            </div>
            <div className="min-w-0">
              <h2 className="text-sm font-bold tracking-tight">Get started</h2>
              <p className="text-xs text-muted-foreground mt-0.5">
                Complete setup to unlock your profit intelligence
              </p>
            </div>
          </div>
          <p className="text-xs font-semibold text-muted-foreground shrink-0 whitespace-nowrap">
            {completedCount} of {totalSteps} complete
          </p>
        </div>

        <div className="mt-4 h-1.5 w-full rounded-full bg-muted overflow-hidden">
          <div
            className="h-full rounded-full bg-orange-400 transition-all duration-300"
            style={{ width: `${pct}%` }}
          />
        </div>

        <ul className="mt-5 space-y-3">
          {steps.map((step) => (
            <li key={step.title} className="flex items-start gap-3">
              {step.complete ? (
                <>
                  <CheckCircle2 className="h-5 w-5 text-success shrink-0 mt-0.5" />
                  <p className="text-sm text-muted-foreground line-through opacity-60 flex-1">
                    {step.title}
                  </p>
                </>
              ) : (
                <>
                  <Circle className="h-5 w-5 text-muted-foreground/40 shrink-0 mt-0.5" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold">{step.title}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">{step.description}</p>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => navigate(step.actionRoute)}
                    className="shrink-0 border-orange-400 text-orange-600 hover:bg-orange-50 hover:text-orange-700 dark:hover:bg-orange-950/30"
                  >
                    {step.actionLabel}
                  </Button>
                </>
              )}
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
