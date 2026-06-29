import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import type {
  InventorySessionItemRow,
  InventorySessionListRow,
} from "@/domain/inventory/enterInventoryTypes";

const {
  prepareSmartOrderFromSessionMock,
  publishSmartOrderAttentionNotificationsMock,
} = vi.hoisted(() => ({
  prepareSmartOrderFromSessionMock: vi.fn(),
  publishSmartOrderAttentionNotificationsMock: vi.fn(),
}));

vi.mock("@/domain/inventory/smartOrderFromSession", () => ({
  prepareSmartOrderFromSession: prepareSmartOrderFromSessionMock,
  publishSmartOrderAttentionNotifications: publishSmartOrderAttentionNotificationsMock,
}));

import {
  approveInventorySession,
  createInventorySession,
  duplicateInventorySession,
  moveApprovedInventorySessionToReview,
} from "@/domain/inventory/sessionWorkflow";

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
    location_id: "location-1",
    name: "Friday Count",
    status: "IN_REVIEW",
    updated_at: "2026-01-01T00:00:00.000Z",
    approved_at: null,
    approved_by: null,
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
    item_name: "Tomatoes",
    lead_time_days: null,
    metadata: null,
    unit: "ea",
    current_stock: 3,
    par_level: 8,
    unit_cost: 2,
    vendor_sku: null,
    pack_size: null,
    vendor_name: null,
    stock_unit: null,
    catalog_item_id: "catalog-1",
    ...overrides,
  } as InventorySessionItemRow;
}

function buildPreparedSmartOrderDraft() {
  return {
    session: buildSessionRow({ status: "IN_REVIEW" }),
    parGuideId: "par-guide-1",
    runItems: [
      {
        catalog_item_id: "catalog-1",
        item_name: "Tomatoes",
        suggested_order: 5,
        risk: "RED" as const,
        current_stock: 3,
        par_level: 8,
        unit_cost: 2,
        pack_size: null,
        brand_name: null,
      },
    ],
    redCount: 2,
    yellowCount: 1,
  };
}

describe("inventory session workflow", () => {
  beforeEach(() => {
    prepareSmartOrderFromSessionMock.mockReset();
    publishSmartOrderAttentionNotificationsMock.mockReset();
  });

  it("writes location_id when creating a session", async () => {
    const singleMock = vi.fn().mockResolvedValue({
      data: buildSessionRow({ status: "IN_PROGRESS" }),
      error: null,
    });
    const insertMock = vi.fn(() => ({
      select: () => ({ single: singleMock }),
    }));
    const fromMock = vi.fn((table: string) => {
      if (table === "inventory_sessions") {
        return { insert: insertMock };
      }
      throw new Error(`Unexpected table ${table}`);
    });

    await createInventorySession({
      supabase: asSupabase({ from: fromMock }),
      restaurantId: "restaurant-1",
      inventoryListId: "list-1",
      name: "Line Check",
      userId: "user-1",
      locationId: "location-9",
    });

    expect(insertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        restaurant_id: "restaurant-1",
        inventory_list_id: "list-1",
        location_id: "location-9",
      }),
    );
  });

  it("preserves the source location when duplicating a session", async () => {
    const sessionSingleMock = vi.fn().mockResolvedValue({
      data: buildSessionRow({ id: "session-copy", location_id: "location-source" }),
      error: null,
    });
    const sessionInsertMock = vi.fn(() => ({
      select: () => ({ single: sessionSingleMock }),
    }));
    const sourceItemsEqMock = vi.fn().mockResolvedValue({
      data: [buildSessionItemRow(), buildSessionItemRow({ id: "item-2" })],
      error: null,
    });
    const itemsInsertMock = vi.fn().mockResolvedValue({ error: null });

    const fromMock = vi.fn((table: string) => {
      if (table === "inventory_sessions") {
        return {
          insert: sessionInsertMock,
          delete: vi.fn(() => ({ eq: vi.fn() })),
        };
      }
      if (table === "inventory_session_items") {
        return {
          select: () => ({ eq: sourceItemsEqMock }),
          insert: itemsInsertMock,
          delete: vi.fn(() => ({ eq: vi.fn() })),
        };
      }
      throw new Error(`Unexpected table ${table}`);
    });

    const result = await duplicateInventorySession({
      supabase: asSupabase({ from: fromMock }),
      restaurantId: "restaurant-1",
      sourceSession: buildSessionRow({
        id: "session-source",
        location_id: "location-source",
      }),
      userId: "user-1",
      fallbackLocationId: "location-fallback",
    });

    expect(result.ok).toBe(true);
    expect(sessionInsertMock).toHaveBeenCalledWith(
      expect.objectContaining({ location_id: "location-source" }),
    );
    expect(itemsInsertMock).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ session_id: "session-copy" }),
      ]),
    );
  });

  it("approves through the atomic RPC and publishes notifications after success", async () => {
    prepareSmartOrderFromSessionMock.mockResolvedValue({
      data: buildPreparedSmartOrderDraft(),
      errorMessage: null,
    });
    publishSmartOrderAttentionNotificationsMock.mockResolvedValue(undefined);

    const loadSessionMaybeSingleMock = vi.fn().mockResolvedValue({
      data: buildSessionRow({ status: "IN_REVIEW" }),
      error: null,
    });
    const loadSessionEqMock = vi.fn(() => ({ maybeSingle: loadSessionMaybeSingleMock }));

    const rpcMock = vi.fn().mockResolvedValue({
      data: [
        {
          run_id: "run-1",
          location_id: "location-1",
          catalog_links_stripped: false,
        },
      ],
      error: null,
    });

    const fromMock = vi.fn((table: string) => {
      if (table === "inventory_sessions") {
        return {
          select: vi.fn(() => ({ eq: loadSessionEqMock })),
        };
      }
      if (table === "inventory_session_items") {
        return {
          select: vi.fn(() => ({
            eq: vi.fn().mockResolvedValue({ data: [buildSessionItemRow()], error: null }),
          })),
        };
      }
      if (table === "smart_order_runs") {
        // pre-RPC idempotency guard (sessionWorkflow.ts): no existing run -> proceed to RPC
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
            })),
          })),
        };
      }
      throw new Error(`Unexpected table ${table}`);
    });

    const result = await approveInventorySession({
      supabase: asSupabase({ from: fromMock, rpc: rpcMock }),
      sessionId: "session-1",
      restaurantId: "restaurant-1",
      userId: "user-1",
      riskThresholds: {
        redThresholdPercent: 50,
        yellowThresholdPercent: 100,
      },
    });

    expect(result.ok).toBe(true);
    expect(prepareSmartOrderFromSessionMock).toHaveBeenCalledTimes(1);
    expect(prepareSmartOrderFromSessionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: "session-1",
      }),
    );
    expect(rpcMock).toHaveBeenCalledWith(
      "approve_inventory_session_atomic",
      expect.objectContaining({
        p_session_id: "session-1",
        p_user_id: "user-1",
        p_par_guide_id: "par-guide-1",
        p_run_items: [
          expect.objectContaining({
            item_name: "Tomatoes",
            suggested_order: 5,
          }),
        ],
      }),
    );
    expect(publishSmartOrderAttentionNotificationsMock).toHaveBeenCalledTimes(1);
    expect(publishSmartOrderAttentionNotificationsMock).toHaveBeenCalledWith(
      expect.objectContaining({
        runId: "run-1",
        redCount: 2,
        yellowCount: 1,
      }),
    );
  });

  it("returns the RPC duplicate error and skips notifications", async () => {
    prepareSmartOrderFromSessionMock.mockResolvedValue({
      data: buildPreparedSmartOrderDraft(),
      errorMessage: null,
    });

    const loadSessionMaybeSingleMock = vi.fn().mockResolvedValue({
      data: buildSessionRow({ status: "IN_REVIEW" }),
      error: null,
    });
    const loadSessionEqMock = vi.fn(() => ({ maybeSingle: loadSessionMaybeSingleMock }));
    const rpcMock = vi.fn().mockResolvedValue({
      data: null,
      error: {
        message:
          "Session already has a downstream smart order run. Approval retry is blocked until that inconsistency is resolved.",
      },
    });

    const fromMock = vi.fn((table: string) => {
      if (table === "inventory_sessions") {
        return {
          select: vi.fn(() => ({ eq: loadSessionEqMock })),
        };
      }
      if (table === "inventory_session_items") {
        return {
          select: vi.fn(() => ({
            eq: vi.fn().mockResolvedValue({ data: [buildSessionItemRow()], error: null }),
          })),
        };
      }
      if (table === "smart_order_runs") {
        // pre-RPC idempotency guard (sessionWorkflow.ts): no existing run -> proceed to RPC
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
            })),
          })),
        };
      }
      throw new Error(`Unexpected table ${table}`);
    });

    const result = await approveInventorySession({
      supabase: asSupabase({ from: fromMock, rpc: rpcMock }),
      sessionId: "session-1",
      restaurantId: "restaurant-1",
      userId: "user-1",
      riskThresholds: {
        redThresholdPercent: 50,
        yellowThresholdPercent: 100,
      },
    });

    expect(result.ok).toBe(false);
    expect(result.errorMessage).toContain("downstream smart order run");
    expect(result.smartOrderRunId).toBeNull();
    expect(publishSmartOrderAttentionNotificationsMock).not.toHaveBeenCalled();
  });

  it("returns session not found and skips prepare and RPC when loadSession finds nothing", async () => {
    const loadSessionMaybeSingleMock = vi.fn().mockResolvedValue({
      data: null,
      error: null,
    });
    const loadSessionEqMock = vi.fn(() => ({ maybeSingle: loadSessionMaybeSingleMock }));
    const rpcMock = vi.fn();

    const fromMock = vi.fn((table: string) => {
      if (table === "inventory_sessions") {
        return {
          select: vi.fn(() => ({ eq: loadSessionEqMock })),
        };
      }
      throw new Error(`Unexpected table ${table}`);
    });

    const result = await approveInventorySession({
      supabase: asSupabase({ from: fromMock, rpc: rpcMock }),
      sessionId: "missing-session",
      restaurantId: "restaurant-1",
      userId: "user-1",
      riskThresholds: {
        redThresholdPercent: 50,
        yellowThresholdPercent: 100,
      },
    });

    expect(result.ok).toBe(false);
    expect(result.errorMessage).toBe("Session not found.");
    expect(prepareSmartOrderFromSessionMock).not.toHaveBeenCalled();
    expect(rpcMock).not.toHaveBeenCalled();
    expect(publishSmartOrderAttentionNotificationsMock).not.toHaveBeenCalled();
  });

  it("blocks approval before the RPC when the session is IN_PROGRESS", async () => {
    const loadSessionMaybeSingleMock = vi.fn().mockResolvedValue({
      data: buildSessionRow({ status: "IN_PROGRESS" }),
      error: null,
    });
    const loadSessionEqMock = vi.fn(() => ({ maybeSingle: loadSessionMaybeSingleMock }));
    const rpcMock = vi.fn();

    const fromMock = vi.fn((table: string) => {
      if (table === "inventory_sessions") {
        return {
          select: vi.fn(() => ({ eq: loadSessionEqMock })),
        };
      }
      throw new Error(`Unexpected table ${table}`);
    });

    const result = await approveInventorySession({
      supabase: asSupabase({ from: fromMock, rpc: rpcMock }),
      sessionId: "session-1",
      restaurantId: "restaurant-1",
      userId: "user-1",
      riskThresholds: {
        redThresholdPercent: 50,
        yellowThresholdPercent: 100,
      },
    });

    expect(result.ok).toBe(false);
    expect(result.errorMessage).toBe("Only sessions in review can be approved.");
    expect(prepareSmartOrderFromSessionMock).not.toHaveBeenCalled();
    expect(rpcMock).not.toHaveBeenCalled();
    expect(publishSmartOrderAttentionNotificationsMock).not.toHaveBeenCalled();
  });

  it("blocks approval before the RPC when the session is not in review", async () => {
    const loadSessionMaybeSingleMock = vi.fn().mockResolvedValue({
      data: buildSessionRow({ status: "APPROVED" }),
      error: null,
    });
    const loadSessionEqMock = vi.fn(() => ({ maybeSingle: loadSessionMaybeSingleMock }));
    const rpcMock = vi.fn();

    const fromMock = vi.fn((table: string) => {
      if (table === "inventory_sessions") {
        return {
          select: vi.fn(() => ({ eq: loadSessionEqMock })),
        };
      }
      throw new Error(`Unexpected table ${table}`);
    });

    const result = await approveInventorySession({
      supabase: asSupabase({ from: fromMock, rpc: rpcMock }),
      sessionId: "session-1",
      restaurantId: "restaurant-1",
      userId: "user-1",
      riskThresholds: {
        redThresholdPercent: 50,
        yellowThresholdPercent: 100,
      },
    });

    expect(result.ok).toBe(false);
    expect(result.errorMessage).toBe("Session is already approved.");
    expect(prepareSmartOrderFromSessionMock).not.toHaveBeenCalled();
    expect(rpcMock).not.toHaveBeenCalled();
    expect(publishSmartOrderAttentionNotificationsMock).not.toHaveBeenCalled();
  });

  it("returns generic RPC failures without publishing notifications", async () => {
    prepareSmartOrderFromSessionMock.mockResolvedValue({
      data: buildPreparedSmartOrderDraft(),
      errorMessage: null,
    });

    const loadSessionMaybeSingleMock = vi.fn().mockResolvedValue({
      data: buildSessionRow({ status: "IN_REVIEW" }),
      error: null,
    });
    const loadSessionEqMock = vi.fn(() => ({ maybeSingle: loadSessionMaybeSingleMock }));
    const rpcMock = vi.fn().mockResolvedValue({
      data: null,
      error: {
        message: "Atomic approval failed.",
      },
    });

    const fromMock = vi.fn((table: string) => {
      if (table === "inventory_sessions") {
        return {
          select: vi.fn(() => ({ eq: loadSessionEqMock })),
        };
      }
      if (table === "inventory_session_items") {
        return {
          select: vi.fn(() => ({
            eq: vi.fn().mockResolvedValue({ data: [buildSessionItemRow()], error: null }),
          })),
        };
      }
      if (table === "smart_order_runs") {
        // pre-RPC idempotency guard (sessionWorkflow.ts): no existing run -> proceed to RPC
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
            })),
          })),
        };
      }
      throw new Error(`Unexpected table ${table}`);
    });

    const result = await approveInventorySession({
      supabase: asSupabase({ from: fromMock, rpc: rpcMock }),
      sessionId: "session-1",
      restaurantId: "restaurant-1",
      userId: "user-1",
      riskThresholds: {
        redThresholdPercent: 50,
        yellowThresholdPercent: 100,
      },
    });

    expect(result.ok).toBe(false);
    expect(result.errorMessage).toBe("Atomic approval failed.");
    expect(publishSmartOrderAttentionNotificationsMock).not.toHaveBeenCalled();
  });

  it("blocks approval before the RPC when session items have duplicate item names", async () => {
    const loadSessionMaybeSingleMock = vi.fn().mockResolvedValue({
      data: buildSessionRow({ status: "IN_REVIEW" }),
      error: null,
    });
    const loadSessionEqMock = vi.fn(() => ({ maybeSingle: loadSessionMaybeSingleMock }));
    const rpcMock = vi.fn();

    const fromMock = vi.fn((table: string) => {
      if (table === "inventory_sessions") {
        return {
          select: vi.fn(() => ({ eq: loadSessionEqMock })),
        };
      }
      if (table === "inventory_session_items") {
        return {
          select: vi.fn(() => ({
            eq: vi.fn().mockResolvedValue({
              data: [
                buildSessionItemRow({ id: "item-1", item_name: "Tomatoes" }),
                buildSessionItemRow({ id: "item-2", item_name: "Tomatoes" }),
              ],
              error: null,
            }),
          })),
        };
      }
      throw new Error(`Unexpected table ${table}`);
    });

    const result = await approveInventorySession({
      supabase: asSupabase({ from: fromMock, rpc: rpcMock }),
      sessionId: "session-1",
      restaurantId: "restaurant-1",
      userId: "user-1",
      riskThresholds: { redThresholdPercent: 50, yellowThresholdPercent: 100 },
    });

    expect(result.ok).toBe(false);
    expect(result.errorMessage).toMatch(/Cannot approve/);
    expect(result.errorMessage).toMatch(/Tomatoes/);
    expect(prepareSmartOrderFromSessionMock).not.toHaveBeenCalled();
    expect(rpcMock).not.toHaveBeenCalled();
    expect(publishSmartOrderAttentionNotificationsMock).not.toHaveBeenCalled();
  });

  it("blocks approval when items have same name differing only by case or whitespace", async () => {
    const loadSessionMaybeSingleMock = vi.fn().mockResolvedValue({
      data: buildSessionRow({ status: "IN_REVIEW" }),
      error: null,
    });
    const loadSessionEqMock = vi.fn(() => ({ maybeSingle: loadSessionMaybeSingleMock }));
    const rpcMock = vi.fn();

    const fromMock = vi.fn((table: string) => {
      if (table === "inventory_sessions") {
        return {
          select: vi.fn(() => ({ eq: loadSessionEqMock })),
        };
      }
      if (table === "inventory_session_items") {
        return {
          select: vi.fn(() => ({
            eq: vi.fn().mockResolvedValue({
              data: [
                buildSessionItemRow({ id: "item-1", item_name: "Tomatoes" }),
                buildSessionItemRow({ id: "item-2", item_name: " TOMATOES " }),
              ],
              error: null,
            }),
          })),
        };
      }
      throw new Error(`Unexpected table ${table}`);
    });

    const result = await approveInventorySession({
      supabase: asSupabase({ from: fromMock, rpc: rpcMock }),
      sessionId: "session-1",
      restaurantId: "restaurant-1",
      userId: "user-1",
      riskThresholds: { redThresholdPercent: 50, yellowThresholdPercent: 100 },
    });

    expect(result.ok).toBe(false);
    expect(result.errorMessage).toMatch(/Cannot approve/);
    expect(prepareSmartOrderFromSessionMock).not.toHaveBeenCalled();
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("does not block approval when item names are unique", async () => {
    prepareSmartOrderFromSessionMock.mockResolvedValue({
      data: buildPreparedSmartOrderDraft(),
      errorMessage: null,
    });
    publishSmartOrderAttentionNotificationsMock.mockResolvedValue(undefined);

    const loadSessionMaybeSingleMock = vi.fn().mockResolvedValue({
      data: buildSessionRow({ status: "IN_REVIEW" }),
      error: null,
    });
    const loadSessionEqMock = vi.fn(() => ({ maybeSingle: loadSessionMaybeSingleMock }));
    const rpcMock = vi.fn().mockResolvedValue({
      data: [{ run_id: "run-1", location_id: "location-1", catalog_links_stripped: false }],
      error: null,
    });

    const fromMock = vi.fn((table: string) => {
      if (table === "inventory_sessions") {
        return { select: vi.fn(() => ({ eq: loadSessionEqMock })) };
      }
      if (table === "inventory_session_items") {
        return {
          select: vi.fn(() => ({
            eq: vi.fn().mockResolvedValue({
              data: [
                buildSessionItemRow({ id: "item-1", item_name: "Tomatoes" }),
                buildSessionItemRow({ id: "item-2", item_name: "Lettuce" }),
              ],
              error: null,
            }),
          })),
        };
      }
      if (table === "smart_order_runs") {
        // pre-RPC idempotency guard: no existing run -> proceed to RPC
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
            })),
          })),
        };
      }
      throw new Error(`Unexpected table ${table}`);
    });

    const result = await approveInventorySession({
      supabase: asSupabase({ from: fromMock, rpc: rpcMock }),
      sessionId: "session-1",
      restaurantId: "restaurant-1",
      userId: "user-1",
      riskThresholds: { redThresholdPercent: 50, yellowThresholdPercent: 100 },
    });

    expect(result.ok).toBe(true);
    expect(rpcMock).toHaveBeenCalledTimes(1);
  });

  it("blocks approved-session reopen when downstream effects exist unless explicitly overridden", async () => {
    const loadSessionMaybeSingleMock = vi.fn().mockResolvedValue({
      data: buildSessionRow({
        status: "APPROVED",
        restaurant_id: "restaurant-1",
      }),
      error: null,
    });
    const loadSessionEqMock = vi.fn(() => ({ maybeSingle: loadSessionMaybeSingleMock }));

    const updateMaybeSingleMock = vi.fn().mockResolvedValue({
      data: { id: "session-1", status: "IN_REVIEW" },
      error: null,
    });
    const updateSelectMock = vi.fn(() => ({ maybeSingle: updateMaybeSingleMock }));
    const updateStatusEqMock = vi.fn(() => ({ select: updateSelectMock }));
    const updateIdEqMock = vi.fn(() => ({ eq: updateStatusEqMock }));
    const updateMock = vi.fn(() => ({ eq: updateIdEqMock }));

    const notificationsTypeEqMock = vi.fn().mockResolvedValue({
      data: [{ id: "notification-1", data: { session_id: "session-1", run_id: "run-1" } }],
      error: null,
    });
    const notificationsRestaurantEqMock = vi.fn(() => ({ eq: notificationsTypeEqMock }));

    const fromMock = vi.fn((table: string) => {
      if (table === "inventory_sessions") {
        return {
          select: vi.fn(() => ({ eq: loadSessionEqMock })),
          update: updateMock,
        };
      }
      if (table === "smart_order_runs") {
        return {
          select: vi.fn(() => ({
            eq: vi.fn().mockResolvedValue({ data: [{ id: "run-1" }], error: null }),
          })),
          // archive prior run on explicit-override reopen (distinct from inventory_sessions updateMock)
          update: vi.fn(() => ({
            eq: vi.fn().mockResolvedValue({ data: null, error: null }),
          })),
        };
      }
      if (table === "purchase_orders") {
        return {
          select: vi.fn(() => ({
            in: vi.fn().mockResolvedValue({ data: [{ id: "po-1" }], error: null }),
          })),
        };
      }
      if (table === "invoices") {
        return {
          select: vi.fn(() => ({
            in: vi.fn().mockResolvedValue({ data: [{ id: "invoice-1" }], error: null }),
          })),
        };
      }
      if (table === "notifications") {
        return {
          select: vi.fn(() => ({ eq: notificationsRestaurantEqMock })),
        };
      }
      throw new Error(`Unexpected table ${table}`);
    });

    const blocked = await moveApprovedInventorySessionToReview({
      supabase: asSupabase({ from: fromMock }),
      sessionId: "session-1",
    });

    expect(blocked.ok).toBe(false);
    expect(blocked.errorMessage).toContain("cannot be moved back to review by default");
    expect(updateMock).not.toHaveBeenCalled();

    const allowed = await moveApprovedInventorySessionToReview({
      supabase: asSupabase({ from: fromMock }),
      sessionId: "session-1",
      allowWithDownstreamEffects: true,
    });

    expect(allowed.ok).toBe(true);
    expect(updateMock).toHaveBeenCalledTimes(1);
    expect(updateStatusEqMock).toHaveBeenCalledWith("status", "APPROVED");
  });
});
