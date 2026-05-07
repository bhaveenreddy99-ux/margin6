import { describe, it, expect } from "vitest";
import {
  buildParGuideLevelMaps,
  resolveParLevelFromGuideMaps,
  resolveParFromLookupArgs,
  type ParGuideLevelMaps,
} from "@/domain/inventory/parGuideLevels";
import type { ApprovedParLookupArgs } from "@/domain/inventory/enterInventoryTypes";

// ── resolveParLevelFromGuideMaps ─────────────────────────────────────────────

describe("resolveParLevelFromGuideMaps", () => {
  const maps: ParGuideLevelMaps = buildParGuideLevelMaps([
    { item_name: "Chicken Breast", par_level: 10, catalog_item_id: "sku-001" },
    { item_name: "Ground Beef", par_level: 8, catalog_item_id: null },
  ]);

  it("guide match by catalog_item_id (highest priority)", () => {
    const result = resolveParLevelFromGuideMaps(
      { catalog_item_id: "sku-001", item_name: "chicken breast" },
      maps,
      3,
    );
    expect(result.parLevel).toBe(10);
    expect(result.source).toBe("catalog_id");
  });

  it("guide match by item_name when no catalog id on line", () => {
    const result = resolveParLevelFromGuideMaps(
      { catalog_item_id: null, item_name: "Ground Beef" },
      maps,
      3,
    );
    expect(result.parLevel).toBe(8);
    expect(result.source).toBe("item_name");
  });

  it("session par fallback when guide has no match", () => {
    const result = resolveParLevelFromGuideMaps(
      { catalog_item_id: "sku-999", item_name: "Unknown Item" },
      maps,
      7,
    );
    expect(result.parLevel).toBe(7);
    expect(result.source).toBe("session_default");
  });

  it("catalog default fallback when guide and session have no match", () => {
    const result = resolveParLevelFromGuideMaps(
      { catalog_item_id: "sku-999", item_name: "Unknown Item" },
      maps,
      0,
      { byId: { "sku-999": 6 }, byName: {} },
    );
    expect(result.parLevel).toBe(6);
    expect(result.source).toBe("catalog_default");
  });

  it("catalog default by name when id not in catalog defaults", () => {
    const result = resolveParLevelFromGuideMaps(
      { catalog_item_id: null, item_name: "Salmon Fillet" },
      maps,
      0,
      { byId: {}, byName: { "salmon fillet": 4 } },
    );
    expect(result.parLevel).toBe(4);
    expect(result.source).toBe("catalog_default");
  });

  it("no par returns 0 when nothing matches", () => {
    const result = resolveParLevelFromGuideMaps(
      { catalog_item_id: null, item_name: "Neon Turnip" },
      maps,
      0,
    );
    expect(result.parLevel).toBe(0);
    expect(result.source).toBe("no_par");
  });

  it("null maps use session par", () => {
    const result = resolveParLevelFromGuideMaps(
      { catalog_item_id: "sku-001", item_name: "Chicken Breast" },
      null,
      5,
    );
    expect(result.parLevel).toBe(5);
    expect(result.source).toBe("session_default");
  });

  it("null maps with no session par fall back to catalog default", () => {
    const result = resolveParLevelFromGuideMaps(
      { catalog_item_id: "sku-001", item_name: "Chicken Breast" },
      null,
      0,
      { byId: { "sku-001": 12 }, byName: {} },
    );
    expect(result.parLevel).toBe(12);
    expect(result.source).toBe("catalog_default");
  });
});

// ── resolveParFromLookupArgs ─────────────────────────────────────────────────

describe("resolveParFromLookupArgs", () => {
  const baseArgs: ApprovedParLookupArgs = {
    countingParGuideId: null,
    countingParByCatalogId: {},
    countingParByNormalizedName: {},
    approvedParMap: { "chicken breast": 10 },
    catalogDefaultParById: { "sku-001": 9 },
    catalogDefaultParByName: { "ground beef": 8 },
  };

  it("matches approved par map by name when no counting guide", () => {
    const result = resolveParFromLookupArgs(
      { catalog_item_id: null, item_name: "Chicken Breast", par_level: null },
      baseArgs,
    );
    expect(result.parLevel).toBe(10);
    expect(result.source).toBe("item_name");
  });

  it("falls back to session par when name not in approved map", () => {
    const result = resolveParFromLookupArgs(
      { catalog_item_id: null, item_name: "Salmon", par_level: 6 },
      baseArgs,
    );
    expect(result.parLevel).toBe(6);
    expect(result.source).toBe("session_default");
  });

  it("falls back to catalog default by id when guide and session have nothing", () => {
    const result = resolveParFromLookupArgs(
      { catalog_item_id: "sku-001", item_name: "Salmon", par_level: 0 },
      baseArgs,
    );
    expect(result.parLevel).toBe(9);
    expect(result.source).toBe("catalog_default");
  });

  it("falls back to catalog default by name when no session par or id match", () => {
    const result = resolveParFromLookupArgs(
      { catalog_item_id: null, item_name: "Ground Beef", par_level: 0 },
      baseArgs,
    );
    expect(result.parLevel).toBe(8);
    expect(result.source).toBe("catalog_default");
  });

  it("no par returns 0 when nothing matches", () => {
    const result = resolveParFromLookupArgs(
      { catalog_item_id: null, item_name: "Neon Turnip", par_level: 0 },
      baseArgs,
    );
    expect(result.parLevel).toBe(0);
    expect(result.source).toBe("no_par");
  });

  it("counting guide active: uses counting maps, ignores catalog defaults", () => {
    const args: ApprovedParLookupArgs = {
      ...baseArgs,
      countingParGuideId: "guide-1",
      countingParByCatalogId: { "sku-001": 15 },
      countingParByNormalizedName: {},
    };
    const result = resolveParFromLookupArgs(
      { catalog_item_id: "sku-001", item_name: "Chicken Breast", par_level: 5 },
      args,
    );
    expect(result.parLevel).toBe(15);
    expect(result.source).toBe("catalog_id");
  });

  it("counting guide active: falls back to session par, not catalog defaults", () => {
    const args: ApprovedParLookupArgs = {
      ...baseArgs,
      countingParGuideId: "guide-1",
      countingParByCatalogId: {},
      countingParByNormalizedName: {},
    };
    // sku-001 is in catalogDefaultParById but should NOT be used
    const result = resolveParFromLookupArgs(
      { catalog_item_id: "sku-001", item_name: "Chicken Breast", par_level: 7 },
      args,
    );
    expect(result.parLevel).toBe(7);
    expect(result.source).toBe("session_default");
  });
});
