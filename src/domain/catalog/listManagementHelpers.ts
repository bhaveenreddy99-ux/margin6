import type {
  AdvancedListView,
  CatalogItem,
  CategorySet,
  CategorySetType,
  GridSort,
  ImportField,
  ImportMapping,
  ImportPreviewRow,
  ImportSummary,
  ImportTemplateMapping,
  InventoryListRow,
  IssueItem,
  ItemCategoryMap,
  ListCategory,
  ParsedImportRow,
  RecentPurchasedItem,
} from "@/domain/catalog/listManagementTypes";
import type { Json } from "@/integrations/supabase/types";

export const RESERVED_GROUP_NAMES = new Set([
  "Uncategorized",
  "All Items",
  "Recently Purchased",
  "Not Recently Purchased",
]);

export const DROPPABLE_SHELF_ORDER = "__shelf_order__";

export const IMPORT_AUTOMAP_FIELDS: ReadonlyArray<{
  field: ImportField;
  syns: string[];
}> = [
  { field: "default_unit_cost", syns: ["price", "cost", "unitcost"] },
  { field: "vendor_sku", syns: ["sku", "itemnumber", "code"] },
  { field: "unit", syns: ["unit", "uom", "measure"] },
  { field: "item_name", syns: ["item", "product", "name", "description"] },
  { field: "pack_size", syns: ["pack", "size", "case", "each", "pack_size", "packsize"] },
  { field: "brand_name", syns: ["brand", "manufacturer", "mfg"] },
  {
    field: "vendor_name",
    syns: ["vendor", "supplier", "distributor", "vendorname", "suppliername"],
  },
  { field: "category", syns: ["category", "shelf", "department"] },
];

const AI_CATEGORY_MAP: Record<string, string[]> = {
  Proteins: [
    "chicken",
    "beef",
    "pork",
    "fish",
    "salmon",
    "shrimp",
    "turkey",
    "lamb",
    "steak",
    "sausage",
    "bacon",
    "meat",
  ],
  Produce: [
    "lettuce",
    "tomato",
    "onion",
    "pepper",
    "carrot",
    "potato",
    "lime",
    "lemon",
    "garlic",
    "celery",
    "cucumber",
    "avocado",
    "mushroom",
    "herb",
    "basil",
    "cilantro",
    "parsley",
  ],
  Dairy: ["milk", "cream", "cheese", "butter", "yogurt", "egg", "sour cream"],
  Frozen: ["frozen", "ice cream", "fries", "ice"],
  Beverages: [
    "juice",
    "soda",
    "water",
    "vodka",
    "rum",
    "gin",
    "tequila",
    "wine",
    "beer",
    "whiskey",
    "bourbon",
    "cocktail",
    "coffee",
    "tea",
  ],
  "Dry Goods": [
    "oil",
    "flour",
    "sugar",
    "rice",
    "pasta",
    "bread",
    "buns",
    "salt",
    "spice",
    "seasoning",
    "sauce",
    "vinegar",
    "mustard",
    "ketchup",
  ],
  Cleaning: ["soap", "sanitizer", "bleach", "cleaner", "detergent", "wipe", "sponge", "trash", "glove"],
  "Paper/Disposable": ["napkin", "paper", "cup", "plate", "foil", "wrap", "bag", "container", "lid", "straw", "towel"],
};

export function chunkArray<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}

export function normalizeImportHeaderKey(header: string): string {
  return header.trim().toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function importHeaderMatchesVendorSku(header: string, key: string): boolean {
  const raw = header.trim().toLowerCase();
  return (
    key.includes("sku") ||
    key.includes("itemnumber") ||
    key.includes("itemno") ||
    key.includes("code") ||
    (raw.includes("item") && (raw.includes("#") || raw.includes("number")))
  );
}

export function buildImportAutoMapping(headers: string[]): ImportMapping {
  const autoMap: ImportMapping = {};
  for (const header of headers) {
    const key = normalizeImportHeaderKey(header);
    for (const { field, syns } of IMPORT_AUTOMAP_FIELDS) {
      if (autoMap[field]) continue;
      const match =
        field === "vendor_sku"
          ? importHeaderMatchesVendorSku(header, key)
          : syns
              .map((synonym) => normalizeImportHeaderKey(synonym))
              .some((synonym) => synonym.length > 0 && key.includes(synonym));
      if (match) {
        autoMap[field] = header;
        break;
      }
    }
  }
  return autoMap;
}

export function coerceImportTemplateMapping(value: Json): ImportTemplateMapping | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const entries = Object.entries(value);
  if (entries.some(([, entryValue]) => typeof entryValue !== "string")) return null;
  return Object.fromEntries(entries) as ImportTemplateMapping;
}

export function getImportFieldLabel(field: ImportField): string {
  if (field === "vendor_sku") return "Product Number";
  if (field === "default_unit_cost") return "Unit Cost";
  if (field === "brand_name") return "Brand";
  if (field === "vendor_name") return "Vendor Name";
  if (field === "category") return "Category";
  return field.replace(/_/g, " ");
}

export function buildImportPreview(args: {
  importData: ParsedImportRow[];
  importMapping: ImportMapping;
}): { preview: ImportPreviewRow[]; summary: ImportSummary } {
  const { importData, importMapping } = args;
  let duplicates = 0;
  let missingUnit = 0;
  let missingPackSize = 0;
  let emptyNameRows = 0;
  const seenSkus = new Set<string>();

  const preview = importData
    .map((row, index) => {
      const itemName = String(row[importMapping.item_name ?? ""] || "").trim();
      const unit = importMapping.unit ? String(row[importMapping.unit] || "").trim() : "";
      const packSize = importMapping.pack_size ? String(row[importMapping.pack_size] || "").trim() : "";
      const vendorSku = importMapping.vendor_sku ? String(row[importMapping.vendor_sku] || "").trim() : "";
      const defaultUnitCost = importMapping.default_unit_cost
        ? parseFloat(String(row[importMapping.default_unit_cost] || "")) || null
        : null;
      const brandName = importMapping.brand_name ? String(row[importMapping.brand_name] || "").trim() : "";
      const vendorName = importMapping.vendor_name ? String(row[importMapping.vendor_name] || "").trim() : "";
      const category = importMapping.category ? String(row[importMapping.category] || "").trim() : "";
      const unitCostRaw = importMapping.default_unit_cost
        ? String(row[importMapping.default_unit_cost] ?? "").trim()
        : "";

      if (!itemName) {
        emptyNameRows += 1;
        return null;
      }

      // Duplicate = same item number (vendor_sku). Same name with different item numbers is fine.
      const normalizedSku = vendorSku.toLowerCase();
      if (normalizedSku && seenSkus.has(normalizedSku)) {
        duplicates += 1;
        return null;
      }
      if (normalizedSku) seenSkus.add(normalizedSku);
      if (!unit) missingUnit += 1;
      if (!packSize) missingPackSize += 1;

      return {
        sr_no: index + 1,
        item_name: itemName,
        unit,
        pack_size: packSize,
        vendor_sku: vendorSku,
        default_unit_cost: defaultUnitCost,
        brand_name: brandName,
        vendor_name: vendorName,
        category,
        unit_cost_raw: unitCostRaw,
      };
    })
    .filter((row): row is ImportPreviewRow => row !== null);

  return {
    preview,
    summary: {
      itemsReady: preview.length,
      duplicates,
      missingUnit,
      missingPackSize,
      emptyNameRows,
    },
  };
}

export function buildIssueItems(items: CatalogItem[]): IssueItem[] {
  const skuMap: Record<string, number> = {};
  items.forEach((item) => {
    const sku = (item.vendor_sku || "").trim().toLowerCase();
    if (!sku) return;
    skuMap[sku] = (skuMap[sku] || 0) + 1;
  });

  return items.flatMap((item) => {
    const reasons: string[] = [];
    const itemName = (item.item_name || "").trim();
    const unit = (item.unit || "").trim();
    const sku = (item.vendor_sku || "").trim().toLowerCase();
    const packSize = (item.pack_size || "").trim();
    const vendor = (item.vendor_name || "").trim();

    if (!itemName) reasons.push("Missing Item Name");
    if (!unit) reasons.push("Missing Unit");
    if (!packSize) reasons.push("Missing Pack Size");
    if (!vendor) reasons.push("Missing Vendor");
    if (item.default_unit_cost == null) reasons.push("Missing Price");
    if (sku && skuMap[sku] > 1) reasons.push("Duplicate Item Number");

    return reasons.length > 0 ? [{ ...item, reasons }] : [];
  });
}

export function getAICategory(itemName: string): string {
  const lowerName = itemName.toLowerCase();
  for (const [category, keywords] of Object.entries(AI_CATEGORY_MAP)) {
    if (keywords.some((keyword) => lowerName.includes(keyword))) return category;
  }
  return "Other";
}

export type CategorySuggestion = {
  categoryName: string;
  items: { id: string; item_name: string }[];
};

export function buildCategorySuggestions(
  items: { id: string; item_name: string }[],
): CategorySuggestion[] {
  const grouped = new Map<string, { id: string; item_name: string }[]>();
  for (const item of items) {
    const cat = getAICategory(item.item_name);
    const bucket = grouped.get(cat);
    if (bucket) {
      bucket.push(item);
    } else {
      grouped.set(cat, [item]);
    }
  }
  return Array.from(grouped.entries())
    .map(([categoryName, categoryItems]) => ({ categoryName, items: categoryItems }))
    .sort((a, b) => a.categoryName.localeCompare(b.categoryName));
}

export function itemDroppableId(categoryName: string, isFlatAllItems: boolean): string {
  if (isFlatAllItems && categoryName === "All Items") return "All Items";
  return `items::${categoryName}`;
}

export function parseItemDroppableId(droppableId: string): string {
  if (droppableId.startsWith("items::")) return droppableId.slice(7);
  return droppableId;
}

export function getOrderedNamedCategoryKeys(
  grouped: Record<string, CatalogItem[]>,
  categories: ListCategory[],
): string[] {
  return [...categories]
    .sort((left, right) => left.sort_order - right.sort_order)
    .map((category) => category.name)
    .filter((name) => Object.prototype.hasOwnProperty.call(grouped, name));
}

export function getOrderedFullGroupKeys(
  grouped: Record<string, CatalogItem[]>,
  categories: ListCategory[],
): string[] {
  const ordered: string[] = [];
  if (Object.prototype.hasOwnProperty.call(grouped, "Uncategorized")) {
    ordered.push("Uncategorized");
  }
  [...categories]
    .sort((left, right) => left.sort_order - right.sort_order)
    .forEach((category) => {
      if (Object.prototype.hasOwnProperty.call(grouped, category.name)) {
        ordered.push(category.name);
      }
    });
  return ordered;
}

export function getCurrentSetId(args: {
  selectedListId: string | null | undefined;
  advancedListView: AdvancedListView;
  categorySets: CategorySet[];
  listCategories: ListCategory[];
  itemCategoryMaps: ItemCategoryMap[];
}): string | null {
  const { selectedListId, advancedListView, categorySets, listCategories, itemCategoryMaps } = args;
  if (!selectedListId) return null;
  if (advancedListView === "keyword-groups") {
    return (
      categorySets.find((set) => set.list_id === selectedListId && set.set_type === "custom_ai")?.id ?? null
    );
  }
  if (advancedListView === null) {
    const manualSet = categorySets.find(
      (set) => set.list_id === selectedListId && set.set_type === "user_manual",
    );
    const hasShelfData =
      !!manualSet &&
      (listCategories.some((category) => category.category_set_id === manualSet.id) ||
        itemCategoryMaps.some((mapping) => mapping.category_set_id === manualSet.id));
    return hasShelfData ? manualSet?.id ?? null : manualSet?.id ?? null;
  }
  return null;
}

export function getCurrentCategories(args: {
  selectedListId: string | null | undefined;
  advancedListView: AdvancedListView;
  categorySets: CategorySet[];
  listCategories: ListCategory[];
  itemCategoryMaps: ItemCategoryMap[];
}): ListCategory[] {
  const setId = getCurrentSetId(args);
  if (!setId) return [];
  return args.listCategories.filter((category) => category.category_set_id === setId);
}

export function getCurrentMappings(args: {
  selectedListId: string | null | undefined;
  advancedListView: AdvancedListView;
  categorySets: CategorySet[];
  listCategories: ListCategory[];
  itemCategoryMaps: ItemCategoryMap[];
}): ItemCategoryMap[] {
  const setId = getCurrentSetId(args);
  if (!setId) return [];
  return args.itemCategoryMaps.filter((mapping) => mapping.category_set_id === setId);
}

export function filterCatalogItems(items: CatalogItem[], detailSearch: string): CatalogItem[] {
  if (!detailSearch.trim()) return items;
  const q = detailSearch.toLowerCase().trim();
  return items.filter((item) =>
    (item.item_name ?? "").toLowerCase().includes(q) ||
    (item.vendor_sku ?? "").toLowerCase().includes(q) ||
    (item.brand_name ?? "").toLowerCase().includes(q) ||
    (item.vendor_name ?? "").toLowerCase().includes(q) ||
    (item.pack_size ?? "").toLowerCase().includes(q) ||
    (item.category ?? "").toLowerCase().includes(q)
  );
}

function groupByCategoryMaps(args: {
  items: CatalogItem[];
  categories: ListCategory[];
  mappings: ItemCategoryMap[];
}): Record<string, CatalogItem[]> {
  const { items, categories, mappings } = args;
  const grouped: Record<string, CatalogItem[]> = {};
  const itemMapLookup = new Map<string, ItemCategoryMap>();

  mappings.forEach((mapping) => itemMapLookup.set(mapping.catalog_item_id, mapping));

  const uncategorized = items
    .filter((item) => {
      const mapping = itemMapLookup.get(item.id);
      return !mapping || !mapping.category_id;
    })
    .sort((left, right) => {
      const leftMap = itemMapLookup.get(left.id);
      const rightMap = itemMapLookup.get(right.id);
      return (leftMap?.item_sort_order ?? left.sort_order ?? 0) - (rightMap?.item_sort_order ?? right.sort_order ?? 0);
    });
  grouped.Uncategorized = uncategorized;

  [...categories]
    .sort((left, right) => left.sort_order - right.sort_order)
    .forEach((category) => {
      grouped[category.name] = items
        .filter((item) => itemMapLookup.get(item.id)?.category_id === category.id)
        .sort((left, right) => {
          const leftMap = itemMapLookup.get(left.id);
          const rightMap = itemMapLookup.get(right.id);
          return (leftMap?.item_sort_order ?? 0) - (rightMap?.item_sort_order ?? 0);
        });
    });

  const filtered = Object.fromEntries(
    Object.entries(grouped).filter(([key, value]) => value.length > 0 || key === "Uncategorized"),
  );

  return Object.keys(filtered).length > 0 ? filtered : { Uncategorized: [] };
}

export function groupCatalogItems(args: {
  items: CatalogItem[];
  selectedListId: string | null | undefined;
  advancedListView: AdvancedListView;
  categorySets: CategorySet[];
  listCategories: ListCategory[];
  itemCategoryMaps: ItemCategoryMap[];
  recentPurchasedItems: RecentPurchasedItem[];
}): Record<string, CatalogItem[]> {
  const {
    items,
    selectedListId,
    advancedListView,
    categorySets,
    listCategories,
    itemCategoryMaps,
    recentPurchasedItems,
  } = args;

  if (advancedListView === "keyword-groups") {
    return groupByCategoryMaps({
      items,
      categories: getCurrentCategories({
        selectedListId,
        advancedListView,
        categorySets,
        listCategories,
        itemCategoryMaps,
      }),
      mappings: getCurrentMappings({
        selectedListId,
        advancedListView,
        categorySets,
        listCategories,
        itemCategoryMaps,
      }),
    });
  }

  if (advancedListView === null) {
    const manualSet = categorySets.find(
      (set) => selectedListId && set.list_id === selectedListId && set.set_type === "user_manual",
    );
    const hasShelfData =
      !!manualSet &&
      (listCategories.some((category) => category.category_set_id === manualSet.id) ||
        itemCategoryMaps.some((mapping) => mapping.category_set_id === manualSet.id));
    if (!hasShelfData) return { "All Items": items };
    return groupByCategoryMaps({
      items,
      categories: getCurrentCategories({
        selectedListId,
        advancedListView,
        categorySets,
        listCategories,
        itemCategoryMaps,
      }),
      mappings: getCurrentMappings({
        selectedListId,
        advancedListView,
        categorySets,
        listCategories,
        itemCategoryMaps,
      }),
    });
  }

  if (advancedListView === "recent") {
    const matched: CatalogItem[] = [];
    const unmatched: CatalogItem[] = [];

    items.forEach((item) => {
      const match = recentPurchasedItems.find((recentItem) => {
        if (item.vendor_sku && recentItem.vendor_sku) {
          return item.vendor_sku.toLowerCase().trim() === recentItem.vendor_sku.toLowerCase().trim();
        }
        return item.item_name.toLowerCase().trim() === (recentItem.item_name || "").toLowerCase().trim();
      });
      if (match) matched.push(item);
      else unmatched.push(item);
    });

    const groups: Record<string, CatalogItem[]> = {};
    if (matched.length > 0) groups["Recently Purchased"] = matched;
    if (unmatched.length > 0) groups["Not Recently Purchased"] = unmatched;
    return Object.keys(groups).length > 0 ? groups : { "All Items": items };
  }

  return { "All Items": items };
}

export function buildSortedLists(
  lists: InventoryListRow[],
  gridSearch: string,
  gridSort: GridSort,
): InventoryListRow[] {
  const normalizedSearch = gridSearch.toLowerCase();
  return [...lists]
    .filter((list) => !gridSearch || list.name.toLowerCase().includes(normalizedSearch))
    .sort((left, right) =>
      gridSort === "name"
        ? left.name.localeCompare(right.name)
        : new Date(right.created_at).getTime() - new Date(left.created_at).getTime(),
    );
}

export function buildListItemCounts(
  items: Array<Pick<CatalogItem, "inventory_list_id">>,
): Record<string, number> {
  const counts: Record<string, number> = {};
  items.forEach((item) => {
    if (!item.inventory_list_id) return;
    counts[item.inventory_list_id] = (counts[item.inventory_list_id] || 0) + 1;
  });
  return counts;
}

export function buildRecentPurchasedItems(items: RecentPurchasedItem[]): RecentPurchasedItem[] {
  const seen = new Map<string, RecentPurchasedItem>();
  items.forEach((item) => {
    const key = (item.item_name || "").toLowerCase().trim();
    const existing = seen.get(key);
    if (!existing || new Date(item.purchase_date) > new Date(existing.purchase_date)) {
      seen.set(key, item);
    }
  });
  return Array.from(seen.values());
}

export function getCategorySetTypeForView(view: AdvancedListView): CategorySetType {
  return view === "keyword-groups" ? "custom_ai" : "user_manual";
}

// ─── List Validation ──────────────────────────────────────────────────────────

export type ListValidationResult = {
  totalItems: number;
  healthPercent: number;
  missingPrice: number;
  missingPackSize: number;
  missingSku: number;
  missingVendor: number;
  uncategorized: number;
  duplicateNames: number;
  badPackParse: number;
};

type ValidatableItem = {
  id: string;
  item_name: string;
  default_unit_cost: number | null;
  pack_size: string | null;
  vendor_sku: string | null;
  vendor_name: string | null;
  brand_name: string | null;
  pack_parse_success: boolean;
};

/**
 * Validates catalog item quality. `categorizedItemIds` should contain item IDs
 * that have an explicit non-null category assignment in the active set. If the
 * set is empty (no category structure exists yet) uncategorized is reported as 0
 * rather than penalizing every item.
 */
export function validateCatalogItems(
  items: ValidatableItem[],
  categorizedItemIds: ReadonlySet<string>,
): ListValidationResult {
  const total = items.length;
  if (total === 0) {
    return {
      totalItems: 0,
      healthPercent: 100,
      missingPrice: 0,
      missingPackSize: 0,
      missingSku: 0,
      missingVendor: 0,
      uncategorized: 0,
      duplicateNames: 0,
      badPackParse: 0,
    };
  }

  const skuCounts = new Map<string, number>();
  for (const item of items) {
    const sku = (item.vendor_sku ?? "").trim().toLowerCase();
    if (!sku) continue;
    skuCounts.set(sku, (skuCounts.get(sku) ?? 0) + 1);
  }

  const hasCategoryStructure = categorizedItemIds.size > 0;

  let missingPrice = 0;
  let missingPackSize = 0;
  let missingSku = 0;
  let missingVendor = 0;
  let uncategorized = 0;
  let duplicateNames = 0;
  let badPackParse = 0;
  let cleanItems = 0;

  for (const item of items) {
    const hasMissingPrice = item.default_unit_cost == null;
    const hasMissingPack = item.pack_size == null || item.pack_size.trim() === "";
    const hasMissingSku = item.vendor_sku == null || item.vendor_sku.trim() === "";
    const hasMissingVendor =
      (item.vendor_name == null || item.vendor_name.trim() === "") &&
      (item.brand_name == null || item.brand_name.trim() === "");
    const isUncategorized = hasCategoryStructure && !categorizedItemIds.has(item.id);
    const itemSku = (item.vendor_sku ?? "").trim().toLowerCase();
    const isDuplicate = !!itemSku && (skuCounts.get(itemSku) ?? 0) > 1;
    const hasBadPack =
      !item.pack_parse_success &&
      item.pack_size != null &&
      item.pack_size.trim() !== "";

    if (hasMissingPrice) missingPrice++;
    if (hasMissingPack) missingPackSize++;
    if (hasMissingSku) missingSku++;
    if (hasMissingVendor) missingVendor++;
    if (isUncategorized) uncategorized++;
    if (isDuplicate) duplicateNames++;
    if (hasBadPack) badPackParse++;

    const hasAnyIssue =
      hasMissingPrice ||
      hasMissingPack ||
      hasMissingSku ||
      hasMissingVendor ||
      isUncategorized ||
      isDuplicate ||
      hasBadPack;
    if (!hasAnyIssue) cleanItems++;
  }

  return {
    totalItems: total,
    healthPercent: Math.round((cleanItems / total) * 100),
    missingPrice,
    missingPackSize,
    missingSku,
    missingVendor,
    uncategorized,
    duplicateNames,
    badPackParse,
  };
}
