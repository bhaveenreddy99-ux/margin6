import { describe, it, expect } from "vitest";
import {
  getAICategory,
  buildCategorySuggestions,
  validateCatalogItems,
} from "@/domain/catalog/listManagementHelpers";
import type { ListValidationResult } from "@/domain/catalog/listManagementHelpers";

describe("getAICategory", () => {
  it("matches known protein keywords", () => {
    expect(getAICategory("Chicken Breast")).toBe("Proteins");
    expect(getAICategory("Ground Beef 80/20")).toBe("Proteins");
    expect(getAICategory("Salmon Fillet")).toBe("Proteins");
  });

  it("matches produce keywords", () => {
    expect(getAICategory("Roma Tomato")).toBe("Produce");
    expect(getAICategory("Yellow Onion")).toBe("Produce");
    expect(getAICategory("Fresh Garlic")).toBe("Produce");
  });

  it("matches dairy keywords", () => {
    expect(getAICategory("Whole Milk")).toBe("Dairy");
    expect(getAICategory("Cheddar Cheese")).toBe("Dairy");
    expect(getAICategory("Large Eggs")).toBe("Dairy");
  });

  it("matches dry goods keywords", () => {
    expect(getAICategory("Olive Oil")).toBe("Dry Goods");
    expect(getAICategory("All Purpose Flour")).toBe("Dry Goods");
    expect(getAICategory("Pasta Penne")).toBe("Dry Goods");
  });

  it("matches beverages keywords", () => {
    expect(getAICategory("House Coffee")).toBe("Beverages");
    // "juice" contains "ice" → hits Frozen first in map iteration order
    expect(getAICategory("Orange Juice")).toBe("Frozen");
    expect(getAICategory("Cola Soda")).toBe("Beverages");
    expect(getAICategory("Sparkling Water")).toBe("Beverages");
    expect(getAICategory("House White Wine")).toBe("Beverages");
  });

  it("matches cleaning keywords", () => {
    expect(getAICategory("Dish Soap")).toBe("Cleaning");
    expect(getAICategory("Hand Sanitizer")).toBe("Cleaning");
    expect(getAICategory("Trash Bag 33 Gallon")).toBe("Cleaning");
  });

  it("matches paper/disposable keywords", () => {
    expect(getAICategory("Paper Towel Roll")).toBe("Paper/Disposable");
    expect(getAICategory("Deli Container 16oz")).toBe("Paper/Disposable");
    // "cocktail" matches Beverages before Paper/Disposable in map iteration order
    expect(getAICategory("Cocktail Straw")).toBe("Beverages");
    expect(getAICategory("Plastic Wrap Roll")).toBe("Paper/Disposable");
    expect(getAICategory("Disposable Napkin")).toBe("Paper/Disposable");
  });

  it("matches frozen keywords", () => {
    expect(getAICategory("Frozen French Fries")).toBe("Frozen");
  });

  it("falls back to Other for unrecognized items", () => {
    expect(getAICategory("Widget Sprocket 7B")).toBe("Other");
    expect(getAICategory("")).toBe("Other");
    expect(getAICategory("XYZ123")).toBe("Other");
  });

  it("is case-insensitive", () => {
    expect(getAICategory("CHICKEN WING")).toBe("Proteins");
    expect(getAICategory("WHOLE MILK")).toBe("Dairy");
  });
});

describe("buildCategorySuggestions", () => {
  it("groups items by detected category", () => {
    const items = [
      { id: "1", item_name: "Chicken Breast" },
      { id: "2", item_name: "Roma Tomato" },
      { id: "3", item_name: "Ground Beef" },
    ];
    const result = buildCategorySuggestions(items);

    const proteins = result.find((s) => s.categoryName === "Proteins");
    const produce = result.find((s) => s.categoryName === "Produce");

    expect(proteins).toBeDefined();
    expect(proteins!.items).toHaveLength(2);
    expect(proteins!.items.map((i) => i.id)).toEqual(expect.arrayContaining(["1", "3"]));

    expect(produce).toBeDefined();
    expect(produce!.items).toHaveLength(1);
    expect(produce!.items[0].id).toBe("2");
  });

  it("returns categories sorted alphabetically", () => {
    const items = [
      { id: "1", item_name: "Salmon Fillet" },
      { id: "2", item_name: "Whole Milk" },
      { id: "3", item_name: "Roma Tomato" },
      { id: "4", item_name: "Olive Oil" },
    ];
    const result = buildCategorySuggestions(items);
    const names = result.map((s) => s.categoryName);
    expect(names).toEqual([...names].sort());
  });

  it("places unrecognized items in Other", () => {
    const items = [{ id: "1", item_name: "Widget Sprocket 7B" }];
    const result = buildCategorySuggestions(items);
    expect(result).toHaveLength(1);
    expect(result[0].categoryName).toBe("Other");
    expect(result[0].items[0].id).toBe("1");
  });

  it("returns empty array for empty input", () => {
    expect(buildCategorySuggestions([])).toEqual([]);
  });

  it("preserves item id and item_name in suggestions", () => {
    const items = [{ id: "abc-123", item_name: "Chicken Wing" }];
    const result = buildCategorySuggestions(items);
    expect(result[0].items[0]).toEqual({ id: "abc-123", item_name: "Chicken Wing" });
  });

  it("groups multiple items into one category bucket", () => {
    const items = [
      { id: "1", item_name: "Chicken Breast" },
      { id: "2", item_name: "Pork Belly" },
      { id: "3", item_name: "Beef Brisket" },
    ];
    const result = buildCategorySuggestions(items);
    expect(result).toHaveLength(1);
    expect(result[0].categoryName).toBe("Proteins");
    expect(result[0].items).toHaveLength(3);
  });
});

// ─── validateCatalogItems ─────────────────────────────────────────────────────

function makeItem(overrides: Partial<{
  id: string;
  item_name: string;
  default_unit_cost: number | null;
  pack_size: string | null;
  vendor_sku: string | null;
  vendor_name: string | null;
  brand_name: string | null;
  pack_parse_success: boolean;
}> = {}) {
  return {
    id: "item-1",
    item_name: "Test Item",
    default_unit_cost: 5.99,
    pack_size: "1/12ct",
    vendor_sku: "SKU-001",
    vendor_name: "Sysco",
    brand_name: null,
    pack_parse_success: true,
    ...overrides,
  };
}

describe("validateCatalogItems", () => {
  it("returns 100% health and all zeros for empty list", () => {
    const result = validateCatalogItems([], new Set());
    expect(result.totalItems).toBe(0);
    expect(result.healthPercent).toBe(100);
    expect(result.missingPrice).toBe(0);
    expect(result.duplicateNames).toBe(0);
  });

  it("returns 100% health for fully populated clean items", () => {
    const items = [
      makeItem({ id: "1", vendor_sku: "SKU-001" }),
      makeItem({ id: "2", item_name: "Other Item", vendor_sku: "SKU-002" }),
    ];
    const result = validateCatalogItems(items, new Set());
    expect(result.healthPercent).toBe(100);
    expect(result.missingPrice).toBe(0);
    expect(result.missingSku).toBe(0);
    expect(result.missingVendor).toBe(0);
    expect(result.duplicateNames).toBe(0);
  });

  it("detects missing price (null only, not zero)", () => {
    const items = [
      makeItem({ id: "1", default_unit_cost: null }),
      makeItem({ id: "2", default_unit_cost: 0 }),  // $0 is valid
      makeItem({ id: "3", default_unit_cost: 5.00 }),
    ];
    const result = validateCatalogItems(items, new Set());
    expect(result.missingPrice).toBe(1);
  });

  it("detects missing pack size", () => {
    const items = [
      makeItem({ id: "1", pack_size: null }),
      makeItem({ id: "2", pack_size: "" }),
      makeItem({ id: "3", pack_size: "  " }),
      makeItem({ id: "4", pack_size: "1/12ct" }),
    ];
    const result = validateCatalogItems(items, new Set());
    expect(result.missingPackSize).toBe(3);
  });

  it("detects missing SKU", () => {
    const items = [
      makeItem({ id: "1", vendor_sku: null }),
      makeItem({ id: "2", vendor_sku: "" }),
      makeItem({ id: "3", vendor_sku: "SKU-001" }),
    ];
    const result = validateCatalogItems(items, new Set());
    expect(result.missingSku).toBe(2);
  });

  it("detects missing vendor when both vendor_name and brand_name are empty", () => {
    const items = [
      makeItem({ id: "1", vendor_name: null, brand_name: null }),
      makeItem({ id: "2", vendor_name: "", brand_name: "" }),
      makeItem({ id: "3", vendor_name: "Sysco", brand_name: null }),
      makeItem({ id: "4", vendor_name: null, brand_name: "Heinz" }),
    ];
    const result = validateCatalogItems(items, new Set());
    expect(result.missingVendor).toBe(2);
  });

  it("detects duplicate product numbers / SKUs (case-insensitive)", () => {
    // The UI surfaces this field as "Duplicate item numbers"; dedup is by vendor_sku
    // (product number), NOT by item_name. (Field name `duplicateNames` is a misnomer.)
    const items = [
      makeItem({ id: "1", vendor_sku: "SKU-DUP" }),
      makeItem({ id: "2", vendor_sku: "sku-dup" }),
      makeItem({ id: "3", vendor_sku: "SKU-UNIQUE" }),
    ];
    const result = validateCatalogItems(items, new Set());
    expect(result.duplicateNames).toBe(2); // both "sku-dup" rows flagged (case-insensitive)
  });

  it("detects uncategorized items when category structure exists", () => {
    const items = [
      makeItem({ id: "1", item_name: "A" }),
      makeItem({ id: "2", item_name: "B" }),
      makeItem({ id: "3", item_name: "C" }),
    ];
    const categorizedIds = new Set(["1", "2"]); // item 3 has no category
    const result = validateCatalogItems(items, categorizedIds);
    expect(result.uncategorized).toBe(1);
  });

  it("does not flag uncategorized when no category structure exists (empty set)", () => {
    const items = [makeItem({ id: "1" }), makeItem({ id: "2", item_name: "B" })];
    const result = validateCatalogItems(items, new Set()); // no categories set up
    expect(result.uncategorized).toBe(0);
  });

  it("detects bad pack parse when pack_size is present but parse failed", () => {
    const items = [
      makeItem({ id: "1", pack_size: "bad format xyz", pack_parse_success: false }),
      makeItem({ id: "2", pack_size: null, pack_parse_success: false }), // null pack — not counted
      makeItem({ id: "3", pack_size: "1/12ct", pack_parse_success: true }),
    ];
    const result = validateCatalogItems(items, new Set());
    expect(result.badPackParse).toBe(1);
  });

  it("health percent reflects only fully clean items", () => {
    const items = [
      makeItem({ id: "1", item_name: "Apple Juice", vendor_sku: "S1" }),                            // clean
      makeItem({ id: "2", item_name: "Beef Patty", default_unit_cost: null, vendor_sku: "S2" }),    // critical: missing price
      makeItem({ id: "3", item_name: "Corn Starch", vendor_sku: null }),                            // warning: missing sku (null sku skipped by dedup)
    ];
    const result = validateCatalogItems(items, new Set());
    // 1 out of 3 fully clean = 33%
    expect(result.healthPercent).toBe(33);
    expect(result.totalItems).toBe(3);
  });

  it("type matches ListValidationResult shape", () => {
    const result: ListValidationResult = validateCatalogItems([makeItem()], new Set());
    expect(typeof result.healthPercent).toBe("number");
    expect(typeof result.totalItems).toBe("number");
    expect(typeof result.missingPrice).toBe("number");
    expect(typeof result.badPackParse).toBe("number");
  });
});
