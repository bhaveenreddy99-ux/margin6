import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/integrations/supabase/types";
import type {
  InventorySessionItemRow,
  InventorySessionListRow,
  SessionStatus,
} from "@/domain/inventory/enterInventoryTypes";
import type { RiskThresholds } from "@/lib/inventory-utils";
import {
  prepareSmartOrderFromSession,
  publishSmartOrderAttentionNotifications,
} from "@/domain/inventory/smartOrderFromSession";

type AppSupabase = SupabaseClient<Database>;

type SessionError = { message: string } | null;
type NotificationAuditRow = Pick<
  Database["public"]["Tables"]["notifications"]["Row"],
  "id" | "data"
>;
type SessionUpdateRow = Pick<InventorySessionListRow, "id" | "status">;
type ApproveInventorySessionAtomicRpcArgs =
  Database["public"]["Functions"]["approve_inventory_session_atomic"]["Args"];
type ApproveInventorySessionAtomicRpcReturn =
  Database["public"]["Functions"]["approve_inventory_session_atomic"]["Returns"];
type ApproveInventorySessionAtomicRpcRow =
  ApproveInventorySessionAtomicRpcReturn[number];

export type SessionMutationResult = {
  ok: boolean;
  errorMessage: string | null;
};

export type ApprovedSessionDownstreamEffects = {
  smartOrderRuns: number;
  purchaseOrders: number;
  invoices: number;
  lowStockNotifications: number;
};

export type ApprovedSessionReopenPolicy = {
  allowed: boolean;
  requiresExplicitOverride: boolean;
  reason: "no_downstream_effects" | "has_downstream_effects";
  effects: ApprovedSessionDownstreamEffects;
};

function buildStatusConflictMessage(expectedStatus?: SessionStatus) {
  if (expectedStatus === "IN_PROGRESS") {
    return "Session is no longer in progress.";
  }
  if (expectedStatus === "IN_REVIEW") {
    return "Session is no longer in review.";
  }
  if (expectedStatus === "APPROVED") {
    return "Session is no longer approved.";
  }
  return "Session state changed. Please refresh and try again.";
}

function sessionStatusUpdate(
  status: SessionStatus,
  approvedBy?: string | null,
): Database["public"]["Tables"]["inventory_sessions"]["Update"] {
  const updatedAt = new Date().toISOString();
  if (status === "APPROVED") {
    return {
      status,
      approved_at: updatedAt,
      approved_by: approvedBy ?? null,
      updated_at: updatedAt,
    };
  }

  return {
    status,
    updated_at: updatedAt,
  };
}

export async function createInventorySession(args: {
  supabase: AppSupabase;
  restaurantId: string;
  inventoryListId: string;
  name: string;
  userId: string;
  locationId?: string | null;
}) {
  const { data, error } = (await args.supabase
    .from("inventory_sessions")
    .insert({
      restaurant_id: args.restaurantId,
      inventory_list_id: args.inventoryListId,
      location_id: args.locationId ?? null,
      name: args.name,
      created_by: args.userId,
    })
    .select()
    .single()) as unknown as {
    data: InventorySessionListRow | null;
    error: SessionError;
  };

  return { data, error };
}

async function loadSession(args: {
  supabase: AppSupabase;
  sessionId: string;
}) {
  const { data, error } = (await args.supabase
    .from("inventory_sessions")
    .select("*")
    .eq("id", args.sessionId)
    .maybeSingle()) as unknown as {
    data: InventorySessionListRow | null;
    error: SessionError;
  };

  return { data, error };
}

async function updateInventorySessionStatus(args: {
  supabase: AppSupabase;
  sessionId: string;
  status: SessionStatus;
  approvedBy?: string | null;
  expectedCurrentStatus?: SessionStatus;
}) {
  let query = args.supabase
    .from("inventory_sessions")
    .update(sessionStatusUpdate(args.status, args.approvedBy))
    .eq("id", args.sessionId);

  if (args.expectedCurrentStatus) {
    query = query.eq("status", args.expectedCurrentStatus);
  }

  const { data, error } = (await query
    .select("id, status")
    .maybeSingle()) as unknown as {
    data: SessionUpdateRow | null;
    error: SessionError;
  };

  if (error) {
    return {
      ok: false,
      errorMessage: error.message,
    } satisfies SessionMutationResult;
  }

  if (!data) {
    return {
      ok: false,
      errorMessage: buildStatusConflictMessage(args.expectedCurrentStatus),
    } satisfies SessionMutationResult;
  }

  return {
    ok: true,
    errorMessage: null,
  } satisfies SessionMutationResult;
}

function jsonRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

export function decideApprovedSessionReopenPolicy(
  effects: ApprovedSessionDownstreamEffects,
): ApprovedSessionReopenPolicy {
  const hasDownstreamEffects =
    effects.smartOrderRuns > 0 ||
    effects.purchaseOrders > 0 ||
    effects.invoices > 0 ||
    effects.lowStockNotifications > 0;

  if (!hasDownstreamEffects) {
    return {
      allowed: true,
      requiresExplicitOverride: false,
      reason: "no_downstream_effects",
      effects,
    };
  }

  return {
    allowed: false,
    requiresExplicitOverride: true,
    reason: "has_downstream_effects",
    effects,
  };
}

export async function auditApprovedSessionDownstreamEffects(args: {
  supabase: AppSupabase;
  sessionId: string;
}) {
  const sessionResult = await loadSession(args);
  if (sessionResult.error) {
    return {
      effects: null,
      errorMessage: sessionResult.error.message,
    };
  }

  if (!sessionResult.data) {
    return {
      effects: null,
      errorMessage: "Session not found.",
    };
  }

  const session = sessionResult.data;
  const { data: runRows, error: runError } = (await args.supabase
    .from("smart_order_runs")
    .select("id")
    .eq("session_id", args.sessionId)) as unknown as {
    data: Array<{ id: string }> | null;
    error: SessionError;
  };

  if (runError) {
    return {
      effects: null,
      errorMessage: runError.message,
    };
  }

  const runIds = (runRows ?? []).map((row) => row.id);

  let purchaseOrderCount = 0;
  let invoiceCount = 0;

  if (runIds.length > 0) {
    const { data: purchaseOrderRows, error: purchaseOrderError } = (await args.supabase
      .from("purchase_orders")
      .select("id")
      .in("smart_order_run_id", runIds)) as unknown as {
      data: Array<{ id: string }> | null;
      error: SessionError;
    };

    if (purchaseOrderError) {
      return {
        effects: null,
        errorMessage: purchaseOrderError.message,
      };
    }

    const purchaseOrderIds = (purchaseOrderRows ?? []).map((row) => row.id);
    purchaseOrderCount = purchaseOrderIds.length;

    if (purchaseOrderIds.length > 0) {
      const { data: invoiceRows, error: invoiceError } = (await args.supabase
        .from("invoices")
        .select("id")
        .in("purchase_order_id", purchaseOrderIds)) as unknown as {
        data: Array<{ id: string }> | null;
        error: SessionError;
      };

      if (invoiceError) {
        return {
          effects: null,
          errorMessage: invoiceError.message,
        };
      }

      invoiceCount = invoiceRows?.length ?? 0;
    }
  }

  const { data: notificationRows, error: notificationError } = (await args.supabase
    .from("notifications")
    .select("id, data")
    .eq("restaurant_id", session.restaurant_id)
    .eq("type", "LOW_STOCK")) as unknown as {
    data: NotificationAuditRow[] | null;
    error: SessionError;
  };

  if (notificationError) {
    return {
      effects: null,
      errorMessage: notificationError.message,
    };
  }

  const lowStockNotifications = (notificationRows ?? []).filter((row) => {
    const payload = jsonRecord(row.data);
    if (!payload) return false;
    const sessionId = payload.session_id;
    const runId = payload.run_id;
    return sessionId === args.sessionId || (typeof runId === "string" && runIds.includes(runId));
  }).length;

  return {
    effects: {
      smartOrderRuns: runIds.length,
      purchaseOrders: purchaseOrderCount,
      invoices: invoiceCount,
      lowStockNotifications,
    } satisfies ApprovedSessionDownstreamEffects,
    errorMessage: null,
  };
}

function buildReopenBlockedMessage(policy: ApprovedSessionReopenPolicy) {
  return [
    "Approved sessions with downstream smart-order activity cannot be moved back to review by default.",
    `Found ${policy.effects.smartOrderRuns} smart order run(s), ${policy.effects.purchaseOrders} purchase order(s), ${policy.effects.invoices} invoice(s), and ${policy.effects.lowStockNotifications} low-stock notification(s).`,
    "This reopen remains available only through an explicit override because it can orphan downstream workflow context.",
  ].join(" ");
}

export async function submitInventorySessionForReview(args: {
  supabase: AppSupabase;
  sessionId: string;
}) {
  return updateInventorySessionStatus({
    supabase: args.supabase,
    sessionId: args.sessionId,
    status: "IN_REVIEW",
    expectedCurrentStatus: "IN_PROGRESS",
  });
}

export async function sendInventorySessionBackToInProgress(args: {
  supabase: AppSupabase;
  sessionId: string;
}) {
  return updateInventorySessionStatus({
    supabase: args.supabase,
    sessionId: args.sessionId,
    status: "IN_PROGRESS",
    expectedCurrentStatus: "IN_REVIEW",
  });
}

export async function moveApprovedInventorySessionToReview(args: {
  supabase: AppSupabase;
  sessionId: string;
  allowWithDownstreamEffects?: boolean;
}) {
  const audit = await auditApprovedSessionDownstreamEffects({
    supabase: args.supabase,
    sessionId: args.sessionId,
  });
  if (audit.errorMessage || !audit.effects) {
    return {
      ok: false,
      errorMessage: audit.errorMessage ?? "Could not evaluate reopen policy.",
      policy: null,
    };
  }

  // Reopening an approved count invalidates it as a trusted source for dashboards/reports
  // and can leave downstream smart orders/POs/invoices pointing at a count no longer approved.
  // Default posture is block when downstream artifacts exist unless a caller opts in explicitly.
  const policy = decideApprovedSessionReopenPolicy(audit.effects);
  if (!policy.allowed && !args.allowWithDownstreamEffects) {
    return {
      ok: false,
      errorMessage: buildReopenBlockedMessage(policy),
      policy,
    };
  }

  const updateResult = await updateInventorySessionStatus({
    supabase: args.supabase,
    sessionId: args.sessionId,
    status: "IN_REVIEW",
    expectedCurrentStatus: "APPROVED",
  });

  return {
    ok: updateResult.ok,
    errorMessage: updateResult.errorMessage,
    policy,
  };
}

export async function duplicateInventorySession(args: {
  supabase: AppSupabase;
  restaurantId: string;
  sourceSession: InventorySessionListRow;
  userId: string;
  fallbackLocationId?: string | null;
}) {
  const { data: newSession, error } = await createInventorySession({
    supabase: args.supabase,
    restaurantId: args.restaurantId,
    inventoryListId: args.sourceSession.inventory_list_id,
    name: `${args.sourceSession.name} (copy)`,
    userId: args.userId,
    locationId: args.sourceSession.location_id ?? args.fallbackLocationId ?? null,
  });

  if (error || !newSession) {
    return {
      ok: false as const,
      errorMessage: error?.message ?? "Could not duplicate session.",
      data: null,
    };
  }

  const { data: sourceItems, error: sourceItemsError } = (await args.supabase
    .from("inventory_session_items")
    .select("*")
    .eq("session_id", args.sourceSession.id)) as unknown as {
    data: InventorySessionItemRow[] | null;
    error: SessionError;
  };

  if (sourceItemsError) {
    await args.supabase.from("inventory_sessions").delete().eq("id", newSession.id);
    return {
      ok: false as const,
      errorMessage: sourceItemsError.message,
      data: null,
    };
  }

  if (sourceItems && sourceItems.length > 0) {
    const duplicatedItems = sourceItems.map(({ id, session_id, ...row }) => ({
      ...row,
      session_id: newSession.id,
    }));
    const { error: duplicateItemsError } = await args.supabase
      .from("inventory_session_items")
      .insert(duplicatedItems);

    if (duplicateItemsError) {
      await args.supabase.from("inventory_session_items").delete().eq("session_id", newSession.id);
      await args.supabase.from("inventory_sessions").delete().eq("id", newSession.id);
      return {
        ok: false as const,
        errorMessage: duplicateItemsError.message,
        data: null,
      };
    }
  }

  return {
    ok: true as const,
    errorMessage: null,
    data: newSession,
  };
}

export async function approveInventorySession(args: {
  supabase: AppSupabase;
  sessionId: string;
  restaurantId: string;
  userId: string;
  riskThresholds: RiskThresholds;
}) {
  const sessionResult = await loadSession({
    supabase: args.supabase,
    sessionId: args.sessionId,
  });
  if (sessionResult.error) {
    return {
      ok: false as const,
      errorMessage: sessionResult.error.message,
      smartOrderRunId: null,
      smartOrderErrorMessage: null,
      catalogLinksStripped: false,
    };
  }

  if (!sessionResult.data) {
    return {
      ok: false as const,
      errorMessage: "Session not found.",
      smartOrderRunId: null,
      smartOrderErrorMessage: null,
      catalogLinksStripped: false,
    };
  }

  if (sessionResult.data.status !== "IN_REVIEW") {
    return {
      ok: false as const,
      errorMessage:
        sessionResult.data.status === "APPROVED"
          ? "Session is already approved."
          : "Only sessions in review can be approved.",
      smartOrderRunId: null,
      smartOrderErrorMessage: null,
      catalogLinksStripped: false,
    };
  }

  const preparedSmartOrder = await prepareSmartOrderFromSession({
    supabase: args.supabase,
    sessionId: args.sessionId,
    restaurantId: args.restaurantId,
    riskThresholds: args.riskThresholds,
  });

  if (!preparedSmartOrder.data) {
    return {
      ok: false as const,
      errorMessage: preparedSmartOrder.errorMessage,
      smartOrderRunId: null,
      smartOrderErrorMessage: null,
      catalogLinksStripped: false,
    };
  }

  const rpcArgs: ApproveInventorySessionAtomicRpcArgs = {
    p_session_id: args.sessionId,
    p_user_id: args.userId,
    p_par_guide_id: preparedSmartOrder.data.parGuideId ?? null,
    p_run_items: preparedSmartOrder.data.runItems as unknown as Json,
  };

  const { data: rpcResult, error: rpcError } = (await args.supabase.rpc(
    "approve_inventory_session_atomic",
    rpcArgs,
  )) as unknown as {
    data: ApproveInventorySessionAtomicRpcReturn | ApproveInventorySessionAtomicRpcRow | null;
    error: SessionError;
  };

  const approvalResult: ApproveInventorySessionAtomicRpcRow | null = Array.isArray(rpcResult)
    ? (rpcResult[0] ?? null)
    : rpcResult;

  if (rpcError || !approvalResult) {
    return {
      ok: false as const,
      errorMessage: rpcError?.message ?? "Inventory approval could not be saved.",
      smartOrderRunId: null,
      smartOrderErrorMessage: null,
      catalogLinksStripped: false,
    };
  }

  await publishSmartOrderAttentionNotifications({
    supabase: args.supabase,
    restaurantId: args.restaurantId,
    sessionId: args.sessionId,
    runId: approvalResult.run_id,
    redCount: preparedSmartOrder.data.redCount,
    yellowCount: preparedSmartOrder.data.yellowCount,
  });

  return {
    ok: true as const,
    errorMessage: null,
    smartOrderRunId: approvalResult.run_id,
    smartOrderErrorMessage: null,
    catalogLinksStripped: approvalResult.catalog_links_stripped,
  };
}
