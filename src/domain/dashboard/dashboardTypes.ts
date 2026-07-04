import type { ReorderSummary } from "@/domain/inventory/reorderEngine";
import type { InventorySessionItemRow } from "@/domain/inventory/enterInventoryTypes";
import type { Database } from "@/integrations/supabase/types";

export type { InventorySessionItemRow };

export type DashboardTimeFilter = "this_week" | "last_week" | "30_days";

export type InventorySessionRow = Pick<
  Database["public"]["Tables"]["inventory_sessions"]["Row"],
  "id" | "approved_at" | "name"
>;

export type InventoryTrendSessionRow = Pick<
  Database["public"]["Tables"]["inventory_sessions"]["Row"],
  "id" | "approved_at"
>;

export type TopReorderItem = InventorySessionItemRow & {
  suggestedOrder: number;
  ratio: number;
};

/** Priced session lines ranked by stock dollar value — shared by Dashboard loader and Reports. */
export type TopSessionItemByValue = {
  item_name: string;
  total_value: number;
  current_stock: number;
  unit: string;
};

export type SmartOrderSettingsRow = Pick<
  Database["public"]["Tables"]["smart_order_settings"]["Row"],
  "red_threshold" | "yellow_threshold"
>;

export type WasteLogSnapshotRow = Pick<
  Database["public"]["Tables"]["waste_log"]["Row"],
  "item_name" | "quantity" | "reason" | "logged_at"
>;

/**
 * Period rollup rows for `loadWasteMetrics` — select must include cost/FK columns so
 * {@link dollarsForWasteRow} / {@link aggregateWasteRows} match persisted data.
 * (Codegen may lag migrations; treat cost fields as optional only for type compatibility.)
 */
export type WasteLogPeriodRow = Pick<
  Database["public"]["Tables"]["waste_log"]["Row"],
  "quantity" | "quantity_unit" | "logged_at" | "item_name"
> & {
  catalog_item_id?: string | null;
  unit_cost?: number | null;
  total_cost?: number | null;
};

export type InventoryCatalogDefaultCostRow = Pick<
  Database["public"]["Tables"]["inventory_catalog_items"]["Row"],
  "id" | "default_unit_cost"
>;

export type SpendInvoiceRow = Pick<
  Database["public"]["Tables"]["invoices"]["Row"],
  "id" | "vendor_name" | "created_at" | "invoice_date"
>;

export type SpendInvoiceItemCostRow = Pick<
  Database["public"]["Tables"]["invoice_items"]["Row"],
  "invoice_id" | "total_cost"
>;

export type SpendPurchaseHistoryRow = Pick<
  Database["public"]["Tables"]["purchase_history"]["Row"],
  "id" | "vendor_name" | "created_at" | "invoice_date"
>;

export type SpendPurchaseHistoryItemCostRow = Pick<
  Database["public"]["Tables"]["purchase_history_items"]["Row"],
  "purchase_history_id" | "total_cost"
>;

export type SpendOverviewData = {
  periodSpend: number;
  vendors: { name: string; total: number }[];
};

export type DashboardInvoiceStatusRow = Pick<
  Database["public"]["Tables"]["invoices"]["Row"],
  "id" | "invoice_total" | "invoice_date" | "status" | "receipt_status"
>;

export type InvoiceLineComparisonRow = Pick<
  Database["public"]["Tables"]["invoice_line_comparisons"]["Row"],
  | "invoice_id"
  | "status"
  | "received_qty"
  | "po_qty"
  | "invoiced_unit_cost"
  | "po_unit_cost"
  | "invoiced_qty"
>;

export type DashboardTrendPoint = {
  label: string;
  value: number;
};

export type DashboardStockStatus = {
  red: number;
  yellow: number;
  green: number;
};

export type ProfitIntelligenceAction = {
  type: "CRITICAL" | "WARNING" | "INFO";
  message: string;
};

export type ProfitLeakReason = "Waste" | "Price Hike" | "Overstock" | "Shrinkage";

export type ProfitLeakBreakdownRow = {
  label: string;
  value: number;
  date: string;
  source: string;
};

export type ProfitLeakItem = {
  item_name: string;
  total: number;
  reason: ProfitLeakReason;
  breakdown: ProfitLeakBreakdownRow[];
};

export type OverstockItem = {
  item_name: string;
  current_stock: number;
  par_level: number;
  unit_cost: number;
  units_over: number;
  dollars: number;
};

export type PortfolioLocationBreakdown = {
  /** Real location UUID, or `__unassigned__` for latest approved count with `location_id` IS NULL. */
  locationId: string;
  locationName: string;
  red: number;
  yellow: number;
  green: number;
  overstockValue: number;
  lastApproved: string | null;
};

export type PortfolioRestaurantRow = {
  id: string;
  name: string;
  role: string;
  red: number;
  yellow: number;
  green: number;
  overstockValue: number;
  spendMonth: number;
  locations: PortfolioLocationBreakdown[];
  recentOrders: number;
  unreadAlerts: number;
  lastApproved: string | null;
};

export type PortfolioDashboardTotals = {
  red: number;
  yellow: number;
  green: number;
  overstockValue?: number;
  wasteExposure?: number;
  spendMonth?: number;
};

export type PortfolioDashboardResponse = {
  restaurants: PortfolioRestaurantRow[];
  totals: PortfolioDashboardTotals;
};

export type LatestInventorySnapshot = {
  latestSessionUnitCostByCatalogId: Record<string, number>;
  reorderSummary: ReorderSummary | null;
  stockStatus: DashboardStockStatus;
  topReorder: TopReorderItem[];
  inventoryValue: number;
  missingCostCount: number;
  overstockValue: number;
  missingParCount: number;
};

/**
 * Per-loader failure flags (silent-$0 trust fix). A `true` means that loader's
 * query FAILED and its KPI(s) must render "couldn't calculate", not a $0. Absent
 * / false means the value is trustworthy (a genuine 0 is still trustworthy).
 */
export type DashboardKpiErrors = {
  inventory?: boolean;
  spend?: boolean;
  invoice?: boolean;
  overstock?: boolean;
  profitLeaks?: boolean;
  waste?: boolean;
  shrinkage?: boolean;
  foodCost?: boolean;
};

export type KPISnapshot = {
  stockStatus: DashboardStockStatus;
  topReorder: TopReorderItem[];
  reorderSummary: ReorderSummary | null;
  highUsage: import("@/lib/usage-analytics").ComputedUsageItem[];
  recommendations: import("@/lib/usage-analytics").PARRecommendation[];
  inventoryValue: number;
  missingCostCount: number;
  trendData: DashboardTrendPoint[];
  pendingInvoices: number;
  overstockValue: number;
  lastSessionDate: Date | null;
  lastSessionName: string | null;
  todayWasteEntries: WasteLogSnapshotRow[];
  spendOverviewData: SpendOverviewData | null;
  missingParCount: number;
  periodSpend: number;
  deliveryIssuesCount: number;
  priceIncreaseImpact: number;
  recordedWasteValue: number;
  recordedWasteCount: number;
  wasteItemsMissingCost: number;
  shrinkageValue: number;
  /** Per-loader failure flags — see {@link DashboardKpiErrors}. */
  errors: DashboardKpiErrors;
  topProfitLeaks: ProfitLeakItem[];
  overstockItems: OverstockItem[];
  foodCostPct: number | null;
  weeklyGrossSales: number | null;
  foodCostTargetPct: number;
  foodCostStatus: "under" | "at" | "over" | null;
};

export type SingleDashboardData = KPISnapshot & {
  loading: boolean;
  error: Error | null;
  refetch: () => void;
};
