import { describe, expect, it } from "vitest";
import {
  parseUnitsPerPlanningUnitFromPackSize,
  resolvePlanningUnitMetaFromCatalogItem,
  zoneEntryUnitOptions,
} from "@/domain/inventory/planningUnitMeta";
import type { InventoryCatalogItemRow } from "@/domain/inventory/enterInventoryTypes";

function catalog(overrides: Partial<InventoryCatalogItemRow> = {}): InventoryCatalogItemRow {
  return {
    id: "cat-1",
    restaurant_id: "r1",
    item_name: "Chicken",
    brand_name: null,
    category: null,
    cost_unit: null,
    created_at: "",
    default_par_level: null,
    default_unit_cost: null,
    inventory_list_id: "list-1",
    list_category_id: null,
    metadata: null,
    pack_parse_success: true,
    pack_size: "40 lb",
    product_number: null,
    sort_order: 0,
    total_per_case: null,
    unit: "lb",
    unit_size: null,
    unit_type: null,
    units_per_case: null,
    updated_at: "",
    vendor_name: null,
    vendor_sku: null,
    ...overrides,
  };
}

describe("planningUnitMeta", () => {
  describe("parseUnitsPerPlanningUnitFromPackSize", () => {
    it("reads first positive number", () => {
      expect(parseUnitsPerPlanningUnitFromPackSize("40 lb")).toBe(40);
      expect(parseUnitsPerPlanningUnitFromPackSize("10 lb Case")).toBe(10);
      expect(parseUnitsPerPlanningUnitFromPackSize("960 each")).toBe(960);
    });
    it("returns null when unusable", () => {
      expect(parseUnitsPerPlanningUnitFromPackSize(null)).toBeNull();
      expect(parseUnitsPerPlanningUnitFromPackSize("")).toBeNull();
      expect(parseUnitsPerPlanningUnitFromPackSize("no numbers")).toBeNull();
    });
  });

  describe("zoneEntryUnitOptions", () => {
    it("returns planning and base labels", () => {
      const m = resolvePlanningUnitMetaFromCatalogItem(catalog());
      expect(m).not.toBeNull();
      const opts = zoneEntryUnitOptions(m!);
      expect(opts.map((o) => o.value)).toEqual(["case", "lb"]);
    });
  });

  describe("resolvePlanningUnitMetaFromCatalogItem", () => {
    it("resolves chicken-style meta", () => {
      const m = resolvePlanningUnitMetaFromCatalogItem(catalog());
      expect(m).toEqual({
        planning_unit: "case",
        count_base_unit: "lb",
        units_per_planning_unit: 40,
      });
    });
    it("falls back to session pack/unit", () => {
      const m = resolvePlanningUnitMetaFromCatalogItem(
        catalog({ unit: null, pack_size: null }),
        { unit: "lb", pack_size: "40 lb" },
      );
      expect(m?.count_base_unit).toBe("lb");
      expect(m?.units_per_planning_unit).toBe(40);
    });
    it("returns null without base unit or pack", () => {
      expect(resolvePlanningUnitMetaFromCatalogItem(catalog({ unit: null, pack_size: null }))).toBeNull();
    });
  });
});
