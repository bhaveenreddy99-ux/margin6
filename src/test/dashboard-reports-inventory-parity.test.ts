import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const srcRoot = resolve(process.cwd(), "src");

/**
 * Pins that Dashboard inventory KPIs derive session snapshot + trend from
 * `loadInventoryMetrics`, so session ordering and valuation stay centralized.
 */
describe("Dashboard inventory loader wiring", () => {
  it("Dashboard loads inventory KPIs through loadInventoryMetrics", () => {
    const dashboard = readFileSync(resolve(srcRoot, "pages/app/Dashboard.tsx"), "utf8");
    expect(dashboard).toContain("loadInventoryMetrics");
    expect(dashboard).not.toMatch(/\.from\("inventory_sessions"\)/);
  });

  it("useDashboardData loads inventory through loadInventoryMetrics", () => {
    const hook = readFileSync(resolve(srcRoot, "hooks/useDashboardData.ts"), "utf8");
    expect(hook).toContain("loadInventoryMetrics");
  });
});
