export type InvoiceComparisonStatus =
  | "ok"
  | "qty_mismatch"
  | "price_mismatch"
  | "total_mismatch"
  | "missing_from_invoice"
  | "extra_on_invoice"
  | "unmatched";

type ToleranceRule = {
  minAbsolute: number;
  percent: number;
};

type VarianceInput = number | null | undefined;

export type VarianceAnalysis = {
  difference: number | null;
  absoluteDifference: number | null;
  percentDifference: number | null;
  exceedsTolerance: boolean;
};

export type InvoiceComparisonLike = {
  po_qty?: number | null;
  invoiced_qty?: number | null;
  po_unit_cost?: number | null;
  invoiced_unit_cost?: number | null;
  po_total_cost?: number | null;
  invoiced_total_cost?: number | null;
  status?: string | null;
};

export const DEFAULT_QTY_TOLERANCE: ToleranceRule = {
  // Large deliveries should not be flagged for tiny fractional rounding noise.
  minAbsolute: 0.01,
  percent: 0.5,
};

export const DEFAULT_PRICE_TOLERANCE: ToleranceRule = {
  // Penny-level rounding is fine, but vendor price changes should scale with line size.
  minAbsolute: 0.01,
  percent: 1,
};

export const DEFAULT_TOTAL_TOLERANCE: ToleranceRule = {
  // A line total can drift from rounding, but dollar-sized gaps should scale with the line value.
  minAbsolute: 1,
  percent: 1,
};

const FIXED_STATUSES = new Set<InvoiceComparisonStatus>([
  "missing_from_invoice",
  "extra_on_invoice",
  "unmatched",
]);

function toNumber(value: VarianceInput): number | null {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function resolveLineTotal(
  explicitTotal: VarianceInput,
  quantity: VarianceInput,
  unitCost: VarianceInput,
): number | null {
  const total = toNumber(explicitTotal);
  if (total != null) return total;

  const qty = toNumber(quantity);
  const cost = toNumber(unitCost);
  if (qty == null || cost == null) return null;

  return qty * cost;
}

export function analyzeVariance(
  expectedValue: VarianceInput,
  actualValue: VarianceInput,
  tolerance: ToleranceRule,
): VarianceAnalysis {
  const expected = toNumber(expectedValue);
  const actual = toNumber(actualValue);
  if (expected == null || actual == null) {
    return {
      difference: null,
      absoluteDifference: null,
      percentDifference: null,
      exceedsTolerance: false,
    };
  }

  const difference = actual - expected;
  const absoluteDifference = Math.abs(difference);
  const baseline = Math.max(Math.abs(expected), Math.abs(actual));
  const percentDifference = baseline > 0 ? (absoluteDifference / baseline) * 100 : 0;

  return {
    difference,
    absoluteDifference,
    percentDifference,
    exceedsTolerance:
      absoluteDifference > tolerance.minAbsolute && percentDifference > tolerance.percent,
  };
}

export function deriveInvoiceComparisonStatus(
  comparison: InvoiceComparisonLike,
): InvoiceComparisonStatus {
  const currentStatus = comparison.status as InvoiceComparisonStatus | undefined;
  if (currentStatus && FIXED_STATUSES.has(currentStatus)) {
    return currentStatus;
  }

  const qty = analyzeVariance(
    comparison.po_qty,
    comparison.invoiced_qty,
    DEFAULT_QTY_TOLERANCE,
  );
  if (qty.exceedsTolerance) return "qty_mismatch";

  const price = analyzeVariance(
    comparison.po_unit_cost,
    comparison.invoiced_unit_cost,
    DEFAULT_PRICE_TOLERANCE,
  );
  if (price.exceedsTolerance) return "price_mismatch";

  const total = analyzeVariance(
    resolveLineTotal(comparison.po_total_cost, comparison.po_qty, comparison.po_unit_cost),
    resolveLineTotal(comparison.invoiced_total_cost, comparison.invoiced_qty, comparison.invoiced_unit_cost),
    DEFAULT_TOTAL_TOLERANCE,
  );
  if (total.exceedsTolerance) return "total_mismatch";

  return "ok";
}

export function analyzeInvoiceComparison(comparison: InvoiceComparisonLike) {
  const qty = analyzeVariance(
    comparison.po_qty,
    comparison.invoiced_qty,
    DEFAULT_QTY_TOLERANCE,
  );
  const price = analyzeVariance(
    comparison.po_unit_cost,
    comparison.invoiced_unit_cost,
    DEFAULT_PRICE_TOLERANCE,
  );
  const total = analyzeVariance(
    resolveLineTotal(comparison.po_total_cost, comparison.po_qty, comparison.po_unit_cost),
    resolveLineTotal(comparison.invoiced_total_cost, comparison.invoiced_qty, comparison.invoiced_unit_cost),
    DEFAULT_TOTAL_TOLERANCE,
  );

  return {
    qty,
    price,
    total,
    status: deriveInvoiceComparisonStatus(comparison),
  };
}
