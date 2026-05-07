import { describe, expect, it } from "vitest";
import {
  buildContextualCountSentence,
  buildConversionLines,
  convertToCases,
  formatConversionDisplay,
  getDisplayValue,
  getPackFromCatalogItem,
} from "./inventory-conversions";
import { parsePackSize } from "./pack-parser";

describe("convertToCases", () => {
  const pack65Lb = parsePackSize("6/5 Lb");
  const pack4Gal = parsePackSize("4/1 Gal");
  const pack24Ct = parsePackSize("24 CT");

  it("converts 5.5 cases to 5.5 cases (direct)", () => {
    const r = convertToCases({ value: 5.5, unit: "cases" }, pack65Lb);
    expect(r.casesValue).toBe(5.5);
    expect(r.formula).toBe("5.5 CS");
    expect(r.explanation).toBe("5.5 cases");
  });

  it("converts 33 bags (6/5 Lb) to 5.5 cases with audit strings", () => {
    const r = convertToCases({ value: 33, unit: "units" }, pack65Lb);
    expect(r.casesValue).toBe(5.5);
    expect(r.formula).toBe("33 bags ÷ 6 = 5.5 CS");
    expect(r.explanation).toBe("33 bags = 5.5 cases (165 lbs)");
  });

  it("converts 165 lbs (6/5 Lb) to 5.5 cases", () => {
    const r = convertToCases({ value: 165, unit: "weight" }, pack65Lb);
    expect(r.casesValue).toBe(5.5);
    expect(r.formula).toBe("165 lbs ÷ 30 lbs/case = 5.5 CS");
    expect(r.explanation).toBe("165 lbs = 5.5 cases (33 bags)");
  });

  it("converts 3 cases (4/1 Gal) to 3 cases", () => {
    const r = convertToCases({ value: 3, unit: "cases" }, pack4Gal);
    expect(r.casesValue).toBe(3);
    expect(r.formula).toBe("3 CS");
  });

  it("converts 12 bottles (4/1 Gal) to 3 cases", () => {
    const r = convertToCases({ value: 12, unit: "units" }, pack4Gal);
    expect(r.casesValue).toBe(3);
    expect(r.formula).toBe("12 bottles ÷ 4 = 3 CS");
  });

  it("converts 10 cases (24 CT) to 10 cases", () => {
    const r = convertToCases({ value: 10, unit: "cases" }, pack24Ct);
    expect(r.casesValue).toBe(10);
  });

  it("converts 240 items (24 CT) to 10 cases", () => {
    const r = convertToCases({ value: 240, unit: "units" }, pack24Ct);
    expect(r.casesValue).toBe(10);
    expect(r.formula).toBe("240 items ÷ 24 = 10 CS");
  });

  it("returns 0 cases for 0 input", () => {
    const r = convertToCases({ value: 0, unit: "units" }, pack24Ct);
    expect(r.casesValue).toBe(0);
    expect(r.formula).toBe("0 CS");
  });

  it("rounds to 2 decimal places (e.g. 5.33)", () => {
    const r = convertToCases({ value: 5.3333, unit: "cases" }, pack65Lb);
    expect(r.casesValue).toBe(5.33);
  });

  it("builds human-readable formula strings (÷, CS, /case)", () => {
    const r = convertToCases({ value: 33, unit: "units" }, pack65Lb);
    expect(r.formula).toMatch(/÷/);
    expect(r.formula).toMatch(/CS/);
    const w = convertToCases({ value: 100, unit: "weight" }, pack65Lb);
    expect(w.formula).toMatch(/\/case/);
  });
});

describe("formatConversionDisplay", () => {
  it("emits cases, sell units, and weight from cases value", () => {
    const pack = parsePackSize("6/5 Lb");
    const d = formatConversionDisplay(5.5, pack);
    expect(d.cases).toBe("5.5 CS");
    expect(d.units).toBe("33 bags");
    expect(d.weight).toBe("165 lbs");
  });
});

describe("buildConversionLines", () => {
  it("shows three lines for 5.5 cases (6/5 Lb)", () => {
    const pack = parsePackSize("6/5 Lb");
    const lines = buildConversionLines(5.5, pack);
    expect(lines.line1).toBe("5.5 cases");
    expect(lines.line2).toBe("= 33 bags");
    expect(lines.line3).toBe("= 165 lbs");
  });
});

describe("buildContextualCountSentence", () => {
  it("describes units count with per-case math", () => {
    const pack = parsePackSize("6/5 Lb");
    const s = buildContextualCountSentence({
      rawValue: 33,
      countMode: "units",
      pack,
      casesValue: 5.5,
    });
    expect(s).toBe("Counted 33 bags out of 6 per case = 5.5 cases");
  });

  it("describes weight count", () => {
    const pack = parsePackSize("6/5 Lb");
    const s = buildContextualCountSentence({
      rawValue: 165,
      countMode: "weight",
      pack,
      casesValue: 5.5,
    });
    expect(s).toBe("Counted 165 lbs out of 30 lbs per case = 5.5 cases");
  });

  it("describes direct cases", () => {
    const pack = parsePackSize("6/5 Lb");
    const s = buildContextualCountSentence({
      rawValue: 5.5,
      countMode: "cases",
      pack,
      casesValue: 5.5,
    });
    expect(s).toBe("Counted 5.5 cases");
  });
});

describe("getPackFromCatalogItem", () => {
  it("uses catalog columns when present", () => {
    const p = getPackFromCatalogItem({
      pack_size: "6/5 Lb",
      units_per_case: 6,
      unit_size: 5,
      unit_type: "lb",
      total_per_case: 30,
      pack_parse_success: true,
    });
    expect(p.unitsPerCase).toBe(6);
    expect(p.totalPerCase).toBe(30);
    expect(p.parseSuccess).toBe(true);
  });

  it("parses pack_size when pack fields missing", () => {
    const p = getPackFromCatalogItem({ pack_size: "24 CT" });
    expect(p.unitsPerCase).toBe(24);
  });
});

describe("getDisplayValue (legacy vs new)", () => {
  it("returns counted value when conversion audit is present", () => {
    expect(getDisplayValue({ current_stock: 5.5, counted_as: "units", counted_value: 33 })).toEqual({
      value: 33,
      unit: "units",
    });
  });

  it("treats current_stock as cases when audit columns absent", () => {
    expect(getDisplayValue({ current_stock: 7.25, counted_as: null, counted_value: null })).toEqual({
      value: 7.25,
      unit: "cases",
    });
  });
});
