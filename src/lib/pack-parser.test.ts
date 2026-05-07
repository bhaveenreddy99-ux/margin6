import { describe, expect, it } from "vitest";
import { parsePackSize } from "./pack-parser";

describe("parsePackSize", () => {
  it('parses "6/5 Lb"', () => {
    const r = parsePackSize("6/5 Lb");
    expect(r.parseSuccess).toBe(true);
    expect(r.unitsPerCase).toBe(6);
    expect(r.unitSize).toBe(5);
    expect(r.unitType).toBe("lb");
    expect(r.totalPerCase).toBe(30);
  });

  it('parses "40 lb"', () => {
    const r = parsePackSize("40 lb");
    expect(r.parseSuccess).toBe(true);
    expect(r.unitsPerCase).toBe(1);
    expect(r.unitSize).toBe(40);
    expect(r.unitType).toBe("lb");
    expect(r.totalPerCase).toBe(40);
  });

  it('parses "24 CT"', () => {
    const r = parsePackSize("24 CT");
    expect(r.parseSuccess).toBe(true);
    expect(r.unitsPerCase).toBe(24);
    expect(r.unitSize).toBe(1);
    expect(r.unitType).toBe("each");
    expect(r.totalPerCase).toBe(24);
  });

  it('parses "EACH"', () => {
    const r = parsePackSize("EACH");
    expect(r.parseSuccess).toBe(true);
    expect(r.unitsPerCase).toBe(1);
    expect(r.unitSize).toBe(1);
    expect(r.unitType).toBe("each");
    expect(r.totalPerCase).toBe(1);
  });

  it('parses "4/1 Gal"', () => {
    const r = parsePackSize("4/1 Gal");
    expect(r.parseSuccess).toBe(true);
    expect(r.unitsPerCase).toBe(4);
    expect(r.unitSize).toBe(1);
    expect(r.unitType).toBe("gal");
    expect(r.totalPerCase).toBe(4);
  });

  it("parses Case of 6/5 LB (Sysco-style case pack)", () => {
    const r = parsePackSize("Case of 6/5 LB");
    expect(r.parseSuccess).toBe(true);
    expect(r.unitsPerCase).toBe(6);
    expect(r.unitSize).toBe(5);
    expect(r.unitType).toBe("lb");
  });

  it("parses 12/cs (cases per order)", () => {
    const r = parsePackSize("12/cs");
    expect(r.parseSuccess).toBe(true);
    expect(r.unitsPerCase).toBe(12);
    expect(r.unitSize).toBe(1);
    expect(r.unitType).toBe("each");
  });

  it("parses 2 x 2.5 gal (jug multiplier)", () => {
    const r = parsePackSize("2 x 2.5 gal");
    expect(r.parseSuccess).toBe(true);
    expect(r.unitsPerCase).toBe(1);
    expect(r.unitSize).toBe(5);
    expect(r.unitType).toBe("gal");
  });

  it("parses 50# (pound hash)", () => {
    const r = parsePackSize("50#");
    expect(r.parseSuccess).toBe(true);
    expect(r.unitsPerCase).toBe(1);
    expect(r.unitSize).toBe(50);
    expect(r.unitType).toBe("lb");
  });

  it("parses 1 DOZ (dozen count)", () => {
    const r = parsePackSize("1 DOZ");
    expect(r.parseSuccess).toBe(true);
    expect(r.unitsPerCase).toBe(12);
    expect(r.unitSize).toBe(1);
    expect(r.unitType).toBe("each");
  });

  it("parses 500 g (metric weight)", () => {
    const r = parsePackSize("500 g");
    expect(r.parseSuccess).toBe(true);
    expect(r.unitsPerCase).toBe(1);
    expect(r.unitSize).toBe(500);
    expect(r.unitType).toBe("g");
  });

  it("treats empty and whitespace as failed safe defaults", () => {
    expect(parsePackSize("").parseSuccess).toBe(false);
    expect(parsePackSize("   ").parseSuccess).toBe(false);
  });

  it("returns safe defaults for unparseable content without throwing", () => {
    const r = parsePackSize(";;;invalid;;;");
    expect(r.parseSuccess).toBe(false);
    expect(r.unitsPerCase).toBe(1);
    expect(r.unitSize).toBe(1);
    expect(r.unitType).toBe("each");
    expect(r.parseError).toBeDefined();
  });

  it("never throws", () => {
    expect(() => parsePackSize(null as unknown as string)).not.toThrow();
  });
});
