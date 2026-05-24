import { useCallback, type KeyboardEvent, type MutableRefObject, type ReactNode, type Ref } from "react";
import { List, type ListImperativeAPI, type RowComponentProps } from "react-window";
import { CountSpeedCell } from "@/features/inventory-count/components/CountSpeedCell";
import {
  formatParCell,
} from "@/features/inventory-count/components/InventorySessionDesktopItemRows";
import {
  countNeedBadge,
  countRowSurfaceClass,
  getCountRowRisk,
  isLastPurchaseRecent,
} from "@/features/inventory-count/utils/countRowState";
import type {
  InventorySessionDesktopCategoryListProps,
  ZoneStripConfig,
} from "@/features/inventory-count/types/inventorySessionDesktopCategoryListTypes";
import {
  DESKTOP_CATEGORY_LIST_MAX_HEIGHT,
  INVENTORY_COUNT_GRID_TEMPLATE,
  desktopSessionRowHeight,
  formatLastOrdered,
} from "@/domain/inventory/display/sessionDisplayHelpers";
import { resolveSessionItemUnitPrice } from "@/domain/inventory/display/itemUnitPrice";
import type { InventoryCatalogItemRow, InventorySessionItemRow } from "@/domain/inventory/enterInventoryTypes";
import type { SaveStockWithConversionPayload } from "@/features/inventory-count/hooks/useItemCommands";
import { formatCurrency } from "@/lib/inventory-utils";
import { cn } from "@/lib/utils";

type RowContext = {
  catItems: InventorySessionItemRow[];
  globalIndexByItemId: Map<string, number>;
  simplifyCountingRow: boolean;
  isCountingEditable: boolean;
  onUpdateStock: (id: string, raw: string) => void;
  onSaveStock: (id: string, stock: number | null) => void | Promise<void>;
  onSaveStockWithConversion: (id: string, payload: SaveStockWithConversionPayload) => void | Promise<void>;
  sessionUserId: string | null;
  catalogById: Record<string, InventoryCatalogItemRow>;
  onKeyDown: (event: KeyboardEvent, index: number, field?: "stock") => void;
  inputRefs: MutableRefObject<Record<string, HTMLInputElement | null>>;
  getProductNumber: (item: InventorySessionItemRow) => string | null;
  getLastOrderDate: (name: string) => string | null;
  renderRowActionsMenu: (item: InventorySessionItemRow) => ReactNode;
  getApprovedPar: (item: InventorySessionItemRow) => number;
  zoneStripEnabled: boolean;
  getZoneStripConfig: (item: InventorySessionItemRow) => ZoneStripConfig;
  categoryLabel: string;
};

function unitTypeLabel(unit: string | null | undefined): string {
  const u = (unit || "CS").trim().toUpperCase();
  if (u === "LB" || u === "LBS") return "LB";
  if (u === "EA" || u === "EACH") return "EA";
  return u.slice(0, 4) || "CS";
}

function VirtualRow({
  index,
  style,
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
}: RowComponentProps<RowContext>) {
  const item = catItems[index];
  if (!item) return null;
  const globalIdx = globalIndexByItemId.get(item.id) ?? 0;
  const rowPar = getApprovedPar(item);
  const risk = getCountRowRisk({ currentStock: item.current_stock, par: rowPar });
  const need = countNeedBadge({
    currentStock: item.current_stock,
    par: rowPar,
    unit: item.unit,
    packSize: item.pack_size,
  });
  const sku = item.vendor_sku?.trim() || getProductNumber(item);
  const cat = item.catalog_item_id ? (catalogById[item.catalog_item_id] ?? null) : null;
  const unitPrice = resolveSessionItemUnitPrice(item, cat);
  const lastIso = getLastOrderDate(item.item_name);
  const lastRecent = isLastPurchaseRecent(lastIso);
  const packLine = item.pack_size?.trim() || "—";
  const unitLine = unitTypeLabel(item.unit);

  return (
    <div style={{ ...style, overflow: "hidden" }} className="box-border" role="row">
      <div
        className={cn(
          "grid items-center border-b border-border/30 min-h-[52px] relative group",
          countRowSurfaceClass(risk),
        )}
        style={{ gridTemplateColumns: INVENTORY_COUNT_GRID_TEMPLATE, height: "100%" }}
      >
        <div role="cell" className="pl-3 pr-2 py-2 min-w-0 flex items-center gap-1">
          <div className="min-w-0 flex-1">
            <p className="text-xs font-medium truncate max-w-[180px] text-foreground">
              {item.item_name}
            </p>
            {sku ? (
              <p className="text-[10px] text-muted-foreground mt-px">#{sku}</p>
            ) : null}
            <p
              className={cn(
                "text-[10px] mt-px",
                lastRecent ? "text-[#f97316]" : "text-muted-foreground",
              )}
            >
              Last: {formatLastOrdered(lastIso)}
            </p>
          </div>
          <div className="opacity-0 group-hover:opacity-100 shrink-0" onClick={(e) => e.stopPropagation()}>
            {renderRowActionsMenu(item)}
          </div>
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
            inputRef={(el) => {
              inputRefs.current[item.id] = el;
            }}
          />
        </div>

        <div role="cell" className="flex items-center justify-center py-2">
          <span className={need.className}>{need.text}</span>
        </div>
      </div>
    </div>
  );
}

const MemoVirtualRow = VirtualRow;

export type VirtualizedDesktopCategoryBodyProps = InventorySessionDesktopCategoryListProps & {
  showParColumn: boolean;
  listRef?: Ref<ListImperativeAPI | null>;
};

export function VirtualizedDesktopCategoryBody(props: VirtualizedDesktopCategoryBodyProps) {
  const {
    catItems,
    simplifyCountingRow,
    zoneStripEnabled,
    listRef,
    getZoneStripConfig,
    showParColumn: _showParColumn,
    canEditPar: _canEditPar = true,
    ...rest
  } = props;
  const rowHeightFn = useCallback(
    (index: number) => {
      const item = catItems[index];
      if (!item) {
        return desktopSessionRowHeight(false);
      }
      const hasStrip = zoneStripEnabled && !!getZoneStripConfig(item);
      return desktopSessionRowHeight(hasStrip);
    },
    [catItems, zoneStripEnabled, getZoneStripConfig],
  );

  const rowProps: RowContext = {
    ...rest,
    getZoneStripConfig,
    catItems,
    simplifyCountingRow,
    zoneStripEnabled,
    categoryLabel: props.categoryLabel,
  };

  return (
    <List
      listRef={listRef}
      rowCount={catItems.length}
      rowHeight={rowHeightFn}
      rowComponent={MemoVirtualRow}
      rowProps={rowProps as RowContext}
      className="w-full"
      style={{ height: DESKTOP_CATEGORY_LIST_MAX_HEIGHT, width: "100%" }}
      overscanCount={6}
    />
  );
}
