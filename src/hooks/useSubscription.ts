import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export type SubscriptionStatus = "trial" | "active" | "past_due" | "canceled" | "unknown";

export interface SubscriptionState {
  status: SubscriptionStatus;
  trialEndsAt: Date | null;
  daysRemaining: number | null;
  isExpired: boolean;
  isActive: boolean;
  isTrial: boolean;
  loading: boolean;
  refetch: () => void;
}

const DEFAULT_STATE: Omit<SubscriptionState, "refetch"> = {
  status: "unknown",
  trialEndsAt: null,
  daysRemaining: null,
  isExpired: false,
  isActive: false,
  isTrial: false,
  loading: true,
};

function daysBetween(end: Date, now: Date): number {
  return Math.ceil((end.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
}

export function useSubscription(
  restaurantId: string | null | undefined,
): SubscriptionState {
  const [state, setState] = useState<Omit<SubscriptionState, "refetch">>(DEFAULT_STATE);
  const [refetchCount, setRefetchCount] = useState(0);

  useEffect(() => {
    if (!restaurantId) {
      setState({ ...DEFAULT_STATE, loading: false });
      return;
    }
    let cancelled = false;
    (async () => {
      setState((s) => ({ ...s, loading: true }));
      const { data } = (await supabase
        .from("restaurants")
        .select("subscription_status, trial_ends_at")
        .eq("id", restaurantId)
        .maybeSingle()) as unknown as {
        data: { subscription_status: string | null; trial_ends_at: string | null } | null;
      };
      if (cancelled) return;

      const rawStatus = (data?.subscription_status ?? "trial") as SubscriptionStatus;
      const allowed: SubscriptionStatus[] = ["trial", "active", "past_due", "canceled"];
      const status: SubscriptionStatus = allowed.includes(rawStatus) ? rawStatus : "unknown";

      const trialEndsAt = data?.trial_ends_at ? new Date(data.trial_ends_at) : null;
      const now = new Date();
      const daysRemaining =
        status === "trial" && trialEndsAt && !Number.isNaN(trialEndsAt.getTime())
          ? Math.max(0, daysBetween(trialEndsAt, now))
          : null;
      const isTrial = status === "trial";
      const isActive = status === "active";
      const isExpired =
        isTrial && trialEndsAt !== null && trialEndsAt.getTime() < now.getTime();

      setState({
        status,
        trialEndsAt,
        daysRemaining,
        isExpired,
        isActive,
        isTrial,
        loading: false,
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [restaurantId, refetchCount]);

  return {
    ...state,
    refetch: () => setRefetchCount((c) => c + 1),
  };
}
