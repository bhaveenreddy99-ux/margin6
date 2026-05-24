import { useCallback, useState } from "react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Send } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatNum, inputDisplayValue, parseInputValue } from "@/lib/inventory-utils";
import { CountSheetItemStockField } from "@/features/inventory-count/components/CountSheetItemStockField";
import {
  countRowBorderClass,
  getCountRowVisualState,
} from "@/features/inventory-count/utils/countRowState";
import { catalogIdFromSessionItem } from "@/domain/inventory/sessionItemCatalogLink";
import type { InventoryCatalogItemRow, InventorySessionItemRow } from "@/domain/inventory/enterInventoryTypes";
import type { SaveStockWithConversionPayload } from "@/features/inventory-count/hooks/useItemCommands";
import type { KeyboardEvent, MutableRefObject } from "react";

export type TabletCountViewProps = {
  filteredItems: InventorySessionItemRow[];
  sortedCategoryKeys: string[];
  groupedItems: Record<string, InventorySessionItemRow[]>;
  globalIndexByItemId: Map<string, number>;
  countedItems: number;
  totalItems: number;
  progressPct: number;
  sessionName: string;
  isCountingEditable: boolean;
  canCloudActions: boolean;
  submittingForReview: boolean;
  simplifyCountingRow: boolean;
  savingId: string | null;
  savedId: string | null;
  lastEditedId: string | null;
  sessionUserId: string | null;
  catalogById: Record<string, InventoryCatalogItemRow>;
  getApprovedPar: (item: InventorySessionItemRow) => number;
  getProductNumber: (item: InventorySessionItemRow) => string | null;
  onUpdateStock: (id: string, raw: string) => void;
  onSaveStock: (id: string, stock: number | null) => Promise<void>;
  onSaveStockWithConversion: (
    id: string,
    payload: SaveStockWithConversionPayload,
  ) => Promise<void>;
  onKeyDown: (event: KeyboardEvent, index: number, field?: "stock") => void;
  inputRefs: MutableRefObject<Record<string, HTMLInputElement | null>>;
  onSubmitClick: () => void;
  filterBar: React.ReactNode;
};

export function TabletCountView({
  sortedCategoryKeys,
  groupedItems,
  globalIndexByItemId,
  countedItems,
  totalItems,
  progressPct,
  sessionName,
  isCountingEditable,
  canCloudActions,
  submittingForReview,
  simplifyCountingRow,
  savingId,
  savedId,
  lastEditedId,
  sessionUserId,
  catalogById,
  getApprovedPar,
  getProductNumber,
  onUpdateStock,
  onSaveStock,
  onSaveStockWithConversion,
  onKeyDown,
  inputRefs,
  onSubmitClick,
  filterBar,
}: TabletCountViewProps) {
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [detailItem, setDetailItem] = useState<InventorySessionItemRow | null>(null);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent, index: number) => {
      if (e.key === "Enter") {
        e.preventDefault();
        onKeyDown(e, index, "stock");
        return;
      }
      onKeyDown(e, index, "stock");
    },
    [onKeyDown],
  );

  return (
    <div className="mt-2 pb-24">
      {/* Sticky header */}
      <div className="sticky top-0 z-20 bg-background/95 backdrop-blur-sm border-b border-border/40 pb-3 space-y-2">
        <div className="flex items-center justify-between gap-3 pt-1">
          <div className="min-w-0">
            <p className="text-sm font-semibold truncate">Inventory Count</p>
            <p className="text-xs text-muted-foreground tabular-nums">
              {countedItems}/{totalItems} · {sessionName}
            </p>
          </div>
          <Button
            size="sm"
            className="shrink-0 bg-gradient-orange text-white h-9"
            disabled={!canCloudActions || submittingForReview}
            onClick={onSubmitClick}
          >
            <Send className="h-3.5 w-3.5 mr-1" />
            Submit
          </Button>
        </div>
        <div className="h-1.5 rounded-full bg-muted/60 overflow-hidden">
          <div
            className="h-full rounded-full bg-gradient-orange transition-all"
            style={{ width: `${progressPct}%` }}
          />
        </div>
        {filterBar}
      </div>

      {sortedCategoryKeys.map((category) => {
        const catItems = groupedItems[category] ?? [];
        if (!catItems.length) return null;
        const countedInCat = catItems.filter(
          (i) => i.current_stock != null && Number(i.current_stock) > 0,
        ).length;

        return (
          <div key={category}>
            <div className="sticky top-[148px] z-10 flex items-center justify-between border-l-[3px] border-primary bg-white px-4 py-2 border-b border-border/40">
              <span className="text-xs font-bold uppercase tracking-wider">{category}</span>
              <span className="text-xs text-muted-foreground tabular-nums">
                {countedInCat}/{catItems.length} counted
              </span>
            </div>

            {catItems.map((item) => {
              const globalIdx = globalIndexByItemId.get(item.id) ?? 0;
              const rowPar = getApprovedPar(item);
              const sku = item.vendor_sku?.trim() || getProductNumber(item);
              const cid = catalogIdFromSessionItem(item);
              const cat = cid ? (catalogById[cid] ?? null) : null;
              const visual = getCountRowVisualState({
                currentStock: item.current_stock,
                par: rowPar,
                focused: focusedId === item.id,
              });

              return (
                <div
                  key={item.id}
                  className={cn(
                    "flex items-center min-h-[72px] border-b border-border/30 px-3 gap-2",
                    countRowBorderClass(visual),
                    lastEditedId === item.id && "ring-1 ring-primary/20",
                  )}
                >
                  <button
                    type="button"
                    className="flex-1 min-w-0 text-left py-2"
                    onClick={() => setDetailItem(item)}
                  >
                    <p className="text-base font-semibold truncate">{item.item_name}</p>
                    <p className="text-xs text-muted-foreground truncate">
                      {[item.vendor_name?.trim(), rowPar > 0 ? `PAR ${formatNum(rowPar)}` : null, item.pack_size?.trim()]
                        .filter(Boolean)
                        .join(" · ")}
                    </p>
                  </button>

                  <div className="w-40 shrink-0 flex items-center gap-1">
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      className="h-8 w-8 rounded-lg shrink-0"
                      disabled={!isCountingEditable}
                      onClick={() => {
                        const v = Math.max(0, Number(item.current_stock ?? 0) - 1);
                        onUpdateStock(item.id, String(v));
                        void onSaveStock(item.id, v);
                      }}
                    >
                      −
                    </Button>
                    <div className="flex-1 min-w-0">
                      <CountSheetItemStockField
                        item={item}
                        variant="desktop"
                        isCountingEditable={isCountingEditable}
                        simplifyCountingRow={simplifyCountingRow}
                        onUpdateStock={onUpdateStock}
                        onSaveStock={onSaveStock}
                        onKeyDown={(e) => handleKeyDown(e, globalIdx)}
                        globalIndex={globalIdx}
                        inputRef={(el) => {
                          inputRefs.current[item.id] = el;
                          if (el) {
                            el.addEventListener("focus", () => setFocusedId(item.id));
                            el.addEventListener("blur", () =>
                              setFocusedId((id) => (id === item.id ? null : id)),
                            );
                          }
                        }}
                        savingId={savingId}
                        savedId={savedId}
                        compactTable
                        countDensity="tablet"
                        userId={sessionUserId}
                        categoryKey={category}
                        catalogItem={cat}
                        zoneCountingActive={false}
                        onSaveStockWithConversion={onSaveStockWithConversion}
                        rowPar={rowPar}
                        touchProfile="responsive"
                      />
                    </div>
                    <Button
                      type="button"
                      size="icon"
                      className="h-8 w-8 rounded-lg shrink-0 bg-gradient-orange text-white hover:opacity-90"
                      disabled={!isCountingEditable}
                      onClick={() => {
                        const v = Number(item.current_stock ?? 0) + 1;
                        onUpdateStock(item.id, String(v));
                        void onSaveStock(item.id, v);
                      }}
                    >
                      +
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        );
      })}

      <Sheet open={!!detailItem} onOpenChange={(o) => !o && setDetailItem(null)}>
        <SheetContent side="bottom" className="max-h-[70vh]">
          <SheetHeader>
            <SheetTitle className="text-left break-words">{detailItem?.item_name}</SheetTitle>
          </SheetHeader>
          {detailItem ? (
            <div className="mt-4 space-y-2 text-sm text-muted-foreground">
              {detailItem.vendor_name ? <p>Vendor: {detailItem.vendor_name}</p> : null}
              {detailItem.pack_size ? <p>Pack: {detailItem.pack_size}</p> : null}
              {getProductNumber(detailItem) ? <p>SKU: #{getProductNumber(detailItem)}</p> : null}
              <p>PAR: {formatNum(getApprovedPar(detailItem))}</p>
              <p>
                On hand:{" "}
                {detailItem.current_stock != null
                  ? formatNum(Number(detailItem.current_stock))
                  : "—"}
              </p>
            </div>
          ) : null}
        </SheetContent>
      </Sheet>
    </div>
  );
}
