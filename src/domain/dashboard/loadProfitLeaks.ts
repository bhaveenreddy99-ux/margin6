import { format } from "date-fns";
import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  ProfitLeakBreakdownRow,
  ProfitLeakItem,
  ProfitLeakReason,
} from "@/domain/dashboard/dashboardTypes";
import { withLocationOrNull } from "@/domain/locations/locationQueryScope";
import {
  buildPriceIncreaseBreakdownRows,
  fetchPriceIncreaseNotifications,
  loadVendorNamesForInvoiceIds,
  parsePriceIncreaseNotificationData,
} from "@/domain/dashboard/priceIncreaseFromNotifications";
import { buildLatestInventorySnapshot, buildSessionOverstockLines } from "@/domain/dashboard/dashboardSelectors";
import { riskThresholdsFromSettings } from "@/domain/inventory/riskThresholds";
import { dollarsForWasteRow } from "@/domain/waste/recordedWasteValue";
import type { InventorySessionItemRow } from "@/domain/dashboard/dashboardTypes";

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
 * mismatches), PRICE_INCREASE notifications from posted invoices, and the
 * latest APPROVED inventory session's overstocked items. Returns `[]` on any
 * failure — never throws.
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

  // ── 1. Waste (same row valuation as Dashboard loadWasteMetrics) ───────────
  try {
    let q = supabase
      .from("waste_log")
      .select(
        "item_name, total_cost, unit_cost, quantity, quantity_unit, catalog_item_id, reason, logged_at",
      )
      .eq("restaurant_id", restaurantId)
      .gte("logged_at", from)
      .lte("logged_at", to);
    if (loc) q = withLocationOrNull(q, loc);

    const { data: wasteRows } = (await q) as unknown as {
      data: Array<{
        item_name: string | null;
        total_cost: number | null;
        unit_cost: number | null;
        quantity: number | null;
        quantity_unit: string | null;
        catalog_item_id: string | null;
        reason: string | null;
        logged_at: string | null;
      }> | null;
    };

    const catalogIds = [
      ...new Set(
        (wasteRows ?? [])
          .map((r) => r.catalog_item_id)
          .filter((id): id is string => typeof id === "string" && id.length > 0),
      ),
    ];
    const catalogDefaultById = new Map<string, number>();
    if (catalogIds.length > 0) {
      const { data: catalogRows } = (await supabase
        .from("inventory_catalog_items")
        .select("id, default_unit_cost")
        .eq("restaurant_id", restaurantId)
        .in("id", catalogIds)) as unknown as {
        data: Array<{ id: string; default_unit_cost: number | null }> | null;
      };
      for (const row of catalogRows ?? []) {
        const value = Number(row.default_unit_cost);
        if (Number.isFinite(value) && value >= 0) catalogDefaultById.set(row.id, value);
      }
    }

    let sessionUnitByCatalogId = new Map<string, number>();
    try {
      let sessQ = supabase
        .from("inventory_sessions")
        .select("id")
        .eq("restaurant_id", restaurantId)
        .eq("status", "APPROVED")
        .order("approved_at", { ascending: false })
        .limit(1);
      if (loc) sessQ = withLocationOrNull(sessQ, loc);
      const { data: sessions } = (await sessQ) as unknown as {
        data: Array<{ id: string }> | null;
      };
      if (sessions?.length) {
        const { data: sessionItems } = (await supabase
          .from("inventory_session_items")
          .select("*")
          .eq("session_id", sessions[0]!.id)) as unknown as {
          data: InventorySessionItemRow[] | null;
        };
        const { data: riskSettings } = await supabase
          .from("smart_order_settings")
          .select("red_threshold, yellow_threshold")
          .eq("restaurant_id", restaurantId)
          .maybeSingle();
        const snap = buildLatestInventorySnapshot(
          sessionItems ?? [],
          riskThresholdsFromSettings(riskSettings),
        );
        sessionUnitByCatalogId = new Map(Object.entries(snap.latestSessionUnitCostByCatalogId));
      }
    } catch {
      // unit cost map optional — waste rows may still have total_cost
    }

    for (const row of wasteRows ?? []) {
      const name = (row.item_name ?? "").trim();
      if (!name) continue;
      const value = dollarsForWasteRow(row, catalogDefaultById, sessionUnitByCatalogId);
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
    if (loc) invQ = withLocationOrNull(invQ, loc);

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

    // Posted invoices emit PRICE_INCREASE notifications — not invoice_line_comparisons.
    const priceNotifs = await fetchPriceIncreaseNotifications(
      supabase,
      restaurantId,
      loc,
      from,
      to,
    );
    const notifInvoiceIds = priceNotifs
      .map((n) => parsePriceIncreaseNotificationData(n.data).invoice_id)
      .filter((id): id is string => Boolean(id));
    const vendorByInvoiceId = await loadVendorNamesForInvoiceIds(supabase, notifInvoiceIds);

    for (const row of buildPriceIncreaseBreakdownRows(priceNotifs, vendorByInvoiceId)) {
      const name = row.label.trim();
      if (!name) continue;
      const bucket = getOrCreate(buckets, leakKey(name, "Price Hike"));
      bucket.total += row.value;
      bucket.rows.push(row);
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
    if (loc) sessQ = withLocationOrNull(sessQ, loc);

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
        .select("*")
        .eq("session_id", session.id)) as unknown as {
        data: InventorySessionItemRow[] | null;
      };

      const sourceLabel = session.name ?? "Latest count";
      const sourceDate = fmtDate(session.approved_at);
      const overstockLines = buildSessionOverstockLines(items ?? []);

      for (const line of overstockLines) {
        const bucket = getOrCreate(buckets, leakKey(line.item_name, "Overstock"));
        bucket.total += line.dollars;
        bucket.rows.push({
          label: line.item_name,
          value: line.dollars,
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
    if (loc) shrinkQ = withLocationOrNull(shrinkQ, loc);

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
