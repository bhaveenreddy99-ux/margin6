import { type ReactNode } from "react";
import { CountItemIdentityLines } from "@/features/inventory-count/components/CountItemIdentityLines";
import { CountSpeedCell } from "@/features/inventory-count/components/CountSpeedCell";
import { resolveSessionItemUnitPrice } from "@/domain/inventory/display/itemUnitPrice";
import {
  INVENTORY_COUNT_GRID_TEMPLATE,
  INVENTORY_COUNT_PHONE_GRID_TEMPLATE,
} from "@/domain/inventory/display/sessionDisplayHelpers";
import type { InventoryCatalogItemRow, InventorySessionItemRow } from "@/domain/inventory/enterInventoryTypes";
import type { ZoneStripConfig } from "@/features/inventory-count/types/inventorySessionDesktopCategoryListTypes";
import {
  countNeedBadge,
  countRowSurfaceClass,
  getCountRowRisk,
  isLastPurchaseRecent,
} from "@/features/inventory-count/utils/countRowState";
import { formatCurrency, formatNum } from "@/lib/inventory-utils";
import { cn } from "@/lib/utils";
import type { SaveStockWithConversionPayload } from "@/features/inventory-count/hooks/useItemCommands";
import type { KeyboardEvent, MutableRefObject } from "react";

const HEADER_CELL =
  "flex items-center justify-center border-r border-border/40 px-2 py-2 text-[9px] font-medium uppercase tracking-[0.12em] text-muted-foreground/80 last:border-r-0";

export type InventorySessionDesktopItemRowsProps = {
  categoryLabel: string;
  catItems: InventorySessionItemRow[];
  globalIndexByItemId: Map<string, number>;
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
  renderRowActionsMenu?: (item: InventorySessionItemRow) => ReactNode;
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
  /** Phone: hide PAR/Price/UnitSize columns */
  phoneCompact?: boolean;
  hideCategoryHeaders?: boolean;
  inputResetKey?: number;
};

export function formatParCell(parValue: number): string {
  if (!Number.isFinite(parValue) || parValue <= 0) return "—";
  return formatNum(parValue);
}

export function InventoryCountTableHeader({ phoneCompact = false }: { phoneCompact?: boolean }) {
  if (phoneCompact) {
    return (
      <div
        role="row"
        className="grid items-stretch bg-[#f5f5f5] border-b-[1.5px] border-border/70"
        style={{ gridTemplateColumns: INVENTORY_COUNT_PHONE_GRID_TEMPLATE }}
      >
        <div role="columnheader" className={cn(HEADER_CELL, "justify-start pl-3")}>Item</div>
        <div role="columnheader" className={HEADER_CELL}>Count</div>
        <div role="columnheader" className={HEADER_CELL}>Need</div>
      </div>
    );
  }
  return (
    <div
      role="row"
      className="grid items-stretch bg-[#f5f5f5] border-b-[1.5px] border-border/70"
      style={{ gridTemplateColumns: INVENTORY_COUNT_GRID_TEMPLATE }}
    >
      <div role="columnheader" className={cn(HEADER_CELL, "justify-start pl-3")}>Item</div>
      <div role="columnheader" className={HEADER_CELL}>Unit/Size</div>
      <div role="columnheader" className={HEADER_CELL}>PAR</div>
      <div role="columnheader" className={HEADER_CELL}>Price</div>
      <div role="columnheader" className={HEADER_CELL}>Count</div>
      <div role="columnheader" className={HEADER_CELL}>Need</div>
    </div>
  );
}

export function InventoryCountCategoryDivider({
  label,
  total,
  counted,
}: {
  label: string;
  total: number;
  counted: number;
}) {
  return (
    <div
      role="row"
      className="sticky z-10 flex items-center justify-between border-l-4 border-[#f97316] bg-[#fff3eb] px-3.5 py-[5px]"
      style={{ top: "var(--count-sticky-cat, 140px)" }}
    >
      <span className="text-[10px] font-medium uppercase tracking-[0.07em] text-[#c2410c]">
        {label}
      </span>
      <span className="text-[10px] font-medium text-[#9a3412] tabular-nums">
        {counted} / {total} counted
      </span>
    </div>
  );
}

function unitTypeLabel(unit: string | null | undefined): string {
  const u = (unit || "CS").trim().toUpperCase();
  if (u === "LB" || u === "LBS") return "LB";
  if (u === "EA" || u === "EACH") return "EA";
  return u.slice(0, 4) || "CS";
}

export function InventorySessionDesktopItemRows(p: InventorySessionDesktopItemRowsProps) {
  const {
    categoryLabel,
    catItems,
    globalIndexByItemId,
    isCountingEditable,
    onUpdateStock,
    onSaveStock,
    onKeyDown,
    inputRefs,
    getProductNumber,
    getLastOrderDate,
    renderRowActionsMenu,
    getApprovedPar,
    catalogById,
    phoneCompact = false,
    inputResetKey = 0,
  } = p;

  return (
    <>
      {catItems.map((item) => {
        const globalIdx = globalIndexByItemId.get(item.id) ?? 0;
        const rowPar = getApprovedPar(item);
        const risk = getCountRowRisk({ currentStock: item.current_stock, par: rowPar });
        const need = countNeedBadge({
          currentStock: item.current_stock,
          par: rowPar,
          unit: item.unit,
          packSize: item.pack_size,
        });
        const cat = item.catalog_item_id ? (catalogById[item.catalog_item_id] ?? null) : null;
        const unitPrice = resolveSessionItemUnitPrice(item, cat);
        const lastIso = getLastOrderDate(item.item_name);
        const lastRecent = isLastPurchaseRecent(lastIso);
        const packLine = item.pack_size?.trim() || "—";
        const unitLine = unitTypeLabel(item.unit);

        if (phoneCompact) {
          return (
            <div
              key={item.id}
              role="row"
              className={cn(
                "grid items-center border-b border-border/30 min-h-[56px]",
                countRowSurfaceClass(risk),
              )}
              style={{ gridTemplateColumns: INVENTORY_COUNT_PHONE_GRID_TEMPLATE }}
            >
              <div role="cell" className="pl-3 pr-2 py-2 min-w-0">
                <CountItemIdentityLines
                  item={item}
                  catalog={cat}
                  getProductNumber={getProductNumber}
                />
              </div>
              <div role="cell" className="flex justify-center py-1">
                <CountSpeedCell
                  item={item}
                  rowPar={rowPar}
                  isCountingEditable={isCountingEditable}
                  onUpdateStock={onUpdateStock}
                  onSaveStock={onSaveStock}
                  onKeyDown={(e) => onKeyDown(e, globalIdx, "stock")}
                  globalIndex={globalIdx}
                  inputRef={(el) => { inputRefs.current[item.id] = el; }}
                  inputResetKey={inputResetKey}
                />
              </div>
              <div role="cell" className="flex justify-center py-2">
                <span className={need.className}>{need.text}</span>
              </div>
            </div>
          );
        }

        return (
          <div
            key={item.id}
            role="row"
            className={cn(
              "grid items-center border-b border-border/30 min-h-[52px] relative group",
              countRowSurfaceClass(risk),
            )}
            style={{ gridTemplateColumns: INVENTORY_COUNT_GRID_TEMPLATE }}
          >
            <div role="cell" className="pl-3 pr-2 py-2 min-w-0 flex items-center gap-1">
              <div className="min-w-0 flex-1">
                <CountItemIdentityLines
                  item={item}
                  catalog={cat}
                  getProductNumber={getProductNumber}
                  showLastOrdered
                  lastIso={lastIso}
                  lastRecent={lastRecent}
                />
              </div>
              {renderRowActionsMenu ? (
                <div className="opacity-0 group-hover:opacity-100 shrink-0">
                  {renderRowActionsMenu(item)}
                </div>
              ) : null}
            </div>

            <div role="cell" className="flex flex-col items-center justify-center py-2 text-center">
              <span className="text-xs text-muted-foreground">{packLine}</span>
              <span className="text-[10px] text-muted-foreground/70 mt-0.5">{unitLine}</span>
            </div>

            <div role="cell" className="flex items-center justify-center text-xs text-muted-foreground tabular-nums">
              {formatParCell(rowPar)}
            </div>

            <div role="cell" className="flex items-center justify-center text-xs text-muted-foreground tabular-nums">
              {unitPrice != null ? formatCurrency(unitPrice) : "—"}
            </div>

            <div role="cell" className="flex justify-center py-1">
              <CountSpeedCell
                item={item}
                rowPar={rowPar}
                isCountingEditable={isCountingEditable}
                onUpdateStock={onUpdateStock}
                onSaveStock={onSaveStock}
                onKeyDown={(e) => onKeyDown(e, globalIdx, "stock")}
                globalIndex={globalIdx}
                inputRef={(el) => { inputRefs.current[item.id] = el; }}
                inputResetKey={inputResetKey}
              />
            </div>

            <div role="cell" className="flex items-center justify-center py-2">
              <span className={need.className}>{need.text}</span>
            </div>
          </div>
        );
      })}
    </>
  );
}

/** @deprecated use StatusPill from risk utils if needed elsewhere */
export function StatusPill() {
  return null;
}
