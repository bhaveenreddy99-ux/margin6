import { endOfWeek, startOfDay, startOfWeek, subDays, subWeeks, format } from "date-fns";
import { computeInventoryItem, computeReorderSummary, type InventoryItemInput } from "@/domain/inventory/reorderEngine";
import type { ReorderSummary } from "@/domain/inventory/reorderEngine";
import type { RiskThresholds } from "@/lib/inventory-utils";
import { computeLineInventoryValue, computeLineOverstockValue } from "@/domain/inventory/casePlanningEngine";
import { catalogIdFromSessionItem } from "@/domain/inventory/sessionItemCatalogLink";
import { catalogItemIdsWithDuplicateParentRows } from "@/domain/inventory/zoneReconcile";
import { STOCK_TRUTH_MESSAGE } from "@/lib/stockTruthCopy";
import type {
  DashboardInvoiceStatusRow,
  DashboardStockStatus,
  DashboardTimeFilter,
  DashboardTrendPoint,
  InventorySessionItemRow,
  InventoryTrendSessionRow,
  InvoiceLineComparisonRow,
  LatestInventorySnapshot,
  PortfolioRestaurantRow,
  ProfitIntelligenceAction,
  TopReorderItem,
  TopSessionItemByValue,
  WasteLogSnapshotRow,
} from "@/domain/dashboard/dashboardTypes";

export function dashboardSpendRangeFromFilter(
  filter: DashboardTimeFilter,
  now = new Date(),
): { startDate: string; endDate: string } {
  const endNow = () => now.toISOString();
  switch (filter) {
    case "this_week": {
      const start = startOfWeek(now, { weekStartsOn: 1 });
      return { startDate: start.toISOString(), endDate: endNow() };
    }
    case "last_week": {
      const reference = subWeeks(now, 1);
      const start = startOfWeek(reference, { weekStartsOn: 1 });
      const weekEnd = endOfWeek(reference, { weekStartsOn: 1 });
      return { startDate: start.toISOString(), endDate: weekEnd.toISOString() };
    }
    case "30_days": {
      const start = startOfDay(subDays(now, 29));
      return { startDate: start.toISOString(), endDate: endNow() };
    }
  }
}

export function dashboardSpendPeriodLabel(filter: DashboardTimeFilter): string {
  switch (filter) {
    case "this_week":
      return "Spend This Week";
    case "last_week":
      return "Spend Last Week";
    case "30_days":
      return "Spend Last 30 Days";
  }
}

export function spendPeriodSubtitle(filter: DashboardTimeFilter): string {
  switch (filter) {
    case "this_week":
      return "Posted invoices from Monday through today";
    case "last_week":
      return "Posted invoices from last calendar week";
    case "30_days":
      return "Posted invoices from the last 30 days";
  }
}

export function spendPeriodPlainName(filter: DashboardTimeFilter): string {
  switch (filter) {
    case "this_week":
      return "This week (Monday through today)";
    case "last_week":
      return "Last calendar week";
    case "30_days":
      return "The last 30 days";
  }
}

export function isMissingParLevel(parLevel: unknown): boolean {
  if (parLevel === null || parLevel === undefined) return true;
  const numeric = Number(parLevel);
  return !Number.isFinite(numeric) || numeric <= 0;
}

export function isPostedInvoiceDocumentStatus(status: string | null | undefined): boolean {
  return status === "confirmed" || status === "COMPLETE" || status === "posted";
}

export function invoiceBusinessDateInRange(
  invoiceDate: string | null | undefined,
  rangeStart: Date,
  rangeEnd: Date,
): boolean {
  if (!invoiceDate) return false;
  const date = new Date(invoiceDate);
  if (!Number.isFinite(date.getTime())) return false;
  return date >= rangeStart && date <= rangeEnd;
}

const PROBLEM_COMPARISON_STATUSES = new Set([
  "missing_from_invoice",
  "extra_on_invoice",
  "received_short",
  "qty_mismatch",
  "price_mismatch",
  "total_mismatch",
  "unmatched",
]);

export function isInvoiceLineComparisonProblem(row: InvoiceLineComparisonRow): boolean {
  const status = row.status ?? "";
  if (PROBLEM_COMPARISON_STATUSES.has(status)) return true;
  const receivedQuantity = Number(row.received_qty);
  const purchaseOrderQuantity = Number(row.po_qty);
  if (
    Number.isFinite(receivedQuantity) &&
    Number.isFinite(purchaseOrderQuantity) &&
    receivedQuantity < purchaseOrderQuantity
  ) {
    return true;
  }
  return false;
}

export function linePriceIncreaseImpact(row: InvoiceLineComparisonRow): number {
  if (row.invoiced_unit_cost == null || row.po_unit_cost == null) return 0;
  const invoicedUnitCost = Number(row.invoiced_unit_cost);
  const purchaseOrderUnitCost = Number(row.po_unit_cost);
  if (
    !Number.isFinite(invoicedUnitCost) ||
    !Number.isFinite(purchaseOrderUnitCost) ||
    invoicedUnitCost <= purchaseOrderUnitCost
  ) {
    return 0;
  }
  const invoicedQuantity = Number(row.invoiced_qty);
  const purchaseOrderQuantity = Number(row.po_qty);
  const quantity = Math.min(
    Number.isFinite(invoicedQuantity) ? invoicedQuantity : 0,
    Number.isFinite(purchaseOrderQuantity) ? purchaseOrderQuantity : 0,
  );
  if (!Number.isFinite(quantity) || quantity <= 0) return 0;
  return (invoicedUnitCost - purchaseOrderUnitCost) * quantity;
}

export function formatInventoryQty(value: number): string {
  if (!Number.isFinite(value)) return "—";
  const rounded = Math.round(value);
  if (Math.abs(value - rounded) < 1e-6) return rounded.toLocaleString();
  return value.toLocaleString(undefined, { maximumFractionDigits: 1 });
}

/**
 * Deduplicates inventory_session_items by catalog_item_id.
 * When the same catalog item appears on multiple rows (zone counting),
 * merges their current_stock by summing. All other fields taken from
 * the first occurrence (par_level, unit_cost, unit, pack_size are
 * catalog-level and should be identical across duplicate rows).
 * Items with no catalog_item_id are always kept as-is.
 */
function deduplicateSessionItems(
  items: InventorySessionItemRow[],
): InventorySessionItemRow[] {
  const dupIds = new Set(catalogItemIdsWithDuplicateParentRows(items));
  if (dupIds.size === 0) return items; // fast path — no duplicates

  const merged = new Map<string, InventorySessionItemRow>();
  const standalone: InventorySessionItemRow[] = [];

  for (const item of items) {
    const cid = catalogIdFromSessionItem(item);
    if (!cid || !dupIds.has(cid)) {
      standalone.push(item);
      continue;
    }
    const existing = merged.get(cid);
    if (!existing) {
      // First occurrence — clone and store
      merged.set(cid, { ...item });
    } else {
      // Subsequent occurrence — sum the stock only
      const prevStock = Number(existing.current_stock) || 0;
      const addStock = Number(item.current_stock) || 0;
      existing.current_stock = prevStock + addStock;
    }
  }

  return [...standalone, ...merged.values()];
}

export function buildLatestInventorySnapshot(
  rawItems: InventorySessionItemRow[],
  riskThresholds?: RiskThresholds,
): LatestInventorySnapshot {
  // Deduplicate zone-split rows before any calculation so dashboard
  // totals match Smart Order engine which reads one row per catalog item.
  const items = deduplicateSessionItems(rawItems);
  const latestSessionUnitCostByCatalogId: Record<string, number> = {};
  for (const item of items) {
    const cid = catalogIdFromSessionItem(item);
    if (!cid) continue;
    const unitCost = Number(item.unit_cost);
    if (!Number.isFinite(unitCost) || unitCost < 0) continue;
    if (latestSessionUnitCostByCatalogId[cid] !== undefined) continue;
    latestSessionUnitCostByCatalogId[cid] = unitCost;
  }

  const inputs: InventoryItemInput[] = items.map((item) => ({
    current_stock: item.current_stock,
    par_level: item.par_level,
    unit_cost: item.unit_cost,
    unit: item.unit,
    pack_size: item.pack_size,
  }));
  const computedItems = inputs.map((input) => computeInventoryItem(input, riskThresholds));
  const reorderSummary = computeReorderSummary(inputs, riskThresholds);
  const stockStatus: DashboardStockStatus = {
    red: reorderSummary.redCount,
    yellow: reorderSummary.yellowCount,
    green: reorderSummary.greenCount,
  };
  const topReorder = items
    .map(
      (item, index): TopReorderItem => ({
        ...item,
        suggestedOrder: computedItems[index].suggestedOrder,
        ratio: computedItems[index].ratio,
      }),
    )
    .sort((a, b) => b.suggestedOrder - a.suggestedOrder)
    .slice(0, 8);

  const inventoryValue = items.reduce(
    (sum, item) =>
      sum +
      computeLineInventoryValue({
        currentStockCases: item.current_stock,
        parLevelCases: item.par_level,
        unitCostPerCase: item.unit_cost,
      }).dollars,
    0,
  );
  const missingCostCount = items.filter((item) => item.unit_cost == null).length;
  const missingParCount = items.filter((item) => isMissingParLevel(item.par_level)).length;

  return {
    latestSessionUnitCostByCatalogId,
    reorderSummary,
    stockStatus,
    topReorder,
    inventoryValue,
    missingCostCount,
    overstockValue: reorderSummary.totalWasteValue,
    missingParCount,
  };
}

/**
 * Per-line overstock rows from the latest session — same engine as dashboard hero
 * (`buildLatestInventorySnapshot` / `reorderSummary.totalWasteValue`), including zone dedupe.
 */
export function buildSessionOverstockLines(
  rawItems: InventorySessionItemRow[],
): import("@/domain/dashboard/dashboardTypes").OverstockItem[] {
  const items = deduplicateSessionItems(rawItems);
  const result: import("@/domain/dashboard/dashboardTypes").OverstockItem[] = [];

  for (const item of items) {
    const name = (item.item_name ?? "").trim();
    if (!name) continue;

    const stock = Number(item.current_stock ?? 0);
    const par = Number(item.par_level ?? 0);
    const cost = item.unit_cost == null ? null : Number(item.unit_cost);

    const line = computeLineOverstockValue({
      currentStockCases: stock,
      parLevelCases: par,
      unitCostPerCase: cost,
    });
    if (line.dollars <= 0) continue;

    const unitsOver = Math.max(0, stock - par);
    result.push({
      item_name: name,
      current_stock: stock,
      par_level: par,
      unit_cost: cost ?? 0,
      units_over: unitsOver,
      dollars: line.dollars,
    });
  }

  return result.sort((a, b) => b.dollars - a.dollars);
}

/** Human-readable stock band labels for Reports / dashboard copy. */
export function formatStockRiskBandCopy(thresholds: RiskThresholds): {
  critical: string;
  low: string;
  ok: string;
} {
  const red = thresholds.redThresholdPercent;
  const yellow = thresholds.yellowThresholdPercent;
  return {
    critical: `Below ${red}% of PAR level`,
    low: `Between ${red}–${yellow}% of PAR`,
    ok: `At or above ${yellow}% of PAR`,
  };
}

/**
 * Same per-line dollar formula as {@link buildLatestInventorySnapshot} inventory total,
 * limited to rows with truthy `unit_cost` (matches legacy Reports “top items” filter).
 */
export function buildTopSessionItemsByValue(
  rawItems: InventorySessionItemRow[],
  limit = 8,
): TopSessionItemByValue[] {
  const items = deduplicateSessionItems(rawItems);
  return items
    .filter((i) => Boolean(i.unit_cost))
    .map((i) => ({
      item_name: i.item_name,
      total_value: computeLineInventoryValue({
        currentStockCases: i.current_stock,
        parLevelCases: i.par_level,
        unitCostPerCase: i.unit_cost,
      }).dollars,
      current_stock: Number(i.current_stock),
      unit: i.unit ?? "",
    }))
    .sort((a, b) => b.total_value - a.total_value)
    .slice(0, limit);
}

export function buildInventoryTrendData(
  trendSessions: InventoryTrendSessionRow[],
  trendLinesBySessionId: Map<string, { current_stock: number | null; unit_cost: number | null }[]>,
): DashboardTrendPoint[] {
  return trendSessions
    .map((session) => {
      const items = trendLinesBySessionId.get(session.id) ?? [];
      const value = items.reduce(
        (sum, item) =>
          sum +
          computeLineInventoryValue({
            currentStockCases: item.current_stock,
            parLevelCases: null,
            unitCostPerCase: item.unit_cost,
          }).dollars,
        0,
      );
      return {
        label: session.approved_at ? format(new Date(session.approved_at), "MMM d") : "?",
        value,
      };
    })
    .reverse();
}

export function buildProfitIntelligenceActions(args: {
  reorderSummary: ReorderSummary | null;
  deliveryIssuesCount: number;
  priceIncreaseImpact: number;
  missingParCount: number;
}): ProfitIntelligenceAction[] {
  const red = args.reorderSummary?.redCount ?? 0;
  const totalWaste = args.reorderSummary?.totalWasteValue ?? 0;
  const reorderValue = args.reorderSummary?.totalReorderValue ?? 0;

  const actions: ProfitIntelligenceAction[] = [];

  if (red > 0) {
    actions.push({
      type: "CRITICAL",
      message: `${red} item${red !== 1 ? "s" : ""} may stock out before your next order`,
    });
  }
  if (args.deliveryIssuesCount > 0) {
    actions.push({
      type: "CRITICAL",
      message: `${args.deliveryIssuesCount} delivery problem${args.deliveryIssuesCount !== 1 ? "s" : ""} caught — review invoices`,
    });
  }
  if (totalWaste > 0) {
    actions.push({
      type: "WARNING",
      message: `You have $${totalWaste.toLocaleString(undefined, { maximumFractionDigits: 0 })} in overstock at risk`,
    });
  }
  if (args.priceIncreaseImpact > 0) {
    actions.push({
      type: "WARNING",
      message: `Margin6 flagged $${args.priceIncreaseImpact.toLocaleString(undefined, { maximumFractionDigits: 0 })} in supplier price increases`,
    });
  }
  if (args.missingParCount > 0) {
    actions.push({
      type: "WARNING",
      message:
        args.missingParCount === 1
          ? "1 item is missing PAR levels"
          : `${args.missingParCount} items are missing PAR levels`,
    });
  }
  if (reorderValue > 0) {
    actions.push({
      type: "INFO",
      message: `You should reorder about $${reorderValue.toLocaleString(undefined, { maximumFractionDigits: 0 })} today`,
    });
  }

  const rank = { CRITICAL: 0, WARNING: 1, INFO: 2 } as const;
  return actions.sort((a, b) => rank[a.type] - rank[b.type]).slice(0, 6);
}

export function summarizeWasteSnapshot(entries: WasteLogSnapshotRow[]) {
  return {
    totalQty: entries.reduce((sum, entry) => sum + Number(entry.quantity), 0),
    recentEntries: entries.slice(0, 3),
  };
}

export function sortPortfolioRestaurants(restaurants: PortfolioRestaurantRow[]) {
  return [...restaurants].sort((a, b) => b.red - a.red);
}

export function buildPortfolioSummary(totals: DashboardStockStatus & { overstockValue?: number; wasteExposure?: number }) {
  const totalItems = totals.red + totals.yellow + totals.green;
  const portfolioOverstockValue = totals.overstockValue ?? totals.wasteExposure ?? 0;
  return { totalItems, portfolioOverstockValue };
}

export function buildDashboardDisplayState(args: {
  reorderSummary: ReorderSummary | null;
  daysSinceLastCount: number | null;
  lastSessionDate: Date | null;
  lastSessionName: string | null;
  missingCostCount: number;
}) {
  const reorderValue = args.reorderSummary?.totalReorderValue ?? 0;
  const criticalLowCount = args.reorderSummary?.redCount ?? 0;
  const unitsToReorder = args.reorderSummary?.totalSuggestedUnits ?? 0;
  const inventoryValueLabel =
    args.missingCostCount > 0
      ? `${args.missingCostCount} item${args.missingCostCount !== 1 ? "s" : ""} missing costs`
      : STOCK_TRUTH_MESSAGE;
  const lastCountAccent: "success" | "warning" | "destructive" =
    args.daysSinceLastCount === null
      ? "destructive"
      : args.daysSinceLastCount <= 2
        ? "success"
        : args.daysSinceLastCount <= 5
          ? "warning"
          : "destructive";
  const lastCountLabel =
    args.daysSinceLastCount === null
      ? "Never"
      : args.daysSinceLastCount === 0
        ? "Today"
        : `${args.daysSinceLastCount}d ago`;
  const lastCountDescription = args.lastSessionDate
    ? [args.lastSessionName?.trim(), format(args.lastSessionDate, "MMM d, yyyy")]
        .filter(Boolean)
        .join(" · ") || "Approved session"
    : "No counts yet";

  return {
    reorderValue,
    criticalLowCount,
    unitsToReorder,
    inventoryValueLabel,
    lastCountAccent,
    lastCountLabel,
    lastCountDescription,
  };
}

export function countPendingInvoices(
  invoicePendingCount: number,
  purchaseHistoryRows: { id: string }[],
  invoiceDocIds: Set<string>,
) {
  const purchaseHistoryPending = purchaseHistoryRows.filter((row) => !invoiceDocIds.has(row.id)).length;
  return invoicePendingCount + purchaseHistoryPending;
}

export function sumPeriodInvoiceSpend(rows: DashboardInvoiceStatusRow[], rangeStart: Date, rangeEnd: Date) {
  let periodSpend = 0;
  const issueInvoiceIds = new Set<string>();

  for (const row of rows) {
    if (!invoiceBusinessDateInRange(row.invoice_date, rangeStart, rangeEnd)) continue;
    if (isPostedInvoiceDocumentStatus(row.status)) {
      periodSpend += Number(row.invoice_total ?? 0);
    }
    if (row.receipt_status === "issues_reported") {
      issueInvoiceIds.add(row.id);
    }
  }

  return { periodSpend, issueInvoiceIds };
}
