import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import type {
  InventorySessionItemRow,
  InventorySessionListRow,
} from "@/domain/inventory/enterInventoryTypes";
import { createSmartOrderFromSession } from "@/domain/inventory/smartOrderFromSession";

function asSupabase(value: unknown) {
  return value as SupabaseClient<Database>;
}

function buildSessionRow(
  overrides: Partial<InventorySessionListRow> = {},
): InventorySessionListRow {
  return {
    id: "session-1",
    restaurant_id: "restaurant-1",
    inventory_list_id: "list-1",
    location_id: "location-7",
    name: "Friday Count",
    status: "APPROVED",
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    approved_at: "2026-01-01T00:00:00.000Z",
    approved_by: "user-1",
    counting_par_guide_id: null,
    created_by: "user-1",
    notes: null,
    ...overrides,
  };
}

function buildSessionItemRow(
  overrides: Partial<InventorySessionItemRow> = {},
): InventorySessionItemRow {
  return {
    id: "item-1",
    session_id: "session-1",
    item_name: "Tomatoes",
    category: "Produce",
    unit: "ea",
    current_stock: 2,
    par_level: 8,
    unit_cost: 3,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    vendor_sku: null,
    pack_size: null,
    vendor_name: null,
    brand_name: null,
    catalog_item_id: "catalog-1",
    ...overrides,
  };
}

describe("smart order from session", () => {
  it("writes location_id on smart-order runs", async () => {
    const sessionSingleMock = vi.fn().mockResolvedValue({
      data: buildSessionRow({ location_id: "location-42" }),
    });
    const sessionItemsEqMock = vi.fn().mockResolvedValue({
      data: [buildSessionItemRow()],
    });
    const parGuideItemsEqMock = vi.fn().mockResolvedValue({ data: [] });
    const runSingleMock = vi.fn().mockResolvedValue({
      data: { id: "run-1" },
      error: null,
    });
    const smartOrderRunInsertMock = vi.fn(() => ({
      select: () => ({ single: runSingleMock }),
    }));
    const runItemsInsertMock = vi.fn().mockResolvedValue({ error: null });

    const fromMock = vi.fn((table: string) => {
      if (table === "inventory_sessions") {
        return {
          select: vi.fn(() => ({ eq: vi.fn(() => ({ single: sessionSingleMock })) })),
        };
      }
      if (table === "inventory_session_items") {
        return {
          select: vi.fn(() => ({ eq: sessionItemsEqMock })),
        };
      }
      if (table === "par_guide_items") {
        return {
          select: vi.fn(() => ({ eq: parGuideItemsEqMock })),
        };
      }
      if (table === "smart_order_runs") {
        return {
          insert: smartOrderRunInsertMock,
          delete: vi.fn(() => ({ eq: vi.fn() })),
        };
      }
      if (table === "smart_order_run_items") {
        return {
          insert: runItemsInsertMock,
        };
      }
      throw new Error(`Unexpected table ${table}`);
    });

    const result = await createSmartOrderFromSession({
      supabase: asSupabase({ from: fromMock }),
      sessionId: "session-1",
      restaurantId: "restaurant-1",
      userId: "user-1",
      riskThresholds: {
        redThresholdPercent: 50,
        yellowThresholdPercent: 100,
      },
      parGuideId: "guide-1",
      mode: "manual",
      notifyRecipients: false,
    });

    expect(result.runId).toBe("run-1");
    expect(smartOrderRunInsertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        session_id: "session-1",
        location_id: "location-42",
      }),
    );
  });
});
