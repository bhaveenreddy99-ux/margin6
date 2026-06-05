import type { DataQualityBand, DataQualityInput, DataQualityIssue, DataQualityResult } from "./types";

function bandFromScore(score: number): DataQualityBand {
  if (score >= 95) return "excellent";
  if (score >= 80) return "good";
  if (score >= 60) return "medium";
  return "low";
}

export function computeDataQualityScore(input: DataQualityInput): DataQualityResult {
  let score = 100;
  const issues: DataQualityIssue[] = [];

  if (!input.hasApprovedSession || input.daysSinceLastCount === null) {
    score -= 25;
    issues.push({
      code: "no_count",
      message: "No approved inventory count — dollar KPIs need a count baseline.",
      deduction: 25,
    });
  } else if (input.daysSinceLastCount > 7) {
    score -= 20;
    issues.push({
      code: "stale_count",
      message: `Last count was ${input.daysSinceLastCount} days ago — stock dollars may be stale.`,
      deduction: 20,
    });
  } else if (input.daysSinceLastCount > 3) {
    score -= 10;
    issues.push({
      code: "aging_count",
      message: `Last count was ${input.daysSinceLastCount} days ago.`,
      deduction: 10,
    });
  }

  if (input.missingParCount > 0) {
    const deduction = Math.min(20, input.missingParCount * 2);
    score -= deduction;
    issues.push({
      code: "missing_par",
      message: `${input.missingParCount} item(s) missing PAR — overstock cannot be measured for them.`,
      deduction,
    });
  }

  if (input.missingCostCount > 0) {
    const deduction = Math.min(20, input.missingCostCount * 2);
    score -= deduction;
    issues.push({
      code: "missing_cost",
      message: `${input.missingCostCount} item(s) missing unit cost — inventory and reorder values understated.`,
      deduction,
    });
  }

  if (input.periodSpend > 0 && (input.weeklyGrossSales == null || input.weeklyGrossSales <= 0)) {
    score -= 10;
    issues.push({
      code: "no_sales",
      message: "Weekly sales not entered — food cost % stays locked.",
      deduction: 10,
    });
  }

  if (input.pendingInvoices > 0) {
    const deduction = Math.min(15, input.pendingInvoices * 3);
    score -= deduction;
    issues.push({
      code: "pending_invoices",
      message: `${input.pendingInvoices} invoice(s) awaiting review.`,
      deduction,
    });
  }

  if (input.deliveryIssuesCount > 0) {
    score -= 10;
    issues.push({
      code: "delivery_issues",
      message: `${input.deliveryIssuesCount} delivery issue(s) flagged on invoices.`,
      deduction: 10,
    });
  }

  if (input.shrinkageValue > 0) {
    score -= 5;
    issues.push({
      code: "shrinkage_alerts",
      message: "Count variance or shrinkage alerts fired this period.",
      deduction: 5,
    });
  }

  const finalScore = Math.max(0, Math.min(100, score));
  return {
    score: finalScore,
    band: bandFromScore(finalScore),
    issues,
  };
}

export function dataQualityBandLabel(band: DataQualityBand): string {
  switch (band) {
    case "excellent":
      return "Excellent";
    case "good":
      return "Good";
    case "medium":
      return "Medium";
    case "low":
      return "Low confidence";
  }
}
