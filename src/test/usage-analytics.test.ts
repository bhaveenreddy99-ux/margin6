import { describe, expect, it } from "vitest";
import { convertPurchaseQuantityToStockUnits } from "@/lib/usage-analytics";

describe("usage analytics quantity bridge", () => {
  it("converts case pack weights into stock weight units", () => {
    expect(convertPurchaseQuantityToStockUnits(2, "lb", "6/5 lb")).toBeCloseTo(60);
    expect(convertPurchaseQuantityToStockUnits(1, "lb", "64 oz")).toBeCloseTo(4);
  });

  it("converts pack counts into eaches", () => {
    expect(convertPurchaseQuantityToStockUnits(2, "ea", "12 ct")).toBeCloseTo(24);
    expect(convertPurchaseQuantityToStockUnits(3, "can", "6/#10 can")).toBeCloseTo(18);
  });

  it("falls back to the raw quantity when conversion is ambiguous", () => {
    expect(convertPurchaseQuantityToStockUnits(4, "lb", "case")).toBe(4);
    expect(convertPurchaseQuantityToStockUnits(4, "lb", "5 lb")).toBe(4);
    expect(convertPurchaseQuantityToStockUnits(2, null, "6/5 lb")).toBe(2);
  });
});
