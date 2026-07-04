import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/integrations/supabase/types";

type AppSupabase = SupabaseClient<Database>;

/**
 * Notification types a client may create. Must match the allowlist enforced by
 * the `create_member_notifications` SECURITY DEFINER RPC (S0-8). All KPI /
 * server-only types (SHRINK_ALERT, COUNT_VARIANCE, WEEKLY_DIGEST, PRICE_INCREASE,
 * REMINDER, COUNT_*, SMART_ORDER_READY, …) are intentionally excluded — those are
 * created only by the service-role server functions.
 */
export type MemberNotificationType =
  | "PAR_CHANGE_REQUEST"
  | "PRICE_CHANGE_REQUEST"
  | "PAR_SUGGESTIONS"
  | "LOW_STOCK";

export interface CreateMemberNotificationsArgs {
  restaurantId: string;
  recipientIds: string[];
  type: MemberNotificationType;
  severity: string;
  title: string;
  message: string;
  data?: Json;
}

/**
 * Create in-app notifications for one or more restaurant members via the
 * `create_member_notifications` RPC. The RPC (not the client) enforces caller
 * membership, recipient membership, the type allowlist, and provenance — direct
 * `notifications` INSERT is no longer permitted by RLS (S0-8). Returns an error
 * object shaped like a PostgREST write so existing call sites can keep their
 * `if (error) toast.error(...)` handling unchanged.
 */
export async function createMemberNotifications(
  supabase: AppSupabase,
  args: CreateMemberNotificationsArgs,
): Promise<{ error: { message: string } | null }> {
  if (args.recipientIds.length === 0) return { error: null };

  const { error } = await supabase.rpc("create_member_notifications", {
    p_restaurant_id: args.restaurantId,
    p_recipient_ids: args.recipientIds,
    p_type: args.type,
    p_severity: args.severity,
    p_title: args.title,
    p_message: args.message,
    p_data: args.data ?? {},
  });

  return { error: error ? { message: error.message } : null };
}
