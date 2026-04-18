import { useMemo, type KeyboardEvent, type MutableRefObject, type ReactNode } from "react";
import { List, type ListImperativeAPI, type RowComponentProps } from "react-window";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import ItemIdentityBlock from "@/components/ItemIdentityBlock";
import {
  DESKTOP_CATEGORY_LIST_MAX_HEIGHT,
  DESKTOP_COUNT_ROW_HEIGHT,
  formatLastOrdered as formatLastOrderedHelper,
  formatParColumnCell as formatParColumnCellHelper,
  getDesktopSessionGridTemplate,
  getRiskBadgeLabel,
} from "@/domain/inventory/enterInventoryHelpers";
import type { InventorySessionItemRow } from "@/domain/inventory/enterInventoryTypes";
import {
  computeOrderQty,
  formatNum,
  getRisk,
  getRowBgClass,
  inputDisplayValue,
  type RiskThresholds,
} from "@/lib/inventory-utils";
import { Check } from "lucide-react";

type SessionDesktopVirtualData = {
  catItems: InventorySessionItemRow[];
  globalIndexByItemId: Map<string, number>;
  getApprovedPar: (item: InventorySessionItemRow) => number;
  riskThresholds: RiskThresholds;
  parColumnVisible: boolean;
  simplifyCountingRow: boolean;
  isCountingEditable: boolean;
  onUpdateStock: (id: string, raw: string) => void;
  onSaveStock: (id: string, stock: number | null) => void | Promise<void>;
  onKeyDown: (event: KeyboardEvent, index: number, field?: "stock") => void;
  inputRefs: MutableRefObject<Record<string, HTMLInputElement | null>>;
  formatParColumnCell: (item: InventorySessionItemRow) => string;
  getProductNumber: (item: InventorySessionItemRow) => string | null;
  getLastOrderDate: (name: string) => string | null;
  renderRowActionsMenu: (item: InventorySessionItemRow) => ReactNode;
  savingId: string | null;
  savedId: string | null;
  lastEditedId: string | null;
};

export type InventorySessionDesktopCategoryListProps = {
  catItems: InventorySessionItemRow[];
  listWidth: number;
  globalIndexByItemId: Map<string, number>;
  riskThresholds: RiskThresholds;
  parColumnVisible: boolean;
  isCountingEditable: boolean;
  onUpdateStock: SessionDesktopVirtualData["onUpdateStock"];
  onSaveStock: SessionDesktopVirtualData["onSaveStock"];
  onKeyDown: SessionDesktopVirtualData["onKeyDown"];
  inputRefs: SessionDesktopVirtualData["inputRefs"];
  formatParColumnCell: SessionDesktopVirtualData["formatParColumnCell"];
  getProductNumber: SessionDesktopVirtualData["getProductNumber"];
  getLastOrderDate: SessionDesktopVirtualData["getLastOrderDate"];
  renderRowActionsMenu: SessionDesktopVirtualData["renderRowActionsMenu"];
  savingId: SessionDesktopVirtualData["savingId"];
  savedId: SessionDesktopVirtualData["savedId"];
  lastEditedId: SessionDesktopVirtualData["lastEditedId"];
  getApprovedPar: SessionDesktopVirtualData["getApprovedPar"];
  simplifyCountingRow: boolean;
  registerListRef: (instance: ListImperativeAPI | null) => void;
};

function InventoryRow(props: RowComponentProps<SessionDesktopVirtualData>) {
  const { index, style, ariaAttributes, ...data } = props;
  const item = data.catItems[index];
  if (!item) return null;

  const globalIdx = data.globalIndexByItemId.get(item.id) ?? 0;
  const rowPar = data.getApprovedPar(item);
  const needQty =
    rowPar > 0 ? computeOrderQty(item.current_stock, rowPar, item.unit, item.pack_size) : null;
  const risk = getRisk(item.current_stock, rowPar, data.riskThresholds);
  const rowBg = getRowBgClass(item.current_stock);
  const isRecentlyEdited = data.lastEditedId === item.id;
  const gridTemplate = getDesktopSessionGridTemplate(
    data.parColumnVisible,
    data.simplifyCountingRow,
  );
  const showMetaLine =
    !data.simplifyCountingRow || data.getProductNumber(item) || !!item.pack_size;
  const lastOrderedLabel = formatLastOrderedHelper(data.getLastOrderDate(item.item_name));

  return (
    <div
      {...ariaAttributes}
      style={{ ...style, display: "grid", gridTemplateColumns: gridTemplate }}
      className={`items-center gap-x-2 border-b border-border/10 px-2 transition-all duration-200 hover:bg-muted/20 ${rowBg} ${isRecentlyEdited ? "bg-primary/[0.03]" : ""}`}
    >
      <div className="min-w-0 py-3 pl-3">
        <p className={`font-medium leading-tight ${data.simplifyCountingRow ? "text-[15px]" : "text-sm"}`}>
          {item.item_name}
        </p>
        <ItemIdentityBlock brandName={item.brand_name} className="mt-0.5 block" />
        {showMetaLine && (
          <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0">
            {data.getProductNumber(item) && (
              <span className="font-mono text-[11px] text-muted-foreground/50">
                #{data.getProductNumber(item)}
              </span>
            )}
            {item.pack_size && (
              <span className="text-[11px] text-muted-foreground/50">{item.pack_size}</span>
            )}
            {!data.simplifyCountingRow && lastOrderedLabel !== "—" && (
              <span className="text-[11px] text-muted-foreground/40">Last: {lastOrderedLabel}</span>
            )}
          </div>
        )}
      </div>
      <div className="flex justify-center py-3">
        <div className="flex items-center justify-center gap-2">
          <Input
            ref={(element) => {
              data.inputRefs.current[item.id] = element;
            }}
            type="number"
            inputMode="decimal"
            min={0}
            step={0.1}
            readOnly={!data.isCountingEditable}
            value={inputDisplayValue(item.current_stock)}
            onFocus={(event) => event.target.select()}
            onChange={(event) => data.onUpdateStock(item.id, event.target.value)}
            onBlur={() => data.onSaveStock(item.id, item.current_stock)}
            onKeyDown={(event) => data.onKeyDown(event, globalIdx, "stock")}
            className={`w-24 rounded-lg border-2 bg-background text-center font-mono text-base font-semibold [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none ${
              data.simplifyCountingRow
                ? "h-11 border-primary/35 shadow-sm focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/25"
                : "h-10 border-border/50 focus:border-primary/50"
            }`}
          />
          <div className="w-5">
            {data.savingId === item.id && (
              <span className="animate-pulse text-xs text-muted-foreground">...</span>
            )}
            {data.savedId === item.id && <Check className="h-3.5 w-3.5 text-success" />}
          </div>
        </div>
      </div>
      {data.parColumnVisible && (
        <div className="py-3 text-right">
          <span className="font-mono text-sm font-semibold tabular-nums text-foreground">
            {data.formatParColumnCell(item)}
          </span>
        </div>
      )}
      {!data.simplifyCountingRow && (
        <div className="py-3 text-right">
          <span className="font-mono text-sm tabular-nums text-foreground">
            {item.unit_cost != null ? (
              `$${Number(item.unit_cost).toFixed(2)}`
            ) : (
              <span className="text-muted-foreground/30">—</span>
            )}
          </span>
        </div>
      )}
      <div className="py-3 text-right">
        {needQty !== null ? (
          <span
            className={`font-mono font-semibold ${data.simplifyCountingRow ? "text-xs" : "text-sm"} ${needQty > 0 ? "text-destructive" : "text-muted-foreground"}`}
          >
            {formatNum(needQty)}
          </span>
        ) : (
          <span className="text-sm text-muted-foreground/30">—</span>
        )}
      </div>
      <div className="py-3 pr-2 text-center">
        <Badge
          className={`${risk.bgClass} ${risk.textClass} border-0 font-medium ${data.simplifyCountingRow ? "px-1.5 py-0 text-[9px]" : "text-[10px]"}`}
        >
          {getRiskBadgeLabel(risk)}
        </Badge>
      </div>
      <div className="flex justify-end py-3 pr-1" onClick={(event) => event.stopPropagation()}>
        {data.renderRowActionsMenu(item)}
      </div>
    </div>
  );
}

export function InventorySessionDesktopCategoryList({
  catItems,
  listWidth,
  globalIndexByItemId,
  riskThresholds,
  parColumnVisible,
  simplifyCountingRow,
  isCountingEditable,
  onUpdateStock,
  onSaveStock,
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
  registerListRef,
}: InventorySessionDesktopCategoryListProps) {
  const rowProps = useMemo<SessionDesktopVirtualData>(
    () => ({
      catItems,
      globalIndexByItemId,
      getApprovedPar,
      riskThresholds,
      parColumnVisible,
      simplifyCountingRow,
      isCountingEditable,
      onUpdateStock,
      onSaveStock,
      onKeyDown,
      inputRefs,
      formatParColumnCell,
      getProductNumber,
      getLastOrderDate,
      renderRowActionsMenu,
      savingId,
      savedId,
      lastEditedId,
    }),
    [
      catItems,
      globalIndexByItemId,
      getApprovedPar,
      riskThresholds,
      parColumnVisible,
      simplifyCountingRow,
      isCountingEditable,
      onUpdateStock,
      onSaveStock,
      onKeyDown,
      inputRefs,
      formatParColumnCell,
      getProductNumber,
      getLastOrderDate,
      renderRowActionsMenu,
      savingId,
      savedId,
      lastEditedId,
    ],
  );

  const headerGrid = getDesktopSessionGridTemplate(parColumnVisible, simplifyCountingRow);
  const safeWidth = Math.max(listWidth, 320);
  const listHeight = Math.min(
    Math.max(catItems.length * DESKTOP_COUNT_ROW_HEIGHT, catItems.length > 0 ? 80 : 0),
    DESKTOP_CATEGORY_LIST_MAX_HEIGHT,
  );

  return (
    <>
      <div
        className="grid items-center gap-x-2 border-b border-border/20 bg-muted/30 px-2"
        style={{ gridTemplateColumns: headerGrid }}
      >
        <div className="py-3 pl-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/60">
          Item
        </div>
        <div className="py-3 text-center text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/60">
          On Hand
        </div>
        {parColumnVisible && (
          <div className="py-3 text-right text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/60">
            PAR
          </div>
        )}
        {!simplifyCountingRow && (
          <div className="py-3 text-right text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/60">
            Price
          </div>
        )}
        <div className="py-3 text-right text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/60">
          Need
        </div>
        <div className="py-3 pr-2 text-center text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/60">
          Status
        </div>
        <div className="w-10 py-3" aria-hidden />
      </div>
      {catItems.length > 0 && (
        <List
          listRef={registerListRef}
          rowCount={catItems.length}
          rowHeight={DESKTOP_COUNT_ROW_HEIGHT}
          rowComponent={InventoryRow}
          rowProps={rowProps}
          overscanCount={6}
          style={{ height: listHeight, width: safeWidth }}
        />
      )}
    </>
  );
}
