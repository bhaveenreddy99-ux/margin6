/**
 * Computed usage analytics from approved inventory sessions + invoices.
 * Formula: usage = beginning_stock + purchases_between - ending_stock
 */
import { supabase } from "@/integrations/supabase/client";
import { catalogIdFromSessionItem } from "@/domain/inventory/sessionItemCatalogLink";
import { buildCatalogIdentityKey, normalizeItemName } from "@/lib/catalog-identity";
import { isPurchaseHistoryInBusinessWindow } from "@/lib/purchase-history-source";
import { fetchInvoiceDocumentIdsForRestaurant } from "@/lib/procurement-dedupe";

type ApprovedSession = {
  id: string;
  approved_at: string;
  inventory_list_id?: string | null;
  location_id?: string | null;
};

type UsageAnalyticsOptions = {
  locationId?: string | null;
  inventoryListId?: string | null;
};

type ParGuideOverride = {
  display_name: string;
  par_level: number;
  category: string | null;
  unit: string | null;
};

export interface ComputedUsageItem {
  catalog_item_id: string | null;
  item_name: string;
  beginning_stock: number;
  ending_stock: number;
  purchases_between: number;
  usage_raw: number;
  weekly_usage: number;
  days_between: number;
}

export type PARRecommendationType = "increase" | "decrease" | "usage_trend" | "missing_par";

export interface PARRecommendation {
  catalog_item_id: string | null;
  item_name: string;
  current_par: number;
  suggested_par: number;
  change_pct: number;
  reason: string;
  type: PARRecommendationType;
}

export interface DetailedPARRecommendation extends PARRecommendation {
  category: string | null;
  unit: string | null;
  change_amount: number;
  confidence: "high" | "medium" | "low";
  is_fluctuating: boolean;
  risk_type: "stockout" | "overstock" | "adjustment" | "missing_par";
  data_points: number;
  weekly_usages: number[];
}

export interface PARRecommendationOptions extends UsageAnalyticsOptions {
  parGuideId?: string | null;
  leadTimeDays?: number | null;
  useParGuideOverrides?: boolean;
}

type UnitDimension = "weight" | "volume" | "count";

type UnitDefinition = {
  canonical: string;
  dimension: UnitDimension;
  toBaseFactor: number;
};

const UNIT_DEFINITIONS: Record<string, UnitDefinition> = {
  lb: { canonical: "lb", dimension: "weight", toBaseFactor: 453.59237 },
  lbs: { canonical: "lb", dimension: "weight", toBaseFactor: 453.59237 },
  pound: { canonical: "lb", dimension: "weight", toBaseFactor: 453.59237 },
  pounds: { canonical: "lb", dimension: "weight", toBaseFactor: 453.59237 },
  "#": { canonical: "lb", dimension: "weight", toBaseFactor: 453.59237 },
  oz: { canonical: "oz", dimension: "weight", toBaseFactor: 28.349523125 },
  ounce: { canonical: "oz", dimension: "weight", toBaseFactor: 28.349523125 },
  ounces: { canonical: "oz", dimension: "weight", toBaseFactor: 28.349523125 },
  kg: { canonical: "kg", dimension: "weight", toBaseFactor: 1000 },
  kilogram: { canonical: "kg", dimension: "weight", toBaseFactor: 1000 },
  kilograms: { canonical: "kg", dimension: "weight", toBaseFactor: 1000 },
  g: { canonical: "g", dimension: "weight", toBaseFactor: 1 },
  gram: { canonical: "g", dimension: "weight", toBaseFactor: 1 },
  grams: { canonical: "g", dimension: "weight", toBaseFactor: 1 },
  gal: { canonical: "gal", dimension: "volume", toBaseFactor: 3785.411784 },
  gallon: { canonical: "gal", dimension: "volume", toBaseFactor: 3785.411784 },
  gallons: { canonical: "gal", dimension: "volume", toBaseFactor: 3785.411784 },
  qt: { canonical: "qt", dimension: "volume", toBaseFactor: 946.352946 },
  quart: { canonical: "qt", dimension: "volume", toBaseFactor: 946.352946 },
  quarts: { canonical: "qt", dimension: "volume", toBaseFactor: 946.352946 },
  pt: { canonical: "pt", dimension: "volume", toBaseFactor: 473.176473 },
  pint: { canonical: "pt", dimension: "volume", toBaseFactor: 473.176473 },
  pints: { canonical: "pt", dimension: "volume", toBaseFactor: 473.176473 },
  l: { canonical: "l", dimension: "volume", toBaseFactor: 1000 },
  liter: { canonical: "l", dimension: "volume", toBaseFactor: 1000 },
  liters: { canonical: "l", dimension: "volume", toBaseFactor: 1000 },
  litre: { canonical: "l", dimension: "volume", toBaseFactor: 1000 },
  litres: { canonical: "l", dimension: "volume", toBaseFactor: 1000 },
  ml: { canonical: "ml", dimension: "volume", toBaseFactor: 1 },
  floz: { canonical: "floz", dimension: "volume", toBaseFactor: 29.5735295625 },
  milliliter: { canonical: "ml", dimension: "volume", toBaseFactor: 1 },
  milliliters: { canonical: "ml", dimension: "volume", toBaseFactor: 1 },
  millilitre: { canonical: "ml", dimension: "volume", toBaseFactor: 1 },
  millilitres: { canonical: "ml", dimension: "volume", toBaseFactor: 1 },
  ea: { canonical: "ea", dimension: "count", toBaseFactor: 1 },
  each: { canonical: "ea", dimension: "count", toBaseFactor: 1 },
  eaches: { canonical: "ea", dimension: "count", toBaseFactor: 1 },
  ct: { canonical: "ct", dimension: "count", toBaseFactor: 1 },
  count: { canonical: "ct", dimension: "count", toBaseFactor: 1 },
  counts: { canonical: "ct", dimension: "count", toBaseFactor: 1 },
  pc: { canonical: "ea", dimension: "count", toBaseFactor: 1 },
  pcs: { canonical: "ea", dimension: "count", toBaseFactor: 1 },
  piece: { canonical: "ea", dimension: "count", toBaseFactor: 1 },
  pieces: { canonical: "ea", dimension: "count", toBaseFactor: 1 },
  unit: { canonical: "ea", dimension: "count", toBaseFactor: 1 },
  units: { canonical: "ea", dimension: "count", toBaseFactor: 1 },
  can: { canonical: "ea", dimension: "count", toBaseFactor: 1 },
  cans: { canonical: "ea", dimension: "count", toBaseFactor: 1 },
  bag: { canonical: "ea", dimension: "count", toBaseFactor: 1 },
  bags: { canonical: "ea", dimension: "count", toBaseFactor: 1 },
  bottle: { canonical: "ea", dimension: "count", toBaseFactor: 1 },
  bottles: { canonical: "ea", dimension: "count", toBaseFactor: 1 },
  box: { canonical: "ea", dimension: "count", toBaseFactor: 1 },
  boxes: { canonical: "ea", dimension: "count", toBaseFactor: 1 },
  jar: { canonical: "ea", dimension: "count", toBaseFactor: 1 },
  jars: { canonical: "ea", dimension: "count", toBaseFactor: 1 },
  pack: { canonical: "ea", dimension: "count", toBaseFactor: 1 },
  packs: { canonical: "ea", dimension: "count", toBaseFactor: 1 },
  sleeve: { canonical: "ea", dimension: "count", toBaseFactor: 1 },
  sleeves: { canonical: "ea", dimension: "count", toBaseFactor: 1 },
  tray: { canonical: "ea", dimension: "count", toBaseFactor: 1 },
  trays: { canonical: "ea", dimension: "count", toBaseFactor: 1 },
  tub: { canonical: "ea", dimension: "count", toBaseFactor: 1 },
  tubs: { canonical: "ea", dimension: "count", toBaseFactor: 1 },
};

function normalizePackSizeText(value: string | null | undefined): string {
  return (value ?? "")
    .toLowerCase()
    .replace(/fluid\s*ounces?/g, " floz ")
    .replace(/fl\.?\s*oz/g, " floz ")
    .replace(/[×]/g, "x")
    .replace(/\s+/g, " ")
    .trim();
}

function getUnitDefinition(value: string | null | undefined): UnitDefinition | null {
  if (!value) return null;
  return UNIT_DEFINITIONS[value.trim().toLowerCase()] ?? null;
}

function convertBetweenUnits(amount: number, fromUnit: UnitDefinition, toUnit: UnitDefinition): number | null {
  if (!Number.isFinite(amount) || amount <= 0) return null;
  if (fromUnit.dimension !== toUnit.dimension) return null;
  return (amount * fromUnit.toBaseFactor) / toUnit.toBaseFactor;
}

function extractLeadingPackPattern(packSize: string): { outerCount: number; remainder: string } {
  const match = packSize.match(/^(\d+(?:\.\d+)?)\s*(?:x|\/)\s*(.+)$/);
  if (!match) {
    return { outerCount: 1, remainder: packSize };
  }

  return {
    outerCount: Number(match[1]) || 1,
    remainder: match[2].trim(),
  };
}

function extractPackMeasurement(
  packText: string,
): { amount: number; unit: UnitDefinition | null; unitToken: string | null; prefixedByHash: boolean } | null {
  const match = packText.match(/^(#)?(\d+(?:\.\d+)?)\s*([a-z]+)?/);
  if (!match) return null;

  return {
    prefixedByHash: Boolean(match[1]),
    amount: Number(match[2]),
    unitToken: match[3] ?? null,
    unit: getUnitDefinition(match[3]),
  };
}

function estimatePackSizeMultiplierForUnit(packSize: string | null | undefined, unit: string | null | undefined): number | null {
  const targetUnit = getUnitDefinition(unit);
  const normalizedPackSize = normalizePackSizeText(packSize);

  if (!targetUnit || !normalizedPackSize) return null;

  const { outerCount, remainder } = extractLeadingPackPattern(normalizedPackSize);
  const measurement = extractPackMeasurement(remainder);

  if (targetUnit.dimension === "weight" || targetUnit.dimension === "volume") {
    if (!measurement?.unit || measurement.prefixedByHash) return null;
    const convertedAmount = convertBetweenUnits(measurement.amount, measurement.unit, targetUnit);
    if (convertedAmount == null) return null;
    if (outerCount === 1 && measurement.unit.canonical === targetUnit.canonical) {
      return null;
    }
    return outerCount * convertedAmount;
  }

  if (measurement && !measurement.prefixedByHash && measurement.unit?.dimension === "count") {
    return outerCount * measurement.amount;
  }

  if (outerCount > 1) {
    return outerCount;
  }

  if (
    measurement &&
    !measurement.prefixedByHash &&
    measurement.unit?.dimension === "count" &&
    outerCount === 1
  ) {
    return measurement.amount;
  }

  return null;
}

export function convertPurchaseQuantityToStockUnits(
  quantity: number | null | undefined,
  unit: string | null | undefined,
  packSize: string | null | undefined,
): number {
  const numericQuantity = Number(quantity ?? 0);
  if (!Number.isFinite(numericQuantity)) return 0;

  const multiplier = estimatePackSizeMultiplierForUnit(packSize, unit);
  if (multiplier == null || multiplier <= 0) {
    return numericQuantity;
  }

  return numericQuantity * multiplier;
}

function roundToStep(value: number, step = 0.1): number {
  return Math.round(value / step) * step;
}

function computeConfidence(dataPoints: number): "high" | "medium" | "low" {
  if (dataPoints >= 4) return "high";
  if (dataPoints >= 2) return "medium";
  return "low";
}

function isFluctuating(weeklyUsages: number[]): boolean {
  if (weeklyUsages.length < 3) return false;

  let fluctuationWindows = 0;
  for (let index = 1; index < weeklyUsages.length; index++) {
    const previous = weeklyUsages[index - 1];
    const current = weeklyUsages[index];
    if (previous > 0 && Math.abs(current - previous) / previous > 0.15) {
      fluctuationWindows++;
    }
  }

  if (fluctuationWindows >= 2) return true;

  const mean = weeklyUsages.reduce((sum, value) => sum + value, 0) / weeklyUsages.length;
  if (mean <= 0) return false;

  const variance = weeklyUsages.reduce((sum, value) => sum + (value - mean) ** 2, 0) / weeklyUsages.length;
  const coefficientOfVariation = Math.sqrt(variance) / mean;
  return coefficientOfVariation > 0.3;
}

function resolveLeadTimeDays(value: number | null | undefined): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : 2;
}

function inventoryListIdFromInvoiceEmbed(inv: {
  purchase_orders?:
    | null
    | {
        smart_order_runs?:
          | null
          | { inventory_list_id: string | null }
          | { inventory_list_id: string | null }[];
      }
    | Array<{
        smart_order_runs?:
          | null
          | { inventory_list_id: string | null }
          | { inventory_list_id: string | null }[];
      }>;
}): string | null {
  const rawPo = inv.purchase_orders;
  const po = Array.isArray(rawPo) ? rawPo[0] : rawPo;
  const rawRun = po?.smart_order_runs;
  const run = Array.isArray(rawRun) ? rawRun[0] : rawRun;
  return run?.inventory_list_id ?? null;
}

async function loadApprovedSessions(
  restaurantId: string,
  options: UsageAnalyticsOptions = {},
  limit: number,
): Promise<ApprovedSession[]> {
  let sessionsQuery = supabase
    .from("inventory_sessions")
    .select("id, approved_at, inventory_list_id, location_id")
    .eq("restaurant_id", restaurantId)
    .eq("status", "APPROVED")
    .not("approved_at", "is", null)
    .order("approved_at", { ascending: false })
    .limit(limit);

  if (options.locationId) {
    sessionsQuery = sessionsQuery.eq("location_id", options.locationId);
  }

  if (options.inventoryListId) {
    sessionsQuery = sessionsQuery.eq("inventory_list_id", options.inventoryListId);
  }

  const { data } = await sessionsQuery;
  return (data ?? [])
    .filter((row): row is typeof row & { approved_at: string } => Boolean(row.approved_at))
    .map((row) => ({
      id: row.id,
      approved_at: row.approved_at as string,
      inventory_list_id: row.inventory_list_id,
      location_id: row.location_id,
    }));
}

async function computeUsageBetweenSessions(
  restaurantId: string,
  previousSession: ApprovedSession,
  latestSession: ApprovedSession,
  options: UsageAnalyticsOptions = {},
): Promise<ComputedUsageItem[]> {
  const [{ data: latestItems }, { data: previousItems }] = await Promise.all([
    supabase
      .from("inventory_session_items")
      .select("item_name, current_stock, unit, metadata")
      .eq("session_id", latestSession.id),
    supabase
      .from("inventory_session_items")
      .select("item_name, current_stock, unit, metadata")
      .eq("session_id", previousSession.id),
  ]);

  if (!latestItems || !previousItems) return [];

  const stockUnitByKey: Record<string, string | null> = {};
  for (const item of [...previousItems, ...latestItems]) {
    const key = buildCatalogIdentityKey(catalogIdFromSessionItem(item), item.item_name);
    if (!key) continue;
    if (stockUnitByKey[key] == null && item.unit) {
      stockUnitByKey[key] = item.unit;
    }
  }

  const invoiceDocIds = await fetchInvoiceDocumentIdsForRestaurant(restaurantId);
  const windowStart = new Date(previousSession.approved_at);
  const windowEnd = new Date(latestSession.approved_at);

  const purchaseMap: Record<string, number> = {};

  // New model: confirmed invoices (aligned with stock receive) in the session window
  let invoiceQuery = supabase
    .from("invoices")
    .select(
      "id, created_at, invoice_date, purchase_orders(smart_order_runs(inventory_list_id))",
    )
    .eq("restaurant_id", restaurantId)
    .eq("status", "confirmed");

  if (options.locationId) {
    invoiceQuery = invoiceQuery.eq("location_id", options.locationId);
  }

  const { data: invoiceRows } = await invoiceQuery;
  const invoicesInWindow = (invoiceRows ?? []).filter((inv) => {
    const listId = inventoryListIdFromInvoiceEmbed(inv);
    if (options.inventoryListId && listId !== options.inventoryListId) {
      return false;
    }
    return isPurchaseHistoryInBusinessWindow(inv, windowStart, windowEnd);
  });
  const invoiceIdsInWindow = invoicesInWindow.map((i) => i.id);

  if (invoiceIdsInWindow.length > 0) {
    const { data: invoiceLineItems } = await supabase
      .from("invoice_items")
      .select("item_name, quantity_invoiced, catalog_item_id, pack_size")
      .in("invoice_id", invoiceIdsInWindow);

    for (const item of invoiceLineItems ?? []) {
      const key = buildCatalogIdentityKey(item.catalog_item_id, item.item_name);
      if (!key) continue;
      const convertedQuantity = convertPurchaseQuantityToStockUnits(
        item.quantity_invoiced,
        stockUnitByKey[key],
        item.pack_size,
      );
      purchaseMap[key] = (purchaseMap[key] || 0) + convertedQuantity;
    }
  }

  // Legacy purchase_history rows not represented in `invoices`
  let purchaseHistoryQuery = supabase
    .from("purchase_history")
    .select("id, created_at, invoice_date")
    .eq("restaurant_id", restaurantId)
    .in("invoice_status", ["RECEIVED", "POSTED", "COMPLETE"]);

  if (options.locationId) {
    purchaseHistoryQuery = purchaseHistoryQuery.eq("location_id", options.locationId);
  }

  if (options.inventoryListId) {
    purchaseHistoryQuery = purchaseHistoryQuery.eq("inventory_list_id", options.inventoryListId);
  }

  const { data: purchases } = await purchaseHistoryQuery;
  const purchaseIds = (purchases ?? [])
    .filter((purchase) => !invoiceDocIds.has(purchase.id))
    .filter((purchase) => isPurchaseHistoryInBusinessWindow(purchase, windowStart, windowEnd))
    .map((purchase) => purchase.id);

  if (purchaseIds.length > 0) {
    const { data: purchaseItems } = await supabase
      .from("purchase_history_items")
      .select("item_name, quantity, catalog_item_id, pack_size")
      .in("purchase_history_id", purchaseIds);

    for (const item of purchaseItems ?? []) {
      const key = buildCatalogIdentityKey(item.catalog_item_id, item.item_name);
      if (!key) continue;
      const convertedQuantity = convertPurchaseQuantityToStockUnits(
        item.quantity,
        stockUnitByKey[key],
        item.pack_size,
      );
      purchaseMap[key] = (purchaseMap[key] || 0) + convertedQuantity;
    }
  }

  const endingMap: Record<string, number> = {};
  for (const item of latestItems) {
    const key = buildCatalogIdentityKey(catalogIdFromSessionItem(item), item.item_name);
    if (!key) continue;
    endingMap[key] = Number(item.current_stock ?? 0);
  }

  const daysBetween = Math.max(
    1,
    (new Date(latestSession.approved_at).getTime() - new Date(previousSession.approved_at).getTime()) / 86400000,
  );

  const results: ComputedUsageItem[] = [];
  for (const item of previousItems) {
    const key = buildCatalogIdentityKey(catalogIdFromSessionItem(item), item.item_name);
    if (!key) continue;

    const beginningStock = Number(item.current_stock ?? 0);
    const endingStock = endingMap[key] ?? 0;
    const purchasesBetween = purchaseMap[key] || 0;
    const usageRaw = beginningStock + purchasesBetween - endingStock;
    const weeklyUsage = (usageRaw / daysBetween) * 7;

    results.push({
      catalog_item_id: catalogIdFromSessionItem(item) ?? null,
      item_name: item.item_name,
      beginning_stock: beginningStock,
      ending_stock: endingStock,
      purchases_between: purchasesBetween,
      usage_raw: usageRaw,
      weekly_usage: Math.max(0, weeklyUsage),
      days_between: Math.round(daysBetween),
    });
  }

  return results.sort((left, right) => right.weekly_usage - left.weekly_usage);
}

async function loadParGuideOverrides(
  restaurantId: string,
  options: PARRecommendationOptions,
): Promise<Record<string, ParGuideOverride>> {
  if (!options.useParGuideOverrides) return {};

  let parGuideQuery = supabase
    .from("par_guide_items")
    .select("item_name, par_level, category, unit, catalog_item_id, par_guides!inner(restaurant_id, inventory_list_id)");

  if (options.parGuideId) {
    parGuideQuery = parGuideQuery.eq("par_guide_id", options.parGuideId);
  } else if (options.inventoryListId) {
    parGuideQuery = parGuideQuery.eq("par_guides.inventory_list_id", options.inventoryListId);
  } else {
    parGuideQuery = parGuideQuery.eq("par_guides.restaurant_id", restaurantId);
  }

  const { data } = await parGuideQuery;
  const overrides: Record<string, ParGuideOverride> = {};

  for (const item of data ?? []) {
    const normalizedName = normalizeItemName(item.item_name);
    if (!normalizedName) continue;

    const parLevel = Number(item.par_level ?? 0);
    const entry: ParGuideOverride = {
      display_name: item.item_name,
      par_level: parLevel,
      category: item.category ?? null,
      unit: item.unit ?? null,
    };

    const catalogKey = item.catalog_item_id ? `catalog:${item.catalog_item_id}` : null;
    if (catalogKey && (!overrides[catalogKey] || parLevel > overrides[catalogKey].par_level)) {
      overrides[catalogKey] = entry;
    }
    if (!overrides[normalizedName] || parLevel > overrides[normalizedName].par_level) {
      overrides[normalizedName] = entry;
    }
  }

  return overrides;
}

/**
 * Compute usage from the last 2 approved sessions + purchase data in between.
 */
export async function computeUsageAnalytics(
  restaurantId: string,
  locationId?: string | null,
): Promise<ComputedUsageItem[]> {
  const sessions = await loadApprovedSessions(restaurantId, { locationId }, 2);
  if (sessions.length < 2) return [];

  return computeUsageBetweenSessions(restaurantId, sessions[1], sessions[0], { locationId });
}

/**
 * Generate shared PAR recommendation details from recent approved sessions.
 */
export async function computeDetailedPARRecommendations(
  restaurantId: string,
  options: PARRecommendationOptions = {},
): Promise<DetailedPARRecommendation[]> {
  const sessions = await loadApprovedSessions(restaurantId, options, 4);
  if (sessions.length < 3) return [];

  const sessionIds = sessions.map(session => session.id);
  const { data: allItems } = await supabase
    .from("inventory_session_items")
    .select("session_id, item_name, current_stock, par_level, category, unit, metadata")
    .in("session_id", sessionIds);

  if (!allItems || allItems.length === 0) return [];

  const orderedSessions = [...sessions].reverse();
  const sessionIndexMap = Object.fromEntries(
    orderedSessions.map((session, index) => [session.id, index]),
  );

  const itemData: Record<string, {
    catalog_item_id: string | null;
    normalized_name: string;
    display_name: string;
    category: string | null;
    unit: string | null;
    stocks: Array<number | null>;
    pars: number[];
  }> = {};

  for (const item of allItems) {
    const cid = catalogIdFromSessionItem(item);
    const key = buildCatalogIdentityKey(cid, item.item_name);
    if (!key) continue;

    if (!itemData[key]) {
      itemData[key] = {
        catalog_item_id: cid ?? null,
        normalized_name: normalizeItemName(item.item_name),
        display_name: item.item_name,
        category: item.category ?? null,
        unit: item.unit ?? null,
        stocks: new Array(orderedSessions.length).fill(null),
        pars: [],
      };
    } else if (!itemData[key].catalog_item_id && cid) {
      itemData[key].catalog_item_id = cid;
    }

    const sessionIndex = sessionIndexMap[item.session_id];
    if (sessionIndex !== undefined) {
      itemData[key].stocks[sessionIndex] = Number(item.current_stock ?? 0);
      itemData[key].pars.push(Number(item.par_level ?? 0));
    }
  }

  const usageWindowCount = Math.max(orderedSessions.length - 1, 0);
  const weeklyUsageByKey = Object.fromEntries(
    Object.keys(itemData).map(key => [key, new Array<number>(usageWindowCount).fill(0)]),
  ) as Record<string, number[]>;

  for (let windowIndex = 1; windowIndex < orderedSessions.length; windowIndex++) {
    const usageItems = await computeUsageBetweenSessions(
      restaurantId,
      orderedSessions[windowIndex - 1],
      orderedSessions[windowIndex],
      options,
    );

    for (const item of usageItems) {
      const key = buildCatalogIdentityKey(item.catalog_item_id, item.item_name);
      if (!key || !weeklyUsageByKey[key]) continue;
      weeklyUsageByKey[key][windowIndex - 1] = item.weekly_usage;
    }
  }

  const parGuideOverrides = await loadParGuideOverrides(restaurantId, options);
  const leadTimeDays = resolveLeadTimeDays(options.leadTimeDays);
  const recommendations: DetailedPARRecommendation[] = [];

  for (const [key, data] of Object.entries(itemData)) {
    const validStocks = data.stocks.filter((stock): stock is number => stock !== null);
    if (validStocks.length < 3) continue;

    const byCatalogKey = data.catalog_item_id
      ? parGuideOverrides[`catalog:${data.catalog_item_id}`]
      : undefined;
    const parGuideOverride = byCatalogKey ?? parGuideOverrides[data.normalized_name];
    const currentPar = parGuideOverride?.par_level ?? Math.max(...data.pars, 0);
    const weeklyUsages = weeklyUsageByKey[key] ?? [];
    const positiveWeeklyUsages = weeklyUsages.filter(usage => usage > 0);
    const latestWeeklyUsage = weeklyUsages[weeklyUsages.length - 1] ?? 0;
    const averageWeeklyUsage = positiveWeeklyUsages.length > 0
      ? positiveWeeklyUsages.reduce((sum, usage) => sum + usage, 0) / positiveWeeklyUsages.length
      : 0;

    const displayName = parGuideOverride?.display_name ?? data.display_name;
    const category = data.category ?? parGuideOverride?.category ?? null;
    const unit = data.unit ?? parGuideOverride?.unit ?? null;
    const confidence = computeConfidence(validStocks.length);
    const fluctuating = isFluctuating(positiveWeeklyUsages);

    if (currentPar <= 0) {
      const fallbackPar = averageWeeklyUsage > 0
        ? roundToStep(averageWeeklyUsage * (1 + leadTimeDays / 7))
        : roundToStep(validStocks.reduce((sum, stock) => sum + stock, 0) / validStocks.length);

      const suggestedPar = Math.max(0.1, fallbackPar);
      if (!Number.isFinite(suggestedPar) || suggestedPar <= 0) continue;

      recommendations.push({
        catalog_item_id: data.catalog_item_id,
        item_name: displayName,
        category,
        unit,
        current_par: 0,
        suggested_par: suggestedPar,
        change_amount: suggestedPar,
        change_pct: 100,
        reason: averageWeeklyUsage > 0
          ? `No active PAR set. Suggested from recent weekly usage of ${averageWeeklyUsage.toFixed(1)}.`
          : `No active PAR set. Suggested from average recent counted stock.`,
        type: "missing_par",
        confidence,
        is_fluctuating: fluctuating,
        risk_type: "missing_par",
        data_points: validStocks.length,
        weekly_usages: weeklyUsages,
      });
      continue;
    }

    const recentStocks = validStocks.slice(-3);
    let suggestedPar: number | null = null;
    let type: PARRecommendationType | null = null;
    let reason = "";
    let riskType: DetailedPARRecommendation["risk_type"] = "adjustment";

    if (recentStocks.length === 3 && recentStocks.every(stock => stock < currentPar * 0.5)) {
      const increase = Math.round(currentPar * 0.15);
      suggestedPar = currentPar + increase;
      type = "increase";
      riskType = "stockout";
      reason = "Stock critically low (<50% PAR) for 3 consecutive counts. Consider increasing PAR.";
    } else if (recentStocks.length === 3 && recentStocks.every(stock => stock > currentPar * 1.3)) {
      const decrease = Math.round(currentPar * 0.15);
      suggestedPar = currentPar - decrease;
      type = "decrease";
      riskType = "overstock";
      reason = "Stock consistently above PAR (>130%) for 3 consecutive counts. Consider decreasing PAR.";
    } else if (latestWeeklyUsage > currentPar * 0.8) {
      suggestedPar = Math.ceil(latestWeeklyUsage * 1.2);
      type = "usage_trend";
      riskType = "adjustment";
      reason = `Weekly usage (${latestWeeklyUsage.toFixed(1)}) approaching PAR level. Consider buffer increase.`;
    }

    if (suggestedPar === null || type === null) continue;

    const changeAmount = suggestedPar - currentPar;
    const changePct = Math.round((changeAmount / currentPar) * 100);

    recommendations.push({
      catalog_item_id: data.catalog_item_id,
      item_name: displayName,
      category,
      unit,
      current_par: currentPar,
      suggested_par: suggestedPar,
      change_amount: changeAmount,
      change_pct: changePct,
      reason,
      type,
      confidence,
      is_fluctuating: fluctuating,
      risk_type: riskType,
      data_points: validStocks.length,
      weekly_usages: weeklyUsages,
    });
  }

  return recommendations.sort((left, right) => Math.abs(right.change_pct) - Math.abs(left.change_pct));
}

/**
 * Generate rules-based PAR recommendations from consecutive approved sessions.
 */
export async function computePARRecommendations(
  restaurantId: string,
  locationId?: string | null,
): Promise<PARRecommendation[]> {
  const recommendations = await computeDetailedPARRecommendations(restaurantId, { locationId });

  return recommendations.map((recommendation) => ({
    catalog_item_id: recommendation.catalog_item_id,
    item_name: recommendation.item_name,
    current_par: recommendation.current_par,
    suggested_par: recommendation.suggested_par,
    change_pct: recommendation.change_pct,
    reason: recommendation.reason,
    type: recommendation.type,
  }));
}
