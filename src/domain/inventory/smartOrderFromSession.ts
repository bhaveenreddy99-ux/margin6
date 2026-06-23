import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { createMemberNotifications } from "@/domain/notifications/createMemberNotifications";
import {
  buildSmartOrderComputedItems,
  buildSmartOrderRiskCounts,
  type SmartOrderComputedItem,
} from "@/domain/inventory/enterInventoryHelpers";
import type {
  InventorySessionItemRow,
  InventorySessionListRow,
  NotificationPreferenceRow,
  ParGuideItemRow,
} from "@/domain/inventory/enterInventoryTypes";
import { buildParGuideLevelMaps } from "@/domain/inventory/parGuideLevels";
import { fetchLatestParGuide } from "@/features/inventory-count/queries/inventoryCountQueries";
import type { RiskThresholds } from "@/lib/inventory-utils";

type AppSupabase = SupabaseClient<Database>;
type SmartOrderRunItemInsert = Database["public"]["Tables"]["smart_order_run_items"]["Insert"];

type NotificationMemberRow = {
  user_id: string;
  role: string;
};

export type PreparedSmartOrderRunItem = {
  catalog_item_id: string | null;
  item_name: string;
  suggested_order: number;
  risk: SmartOrderComputedItem["risk"];
  current_stock: number;
  par_level: number;
  unit_cost: number | null;
  pack_size: string | null;
  brand_name: string | null;
};

export type PreparedSmartOrderFromSession = {
  session: InventorySessionListRow;
  parGuideId: string | null;
  runItems: PreparedSmartOrderRunItem[];
  redCount: number;
  yellowCount: number;
};

function buildPreparedSmartOrderRunItems(items: SmartOrderComputedItem[]): PreparedSmartOrderRunItem[] {
  return items.map((item) => ({
    catalog_item_id: item.catalog_item_id || null,
    item_name: item.item_name,
    suggested_order: item.suggestedOrder,
    risk: item.risk,
    current_stock: item.currentStock,
    par_level: item.parLevel,
    unit_cost: item.unit_cost ?? null,
    pack_size: item.pack_size || null,
    brand_name: item.brand_name || null,
  }));
}

async function notifySmartOrderAttentionRecipients(args: {
  supabase: AppSupabase;
  restaurantId: string;
  sessionId: string;
  runId: string;
  redCount: number;
  yellowCount: number;
}) {
  const { data: prefs } = (await args.supabase
    .from("notification_preferences")
    .select("*, alert_recipients(user_id)")
    .eq("restaurant_id", args.restaurantId)
    .eq("channel_in_app", true)
    .limit(1)
    .single()) as unknown as {
    data: NotificationPreferenceRow | null;
  };

  if (!prefs) return;

  const { data: members } = (await args.supabase
    .from("restaurant_members")
    .select("user_id, role")
    .eq("restaurant_id", args.restaurantId)) as unknown as {
    data: Array<Pick<NotificationMemberRow, "user_id" | "role">> | null;
  };

  let targetUserIds: string[] = [];
  if (prefs.recipients_mode === "OWNERS_MANAGERS") {
    targetUserIds = (members ?? [])
      .filter((member) => member.role === "OWNER" || member.role === "MANAGER")
      .map((member) => member.user_id);
  } else if (prefs.recipients_mode === "ALL") {
    targetUserIds = (members ?? []).map((member) => member.user_id);
  } else if (prefs.recipients_mode === "CUSTOM") {
    targetUserIds = (prefs.alert_recipients ?? []).map((recipient) => recipient.user_id);
  }

  if (targetUserIds.length === 0) return;

  await createMemberNotifications(args.supabase, {
    restaurantId: args.restaurantId,
    recipientIds: targetUserIds,
    type: "LOW_STOCK",
    severity: args.redCount > 0 ? "CRITICAL" : "WARNING",
    title: `Inventory Approved — ${args.redCount + args.yellowCount} item${
      args.redCount + args.yellowCount > 1 ? "s" : ""
    } need attention`,
    message: `${args.redCount} high risk, ${args.yellowCount} medium risk items detected`,
    data: {
      session_id: args.sessionId,
      run_id: args.runId,
      red: args.redCount,
      yellow: args.yellowCount,
    },
  });
}

export async function publishSmartOrderAttentionNotifications(args: {
  supabase: AppSupabase;
  restaurantId: string;
  sessionId: string;
  runId: string | null;
  redCount: number;
  yellowCount: number;
}) {
  if (!args.runId || (args.redCount === 0 && args.yellowCount === 0)) return;

  await notifySmartOrderAttentionRecipients({
    supabase: args.supabase,
    restaurantId: args.restaurantId,
    sessionId: args.sessionId,
    runId: args.runId,
    redCount: args.redCount,
    yellowCount: args.yellowCount,
  });
}

export async function prepareSmartOrderFromSession(args: {
  supabase: AppSupabase;
  sessionId: string;
  restaurantId: string;
  /** Scoped PAR guide lookup; when omitted, uses the loaded session's `location_id`. */
  locationId?: string | null;
  riskThresholds: RiskThresholds;
  parGuideId?: string | null;
}) {
  const { data: session } = (await args.supabase
    .from("inventory_sessions")
    .select("*")
    .eq("id", args.sessionId)
    .single()) as unknown as {
    data: InventorySessionListRow | null;
  };

  if (!session) {
    return {
      data: null,
      errorMessage: "Session not found.",
    };
  }

  const { data: sessionItems } = (await args.supabase
    .from("inventory_session_items")
    .select("*")
    .eq("session_id", args.sessionId)) as unknown as {
    data: InventorySessionItemRow[] | null;
  };

  if (!sessionItems || sessionItems.length === 0) {
    return {
      data: null,
      errorMessage: "No session items found",
    };
  }

  let resolvedParGuideId = args.parGuideId ?? null;
  if (!resolvedParGuideId) {
    const parLocationId = args.locationId ?? session.location_id ?? null;
    const latestGuide = await fetchLatestParGuide(
      session.inventory_list_id,
      args.restaurantId,
      parLocationId,
      args.supabase,
    );
    resolvedParGuideId = latestGuide.data?.id ?? null;
  }

  const parItems = resolvedParGuideId
    ? ((await args.supabase
        .from("par_guide_items")
        .select("item_name, par_level, catalog_item_id")
        .eq("par_guide_id", resolvedParGuideId)) as unknown as {
        data: Array<Pick<ParGuideItemRow, "item_name" | "par_level" | "catalog_item_id">> | null;
      }).data ?? []
    : [];

  const computed = buildSmartOrderComputedItems({
    sessionItems,
    parMaps: resolvedParGuideId ? buildParGuideLevelMaps(parItems) : null,
    riskThresholds: args.riskThresholds,
  });

  const { redCount, yellowCount } = buildSmartOrderRiskCounts(computed);

  return {
    data: {
      session,
      parGuideId: resolvedParGuideId,
      runItems: buildPreparedSmartOrderRunItems(computed),
      redCount,
      yellowCount,
    } satisfies PreparedSmartOrderFromSession,
    errorMessage: null,
  };
}

export async function createSmartOrderFromSession(args: {
  supabase: AppSupabase;
  sessionId: string;
  restaurantId: string;
  userId: string;
  riskThresholds: RiskThresholds;
  parGuideId?: string | null;
  mode: "approval" | "manual";
  notifyRecipients?: boolean;
}) {
  const prepared = await prepareSmartOrderFromSession({
    supabase: args.supabase,
    sessionId: args.sessionId,
    restaurantId: args.restaurantId,
    riskThresholds: args.riskThresholds,
    parGuideId: args.parGuideId,
  });

  if (!prepared.data) {
    return {
      runId: null,
      errorMessage: prepared.errorMessage,
      catalogLinksStripped: false,
      redCount: 0,
      yellowCount: 0,
    };
  }

  const {
    session,
    parGuideId: resolvedParGuideId,
    runItems,
    redCount,
    yellowCount,
  } = prepared.data;

  const { data: run, error: runError } = (await args.supabase
    .from("smart_order_runs")
    .insert({
      restaurant_id: args.restaurantId,
      session_id: args.sessionId,
      inventory_list_id: session.inventory_list_id,
      location_id: session.location_id ?? null,
      par_guide_id: resolvedParGuideId,
      created_by: args.userId,
    })
    .select()
    .single()) as unknown as {
    data: { id: string } | null;
    error: { message: string } | null;
  };

  if (runError || !run) {
    return {
      runId: null,
      errorMessage: runError?.message ?? "Could not create smart order.",
      catalogLinksStripped: false,
      redCount,
      yellowCount,
    };
  }

  const insertedRunItems: SmartOrderRunItemInsert[] = runItems.map((item) => ({
    run_id: run.id,
    ...item,
  }));
  let catalogLinksStripped = false;
  let itemsError = (await args.supabase.from("smart_order_run_items").insert(insertedRunItems)).error;
  if (itemsError) {
    const withoutCatalog = insertedRunItems.map(({ catalog_item_id: _removed, ...row }) => row);
    itemsError = (await args.supabase.from("smart_order_run_items").insert(withoutCatalog)).error;
    if (itemsError) {
      await args.supabase.from("smart_order_runs").delete().eq("id", run.id);
      return {
        runId: null,
        errorMessage:
          args.mode === "manual"
            ? `Could not save order lines: ${itemsError.message}`
            : "Smart order could not be saved — please create it manually from the approved session.",
        catalogLinksStripped: false,
        redCount,
        yellowCount,
      };
    }
    catalogLinksStripped = true;
  }

  if (args.notifyRecipients ?? true) {
    await publishSmartOrderAttentionNotifications({
      supabase: args.supabase,
      restaurantId: args.restaurantId,
      sessionId: args.sessionId,
      runId: run.id,
      redCount,
      yellowCount,
    });
  }

  return {
    runId: run.id,
    errorMessage: null,
    catalogLinksStripped,
    redCount,
    yellowCount,
  };
}
