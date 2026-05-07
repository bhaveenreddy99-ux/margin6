import { Fragment, type ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { TableCell, TableRow } from "@/components/ui/table";
import { SessionItemZoneCountStrip } from "@/features/inventory-count/components/SessionItemZoneCountStrip";
import { CountSheetItemStockField } from "@/features/inventory-count/components/CountSheetItemStockField";
import { formatLastOrdered as formatLastOrderedHelper } from "@/domain/inventory/enterInventoryHelpers";
import { resolveSessionItemUnitPrice } from "@/domain/inventory/display/itemUnitPrice";
import type { InventoryCatalogItemRow, InventorySessionItemRow } from "@/domain/inventory/enterInventoryTypes";
import type { ZoneStripConfig } from "@/features/inventory-count/types/inventorySessionDesktopCategoryListTypes";
import {
  computeOrderQty,
  formatCurrency,
  formatNum,
  getRisk,
  getRowBgClass,
  type RiskThresholds,
} from "@/lib/inventory-utils";
import { cn } from "@/lib/utils";
import type { SaveStockWithConversionPayload } from "@/features/inventory-count/hooks/useItemCommands";
import type { KeyboardEvent, MutableRefObject } from "react";
import { Lock } from "lucide-react";

function statusLabelForRow(risk: ReturnType<typeof getRisk>): string {
  if (risk.level === "NO_PAR") return "No PAR";
  if (risk.level === "RED") return "Critical";
  if (risk.level === "YELLOW") return "Low";
  return "OK";
}

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
  /** When false, show lock next to PAR (levels not editable at this location). */
  canEditPar?: boolean;
};

export function InventorySessionDesktopItemRows(p: InventorySessionDesktopItemRowsProps) {
  const {
    categoryLabel,
    catItems,
    globalIndexByItemId,
    riskThresholds,
    showParColumn,
    colSpan,
    simplifyCountingRow,
    isCountingEditable,
    onUpdateStock,
    onSaveStock,
    onSaveStockWithConversion,
    sessionUserId,
    catalogById,
    onKeyDown,
    inputRefs,
    formatParColumnCell,
    getProductNumber,
    getLastOrderDate,
    renderRowActionsMenu,
    savingId,
    savedId,
    lastEditedId,
    getApprovedPar,
    zoneStripEnabled,
    getZoneStripConfig,
    getZoneStripDraftResetNonce,
    onCommitZoneCount,
    canEditPar = true,
  } = p;

  return (
    <>
      {catItems.map((item) => {
        const globalIdx = globalIndexByItemId.get(item.id) ?? 0;
        const rowPar = getApprovedPar(item);
        const needQty =
          rowPar > 0 ? computeOrderQty(item.current_stock, rowPar, item.unit, item.pack_size) : null;
        const risk = getRisk(item.current_stock, rowPar, riskThresholds);
        const rowBg = getRowBgClass(item.current_stock);
        const isRecentlyEdited = lastEditedId === item.id;
        const strip = zoneStripEnabled ? getZoneStripConfig(item) : null;
        const zoneLine =
          strip && item.inventory_session_item_zones?.find((z) => z.list_category_id === strip.listCategoryId);
        const sku = item.vendor_sku?.trim() || getProductNumber(item);
        const cat = item.catalog_item_id ? (catalogById[item.catalog_item_id] ?? null) : null;
        const unitPrice = resolveSessionItemUnitPrice(item, cat);

        return (
          <Fragment key={item.id}>
            <TableRow
              className={cn(
                "border-b border-border/40 transition-colors hover:bg-muted/30",
                rowBg,
                isRecentlyEdited && "bg-blue-50/90 dark:bg-blue-950/25",
              )}
            >
              <TableCell className="align-middle py-2">
                <div className="flex min-w-0 flex-col gap-0.5">
                  <span className="truncate text-sm font-semibold leading-snug text-foreground">
                    {item.item_name}
                    {sku ? <span className="font-normal text-muted-foreground"> · #{sku}</span> : null}
                  </span>
                  <span className="truncate text-[10px] text-muted-foreground/70">
                    {[item.brand_name, item.vendor_name?.trim(), item.pack_size?.trim()]
                      .filter(Boolean)
                      .join(" · ") || <span className="opacity-0">—</span>}
                  </span>
                </div>
              </TableCell>
              <TableCell className="align-middle py-2">
                <div className="flex min-w-0 justify-center">
                  <CountSheetItemStockField
                    item={item}
                    variant="desktop"
                    isCountingEditable={isCountingEditable}
                    simplifyCountingRow={simplifyCountingRow}
                    onUpdateStock={onUpdateStock}
                    onSaveStock={onSaveStock}
                    onKeyDown={onKeyDown}
                    globalIndex={globalIdx}
                    inputRef={(el) => {
                      inputRefs.current[item.id] = el;
                    }}
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
              </TableCell>
              <TableCell className="align-middle py-2 text-right font-mono text-xs tabular-nums text-gray-700 dark:text-foreground/90">
                {unitPrice != null ? formatCurrency(unitPrice) : "—"}
              </TableCell>
              {showParColumn && (
                <TableCell className="align-middle py-2 text-right font-mono text-sm font-semibold tabular-nums">
                  <span className="inline-flex w-full items-center justify-end gap-1">
                    <span>{formatParColumnCell(item)}</span>
                    {!canEditPar ? (
                      <Lock
                        className="h-3.5 w-3.5 shrink-0 text-muted-foreground"
                        aria-label="PAR locked by owner"
                      />
                    ) : null}
                  </span>
                </TableCell>
              )}
              <TableCell className="align-middle py-2 text-right">
                {needQty !== null ? (
                  <span
                    className={cn(
                      "font-mono text-sm font-semibold tabular-nums",
                      needQty > 0 ? "text-destructive" : "text-muted-foreground",
                    )}
                  >
                    {formatNum(needQty)}
                  </span>
                ) : (
                  <span className="text-sm text-muted-foreground/35">—</span>
                )}
              </TableCell>
              <TableCell className="align-middle py-2 text-center">
                {risk.level === "NO_PAR" ? (
                  <Badge
                    variant="outline"
                    className="border-amber-500/40 bg-amber-500/[0.06] text-[10px] font-medium text-amber-950 dark:text-amber-100"
                  >
                    {statusLabelForRow(risk)}
                  </Badge>
                ) : (
                  <Badge
                    className={cn(
                      "border-0 text-[10px] font-medium tabular-nums",
                      risk.bgClass,
                      risk.textClass,
                    )}
                  >
                    {statusLabelForRow(risk)}
                  </Badge>
                )}
              </TableCell>
              <TableCell className="w-10 p-1 align-middle" onClick={(e) => e.stopPropagation()}>
                {renderRowActionsMenu(item)}
              </TableCell>
            </TableRow>
          </Fragment>
        );
      })}
    </>
  );
}
