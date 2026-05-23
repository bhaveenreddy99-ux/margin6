import { Link } from "react-router-dom";
import { AlertTriangle, ArrowRight, Clock } from "lucide-react";
import { useSubscription } from "@/hooks/useSubscription";

interface TrialBannerProps {
  restaurantId: string;
}

/**
 * Renders nothing for active / past_due / canceled / loading states.
 * Shows:
 *   • Expired trial → full-width amber banner with Upgrade CTA.
 *   • Active trial with ≤ 3 days remaining → small countdown banner.
 *   • Active trial > 3 days → no UI (deliberate; not noisy).
 */
export function TrialBanner({ restaurantId }: TrialBannerProps) {
  const { isTrial, isExpired, daysRemaining, loading } = useSubscription(restaurantId);

  if (loading || !isTrial) return null;

  if (isExpired) {
    return (
      <div className="rounded-xl border-2 border-amber-300/80 bg-amber-50/90 dark:border-amber-700/60 dark:bg-amber-950/40 px-4 py-3 sm:px-5 sm:py-4">
        <div className="flex items-center gap-3 flex-wrap">
          <AlertTriangle className="h-5 w-5 text-amber-700 dark:text-amber-300 shrink-0" />
          <div className="flex-1 min-w-[220px]">
            <p className="text-sm font-bold text-amber-900 dark:text-amber-100">
              Your free trial has ended.
            </p>
            <p className="text-xs text-amber-900/85 dark:text-amber-100/85 mt-0.5">
              Upgrade to keep accessing Margin6. $99/month — cancel anytime.
            </p>
          </div>
          <Link
            to="/app/billing"
            className="inline-flex items-center gap-1.5 rounded-lg bg-[hsl(25,95%,53%)] px-4 py-2 text-sm font-semibold text-white shadow-sm hover:opacity-90"
          >
            Upgrade Now <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>
      </div>
    );
  }

  if (daysRemaining !== null && daysRemaining <= 3) {
    return (
      <div className="rounded-lg border border-[hsl(25,95%,53%)]/30 bg-[hsl(25,95%,53%)]/5 px-3 py-2 flex items-center gap-2 flex-wrap">
        <Clock className="h-4 w-4 text-[hsl(25,95%,53%)] shrink-0" />
        <p className="text-xs font-semibold flex-1 min-w-[180px]">
          {daysRemaining} day{daysRemaining === 1 ? "" : "s"} left in trial
        </p>
        <Link
          to="/app/billing"
          className="text-xs font-semibold text-[hsl(25,95%,53%)] hover:underline inline-flex items-center gap-1"
        >
          Upgrade <ArrowRight className="h-3 w-3" />
        </Link>
      </div>
    );
  }

  return null;
}
