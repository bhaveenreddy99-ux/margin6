import { format } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import {
  buildPriceIncreaseBreakdownRows,
  fetchPriceIncreaseNotifications,
  loadVendorNamesForInvoiceIds,
  parsePriceIncreaseNotificationData,
} from "@/domain/dashboard/priceIncreaseFromNotifications";

type WasteRow = {
  item_name: string | null;
  total_cost: number | null;
  unit_cost: number | null;
  quantity: number | null;
  reason: string | null;
  logged_at: string | null;
};

type InvoiceMeta = {
  id: string;
  vendor_name: string | null;
  invoice_number: string | null;
  invoice_date: string | null;
};

type ComparisonRow = {
  invoice_id: string | null;
  item_name: string | null;
  po_unit_cost: number | null;
  invoiced_unit_cost: number | null;
  received_qty: number | null;
  invoiced_qty: number | null;
  status: string | null;
};

type SessionRow = {
  id: string;
  name: string | null;
  approved_at: string | null;
};

type SessionItemRow = {
  item_name: string | null;
  current_stock: number | null;
  par_level: number | null;
  unit_cost: number | null;
};

type ShrinkItem = {
  item_name?: string;
  dollar_impact?: number | string;
  type?: string;
};

type NotificationRow = {
  created_at: string | null;
  type: string | null;
  data: { items?: unknown } | null;
};

function fmtDate(value: string | null | undefined): string {
  if (!value) return "—";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? "—" : format(d, "MMM d");
}

export async function fetchWasteBreakdown(
  restaurantId: string,
  locationId: string | undefined,
  from: string,
  to: string,
): Promise<DrilldownRow[]> {
  let q = supabase
    .from("waste_log")
    .select("item_name, total_cost, unit_cost, quantity, reason, logged_at")
    .eq("restaurant_id", restaurantId)
    .gte("logged_at", from)
    .lte("logged_at", to)
    .order("logged_at", { ascending: false });
  if (locationId) q = q.eq("location_id", locationId);

  const { data } = (await q) as unknown as { data: WasteRow[] | null };
  return (data ?? [])
    .map((row) => {
      const explicit = Number(row.total_cost);
      const derived = Number(row.unit_cost) * Number(row.quantity);
      const value = Number.isFinite(explicit) && explicit > 0
        ? explicit
        : Number.isFinite(derived) && derived > 0
          ? derived
          : 0;
      return {
        label: row.item_name ?? "—",
        value,
        date: fmtDate(row.logged_at),
        source: row.reason ?? "waste",
      };
    })
    .filter((r) => r.value > 0);
}

export async function fetchPriceHikeBreakdown(
  restaurantId: string,
  locationId: string | undefined,
  from: string,
  to: string,
): Promise<DrilldownRow[]> {
  const fromDate = from.slice(0, 10);
  const toDate = to.slice(0, 10);

  let invQ = supabase
    .from("invoices")
    .select("id, vendor_name, invoice_number, invoice_date")
    .eq("restaurant_id", restaurantId)
    .gte("invoice_date", fromDate)
    .lte("invoice_date", toDate);
  if (locationId) invQ = invQ.eq("location_id", locationId);

  const { data: invoices } = (await invQ) as unknown as { data: InvoiceMeta[] | null };
  const invMap = new Map<string, InvoiceMeta>();
  for (const inv of invoices ?? []) invMap.set(inv.id, inv);
  const invoiceIds = Array.from(invMap.keys());

  let comparisonRows: DrilldownRow[] = [];
  if (invoiceIds.length > 0) {
    const { data: comparisons } = (await supabase
      .from("invoice_line_comparisons")
      .select(
        "invoice_id, item_name, po_unit_cost, invoiced_unit_cost, received_qty, invoiced_qty, status",
      )
      .in("invoice_id", invoiceIds)
      .eq("status", "price_mismatch")) as unknown as { data: ComparisonRow[] | null };

    comparisonRows = (comparisons ?? [])
      .map((row) => {
        const po = Number(row.po_unit_cost ?? 0);
        const inv = Number(row.invoiced_unit_cost ?? 0);
        const qty = Number(row.received_qty ?? row.invoiced_qty ?? 0);
        const impact = Math.max(0, (inv - po) * qty);
        const meta = row.invoice_id ? invMap.get(row.invoice_id) : undefined;
        return {
          label: row.item_name ?? "—",
          value: Number.isFinite(impact) ? impact : 0,
          date: fmtDate(meta?.invoice_date ?? null),
          source: meta
            ? `${meta.vendor_name ?? "Unknown"}${meta.invoice_number ? ` · ${meta.invoice_number}` : ""}`
            : "—",
        };
      })
      .filter((r) => r.value > 0);
  }

  const priceNotifs = await fetchPriceIncreaseNotifications(
    supabase,
    restaurantId,
    locationId,
    from,
    to,
  );
  const invoiceIdsFromNotifs = priceNotifs
    .map((n) => parsePriceIncreaseNotificationData(n.data).invoice_id)
    .filter((id): id is string => Boolean(id));
  const vendorByInvoiceId = await loadVendorNamesForInvoiceIds(
    supabase,
    invoiceIdsFromNotifs,
  );
  const notificationRows = buildPriceIncreaseBreakdownRows(
    priceNotifs,
    vendorByInvoiceId,
  );

  return [...comparisonRows, ...notificationRows].sort((a, b) => b.value - a.value);
}

export async function fetchOverstockBreakdown(
  restaurantId: string,
  locationId: string | undefined,
): Promise<DrilldownRow[]> {
  let sessQ = supabase
    .from("inventory_sessions")
    .select("id, name, approved_at")
    .eq("restaurant_id", restaurantId)
    .eq("status", "APPROVED")
    .order("approved_at", { ascending: false })
    .limit(1);
  if (locationId) sessQ = sessQ.eq("location_id", locationId);

  const { data: sessions } = (await sessQ) as unknown as { data: SessionRow[] | null };
  if (!sessions || sessions.length === 0) return [];

  const session = sessions[0];
  const { data: items } = (await supabase
    .from("inventory_session_items")
    .select("item_name, current_stock, par_level, unit_cost")
    .eq("session_id", session.id)) as unknown as { data: SessionItemRow[] | null };

  const sourceLabel = session.name ?? "Latest count";
  const sourceDate = fmtDate(session.approved_at);

  return (items ?? [])
    .map((row) => {
      const stock = Number(row.current_stock ?? 0);
      const par = Number(row.par_level ?? 0);
      const cost = Number(row.unit_cost ?? 0);
      const excess = Math.max(0, stock - par);
      const dollars = excess * cost;
      return {
        label: row.item_name ?? "—",
        value: Number.isFinite(dollars) ? dollars : 0,
        date: sourceDate,
        source: sourceLabel,
      };
    })
    .filter((r) => r.value > 0)
    .sort((a, b) => b.value - a.value);
}

export async function fetchShrinkageBreakdown(
  restaurantId: string,
  locationId: string | undefined,
  from: string,
  to: string,
): Promise<DrilldownRow[]> {
  let q = supabase
    .from("notifications")
    .select("created_at, type, data")
    .eq("restaurant_id", restaurantId)
    .in("type", ["SHRINK_ALERT", "COUNT_VARIANCE"])
    .gte("created_at", from)
    .lte("created_at", to);
  if (locationId) q = q.eq("location_id", locationId);

  const { data } = (await q) as unknown as { data: NotificationRow[] | null };

  const rows: DrilldownRow[] = [];
  for (const n of data ?? []) {
    const raw = n.data;
    const items = Array.isArray(raw?.items) ? (raw.items as ShrinkItem[]) : [];
    for (const item of items) {
      const impact = Number(item?.dollar_impact);
      if (!Number.isFinite(impact) || impact <= 0) continue;
      rows.push({
        label: item.item_name ?? "—",
        value: impact,
        date: fmtDate(n.created_at),
        source: item.type ?? n.type ?? "shrinkage",
      });
    }
  }
  return rows.sort((a, b) => b.value - a.value);
}
