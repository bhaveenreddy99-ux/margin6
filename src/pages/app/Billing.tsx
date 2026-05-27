import { useState } from "react";
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Clock,
  CreditCard,
  Loader2,
  ShieldOff,
  Sparkles,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useRestaurant } from "@/contexts/RestaurantContext";
import { useSubscription } from "@/hooks/useSubscription";

const PLAN_PRICE_MONTHLY = 69.99;
const PLAN_PRICE_LABEL = PLAN_PRICE_MONTHLY.toFixed(2);
const PLAN_NAME = "Founding Member";
const PLAN_SUBTEXT = "Locked in forever · Goes to $99 after first 100 members";

const PLAN_FEATURES: string[] = [
  "Real-time Money Lost hero with full math breakdown",
  "Top Profit Leaks ranked across waste, price hikes, overstock, shrinkage",
  "Price Hike Alerts on every confirmed invoice",
  "Cash Frozen in Overstock per location",
  "Variance & Shrinkage detection from approved counts",
  "Smart inventory counts, PAR guides, and reorder suggestions",
  "Vendor invoice email parsing — forward and forget",
  "Weekly loss digest delivered every Monday 7 a.m.",
  "Free Leak Audit tool for prospects you onboard",
];

function fmtDate(d: Date | null): string {
  if (!d || Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

export default function BillingPage() {
  const { currentRestaurant } = useRestaurant();
  const subscription = useSubscription(currentRestaurant?.id);
  const [upgrading, setUpgrading] = useState(false);

  const isOwner = currentRestaurant?.role === "OWNER";

  const handleUpgrade = async () => {
    if (!currentRestaurant?.id) {
      toast.error("No restaurant selected");
      return;
    }
    if (!isOwner) {
      toast.error("Only the restaurant OWNER can upgrade the plan");
      return;
    }
    setUpgrading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) {
        toast.error("Please sign in again to upgrade");
        setUpgrading(false);
        return;
      }

      const { data, error } = await supabase.functions.invoke("create-checkout-session", {
        body: { restaurant_id: currentRestaurant.id },
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          "Content-Type": "application/json",
        },
      });
      if (error) throw error;
      const url = (data as { url?: string } | null)?.url;
      if (!url) throw new Error("Stripe checkout URL not returned");
      window.location.href = url;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      toast.error(message || "Could not start checkout");
      setUpgrading(false);
    }
  };

  return (
    <div className="space-y-6 animate-fade-in max-w-3xl">
      <div>
        <h1 className="text-xl font-bold tracking-tight font-display">Billing</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          {currentRestaurant?.name ?? "Your restaurant"}
        </p>
      </div>

      {subscription.loading ? (
        <Skeleton className="h-40 rounded-xl" />
      ) : (
        <StatusCard
          status={subscription.status}
          trialEndsAt={subscription.trialEndsAt}
          daysRemaining={subscription.daysRemaining}
          isExpired={subscription.isExpired}
        />
      )}

      <Card>
        <CardContent className="p-6">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div>
              <div className="flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-[hsl(25,95%,53%)]" />
                <h2 className="text-base font-bold tracking-tight">{PLAN_NAME}</h2>
              </div>
              <p className="text-sm text-muted-foreground mt-1">{PLAN_SUBTEXT}</p>
            </div>
            <p className="text-3xl font-extrabold tracking-tight tabular-nums">
              ${PLAN_PRICE_LABEL}
              <span className="text-sm font-medium text-muted-foreground">/mo</span>
            </p>
          </div>

          <ul className="mt-5 space-y-2">
            {PLAN_FEATURES.map((feature) => (
              <li key={feature} className="flex items-start gap-2.5">
                <CheckCircle2 className="h-4 w-4 text-success shrink-0 mt-0.5" />
                <span className="text-sm text-foreground">{feature}</span>
              </li>
            ))}
          </ul>

          {subscription.status !== "active" && (
            <div className="mt-6">
              <Button
                size="lg"
                onClick={handleUpgrade}
                disabled={upgrading || !isOwner || subscription.loading}
                className="bg-gradient-orange shadow-orange text-white gap-2 hover:opacity-90"
              >
                {upgrading ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Redirecting…
                  </>
                ) : (
                  <>
                    Upgrade Now <ArrowRight className="h-4 w-4" />
                  </>
                )}
              </Button>
              {!isOwner && (
                <p className="text-xs text-muted-foreground mt-2">
                  Only the restaurant OWNER can upgrade the plan.
                </p>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function StatusCard({
  status,
  trialEndsAt,
  daysRemaining,
  isExpired,
}: {
  status: "trial" | "active" | "past_due" | "canceled" | "unknown";
  trialEndsAt: Date | null;
  daysRemaining: number | null;
  isExpired: boolean;
}) {
  if (status === "active") {
    return (
      <Card className="border-success/20 bg-success/5">
        <CardContent className="p-5 flex items-start gap-3">
          <CheckCircle2 className="h-5 w-5 text-success shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-bold">{PLAN_NAME} — ${PLAN_PRICE_LABEL}/month</p>
            <p className="text-xs text-muted-foreground mt-1">
              Subscription is active. Manage your payment method in Stripe's customer
              portal (link arrives in your monthly receipt email).
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (status === "past_due") {
    return (
      <Card className="border-destructive/30 bg-destructive/5">
        <CardContent className="p-5 flex items-start gap-3">
          <AlertTriangle className="h-5 w-5 text-destructive shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-bold text-destructive">
              Payment failed — update your payment method
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              Your latest invoice could not be charged. Click Upgrade Now to enter a
              new card.
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (status === "canceled") {
    return (
      <Card className="border-muted/40">
        <CardContent className="p-5 flex items-start gap-3">
          <ShieldOff className="h-5 w-5 text-muted-foreground shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-bold">Your plan has been canceled</p>
            <p className="text-xs text-muted-foreground mt-1">
              Re-subscribe to keep using Margin6.
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  // trial (and unknown — treat as trial-like)
  const totalTrialDays = 14;
  const used =
    daysRemaining !== null ? Math.max(0, totalTrialDays - daysRemaining) : 0;
  const pct = Math.min(100, Math.round((used / totalTrialDays) * 100));

  if (isExpired) {
    return (
      <Card className="border-amber-300/70 bg-amber-50/80 dark:border-amber-800/60 dark:bg-amber-950/30">
        <CardContent className="p-5">
          <div className="flex items-start gap-3">
            <AlertTriangle className="h-5 w-5 text-amber-700 dark:text-amber-300 shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-bold text-amber-900 dark:text-amber-100">
                Your free trial has ended
              </p>
              <p className="text-xs text-amber-900/80 dark:text-amber-100/80 mt-1">
                Upgrade to keep accessing Margin6. ${PLAN_PRICE_LABEL}/month —
                cancel anytime.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-[hsl(25,95%,53%)]/20 bg-gradient-to-br from-[hsl(25,95%,53%)]/5 to-transparent">
      <CardContent className="p-5">
        <div className="flex items-start gap-3">
          <Clock className="h-5 w-5 text-[hsl(25,95%,53%)] shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-bold">
              {daysRemaining ?? totalTrialDays} day{(daysRemaining ?? totalTrialDays) === 1 ? "" : "s"} left in your free trial
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              {trialEndsAt ? `Trial ends ${fmtDate(trialEndsAt)}.` : "14-day trial — no card required."}
            </p>
            <div className="mt-3 h-1.5 w-full rounded-full bg-muted overflow-hidden">
              <div
                className="h-full rounded-full bg-[hsl(25,95%,53%)] transition-all duration-300"
                style={{ width: `${pct}%` }}
              />
            </div>
          </div>
          <CreditCard className="h-5 w-5 text-muted-foreground/40 shrink-0" />
        </div>
      </CardContent>
    </Card>
  );
}
