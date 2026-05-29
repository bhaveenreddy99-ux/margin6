import { supabase } from "@/integrations/supabase/client";
import {
  dashboardSpendRangeFromFilter,
  invoiceBusinessDateInRange,
  isInvoiceLineComparisonProblem,
  linePriceIncreaseImpact,
  sumPeriodInvoiceSpend,
} from "@/domain/dashboard/dashboardSelectors";
import { resolvePurchaseHistoryBusinessDate } from "@/lib/purchase-history-source";
import { fetchInvoiceDocumentIdsForRestaurant } from "@/lib/procurement-dedupe";
import type {
  DashboardInvoiceStatusRow,
  DashboardTimeFilter,
  InvoiceLineComparisonRow,
  SpendInvoiceItemCostRow,
  SpendInvoiceRow,
  SpendOverviewData,
  SpendPurchaseHistoryItemCostRow,
  SpendPurchaseHistoryRow,
} from "@/domain/dashboard/dashboardTypes";
import { withLocationOrNull } from "@/domain/locations/locationQueryScope";
import {
  fetchPriceIncreaseNotifications,
  sumPriceIncreaseImpactFromNotifications,
} from "@/domain/dashboard/priceIncreaseFromNotifications";

export type SpendMetricsResult = {
  periodSpend: number;
  spendOverviewData: SpendOverviewData | null;
  deliveryIssuesCount: number;
  priceIncreaseImpact: number;
};

async function fetchSpendOverviewData(
  restaurantId: string,
  locationId: string | undefined,
  timeFilter: DashboardTimeFilter,
): Promise<SpendOverviewData> {
  const { startDate, endDate } = dashboardSpendRangeFromFilter(timeFilter);
  const rangeStart = new Date(startDate);
  const rangeEnd = new Date(endDate);

  const inSpendWindow = (row: { invoice_date?: string | null; created_at?: string | null }) => {
    const businessDate = resolvePurchaseHistoryBusinessDate(row);
    return businessDate >= rangeStart && businessDate <= rangeEnd;
  };

  const invoiceDocIds = await fetchInvoiceDocumentIdsForRestaurant(restaurantId);

  let invoiceQuery = supabase
    .from("invoices")
    .select("id, vendor_name, created_at, invoice_date")
    .eq("restaurant_id", restaurantId)
    .eq("status", "confirmed");
  if (locationId) invoiceQuery = withLocationOrNull(invoiceQuery, locationId);

  const { data: invoiceSpendRows } = (await invoiceQuery) as unknown as {
    data: SpendInvoiceRow[] | null;
  };
  const invoicesInPeriod = (invoiceSpendRows ?? []).filter(inSpendWindow);
  const invoiceIdsInPeriod = invoicesInPeriod.map((row) => row.id);

  const costByDocumentId: Record<string, number> = {};
  if (invoiceIdsInPeriod.length > 0) {
    const { data: invoiceLineCosts } = (await supabase
      .from("invoice_items")
      .select("invoice_id, total_cost")
      .in("invoice_id", invoiceIdsInPeriod)) as unknown as { data: SpendInvoiceItemCostRow[] | null };
    (invoiceLineCosts ?? []).forEach((row) => {
      costByDocumentId[row.invoice_id] = (costByDocumentId[row.invoice_id] || 0) + Number(row.total_cost || 0);
    });
  }

  let purchaseHistoryQuery = supabase
    .from("purchase_history")
    .select("id, vendor_name, created_at, invoice_date")
    .eq("restaurant_id", restaurantId)
    .in("invoice_status", ["COMPLETE", "POSTED"]);
  if (locationId) purchaseHistoryQuery = withLocationOrNull(purchaseHistoryQuery, locationId);

  const { data: purchaseHistoryRows } = (await purchaseHistoryQuery) as unknown as {
    data: SpendPurchaseHistoryRow[] | null;
  };
  const filteredPurchaseHistory = (purchaseHistoryRows ?? [])
    .filter((row) => !invoiceDocIds.has(row.id))
    .filter(inSpendWindow);

  if (filteredPurchaseHistory.length > 0) {
    const purchaseHistoryIds = filteredPurchaseHistory.map((row) => row.id);
    const { data: purchaseHistoryItemCosts } = (await supabase
      .from("purchase_history_items")
      .select("purchase_history_id, total_cost")
      .in("purchase_history_id", purchaseHistoryIds)) as unknown as {
      data: SpendPurchaseHistoryItemCostRow[] | null;
    };
    (purchaseHistoryItemCosts ?? []).forEach((row) => {
      costByDocumentId[row.purchase_history_id] =
        (costByDocumentId[row.purchase_history_id] || 0) + Number(row.total_cost || 0);
    });
  }

  if (!invoicesInPeriod.length && !filteredPurchaseHistory.length) {
    return { periodSpend: 0, vendors: [] };
  }

  let periodSpend = 0;
  const vendorMap: Record<string, number> = {};

  invoicesInPeriod.forEach((row) => {
    const cost = costByDocumentId[row.id] || 0;
    periodSpend += cost;
    const vendorName = row.vendor_name || "Unknown";
    vendorMap[vendorName] = (vendorMap[vendorName] || 0) + cost;
  });

  filteredPurchaseHistory.forEach((row) => {
    const cost = costByDocumentId[row.id] || 0;
    periodSpend += cost;
    const vendorName = row.vendor_name || "Unknown";
    vendorMap[vendorName] = (vendorMap[vendorName] || 0) + cost;
  });

  const vendors = Object.entries(vendorMap)
    .map(([name, total]) => ({ name, total }))
    .sort((a, b) => b.total - a.total)
    .slice(0, 5);

  return { periodSpend, vendors };
}

export async function loadSpendMetrics(
  restaurantId: string,
  locationId: string | undefined,
  timeFilter: DashboardTimeFilter,
): Promise<SpendMetricsResult> {
  const { startDate, endDate } = dashboardSpendRangeFromFilter(timeFilter);
  const rangeStart = new Date(startDate);
  const rangeEnd = new Date(endDate);

  let invoiceStatusQuery = supabase
    .from("invoices")
    .select("id, invoice_total, invoice_date, status, receipt_status")
    .eq("restaurant_id", restaurantId);
  if (locationId) invoiceStatusQuery = withLocationOrNull(invoiceStatusQuery, locationId);

  const [spendOverview, invoiceStatusResult] = await Promise.all([
    fetchSpendOverviewData(restaurantId, locationId, timeFilter),
    invoiceStatusQuery as unknown as Promise<{ data: DashboardInvoiceStatusRow[] | null }>,
  ]);

  const invoiceStatusRows = invoiceStatusResult.data ?? [];
  const invoicePeriodSummary = sumPeriodInvoiceSpend(invoiceStatusRows, rangeStart, rangeEnd);
  const periodInvoiceIds = invoiceStatusRows
    .filter((row) => invoiceBusinessDateInRange(row.invoice_date, rangeStart, rangeEnd))
    .map((row) => row.id);

  let priceImpact = 0;
  if (periodInvoiceIds.length > 0) {
    const { data: comparisons } = (await supabase
      .from("invoice_line_comparisons")
      .select("invoice_id, status, received_qty, po_qty, invoiced_unit_cost, po_unit_cost, invoiced_qty")
      .in("invoice_id", periodInvoiceIds)) as unknown as { data: InvoiceLineComparisonRow[] | null };

    for (const comparison of comparisons ?? []) {
      if (!comparison.invoice_id) continue;
      if (isInvoiceLineComparisonProblem(comparison)) {
        invoicePeriodSummary.issueInvoiceIds.add(comparison.invoice_id);
      }
      priceImpact += linePriceIncreaseImpact(comparison);
    }
  }

  try {
    const priceNotifs = await fetchPriceIncreaseNotifications(
      supabase,
      restaurantId,
      locationId,
      startDate,
      endDate,
    );
    priceImpact += sumPriceIncreaseImpactFromNotifications(priceNotifs);
  } catch {
    // swallow — comparison-based impact still returned
  }

  return {
    // spendOverview sums invoice_items.total_cost (line-item ground truth) — single source of truth
    periodSpend: spendOverview.periodSpend,
    spendOverviewData: spendOverview.periodSpend > 0 ? spendOverview : null,
    deliveryIssuesCount: invoicePeriodSummary.issueInvoiceIds.size,
    priceIncreaseImpact: priceImpact,
  };
}
