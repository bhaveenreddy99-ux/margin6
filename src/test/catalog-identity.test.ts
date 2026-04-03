import { describe, it, expect } from "vitest";
import { buildCatalogIdentityKey, normalizeItemName } from "@/lib/catalog-identity";

describe("catalog-identity", () => {
  it("normalizes names", () => {
    expect(normalizeItemName("  Foo BAR  ")).toBe("foo bar");
    expect(normalizeItemName(null)).toBe("");
  });

  it("prefers catalog id in keys", () => {
    expect(buildCatalogIdentityKey("uuid-1", "Any Name")).toBe("catalog:uuid-1");
  });

  it("falls back to name when no id", () => {
    expect(buildCatalogIdentityKey(null, "Sugar")).toBe("name:sugar");
    expect(buildCatalogIdentityKey(undefined, "")).toBe(null);
  });
});
