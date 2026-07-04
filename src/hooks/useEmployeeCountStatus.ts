import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

/**
 * Lightweight count-status for the EMPLOYEE dashboard view.
 *
 * DELIBERATELY does NOT use useDashboardData / the money loaders — a STAFF user
 * must never trigger a fetch of cost/inventory-value/spend data (data-exposure
 * fix, not just hidden UI). This runs a single small query over inventory_sessions
 * to answer only: "when was the last count?" and "is one in progress to resume?".
 */
export type EmployeeCountStatus = {
  loading: boolean;
  lastCountAt: string | null;
  inProgressSessionId: string | null;
};

export function useEmployeeCountStatus(restaurantId: string | null | undefined): EmployeeCountStatus {
  const [state, setState] = useState<EmployeeCountStatus>({
    loading: true,
    lastCountAt: null,
    inProgressSessionId: null,
  });

  useEffect(() => {
    let cancelled = false;
    if (!restaurantId) {
      setState({ loading: false, lastCountAt: null, inProgressSessionId: null });
      return;
    }

    const load = async () => {
      setState((s) => ({ ...s, loading: true }));
      const { data, error } = await supabase
        .from("inventory_sessions")
        .select("id, status, approved_at, updated_at")
        .eq("restaurant_id", restaurantId)
        .order("updated_at", { ascending: false })
        .limit(20);

      if (cancelled) return;
      if (error) {
        // No money is involved; a status read failing just means we show the
        // neutral "start a count" state rather than a wrong number.
        setState({ loading: false, lastCountAt: null, inProgressSessionId: null });
        return;
      }

      const rows = data ?? [];
      const inProgress = rows.find((r) => r.status === "IN_PROGRESS");
      const lastApproved = rows.find((r) => r.status === "APPROVED" && r.approved_at);

      setState({
        loading: false,
        lastCountAt: (lastApproved?.approved_at as string | undefined) ?? null,
        inProgressSessionId: (inProgress?.id as string | undefined) ?? null,
      });
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, [restaurantId]);

  return state;
}
