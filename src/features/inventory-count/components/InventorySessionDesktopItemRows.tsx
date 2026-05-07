import { type ReactNode } from "react";
import { CountSheetItemStockField } from "@/features/inventory-count/components/CountSheetItemStockField";
import { resolveSessionItemUnitPrice } from "@/domain/inventory/display/itemUnitPrice";
import { INVENTORY_COUNT_GRID_TEMPLATE } from "@/domain/inventory/display/sessionDisplayHelpers";
import type { InventoryCatalogItemRow, InventorySessionItemRow } from "@/domain/inventory/enterInventoryTypes";
import type { ZoneStripConfig } from "@/features/inventory-count/types/inventorySessionDesktopCategoryListTypes";
import {
  computeOrderQty,
  formatCurrency,
  formatNum,
  getRisk,
  type RiskThresholds,
} from "@/lib/inventory-utils";
import type { SaveStockWithConversionPayload } from "@/features/inventory-count/hooks/useItemCommands";
import type { KeyboardEvent, MutableRefObject } from "react";

/* ─── Status pill ─── */
export function StatusPill({ risk, needQty }: { risk: ReturnType<typeof getRisk>; needQty: number | null }) {
  if (risk.level === "NO_PAR")
    return (
      <span style={{
        display: "inline-flex", alignItems: "center",
        borderRadius: 4, padding: "2px 6px",
        fontSize: 10, fontWeight: 500,
        background: "hsl(var(--muted) / 0.6)",
        color: "hsl(var(--muted-foreground) / 0.7)",
      }}>No PAR</span>
    );
  if (risk.level === "RED")
    return (
      <span style={{
        display: "inline-flex", alignItems: "center", gap: 5,
        borderRadius: 5, padding: "2px 8px",
        fontSize: 11, fontWeight: 700, whiteSpace: "nowrap",
        background: "rgb(254 226 226)", color: "rgb(185 28 28)",
      }}>
        <span style={{ height: 6, width: 6, borderRadius: "50%", background: "rgb(239 68 68)", flexShrink: 0 }} />
        {needQty != null && needQty > 0 ? `Need ${needQty}` : "Critical"}
      </span>
    );
  if (risk.level === "YELLOW")
    return (
      <span style={{
        display: "inline-flex", alignItems: "center", gap: 5,
        borderRadius: 5, padding: "2px 8px",
        fontSize: 11, fontWeight: 700, whiteSpace: "nowrap",
        background: "rgb(254 243 199)", color: "rgb(180 83 9)",
      }}>
        <span style={{ height: 6, width: 6, borderRadius: "50%", background: "rgb(245 158 11)", flexShrink: 0 }} />
        Under PAR
      </span>
    );
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 5,
      borderRadius: 5, padding: "2px 8px",
      fontSize: 11, fontWeight: 700, whiteSpace: "nowrap",
      background: "rgb(209 250 229)", color: "rgb(6 95 70)",
    }}>
      <span style={{ height: 6, width: 6, borderRadius: "50%", background: "rgb(16 185 129)", flexShrink: 0 }} />
      At PAR
    </span>
  );
}

/* ──────────────────────────────────────────────────────────────────────────
   Per-cell padding/alignment constants — header AND row cells use these so
   columns stay locked together. Keep in sync with InventoryCountTableHeader.
   ────────────────────────────────────────────────────────────────────────── */
export const COUNT_CELL_BASE = "py-2 min-w-0";
export const COUNT_CELL_ITEM = `${COUNT_CELL_BASE} pl-4 pr-2`;          // ITEM — left
export const COUNT_CELL_PACK = `${COUNT_CELL_BASE} px-2`;                // PACK / SIZE — left
export const COUNT_CELL_PAR = `${COUNT_CELL_BASE} px-2 text-center`;    // PAR — centered, muted
export const COUNT_CELL_COUNT = `${COUNT_CELL_BASE} px-2 flex items-center justify-start`; // COUNT — left
export const COUNT_CELL_PRICE = `${COUNT_CELL_BASE} px-2 text-right`;    // PRICE — right
export const COUNT_CELL_STATUS = `${COUNT_CELL_BASE} px-2 flex items-center justify-center`; // STATUS — center
export const COUNT_CELL_ACTIONS = `py-2 flex items-center justify-center`;                  // ACTIONS — center, 48px col

export type InventorySessionDesktopItemRowsProps = {
  categoryLabel: string;
  catItems: InventorySessionItemRow[];
  globalIndexByItemId: Map<string, number>;
  riskThresholds: RiskThresholds;
  showParColumn: boolean;
  colSpan: number;
  simplifyCountingRow: boolean;
  isCountingEditable: boolean;
  onUpdateStock: (id: string, raw: string) => void;
  onSaveStock: (id: string, stock: number | null) => void | Promise<void>;
  onSaveStockWithConversion: (id: string, payload: SaveStockWithConversionPayload) => void | Promise<void>;
  sessionUserId: string | null;
  catalogById: Record<string, InventoryCatalogItemRow>;
  onKeyDown: (event: KeyboardEvent, index: number, field?: "stock") => void;
  inputRefs: MutableRefObject<Record<string, HTMLInputElement | null>>;
  formatParColumnCell: (item: InventorySessionItemRow) => string;
  getProductNumber: (item: InventorySessionItemRow) => string | null;
  getLastOrderDate: (name: string) => string | null;
  renderRowActionsMenu: (item: InventorySessionItemRow) => ReactNode;
  savingId: string | null;
  savedId: string | null;
  lastEditedId: string | null;
  getApprovedPar: (item: InventorySessionItemRow) => number;
  zoneStripEnabled: boolean;
  getZoneStripConfig: (item: InventorySessionItemRow) => ZoneStripConfig;
  getZoneStripDraftResetNonce: (itemId: string) => number;
  onCommitZoneCount: (
    item: InventorySessionItemRow,
    listCategoryId: string,
    qty: number,
    unit: string,
  ) => void | Promise<void>;
  canEditPar?: boolean;
};

/**
 * Formats the canonical PAR value (resolved by `getApprovedPar`, the same
 * value status/risk/reorder use). 0 or non-finite → em-dash.
 */
export function formatParCell(parValue: number): string {
  if (!Number.isFinite(parValue) || parValue <= 0) return "—";
  return formatNum(parValue);
}

/* ─── Shared header row ─── */
export function InventoryCountTableHeader() {
  return (
    <div
      role="row"
      className="grid items-center bg-muted/50 border-b-2 border-border/60 text-[10px] font-bold uppercase tracking-[0.1em] text-muted-foreground"
      style={{ gridTemplateColumns: INVENTORY_COUNT_GRID_TEMPLATE }}
    >
      <div role="columnheader" className={COUNT_CELL_ITEM}>Item</div>
      <div role="columnheader" className={COUNT_CELL_PACK}>Pack / Size</div>
      <div role="columnheader" className={COUNT_CELL_PAR}>PAR</div>
      <div role="columnheader" className={COUNT_CELL_COUNT}>Count</div>
      <div role="columnheader" className={COUNT_CELL_PRICE}>Price</div>
      <div role="columnheader" className={`${COUNT_CELL_STATUS} text-center`}>Status</div>
      <div role="columnheader" className={COUNT_CELL_ACTIONS}>{""}</div>
    </div>
  );
}

/* ─── Shared category divider row (spans all columns) ─── */
export function InventoryCountCategoryDivider({
  label,
  total,
  counted,
}: {
  label: string;
  total: number;
  counted: number;
}) {
  const pct = total > 0 ? Math.round((counted / total) * 100) : 0;
  return (
    <div
      role="row"
      className="border-y border-border/50"
    >
      <div
        role="cell"
        className="flex items-center justify-between border-l-[3px] border-primary bg-muted/35"
        style={{ padding: "8px 20px" }}
      >
        <div className="flex items-center gap-2.5">
          <span className="text-[11px] font-bold uppercase tracking-[0.1em] text-foreground/80">{label}</span>
          <span className="rounded-full border border-border/50 bg-background px-2 py-px font-mono text-[10px] text-muted-foreground">
            {total}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <div className="h-1.5 w-24 overflow-hidden rounded-full bg-border/40">
            <div className="h-full rounded-full bg-emerald-500 transition-all duration-700" style={{ width: `${pct}%` }} />
          </div>
          <span className="font-mono text-[10px] tabular-nums text-muted-foreground">
            {counted} / {total}
          </span>
        </div>
      </div>
    </div>
  );
}

export function InventorySessionDesktopItemRows(p: InventorySessionDesktopItemRowsProps) {
  const {
    categoryLabel, catItems, globalIndexByItemId, riskThresholds,
    simplifyCountingRow, isCountingEditable,
    onUpdateStock, onSaveStock, onSaveStockWithConversion,
    sessionUserId, catalogById, onKeyDown, inputRefs,
    getProductNumber, renderRowActionsMenu,
    savingId, savedId, lastEditedId, getApprovedPar,
    zoneStripEnabled, getZoneStripConfig,
  } = p;

  return (
    <>
      {catItems.map((item, rowIndex) => {
        const globalIdx = globalIndexByItemId.get(item.id) ?? 0;
        const rowPar = getApprovedPar(item);
        const needQty = rowPar > 0 ? computeOrderQty(item.current_stock, rowPar, item.unit, item.pack_size) : null;
        const risk = getRisk(item.current_stock, rowPar, riskThresholds);
        const isRecentlyEdited = lastEditedId === item.id;
        const isCounted = item.current_stock != null && Number(item.current_stock) > 0;
        const sku = item.vendor_sku?.trim() || getProductNumber(item);
        const cat = item.catalog_item_id ? (catalogById[item.catalog_item_id] ?? null) : null;
        const unitPrice = resolveSessionItemUnitPrice(item, cat);
        const strip = zoneStripEnabled ? getZoneStripConfig(item) : null;

        const rowBg = isRecentlyEdited
          ? "hsl(var(--primary) / 0.05)"
          : isCounted
            ? "rgba(209,250,229,0.18)"
            : rowIndex % 2 === 1
              ? "hsl(var(--muted) / 0.04)"
              : "transparent";

        return (
          <div
            key={item.id}
            role="row"
            className="grid items-center border-b border-border/30 transition-colors hover:bg-muted/[0.18]"
            style={{
              gridTemplateColumns: INVENTORY_COUNT_GRID_TEMPLATE,
              background: rowBg,
              outline: isRecentlyEdited ? "1px solid hsl(var(--primary) / 0.25)" : "none",
            }}
          >
            {/* ITEM */}
            <div role="cell" className={COUNT_CELL_ITEM}>
              <div className="flex flex-col gap-0.5 min-w-0">
                <span className="truncate text-[13px] font-semibold leading-snug text-foreground">
                  {item.item_name}
                </span>
                <span className="truncate text-[10px] text-muted-foreground/65 leading-none">
                  {[item.vendor_name?.trim(), sku ? `#${sku}` : null].filter(Boolean).join(" · ")}
                </span>
              </div>
            </div>

            {/* PACK / SIZE */}
            <div role="cell" className={COUNT_CELL_PACK}>
              <span className="block truncate font-mono text-[11px] text-muted-foreground/75 whitespace-nowrap">
                {item.pack_size?.trim() || "—"}
              </span>
            </div>

            {/* PAR — canonical value from getApprovedPar; "—" when 0/missing */}
            <div role="cell" className={COUNT_CELL_PAR}>
              <span
                className={
                  rowPar > 0
                    ? "font-mono text-xs font-semibold tabular-nums text-foreground/80"
                    : "font-mono text-xs tabular-nums text-muted-foreground/60"
                }
              >
                {formatParCell(rowPar)}
              </span>
            </div>

            {/* COUNT — left-aligned per spec */}
            <div role="cell" className={COUNT_CELL_COUNT}>
              <CountSheetItemStockField
                item={item}
                variant="desktop"
                isCountingEditable={isCountingEditable}
                simplifyCountingRow={simplifyCountingRow}
                onUpdateStock={onUpdateStock}
                onSaveStock={onSaveStock}
                onKeyDown={onKeyDown}
                globalIndex={globalIdx}
                inputRef={(el) => { inputRefs.current[item.id] = el; }}
                savingId={savingId}
                savedId={savedId}
                compactTable
                countDensity="laptop"
                userId={sessionUserId}
                categoryKey={categoryLabel}
                catalogItem={cat}
                zoneCountingActive={!!(zoneStripEnabled && strip)}
                onSaveStockWithConversion={onSaveStockWithConversion}
                rowPar={rowPar}
              />
            </div>

            {/* PRICE — right-aligned */}
            <div role="cell" className={COUNT_CELL_PRICE}>
              <span className="font-mono text-xs tabular-nums text-muted-foreground">
                {unitPrice != null ? formatCurrency(unitPrice) : "—"}
              </span>
            </div>

            {/* STATUS — centered */}
            <div role="cell" className={COUNT_CELL_STATUS}>
              <StatusPill risk={risk} needQty={needQty} />
            </div>

            {/* ACTIONS — centered in 48px column */}
            <div role="cell" className={COUNT_CELL_ACTIONS} onClick={(e) => e.stopPropagation()}>
              {renderRowActionsMenu(item)}
            </div>
          </div>
        );
      })}
    </>
  );
}
