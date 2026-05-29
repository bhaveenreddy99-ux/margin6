import type { FoodCostMetrics } from "@/domain/dashboard/loadFoodCostMetrics";
import type { KPISnapshot, OverstockItem, ProfitLeakItem } from "@/domain/dashboard/dashboardTypes";
import type { InventoryMetricsResult } from "@/domain/dashboard/loadInventoryMetrics";
import type { InvoiceMetricsResult } from "@/domain/dashboard/loadInvoiceMetrics";
import type { SpendMetricsResult } from "@/domain/dashboard/loadSpendMetrics";
import type { WasteMetricsResult } from "@/domain/dashboard/loadWasteMetrics";

export function buildDashboardSnapshot(
  inventory: InventoryMetricsResult,
  invoices: InvoiceMetricsResult,
  spend: SpendMetricsResult,
  waste: WasteMetricsResult,
  shrinkageValue: number = 0,
  topProfitLeaks: ProfitLeakItem[] = [],
  overstockItems: OverstockItem[] = [],
  foodCost: FoodCostMetrics = {
    foodCostPct: null,
    weeklyGrossSales: null,
    targetPct: 30,
    status: null,
  },
): KPISnapshot {
  return {
    stockStatus: inventory.stockStatus,
    topReorder: inventory.topReorder,
    reorderSummary: inventory.reorderSummary,
    highUsage: inventory.highUsage,
    recommendations: inventory.recommendations,
    inventoryValue: inventory.inventoryValue,
    missingCostCount: inventory.missingCostCount,
    trendData: inventory.trendData,
    overstockValue: inventory.overstockValue,
    lastSessionDate: inventory.lastSessionDate,
    lastSessionName: inventory.lastSessionName,
    missingParCount: inventory.missingParCount,
    pendingInvoices: invoices.pendingInvoices,
    periodSpend: spend.periodSpend,
    spendOverviewData: spend.spendOverviewData,
    deliveryIssuesCount: spend.deliveryIssuesCount,
    priceIncreaseImpact: spend.priceIncreaseImpact,
    todayWasteEntries: waste.todayWasteEntries,
    recordedWasteValue: waste.recordedWasteValue,
    recordedWasteCount: waste.recordedWasteCount,
    wasteItemsMissingCost: waste.wasteItemsMissingCost,
    shrinkageValue,
    topProfitLeaks,
    overstockItems,
    foodCostPct: foodCost.foodCostPct,
    weeklyGrossSales: foodCost.weeklyGrossSales,
    foodCostTargetPct: foodCost.targetPct,
    foodCostStatus: foodCost.status,
  };
}
