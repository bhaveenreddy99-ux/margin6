import type { WasteCostRowInput } from "@/domain/waste/recordedWasteValue";
import { dollarsForWasteRow } from "@/domain/waste/recordedWasteValue";

export type WasteDrilldownInput = WasteCostRowInput & {
  item_name: string | null;
  reason?: string | null;
  logged_at: string | null;
};

export type WasteDrilldownRow = {
  label: string;
  value: number;
  date: string;
  source: string;
};

/** Same row valuation as Dashboard `loadWasteMetrics` / `aggregateWasteRows`. */
export function buildWasteDrilldownRows(
  rows: WasteDrilldownInput[],
  catalogDefaultUnitById: ReadonlyMap<string, number>,
  sessionUnitByCatalogId: ReadonlyMap<string, number>,
  fmtDate: (value: string | null | undefined) => string,
): WasteDrilldownRow[] {
  return rows
    .map((row) => {
      const value = dollarsForWasteRow(row, catalogDefaultUnitById, sessionUnitByCatalogId);
      return {
        label: (row.item_name ?? "").trim() || "—",
        value,
        date: fmtDate(row.logged_at),
        source: row.reason ?? "waste",
      };
    })
    .filter((r) => r.value > 0)
    .sort((a, b) => b.value - a.value);
}
