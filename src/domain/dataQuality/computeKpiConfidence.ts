import type { ConfidenceLevel, KpiConfidence, KpiConfidenceInput } from "./types";

function levelFromScore(high: boolean, medium: boolean): ConfidenceLevel {
  if (high) return "high";
  if (medium) return "medium";
  return "low";
}

export function computeInventoryValueConfidence(input: KpiConfidenceInput): KpiConfidence {
  const reasons: string[] = [];
  if (!input.hasApprovedSession) {
    return { level: "low", reasons: ["No approved inventory count."] };
  }
  if (input.daysSinceLastCount != null && input.daysSinceLastCount > 7) {
    reasons.push(`Count is ${input.daysSinceLastCount} days old.`);
  }
  if (input.missingCostCount > 3) {
    reasons.push(`${input.missingCostCount} items missing unit cost.`);
  } else if (input.missingCostCount > 0) {
    reasons.push(`${input.missingCostCount} item(s) missing unit cost.`);
  }

  const high =
    input.hasApprovedSession &&
    (input.daysSinceLastCount == null || input.daysSinceLastCount <= 3) &&
    input.missingCostCount === 0;
  const medium =
    input.hasApprovedSession &&
    (input.daysSinceLastCount == null || input.daysSinceLastCount <= 7) &&
    input.missingCostCount <= 3;

  if (high) reasons.unshift("Fresh approved count with full cost coverage.");
  return { level: levelFromScore(high, medium), reasons };
}

export function computeOverstockConfidence(input: KpiConfidenceInput): KpiConfidence {
  const summary = input.reorderSummary;
  const totalItems =
    (summary?.redCount ?? 0) +
    (summary?.yellowCount ?? 0) +
    (summary?.greenCount ?? 0) +
    (summary?.noParCount ?? 0);
  const noPar = summary?.noParCount ?? 0;
  const reasons: string[] = [];

  if (totalItems > 0 && noPar === totalItems) {
    return { level: "low", reasons: ["No PAR levels configured — overstock cannot be calculated."] };
  }
  if (noPar > 0) reasons.push(`${noPar} item(s) without PAR.`);
  if (input.missingCostCount > 0) reasons.push("Some lines missing cost.");

  const high =
    input.hasApprovedSession &&
    totalItems > 0 &&
    noPar < totalItems / 2 &&
    input.missingCostCount === 0;
  const medium = input.hasApprovedSession && noPar < totalItems;

  if (high) reasons.unshift("PAR and costs available on counted items.");
  return { level: levelFromScore(high, medium), reasons };
}

export function computeReorderConfidence(input: KpiConfidenceInput): KpiConfidence {
  const missing = input.reorderSummary?.missingCostCount ?? 0;
  const reasons: string[] = [];
  if (missing > 0) reasons.push(`${missing} reorder line(s) excluded — no unit cost.`);
  if (!input.hasApprovedSession) {
    return { level: "low", reasons: ["No approved count."] };
  }
  const high = missing === 0 && input.missingParCount <= 2;
  const medium = missing <= 3;
  if (high) reasons.unshift("All reorder lines have cost data.");
  return { level: levelFromScore(high, medium), reasons };
}

export function computeMoneyLostConfidence(input: KpiConfidenceInput): KpiConfidence {
  const reasons: string[] = [];
  if (input.wasteItemsMissingCost > 0) {
    reasons.push(`${input.wasteItemsMissingCost} waste entries missing reliable cost.`);
  }
  if (!input.hasApprovedSession) {
    reasons.push("Overstock component requires an approved count.");
  }
  const high =
    input.hasApprovedSession &&
    input.wasteItemsMissingCost === 0 &&
    (input.daysSinceLastCount == null || input.daysSinceLastCount <= 7);
  const medium = input.hasApprovedSession;
  if (high) reasons.unshift("Period waste priced; count-backed overstock.");
  return { level: levelFromScore(high, medium), reasons };
}

export function computeFoodCostConfidence(input: KpiConfidenceInput): KpiConfidence {
  if (input.foodCostPct == null) {
    return {
      level: "low",
      reasons: ["Enter weekly sales to unlock food cost %."],
    };
  }
  if (input.periodSpend <= 0) {
    return { level: "low", reasons: ["No posted spend this period."] };
  }
  return {
    level: "high",
    reasons: ["Weekly sales and period spend both recorded."],
  };
}

export function confidenceLabel(level: ConfidenceLevel): string {
  switch (level) {
    case "high":
      return "High confidence";
    case "medium":
      return "Medium confidence";
    case "low":
      return "Low confidence";
  }
}
