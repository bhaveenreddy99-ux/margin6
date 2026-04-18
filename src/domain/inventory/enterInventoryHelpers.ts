import { format } from "date-fns";
import {
  computeOrderQty,
  formatNum,
  getRisk,
  getRowState,
  type RiskThresholds,
} from "@/lib/inventory-utils";
import {
  buildParGuideLevelMaps,
  resolveParLevelFromGuideMaps,
  type ParGuideLevelMaps,
} from "@/domain/inventory/parGuideLevels";
import type {
  ApprovedParLookupArgs,
  CatalogLookupEntry,
  CategoryMappingEntry,
  FilterStatus,
  InventoryCatalogItemRow,
  InventoryListRow,
  InventorySessionItemInsert,
  InventorySessionItemRow,
  InventorySessionListRow,
  ListSelectorMeta,
  MappedCategory,
  ParGuideItemRow,
  ReminderScheduleForNextOccurrence,
  ReminderWithListLocation,
  ScheduleWithNextDate,
  SessionItemState,
  SessionStats,
  SmartOrderRunItemInsert,
} from "@/domain/inventory/enterInventoryTypes";

export const DESKTOP_COUNT_ROW_HEIGHT = 58;
export const DESKTOP_CATEGORY_LIST_MAX_HEIGHT = 560;
export const MOBILE_COUNT_CARD_HEIGHT = 268;

export function normalizeItemName(itemName: string | null | undefined): string {
  return itemName?.trim().toLowerCase() ?? "";
}

export function getRiskBadgeLabel(risk: ReturnType<typeof getRisk>): string {
  return risk.level === "NO_PAR" ? "NO PAR" : risk.level;
}

export function sessionRowsToItemState(rows: InventorySessionItemRow[]): SessionItemState {
  const itemOrder = rows.map((row) => row.id);
  const itemById: Record<string, InventorySessionItemRow> = {};
  for (const row of rows) {
    itemById[row.id] = row;
  }
  return { itemOrder, itemById };
}

export function getDesktopSessionGridTemplate(
  parColumnVisible: boolean,
  simplifyCountingRow: boolean,
): string {
  if (simplifyCountingRow) {
    return parColumnVisible
      ? "minmax(200px,2.5fr) 148px minmax(56px,0.85fr) 72px 80px 36px"
      : "minmax(200px,2.5fr) 148px 72px 80px 36px";
  }

  return parColumnVisible
    ? "minmax(180px,2.2fr) 144px minmax(72px,1fr) 96px 80px 96px 40px"
    : "minmax(180px,2.2fr) 144px 96px 80px 96px 40px";
}

export function computeNextOccurrence(
  schedule: ReminderScheduleForNextOccurrence,
): Date | null {
  const dayMap: Record<string, number> = {
    SUN: 0,
    MON: 1,
    TUE: 2,
    WED: 3,
    THU: 4,
    FRI: 5,
    SAT: 6,
  };
  const rawDays = schedule.days_of_week;
  const days = Array.isArray(rawDays) ? (rawDays as string[]) : [];
  const [hours, minutes] = (schedule.time_of_day || "09:00").split(":").map(Number);
  const now = new Date();

  const monthlyDay = days.find((day) => day.startsWith("MONTHLY_"));
  if (monthlyDay) {
    const day = parseInt(monthlyDay.split("_")[1], 10);
    const candidate = new Date(now.getFullYear(), now.getMonth(), day, hours, minutes, 0, 0);
    if (candidate <= now) candidate.setMonth(candidate.getMonth() + 1);
    return candidate;
  }

  for (let index = 0; index <= 7; index += 1) {
    const candidate = new Date(now);
    candidate.setDate(now.getDate() + index);
    const candidateDay = Object.keys(dayMap).find((key) => dayMap[key] === candidate.getDay());
    if (candidateDay && days.includes(candidateDay)) {
      candidate.setHours(hours, minutes, 0, 0);
      if (candidate > now) return candidate;
    }
  }

  return null;
}

export function getScheduleStatus(nextDate: Date): "upcoming" | "ready" | "overdue" {
  const diffMs = nextDate.getTime() - Date.now();
  if (diffMs < 0) return "overdue";
  if (diffMs < 60 * 60 * 1000) return "ready";
  return "upcoming";
}

export function formatCountdown(nextDate: Date): string {
  const diffMs = nextDate.getTime() - Date.now();
  if (diffMs <= 0) return "Now";
  const hours = Math.floor(diffMs / 3600000);
  const minutes = Math.floor((diffMs % 3600000) / 60000);
  if (hours >= 24) return `${Math.floor(hours / 24)}d ${hours % 24}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

export function formatSessionRowDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  try {
    return format(new Date(iso), "EEE, MM/dd/yy");
  } catch {
    return "—";
  }
}

export function isInventorySessionItemsCatalogIdSchemaError(
  message: string | undefined,
): boolean {
  if (!message) return false;
  return /inventory_session_items.*catalog_item_id|catalog_item_id.*inventory_session_items|schema cache/i.test(
    message,
  );
}

export function buildCatalogSeedRows(args: {
  sessionId: string;
  catalogItems: InventoryCatalogItemRow[];
  parGuideItems: ParGuideItemRow[];
}) {
  const validCatalog = args.catalogItems.filter(
    (item) => (item.item_name || "").trim().length > 0,
  );
  const parMaps = buildParGuideLevelMaps(args.parGuideItems);

  const withCatalog = validCatalog.map((catalogItem): InventorySessionItemInsert => {
    const base =
      catalogItem.default_par_level != null &&
      Number.isFinite(Number(catalogItem.default_par_level))
        ? Number(catalogItem.default_par_level)
        : 0;

    return {
      session_id: args.sessionId,
      catalog_item_id: catalogItem.id,
      item_name: catalogItem.item_name.trim(),
      category: catalogItem.category || "Dry",
      unit: catalogItem.unit || "",
      pack_size: catalogItem.pack_size ?? null,
      brand_name: catalogItem.brand_name ?? null,
      vendor_name: catalogItem.vendor_name ?? null,
      vendor_sku: catalogItem.vendor_sku ?? null,
      current_stock: 0,
      par_level: resolveParLevelFromGuideMaps(
        { catalog_item_id: catalogItem.id, item_name: catalogItem.item_name },
        parMaps,
        base,
      ),
      unit_cost: catalogItem.default_unit_cost ?? null,
    };
  });

  const withoutCatalog = withCatalog.map(({ catalog_item_id: _removed, ...row }) => row);

  return { withCatalog, withoutCatalog };
}

export function buildParOnlySeedRows(
  sessionId: string,
  parItems: ParGuideItemRow[],
): InventorySessionItemInsert[] {
  return parItems
    .filter((item) => (item.item_name || "").trim().length > 0)
    .map((item) => ({
      session_id: sessionId,
      item_name: item.item_name.trim(),
      category: item.category || "Dry",
      unit: item.unit || "",
      current_stock: 0,
      par_level: Number(item.par_level ?? 0),
    }));
}

export function buildListSelectorMeta(
  lists: InventoryListRow[],
  catalogItems: Array<Pick<InventoryCatalogItemRow, "inventory_list_id">>,
  guides: Array<{ inventory_list_id: string | null }>,
  approvedSessions: Array<Pick<InventorySessionListRow, "inventory_list_id" | "approved_at">>,
): ListSelectorMeta {
  const nextMeta: ListSelectorMeta = {};
  for (const list of lists) {
    nextMeta[list.id] = { itemCount: 0, lastCountedAt: null, hasParGuide: false };
  }

  for (const item of catalogItems) {
    if (!item.inventory_list_id) continue;
    nextMeta[item.inventory_list_id] ||= { itemCount: 0, lastCountedAt: null, hasParGuide: false };
    nextMeta[item.inventory_list_id].itemCount += 1;
  }

  for (const guide of guides) {
    if (!guide.inventory_list_id) continue;
    nextMeta[guide.inventory_list_id] ||= { itemCount: 0, lastCountedAt: null, hasParGuide: false };
    nextMeta[guide.inventory_list_id].hasParGuide = true;
  }

  for (const session of approvedSessions) {
    if (!session.inventory_list_id || !session.approved_at) continue;
    nextMeta[session.inventory_list_id] ||= { itemCount: 0, lastCountedAt: null, hasParGuide: false };
    const existingDate = nextMeta[session.inventory_list_id].lastCountedAt;
    if (!existingDate || new Date(session.approved_at) > new Date(existingDate)) {
      nextMeta[session.inventory_list_id].lastCountedAt = session.approved_at;
    }
  }

  return nextMeta;
}

export function buildSessionStats(
  rows: Array<Pick<InventorySessionItemRow, "session_id" | "current_stock" | "unit_cost">>,
): SessionStats {
  const stats: SessionStats = {};
  for (const row of rows) {
    stats[row.session_id] ||= { qty: 0, totalValue: 0, counted: 0, total: 0 };
    stats[row.session_id].qty += Number(row.current_stock ?? 0);
    stats[row.session_id].total += 1;
    if (row.current_stock !== null && Number(row.current_stock) > 0) {
      stats[row.session_id].counted += 1;
    }
    if (row.current_stock != null && row.unit_cost != null) {
      stats[row.session_id].totalValue += Number(row.current_stock) * Number(row.unit_cost);
    }
  }
  return stats;
}

export function findNextSchedule(
  schedules: ReminderWithListLocation[],
): ScheduleWithNextDate | null {
  let closest: ScheduleWithNextDate | null = null;
  for (const schedule of schedules) {
    const nextDate = computeNextOccurrence(schedule);
    if (nextDate && (!closest || nextDate < closest.nextDate)) {
      closest = { ...schedule, nextDate };
    }
  }
  return closest;
}

export function buildLandingFocus(args: {
  lists: InventoryListRow[];
  landingFocusListId: string | null;
  inProgressSessions: InventorySessionListRow[];
  reviewSessions: InventorySessionListRow[];
  sessionStats: SessionStats;
  listSelectorMeta: ListSelectorMeta;
}) {
  const effectiveLandingListId =
    args.landingFocusListId && args.lists.some((list) => list.id === args.landingFocusListId)
      ? args.landingFocusListId
      : args.lists[0]?.id ?? null;
  const focusList = args.lists.find((list) => list.id === effectiveLandingListId) || null;
  const focusInProgressSession = effectiveLandingListId
    ? args.inProgressSessions.find((session) => session.inventory_list_id === effectiveLandingListId) ?? null
    : null;
  const focusReviewSession =
    !focusInProgressSession && effectiveLandingListId
      ? args.reviewSessions.find((session) => session.inventory_list_id === effectiveLandingListId) ?? null
      : null;
  const meta = effectiveLandingListId
    ? args.listSelectorMeta[effectiveLandingListId]
    : { itemCount: 0, lastCountedAt: null, hasParGuide: false };
  const stats = focusInProgressSession ? args.sessionStats[focusInProgressSession.id] : undefined;

  return {
    effectiveLandingListId,
    focusList,
    focusInProgressSession,
    focusReviewSession,
    meta: meta || { itemCount: 0, lastCountedAt: null, hasParGuide: false },
    stats,
  };
}

export function buildCatalogLookup(
  catalogItems: InventoryCatalogItemRow[],
): Record<string, CatalogLookupEntry> {
  const lookup: Record<string, CatalogLookupEntry> = {};
  for (const catalogItem of catalogItems) {
    lookup[catalogItem.item_name] = {
      id: catalogItem.id,
      product_number: catalogItem.product_number || catalogItem.vendor_sku || null,
    };
  }
  return lookup;
}

export function buildCatalogDefaultParById(
  catalogItems: InventoryCatalogItemRow[],
): Record<string, number> {
  const lookup: Record<string, number> = {};
  for (const catalogItem of catalogItems) {
    const parsed = Number(catalogItem.default_par_level ?? 0);
    lookup[catalogItem.id] = Number.isFinite(parsed) ? parsed : 0;
  }
  return lookup;
}

export function buildCatalogDefaultParByName(
  catalogItems: InventoryCatalogItemRow[],
): Record<string, number> {
  const lookup: Record<string, number> = {};
  for (const catalogItem of catalogItems) {
    const key = normalizeItemName(catalogItem.item_name);
    if (!key) continue;
    const parsed = Number(catalogItem.default_par_level ?? 0);
    lookup[key] = Number.isFinite(parsed) ? parsed : 0;
  }
  return lookup;
}

export function getItemCategory(args: {
  item: InventorySessionItemRow;
  categoryMode: string;
  hasMappings: boolean;
  itemCategoryMap: Record<string, CategoryMappingEntry>;
}): string {
  if (args.categoryMode === "alphabetic") {
    return args.item.item_name.charAt(0).toUpperCase();
  }
  if (args.hasMappings && args.itemCategoryMap[args.item.item_name]) {
    return args.itemCategoryMap[args.item.item_name].category_name;
  }
  return args.item.category || "Uncategorized";
}

export function getItemSortOrder(args: {
  item: InventorySessionItemRow;
  hasMappings: boolean;
  itemCategoryMap: Record<string, CategoryMappingEntry>;
}): number {
  if (args.hasMappings && args.itemCategoryMap[args.item.item_name]) {
    return args.itemCategoryMap[args.item.item_name].item_sort_order;
  }
  return 0;
}

export function getApprovedPar(
  item: InventorySessionItemRow,
  args: ApprovedParLookupArgs,
): number {
  if (args.countingParGuideId) {
    if (item.catalog_item_id && args.countingParByCatalogId[item.catalog_item_id] !== undefined) {
      return args.countingParByCatalogId[item.catalog_item_id];
    }
    const key = normalizeItemName(item.item_name);
    if (key && args.countingParByNormalizedName[key] !== undefined) {
      return args.countingParByNormalizedName[key];
    }
    const sessionPar = Number(item.par_level);
    if (item.par_level !== null && item.par_level !== undefined && Number.isFinite(sessionPar)) {
      return sessionPar;
    }
    return 0;
  }

  const key = normalizeItemName(item.item_name);
  const guidePar = args.approvedParMap[key];
  if (guidePar !== undefined) return guidePar;

  const sessionPar = Number(item.par_level);
  if (item.par_level !== null && item.par_level !== undefined && Number.isFinite(sessionPar)) {
    return sessionPar;
  }

  if (item.catalog_item_id && item.catalog_item_id in args.catalogDefaultParById) {
    return args.catalogDefaultParById[item.catalog_item_id];
  }

  return args.catalogDefaultParByName[key] ?? 0;
}

export function getCatalogUnitCost(
  catalogItems: InventoryCatalogItemRow[],
  catalogItemId: string | null | undefined,
): number | null {
  if (!catalogItemId) return null;
  const catalogItem = catalogItems.find((item) => item.id === catalogItemId);
  if (catalogItem?.default_unit_cost == null) return null;
  const value = Number(catalogItem.default_unit_cost);
  return Number.isFinite(value) ? value : null;
}

export function getProductNumber(
  item: InventorySessionItemRow,
  catalogLookup: Record<string, CatalogLookupEntry>,
): string | null {
  return item.vendor_sku || catalogLookup[item.item_name]?.product_number || null;
}

export function formatLastOrdered(date: string | null): string {
  if (!date) return "—";
  try {
    return format(new Date(date), "MM/dd/yy");
  } catch {
    return "—";
  }
}

export function buildInventoryView(args: {
  items: InventorySessionItemRow[];
  filterCategory: string;
  search: string;
  showOnlyEmpty: boolean;
  statusFilter: FilterStatus;
  categoryMode: string;
  hasMappings: boolean;
  mappedCategories: MappedCategory[];
  itemCategoryMap: Record<string, CategoryMappingEntry>;
  approvedParArgs: ApprovedParLookupArgs;
  riskThresholds: RiskThresholds;
}) {
  const filteredItems = args.items.filter((item) => {
    const category = getItemCategory({
      item,
      categoryMode: args.categoryMode,
      hasMappings: args.hasMappings,
      itemCategoryMap: args.itemCategoryMap,
    });
    if (args.filterCategory !== "all" && category !== args.filterCategory) return false;
    if (args.search && !item.item_name.toLowerCase().includes(args.search.toLowerCase())) return false;
    if (args.showOnlyEmpty && Number(item.current_stock) > 0) return false;
    if (args.statusFilter === "uncounted" && getRowState(item) !== "uncounted") return false;
    if (args.statusFilter === "low") {
      const risk = getRisk(
        Number(item.current_stock ?? 0),
        getApprovedPar(item, args.approvedParArgs),
        args.riskThresholds,
      );
      if (risk.level !== "YELLOW") return false;
    }
    if (args.statusFilter === "critical") {
      const risk = getRisk(
        Number(item.current_stock ?? 0),
        getApprovedPar(item, args.approvedParArgs),
        args.riskThresholds,
      );
      if (risk.level !== "RED") return false;
    }
    return true;
  });

  if (args.hasMappings) {
    filteredItems.sort((left, right) => {
      const leftCategory = getItemCategory({
        item: left,
        categoryMode: args.categoryMode,
        hasMappings: args.hasMappings,
        itemCategoryMap: args.itemCategoryMap,
      });
      const rightCategory = getItemCategory({
        item: right,
        categoryMode: args.categoryMode,
        hasMappings: args.hasMappings,
        itemCategoryMap: args.itemCategoryMap,
      });
      const leftSort = args.mappedCategories.find((category) => category.name === leftCategory)?.sort_order ?? 999;
      const rightSort = args.mappedCategories.find((category) => category.name === rightCategory)?.sort_order ?? 999;
      if (leftSort !== rightSort) return leftSort - rightSort;
      return getItemSortOrder({
        item: left,
        hasMappings: args.hasMappings,
        itemCategoryMap: args.itemCategoryMap,
      }) - getItemSortOrder({
        item: right,
        hasMappings: args.hasMappings,
        itemCategoryMap: args.itemCategoryMap,
      });
    });
  }

  if (args.categoryMode === "alphabetic") {
    filteredItems.sort((left, right) => left.item_name.localeCompare(right.item_name));
  }

  const globalIndexByItemId = new Map<string, number>();
  filteredItems.forEach((item, index) => globalIndexByItemId.set(item.id, index));

  const categories = args.hasMappings
    ? args.mappedCategories.map((category) => category.name)
    : [...new Set(args.items.map((item) => item.category).filter(Boolean))];

  const groupedItems = filteredItems.reduce<Record<string, InventorySessionItemRow[]>>(
    (acc, item) => {
      const category = getItemCategory({
        item,
        categoryMode: args.categoryMode,
        hasMappings: args.hasMappings,
        itemCategoryMap: args.itemCategoryMap,
      });
      acc[category] ||= [];
      acc[category].push(item);
      return acc;
    },
    {},
  );

  const sortedCategoryKeys = args.hasMappings
    ? Object.keys(groupedItems).sort((left, right) => {
        const leftSort = args.mappedCategories.find((category) => category.name === left)?.sort_order ?? 999;
        const rightSort = args.mappedCategories.find((category) => category.name === right)?.sort_order ?? 999;
        return leftSort - rightSort;
      })
    : args.categoryMode === "alphabetic"
      ? Object.keys(groupedItems).sort()
      : Object.keys(groupedItems);

  return {
    filteredItems,
    globalIndexByItemId,
    categories,
    groupedItems,
    sortedCategoryKeys,
  };
}

export function resolveCountingParDisplay(
  item: InventorySessionItemRow,
  parColumnVisible: boolean,
  countingParGuideId: string | null,
  countingParByCatalogId: Record<string, number>,
  countingParByNormalizedName: Record<string, number>,
): number | null {
  if (!parColumnVisible || !countingParGuideId) return null;
  if (item.catalog_item_id && countingParByCatalogId[item.catalog_item_id] !== undefined) {
    return countingParByCatalogId[item.catalog_item_id];
  }
  const key = normalizeItemName(item.item_name);
  if (key && countingParByNormalizedName[key] !== undefined) {
    return countingParByNormalizedName[key];
  }
  return null;
}

export function formatParColumnCell(
  item: InventorySessionItemRow,
  parColumnVisible: boolean,
  countingParGuideId: string | null,
  countingParByCatalogId: Record<string, number>,
  countingParByNormalizedName: Record<string, number>,
): string {
  const value = resolveCountingParDisplay(
    item,
    parColumnVisible,
    countingParGuideId,
    countingParByCatalogId,
    countingParByNormalizedName,
  );
  return value === null ? "—" : formatNum(value);
}

export function buildSubmitSummary(
  items: InventorySessionItemRow[],
  approvedParArgs: ApprovedParLookupArgs,
  riskThresholds: RiskThresholds,
) {
  let lowCount = 0;
  let criticalCount = 0;
  let estimatedValue = 0;

  for (const item of items) {
    const par = getApprovedPar(item, approvedParArgs);
    const risk = getRisk(Number(item.current_stock ?? 0), par, riskThresholds);
    if (risk.level === "YELLOW") lowCount += 1;
    if (risk.level === "RED") criticalCount += 1;
    if (par > 0) {
      const need = computeOrderQty(item.current_stock, par, item.unit, item.pack_size);
      if (need > 0 && item.unit_cost) {
        estimatedValue += need * Number(item.unit_cost);
      }
    }
  }

  const counted = items.filter((item) => item.current_stock !== null && Number(item.current_stock) > 0).length;
  const total = items.length;
  return { counted, total, lowCount, criticalCount, estimatedValue };
}

export type SmartOrderComputedItem = InventorySessionItemRow & {
  parLevel: number;
  currentStock: number;
  risk: ReturnType<typeof getRisk>["level"];
  suggestedOrder: number;
};

export function buildSmartOrderComputedItems(args: {
  sessionItems: InventorySessionItemRow[];
  parMaps: ParGuideLevelMaps | null;
  riskThresholds: RiskThresholds;
}) {
  return args.sessionItems.map((item): SmartOrderComputedItem => {
    const sessionPar = Number(item.par_level ?? 0);
    const parLevel = resolveParLevelFromGuideMaps(
      { catalog_item_id: item.catalog_item_id, item_name: item.item_name },
      args.parMaps,
      sessionPar,
    );
    const currentStock = Number(item.current_stock ?? 0);
    const risk = getRisk(currentStock, parLevel, args.riskThresholds).level;
    const suggestedOrder = computeOrderQty(currentStock, parLevel, item.unit, item.pack_size);
    return {
      ...item,
      parLevel,
      currentStock,
      risk,
      suggestedOrder,
    };
  });
}

export function buildSmartOrderRiskCounts(items: SmartOrderComputedItem[]) {
  return {
    redCount: items.filter((item) => item.risk === "RED").length,
    yellowCount: items.filter((item) => item.risk === "YELLOW").length,
  };
}

export function buildSmartOrderRunItems(
  runId: string,
  items: SmartOrderComputedItem[],
): SmartOrderRunItemInsert[] {
  return items.map((item) => ({
    run_id: runId,
    catalog_item_id: item.catalog_item_id || null,
    item_name: item.item_name,
    suggested_order: item.suggestedOrder,
    risk: item.risk,
    current_stock: item.currentStock,
    par_level: item.parLevel,
    unit_cost: item.unit_cost || null,
    pack_size: item.pack_size || null,
  }));
}
