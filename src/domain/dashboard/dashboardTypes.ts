import type { ReorderSummary } from "@/domain/inventory/reorderEngine";
import type { Database } from "@/integrations/supabase/types";

export type DashboardTimeFilter = "this_week" | "last_week" | "30_days";

export type InventorySessionRow = Pick<
  Database["public"]["Tables"]["inventory_sessions"]["Row"],
  "id" | "approved_at" | "name"
>;

export type InventoryTrendSessionRow = Pick<
  Database["public"]["Tables"]["inventory_sessions"]["Row"],
  "id" | "approved_at"
>;

export type InventorySessionItemRow = Database["public"]["Tables"]["inventory_session_items"]["Row"];

export type TopReorderItem = InventorySessionItemRow & {
  suggestedOrder: number;
  ratio: number;
};

export type SmartOrderSettingsRow = Pick<
  Database["public"]["Tables"]["smart_order_settings"]["Row"],
  "red_threshold" | "yellow_threshold"
>;

export type WasteLogSnapshotRow = Pick<
  Database["public"]["Tables"]["waste_log"]["Row"],
  "item_name" | "quantity" | "reason" | "logged_at"
>;

export type WasteLogPeriodRow = Pick<
  Database["public"]["Tables"]["waste_log"]["Row"],
  "quantity" | "total_cost" | "unit_cost" | "catalog_item_id" | "logged_at"
>;

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

export type PortfolioLocationBreakdown = {
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

export type SingleDashboardData = {
  stockStatus: DashboardStockStatus;
  topReorder: TopReorderItem[];
  reorderSummary: ReorderSummary | null;
  highUsage: import("@/lib/usage-analytics").ComputedUsageItem[];
  recommendations: import("@/lib/usage-analytics").PARRecommendation[];
  loading: boolean;
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
};
