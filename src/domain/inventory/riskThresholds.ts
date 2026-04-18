import type { RiskThresholds } from "@/lib/inventory-utils";

/** Aligns DB `smart_order_settings` with `getRisk` options (same defaults as Settings UI). */
export function riskThresholdsFromSettings(
  row: { red_threshold?: number | null; yellow_threshold?: number | null } | null | undefined,
): RiskThresholds {
  return {
    redThresholdPercent: row?.red_threshold ?? 50,
    yellowThresholdPercent: row?.yellow_threshold ?? 100,
  };
}
