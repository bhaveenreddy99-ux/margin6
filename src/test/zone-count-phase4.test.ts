import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import type { InventorySessionItemRow } from "@/domain/inventory/enterInventoryTypes";
import { buildSessionItemsWithApprovedPar } from "@/domain/inventory/sessionSelectors";
import { buildSmartOrderComputedItems } from "@/domain/inventory/items/itemView";
import { prepareSmartOrderFromSession } from "@/domain/inventory/smartOrderFromSession";
import { listCategoryIdForZoneStrip } from "@/domain/inventory/zoneCountUi";

function asSupabase(value: unknown) {
  return value as SupabaseClient<Database>;
}

function baseSessionItem(overrides: Partial<InventorySessionItemRow> = {}): InventorySessionItemRow {
  return {
    id: "si-1",
    session_id: "sess-1",
    brand_name: null,
    category: "Produce",
    conversion_formula: null,
    counted_as: null,
    counted_value: null,
    item_name: "Tomatoes",
    lead_time_days: null,
    metadata: null,
    unit: "case",
    current_stock: 4,
    par_level: 10,
    unit_cost: 2,
    vendor_sku: null,
    pack_size: "40 lb",
    vendor_name: null,
    stock_unit: null,
    catalog_item_id: "cat-1",
    ...overrides,
  } as InventorySessionItemRow;
}

describe("zone count phase 4", () => {
  it("listCategoryIdForZoneStrip uses item name map, not section titles", () => {
    const entry = {
      catalog_item_id: "cat-1",
      category_id: "lc-1" as string | null,
      category_name: "C",
      item_sort_order: 0,
    };
    const mapA = { byId: {} as Record<string, typeof entry>, byName: { A: entry } };
    expect(
      listCategoryIdForZoneStrip(
        { item_name: "A", catalog_item_id: null },
        mapA,
        true,
      ),
    ).toBe("lc-1");
    expect(
      listCategoryIdForZoneStrip(
        { item_name: "A", catalog_item_id: "cat-1" },
        { byId: { "cat-1": entry }, byName: {} },
        true,
      ),
    ).toBe("lc-1");
    expect(listCategoryIdForZoneStrip({ item_name: "A", catalog_item_id: null }, { byId: {}, byName: {} }, true)).toBe(
      null,
    );
    const mapNull = { byId: {} as Record<string, typeof entry>, byName: { A: { ...entry, category_id: null } } };
    expect(listCategoryIdForZoneStrip({ item_name: "A", catalog_item_id: null }, mapNull, true)).toBe(null);
    expect(listCategoryIdForZoneStrip({ item_name: "A", catalog_item_id: null }, mapA, false)).toBe(null);
  });

  it("buildSmartOrderComputedItems uses parent current_stock only (legacy row)", () => {
    const [row] = buildSmartOrderComputedItems({
      sessionItems: [baseSessionItem({ current_stock: 7 })],
      parMaps: null,
      riskThresholds: { redThresholdPercent: 50, yellowThresholdPercent: 100 },
    });
    expect(row.currentStock).toBe(7);
  });

  it("buildSmartOrderComputedItems uses reconciled parent stock, not zone row quantities", () => {
    const [row] = buildSmartOrderComputedItems({
      sessionItems: [
        baseSessionItem({
          current_stock: 3,
          inventory_session_item_zones: [
            {
              id: "z1",
              session_item_id: "si-1",
              list_category_id: "lc-a",
              entered_qty: 50,
              entered_unit: "lb",
              normalized_qty: 1.25,
              created_at: "",
              updated_at: "",
            },
          ],
        }),
      ],
      parMaps: null,
      riskThresholds: { redThresholdPercent: 50, yellowThresholdPercent: 100 },
    });
    expect(row.currentStock).toBe(3);
  });

  it("buildSmartOrderComputedItems mixed-unit row still derives need from session unit and pack_size", () => {
    const [row] = buildSmartOrderComputedItems({
      sessionItems: [
        baseSessionItem({
          unit: "each",
          pack_size: "24 each",
          current_stock: 10,
          par_level: 5,
        }),
      ],
      parMaps: null,
      riskThresholds: { redThresholdPercent: 50, yellowThresholdPercent: 100 },
    });
    expect(row.currentStock).toBe(10);
    expect(row.parLevel).toBe(5);
    expect(typeof row.suggestedOrder).toBe("number");
  });

  it("buildSessionItemsWithApprovedPar preserves embedded zone rows", () => {
    const item = baseSessionItem({
      inventory_session_item_zones: [
        {
          id: "z1",
          session_item_id: "si-1",
          list_category_id: "lc-1",
          entered_qty: 2,
          entered_unit: "case",
          normalized_qty: 2,
          created_at: "",
          updated_at: "",
        },
      ],
    });
    const [out] = buildSessionItemsWithApprovedPar([item], []);
    expect(out.inventory_session_item_zones?.length).toBe(1);
    expect(out.inventory_session_item_zones?.[0]?.entered_qty).toBe(2);
  });

  it("prepareSmartOrderFromSession run items use parent current_stock (smart order compatibility)", async () => {
    const sessionRow = {
      id: "session-1",
      restaurant_id: "r1",
      inventory_list_id: "list-1",
      location_id: null,
      name: "Count",
      status: "IN_REVIEW",
      created_at: "2026-01-01T00:00:00.000Z",
      updated_at: "2026-01-01T00:00:00.000Z",
      approved_at: null,
      approved_by: null,
      counting_par_guide_id: null,
      created_by: "u1",
      notes: null,
    };
    const sessionSingleMock = vi.fn().mockResolvedValue({
      data: sessionRow,
    });
    const sessionItemsRow = baseSessionItem({
      id: "line-1",
      current_stock: 9,
      inventory_session_item_zones: [
        {
          id: "z1",
          session_item_id: "line-1",
          list_category_id: "lc-1",
          entered_qty: 100,
          entered_unit: "lb",
          normalized_qty: 2,
          created_at: "",
          updated_at: "",
        },
      ],
    });
    const parGuideMaybeMock = vi.fn().mockResolvedValue({ data: null });
    const fromMock = vi.fn((table: string) => {
      if (table === "inventory_sessions") {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              single: sessionSingleMock,
            })),
          })),
        };
      }
      if (table === "inventory_session_items") {
        return {
          select: vi.fn(() => ({
            eq: vi.fn().mockResolvedValue({ data: [sessionItemsRow] }),
          })),
        };
      }
      if (table === "par_guides") {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              eq: vi.fn(() => ({
                order: vi.fn(() => ({
                  limit: vi.fn(() => ({ maybeSingle: parGuideMaybeMock })),
                })),
              })),
            })),
          })),
        };
      }
      throw new Error(`Unexpected table ${table}`);
    });

    const prepared = await prepareSmartOrderFromSession({
      supabase: asSupabase({ from: fromMock }),
      sessionId: "session-1",
      restaurantId: "r1",
      riskThresholds: { redThresholdPercent: 50, yellowThresholdPercent: 100 },
    });

    expect(prepared.errorMessage).toBeNull();
    expect(prepared.data?.runItems[0]?.current_stock).toBe(9);
  });
});
