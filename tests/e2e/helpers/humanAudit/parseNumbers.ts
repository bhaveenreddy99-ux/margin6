/** Parse currency shown in UI ($1,234 or $1,234.56) to a number. */
export function parseMoneyText(raw: string | null | undefined): number | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (trimmed === "—" || trimmed === "-") return null;
  const pct = trimmed.endsWith("%");
  const cleaned = trimmed.replace(/[^0-9.-]/g, "");
  if (!cleaned) return null;
  const n = Number(cleaned);
  if (!Number.isFinite(n)) return null;
  return pct ? n : n;
}

export function parseIntegerText(raw: string | null | undefined): number | null {
  if (!raw) return null;
  const cleaned = raw.trim().replace(/[^0-9-]/g, "");
  if (!cleaned) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

export function formatMoney(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return `$${Math.round(n).toLocaleString("en-US")}`;
}

export function formatPct(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return `${n.toFixed(1)}%`;
}

export function numbersMatch(
  ui: number | null,
  expected: number | null,
  tolerance = 1,
): boolean {
  if (ui == null && expected == null) return true;
  if (ui == null || expected == null) return false;
  return Math.abs(ui - expected) <= tolerance;
}

/** Dashboard KPI cards round dollars to whole numbers. */
export function dashboardDollarsMatch(ui: number | null, expected: number | null): boolean {
  if (ui == null && expected == null) return true;
  if (ui == null || expected == null) return false;
  return Math.abs(Math.round(ui) - Math.round(expected)) <= 1;
}

/** Strict CI audit — fail when mismatch exceeds $0.01. */
export function strictDollarsMatch(ui: number | null, expected: number | null): boolean {
  if (ui == null && expected == null) return true;
  if (ui == null || expected == null) return false;
  return Math.abs(ui - expected) <= 0.01;
}

export function isStrictAuditMode(): boolean {
  return process.env.E2E_STRICT_AUDIT === "1" || process.env.E2E_STRICT_AUDIT === "true";
}
