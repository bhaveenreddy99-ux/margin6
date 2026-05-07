import { useCallback, type KeyboardEvent, type MutableRefObject, type ReactNode, type Ref } from "react";
import { List, type ListImperativeAPI, type RowComponentProps } from "react-window";
import { Badge } from "@/components/ui/badge";
import { SessionItemZoneCountStrip } from "@/features/inventory-count/components/SessionItemZoneCountStrip";
import { CountSheetItemStockField } from "@/features/inventory-count/components/CountSheetItemStockField";
import type {
  InventorySessionDesktopCategoryListProps,
  ZoneStripConfig,
} from "@/features/inventory-count/types/inventorySessionDesktopCategoryListTypes";
import { formatLastOrdered as formatLastOrderedHelper } from "@/domain/inventory/enterInventoryHelpers";
import { resolveSessionItemUnitPrice } from "@/domain/inventory/display/itemUnitPrice";
import {
  DESKTOP_CATEGORY_LIST_MAX_HEIGHT,
  desktopSessionRowHeight,
  getLaptopInventoryGridTemplate,
} from "@/domain/inventory/display/sessionDisplayHelpers";
import type { InventoryCatalogItemRow, InventorySessionItemRow } from "@/domain/inventory/enterInventoryTypes";
import type { SaveStockWithConversionPayload } from "@/features/inventory-count/hooks/useItemCommands";
import {
  computeOrderQty,
  formatCurrency,
  formatNum,
  getRisk,
  getRowBgClass,
  type RiskThresholds,
} from "@/lib/inventory-utils";
import { cn } from "@/lib/utils";
import { Lock } from "lucide-react";

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
  gridTemplate: string;
  colSpan: number;
  canEditPar: boolean;
};

function statusLabelForRow(risk: ReturnType<typeof getRisk>): string {
  if (risk.level === "NO_PAR") return "No PAR";
  if (risk.level === "RED") return "Critical";
  if (risk.level === "YELLOW") return "Low";
  return "OK";
}

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
  categoryLabel,
  showParColumn,
  gridTemplate,
  colSpan,
  simplifyCountingRow,
  canEditPar,
}: RowComponentProps<RowContext>) {
  const item = catItems[index];
  if (!item) return null;
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
    <div
      style={{ ...style, overflow: "hidden" }}
      className="box-border border-b border-border/40"
      role="row"
    >
      <div
        className={cn(
          "grid min-h-0 w-full min-w-0 items-center gap-x-1 gap-y-0 border-b border-border/40 px-1 py-1 sm:px-1.5",
          rowBg,
          isRecentlyEdited && "bg-blue-50/90 dark:bg-blue-950/25",
        )}
        style={{ gridTemplateColumns: gridTemplate }}
        role="grid"
      >
        <div className="min-w-0 py-0.5">
          <div className="flex min-w-0 flex-col gap-0.5">
            <span className="truncate text-sm font-semibold leading-snug text-foreground">
              {item.item_name}
              {sku ? (
                <span className="font-normal text-muted-foreground"> · #{sku}</span>
              ) : null}
            </span>
            <span className="truncate text-[10px] text-muted-foreground/70">
              {[item.brand_name, item.vendor_name?.trim(), item.pack_size?.trim()]
                .filter(Boolean)
                .join(" · ") || " "}
            </span>
          </div>
        </div>
        <div className="flex min-w-0 justify-center py-0.5">
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
        <div className="text-right font-mono text-xs tabular-nums text-gray-700 dark:text-foreground/90">
          {unitPrice != null ? formatCurrency(unitPrice) : "—"}
        </div>
        {showParColumn && (
          <div className="text-right font-mono text-sm font-semibold tabular-nums">
            <span className="inline-flex items-center justify-end gap-1">
              <span>{formatParColumnCell(item)}</span>
              {!canEditPar ? (
                <Lock className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-label="PAR locked by owner" />
              ) : null}
            </span>
          </div>
        )}
        <div className="text-right">
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
        </div>
        <div className="text-center">
          {risk.level === "NO_PAR" ? (
            <Badge
              variant="outline"
              className="border-amber-500/40 bg-amber-500/[0.06] text-[10px] font-medium text-amber-950 dark:text-amber-100"
            >
              {statusLabelForRow(risk)}
            </Badge>
          ) : (
            <Badge
              className={cn("border-0 text-[10px] font-medium tabular-nums", risk.bgClass, risk.textClass)}
            >
              {statusLabelForRow(risk)}
            </Badge>
          )}
        </div>
        <div className="flex justify-end p-0.5" onClick={(e) => e.stopPropagation()}>
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
  const gridTemplate = getLaptopInventoryGridTemplate(showParColumn);
  const colSpan = showParColumn ? 10 : 9;

  const rowProps: RowContext = {
    ...rest,
    getZoneStripConfig,
    catItems,
    showParColumn,
    gridTemplate,
    colSpan,
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
