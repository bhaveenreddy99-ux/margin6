/** Owner-facing copy for the dashboard profit-risk hero (formerly “Money Lost”). */
export const PROFIT_RISK_HERO_TITLE = "Profit Risk Identified";
export const PROFIT_RISK_HERO_SUBTITLE =
  "Potential exposure this period — not realized loss. Tap any row for line detail, or View math for the full formula.";
export const PROFIT_RISK_EMPTY_TITLE = "No risk data yet";
export const PROFIT_RISK_EMPTY_SUBTITLE = "Upload your first invoice or log waste to start tracking exposure.";

export const PROFIT_RISK_ROW_WASTE = "Recorded waste";
export const PROFIT_RISK_ROW_PRICE = "Price increase impact";
export const PROFIT_RISK_ROW_OVERSTOCK = "Cash tied up above PAR";
export const PROFIT_RISK_ROW_SHRINKAGE = "Shrinkage alerts";

/**
 * Silent-$0 fix: when one or more Profit-Risk components fail to load, the
 * headline total is INCOMPLETE (failed terms contribute 0). Build a "(partial …)"
 * note so the total is never presented as a confident full number.
 *
 * @param erroredTitles display titles of the components that failed to load
 * @returns the note text (without parentheses), or null when nothing errored
 */
export function computeProfitRiskPartialNote(erroredTitles: readonly string[]): string | null {
  if (erroredTitles.length === 0) return null;
  if (erroredTitles.length === 1) return `partial — ${erroredTitles[0]} unavailable`;
  return `partial — ${erroredTitles.length} components unavailable`;
}

/** @deprecated Use PROFIT_RISK_* constants — kept for e2e migration grep. */
export const LEGACY_MONEY_LOST_TITLE = "Money Lost This Period";
