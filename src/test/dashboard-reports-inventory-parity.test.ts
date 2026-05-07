import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const srcRoot = resolve(process.cwd(), "src");

/**
 * Pins that Dashboard and Reports both derive inventory session snapshot + trend from
 * `loadInventoryMetrics`, so session ordering and valuation cannot drift between surfaces.
 */
describe("Dashboard vs Reports inventory loader parity", () => {
  it("Reports loads inventory KPIs through loadInventoryMetrics", () => {
    const reports = readFileSync(resolve(srcRoot, "pages/app/Reports.tsx"), "utf8");
    expect(reports).toContain("loadInventoryMetrics");
    expect(reports).not.toMatch(/\.from\("inventory_sessions"\)/);
  });

  it("useDashboardData loads inventory through loadInventoryMetrics", () => {
    const hook = readFileSync(resolve(srcRoot, "hooks/useDashboardData.ts"), "utf8");
    expect(hook).toContain("loadInventoryMetrics");
  });
});
