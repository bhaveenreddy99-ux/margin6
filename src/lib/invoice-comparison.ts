export type InvoiceComparisonStatus =
  | "ok"
  | "qty_mismatch"
  | "price_mismatch"
  | "total_mismatch"
  | "missing_from_invoice"
  | "extra_on_invoice"
  | "unmatched"
  | "received_short"
  | "received_over";

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
  /** Physical qty received at delivery (vs billed on invoice). */
  received_qty?: number | null;
  po_unit_cost?: number | null;
  invoiced_unit_cost?: number | null;
  po_total_cost?: number | null;
  invoiced_total_cost?: number | null;
  status?: string | null;
};

export const DEFAULT_QTY_TOLERANCE: ToleranceRule = {
  minAbsolute: 0.01,
  percent: 0.5,
};

export const DEFAULT_PRICE_TOLERANCE: ToleranceRule = {
  minAbsolute: 0.01,
  percent: 1,
};

export const DEFAULT_TOTAL_TOLERANCE: ToleranceRule = {
  minAbsolute: 1,
  percent: 1,
};

export const FIXED_STATUSES = new Set<InvoiceComparisonStatus>([
  "missing_from_invoice",
  "extra_on_invoice",
  "unmatched",
]);

function toNumber(value: VarianceInput): number | null {
  // Guard null/undefined explicitly: Number(null) === 0 which is a valid number,
  // but null/undefined here means "value not available", not "value is zero".
  if (value == null) return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

export function resolveLineTotal(
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

/** Dollar impact of billed qty vs received at invoice unit price (positive = short delivery). */
export function receivedVsBilledDollarVariance(
  invoicedQty: VarianceInput,
  receivedQty: VarianceInput,
  invoicedUnitCost: VarianceInput,
): number | null {
  const iq = toNumber(invoicedQty);
  const rq = toNumber(receivedQty);
  const cost = toNumber(invoicedUnitCost);
  if (iq == null || rq == null || cost == null) return null;
  return (iq - rq) * cost;
}

/** True when ordered, billed, and received quantities all differ beyond qty tolerance. */
export function threeWayQtyAllDivergent(c: InvoiceComparisonLike): boolean {
  const po = toNumber(c.po_qty);
  const inv = toNumber(c.invoiced_qty);
  const rec = toNumber(c.received_qty);
  if (po == null || inv == null || rec == null) return false;

  const a = analyzeVariance(po, inv, DEFAULT_QTY_TOLERANCE);
  const b = analyzeVariance(inv, rec, DEFAULT_QTY_TOLERANCE);
  const c12 = analyzeVariance(po, rec, DEFAULT_QTY_TOLERANCE);
  return a.exceedsTolerance && b.exceedsTolerance && c12.exceedsTolerance;
}

export function deriveInvoiceComparisonStatus(
  comparison: InvoiceComparisonLike,
): InvoiceComparisonStatus {
  const currentStatus = comparison.status as InvoiceComparisonStatus | undefined;
  if (currentStatus && FIXED_STATUSES.has(currentStatus)) {
    return currentStatus;
  }

  const invoiced = toNumber(comparison.invoiced_qty);
  const received = toNumber(comparison.received_qty);

  if (received != null && invoiced != null) {
    const recvVsBilled = analyzeVariance(invoiced, received, DEFAULT_QTY_TOLERANCE);
    if (recvVsBilled.exceedsTolerance) {
      if (recvVsBilled.difference != null && recvVsBilled.difference < 0) {
        return "received_short";
      }
      if (recvVsBilled.difference != null && recvVsBilled.difference > 0) {
        return "received_over";
      }
    }
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
    resolveLineTotal(
      comparison.invoiced_total_cost,
      comparison.invoiced_qty,
      comparison.invoiced_unit_cost,
    ),
    DEFAULT_TOTAL_TOLERANCE,
  );
  if (total.exceedsTolerance) return "total_mismatch";

  return "ok";
}

export function analyzeInvoiceComparison(comparison: InvoiceComparisonLike) {
  const invoiced = toNumber(comparison.invoiced_qty);
  const received = toNumber(comparison.received_qty);

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
    resolveLineTotal(
      comparison.invoiced_total_cost,
      comparison.invoiced_qty,
      comparison.invoiced_unit_cost,
    ),
    DEFAULT_TOTAL_TOLERANCE,
  );

  const receivedVsBilled =
    received != null && invoiced != null
      ? analyzeVariance(invoiced, received, DEFAULT_QTY_TOLERANCE)
      : {
          difference: null,
          absoluteDifference: null,
          percentDifference: null,
          exceedsTolerance: false,
        };

  const receivedDollar = receivedVsBilledDollarVariance(
    comparison.invoiced_qty,
    comparison.received_qty,
    comparison.invoiced_unit_cost,
  );

  return {
    qty,
    price,
    total,
    receivedVsBilled,
    receivedDollar,
    status: deriveInvoiceComparisonStatus(comparison),
  };
}
