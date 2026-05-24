import { format } from "date-fns";
import { formatNum } from "@/lib/inventory-utils";
import { normalizeItemName } from "@/domain/inventory/items/itemView";
import type { InventorySessionItemRow } from "@/domain/inventory/enterInventoryTypes";

/**
 * Main grid row (laptop): inline count toggles + input; no always-visible conversion block.
 * Zone strip, when present, is an extra row below.
 */
export const DESKTOP_COUNT_ROW_HEIGHT = 48;

/** Extra vertical space for per-section zone qty strip under the row (desktop virtual list). */
export const DESKTOP_ZONE_STRIP_HEIGHT = 36;

export function desktopSessionRowHeight(zoneStripEnabled: boolean): number {
  return DESKTOP_COUNT_ROW_HEIGHT + (zoneStripEnabled ? DESKTOP_ZONE_STRIP_HEIGHT : 0);
}
export const DESKTOP_CATEGORY_LIST_MAX_HEIGHT = 560;
export const MOBILE_COUNT_CARD_HEIGHT = 268;

/**
 * SHARED desktop inventory count grid template — single source of truth.
 *
 * Used by EVERY row type on the desktop count table:
 *   - the column header
 *   - the category divider (spans 1 / -1)
 *   - the normal item rows (InventorySessionDesktopItemRows)
 *   - the virtualized item rows (VirtualizedDesktopCategoryBody)
 *
 * Columns:  ITEM | UNIT/SIZE | PAR | PRICE | COUNT | NEED
 */
export const INVENTORY_COUNT_GRID_TEMPLATE =
  "1.4fr 0.55fr 0.4fr 0.55fr 0.9fr 0.45fr";

/** Phone: Item | Count | Need */
export const INVENTORY_COUNT_PHONE_GRID_TEMPLATE = "1fr 0.55fr 0.4fr";

/** Sum of column minimums — table scrolls horizontally below this on narrow viewports */
export const INVENTORY_COUNT_MIN_WIDTH = 720;

/**
 * @deprecated Kept only to avoid touching legacy callers in one shot —
 * always returns INVENTORY_COUNT_GRID_TEMPLATE.
 */
export function getLaptopInventoryGridTemplate(_parColumnVisible: boolean): string {
  return INVENTORY_COUNT_GRID_TEMPLATE;
}

export function formatSessionRowDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  try {
    return format(new Date(iso), "EEE, MM/dd/yy");
  } catch {
    return "—";
  }
}

export function formatLastOrdered(date: string | null): string {
  if (!date) return "—";
  try {
    return format(new Date(date), "MM/dd/yy");
  } catch {
    return "—";
  }
}

const PACK_NUM_REGEX = /(\d+(?:\.\d+)?)/;

/**
 * Human-readable pack line for the count sheet (e.g. "40 lb/case", "6/case").
 * Uses the first numeric literal in `pack_size` plus `unit` when present.
 */
export function formatPackSize(item: Pick<InventorySessionItemRow, "pack_size" | "unit">): string {
  const raw = item.pack_size?.trim() ?? "";
  if (!raw) return "";

  const m = raw.match(PACK_NUM_REGEX);
  const numStr = m?.[1] ?? null;
  if (!numStr) return "";

  const uRaw = (item.unit || "").trim();
  const uUpper = uRaw.toUpperCase();

  if (uUpper === "LBS" || uUpper === "LB" || uRaw === "lb") {
    return `${numStr} lb/case`;
  }
  if (uUpper === "EA" || uUpper === "EACH") {
    return `${numStr}/case`;
  }

  if (!uRaw) {
    const rest = raw.replace(/^\D*\d+(?:\.\d+)?\s*/i, "").trim();
    if (rest) {
      return `${numStr} ${rest}/case`;
    }
    return `${numStr}/case`;
  }

  return `${numStr} ${uRaw}/case`;
}

export function resolveCountingParDisplay(
  item: InventorySessionItemRow,
  parColumnVisible: boolean,
  countingParGuideId: string | null,
  countingParByCatalogId: Record<string, number>,
  countingParByNormalizedName: Record<string, number>,
): number | null {
  if (!parColumnVisible || !countingParGuideId) return null;
  if (item.catalog_item_id && countingParByCatalogId[item.catalog_item_id] !== undefined) {
    return countingParByCatalogId[item.catalog_item_id];
  }
  const key = normalizeItemName(item.item_name);
  if (key && countingParByNormalizedName[key] !== undefined) {
    return countingParByNormalizedName[key];
  }
  return null;
}

export function formatParColumnCell(
  item: InventorySessionItemRow,
  parColumnVisible: boolean,
  countingParGuideId: string | null,
  countingParByCatalogId: Record<string, number>,
  countingParByNormalizedName: Record<string, number>,
): string {
  const value = resolveCountingParDisplay(
    item,
    parColumnVisible,
    countingParGuideId,
    countingParByCatalogId,
    countingParByNormalizedName,
  );
  return value === null ? "—" : formatNum(value);
}
