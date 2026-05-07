/**
 * Universal Pack Size Parser
 * Handles formats: "6/5 Lb", "40 lb", "24 CT", "EACH", etc.
 */

export type PackStructure = {
  rawFormat: string;
  unitsPerCase: number;
  unitSize: number;
  unitType: string;
  totalPerCase: number;
  unitName: string;
  measureName: string;
  isWeightBased: boolean;
  isCountBased: boolean;
  isSingleUnit: boolean;
  parseSuccess: boolean;
  parseError?: string;
};

const DEFAULT: Omit<PackStructure, "rawFormat" | "parseSuccess" | "parseError"> = {
  unitsPerCase: 1,
  unitSize: 1,
  unitType: "each",
  totalPerCase: 1,
  unitName: "units",
  measureName: "each",
  isWeightBased: false,
  isCountBased: true,
  isSingleUnit: true,
};

type OkPartial = Partial<Omit<PackStructure, "rawFormat" | "parseSuccess" | "parseError">> & {
  unitsPerCase: number;
  unitSize: number;
  unitType: string;
  /** Inner sell unit (N/M) → unitName "packs" */
  innerPack?: boolean;
};

function fail(raw: string, err: string): PackStructure {
  return {
    rawFormat: raw,
    ...DEFAULT,
    parseSuccess: false,
    parseError: err,
  };
}

function ok(raw: string, partial: OkPartial): PackStructure {
  const u = normalizeUnitType(partial.unitType);
  const total = partial.totalPerCase ?? partial.unitsPerCase * partial.unitSize;
  const w = partial.isWeightBased ?? isWeightType(u);
  const v = isVolumeType(u);
  const c =
    partial.isCountBased !== undefined
      ? partial.isCountBased
      : isCountType(u) && !w && !v;
  const single =
    partial.isSingleUnit !== undefined
      ? partial.isSingleUnit
      : partial.unitsPerCase === 1 && partial.unitSize === 1;

  return {
    rawFormat: raw,
    unitsPerCase: partial.unitsPerCase,
    unitSize: partial.unitSize,
    unitType: u,
    totalPerCase: roundQty(total),
    unitName:
      partial.unitName ?? getUnitName(u, partial.unitsPerCase, partial.unitSize, !!partial.innerPack),
    measureName: partial.measureName ?? getMeasureName(u),
    isWeightBased: w,
    isCountBased: c,
    isSingleUnit: single,
    parseSuccess: true,
  };
}

function roundQty(n: number): number {
  if (!Number.isFinite(n)) return 1;
  return Math.round(n * 1e6) / 1e6;
}

function collapseSpaces(s: string): string {
  return s
    .replace(/[\u00a0\u2000-\u200b\ufeff]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isWeightType(u: string): boolean {
  return ["lb", "oz", "kg", "g", "#"].includes(u);
}

function isVolumeType(u: string): boolean {
  return ["gal", "l", "ml", "fl_oz", "pt", "qt"].includes(u);
}

function isCountType(u: string): boolean {
  return u === "each" || u === "dozen";
}

/**
 * Map raw unit token to canonical unit_type (fl_oz for multi-word).
 */
function normalizeUnitType(raw: string): string {
  const s = raw.trim();
  if (!s) return "each";
  const lower = s.toLowerCase();
  if (/^gal(lon|lons)?$/i.test(lower) || lower === "gl") return "gal";
  if (lower === "lb" || lower === "lbs" || lower === "pound" || lower === "pounds" || lower === "#")
    return "lb";
  if (lower === "oz" || lower === "ounce" || lower === "ounces") return "oz";
  if (lower === "fl" || lower === "floz" || lower === "fl-oz" || lower === "fl.oz" || lower === "fl oz")
    return "fl_oz";
  if (lower === "l" || lower === "lt" || lower === "liter" || lower === "litre" || lower === "liters" || lower === "litres")
    return "l";
  if (lower === "ml" || lower === "milliliter" || lower === "millilitre") return "ml";
  if (lower === "kg" || lower === "kilogram" || lower === "kilograms" || lower === "kilo") return "kg";
  if (lower === "g" && s.length <= 2) return "g";
  if (lower === "gram" || lower === "grams" || lower === "gr") return "g";
  if (lower === "ct" || lower === "count" || lower === "ea" || lower === "each" || lower === "unit" || lower === "units" || lower === "pc" || lower === "pk" || lower === "btl" || lower === "bottle" || lower === "bottles" || lower === "pkg" || lower === "pkgs")
    return "each";
  if (lower === "cs" || lower === "case" || lower === "cases") return "each";
  if (lower === "doz" || lower === "dz" || lower === "dozen") return "dozen";
  if (lower === "pt" || lower === "pint") return "pt";
  if (lower === "qt" || lower === "quart" || lower === "qts") return "qt";
  return lower.length ? lower : "each";
}

function getUnitName(
  unitType: string,
  unitsPerCase: number,
  unitSize: number,
  innerSplit: boolean,
): string {
  if (isCountType(unitType) && unitType === "each" && unitsPerCase > 1 && unitSize === 1) return "units";
  if (isCountType(unitType) && unitsPerCase === 1 && unitSize === 1) return "each";
  if (unitType === "dozen") return "units";
  if (innerSplit && (isWeightType(unitType) || isVolumeType(unitType))) return "packs";
  if (isWeightType(unitType) || isVolumeType(unitType)) {
    if (unitsPerCase === 1) return "each";
    return "packs";
  }
  return "units";
}

function getMeasureName(unitType: string): string {
  const u = unitType;
  if (u === "lb" || u === "#") return "lbs";
  if (u === "fl_oz") return "fl oz";
  if (u === "oz") return "oz";
  if (u === "gal") return "gals";
  if (u === "l") return "L";
  if (u === "ml") return "mL";
  if (u === "kg") return "kg";
  if (u === "g") return "g";
  if (u === "dozen") return "dozen";
  if (u === "pt") return "pts";
  if (u === "qt") return "qts";
  if (u === "each") return "each";
  return u;
}

function parseNumberToken(m: string): number | null {
  const n = parseFloat(m.replace(/,/g, ""));
  if (!Number.isFinite(n) || n < 0) return null;
  return n;
}

const RE_SLASH = /^(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)\s+(.+)$/i;
const RE_SLASH_COMPACT = /^(\d+(?:\.\d+)?)\/(\d+(?:\.\d+)?)([A-Za-z#°]+)(?:\b|$)/i;
const RE_NUM_THEN_UNIT = /^(\d+(?:\.\d+)?)\s*([#°]?[A-Za-z](?:[A-Za-z0-9%.-]*[A-Za-z0-9%])?)\s*$/i;
const RE_NUM_THEN_SHORT_UNIT = /^(\d+(?:\.\d+)?)\s*([#g])\s*$/i;
const RE_CASE_OF = /^(?:case|cs|ct)\s*(?:of)?\s*(\d+(?:\.\d+)?)(?:\s*\/\s*(\d+(?:\.\d+)?))?\s*(.*)$/i;
const RE_LEADING_NUM = /^(\d+(?:\.\d+)?)(?:\s*[-–xX]\s*(\d+(?:\.\d+)?))?\s*(.*)$/i;
const RE_COUNT_N_CT = /^(\d+(?:\.\d+)?)\s*(CT|COUNT|CT\.|PC|PK|BTL|BOTTLES?)\s*$/i;
const RE_PACK = /^(\d+)\s*PKG?s?\b|^(\d+)pk\b|\bpk\s*(\d+)/i;

function extractUnitString(rest: string): { unitRaw: string; rest: string } {
  const t = rest.trim();
  if (!t) return { unitRaw: "", rest: "" };
  if (/^#/.test(t)) return { unitRaw: "#", rest: t.slice(1).trim() };
  const m = t.match(
    /^(#°?(?:[A-Za-z%]+(?:\s+[A-Za-z%]+)*|[A-Za-z][A-Za-z0-9%]*))(?:[,\s].*)?$/i,
  );
  if (m) {
    const u = m[1].replace(/\s+/g, " ");
    return { unitRaw: u, rest: t.slice(m[0]!.length).trim() };
  }
  const m2 = t.match(/^([A-Za-z#]+)/);
  return { unitRaw: m2 ? m2[1]! : "", rest: t.slice(m2 ? m2[1]!.length : 0).trim() };
}

function tryParse(packSize: string): PackStructure | null {
  const raw = packSize;
  const s = packSize;
  const upper = s.toUpperCase();

  if (
    /^EACH$|^EACH\.$|^(EA|UNIT)S?$|^1\s*EACH$|^1\s*EA$/i.test(s) ||
    /^\bEA\b$/i.test(s) ||
    /^EACH$/i.test(s)
  ) {
    return ok(raw, { unitsPerCase: 1, unitSize: 1, unitType: "each" });
  }

  if (/^COUNT$/i.test(s)) {
    return ok(raw, { unitsPerCase: 1, unitSize: 1, unitType: "each" });
  }

  if (!/\d+\s*\/\s*\d+/.test(s) && /DOZ|DZN/i.test(s)) {
    if (/^DOZ(?:EN)?$|^DZN$/i.test(s.trim())) {
      return ok(raw, { unitsPerCase: 12, unitSize: 1, unitType: "each" });
    }
    const mDozen = s.match(/^(\d+(?:\.\d+)?)\s*DOZ(?:EN)?\s*$/i);
    if (mDozen) {
      const n = parseNumberToken(mDozen[1]!);
      if (n) return ok(raw, { unitsPerCase: 12 * n, unitSize: 1, unitType: "each" });
    }
  }

  const mPack = s.match(RE_PACK);
  if (mPack) {
    const n = parseInt(mPack[1] || mPack[2] || mPack[3] || "0", 10);
    if (n > 0) return ok(raw, { unitsPerCase: n, unitSize: 1, unitType: "each" });
  }

  let m = s.match(RE_CASE_OF);
  if (m) {
    const a = parseNumberToken(m[1]!);
    if (a) {
      if (m[2]) {
        const b = parseNumberToken(m[2]!);
        const rest3 = (m[3] || "").trim();
        if (b && rest3) {
          const { unitRaw: uu } = extractUnitString(rest3);
          if (uu) {
            const ut = normalizeUnitType(uu);
            return ok(raw, {
              unitsPerCase: a,
              unitSize: b,
              unitType: ut,
              innerPack: true,
              isWeightBased: isWeightType(ut),
            });
          }
        }
        const ut = normalizeUnitType((m[3] || "each").trim() || "each");
        return ok(raw, { unitsPerCase: a, unitSize: b!, unitType: ut, innerPack: true });
      }
      const rest = (m[3] || "").trim();
      if (!rest) {
        return ok(raw, { unitsPerCase: 1, unitSize: a, unitType: "each" });
      }
      const { unitRaw } = extractUnitString(rest);
      if (unitRaw) {
        const ut = normalizeUnitType(unitRaw);
        return ok(raw, { unitsPerCase: a, unitSize: 1, unitType: ut });
      }
    }
  }

  m = s.match(RE_SLASH);
  if (m) {
    const a = parseNumberToken(m[1]!);
    const b = parseNumberToken(m[2]!);
    const { unitRaw } = extractUnitString(m[3] || "");
    if (a && b && unitRaw) {
      const ut = normalizeUnitType(unitRaw);
      return ok(raw, { unitsPerCase: a, unitSize: b, unitType: ut, innerPack: true, isWeightBased: isWeightType(ut) });
    }
  }

  m = s.match(RE_SLASH_COMPACT);
  if (m) {
    const a = parseNumberToken(m[1]!);
    const b = parseNumberToken(m[2]!);
    const uTok = m[3] || "";
    if (a && b && uTok) {
      const ut = normalizeUnitType(uTok);
      return ok(raw, { unitsPerCase: a, unitSize: b, unitType: ut, innerPack: true, isWeightBased: isWeightType(ut) });
    }
  }

  m = s.match(RE_COUNT_N_CT);
  if (m) {
    const n = parseNumberToken(m[1]!);
    if (n) return ok(raw, { unitsPerCase: n, unitSize: 1, unitType: "each" });
  }

  if (/^CS\s+\d+\s*\/\s*\d+\s*LBS?$/i.test(s) || /^CS\s+\d+\s*\/\s*\d+\s*LB?$/i.test(s)) {
    const inner = s.match(/CS\s+(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)\s*(LBS?|LB)?/i);
    if (inner) {
      const a = parseNumberToken(inner[1]!);
      const b = parseNumberToken(inner[2]!);
      if (a && b) {
        return ok(raw, { unitsPerCase: a, unitSize: b, unitType: "lb", innerPack: true, isWeightBased: true });
      }
    }
  }

  m = s.match(/^(\d+(?:\.\d+)?)\s*\/\s*cs$/i);
  if (m) {
    const n = parseNumberToken(m[1]!);
    if (n) return ok(raw, { unitsPerCase: n, unitSize: 1, unitType: "each" });
  }

  m = s.match(/^(\d+(?:\.\d+)?)\s*\/\s*case$/i);
  if (m) {
    const n = parseNumberToken(m[1]!);
    if (n) return ok(raw, { unitsPerCase: n, unitSize: 1, unitType: "each" });
  }

  m = s.match(/^(?:(\d+(?:\.\d+)?)\s*)\/\s*CS$/i);
  if (m && m[1]) {
    const n = parseNumberToken(m[1]);
    if (n) return ok(raw, { unitsPerCase: n, unitSize: 1, unitType: "each" });
  }

  m = s.match(/^(?:(\d+(?:\.\d+)?)\s*[-–xX]\s*(\d+(?:\.\d+)?))\s+(.+)$/i);
  if (m) {
    const a = parseNumberToken(m[1]!);
    const b = parseNumberToken(m[2]!);
    const { unitRaw } = extractUnitString(m[3] || "");
    if (a && b && unitRaw) {
      const ut = normalizeUnitType(unitRaw);
      return ok(raw, { unitsPerCase: 1, unitSize: a * b, unitType: ut, isWeightBased: isWeightType(ut) });
    }
  }

  m = s.match(RE_NUM_THEN_SHORT_UNIT);
  if (m) {
    const n = parseNumberToken(m[1]!);
    if (m[2] === "#" && n) {
      return ok(raw, { unitsPerCase: 1, unitSize: n, unitType: "lb", isWeightBased: true });
    }
    if (m[2] === "g" && n) {
      return ok(raw, { unitsPerCase: 1, unitSize: n, unitType: "g", isWeightBased: true });
    }
  }

  m = s.match(RE_NUM_THEN_UNIT);
  if (m) {
    const n = parseNumberToken(m[1]!);
    if (n) {
      const uTok = (m[2] || "").replace(/^#/, "#");
      if (uTok === "#" || /^lb$|^pound|^lbs?$/i.test(uTok)) {
        return ok(raw, { unitsPerCase: 1, unitSize: n, unitType: "lb", isWeightBased: true });
      }
      if (/^gal$/i.test(uTok)) {
        return ok(raw, { unitsPerCase: 1, unitSize: n, unitType: "gal" });
      }
      if (/^G$/i.test(uTok) && s.toLowerCase().endsWith(" g")) {
        return ok(raw, { unitsPerCase: 1, unitSize: n, unitType: "g", isWeightBased: true });
      }
      const ut = normalizeUnitType(uTok);
      if (isWeightType(ut) || isVolumeType(ut) || ut === "g" || (ut === "each" && n >= 1)) {
        if (ut === "each" && /CT|COUNT/i.test(upper) && n > 1) {
          return ok(raw, { unitsPerCase: n, unitSize: 1, unitType: "each" });
        }
        if (ut === "each" && n === 1) {
          return ok(raw, { unitsPerCase: 1, unitSize: 1, unitType: "each" });
        }
        if (isWeightType(ut) || isVolumeType(ut) || ut === "g") {
          return ok(raw, { unitsPerCase: 1, unitSize: n, unitType: ut, isWeightBased: isWeightType(ut) || ut === "g" });
        }
      }
    }
  }

  m = s.match(RE_LEADING_NUM);
  if (m) {
    const a = parseNumberToken(m[1]!);
    if (a && !m[2]) {
      const rest = (m[3] || "").trim();
      if (rest) {
        const { unitRaw } = extractUnitString(rest);
        if (unitRaw) {
          const ut = normalizeUnitType(unitRaw);
          if (isWeightType(ut) || isVolumeType(ut) || ut === "g") {
            return ok(raw, { unitsPerCase: 1, unitSize: a, unitType: ut, isWeightBased: isWeightType(ut) || ut === "g" });
          }
        }
      }
    }
  }

  m = s.match(/^\s*#?\s*(\d+(?:\.\d+)?)\s*#\s*$/i);
  if (m) {
    const n = parseNumberToken(m[1]!);
    if (n) return ok(raw, { unitsPerCase: 1, unitSize: n, unitType: "lb", isWeightBased: true });
  }

  m = s.match(/^\s*#?\s*(\d+(?:\.\d+)?)\s*#(?:\s*(bag|box|case|roll)s?)?/i);
  if (m) {
    const n = parseNumberToken(m[1]!);
    if (n) return ok(raw, { unitsPerCase: 1, unitSize: n, unitType: "lb", isWeightBased: true });
  }

  m = s.match(/^(\d+(?:\.\d+)?)\s*#$/i);
  if (m) {
    const n = parseNumberToken(m[1]!);
    if (n) return ok(raw, { unitsPerCase: 1, unitSize: n, unitType: "lb", isWeightBased: true });
  }

  if (upper.includes("EACH") && /^\d/.test(s)) {
    const mm = s.match(/^(\d+(?:\.\d+)?)\s+.*EACH/i);
    if (mm) {
      const n = parseNumberToken(mm[1]!);
      if (n) return ok(raw, { unitsPerCase: n, unitSize: 1, unitType: "each" });
    }
  }

  return null;
}

export function parsePackSize(packSize: string): PackStructure {
  const rawInput = String(packSize ?? "");
  try {
    const collapsed = collapseSpaces(rawInput);
    if (collapsed.length === 0) {
      return fail(rawInput, "empty");
    }

    const result = tryParse(collapsed);
    if (result) return result;

    if (/^(?:N\/A|N\.A\.?|NONE|TBD|UNKNOWN|-|—)$/i.test(collapsed)) {
      return fail(rawInput, "unrecognized_token");
    }

    const collapsedUp = collapsed.toUpperCase();
    if (!/\d/.test(collapsed) && !/EACH|EA|UNIT|CT|CS|GAL|LB|L\b|ML|OZ|KG|DOZ|PK|GRAM/i.test(collapsed)) {
      if (/BAG|BOTTLE|JUG|TUB|ROLL|BOX|CASE(?!D)/i.test(collapsedUp)) {
        return ok(collapsed, { unitsPerCase: 1, unitSize: 1, unitType: "each" });
      }
      return fail(rawInput, "no_numeric_and_no_known_token");
    }

    if (!/\d/.test(collapsed) && /BAG|BOTTLE|JUG|TUB|ROLL|BOX|CASE(?!D)/i.test(collapsedUp)) {
      return ok(collapsed, { unitsPerCase: 1, unitSize: 1, unitType: "each" });
    }

    return fail(rawInput, "unparseable");
  } catch (e) {
    const err = e instanceof Error ? e.message : String(e);
    return { rawFormat: rawInput, ...DEFAULT, parseSuccess: false, parseError: err };
  }
}
