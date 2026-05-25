import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

type AppSupabase = SupabaseClient<Database>;

export type AppNotificationEvent =
  | { event: "COUNT_SUBMITTED"; sessionId: string }
  | { event: "COUNT_APPROVED"; sessionId: string }
  | { event: "SMART_ORDER_READY"; sessionId: string; runId: string };

/** Fire-and-forget notification dispatch — never blocks the count workflow. */
export async function dispatchAppNotification(
  supabase: AppSupabase,
  payload: AppNotificationEvent,
): Promise<void> {
  try {
    const { error } = await supabase.functions.invoke("dispatch-app-notifications", {
      body: payload,
    });
    if (error) {
      console.warn("[dispatchAppNotification] invoke failed:", error.message, payload);
    }
  } catch (err) {
    console.warn("[dispatchAppNotification] invoke exception:", err, payload);
  }
}
