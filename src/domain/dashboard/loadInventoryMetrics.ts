import { supabase } from "@/integrations/supabase/client";
import { riskThresholdsFromSettings } from "@/domain/inventory/riskThresholds";
import {
  buildInventoryTrendData,
  buildLatestInventorySnapshot,
  buildTopSessionItemsByValue,
} from "@/domain/dashboard/dashboardSelectors";
import { computePARRecommendations, computeUsageAnalytics } from "@/lib/usage-analytics";
import type { ComputedUsageItem, PARRecommendation } from "@/lib/usage-analytics";
import type {
  DashboardStockStatus,
  DashboardTrendPoint,
  InventorySessionItemRow,
  InventorySessionRow,
  InventoryTrendSessionRow,
  KPISnapshot,
  SmartOrderSettingsRow,
  TopReorderItem,
  TopSessionItemByValue,
} from "@/domain/dashboard/dashboardTypes";
import type { ReorderSummary } from "@/domain/inventory/reorderEngine";

export type InventoryMetricsResult = {
  stockStatus: DashboardStockStatus;
  topReorder: TopReorderItem[];
  reorderSummary: ReorderSummary | null;
  highUsage: ComputedUsageItem[];
  recommendations: PARRecommendation[];
  inventoryValue: number;
  missingCostCount: number;
  trendData: DashboardTrendPoint[];
  overstockValue: number;
  lastSessionDate: Date | null;
  lastSessionName: string | null;
  missingParCount: number;
  latestSessionUnitCostByCatalogId: Record<string, number>;
  /** Priced lines ranked by stock dollar value — same ordering as Dashboard snapshot math. */
  topItemsByValue: TopSessionItemByValue[];
  /** Raw `approved_at` from the latest APPROVED session row (Reports messaging). */
  lastSessionApprovedAtIso: string | null;
};

export const EMPTY_INVENTORY_RESULT: InventoryMetricsResult = {
  stockStatus: { red: 0, yellow: 0, green: 0 },
  topReorder: [],
  reorderSummary: null,
  highUsage: [],
  recommendations: [],
  inventoryValue: 0,
  missingCostCount: 0,
  trendData: [],
  overstockValue: 0,
  lastSessionDate: null,
  lastSessionName: null,
  missingParCount: 0,
  latestSessionUnitCostByCatalogId: {},
  topItemsByValue: [],
  lastSessionApprovedAtIso: null,
};

// Satisfies KPISnapshot field subset — checked at compile time
const _typeCheck: Pick<
  KPISnapshot,
  | "stockStatus"
  | "topReorder"
  | "reorderSummary"
  | "highUsage"
  | "recommendations"
  | "inventoryValue"
  | "missingCostCount"
  | "trendData"
  | "overstockValue"
  | "lastSessionDate"
  | "lastSessionName"
  | "missingParCount"
> = EMPTY_INVENTORY_RESULT;
void _typeCheck;

export async function loadInventoryMetrics(
  restaurantId: string,
  locationId?: string,
): Promise<InventoryMetricsResult> {
  let sessionQuery = supabase
    .from("inventory_sessions")
    .select("id, approved_at, name")
    .eq("restaurant_id", restaurantId)
    .eq("status", "APPROVED")
    .order("approved_at", { ascending: false })
    .limit(1);
  if (locationId) sessionQuery = sessionQuery.eq("location_id", locationId);

  const [sessionsResult, riskSettingsResult] = await Promise.all([
    sessionQuery as unknown as Promise<{ data: InventorySessionRow[] | null }>,
    supabase
      .from("smart_order_settings")
      .select("red_threshold, yellow_threshold")
      .eq("restaurant_id", restaurantId)
      .maybeSingle() as unknown as Promise<{ data: SmartOrderSettingsRow | null }>,
  ]);

  const sessions = sessionsResult.data;
  const riskThresholds = riskThresholdsFromSettings(riskSettingsResult.data);

  let latestSessionUnitCostByCatalogId: Record<string, number> = {};
  let stockStatus: DashboardStockStatus = { red: 0, yellow: 0, green: 0 };
  let topReorder: TopReorderItem[] = [];
  let reorderSummary: ReorderSummary | null = null;
  let inventoryValue = 0;
  let missingCostCount = 0;
  let overstockValue = 0;
  let lastSessionDate: Date | null = null;
  let lastSessionName: string | null = null;
  let missingParCount = 0;
  let topItemsByValue: TopSessionItemByValue[] = [];
  let lastSessionApprovedAtIso: string | null = null;

  if (sessions && sessions.length > 0) {
    lastSessionApprovedAtIso = sessions[0].approved_at ?? null;
    if (sessions[0].approved_at) lastSessionDate = new Date(sessions[0].approved_at);
    if (sessions[0].name) lastSessionName = sessions[0].name;

    const { data: items } = (await supabase
      .from("inventory_session_items")
      .select("*")
      .eq("session_id", sessions[0].id)) as unknown as { data: InventorySessionItemRow[] | null };

    if (items) {
      const snapshot = buildLatestInventorySnapshot(items, riskThresholds);
      latestSessionUnitCostByCatalogId = snapshot.latestSessionUnitCostByCatalogId;
      stockStatus = snapshot.stockStatus;
      topReorder = snapshot.topReorder;
      reorderSummary = snapshot.reorderSummary;
      inventoryValue = snapshot.inventoryValue;
      missingCostCount = snapshot.missingCostCount;
      overstockValue = snapshot.overstockValue;
      missingParCount = snapshot.missingParCount;
      topItemsByValue = buildTopSessionItemsByValue(items);
    }
  }

  let trendQuery = supabase
    .from("inventory_sessions")
    .select("id, approved_at")
    .eq("restaurant_id", restaurantId)
    .eq("status", "APPROVED")
    .order("approved_at", { ascending: false })
    .limit(8);
  if (locationId) trendQuery = trendQuery.eq("location_id", locationId);

  const { data: trendSessions } = (await trendQuery) as unknown as {
    data: InventoryTrendSessionRow[] | null;
  };

  let trendData: DashboardTrendPoint[] = [];
  if (trendSessions && trendSessions.length > 0) {
    const sessionIds = trendSessions.map((s) => s.id);
    const { data: trendLines } = (await supabase
      .from("inventory_session_items")
      .select("session_id, current_stock, unit_cost")
      .in("session_id", sessionIds)) as unknown as {
      data: { session_id: string; current_stock: number | null; unit_cost: number | null }[] | null;
    };

    const trendLinesBySessionId = new Map<
      string,
      { current_stock: number | null; unit_cost: number | null }[]
    >();
    for (const row of trendLines ?? []) {
      if (!row.session_id) continue;
      if (!trendLinesBySessionId.has(row.session_id)) trendLinesBySessionId.set(row.session_id, []);
      trendLinesBySessionId.get(row.session_id)?.push(row);
    }
    trendData = buildInventoryTrendData(trendSessions, trendLinesBySessionId);
  }

  const [highUsage, recommendations] = await Promise.all([
    computeUsageAnalytics(restaurantId, locationId),
    computePARRecommendations(restaurantId, locationId),
  ]);

  return {
    stockStatus,
    topReorder,
    reorderSummary,
    highUsage,
    recommendations,
    inventoryValue,
    missingCostCount,
    trendData,
    overstockValue,
    lastSessionDate,
    lastSessionName,
    missingParCount,
    latestSessionUnitCostByCatalogId,
    topItemsByValue,
    lastSessionApprovedAtIso,
  };
}
