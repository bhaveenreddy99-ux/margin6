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
  lastSessionDate: Date | null;
  periodSpend: number;
  pendingInvoices: number;
}

export function OnboardingChecklist({
  restaurantId,
  locationId: _locationId,
  lastSessionDate,
  periodSpend,
  pendingInvoices,
}: OnboardingChecklistProps) {
  const navigate = useNavigate();
  const [hasSales, setHasSales] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { count } = await supabase
        .from("weekly_sales")
        .select("id", { count: "exact", head: true })
        .eq("restaurant_id", restaurantId)
        .limit(1);
      if (cancelled) return;
      setHasSales((count ?? 0) > 0);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [restaurantId]);

  if (loading) {
    return <Skeleton className="h-48 w-full rounded-xl" />;
  }

  const steps = [
    {
      title: "Upload your first invoice",
      description: "Forward a vendor invoice so we can track your spend",
      complete: periodSpend > 0 || pendingInvoices > 0,
      actionLabel: "Upload Invoice",
      actionRoute: "/app/invoices",
    },
    {
      title: "Complete your first inventory count",
      description: "Count your stock so we can calculate what to reorder",
      complete: lastSessionDate !== null,
      actionLabel: "Start Count",
      actionRoute: "/app/inventory/enter",
    },
    {
      title: "Enter this week's sales",
      description: "Add your weekly revenue so we can calculate food cost %",
      complete: hasSales,
      actionLabel: "Enter Sales",
      actionRoute: "/app/sales",
    },
    {
      title: "Set up notifications",
      description: "Get alerted when prices spike or stock runs low",
      complete: false,
      actionLabel: "Set Up",
      actionRoute: "/app/settings/alerts",
    },
  ];

  const completedCount = steps.filter((s) => s.complete).length;
  if (completedCount === 4) return null;
  const pct = (completedCount / 4) * 100;

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
            {completedCount} of 4 complete
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
