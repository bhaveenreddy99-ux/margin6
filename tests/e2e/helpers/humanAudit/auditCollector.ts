import type { AuditCheck, AuditReport } from "./types";
import {
  dashboardDollarsMatch,
  formatMoney,
  formatPct,
  isStrictAuditMode,
  numbersMatch,
  strictDollarsMatch,
} from "./parseNumbers";

export class HumanAuditCollector {
  private checks: AuditCheck[] = [];
  private meta: Omit<AuditReport, "checks" | "summary" | "generatedAt"> = {
    baseUrl: "",
    restaurantId: null,
    locationId: null,
    timeFilter: "this_week",
    dataSourceAvailable: false,
  };

  setMeta(partial: Partial<Omit<AuditReport, "checks" | "summary" | "generatedAt">>): void {
    this.meta = { ...this.meta, ...partial };
  }

  compareNumber(args: {
    page: string;
    label: string;
    uiValue: string;
    uiNumeric: number | null;
    expectedNumeric: number | null;
    sourceData: string;
    formula: string;
    tolerance?: number;
    useDashboardRounding?: boolean;
    sourceTables?: string;
    confidence?: AuditCheck["confidence"];
    lastUpdated?: string;
    coreKpi?: boolean;
  }): void {
    const expectedValue =
      args.expectedNumeric == null
        ? "—"
        : args.formula.includes("%")
          ? formatPct(args.expectedNumeric)
          : formatMoney(args.expectedNumeric);

    const strict = isStrictAuditMode();
    const pass = args.useDashboardRounding
      ? strict
        ? strictDollarsMatch(args.uiNumeric, args.expectedNumeric)
        : dashboardDollarsMatch(args.uiNumeric, args.expectedNumeric)
      : numbersMatch(args.uiNumeric, args.expectedNumeric, strict ? 0.01 : (args.tolerance ?? 1));

    this.checks.push({
      page: args.page,
      label: args.label,
      uiValue: args.uiValue || "—",
      uiNumeric: args.uiNumeric,
      sourceData: args.sourceData,
      sourceTables: args.sourceTables,
      formula: args.formula,
      expectedValue,
      expectedNumeric: args.expectedNumeric,
      pass,
      tolerance: strict ? 0.01 : args.tolerance,
      confidence: args.confidence,
      lastUpdated: args.lastUpdated,
    });
  }

  compareExact(args: {
    page: string;
    label: string;
    uiValue: string;
    expectedValue: string;
    sourceData: string;
    formula: string;
  }): void {
    const pass = args.uiValue.trim() === args.expectedValue.trim();
    this.checks.push({
      page: args.page,
      label: args.label,
      uiValue: args.uiValue,
      uiNumeric: null,
      sourceData: args.sourceData,
      formula: args.formula,
      expectedValue: args.expectedValue,
      expectedNumeric: null,
      pass,
    });
  }

  skip(args: { page: string; label: string; reason: string; uiValue?: string }): void {
    this.checks.push({
      page: args.page,
      label: args.label,
      uiValue: args.uiValue ?? "—",
      uiNumeric: null,
      sourceData: "n/a",
      formula: "n/a",
      expectedValue: "—",
      expectedNumeric: null,
      pass: true,
      skipped: true,
      skipReason: args.reason,
    });
  }

  observe(args: {
    page: string;
    label: string;
    uiValue: string;
    sourceData: string;
    note: string;
  }): void {
    this.checks.push({
      page: args.page,
      label: args.label,
      uiValue: args.uiValue,
      uiNumeric: null,
      sourceData: args.sourceData,
      formula: args.note,
      expectedValue: "observation",
      expectedNumeric: null,
      pass: true,
      skipped: true,
      skipReason: "observation only",
    });
  }

  buildReport(): AuditReport {
    const passed = this.checks.filter((c) => c.pass && !c.skipped).length;
    const failed = this.checks.filter((c) => !c.pass && !c.skipped).length;
    const skipped = this.checks.filter((c) => c.skipped).length;
    return {
      generatedAt: new Date().toISOString(),
      ...this.meta,
      checks: this.checks,
      summary: {
        total: this.checks.length,
        passed,
        failed,
        skipped,
      },
    };
  }

  getFailedChecks(): AuditCheck[] {
    return this.checks.filter((c) => !c.pass && !c.skipped);
  }

  getSkippedCoreKpis(coreLabels: readonly string[]): AuditCheck[] {
    return this.checks.filter(
      (c) => c.skipped && coreLabels.some((label) => c.label.includes(label) || c.label === label),
    );
  }
}

export function logCheck(check: AuditCheck): void {
  const status = check.skipped ? "SKIP" : check.pass ? "PASS" : "FAIL";
  // eslint-disable-next-line no-console
  console.log(
    `[${status}] ${check.page} · ${check.label}\n` +
      `  UI: ${check.uiValue}\n` +
      `  Expected: ${check.expectedValue}\n` +
      `  Source: ${check.sourceData}\n` +
      `  Formula: ${check.formula}` +
      (check.skipReason ? `\n  Note: ${check.skipReason}` : ""),
  );
}
