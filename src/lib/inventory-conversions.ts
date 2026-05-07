import type { PackStructure } from "./pack-parser";
import { parsePackSize } from "./pack-parser";

export type CountInput = {
  value: number;
  unit: "cases" | "units" | "weight";
};

export type ConversionResult = {
  casesValue: number;
  formula: string;
  explanation: string;
};

const ROUND = 1e2;

function roundCases(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * ROUND) / ROUND;
}

function pluralUnit(name: string, n: number): string {
  const s = name.trim() || "units";
  if (n === 1) return s.replace(/s$/i, "");
  if (/s$/i.test(s)) return s;
  return `${s}s`;
}

/**
 * Short label for the "Units" count toggle (Bags, Bottles, Items, etc.).
 */
export function countUnitsButtonLabel(pack: PackStructure): string {
  const s = sellUnitLabel(pack);
  if (s === "item") return "Items";
  if (s === "bag") return "Bags";
  if (s === "bottle") return "Bottles";
  if (s === "packs") return "Units";
  if (s === "each") return "Each";
  return s.length ? s.charAt(0).toUpperCase() + s.slice(1) : "Units";
}

/**
 * Rich label for sell units (e.g. "bags", "bottles", "items") from pack structure.
 */
function sellUnitLabel(pack: PackStructure): string {
  if (pack.isCountBased && /\bCT\b/i.test(pack.rawFormat)) return "item";
  if (pack.unitName === "packs" && pack.isWeightBased) return "bag";
  if (pack.unitName === "packs" && (pack.unitType === "gal" || pack.unitType === "l"))
    return "bottle";
  return pack.unitName;
}

/**
 * Convert any count input to cases using pack structure.
 */
export function convertToCases(input: CountInput, pack: PackStructure): ConversionResult {
  if (!Number.isFinite(input.value)) {
    return {
      casesValue: 0,
      formula: "0",
      explanation: "Invalid input",
    };
  }

  if (input.value === 0) {
    return {
      casesValue: 0,
      formula: "0 CS",
      explanation: "0 cases",
    };
  }

  const upc = pack.unitsPerCase > 0 ? pack.unitsPerCase : 1;
  const tpc = pack.totalPerCase > 0 ? pack.totalPerCase : 1;

  if (input.unit === "cases") {
    const v = roundCases(input.value);
    return {
      casesValue: v,
      formula: `${v} CS`,
      explanation: v === 1 ? "1 case" : `${v} cases`,
    };
  }

  if (input.unit === "units") {
    const casesValue = roundCases(input.value / upc);
    const su = sellUnitLabel(pack);
    const unitWord = pluralUnit(su, input.value);
    const totalInner =
      pack.isWeightBased
        ? roundCases(input.value * (pack.unitSize > 0 ? pack.unitSize : 1))
        : null;
    const weightBit =
      totalInner != null && pack.measureName
        ? ` (${totalInner} ${pack.measureName})`
        : "";
    return {
      casesValue,
      formula: `${input.value} ${unitWord} ÷ ${upc} = ${casesValue} CS`,
      explanation: `${input.value} ${unitWord} = ${casesValue} cases${weightBit}`,
    };
  }

  // weight
  const measure = pack.measureName || "weight";
  const casesValue = roundCases(input.value / tpc);
  const innerUnits = roundCases(casesValue * upc);
  const su = sellUnitLabel(pack);
  const unitWord = pluralUnit(su, innerUnits);
  return {
    casesValue,
    formula: `${input.value} ${measure} ÷ ${tpc} ${measure}/case = ${casesValue} CS`,
    explanation: `${input.value} ${measure} = ${casesValue} cases (${innerUnits} ${unitWord})`,
  };
}

/**
 * Get formatted display of conversion (all three representations).
 */
export function formatConversionDisplay(
  casesValue: number,
  pack: PackStructure,
): {
  cases: string;
  units: string;
  weight: string;
} {
  if (!Number.isFinite(casesValue) || casesValue < 0) {
    return { cases: "0 CS", units: "0", weight: "0" };
  }

  const v = roundCases(casesValue);
  const upc = pack.unitsPerCase > 0 ? pack.unitsPerCase : 1;
  const tpc = pack.totalPerCase > 0 ? pack.totalPerCase : 1;

  const sell = roundCases(v * upc);
  const w = roundCases(v * tpc);
  const su = sellUnitLabel(pack);
  const m = pack.measureName || "";

  return {
    cases: `${v} CS`,
    units: `${sell} ${pluralUnit(su, sell)}`,
    weight: m ? `${w} ${m}` : `${w}`,
  };
}

/** Human "N cases" / "1 case" for display (not "N CS"). */
function formatCaseCountLabel(casesValue: number): string {
  const v = roundCases(casesValue);
  if (v === 1) return "1 case";
  return `${v} cases`;
}

/**
 * Three display lines: cases total, = units, = weight (from stored case equivalent).
 * Example: 5.5 cases / = 33 bags / = 165 lbs
 */
export function buildConversionLines(
  casesValue: number,
  pack: PackStructure,
): { line1: string; line2: string; line3: string } {
  if (!Number.isFinite(casesValue) || casesValue < 0) {
    return { line1: "0 cases", line2: "= 0", line3: "= 0" };
  }
  const fmt = formatConversionDisplay(casesValue, pack);
  const v = roundCases(casesValue);
  const line1 = formatCaseCountLabel(v);
  const line2 = `= ${fmt.units}`;
  const line3 = `= ${fmt.weight}`;
  return { line1, line2, line3 };
}

/**
 * One-sentence help while typing, e.g. "Counted 33 bags out of 6 per case = 5.5 cases"
 */
export function buildContextualCountSentence(args: {
  rawValue: number;
  countMode: CountInput["unit"];
  pack: PackStructure;
  casesValue: number;
}): string {
  const { rawValue, countMode, pack, casesValue } = args;
  if (!Number.isFinite(rawValue) || rawValue < 0) return "";
  const v = roundCases(casesValue);
  const upc = pack.unitsPerCase > 0 ? pack.unitsPerCase : 1;
  const tpc = pack.totalPerCase > 0 ? pack.totalPerCase : 1;

  if (countMode === "cases") {
    return formatCaseCountLabel(v) === "1 case" ? "Counted 1 case" : `Counted ${v} cases`;
  }

  if (countMode === "units") {
    const su = sellUnitLabel(pack);
    const unitWord = pluralUnit(su, rawValue);
    const casePart = v === 1 ? "1 case" : `${v} cases`;
    return `Counted ${rawValue} ${unitWord} out of ${upc} per case = ${casePart}`;
  }

  if (countMode === "weight") {
    const measure = pack.measureName || "lb";
    const casePart = v === 1 ? "1 case" : `${v} cases`;
    return `Counted ${rawValue} ${measure} out of ${tpc} ${measure} per case = ${casePart}`;
  }

  return "";
}

export type CatalogItemPackFields = {
  units_per_case?: number | null;
  unit_size?: number | null;
  unit_type?: string | null;
  total_per_case?: number | null;
  pack_size?: string | null;
  pack_parse_success?: boolean | null;
};

/**
 * Build a {@link PackStructure} from catalog columns, falling back to `parsePackSize(pack_size)`.
 */
export function getPackFromCatalogItem(catalogItem: CatalogItemPackFields): PackStructure {
  const parsed = parsePackSize(catalogItem.pack_size?.trim() || "EACH");
  if (
    catalogItem.units_per_case != null &&
    catalogItem.units_per_case > 0 &&
    catalogItem.unit_type != null &&
    String(catalogItem.unit_type).trim() !== ""
  ) {
    const unitSize = catalogItem.unit_size != null && catalogItem.unit_size > 0 ? catalogItem.unit_size : 1;
    const total =
      catalogItem.total_per_case != null && catalogItem.total_per_case > 0
        ? catalogItem.total_per_case
        : catalogItem.units_per_case * unitSize;
    return {
      ...parsed,
      rawFormat: (catalogItem.pack_size || parsed.rawFormat).trim() || parsed.rawFormat,
      unitsPerCase: catalogItem.units_per_case,
      unitSize,
      unitType: String(catalogItem.unit_type).trim(),
      totalPerCase: total,
      parseSuccess: catalogItem.pack_parse_success ?? parsed.parseSuccess,
    };
  }
  return parsed;
}

export type SessionItemWithStock = {
  current_stock: number | null;
  counted_as?: string | null;
  counted_value?: number | null;
};

/**
 * Get display value for legacy rows (before conversion audit) vs new rows.
 */
export function getDisplayValue(sessionItem: SessionItemWithStock): { value: number; unit: string } {
  const hasNew =
    sessionItem.counted_as != null &&
    sessionItem.counted_as !== "" &&
    sessionItem.counted_value != null &&
    Number.isFinite(Number(sessionItem.counted_value));

  if (hasNew) {
    const u = String(sessionItem.counted_as).toLowerCase();
    if (u === "units" || u === "unit") return { value: Number(sessionItem.counted_value), unit: "units" };
    if (u === "weight") return { value: Number(sessionItem.counted_value), unit: "weight" };
    return { value: Number(sessionItem.counted_value), unit: "cases" };
  }

  return {
    value: sessionItem.current_stock != null && Number.isFinite(Number(sessionItem.current_stock))
      ? Number(sessionItem.current_stock)
      : 0,
    unit: "cases",
  };
}

// ── Unit mapping helpers ────────────────────────────────────────────────────

/**
 * Map a catalog `unit` field value to the CountInput unit type used by convertToCases.
 * Weight units → "weight", case units → "cases", everything else → "units".
 */
export function catalogUnitToCountUnit(
  catalogUnit: string | null | undefined,
): CountInput["unit"] {
  const u = (catalogUnit || "").toUpperCase().trim();
  if (["CS", "CASE", "CASES"].includes(u)) return "cases";
  if (["LB", "LBS", "OZ", "GAL", "GALLON", "GALLONS", "KG", "L", "LITER", "LITERS"].includes(u)) return "weight";
  return "units";
}

export type SafeCaseConversionResult = {
  cases: number;
  ok: boolean;
  reason?: string;
};

/**
 * Convert a raw entered quantity (in the catalog item's native unit) to CASES.
 *
 * Returns `{ cases, ok: true }` on success, or `{ cases: 0, ok: false, reason }` when the
 * conversion cannot be resolved safely (invalid input, missing pack info, or zero divisor).
 *
 * Use this wherever a user enters a quantity that must be stored/priced as cases.
 *
 * @example
 *   // "6/4 lb" pack → totalPerCase=24
 *   convertInputToCasesSafe(24, "LB", getPackFromCatalogItem(catalogItem))
 *   // → { cases: 1, ok: true }
 */
export function convertInputToCasesSafe(
  rawInput: number,
  catalogUnit: string | null | undefined,
  pack: PackStructure | null | undefined,
): SafeCaseConversionResult {
  if (!Number.isFinite(rawInput) || rawInput <= 0) {
    return { cases: 0, ok: false, reason: "invalid input" };
  }
  if (!pack) {
    return { cases: 0, ok: false, reason: "no pack info" };
  }

  const countUnit = catalogUnitToCountUnit(catalogUnit);

  // Validate that the pack has the required divisor for this unit type
  if (countUnit === "weight" && !(pack.totalPerCase > 0)) {
    return { cases: 0, ok: false, reason: "pack totalPerCase unavailable for weight conversion" };
  }
  if (countUnit === "units" && !(pack.unitsPerCase > 0)) {
    return { cases: 0, ok: false, reason: "pack unitsPerCase unavailable for units conversion" };
  }

  const result = convertToCases({ value: rawInput, unit: countUnit }, pack);
  if (!Number.isFinite(result.casesValue)) {
    return { cases: 0, ok: false, reason: "conversion produced non-finite result" };
  }
  return { cases: result.casesValue, ok: true };
}

/**
 * @example Phase 3 — save handler pattern (not wired in app yet)
 * ```ts
 * async function saveCount(
 *   item: InventorySessionItem,
 *   userInput: number,
 *   countedAs: "cases" | "units" | "weight"
 * ) {
 *   const catalogItem = await fetchCatalogItem(item.catalog_item_id);
 *   const pack = getPackFromCatalogItem(catalogItem);
 *   const conversion = convertToCases({ value: userInput, unit: countedAs }, pack);
 *   await supabase.from("inventory_session_items").update({
 *     current_stock: conversion.casesValue,
 *     counted_as: countedAs,
 *     counted_value: userInput,
 *     conversion_formula: conversion.formula,
 *   }).eq("id", item.id);
 * }
 * ```
 */
