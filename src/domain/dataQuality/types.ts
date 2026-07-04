export type DataQualityBand = "excellent" | "good" | "medium" | "low";

export type DataQualityIssue = {
  code: string;
  message: string;
  deduction: number;
};

export type DataQualityResult = {
  score: number;
  band: DataQualityBand;
  issues: DataQualityIssue[];
};

export type ConfidenceLevel = "high" | "medium" | "low";

export type KpiConfidence = {
  level: ConfidenceLevel;
  reasons: string[];
};

export type DataQualityInput = {
  daysSinceLastCount: number | null;
  missingParCount: number;
  missingCostCount: number;
  periodSpend: number;
  weeklyGrossSales: number | null;
  pendingInvoices: number;
  deliveryIssuesCount: number;
  shrinkageValue: number;
  hasApprovedSession: boolean;
};

export type KpiConfidenceInput = DataQualityInput & {
  overstockValue: number;
  inventoryValue: number;
  recordedWasteValue: number;
  priceIncreaseImpact: number;
  wasteItemsMissingCost: number;
  reorderSummary: {
    totalReorderValue: number;
    missingCostCount: number;
    noParCount: number;
    redCount: number;
    yellowCount: number;
    greenCount: number;
  } | null;
  foodCostPct: number | null;
};
