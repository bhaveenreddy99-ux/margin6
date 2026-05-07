import { useEffect, useMemo, useState } from "react";
import { subDays, subHours } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import { useAllLocationsSummary, type LocationSummary } from "@/hooks/useAllLocationsSummary";

export type AlertSeverity = "critical" | "warning" | "info";

export interface LocationAlert {
  id: string;
  severity: AlertSeverity;
  location_id: string;
  location_name: string;
  restaurant_name: string;
  brand: string | null;
  type:
    | "count_overdue"
    | "food_cost_critical"
    | "food_cost_warning"
    | "price_spike"
    | "smart_order_pending";
  title: string;
  description: string;
  created_at: string;
  action_url: string;
}

type LocMeta = {
  id: string;
  name: string;
  restaurant_id: string;
  restaurants: { name: string } | null;
};

const severityOrder: Record<AlertSeverity, number> = { critical: 0, warning: 1, info: 2 };

function sortAlerts(a: LocationAlert, b: LocationAlert): number {
  const sev = severityOrder[a.severity] - severityOrder[b.severity];
  if (sev !== 0) return sev;
  return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
}

export function useLocationAlerts(
  restaurantIds: string[],
  summaryData?: LocationSummary[],
): {
  alerts: LocationAlert[];
  criticalCount: number;
  warningCount: number;
  loading: boolean;
} {
  const useExternalSummary = summaryData !== undefined;
  const internalSummary = useAllLocationsSummary("all_brands", "30d", useExternalSummary);
  const [extraAlerts, setExtraAlerts] = useState<LocationAlert[]>([]);
  const [extraLoading, setExtraLoading] = useState(false);

  const key = restaurantIds.join(",");

  useEffect(() => {
    if (restaurantIds.length === 0) {
      setExtraAlerts([]);
      setExtraLoading(false);
      return;
    }
    let cancelled = false;

    const run = async () => {
      setExtraLoading(true);
      try {
        const since = subDays(new Date(), 30);
        const cutoffDraft = subHours(new Date(), 24).toISOString();

        const [{ data: locRows }, { data: invs }, { data: runs }] = await Promise.all([
          supabase
            .from("locations")
            .select("id, name, restaurant_id, restaurants(name)")
            .in("restaurant_id", restaurantIds)
            .eq("is_active", true),
          supabase
            .from("invoices")
            .select("id, location_id, restaurant_id, invoice_date, created_at")
            .in("restaurant_id", restaurantIds)
            .eq("status", "confirmed")
            .order("created_at", { ascending: false })
            .limit(50),
          supabase
            .from("smart_order_runs")
            .select("id, location_id, restaurant_id, created_at, status")
            .in("restaurant_id", restaurantIds)
            .eq("status", "draft")
            .lt("created_at", cutoffDraft),
        ]);

        if (cancelled) return;

        const locMap = new Map<string, { name: string; restaurant_name: string }>();
        for (const row of (locRows ?? []) as unknown as LocMeta[]) {
          locMap.set(row.id, { name: row.name, restaurant_name: row.restaurants?.name ?? "" });
        }

        const spikeAlerts: LocationAlert[] = [];
        const invList = (invs ?? []).filter((inv) => {
          const d = inv.invoice_date ? new Date(inv.invoice_date as string) : new Date(inv.created_at as string);
          return d >= since;
        });

        if (invList.length > 0) {
          const invIds = invList.map((i) => i.id as string);
          const { data: items } = await supabase
            .from("invoice_items")
            .select("invoice_id, catalog_item_id, unit_cost, item_name")
            .in("invoice_id", invIds)
            .not("catalog_item_id", "is", null);

          if (!cancelled && items) {
            const invById = new Map(
              invList.map((i) => [
                i.id as string,
                {
                  location_id: i.location_id as string | null,
                  date: i.invoice_date ? new Date(i.invoice_date as string) : new Date(i.created_at as string),
                },
              ]),
            );

            type Line = {
              invoice_id: string;
              catalog_item_id: string;
              unit_cost: number;
              item_name: string;
              location_id: string | null;
              date: Date;
            };

            const lines: Line[] = [];
            for (const it of items) {
              const cid = it.catalog_item_id as string | null;
              if (!cid) continue;
              const invId = it.invoice_id as string;
              const meta = invById.get(invId);
              if (!meta?.location_id) continue;
              const uc = Number(it.unit_cost ?? 0);
              if (!Number.isFinite(uc) || uc <= 0) continue;
              lines.push({
                invoice_id: invId,
                catalog_item_id: cid,
                unit_cost: uc,
                item_name: (it.item_name as string) || "Item",
                location_id: meta.location_id,
                date: meta.date,
              });
            }

            const byKey = new Map<string, Line[]>();
            for (const ln of lines) {
              const k = `${ln.location_id}:${ln.catalog_item_id}`;
              if (!byKey.has(k)) byKey.set(k, []);
              byKey.get(k)!.push(ln);
            }

            for (const [, group] of byKey) {
              if (group.length < 2) continue;
              group.sort((a, b) => b.date.getTime() - a.date.getTime());
              const latest = group[0];
              const prev = group[1];
              if (prev.unit_cost <= 0) continue;
              const pct = ((latest.unit_cost - prev.unit_cost) / prev.unit_cost) * 100;
              if (pct <= 10) continue;
              const lid = latest.location_id!;
              const meta = locMap.get(lid);
              const locName = meta?.name ?? "Location";
              const rName = meta?.restaurant_name ?? "";
              const pctRounded = Math.round(pct * 10) / 10;
              spikeAlerts.push({
                id: `price_spike-${lid}-${latest.catalog_item_id}-${latest.invoice_id}`,
                severity: "warning",
                location_id: lid,
                location_name: locName,
                restaurant_name: rName,
                brand: null,
                type: "price_spike",
                title: `${latest.item_name} price up ${pctRounded}% at ${locName}`,
                description: `Was $${prev.unit_cost.toFixed(2)}, now $${latest.unit_cost.toFixed(2)} on latest invoice.`,
                created_at: latest.date.toISOString(),
                action_url: "/app/invoices",
              });
            }
          }
        }

        if (cancelled) return;

        const orderAlerts: LocationAlert[] = [];
        for (const r of runs ?? []) {
          const lid = r.location_id as string | null;
          if (!lid) continue;
          const meta = locMap.get(lid);
          const locName = meta?.name ?? "Location";
          const rName = meta?.restaurant_name ?? "";
          const created = new Date(r.created_at as string);
          const hrs = (Date.now() - created.getTime()) / (1000 * 60 * 60);
          orderAlerts.push({
            id: `smart_order_pending-${r.id}`,
            severity: "info",
            location_id: lid,
            location_name: locName,
            restaurant_name: rName,
            brand: null,
            type: "smart_order_pending",
            title: `Order ready at ${locName}`,
            description: `Smart order pending approval for ${Math.round(hrs)} hours.`,
            created_at: created.toISOString(),
            action_url: "/app/smart-order",
          });
        }

        setExtraAlerts([...spikeAlerts, ...orderAlerts]);
      } finally {
        if (!cancelled) setExtraLoading(false);
      }
    };

    void run();
    return () => {
      cancelled = true;
    };
  }, [key]);

  const alerts = useMemo(() => {
    const fromSummary: LocationAlert[] = [];
    const locationsSource = useExternalSummary ? summaryData! : internalSummary.locations;
    const summaryReady = useExternalSummary
      ? true
      : !internalSummary.loading && !internalSummary.error;
    if (summaryReady) {
      for (const loc of locationsSource) {
        if (loc.count_overdue && loc.last_count_date) {
          const hrs = (Date.now() - new Date(loc.last_count_date).getTime()) / (1000 * 60 * 60);
          const thr = loc.count_overdue_hrs ?? 72;
          const severity: AlertSeverity = hrs > 2 * thr ? "critical" : "warning";
          fromSummary.push({
            id: `count_overdue-${loc.location_id}`,
            severity,
            location_id: loc.location_id,
            location_name: loc.location_name,
            restaurant_name: loc.restaurant_name,
            brand: loc.brand,
            type: "count_overdue",
            title: `${loc.location_name} count overdue`,
            description: `Last count ${Math.round(hrs)} hours ago. Due every ${thr} hours.`,
            created_at: loc.last_count_date,
            action_url: "/app/inventory/enter",
          });
        }
        if (loc.food_cost_status === "critical") {
          const pct = loc.food_cost_pct;
          const tgt = loc.food_cost_target_pct;
          const above = pct != null ? Math.round((pct - tgt) * 10) / 10 : null;
          const desc =
            pct != null
              ? above != null && above > 0
                ? `Est. ${pct.toFixed(1)}% vs ${tgt.toFixed(1)}% target. ${above.toFixed(1)}% above target.`
                : `Est. ${pct.toFixed(1)}% vs ${tgt.toFixed(1)}% target.`
              : `Food cost vs ${tgt.toFixed(1)}% target is critical (incomplete data).`;
          fromSummary.push({
            id: `food_cost_critical-${loc.location_id}`,
            severity: "critical",
            location_id: loc.location_id,
            location_name: loc.location_name,
            restaurant_name: loc.restaurant_name,
            brand: loc.brand,
            type: "food_cost_critical",
            title: `${loc.location_name} food cost critical`,
            description: desc,
            created_at: new Date().toISOString(),
            action_url: "/app/dashboard",
          });
        } else if (loc.food_cost_status === "warning") {
          const pct = loc.food_cost_pct;
          const tgt = loc.food_cost_target_pct;
          fromSummary.push({
            id: `food_cost_warning-${loc.location_id}`,
            severity: "warning",
            location_id: loc.location_id,
            location_name: loc.location_name,
            restaurant_name: loc.restaurant_name,
            brand: loc.brand,
            type: "food_cost_warning",
            title: `${loc.location_name} food cost above target`,
            description:
              pct != null ? `Est. ${pct.toFixed(1)}% vs ${tgt.toFixed(1)}% target.` : `Food cost above ${tgt.toFixed(1)}% target.`,
            created_at: new Date().toISOString(),
            action_url: "/app/dashboard",
          });
        }
      }
    }
    const merged = [...fromSummary, ...extraAlerts];
    merged.sort(sortAlerts);
    return merged;
  }, [
    useExternalSummary,
    summaryData,
    internalSummary.loading,
    internalSummary.error,
    internalSummary.locations,
    extraAlerts,
  ]);

  const criticalCount = useMemo(() => alerts.filter((a) => a.severity === "critical").length, [alerts]);
  const warningCount = useMemo(() => alerts.filter((a) => a.severity === "warning").length, [alerts]);
  const loading = useExternalSummary ? extraLoading : internalSummary.loading || extraLoading;

  return { alerts, criticalCount, warningCount, loading };
}
