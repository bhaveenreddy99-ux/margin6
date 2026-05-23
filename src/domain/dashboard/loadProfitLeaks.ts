import { format } from "date-fns";
import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  ProfitLeakBreakdownRow,
  ProfitLeakItem,
  ProfitLeakReason,
} from "@/domain/dashboard/dashboardTypes";

type Bucket = {
  total: number;
  rows: ProfitLeakBreakdownRow[];
};

type LeakKey = `${string}|${ProfitLeakReason}`;

function leakKey(item: string, reason: ProfitLeakReason): LeakKey {
  return `${item}|${reason}` as LeakKey;
}

function fmtDate(value: string | null | undefined): string {
  if (!value) return "—";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? "—" : format(d, "MMM d");
}

function getOrCreate(map: Map<LeakKey, Bucket>, key: LeakKey): Bucket {
  const existing = map.get(key);
  if (existing) return existing;
  const fresh: Bucket = { total: 0, rows: [] };
  map.set(key, fresh);
  return fresh;
}

/**
 * Builds the top-5 ranked list of (item, reason) pairs that lost the most
 * money in the period. Sources: waste_log, invoice_line_comparisons (price
 * mismatches on invoices dated within the period), and the latest APPROVED
 * inventory session's overstocked items. Returns `[]` on any failure — never
 * throws. Each leak entry includes a per-line breakdown so the UI can open a
 * DrilldownSheet without re-querying.
 */
export async function loadProfitLeaks(
  supabase: SupabaseClient,
  restaurantId: string,
  locationId: string | null | undefined,
  from: string,
  to: string,
): Promise<ProfitLeakItem[]> {
  const buckets = new Map<LeakKey, Bucket>();
  const fromDate = from.slice(0, 10);
  const toDate = to.slice(0, 10);
  const loc = locationId ?? undefined;

  // ── 1. Waste ──────────────────────────────────────────────────────────────
  try {
    let q = supabase
      .from("waste_log")
      .select("item_name, total_cost, unit_cost, quantity, reason, logged_at")
      .eq("restaurant_id", restaurantId)
      .gte("logged_at", from)
      .lte("logged_at", to);
    if (loc) q = q.eq("location_id", loc);

    const { data: wasteRows } = (await q) as unknown as {
      data: Array<{
        item_name: string | null;
        total_cost: number | null;
        unit_cost: number | null;
        quantity: number | null;
        reason: string | null;
        logged_at: string | null;
      }> | null;
    };

    for (const row of wasteRows ?? []) {
      const name = (row.item_name ?? "").trim();
      if (!name) continue;
      const explicit = Number(row.total_cost);
      const derived = Number(row.unit_cost) * Number(row.quantity);
      const value =
        Number.isFinite(explicit) && explicit > 0
          ? explicit
          : Number.isFinite(derived) && derived > 0
            ? derived
            : 0;
      if (value <= 0) continue;

      const bucket = getOrCreate(buckets, leakKey(name, "Waste"));
      bucket.total += value;
      bucket.rows.push({
        label: name,
        value,
        date: fmtDate(row.logged_at),
        source: row.reason ?? "waste",
      });
    }
  } catch {
    // swallow — partial results are better than no card
  }

  // ── 2. Price hikes ────────────────────────────────────────────────────────
  try {
    let invQ = supabase
      .from("invoices")
      .select("id, vendor_name, invoice_number, invoice_date")
      .eq("restaurant_id", restaurantId)
      .gte("invoice_date", fromDate)
      .lte("invoice_date", toDate);
    if (loc) invQ = invQ.eq("location_id", loc);

    const { data: invoices } = (await invQ) as unknown as {
      data: Array<{
        id: string;
        vendor_name: string | null;
        invoice_number: string | null;
        invoice_date: string | null;
      }> | null;
    };
    const invMap = new Map<
      string,
      { vendor: string; number: string; date: string }
    >();
    for (const inv of invoices ?? []) {
      invMap.set(inv.id, {
        vendor: inv.vendor_name ?? "Unknown vendor",
        number: inv.invoice_number ?? "—",
        date: fmtDate(inv.invoice_date),
      });
    }
    const invoiceIds = Array.from(invMap.keys());

    if (invoiceIds.length > 0) {
      const { data: comparisons } = (await supabase
        .from("invoice_line_comparisons")
        .select(
          "invoice_id, item_name, po_unit_cost, invoiced_unit_cost, invoiced_qty, status",
        )
        .in("invoice_id", invoiceIds)
        .eq("status", "price_mismatch")) as unknown as {
        data: Array<{
          invoice_id: string | null;
          item_name: string | null;
          po_unit_cost: number | null;
          invoiced_unit_cost: number | null;
          invoiced_qty: number | null;
          status: string | null;
        }> | null;
      };

      for (const row of comparisons ?? []) {
        const name = (row.item_name ?? "").trim();
        if (!name) continue;
        const po = Number(row.po_unit_cost ?? 0);
        const inv = Number(row.invoiced_unit_cost ?? 0);
        const qty = Number(row.invoiced_qty ?? 0);
        const impact = Math.max(0, (inv - po) * qty);
        if (!Number.isFinite(impact) || impact <= 0) continue;

        const meta = row.invoice_id ? invMap.get(row.invoice_id) : undefined;
        const bucket = getOrCreate(buckets, leakKey(name, "Price Hike"));
        bucket.total += impact;
        bucket.rows.push({
          label: name,
          value: impact,
          date: meta?.date ?? "—",
          source: meta ? `${meta.vendor} · ${meta.number}` : "invoice",
        });
      }
    }
  } catch {
    // swallow
  }

  // ── 3. Overstock (latest APPROVED session) ────────────────────────────────
  try {
    let sessQ = supabase
      .from("inventory_sessions")
      .select("id, name, approved_at")
      .eq("restaurant_id", restaurantId)
      .eq("status", "APPROVED")
      .order("approved_at", { ascending: false })
      .limit(1);
    if (loc) sessQ = sessQ.eq("location_id", loc);

    const { data: sessions } = (await sessQ) as unknown as {
      data: Array<{
        id: string;
        name: string | null;
        approved_at: string | null;
      }> | null;
    };

    if (sessions && sessions.length > 0) {
      const session = sessions[0];
      const { data: items } = (await supabase
        .from("inventory_session_items")
        .select("item_name, current_stock, par_level, unit_cost")
        .eq("session_id", session.id)) as unknown as {
        data: Array<{
          item_name: string | null;
          current_stock: number | null;
          par_level: number | null;
          unit_cost: number | null;
        }> | null;
      };

      const sourceLabel = session.name ?? "Latest count";
      const sourceDate = fmtDate(session.approved_at);

      for (const row of items ?? []) {
        const name = (row.item_name ?? "").trim();
        if (!name) continue;
        const stock = Number(row.current_stock ?? 0);
        const par = Number(row.par_level ?? 0);
        const cost = Number(row.unit_cost ?? 0);
        const excess = Math.max(0, stock - par);
        const dollars = excess * cost;
        if (!Number.isFinite(dollars) || dollars <= 0) continue;

        const bucket = getOrCreate(buckets, leakKey(name, "Overstock"));
        bucket.total += dollars;
        bucket.rows.push({
          label: name,
          value: dollars,
          date: sourceDate,
          source: sourceLabel,
        });
      }
    }
  } catch {
    // swallow
  }

  // ── 4. Shrinkage (SHRINK_ALERT / COUNT_VARIANCE notifications) ───────────
  try {
    let shrinkQ = supabase
      .from("notifications")
      .select("data, created_at")
      .eq("restaurant_id", restaurantId)
      .in("type", ["SHRINK_ALERT", "COUNT_VARIANCE"])
      .gte("created_at", from)
      .lte("created_at", to);
    if (loc) shrinkQ = shrinkQ.eq("location_id", loc);

    const { data: shrinkNotifs } = (await shrinkQ) as unknown as {
      data: Array<{ data: unknown; created_at: string | null }> | null;
    };

    for (const notif of shrinkNotifs ?? []) {
      const raw = notif.data as { items?: unknown } | null | undefined;
      const items = Array.isArray(raw?.items)
        ? (raw.items as Array<{
            item_name?: string;
            dollar_impact?: number | string;
            type?: string;
          }>)
        : [];

      for (const item of items) {
        const name = (item.item_name ?? "").trim();
        if (!name) continue;
        const impact = Number(item.dollar_impact);
        if (!Number.isFinite(impact) || impact <= 0) continue;

        const bucket = getOrCreate(buckets, leakKey(name, "Shrinkage"));
        bucket.total += impact;
        bucket.rows.push({
          label: name,
          value: impact,
          date: fmtDate(notif.created_at),
          source: item.type ?? "shrinkage",
        });
      }
    }
  } catch {
    // swallow
  }

  const leaks: ProfitLeakItem[] = [];
  for (const [key, bucket] of buckets.entries()) {
    if (bucket.total <= 0) continue;
    const [itemName, reasonStr] = key.split("|");
    leaks.push({
      item_name: itemName,
      total: bucket.total,
      reason: reasonStr as ProfitLeakReason,
      breakdown: bucket.rows.sort((a, b) => b.value - a.value),
    });
  }

  return leaks.sort((a, b) => b.total - a.total).slice(0, 5);
}
