import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  resolveEntitlement,
  type EntitlementStatus,
} from "@/domain/subscription/resolveEntitlement";

export type SubscriptionStatus = "trial" | "active" | "past_due" | "canceled" | "unknown";

export interface SubscriptionState {
  status: SubscriptionStatus;
  /** Precise entitlement from the single-source resolver (grandfathered/trialing/expired/…). */
  entitlement: EntitlementStatus;
  /** Full access intended (view + create). */
  covered: boolean;
  /** View-only intended (lapsed trial / billing problem). NOT enforced yet — flag off. */
  readOnly: boolean;
  trialEndsAt: Date | null;
  daysRemaining: number | null;
  isExpired: boolean;
  isActive: boolean;
  isTrial: boolean;
  loading: boolean;
  refetch: () => void;
}

const DEFAULT_STATE: Omit<SubscriptionState, "refetch"> = {
  status: "active",
  entitlement: "grandfathered",
  covered: true,
  readOnly: false,
  trialEndsAt: null,
  daysRemaining: null,
  isExpired: false,
  isActive: true,
  isTrial: false,
  loading: true,
};

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
      // types.ts is stale for the billing columns, so cast the result (same as before).
      const { data } = (await supabase
        .from("restaurants")
        .select("subscription_status, trial_ends_at, created_at, stripe_subscription_id")
        .eq("id", restaurantId)
        .maybeSingle()) as unknown as {
        data: {
          subscription_status: string | null;
          trial_ends_at: string | null;
          created_at: string | null;
          stripe_subscription_id: string | null;
        } | null;
      };
      if (cancelled) return;

      // SINGLE SOURCE OF TRUTH — all entitlement logic lives in resolveEntitlement.
      const ent = resolveEntitlement({
        subscriptionStatus: data?.subscription_status ?? null,
        trialEndsAt: data?.trial_ends_at ?? null,
        createdAt: data?.created_at ?? null,
        stripeSubscriptionId: data?.stripe_subscription_id ?? null,
      });

      // Map the precise entitlement onto the legacy interface the banner/Billing use.
      // grandfathered reads as "active/covered" (never nags); trialing/expired read
      // as "trial" so the existing banner shows the countdown / "trial ended".
      const isTrial = ent.status === "trialing" || ent.status === "expired";
      const isExpired = ent.status === "expired";
      const isActive = ent.status === "active" || ent.status === "grandfathered";
      const status: SubscriptionStatus =
        ent.status === "grandfathered" || ent.status === "active"
          ? "active"
          : ent.status === "trialing" || ent.status === "expired"
            ? "trial"
            : ent.status; // past_due | canceled

      setState({
        status,
        entitlement: ent.status,
        covered: ent.covered,
        readOnly: ent.readOnly,
        trialEndsAt: data?.trial_ends_at ? new Date(data.trial_ends_at) : null,
        daysRemaining: ent.daysRemaining,
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
