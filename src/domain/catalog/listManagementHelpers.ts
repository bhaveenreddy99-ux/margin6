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
  { field: "pack_size", syns: ["pack", "size", "case", "qty"] },
  { field: "brand_name", syns: ["brand", "manufacturer", "mfg"] },
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
  const seenNames = new Set<string>();

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

      if (!itemName) {
        emptyNameRows += 1;
        return null;
      }

      const normalizedName = itemName.toLowerCase();
      if (seenNames.has(normalizedName)) duplicates += 1;
      seenNames.add(normalizedName);
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

    if (!itemName) reasons.push("Missing Item Name");
    if (!unit) reasons.push("Missing Unit");
    if (sku && skuMap[sku] > 1) reasons.push("Duplicate Product Number");

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
  if (!detailSearch) return items;
  const normalizedSearch = detailSearch.toLowerCase();
  return items.filter((item) => item.item_name.toLowerCase().includes(normalizedSearch));
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
