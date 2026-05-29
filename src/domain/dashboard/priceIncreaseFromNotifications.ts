import { format, startOfWeek } from "date-fns";
import type { SupabaseClient } from "@supabase/supabase-js";
import { dashboardSpendRangeFromFilter } from "@/domain/dashboard/dashboardSelectors";
import type { DashboardTimeFilter, ProfitLeakBreakdownRow } from "@/domain/dashboard/dashboardTypes";
import { withLocationOrNull } from "@/domain/locations/locationQueryScope";

export type PriceIncreaseNotificationItem = {
  item_name: string;
  old_cost?: number;
  new_cost: number;
  pct_change?: number;
};

export type PriceIncreaseNotificationData = {
  items?: PriceIncreaseNotificationItem[];
  invoice_id?: string;
};

export type PriceIncreaseAlertRow = {
  id: string;
  vendor_name: string;
  item_name: string;
  pct_change: number;
  dollar_impact: number;
  date: string;
  source: string;
};

type NotificationRow = {
  id: string;
  data: unknown;
  created_at: string | null;
};

function fmtDate(value: string | null | undefined): string {
  if (!value) return "—";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? "—" : format(d, "MMM d");
}

export function parsePriceIncreaseNotificationData(
  data: unknown,
): PriceIncreaseNotificationData {
  if (!data || typeof data !== "object") return {};
  const record = data as PriceIncreaseNotificationData;
  const items = Array.isArray(record.items) ? record.items : [];
  return {
    invoice_id: typeof record.invoice_id === "string" ? record.invoice_id : undefined,
    items: items
      .map((item) => ({
        item_name: String(item?.item_name ?? "").trim(),
        old_cost: item?.old_cost != null ? Number(item.old_cost) : undefined,
        new_cost: Number(item?.new_cost ?? 0),
        pct_change: item?.pct_change != null ? Number(item.pct_change) : undefined,
      }))
      .filter((item) => item.item_name.length > 0),
  };
}

/** Conservative per-unit impact when qty is unknown (qty = 1). */
export function priceIncreaseDollarImpact(
  item: PriceIncreaseNotificationItem,
  qty = 1,
): number {
  const oldCost = Number(item.old_cost ?? 0);
  const newCost = Number(item.new_cost ?? 0);
  if (!Number.isFinite(newCost) || !Number.isFinite(oldCost) || newCost <= oldCost) {
    return 0;
  }
  const quantity = Number.isFinite(qty) && qty > 0 ? qty : 1;
  return (newCost - oldCost) * quantity;
}

export async function fetchPriceIncreaseNotifications(
  supabase: SupabaseClient,
  restaurantId: string,
  locationId: string | null | undefined,
  from: string,
  to: string,
): Promise<NotificationRow[]> {
  let query = supabase
    .from("notifications")
    .select("id, data, created_at")
    .eq("restaurant_id", restaurantId)
    .eq("type", "PRICE_INCREASE")
    .gte("created_at", from)
    .lte("created_at", to);
  if (locationId) query = withLocationOrNull(query, locationId);

  const { data } = (await query) as unknown as { data: NotificationRow[] | null };
  return data ?? [];
}

export function sumPriceIncreaseImpactFromNotifications(
  notifications: NotificationRow[],
): number {
  let total = 0;
  for (const notification of notifications) {
    const parsed = parsePriceIncreaseNotificationData(notification.data);
    for (const item of parsed.items ?? []) {
      total += priceIncreaseDollarImpact(item);
    }
  }
  return total;
}

export function buildPriceIncreaseBreakdownRows(
  notifications: NotificationRow[],
  vendorByInvoiceId: Map<string, string> = new Map(),
): ProfitLeakBreakdownRow[] {
  const rows: ProfitLeakBreakdownRow[] = [];

  for (const notification of notifications) {
    const parsed = parsePriceIncreaseNotificationData(notification.data);
    const vendor = parsed.invoice_id
      ? vendorByInvoiceId.get(parsed.invoice_id) ?? "Confirmed invoice"
      : "Confirmed invoice";

    for (const item of parsed.items ?? []) {
      const impact = priceIncreaseDollarImpact(item);
      if (impact <= 0) continue;
      rows.push({
        label: item.item_name,
        value: impact,
        date: fmtDate(notification.created_at),
        source: vendor,
      });
    }
  }

  return rows.sort((a, b) => b.value - a.value);
}

export function buildPriceIncreaseAlertRows(
  notifications: NotificationRow[],
  vendorByInvoiceId: Map<string, string> = new Map(),
): PriceIncreaseAlertRow[] {
  const rows: PriceIncreaseAlertRow[] = [];

  for (const notification of notifications) {
    const parsed = parsePriceIncreaseNotificationData(notification.data);
    const vendor = parsed.invoice_id
      ? vendorByInvoiceId.get(parsed.invoice_id) ?? "Unknown vendor"
      : "Unknown vendor";

    (parsed.items ?? []).forEach((item, index) => {
      const impact = priceIncreaseDollarImpact(item);
      if (impact <= 0) return;
      const oldCost = Number(item.old_cost ?? 0);
      const newCost = Number(item.new_cost ?? 0);
      const pct =
        item.pct_change != null && Number.isFinite(Number(item.pct_change))
          ? Number(item.pct_change)
          : oldCost > 0
            ? ((newCost - oldCost) / oldCost) * 100
            : 0;

      rows.push({
        id: `${notification.id}-${index}`,
        vendor_name: vendor,
        item_name: item.item_name,
        pct_change: pct,
        dollar_impact: impact,
        date: fmtDate(notification.created_at),
        source: vendor,
      });
    });
  }

  return rows.sort((a, b) => b.dollar_impact - a.dollar_impact);
}

export async function loadVendorNamesForInvoiceIds(
  supabase: SupabaseClient,
  invoiceIds: string[],
): Promise<Map<string, string>> {
  const vendorById = new Map<string, string>();
  if (invoiceIds.length === 0) return vendorById;

  try {
    const { data } = (await supabase
      .from("invoices")
      .select("id, vendor_name")
      .in("id", invoiceIds)) as unknown as {
      data: Array<{ id: string; vendor_name: string | null }> | null;
    };

    for (const row of data ?? []) {
      vendorById.set(row.id, row.vendor_name ?? "Unknown vendor");
    }
  } catch {
    // swallow
  }

  return vendorById;
}

export async function loadPriceIncreaseAlertRows(
  supabase: SupabaseClient,
  restaurantId: string,
  locationId: string | null | undefined,
  timeFilter: DashboardTimeFilter,
): Promise<PriceIncreaseAlertRow[]> {
  try {
    const { startDate, endDate } = dashboardSpendRangeFromFilter(timeFilter);
    const notifications = await fetchPriceIncreaseNotifications(
      supabase,
      restaurantId,
      locationId,
      startDate,
      endDate,
    );

    const invoiceIds = notifications
      .map((n) => parsePriceIncreaseNotificationData(n.data).invoice_id)
      .filter((id): id is string => Boolean(id));

    const vendorByInvoiceId = await loadVendorNamesForInvoiceIds(supabase, invoiceIds);
    return buildPriceIncreaseAlertRows(notifications, vendorByInvoiceId);
  } catch {
    return [];
  }
}

export function weekStartIsoForFilter(
  filter: DashboardTimeFilter,
  now = new Date(),
): string {
  const { startDate } = dashboardSpendRangeFromFilter(filter, now);
  return format(startOfWeek(new Date(startDate), { weekStartsOn: 1 }), "yyyy-MM-dd");
}
