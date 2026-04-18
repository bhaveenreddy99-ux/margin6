import type { DetailedPARRecommendation } from "@/lib/usage-analytics";

/** Uses existing suggestion `type` / `risk_type` from computeDetailedPARRecommendations — no new algorithm. */

export function isSuggestionMissingPar(s: DetailedPARRecommendation): boolean {
  return s.type === "missing_par" || s.risk_type === "missing_par";
}

/** Increase / usage trend / stockout risk → “likely too low” PAR vs recent usage. */
export function isSuggestionLikelyTooLow(s: DetailedPARRecommendation): boolean {
  if (isSuggestionMissingPar(s)) return false;
  return s.type === "increase" || s.type === "usage_trend" || s.risk_type === "stockout";
}

/** Decrease / overstock → “likely too high” PAR vs recent usage. */
export function isSuggestionLikelyTooHigh(s: DetailedPARRecommendation): boolean {
  return s.type === "decrease" || s.risk_type === "overstock";
}
