import fs from "node:fs";
import path from "node:path";
import type { AuditReport } from "./types";

const REPORT_BASENAME = "dashboard-trust-human-audit-report";

export function writeAuditReport(report: AuditReport, cwd = process.cwd()): { md: string; json: string } {
  const mdPath = path.resolve(cwd, `${REPORT_BASENAME}.md`);
  const jsonPath = path.resolve(cwd, `${REPORT_BASENAME}.json`);

  fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2), "utf8");
  fs.writeFileSync(mdPath, renderMarkdown(report), "utf8");

  return { md: mdPath, json: jsonPath };
}

function renderMarkdown(report: AuditReport): string {
  const lines: string[] = [
    "# Dashboard Trust — Human QA Audit",
    "",
    `Generated: ${report.generatedAt}`,
    `Base URL: ${report.baseUrl}`,
    `Restaurant: ${report.restaurantId ?? "unknown"}`,
    `Location: ${report.locationId ?? "all / unset"}`,
    `Time filter: ${report.timeFilter}`,
    `Live data source: ${report.dataSourceAvailable ? "yes (Supabase + domain formulas)" : "no — UI observations only"}`,
    "",
    "## Summary",
    "",
    `| Metric | Count |`,
    `|--------|------:|`,
    `| Total checks | ${report.summary.total} |`,
    `| Passed | ${report.summary.passed} |`,
    `| Failed | ${report.summary.failed} |`,
    `| Skipped / observation | ${report.summary.skipped} |`,
    "",
    "## Owner verification summary",
    "",
    "Use this section to confirm each dashboard number matches the database-backed formula.",
    "",
    "| Metric | UI value | Expected | Formula | Source tables | Pass | Confidence |",
    "|--------|----------|----------|---------|---------------|------|------------|",
  ];

  for (const check of report.checks) {
    if (check.skipped && check.skipReason === "observation only") continue;
    const pass = check.skipped ? "SKIP" : check.pass ? "PASS" : "**FAIL**";
    const ui = escapeMdCell(check.uiValue);
    const expected = escapeMdCell(check.expectedValue);
    const formula = escapeMdCell(check.formula);
    const tables = (check.sourceTables ?? check.sourceData).replace(/\|/g, "\\|");
    const confidence = check.confidence ?? "—";
    lines.push(
      `| ${check.label} | ${ui} | ${expected} | ${formula} | ${tables} | ${pass} | ${confidence} |`,
    );
  }

  lines.push(
    "",
    "## Detailed checks",
    "",
    "| Page | Label | UI | Expected | Pass | Source | Formula | Confidence |",
    "|------|-------|----|----------|------|--------|---------|------------|",
  );

  for (const check of report.checks) {
    const pass = check.skipped ? "SKIP" : check.pass ? "PASS" : "**FAIL**";
    const ui = escapeMdCell(check.uiValue);
    const expected = escapeMdCell(check.expectedValue);
    const source = escapeMdCell(check.sourceData);
    const formula = escapeMdCell(check.formula);
    const confidence = check.confidence ?? "—";
    lines.push(
      `| ${check.page} | ${check.label} | ${ui} | ${expected} | ${pass} | ${source} | ${formula} | ${confidence} |`,
    );
    if (check.skipReason) {
      lines.push(`| | _note_ | ${check.skipReason.replace(/\|/g, "\\|")} | | | | | |`);
    }
  }

  const failures = report.checks.filter((c) => !c.pass && !c.skipped);
  if (failures.length > 0) {
    lines.push("", "## Failures (detail)", "");
    for (const check of failures) {
      lines.push(
        `### ${check.page} — ${check.label}`,
        "",
        `- UI value: **${check.uiValue}**`,
        `- Expected: **${check.expectedValue}**`,
        `- Source data: ${check.sourceData}`,
        `- Source tables: ${check.sourceTables ?? "see source data"}`,
        `- Formula: ${check.formula}`,
        `- Confidence: ${check.confidence ?? "unknown"}`,
        "",
      );
    }
  }

  lines.push(
    "",
    "---",
    "",
    "Run: `E2E_EMAIL=... E2E_PASSWORD=... npm run test:e2e -- human-dashboard-trust-flow.spec.ts`",
    "",
    "Strict CI: `E2E_STRICT_AUDIT=1 E2E_SUPABASE_SERVICE_ROLE_KEY=... npm run test:e2e:human-audit`",
    "",
  );

  return lines.join("\n");
}

function escapeMdCell(value: string | undefined | null): string {
  return (value ?? "—").replace(/\|/g, "\\|");
}
