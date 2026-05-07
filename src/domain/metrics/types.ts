import type { DashboardTimeFilter } from "@/domain/dashboard/dashboardTypes";

export type LocationFilter =
  | { mode: "single"; locationId: string }
  | { mode: "all" }
  | { mode: "compare"; locationIds: string[] };

export type KPISnapshot = {
  // Inventory health
  inventoryValue: number;
  stockStatus: { red: number; yellow: number; green: number };
  overstockValue: number;
  missingCostCount: number;
  missingParCount: number;

  // Spend
  periodSpend: number;
  vendorBreakdown: { name: string; total: number }[];

  // Deliveries
  deliveryIssuesCount: number;
  priceIncreaseImpact: number;
  pendingInvoices: number;

  // Waste
  recordedWasteValue: number;
  recordedWasteCount: number;
  wasteItemsMissingCost: number;

  // Context
  timeFilter: DashboardTimeFilter;
  locationFilter: LocationFilter;
  lastSessionDate: Date | null;
  lastSessionName: string | null;
};

export type KPIDefinition<TInput, TOutput> = {
  id: string;
  label: string;
  compute: (input: TInput) => TOutput;
};
