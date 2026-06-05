import type { InventoryItemInput } from "@/domain/inventory/reorderEngine";
import type { InventorySessionItemRow } from "@/domain/dashboard/dashboardTypes";

/** Fixed catalog lines for dashboard trust tests — do not mutate. */
export type DashboardTrustSeedItem = {
  item_name: string;
  current_stock: number;
  par_level: number;
  unit_cost: number | null;
};

export const DASHBOARD_TRUST_SEED_ITEMS: readonly DashboardTrustSeedItem[] = [
  { item_name: "Tomatoes", current_stock: 8, par_level: 5, unit_cost: 12 },
  { item_name: "Chicken Breast", current_stock: 1, par_level: 10, unit_cost: 25 },
  { item_name: "Fryer Oil", current_stock: 4, par_level: 5, unit_cost: 18 },
  { item_name: "Container Plastic", current_stock: 12, par_level: 5, unit_cost: 14.7 },
  { item_name: "Uncosted Item", current_stock: 5, par_level: 5, unit_cost: null },
] as const;

export const DASHBOARD_TRUST_WASTE = {
  quantity: 2,
  unit_cost: 15,
  total_cost: null as number | null,
} as const;

export const DASHBOARD_TRUST_PRICE_HIKE = {
  item_name: "Container Plastic",
  old_cost: 10,
  new_cost: 11.47,
  pct_change: 14.7,
} as const;

export const DASHBOARD_TRUST_MISSING_DELIVERY = {
  po_qty: 10,
  invoiced_qty: 10,
  received_qty: 7,
  invoiced_unit_cost: 20,
  /** missing_qty = invoiced − received */
  missing_qty: 3,
} as const;

export const DASHBOARD_TRUST_SPEND = {
  periodSpend: 3000,
  weeklyGrossSales: null as number | null,
  weeklyGrossSalesEntered: 10000,
  priceIncreaseImpact: 1.47,
  shrinkageValue: 5,
} as const;

/** Pinned expected values derived from seed — single source for test names & assertions. */
export const DASHBOARD_TRUST_EXPECTED = {
  overstockTomatoes: 36,
  overstockContainerPlastic: 102.9,
  totalOverstock: 138.9,
  smartOrderChicken: 9,
  smartOrderOil: 1,
  totalInventoryValue: 369.4,
  reorderValueChicken: 225,
  reorderValueOil: 18,
  totalReorderValue: 243,
  criticalLowStockCount: 1,
  priceHikePct: 14.7,
  priceHikeImpact: 1.47,
  wasteValue: 30,
  missingDeliveryValue: 60,
  trustPotentialSavings: 230.37,
  moneyLostWidgetTotal: 175.37,
  savingsBannerTotal: 170.37,
  foodCostPctWithoutSales: null,
  foodCostPctWithSales: 30,
} as const;

export function seedToInventoryInputs(
  items: readonly DashboardTrustSeedItem[] = DASHBOARD_TRUST_SEED_ITEMS,
): InventoryItemInput[] {
  return items.map((item) => ({
    current_stock: item.current_stock,
    par_level: item.par_level,
    unit_cost: item.unit_cost,
  }));
}

export function seedToSessionItemRows(
  items: readonly DashboardTrustSeedItem[] = DASHBOARD_TRUST_SEED_ITEMS,
): InventorySessionItemRow[] {
  return items.map((item, index) => ({
    id: `trust-seed-${index}`,
    session_id: "trust-session",
    catalog_item_id: `catalog-${index}`,
    item_name: item.item_name,
    current_stock: item.current_stock,
    par_level: item.par_level,
    unit_cost: item.unit_cost,
    unit: "case",
    pack_size: null,
    category: null,
    vendor_sku: null,
    product_number: null,
    created_at: "2026-05-01T12:00:00.000Z",
    updated_at: "2026-05-01T12:00:00.000Z",
    location_id: null,
    restaurant_id: "trust-restaurant",
    display_order: index,
  })) as InventorySessionItemRow[];
}
