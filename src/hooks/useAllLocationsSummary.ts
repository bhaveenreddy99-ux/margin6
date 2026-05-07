import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { subDays } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import { useRestaurant } from "@/contexts/RestaurantContext";
import { resolvePurchaseHistoryBusinessDate } from "@/lib/purchase-history-source";
import { buildSessionStats } from "@/domain/inventory/items/itemView";
import { catalogIdFromSessionItem } from "@/domain/inventory/sessionItemCatalogLink";
import type { InventorySessionItemRow } from "@/domain/inventory/enterInventoryTypes";
import { sumWasteDollarsByLocation, type WasteRollupRow } from "@/domain/waste/wasteMetricsAggregate";
import { fetchInvoiceDocumentIdsForRestaurant } from "@/lib/procurement-dedupe";
import type { SupabaseClient } from "@supabase/supabase-js";

export type DateRange = "7d" | "30d" | "90d";

export interface LocationSummary {
  location_id: string;
  location_name: string;
  restaurant_id: string;
  restaurant_name: string;
  brand: string | null;
  food_cost_pct: number | null;
  food_cost_target_pct: number;
  food_cost_status: "good" | "warning" | "critical";
  food_cost_trend: number | null;
  last_count_date: string | null;
  count_overdue: boolean;
  count_overdue_hrs: number | null;
  counts_this_period: number;
  counts_expected_this_period: number;
  inventory_value: number | null;
  waste_this_week: number | null;
  waste_in_period: number;
  pending_orders: number;
  smart_order_ready: boolean;
}

export interface AllLocationsSummary {
  locations: LocationSummary[];
  total_locations: number;
  avg_food_cost_pct: number | null;
  total_inventory_value: number;
  total_waste_this_week: number;
  total_waste_in_period: number;
  total_pending_orders: number;
  loading: boolean;
  error: string | null;
  refetch: () => void;
}

export type DashboardMode = "restaurant" | "all_brands";

export function getFoodCostStatus(
  actual: number | null,
  target: number,
  lastCountDate: string | null,
): "good" | "warning" | "critical" {
  if (actual == null || !lastCountDate) return "critical";
  const daysSinceCount = (Date.now() - new Date(lastCountDate).getTime()) / (1000 * 60 * 60 * 24);
  if (daysSinceCount > 7) return "critical";
  const diff = actual - target;
  if (diff <= 1) return "good";
  if (diff <= 3) return "warning";
  return "critical";
}

function daysForRange(r: DateRange): number {
  return r === "7d" ? 7 : r === "90d" ? 90 : 30;
}

type LocRow = {
  id: string;
  name: string;
  restaurant_id: string;
  is_active: boolean;
  restaurants: { name: string } | null;
};

async function fetchCatalogDefaultCostByRestaurantForWaste(
  client: SupabaseClient,
  rows: WasteRollupRow[],
): Promise<Map<string, Map<string, number>>> {
  const idsByRestaurant = new Map<string, Set<string>>();
  for (const w of rows) {
    if (!w.catalog_item_id) continue;
    if (!idsByRestaurant.has(w.restaurant_id)) idsByRestaurant.set(w.restaurant_id, new Set());
    idsByRestaurant.get(w.restaurant_id)!.add(w.catalog_item_id);
  }
  const out = new Map<string, Map<string, number>>();
  await Promise.all(
    [...idsByRestaurant.entries()].map(async ([rid, idSet]) => {
      const ids = [...idSet];
      if (ids.length === 0) return;
      const { data, error } = await client
        .from("inventory_catalog_items")
        .select("id, default_unit_cost")
        .eq("restaurant_id", rid)
        .in("id", ids);
      if (error) throw error;
      const m = new Map<string, number>();
      for (const row of data ?? []) {
        const v = Number(row.default_unit_cost);
        if (Number.isFinite(v) && v >= 0) m.set(row.id as string, v);
      }
      out.set(rid, m);
    }),
  );
  return out;
}

type SettingsRow = {
  food_cost_target_pct: number;
  count_overdue_alert_hrs: number;
  count_frequency_days: number;
  brand: string | null;
};

export function useAllLocationsSummary(
  mode: DashboardMode,
  dateRange: DateRange = "30d",
  /** When true, skip network fetch (caller supplies summary elsewhere). Does not change fetch/calculation logic. */
  suppressFetch = false,
): AllLocationsSummary {
  const { currentRestaurant, activeRestaurantIds } = useRestaurant();
  const [locations, setLocations] = useState<LocationSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const cancelledRef = useRef(false);

  const restaurantIds = useMemo(() => {
    if (mode === "restaurant") {
      return currentRestaurant?.id ? [currentRestaurant.id] : [];
    }
    return activeRestaurantIds.length > 0 ? activeRestaurantIds : [];
  }, [mode, currentRestaurant?.id, activeRestaurantIds]);

  const refetch = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    cancelledRef.current = false;
    if (suppressFetch) {
      setLocations([]);
      setLoading(false);
      setError(null);
      return;
    }
    if (restaurantIds.length === 0) {
      setLocations([]);
      setLoading(false);
      setError(null);
      return;
    }

    const daysBack = daysForRange(dateRange);
    const periodEnd = new Date();
    const periodStart = subDays(periodEnd, daysBack);
    const prevPeriodEnd = periodStart;
    const prevPeriodStart = subDays(periodStart, daysBack);

    const inWindow = (
      row: { invoice_date?: string | null; created_at?: string | null },
      start: Date,
      end: Date,
    ) => {
      const businessDate = resolvePurchaseHistoryBusinessDate(row);
      return businessDate > start && businessDate <= end;
    };

    const run = async () => {
      setLoading(true);
      setError(null);
      try {
        const { data: locRows, error: locErr } = await supabase
          .from("locations")
          .select("id, name, restaurant_id, is_active, restaurants(name)")
          .in("restaurant_id", restaurantIds)
          .eq("is_active", true)
          .order("name");

        if (locErr) throw locErr;
        const rows = (locRows ?? []) as unknown as LocRow[];
        const locIds = rows.map((r) => r.id);
        if (locIds.length === 0) {
          if (!cancelledRef.current) {
            setLocations([]);
            setLoading(false);
          }
          return;
        }

        const weekAgo = subDays(new Date(), 7).toISOString();
        const wastePeriodStart = periodStart.toISOString();

        const [
          settingsResult,
          sessionsResult,
          wasteWeekResult,
          wastePeriodResult,
          runsResult,
          countSessionsResult,
        ] = await Promise.all([
          supabase.from("location_settings").select("*").in("location_id", locIds),
          supabase
            .from("inventory_sessions")
            .select("id, restaurant_id, location_id, approved_at")
            .in("restaurant_id", restaurantIds)
            .in("location_id", locIds)
            .eq("status", "APPROVED")
            .order("approved_at", { ascending: false, nullsFirst: false }),
          supabase
            .from("waste_log")
            .select(
              "location_id, restaurant_id, quantity, quantity_unit, catalog_item_id, unit_cost, total_cost, item_name",
            )
            .in("location_id", locIds)
            .gte("logged_at", weekAgo),
          supabase
            .from("waste_log")
            .select(
              "location_id, restaurant_id, quantity, quantity_unit, catalog_item_id, unit_cost, total_cost, item_name",
            )
            .in("location_id", locIds)
            .gte("logged_at", wastePeriodStart),
          supabase.from("smart_order_runs").select("location_id").in("location_id", locIds).eq("status", "draft"),
          supabase
            .from("inventory_sessions")
            .select("location_id, approved_at")
            .in("restaurant_id", restaurantIds)
            .in("location_id", locIds)
            .eq("status", "APPROVED")
            .gte("approved_at", periodStart.toISOString())
            .lte("approved_at", periodEnd.toISOString()),
        ]);

        if (settingsResult.error) throw settingsResult.error;
        if (sessionsResult.error) throw sessionsResult.error;
        if (wasteWeekResult.error) throw wasteWeekResult.error;
        if (wastePeriodResult.error) throw wastePeriodResult.error;
        if (runsResult.error) throw runsResult.error;
        if (countSessionsResult.error) throw countSessionsResult.error;

        const settingsByLoc = new Map<string, SettingsRow>();
        for (const s of settingsResult.data ?? []) {
          const lid = (s as { location_id: string }).location_id;
          settingsByLoc.set(lid, {
            food_cost_target_pct: Number((s as { food_cost_target_pct?: number }).food_cost_target_pct ?? 30),
            count_overdue_alert_hrs: Number((s as { count_overdue_alert_hrs?: number }).count_overdue_alert_hrs ?? 72),
            count_frequency_days: Math.max(
              1,
              Number((s as { count_frequency_days?: number }).count_frequency_days ?? 3),
            ),
            brand: (s as { brand?: string | null }).brand ?? null,
          });
        }

        const countsThisPeriodByLoc = new Map<string, number>();
        for (const s of countSessionsResult.data ?? []) {
          const lid = s.location_id as string | null;
          if (!lid) continue;
          countsThisPeriodByLoc.set(lid, (countsThisPeriodByLoc.get(lid) ?? 0) + 1);
        }

        const latestSessionByLoc = new Map<string, { id: string; approved_at: string | null }>();
        for (const s of sessionsResult.data ?? []) {
          const lid = s.location_id as string | null;
          if (!lid) continue;
          if (!latestSessionByLoc.has(lid)) {
            latestSessionByLoc.set(lid, { id: s.id, approved_at: s.approved_at ?? null });
          }
        }

        const sessionIds = [...new Set([...latestSessionByLoc.values()].map((v) => v.id))];
        type SessionItemForStats = Pick<
          InventorySessionItemRow,
          "session_id" | "current_stock" | "unit_cost" | "catalog_item_id" | "metadata"
        >;
        const itemsBySession = new Map<string, SessionItemForStats[]>();
        const weekRows = (wasteWeekResult.data ?? []) as unknown as WasteRollupRow[];
        const periodRows = (wastePeriodResult.data ?? []) as unknown as WasteRollupRow[];

        if (sessionIds.length > 0) {
          const { data: itemRows, error: itemErr } = await supabase
            .from("inventory_session_items")
            .select("session_id, current_stock, unit_cost, catalog_item_id, metadata")
            .in("session_id", sessionIds);
          if (itemErr) throw itemErr;
          type SessionItemRowDb = {
            session_id: string;
            current_stock: number | null;
            unit_cost: number | null;
            catalog_item_id: string | null;
            metadata: InventorySessionItemRow["metadata"];
          };
          for (const row of (itemRows ?? []) as unknown as SessionItemRowDb[]) {
            const sid = row.session_id;
            if (!itemsBySession.has(sid)) itemsBySession.set(sid, []);
            itemsBySession.get(sid)!.push({
              session_id: sid,
              current_stock: row.current_stock,
              unit_cost: row.unit_cost,
              catalog_item_id: row.catalog_item_id ?? undefined,
              metadata: row.metadata,
            });
          }
        }

        const catalogDefaultByRestaurant = await fetchCatalogDefaultCostByRestaurantForWaste(supabase, [
          ...weekRows,
          ...periodRows,
        ]);

        const sessionUnitByLocation = new Map<string, Map<string, number>>();
        for (const [lid, sess] of latestSessionByLoc) {
          const items = itemsBySession.get(sess.id) ?? [];
          const unitByCat = new Map<string, number>();
          for (const item of items) {
            const cid = catalogIdFromSessionItem(item);
            if (!cid) continue;
            const uc = Number(item.unit_cost);
            if (!Number.isFinite(uc) || uc < 0) continue;
            if (unitByCat.has(cid)) continue;
            unitByCat.set(cid, uc);
          }
          sessionUnitByLocation.set(lid, unitByCat);
        }

        const inventoryValueByLoc = new Map<string, number>();
        for (const [lid, sess] of latestSessionByLoc) {
          const items = itemsBySession.get(sess.id) ?? [];
          const stats = buildSessionStats(items);
          const st = stats[sess.id];
          inventoryValueByLoc.set(lid, st?.totalValue ?? 0);
        }

        const wasteWeekByLoc = sumWasteDollarsByLocation(
          weekRows,
          catalogDefaultByRestaurant,
          sessionUnitByLocation,
        );
        const wastePeriodByLoc = sumWasteDollarsByLocation(
          periodRows,
          catalogDefaultByRestaurant,
          sessionUnitByLocation,
        );

        const pendingByLoc = new Map<string, number>();
        for (const r of runsResult.data ?? []) {
          const lid = r.location_id as string | null;
          if (!lid) continue;
          pendingByLoc.set(lid, (pendingByLoc.get(lid) ?? 0) + 1);
        }

        const spendCurrentByLoc = new Map<string, number>();
        const spendPrevByLoc = new Map<string, number>();
        const docIdsByRestaurant = new Map<string, Set<string>>();
        await Promise.all(
          restaurantIds.map(async (rid) => {
            const ids = await fetchInvoiceDocumentIdsForRestaurant(rid);
            docIdsByRestaurant.set(rid, ids);
          }),
        );

        const addSpend = (
          target: Map<string, number>,
          lid: string,
          c: number,
        ) => {
          target.set(lid, (target.get(lid) ?? 0) + c);
        };

        await Promise.all(
          restaurantIds.map(async (rid) => {
            const invQ = supabase
              .from("invoices")
              .select("id, location_id, invoice_date, created_at")
              .eq("restaurant_id", rid)
              .eq("status", "confirmed")
              .in("location_id", locIds);
            const { data: invSpendRows } = await invQ;
            const rowsInv = invSpendRows ?? [];

            const inCurrent = rowsInv.filter((row) => inWindow(row, periodStart, periodEnd));
            const inPrev = rowsInv.filter((row) => inWindow(row, prevPeriodStart, prevPeriodEnd));

            const collectCosts = async (invoiceRows: typeof rowsInv) => {
              const ids = invoiceRows.map((r) => r.id as string);
              const costByInv: Record<string, number> = {};
              if (ids.length > 0) {
                const { data: lineCosts } = await supabase
                  .from("invoice_items")
                  .select("invoice_id, total_cost")
                  .in("invoice_id", ids);
                for (const row of lineCosts ?? []) {
                  const iid = row.invoice_id as string;
                  costByInv[iid] = (costByInv[iid] || 0) + Number(row.total_cost || 0);
                }
              }
              return costByInv;
            };

            const costCurrent = await collectCosts(inCurrent);
            for (const row of inCurrent) {
              const lid = row.location_id as string | null;
              if (!lid) continue;
              addSpend(spendCurrentByLoc, lid, costCurrent[row.id as string] || 0);
            }

            const costPrev = await collectCosts(inPrev);
            for (const row of inPrev) {
              const lid = row.location_id as string | null;
              if (!lid) continue;
              addSpend(spendPrevByLoc, lid, costPrev[row.id as string] || 0);
            }

            let phQ = supabase
              .from("purchase_history")
              .select("id, location_id, created_at, invoice_date")
              .eq("restaurant_id", rid)
              .in("invoice_status", ["COMPLETE", "POSTED"])
              .in("location_id", locIds);
            const { data: phRows } = await phQ;
            const docIds = docIdsByRestaurant.get(rid) ?? new Set();
            const phAll = (phRows ?? []).filter((row) => !docIds.has(row.id as string));
            const phCurrent = phAll.filter((row) => inWindow(row, periodStart, periodEnd));
            const phPrev = phAll.filter((row) => inWindow(row, prevPeriodStart, prevPeriodEnd));

            const collectPhCosts = async (phList: typeof phAll) => {
              const ids = phList.map((r) => r.id as string);
              const costByPh: Record<string, number> = {};
              if (ids.length > 0) {
                const { data: phCosts } = await supabase
                  .from("purchase_history_items")
                  .select("purchase_history_id, total_cost")
                  .in("purchase_history_id", ids);
                for (const row of phCosts ?? []) {
                  const pid = row.purchase_history_id as string;
                  costByPh[pid] = (costByPh[pid] || 0) + Number(row.total_cost || 0);
                }
              }
              return costByPh;
            };

            const phCostCurrent = await collectPhCosts(phCurrent);
            for (const row of phCurrent) {
              const lid = row.location_id as string | null;
              if (!lid) continue;
              addSpend(spendCurrentByLoc, lid, phCostCurrent[row.id as string] || 0);
            }

            const phCostPrev = await collectPhCosts(phPrev);
            for (const row of phPrev) {
              const lid = row.location_id as string | null;
              if (!lid) continue;
              addSpend(spendPrevByLoc, lid, phCostPrev[row.id as string] || 0);
            }
          }),
        );

        const pctFromSpendInv = (spend: number, invVal: number | null): number | null => {
          if (invVal == null || invVal <= 0 || spend <= 0) return null;
          const p = Math.round((spend / invVal) * 1000) / 10;
          if (!Number.isFinite(p) || p < 0) return null;
          return p > 999 ? 999 : p;
        };

        const summaries: LocationSummary[] = rows.map((row) => {
          const lid = row.id;
          const st = settingsByLoc.get(lid);
          const targetPct = st?.food_cost_target_pct ?? 30;
          const alertHrs = st?.count_overdue_alert_hrs ?? 72;
          const freqDays = st?.count_frequency_days ?? 3;
          const sess = latestSessionByLoc.get(lid);
          const lastCount = sess?.approved_at ?? null;
          const invVal = inventoryValueByLoc.get(lid) ?? null;
          const spendCurr = spendCurrentByLoc.get(lid) ?? 0;
          const spendPr = spendPrevByLoc.get(lid) ?? 0;
          let foodCostPct = pctFromSpendInv(spendCurr, invVal);
          const prevPct = pctFromSpendInv(spendPr, invVal);
          let foodCostTrend: number | null = null;
          if (foodCostPct != null && prevPct != null) {
            foodCostTrend = Math.round((foodCostPct - prevPct) * 10) / 10;
          }
          let hoursSince: number | null = null;
          if (lastCount) {
            hoursSince = (Date.now() - new Date(lastCount).getTime()) / (1000 * 60 * 60);
          }
          const countOverdue = hoursSince != null && hoursSince > alertHrs;
          const status = getFoodCostStatus(foodCostPct, targetPct, lastCount);
          const pending = pendingByLoc.get(lid) ?? 0;
          const wasteW = wasteWeekByLoc.get(lid) ?? 0;
          const wasteP = wastePeriodByLoc.get(lid) ?? 0;
          const countsThis = countsThisPeriodByLoc.get(lid) ?? 0;
          const countsExpected = Math.ceil(daysBack / freqDays);

          return {
            location_id: lid,
            location_name: row.name,
            restaurant_id: row.restaurant_id,
            restaurant_name: row.restaurants?.name ?? "",
            brand: st?.brand ?? null,
            food_cost_pct: foodCostPct,
            food_cost_target_pct: targetPct,
            food_cost_status: status,
            food_cost_trend: foodCostTrend,
            last_count_date: lastCount,
            count_overdue: countOverdue,
            count_overdue_hrs: alertHrs,
            counts_this_period: countsThis,
            counts_expected_this_period: countsExpected,
            inventory_value: invVal,
            waste_this_week: wasteW,
            waste_in_period: wasteP,
            pending_orders: pending,
            smart_order_ready: pending > 0,
          };
        });

        if (!cancelledRef.current) {
          setLocations(summaries);
          setError(null);
        }
      } catch (e) {
        if (!cancelledRef.current) {
          setError(e instanceof Error ? e.message : "Failed to load locations");
          setLocations([]);
        }
      } finally {
        if (!cancelledRef.current) setLoading(false);
      }
    };

    void run();
    return () => {
      cancelledRef.current = true;
    };
  }, [mode, restaurantIds.join(","), tick, currentRestaurant?.id, activeRestaurantIds.join(","), dateRange, suppressFetch]);

  const totals = useMemo(() => {
    const n = locations.length;
    const withFc = locations.map((l) => l.food_cost_pct).filter((x): x is number => x != null);
    const avgFc = withFc.length > 0 ? withFc.reduce((a, b) => a + b, 0) / withFc.length : null;
    const totalInv = locations.reduce((s, l) => s + (l.inventory_value ?? 0), 0);
    const totalWasteWeek = locations.reduce((s, l) => s + (l.waste_this_week ?? 0), 0);
    const totalWastePeriod = locations.reduce((s, l) => s + l.waste_in_period, 0);
    const totalPending = locations.reduce((s, l) => s + l.pending_orders, 0);
    return {
      total_locations: n,
      avg_food_cost_pct: avgFc,
      total_inventory_value: totalInv,
      total_waste_this_week: totalWasteWeek,
      total_waste_in_period: totalWastePeriod,
      total_pending_orders: totalPending,
    };
  }, [locations]);

  return {
    locations,
    ...totals,
    loading,
    error,
    refetch,
  };
}
