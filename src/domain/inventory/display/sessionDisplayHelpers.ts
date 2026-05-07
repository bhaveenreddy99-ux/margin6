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
 * Laptop / wide desktop: ITEM | COUNT | PRICE | PAR? | NEED | STATUS | actions
 * Vendor and pack are shown as sub-text in the ITEM cell.
 * COUNT is the widest column — it holds the unit-type toggle + numeric input.
 */
export function getLaptopInventoryGridTemplate(parColumnVisible: boolean): string {
  if (parColumnVisible) {
    return [
      "minmax(150px,1.8fr)", // item ~22%
      "minmax(220px,3fr)",   // count ~37%
      "minmax(72px,0.8fr)",  // price ~10%
      "minmax(56px,0.7fr)",  // par ~8%
      "minmax(56px,0.7fr)",  // need ~8%
      "minmax(72px,0.8fr)",  // status ~10%
      "40px",                // kebab
    ].join(" ");
  }
  return [
    "minmax(150px,2fr)",    // item ~24%
    "minmax(220px,3.2fr)",  // count ~40%
    "minmax(72px,0.85fr)",  // price ~10%
    "minmax(56px,0.75fr)",  // need ~9%
    "minmax(72px,0.85fr)",  // status ~10%
    "40px",
  ].join(" ");
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
