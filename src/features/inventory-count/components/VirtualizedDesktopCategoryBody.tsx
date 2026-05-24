import { useCallback, type KeyboardEvent, type MutableRefObject, type ReactNode, type Ref } from "react";
import { List, type ListImperativeAPI, type RowComponentProps } from "react-window";
import { CountSheetItemStockField } from "@/features/inventory-count/components/CountSheetItemStockField";
import {
  COUNT_CELL_ITEM,
  COUNT_CELL_PACK,
  COUNT_CELL_PAR,
  COUNT_CELL_UNIT,
  COUNT_CELL_COUNT,
  COUNT_CELL_NEED,
  COUNT_CELL_ACTIONS,
  formatParCell,
} from "@/features/inventory-count/components/InventorySessionDesktopItemRows";
import {
  countRowBorderClass,
  countRowNeedLabel,
  getCountRowVisualState,
} from "@/features/inventory-count/utils/countRowState";
import type {
  InventorySessionDesktopCategoryListProps,
  ZoneStripConfig,
} from "@/features/inventory-count/types/inventorySessionDesktopCategoryListTypes";
import {
  DESKTOP_CATEGORY_LIST_MAX_HEIGHT,
  INVENTORY_COUNT_GRID_TEMPLATE,
  desktopSessionRowHeight,
} from "@/domain/inventory/display/sessionDisplayHelpers";
import type { InventoryCatalogItemRow, InventorySessionItemRow } from "@/domain/inventory/enterInventoryTypes";
import type { SaveStockWithConversionPayload } from "@/features/inventory-count/hooks/useItemCommands";
import type { RiskThresholds } from "@/lib/inventory-utils";
import { cn } from "@/lib/utils";

type RowContext = {
  catItems: InventorySessionItemRow[];
  globalIndexByItemId: Map<string, number>;
  riskThresholds: RiskThresholds;
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
  categoryLabel: string;
  showParColumn: boolean;
  canEditPar: boolean;
};

function VirtualRow({
  index,
  style,
  catItems,
  globalIndexByItemId,
  riskThresholds,
  isCountingEditable,
  onUpdateStock,
  onSaveStock,
  onSaveStockWithConversion,
  sessionUserId,
  catalogById,
  onKeyDown,
  inputRefs,
  getProductNumber,
  renderRowActionsMenu,
  savingId,
  savedId,
  lastEditedId,
  getApprovedPar,
  zoneStripEnabled,
  getZoneStripConfig,
  categoryLabel,
  simplifyCountingRow,
}: RowComponentProps<RowContext>) {
  const item = catItems[index];
  if (!item) return null;
  const globalIdx = globalIndexByItemId.get(item.id) ?? 0;
  const rowPar = getApprovedPar(item);
  const need = countRowNeedLabel({
    currentStock: item.current_stock,
    par: rowPar,
    unit: item.unit,
    packSize: item.pack_size,
  });
  const visual = getCountRowVisualState({
    currentStock: item.current_stock,
    par: rowPar,
    focused: lastEditedId === item.id,
  });
  const unitLabel = (item.unit || "Cases").trim();
  const strip = zoneStripEnabled ? getZoneStripConfig(item) : null;
  const sku = item.vendor_sku?.trim() || getProductNumber(item);
  const cat = item.catalog_item_id ? (catalogById[item.catalog_item_id] ?? null) : null;

  return (
    <div style={{ ...style, overflow: "hidden" }} className="box-border" role="row">
      <div
        className={cn(
          "grid items-center border-b border-border/30 transition-colors hover:bg-muted/[0.12]",
          countRowBorderClass(visual),
        )}
        style={{ gridTemplateColumns: INVENTORY_COUNT_GRID_TEMPLATE, height: "100%" }}
      >
        {/* ITEM */}
        <div role="cell" className={COUNT_CELL_ITEM}>
          <div className="flex min-w-0 flex-col gap-0.5">
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

        <div role="cell" className={COUNT_CELL_UNIT}>
          <span className="rounded-full border border-input bg-muted/40 px-2 py-1 text-[10px] font-semibold uppercase">
            {unitLabel}
          </span>
        </div>

        {/* COUNT */}
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

        <div role="cell" className={COUNT_CELL_NEED}>
          <span className={need.className}>{need.text}</span>
        </div>

        {/* ACTIONS */}
        <div role="cell" className={COUNT_CELL_ACTIONS} onClick={(e) => e.stopPropagation()}>
          {renderRowActionsMenu(item)}
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
    showParColumn,
    simplifyCountingRow,
    zoneStripEnabled,
    listRef,
    getZoneStripConfig,
    canEditPar = true,
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
    showParColumn,
    simplifyCountingRow,
    zoneStripEnabled,
    categoryLabel: props.categoryLabel,
    canEditPar,
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
