/**
 * receivingEngine.ts — Phase 4: Trusted Receiving
 *
 * Pure domain logic for:
 *  1. Normalizing received quantities to CASES (canonical unit)
 *  2. Computing three-way variance (ordered / invoiced / received)
 *  3. Validating receiving state before confirming receipt
 *
 * No side effects. No Supabase calls. Fully testable.
 */

import { parsePackSize } from "@/lib/pack-parser";
import { DEFAULT_PRICE_TOLERANCE, DEFAULT_QTY_TOLERANCE, analyzeVariance } from "@/lib/invoice-comparison";

// ─── Types ────────────────────────────────────────────────────────────────────

export type ReceivedQtyNormalizationInput = {
  receivedQty: number;
  /** Unit the quantity was entered in (e.g. "CS", "LB", "EA"). Null → treat as case. */
  receivedUnit: string | null | undefined;
  /** Catalog pack_size string (e.g. "6/4 LB", "24/1 EA"). Needed for non-case conversion. */
  packSize: string | null | undefined;
};

export type ReceivedQtyNormalizationResult = {
  /** Quantity in CASES — use this for stock_movements.quantity */
  quantityCases: number;
  /** Original quantity as entered (for stock_movements.source_quantity) */
  sourceQuantity: number;
  /** Original unit as entered (for stock_movements.source_quantity_unit) */
  sourceUnit: string;
  /** Whether normalization succeeded */
  ok: boolean;
  /** Human-readable failure reason when ok=false */
  reason?: string;
  /** 'passthrough_case' | 'converted_to_case' | 'conversion_failed' */
  conversionStatus: "passthrough_case" | "converted_to_case" | "conversion_failed";
};

export type ThreeWayVarianceInput = {
  orderedQty: number | null | undefined;
  invoicedQty: number | null | undefined;
  receivedQty: number | null | undefined;
  orderedUnitCost: number | null | undefined;
  invoicedUnitCost: number | null | undefined;
};

export type ThreeWayVarianceResult = {
  /** PO qty vs invoice qty differ beyond tolerance */
  orderedVsInvoiceQtyMismatch: boolean;
  /** Invoice qty vs received qty differ beyond tolerance */
  invoiceVsReceivedQtyMismatch: boolean;
  /** PO unit cost vs invoice unit cost differ beyond tolerance */
  priceMismatch: boolean;
  /** True when all three variance flags are false */
  ok: boolean;
};

export type ReceivingValidationInput = {
  comparisons: Array<{
    invoiced_qty?: number | null;
    received_qty?: number | null;
    /** False when received_qty was auto-filled and not yet confirmed by manager */
    received_qty_confirmed?: boolean | null;
    status?: string | null;
  }>;
};

export type ReceivingValidationResult = {
  valid: boolean;
  /** Human-readable block reason */
  reason?: string;
  /** Number of rows blocking confirmation */
  blockingRows: number;
};

// ─── Constants ────────────────────────────────────────────────────────────────

const CASE_UNIT_ALIASES = new Set([
  "CS", "CASE", "CASES", "CA", "CSE",
]);

const WEIGHT_UNIT_ALIASES = new Set([
  "LB", "LBS", "POUND", "POUNDS",
]);

const OZ_UNIT_ALIASES = new Set([
  "OZ", "OUNCE", "OUNCES",
]);

const COUNT_UNIT_ALIASES = new Set([
  "EA", "EACH", "PC", "PCS", "PIECE", "PIECES", "CT", "COUNT", "UN", "UNIT", "UNITS",
]);

// ─── Functions ────────────────────────────────────────────────────────────────

/**
 * Converts a received quantity from its original unit to CASES.
 *
 * Rules:
 * - "case"-family units: passthrough (quantity IS already cases)
 * - "lb"-family: divide by pack.totalPerCase
 * - "each"-family: divide by pack.unitsPerCase
 * - unknown unit or missing pack info → ok=false
 */
export function normalizeReceivedQuantityToCases(
  input: ReceivedQtyNormalizationInput,
): ReceivedQtyNormalizationResult {
  const { receivedQty, packSize } = input;
  const sourceUnit = (input.receivedUnit ?? "CS").trim().toUpperCase();

  const failed = (reason: string): ReceivedQtyNormalizationResult => ({
    quantityCases: 0,
    sourceQuantity: receivedQty,
    sourceUnit,
    ok: false,
    reason,
    conversionStatus: "conversion_failed",
  });

  if (!Number.isFinite(receivedQty) || receivedQty < 0) {
    return failed("Invalid received quantity");
  }

  // Case passthrough
  if (CASE_UNIT_ALIASES.has(sourceUnit) || sourceUnit === "") {
    return {
      quantityCases: receivedQty,
      sourceQuantity: receivedQty,
      sourceUnit,
      ok: true,
      conversionStatus: "passthrough_case",
    };
  }

  // Parse pack for weight/count conversions — null/empty packSize = no conversion possible
  const packStr = packSize?.trim();
  if (!packStr) {
    return failed(
      `Cannot convert ${sourceUnit} to cases: no pack_size available for this catalog item`,
    );
  }
  const pack = parsePackSize(packStr);

  if (WEIGHT_UNIT_ALIASES.has(sourceUnit)) {
    if (!(pack.totalPerCase > 0)) {
      return failed(
        `Cannot convert ${sourceUnit} to cases: pack "${packSize}" has no usable totalPerCase`,
      );
    }
    return {
      quantityCases: Math.round((receivedQty / pack.totalPerCase) * 10000) / 10000,
      sourceQuantity: receivedQty,
      sourceUnit,
      ok: true,
      conversionStatus: "converted_to_case",
    };
  }

  if (OZ_UNIT_ALIASES.has(sourceUnit)) {
    if (!(pack.totalPerCase > 0)) {
      return failed(
        `Cannot convert OZ to cases: pack "${packSize}" has no usable totalPerCase`,
      );
    }
    // Convert oz → lbs → cases (pack expressed in lbs)
    const cases = (receivedQty / 16) / pack.totalPerCase;
    return {
      quantityCases: Math.round(cases * 10000) / 10000,
      sourceQuantity: receivedQty,
      sourceUnit,
      ok: true,
      conversionStatus: "converted_to_case",
    };
  }

  if (COUNT_UNIT_ALIASES.has(sourceUnit)) {
    if (!(pack.unitsPerCase > 0)) {
      return failed(
        `Cannot convert ${sourceUnit} to cases: pack "${packSize}" has no usable unitsPerCase`,
      );
    }
    return {
      quantityCases: Math.round((receivedQty / pack.unitsPerCase) * 10000) / 10000,
      sourceQuantity: receivedQty,
      sourceUnit,
      ok: true,
      conversionStatus: "converted_to_case",
    };
  }

  return failed(
    `Unknown unit "${input.receivedUnit ?? "(null)"}" — cannot convert to cases safely`,
  );
}

/**
 * Computes the three-way variance across ordered, invoiced, and received quantities.
 * Uses existing tolerance rules from invoice-comparison.ts.
 */
export function computeThreeWayVariance(
  input: ThreeWayVarianceInput,
): ThreeWayVarianceResult {
  const orderedVsInvoice = analyzeVariance(
    input.orderedQty,
    input.invoicedQty,
    DEFAULT_QTY_TOLERANCE,
  );
  const invoiceVsReceived = analyzeVariance(
    input.invoicedQty,
    input.receivedQty,
    DEFAULT_QTY_TOLERANCE,
  );
  const priceVariance = analyzeVariance(
    input.orderedUnitCost,
    input.invoicedUnitCost,
    DEFAULT_PRICE_TOLERANCE,
  );

  const orderedVsInvoiceQtyMismatch = orderedVsInvoice.exceedsTolerance;
  const invoiceVsReceivedQtyMismatch = invoiceVsReceived.exceedsTolerance;
  const priceMismatch = priceVariance.exceedsTolerance;

  return {
    orderedVsInvoiceQtyMismatch,
    invoiceVsReceivedQtyMismatch,
    priceMismatch,
    ok: !orderedVsInvoiceQtyMismatch && !invoiceVsReceivedQtyMismatch && !priceMismatch,
  };
}

/**
 * Validates that all comparison rows are ready for receipt confirmation.
 *
 * Blocks if any real invoice line (invoiced_qty > 0, not missing_from_invoice):
 * - has received_qty = null
 * - has received_qty_confirmed = false (auto-filled, not manager-confirmed)
 */
export function validateReceivingBeforeConfirm(
  input: ReceivingValidationInput,
): ReceivingValidationResult {
  let blockingRows = 0;
  let hasNull = false;
  let hasUnconfirmed = false;

  for (const row of input.comparisons) {
    const invoicedQty = Number(row.invoiced_qty ?? 0);
    if (!Number.isFinite(invoicedQty) || invoicedQty <= 0) continue;
    if (row.status === "missing_from_invoice") continue;

    if (row.received_qty == null) {
      blockingRows++;
      hasNull = true;
    } else if (row.received_qty_confirmed === false || row.received_qty_confirmed == null) {
      blockingRows++;
      hasUnconfirmed = true;
    }
  }

  if (blockingRows === 0) {
    return { valid: true, blockingRows: 0 };
  }

  const reasons: string[] = [];
  if (hasNull) reasons.push("missing received quantity");
  if (hasUnconfirmed) reasons.push("unconfirmed received quantity (auto-filled, not manager-verified)");

  return {
    valid: false,
    reason: `${blockingRows} line(s) blocking confirm: ${reasons.join("; ")}`,
    blockingRows,
  };
}
