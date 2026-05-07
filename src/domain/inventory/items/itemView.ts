import {
  getRisk,
  getRowState,
  computeOrderQty,
  computeOrderQtyCases,
  computeRiskLevel,
  formatNum,
  type RiskLevel,
  type RiskThresholds,
} from "@/lib/inventory-utils";
import {
  computeLineInventoryValue,
  computeLineReorderValue,
} from "@/domain/inventory/casePlanningEngine";
import {
  resolveParLevelFromGuideMaps,
  resolveParFromLookupArgs,
  type ParGuideLevelMaps,
  type ParResolutionResult,
} from "@/domain/inventory/parGuideLevels";
import {
  resolveItemCategoryEntry,
  type CategoryMappingResult,
} from "@/hooks/useCategoryMapping";
import type {
  ApprovedParLookupArgs,
  CatalogLookupEntry,
  FilterStatus,
  InventoryCatalogItemRow,
  InventorySessionItemRow,
  MappedCategory,
  ParGuideItemRow,
  SessionItemState,
  SessionStats,
  SmartOrderRunItemInsert,
} from "@/domain/inventory/enterInventoryTypes";

export function normalizeItemName(itemName: string | null | undefined): string {
  return itemName?.trim().toLowerCase() ?? "";
}

/**
 * Stable key for grouping/filtering by shelf or category. Collapses
 * "DRY", "dry", " DRY " into one bucket. Empty → UNCATEGORIZED.
 */
export function normalizeInventoryCategoryKey(name: string | null | undefined): string {
  const t = (name ?? "").trim();
  if (!t) return "UNCATEGORIZED";
  return t.toUpperCase();
}

/**
 * Collapses duplicate session lines that share the same catalog item or normalized name
 * (first row wins — matches how operators expect one row per product on the count sheet).
 */
export function dedupeSessionItemsByCatalogOrName(
  rows: InventorySessionItemRow[],
): InventorySessionItemRow[] {
  const seen = new Set<string>();
  const out: InventorySessionItemRow[] = [];
  for (const row of rows) {
    const cid = row.catalog_item_id?.trim();
    const key = cid
      ? `c:${cid}`
      : row.item_name?.trim()
        ? `n:${normalizeItemName(row.item_name)}`
        : `id:${row.id}`;
    if (seen.has(key)) {
      if (key.startsWith("n:")) {
        console.warn(
          "[dedupeSessionItems] Name collision — dropping duplicate unlinked row.",
          { dropped_id: row.id, item_name: row.item_name, key },
        );
      }
      continue;
    }
    seen.add(key);
    out.push(row);
  }
  return out;
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

/**
 * Returns count of session items with no catalog_item_id.
 * These items use name-based PAR and category matching —
 * less reliable than ID-based. Surface to operators.
 */
export function countUnlinkedSessionItems(
  items: Array<{ catalog_item_id: string | null }>,
): number {
  return items.filter((i) => !i.catalog_item_id || !i.catalog_item_id.trim()).length;
}

export function getItemCategory(args: {
  item: InventorySessionItemRow;
  categoryMode: string;
  hasMappings: boolean;
  categoryMapping: CategoryMappingResult;
}): string {
  if (args.categoryMode === "alphabetic") {
    const name = args.item.item_name?.trim() ?? "";
    if (!name) return "#";
    return name.charAt(0).toUpperCase();
  }
  const entry = resolveItemCategoryEntry(args.item, args.categoryMapping, args.hasMappings);
  if (args.hasMappings && entry) {
    return normalizeInventoryCategoryKey(entry.category_name);
  }
  return normalizeInventoryCategoryKey(args.item.category);
}

export function getItemSortOrder(args: {
  item: InventorySessionItemRow;
  hasMappings: boolean;
  categoryMapping: CategoryMappingResult;
}): number {
  const entry = resolveItemCategoryEntry(args.item, args.categoryMapping, args.hasMappings);
  if (args.hasMappings && entry) {
    return entry.item_sort_order;
  }
  return 0;
}

/**
 * @deprecated Use resolveParFromLookupArgs (canonical resolver with source provenance).
 * This function is retained temporarily to avoid breaking callers during Phase 1 migration.
 * New code must NOT call this directly.
 */
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

export function buildSessionStats(
  rows: Array<Pick<InventorySessionItemRow, "session_id" | "current_stock" | "unit_cost">>,
): SessionStats {
  const stats: SessionStats = {};
  for (const row of rows) {
    const sid = row.session_id;
    stats[sid] ||= {
      qty: 0,
      totalValue: 0,
      counted: 0,
      total: 0,
      itemsWithCost: 0,
      itemsWithoutCost: 0,
      totalItems: 0,
    };
    stats[sid].qty += Number(row.current_stock ?? 0);
    stats[sid].total += 1;
    stats[sid].totalItems += 1;
    if (row.current_stock !== null && Number(row.current_stock) > 0) {
      stats[sid].counted += 1;
    }
    const lineVal = computeLineInventoryValue({
      currentStockCases: row.current_stock,
      parLevelCases: null,
      unitCostPerCase: row.unit_cost,
    });
    stats[sid].totalValue += lineVal.dollars;
    if (lineVal.isMissingCost) {
      stats[sid].itemsWithoutCost += 1;
    } else {
      stats[sid].itemsWithCost += 1;
    }
  }
  return stats;
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

export function buildInventoryView(args: {
  items: InventorySessionItemRow[];
  filterCategory: string;
  search: string;
  showOnlyEmpty: boolean;
  statusFilter: FilterStatus;
  categoryMode: string;
  hasMappings: boolean;
  mappedCategories: MappedCategory[];
  categoryMapping: CategoryMappingResult;
  approvedParArgs: ApprovedParLookupArgs;
  riskThresholds: RiskThresholds;
}) {
  const filteredItems = args.items.filter((item) => {
    const category = getItemCategory({
      item,
      categoryMode: args.categoryMode,
      hasMappings: args.hasMappings,
      categoryMapping: args.categoryMapping,
    });
    if (args.filterCategory !== "all") {
      if (category !== normalizeInventoryCategoryKey(args.filterCategory)) return false;
    }
    if (args.search && !item.item_name.toLowerCase().includes(args.search.toLowerCase()))
      return false;
    if (args.showOnlyEmpty && Number(item.current_stock) > 0) return false;
    if (args.statusFilter === "uncounted" && getRowState(Number(item.current_stock)) !== "uncounted") return false;
    if (args.statusFilter === "low" || args.statusFilter === "critical") {
      const par = getApprovedPar(item, args.approvedParArgs);
      const level = computeRiskLevel(Number(item.current_stock ?? 0), par, args.riskThresholds);
      if (args.statusFilter === "low" && level !== "YELLOW") return false;
      if (args.statusFilter === "critical" && level !== "RED") return false;
    }
    return true;
  });

  if (args.hasMappings) {
    filteredItems.sort((left, right) => {
      const leftCategory = getItemCategory({
        item: left,
        categoryMode: args.categoryMode,
        hasMappings: args.hasMappings,
        categoryMapping: args.categoryMapping,
      });
      const rightCategory = getItemCategory({
        item: right,
        categoryMode: args.categoryMode,
        hasMappings: args.hasMappings,
        categoryMapping: args.categoryMapping,
      });
      const leftSort =
        args.mappedCategories.find(
          (c) => normalizeInventoryCategoryKey(c.name) === leftCategory,
        )?.sort_order ?? 999;
      const rightSort =
        args.mappedCategories.find(
          (c) => normalizeInventoryCategoryKey(c.name) === rightCategory,
        )?.sort_order ?? 999;
      if (leftSort !== rightSort) return leftSort - rightSort;
      return (
        getItemSortOrder({
          item: left,
          hasMappings: args.hasMappings,
          categoryMapping: args.categoryMapping,
        }) -
        getItemSortOrder({
          item: right,
          hasMappings: args.hasMappings,
          categoryMapping: args.categoryMapping,
        })
      );
    });
  }

  if (args.categoryMode === "alphabetic") {
    filteredItems.sort((left, right) => left.item_name.localeCompare(right.item_name));
  }

  const globalIndexByItemId = new Map<string, number>();
  filteredItems.forEach((item, index) => globalIndexByItemId.set(item.id, index));

  const groupedItems = filteredItems.reduce<Record<string, InventorySessionItemRow[]>>(
    (acc, item) => {
      const category = getItemCategory({
        item,
        categoryMode: args.categoryMode,
        hasMappings: args.hasMappings,
        categoryMapping: args.categoryMapping,
      });
      acc[category] ||= [];
      acc[category].push(item);
      return acc;
    },
    {},
  );

  const sortOrderForCategoryKey = (key: string) =>
    args.mappedCategories.find((c) => normalizeInventoryCategoryKey(c.name) === key)?.sort_order ??
    999;

  const sortedCategoryKeys = args.hasMappings
    ? Object.keys(groupedItems).sort((left, right) => {
        const leftSort = sortOrderForCategoryKey(left);
        const rightSort = sortOrderForCategoryKey(right);
        if (leftSort !== rightSort) return leftSort - rightSort;
        return left.localeCompare(right);
      })
    : args.categoryMode === "alphabetic"
      ? Object.keys(groupedItems).sort()
      : Object.keys(groupedItems);

  const categories = args.hasMappings
    ? args.mappedCategories.map((c) => normalizeInventoryCategoryKey(c.name))
    : [...new Set(args.items.map((item) => normalizeInventoryCategoryKey(item.category)))];

  return { filteredItems, globalIndexByItemId, categories, groupedItems, sortedCategoryKeys };
}

export type SmartOrderComputedItem = InventorySessionItemRow & {
  parLevel: number;
  parSource: ParResolutionResult["source"];
  currentStock: number;
  risk: RiskLevel;
  suggestedOrder: number;
};

export function buildSmartOrderComputedItems(args: {
  sessionItems: InventorySessionItemRow[];
  parMaps: ParGuideLevelMaps | null;
  riskThresholds: RiskThresholds;
}): SmartOrderComputedItem[] {
  return args.sessionItems.map((item): SmartOrderComputedItem => {
    const sessionPar = Number(item.par_level ?? 0);
    const { parLevel, source: parSource } = resolveParLevelFromGuideMaps(
      { catalog_item_id: item.catalog_item_id, item_name: item.item_name },
      args.parMaps,
      sessionPar,
    );
    const currentStock = Number(item.current_stock ?? 0);
    const risk = computeRiskLevel(currentStock, parLevel, args.riskThresholds);
    // currentStock and parLevel are in CASES — use canonical case-based order engine
    const suggestedOrder = computeOrderQtyCases(currentStock, parLevel);
    return { ...item, parLevel, parSource, currentStock, risk, suggestedOrder };
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
    unit_cost: item.unit_cost ?? null,
    pack_size: item.pack_size || null,
  }));
}

export function buildSubmitSummary(
  items: InventorySessionItemRow[],
  approvedParArgs: ApprovedParLookupArgs,
  riskThresholds: RiskThresholds,
) {
  let lowCount = 0;
  let criticalCount = 0;
  let estimatedValue = 0;
  let itemsMissingCost = 0;
  let itemsWithCost = 0;

  for (const item of items) {
    // Use canonical resolver — preserves getApprovedPar logic with source provenance
    const par = resolveParFromLookupArgs(item, approvedParArgs).parLevel;
    const level = computeRiskLevel(Number(item.current_stock ?? 0), par, riskThresholds);
    if (level === "YELLOW") lowCount += 1;
    if (level === "RED") criticalCount += 1;

    if (item.unit_cost == null) {
      itemsMissingCost += 1;
    } else {
      itemsWithCost += 1;
    }

    if (par > 0) {
      // Route reorder dollar math through the canonical engine
      const reorderVal = computeLineReorderValue({
        currentStockCases: item.current_stock,
        parLevelCases: par,
        unitCostPerCase: item.unit_cost,
      });
      estimatedValue += reorderVal.dollars;
    }
  }

  const counted = items.filter((item) => item.current_stock !== null).length;
  const total = items.length;
  return { counted, total, lowCount, criticalCount, estimatedValue, itemsMissingCost, itemsWithCost };
}
