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
    updated_at: "2026-01-01T00:00:00.000Z",
    approved_at: "2026-01-01T00:00:00.000Z",
    approved_by: "user-1",
    counting_par_guide_id: null,
    created_by: "user-1",
    ...overrides,
  } as InventorySessionListRow;
}

function buildSessionItemRow(
  overrides: Partial<InventorySessionItemRow> = {},
): InventorySessionItemRow {
  return {
    id: "item-1",
    session_id: "session-1",
    brand_name: null,
    category: "Produce",
    conversion_formula: null,
    counted_as: null,
    counted_value: null,
    current_stock: 2,
    item_name: "Tomatoes",
    lead_time_days: null,
    metadata: null,
    pack_size: null,
    par_level: 8,
    stock_unit: null,
    unit: "ea",
    unit_cost: 3,
    vendor_name: null,
    vendor_sku: null,
    catalog_item_id: "catalog-1",
    ...overrides,
  } as InventorySessionItemRow;
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

  it("preserves unit_cost = 0 and does not coerce it to null", async () => {
    // An item donated at zero cost is a valid $0 line — it must NOT be
    // treated as "missing cost" and must not inflate missingCostCount.
    const sessionSingleMock = vi.fn().mockResolvedValue({
      data: buildSessionRow({ location_id: "location-1" }),
    });
    const sessionItemsEqMock = vi.fn().mockResolvedValue({
      data: [buildSessionItemRow({ unit_cost: 0, par_level: 5, current_stock: 2 })],
    });
    const parGuideItemsEqMock = vi.fn().mockResolvedValue({ data: [] });
    const runSingleMock = vi.fn().mockResolvedValue({
      data: { id: "run-zero" },
      error: null,
    });
    const smartOrderRunInsertMock = vi.fn(() => ({
      select: () => ({ single: runSingleMock }),
    }));
    const runItemsInsertMock = vi.fn().mockResolvedValue({ error: null });

    const fromMock = vi.fn((table: string) => {
      if (table === "inventory_sessions") {
        return { select: vi.fn(() => ({ eq: vi.fn(() => ({ single: sessionSingleMock })) })) };
      }
      if (table === "inventory_session_items") {
        return { select: vi.fn(() => ({ eq: sessionItemsEqMock })) };
      }
      if (table === "par_guide_items") {
        return { select: vi.fn(() => ({ eq: parGuideItemsEqMock })) };
      }
      if (table === "smart_order_runs") {
        return { insert: smartOrderRunInsertMock, delete: vi.fn(() => ({ eq: vi.fn() })) };
      }
      if (table === "smart_order_run_items") {
        return { insert: runItemsInsertMock };
      }
      throw new Error(`Unexpected table ${table}`);
    });

    const result = await createSmartOrderFromSession({
      supabase: asSupabase({ from: fromMock }),
      sessionId: "session-1",
      restaurantId: "restaurant-1",
      userId: "user-1",
      riskThresholds: { redThresholdPercent: 50, yellowThresholdPercent: 100 },
      parGuideId: "guide-1",
      mode: "manual",
      notifyRecipients: false,
    });

    expect(result.runId).toBe("run-zero");

    // The run items array passed to .insert() must contain unit_cost: 0, not null.
    const insertedItems: Array<{ unit_cost: unknown }> =
      runItemsInsertMock.mock.calls[0][0] as Array<{ unit_cost: unknown }>;
    expect(insertedItems).toHaveLength(1);
    expect(insertedItems[0].unit_cost).toBe(0);
  });
});
