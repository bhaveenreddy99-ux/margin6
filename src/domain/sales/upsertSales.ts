import type { SupabaseClient, PostgrestError } from "@supabase/supabase-js";
import { format, startOfWeek } from "date-fns";
import type { Database } from "@/integrations/supabase/types";

type AppSupabase = SupabaseClient<Database>;
export type WeeklySalesRow = Database["public"]["Tables"]["weekly_sales"]["Row"];
export type DailySalesRow = Database["public"]["Tables"]["daily_sales"]["Row"];

export type SalesOptionalFields = {
  netSales?: number;
  comps?: number;
  discounts?: number;
  tax?: number;
};

function clientValidationError(message: string): PostgrestError {
  return {
    name: "ClientValidationError",
    message,
    details: "",
    hint: "",
    code: "P0001",
  } as unknown as PostgrestError;
}

function validateAmounts(
  grossSales: number,
  optional: SalesOptionalFields | undefined,
): PostgrestError | null {
  if (!(grossSales >= 0)) return clientValidationError("gross_sales must be >= 0");
  if (optional) {
    if (optional.netSales != null && !(optional.netSales >= 0)) return clientValidationError("net_sales must be >= 0");
    if (optional.comps != null && !(optional.comps >= 0)) return clientValidationError("comps must be >= 0");
    if (optional.discounts != null && !(optional.discounts >= 0)) return clientValidationError("discounts must be >= 0");
    if (optional.tax != null && !(optional.tax >= 0)) return clientValidationError("tax must be >= 0");
  }
  return null;
}

function applyOptional<T extends Record<string, unknown>>(
  payload: T,
  optional: SalesOptionalFields | undefined,
): T {
  if (!optional) return payload;
  const next: Record<string, unknown> = { ...payload };
  if (optional.netSales != null) next.net_sales = optional.netSales;
  if (optional.comps != null) next.comps = optional.comps;
  if (optional.discounts != null) next.discounts = optional.discounts;
  if (optional.tax != null) next.tax = optional.tax;
  return next as T;
}

function asDateString(d: Date | string): string {
  return typeof d === "string" ? d : format(d, "yyyy-MM-dd");
}

function asWeekStart(d: Date | string): string {
  if (typeof d === "string") return d;
  return format(startOfWeek(d, { weekStartsOn: 1 }), "yyyy-MM-dd");
}

export async function upsertWeeklySales(args: {
  supabase: AppSupabase;
  restaurantId: string;
  locationId: string;
  weekStart: Date | string;
  enteredByUserId: string;
  grossSales: number;
  optional?: SalesOptionalFields;
}): Promise<{ data: WeeklySalesRow | null; error: PostgrestError | null }> {
  const validationErr = validateAmounts(args.grossSales, args.optional);
  if (validationErr) return { data: null, error: validationErr };

  const payload = applyOptional(
    {
      restaurant_id: args.restaurantId,
      location_id: args.locationId,
      week_start: asWeekStart(args.weekStart),
      gross_sales: args.grossSales,
      entry_method: "manual_weekly",
      entered_by_user_id: args.enteredByUserId,
    },
    args.optional,
  );

  const { data, error } = await args.supabase
    .from("weekly_sales")
    .upsert(payload, { onConflict: "location_id,week_start" })
    .select()
    .single();

  return { data, error };
}

export async function upsertDailySales(args: {
  supabase: AppSupabase;
  restaurantId: string;
  locationId: string;
  saleDate: Date | string;
  enteredByUserId: string;
  grossSales: number;
  optional?: SalesOptionalFields;
}): Promise<{ data: DailySalesRow | null; error: PostgrestError | null }> {
  const validationErr = validateAmounts(args.grossSales, args.optional);
  if (validationErr) return { data: null, error: validationErr };

  const payload = applyOptional(
    {
      restaurant_id: args.restaurantId,
      location_id: args.locationId,
      sale_date: asDateString(args.saleDate),
      gross_sales: args.grossSales,
      entry_method: "manual_daily",
      entered_by_user_id: args.enteredByUserId,
    },
    args.optional,
  );

  const { data, error } = await args.supabase
    .from("daily_sales")
    .upsert(payload, { onConflict: "location_id,sale_date" })
    .select()
    .single();

  return { data, error };
}
