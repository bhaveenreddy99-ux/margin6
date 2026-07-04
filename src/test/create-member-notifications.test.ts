import { describe, it, expect, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { createMemberNotifications } from "@/domain/notifications/createMemberNotifications";

// S0-8: client notification creation now goes through the create_member_notifications
// RPC (direct notifications INSERT is dropped at the RLS layer). These cover the
// thin client wrapper's contract: it calls the RPC with the right params, short-
// circuits on empty recipients, and surfaces errors in the PostgREST-like shape
// existing call sites expect.

function mockSupabase(rpcImpl: (name: string, params: unknown) => unknown) {
  return { rpc: vi.fn(rpcImpl) } as unknown as SupabaseClient<Database> & {
    rpc: ReturnType<typeof vi.fn>;
  };
}

describe("createMemberNotifications", () => {
  it("calls the create_member_notifications RPC with mapped params", async () => {
    const supabase = mockSupabase(() => ({ data: 2, error: null }));

    const { error } = await createMemberNotifications(supabase, {
      restaurantId: "rest-1",
      recipientIds: ["mgr-1", "owner-1"],
      type: "PAR_CHANGE_REQUEST",
      severity: "INFO",
      title: "PAR change requested",
      message: "Staff suggested a change",
      data: { item_name: "Tomatoes" },
    });

    expect(error).toBeNull();
    expect(supabase.rpc).toHaveBeenCalledTimes(1);
    expect(supabase.rpc).toHaveBeenCalledWith("create_member_notifications", {
      p_restaurant_id: "rest-1",
      p_recipient_ids: ["mgr-1", "owner-1"],
      p_type: "PAR_CHANGE_REQUEST",
      p_severity: "INFO",
      p_title: "PAR change requested",
      p_message: "Staff suggested a change",
      p_data: { item_name: "Tomatoes" },
    });
  });

  it("short-circuits without calling the RPC when there are no recipients", async () => {
    const supabase = mockSupabase(() => ({ data: 0, error: null }));

    const { error } = await createMemberNotifications(supabase, {
      restaurantId: "rest-1",
      recipientIds: [],
      type: "LOW_STOCK",
      severity: "CRITICAL",
      title: "t",
      message: "m",
    });

    expect(error).toBeNull();
    expect(supabase.rpc).not.toHaveBeenCalled();
  });

  it("defaults p_data to an empty object when omitted", async () => {
    const supabase = mockSupabase(() => ({ data: 1, error: null }));

    await createMemberNotifications(supabase, {
      restaurantId: "rest-1",
      recipientIds: ["mgr-1"],
      type: "PAR_SUGGESTIONS",
      severity: "WARNING",
      title: "t",
      message: "m",
    });

    expect(supabase.rpc).toHaveBeenCalledWith(
      "create_member_notifications",
      expect.objectContaining({ p_data: {} }),
    );
  });

  it("surfaces an RPC error (e.g. RLS/type rejection) in the { error } shape", async () => {
    const supabase = mockSupabase(() => ({
      data: null,
      error: { message: "notification type SHRINK_ALERT is not allowed from the client" },
    }));

    const { error } = await createMemberNotifications(supabase, {
      restaurantId: "rest-1",
      recipientIds: ["mgr-1"],
      type: "LOW_STOCK",
      severity: "WARNING",
      title: "t",
      message: "m",
    });

    expect(error).not.toBeNull();
    expect(error?.message).toContain("not allowed from the client");
  });
});
