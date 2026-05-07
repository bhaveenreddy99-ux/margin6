/**
 * Shared inventory utilities for formatting, risk calculation, and smart order logic.
 */

import { formatCurrency as formatCurrencyUsd } from "@/lib/format";

// ── Number Formatting ──────────────────────────────────
/** Format a numeric value for display: max 2 decimals, no trailing zeros, no float artifacts */
export function formatNum(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  // Round to 2 decimal places to eliminate floating point artifacts
  const rounded = Math.round(value * 100) / 100;
  if (rounded === 0) return "0";
  // Use at most 2 decimal places, strip trailing zeros
  return parseFloat(rounded.toFixed(2)).toString();
}

/** Format currency (USD) */
export function formatCurrency(value: number | null | undefined): string {
  return formatCurrencyUsd(value);
}

/** Parse input value: handle edge cases like ".", ".1" → 0.1, "" → null */
export function parseInputValue(raw: string): number | null {
  if (raw === "" || raw === "." || raw === "-") return null;
  const val = parseFloat(raw);
  if (isNaN(val)) return null;
  return Math.max(0, val);
}

/**
 * Normalize display value for the controlled count input.
 *
 * Both `null` AND `0` render as empty string because in this app's data model
 * "uncounted" === `current_stock` not > 0 (see counted-items predicate on the
 * Inventory Count page). Showing literal "0" in the input would make freshly
 * seeded rows and just-cleared rows look like they already have a count.
 */
export function inputDisplayValue(value: number | null | undefined): string {
  if (value === null || value === undefined) return "";
  if (Number(value) === 0) return "";
  return String(value);
}

// ── Risk Classification ──────────────────────────────────
export type RiskLevel = "RED" | "YELLOW" | "GREEN" | "NO_PAR";

export interface RiskInfo {
  level: RiskLevel;
  label: string;
  color: string;
  bgClass: string;
  textClass: string;
  percent: number | null;
  tooltip: string;
}

export interface RiskThresholds {
  redThresholdPercent?: number | null;
  yellowThresholdPercent?: number | null;
}

function normalizeThresholdPercent(value: number | null | undefined, fallback: number): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric >= 0 ? numeric : fallback;
}

function resolveRiskThresholds(thresholds?: RiskThresholds) {
  const redThresholdPercent = normalizeThresholdPercent(thresholds?.redThresholdPercent, 50);
  const yellowThresholdPercent = Math.max(
    redThresholdPercent,
    normalizeThresholdPercent(thresholds?.yellowThresholdPercent, 100),
  );

  return { redThresholdPercent, yellowThresholdPercent };
}

export function getRisk(
  currentStock: number | null | undefined,
  parLevel: number | null | undefined,
  thresholds?: RiskThresholds,
): RiskInfo {
  const stock = currentStock ?? 0;
  
  if (parLevel === null || parLevel === undefined || parLevel <= 0) {
    return {
      level: "NO_PAR",
      label: "No PAR",
      color: "gray",
      bgClass: "bg-muted/60",
      textClass: "text-muted-foreground",
      percent: null,
      tooltip: "No PAR level set for this item",
    };
  }

  const percent = Math.round((stock / parLevel) * 100);
  const { redThresholdPercent, yellowThresholdPercent } = resolveRiskThresholds(thresholds);

  if (stock <= 0) {
    return {
      level: "RED",
      label: "Critical",
      color: "red",
      bgClass: "bg-destructive/10",
      textClass: "text-destructive",
      percent: 0,
      tooltip: "Out of stock — 0% of PAR",
    };
  }

  if (percent < redThresholdPercent) {
    return {
      level: "RED",
      label: "Critical",
      color: "red",
      bgClass: "bg-destructive/10",
      textClass: "text-destructive",
      percent,
      tooltip: `Current is ${percent}% of PAR`,
    };
  }

  if (percent < yellowThresholdPercent) {
    return {
      level: "YELLOW",
      label: "Low",
      color: "yellow",
      bgClass: "bg-warning/10",
      textClass: "text-warning",
      percent,
      tooltip: `Current is ${percent}% of PAR`,
    };
  }

  return {
    level: "GREEN",
    label: "OK",
    color: "green",
    bgClass: "bg-success/10",
    textClass: "text-success",
    percent,
    tooltip: `Current is ${percent}% of PAR — fully stocked`,
  };
}

// ── Smart Order Logic ──────────────────────────────────
export interface SmartOrderItem {
  item_name: string;
  current_stock: number;
  par_level: number;
  unit?: string | null;
  pack_size?: string | null;
  unit_cost?: number | null;
  risk: RiskLevel;
  order_qty: number;
}

/** Determine if a unit requires whole-number (ceiling) ordering */
export function isWholeUnitType(unit: string | null | undefined, packSize: string | null | undefined): boolean {
  if (!unit && !packSize) return false;
  const u = (unit || "").toUpperCase().trim();
  const ps = (packSize || "").toUpperCase().trim();
  // Case, pack, each — round up
  if (["CS", "CASE", "CASES", "PK", "PACK", "PACKS", "EA", "EACH"].includes(u)) return true;
  if (ps.includes("CASE") || ps.includes("CS") || ps.includes("PACK") || ps.includes("PK")) return true;
  return false;
}

/** Check if unit is a case-based unit specifically */
export function isCaseUnit(unit: string | null | undefined): boolean {
  const u = (unit || "").toUpperCase().trim();
  return ["CS", "CASE", "CASES"].includes(u);
}

/** Compute the raw need (gap between PAR and stock), max 2 decimals */
export function computeNeedRaw(currentStock: number | null | undefined, parLevel: number | null | undefined): number {
  const stock = currentStock ?? 0;
  const par = parLevel ?? 0;
  if (par <= 0) return 0;
  const raw = par - stock;
  if (raw <= 0) return 0;
  return Math.round(raw * 100) / 100;
}

/** Determine if unit allows decimal ordering (lb, gal, oz, etc) */
export function isDecimalUnitType(unit: string | null | undefined): boolean {
  const u = (unit || "").toUpperCase().trim();
  return ["LB", "LBS", "GAL", "GALLON", "GALLONS", "OZ", "KG", "LITER", "L"].includes(u);
}

/**
 * Suggested order quantity in CASES (canonical case-based model).
 * Always Math.ceil — the planning unit is always a whole case.
 * Inputs MUST already be in cases.
 */
export function computeOrderQtyCases(
  currentStockCases: number | null | undefined,
  parLevelCases: number | null | undefined,
): number {
  const stock = currentStockCases ?? 0;
  const par = parLevelCases ?? 0;
  if (par <= 0) return 0;
  const need = par - stock;
  if (need <= 0) return 0;
  return Math.ceil(need);
}

/**
 * @deprecated Use computeOrderQtyCases when inputs are already in cases (canonical model).
 * This function remains for callers where unit-aware rounding is still needed during migration.
 * Do NOT add new callers — use computeOrderQtyCases instead.
 *
 * Suggested order quantity (units depend on item unit — cases vs weight/liquid).
 * Decimal UOMs: 2 decimal places. Case/pack/each (or pack size hint): ceiling whole units.
 */
export function computeOrderQty(
  currentStock: number | null | undefined,
  parLevel: number | null | undefined,
  unit?: string | null,
  packSize?: string | null,
): number {
  const stock = currentStock ?? 0;
  const par = parLevel ?? 0;
  if (par <= 0) return 0;
  const needRaw = par - stock;
  if (needRaw <= 0) return 0;
  if (isDecimalUnitType(unit)) {
    return Math.round(needRaw * 100) / 100;
  }
  if (isWholeUnitType(unit, packSize)) {
    return Math.ceil(needRaw);
  }
  return Math.ceil(needRaw);
}

/** Compute risk level for smart order / dashboard math (uses restaurant thresholds when provided). */
export function computeRiskLevel(
  currentStock: number | null | undefined,
  parLevel: number | null | undefined,
  thresholds?: RiskThresholds,
): RiskLevel {
  return getRisk(currentStock, parLevel, thresholds).level;
}

// ── Row State ──────────────────────────────────
export function getRowState(currentStock: number | null | undefined): "uncounted" | "zero" | "counted" {
  if (currentStock === null || currentStock === undefined) return "uncounted";
  if (Number(currentStock) === 0) return "zero";
  return "counted";
}

export function getRowBgClass(currentStock: number | null | undefined): string {
  const state = getRowState(currentStock);
  if (state === "counted") return "bg-success/[0.04]";
  if (state === "zero") return "bg-muted/20";
  return "";
}
