import { format } from "date-fns";
import type { KPISnapshot } from "@/domain/dashboard/dashboardTypes";
import {
  computeFoodCostConfidence,
  computeInventoryValueConfidence,
  computeMoneyLostConfidence,
  computeOverstockConfidence,
  computeReorderConfidence,
} from "@/domain/dataQuality";
import type { DataQualityInput, KpiConfidenceInput } from "@/domain/dataQuality/types";
import type { KpiExplainPayload } from "./KpiExplainSheet";
import { computeMoneyLostTotal } from "@/domain/dashboard/dashboardTrustFormulas";

export function buildDataQualityInput(args: {
  snapshot: Pick<
    KPISnapshot,
    | "missingParCount"
    | "missingCostCount"
    | "periodSpend"
    | "weeklyGrossSales"
    | "pendingInvoices"
    | "deliveryIssuesCount"
    | "shrinkageValue"
    | "lastSessionDate"
  >;
  daysSinceLastCount: number | null;
}): DataQualityInput {
  return {
    daysSinceLastCount: args.daysSinceLastCount,
    missingParCount: args.snapshot.missingParCount,
    missingCostCount: args.snapshot.missingCostCount,
    periodSpend: args.snapshot.periodSpend,
    weeklyGrossSales: args.snapshot.weeklyGrossSales,
    pendingInvoices: args.snapshot.pendingInvoices,
    deliveryIssuesCount: args.snapshot.deliveryIssuesCount,
    shrinkageValue: args.snapshot.shrinkageValue,
    hasApprovedSession: args.snapshot.lastSessionDate != null,
  };
}

export type KpiConfidenceSnapshot = Pick<
  KPISnapshot,
  | "missingParCount"
  | "missingCostCount"
  | "periodSpend"
  | "weeklyGrossSales"
  | "pendingInvoices"
  | "deliveryIssuesCount"
  | "shrinkageValue"
  | "lastSessionDate"
  | "overstockValue"
  | "inventoryValue"
  | "recordedWasteValue"
  | "priceIncreaseImpact"
  | "wasteItemsMissingCost"
  | "reorderSummary"
  | "foodCostPct"
>;

export function buildKpiConfidenceInput(args: {
  snapshot: KpiConfidenceSnapshot;
  daysSinceLastCount: number | null;
}): KpiConfidenceInput {
  const base = buildDataQualityInput({
    snapshot: args.snapshot,
    daysSinceLastCount: args.daysSinceLastCount,
  });
  return {
    ...base,
    overstockValue: args.snapshot.overstockValue,
    inventoryValue: args.snapshot.inventoryValue,
    recordedWasteValue: args.snapshot.recordedWasteValue,
    priceIncreaseImpact: args.snapshot.priceIncreaseImpact,
    wasteItemsMissingCost: args.snapshot.wasteItemsMissingCost,
    reorderSummary: args.snapshot.reorderSummary,
    foodCostPct: args.snapshot.foodCostPct,
  };
}

function lastUpdatedLabel(lastSessionDate: Date | null, periodLabel: string): string {
  if (lastSessionDate) {
    return `Count ${format(lastSessionDate, "MMM d, yyyy")} · ${periodLabel}`;
  }
  return periodLabel;
}

function money(n: number): string {
  if (!Number.isFinite(n)) return "—";
  return `$${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

export function buildInventoryExplain(args: {
  snapshot: KpiConfidenceSnapshot;
  daysSinceLastCount: number | null;
  periodLabel: string;
  displayValue: number;
}): KpiExplainPayload {
  const input = buildKpiConfidenceInput(args);
  const conf = computeInventoryValueConfidence(input);
  return {
    title: "Inventory value",
    resultLabel: "Total on-hand value",
    resultValue: money(args.displayValue),
    formula: "Σ (on_hand × unit_cost) for latest approved count",
    sourceTables: ["inventory_sessions", "inventory_session_items", "inventory_catalog_items"],
    lastUpdated: lastUpdatedLabel(args.snapshot.lastSessionDate, args.periodLabel),
    confidence: conf.level,
    confidenceReasons: conf.reasons,
    sourceLines: [
      { label: "Items with cost", value: String(Math.max(0, (args.snapshot.reorderSummary?.greenCount ?? 0) + (args.snapshot.reorderSummary?.yellowCount ?? 0) + (args.snapshot.reorderSummary?.redCount ?? 0))) },
      { label: "Missing unit cost", value: String(args.snapshot.missingCostCount) },
    ],
  };
}

export function buildOverstockExplain(args: {
  snapshot: KpiConfidenceSnapshot;
  daysSinceLastCount: number | null;
  periodLabel: string;
  topItem?: { name: string; onHand: number; par: number; unitCost: number; value: number };
}): KpiExplainPayload {
  const input = buildKpiConfidenceInput(args);
  const conf = computeOverstockConfidence(input);
  const top = args.topItem;
  const excess = top ? Math.max(top.onHand - top.par, 0) : null;
  return {
    title: "Overstock exposure",
    resultLabel: "Cash tied up above PAR",
    resultValue: money(args.snapshot.overstockValue),
    formula: "Σ max(on_hand − par, 0) × unit_cost",
    sourceTables: ["inventory_session_items", "par_guide_items", "inventory_catalog_items"],
    lastUpdated: lastUpdatedLabel(args.snapshot.lastSessionDate, args.periodLabel),
    confidence: conf.level,
    confidenceReasons: conf.reasons,
    sourceLines: top
      ? [
          { label: "Example item", value: top.name },
          { label: "Current qty", value: String(top.onHand) },
          { label: "PAR qty", value: String(top.par) },
          { label: "Excess qty", value: excess != null ? String(excess) : "—" },
          { label: "Unit cost", value: money(top.unitCost) },
        ]
      : [{ label: "Items without PAR", value: String(args.snapshot.missingParCount) }],
    calculationSteps:
      top && excess != null
        ? [
            { label: "Excess × unit cost", value: `${excess} × ${top.unitCost.toFixed(2)}` },
            { label: "Line result", value: money(top.value) },
            { label: "Session total", value: money(args.snapshot.overstockValue) },
          ]
        : undefined,
  };
}

export function buildReorderExplain(args: {
  snapshot: KpiConfidenceSnapshot;
  daysSinceLastCount: number | null;
  periodLabel: string;
  reorderValue: number;
}): KpiExplainPayload {
  const input = buildKpiConfidenceInput(args);
  const conf = computeReorderConfidence(input);
  const summary = args.snapshot.reorderSummary;
  return {
    title: "Reorder needed today",
    resultLabel: "Estimated spend to reach PAR",
    resultValue: money(args.reorderValue),
    formula: "Σ ceil(max(par − on_hand, 0)) × unit_cost",
    sourceTables: ["inventory_session_items", "par_guide_items"],
    lastUpdated: lastUpdatedLabel(args.snapshot.lastSessionDate, args.periodLabel),
    confidence: conf.level,
    confidenceReasons: conf.reasons,
    sourceLines: summary
      ? [
          { label: "Critical (red)", value: String(summary.redCount) },
          { label: "Low (yellow)", value: String(summary.yellowCount) },
          { label: "Excluded (no cost)", value: String(summary.missingCostCount) },
        ]
      : undefined,
  };
}

export function buildMoneyLostExplain(args: {
  snapshot: KpiConfidenceSnapshot;
  daysSinceLastCount: number | null;
  periodLabel: string;
}): KpiExplainPayload {
  const input = buildKpiConfidenceInput(args);
  const conf = computeMoneyLostConfidence(input);
  const total = computeMoneyLostTotal({
    recordedWasteValue: args.snapshot.recordedWasteValue,
    priceIncreaseImpact: args.snapshot.priceIncreaseImpact,
    overstockValue: args.snapshot.overstockValue,
    shrinkageValue: args.snapshot.shrinkageValue,
  });
  return {
    title: "Profit risk identified",
    resultLabel: "Combined exposure this period",
    resultValue: money(total),
    formula: "recorded waste + price hikes + overstock exposure + shrinkage alerts",
    sourceTables: ["waste_log", "notifications", "inventory_session_items", "par_guide_items"],
    lastUpdated: lastUpdatedLabel(args.snapshot.lastSessionDate, args.periodLabel),
    confidence: conf.level,
    confidenceReasons: conf.reasons,
    calculationSteps: [
      { label: "Recorded waste", value: money(args.snapshot.recordedWasteValue) },
      { label: "Price increase impact", value: money(args.snapshot.priceIncreaseImpact) },
      { label: "Overstock exposure", value: money(args.snapshot.overstockValue) },
      { label: "Shrinkage alerts", value: money(args.snapshot.shrinkageValue) },
      { label: "Total", value: money(total) },
    ],
  };
}

export function buildFoodCostExplain(args: {
  snapshot: KpiConfidenceSnapshot;
  periodLabel: string;
}): KpiExplainPayload {
  const input = buildKpiConfidenceInput({ snapshot: args.snapshot, daysSinceLastCount: null });
  const conf = computeFoodCostConfidence(input);
  return {
    title: "Food cost %",
    resultLabel: "Period food cost ratio",
    resultValue: args.snapshot.foodCostPct != null ? `${args.snapshot.foodCostPct.toFixed(1)}%` : "—",
    formula: "period invoice spend ÷ weekly gross sales × 100",
    sourceTables: ["invoices", "weekly_sales"],
    lastUpdated: args.periodLabel,
    confidence: conf.level,
    confidenceReasons: conf.reasons,
    sourceLines: [
      { label: "Period spend", value: money(args.snapshot.periodSpend) },
      { label: "Weekly gross sales", value: args.snapshot.weeklyGrossSales != null ? money(args.snapshot.weeklyGrossSales) : "Not entered" },
    ],
  };
}
