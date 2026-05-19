import type { SupabaseClient, PostgrestError } from "@supabase/supabase-js";
import { format, startOfWeek } from "date-fns";
import type { Database } from "@/integrations/supabase/types";

type AppSupabase = SupabaseClient<Database>;

export type WeeklySalesEntryMethod =
  | "manual_weekly"
  | "manual_daily_aggregated"
  | "csv"
  | "email_in"
  | "pos_api";

export type WeeklySalesValue = {
  gross_sales: number;
  is_partial: boolean;
  entry_method: WeeklySalesEntryMethod;
};

/** Monday of the ISO week containing `d`, formatted as `YYYY-MM-DD`. */
export function weekStartFromDate(d: Date): string {
  return format(startOfWeek(d, { weekStartsOn: 1 }), "yyyy-MM-dd");
}

function normalizeWeekStart(weekStart: Date | string): string {
  return typeof weekStart === "string" ? weekStart : weekStartFromDate(weekStart);
}

export async function loadGrossSalesForWeek(args: {
  supabase: AppSupabase;
  locationId: string;
  weekStart: Date | string;
}): Promise<{ data: WeeklySalesValue | null; error: PostgrestError | null }> {
  const weekStartIso = normalizeWeekStart(args.weekStart);

  const { data, error } = await args.supabase
    .from("weekly_sales")
    .select("gross_sales, is_partial, entry_method")
    .eq("location_id", args.locationId)
    .eq("week_start", weekStartIso)
    .maybeSingle();

  if (error) return { data: null, error };
  if (!data) return { data: null, error: null };

  return {
    data: {
      gross_sales: Number(data.gross_sales),
      is_partial: data.is_partial,
      entry_method: data.entry_method as WeeklySalesEntryMethod,
    },
    error: null,
  };
}
