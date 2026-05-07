import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { CountSheetItemStockField } from "@/features/inventory-count/components/CountSheetItemStockField";
import { SessionItemZoneCountStrip } from "@/features/inventory-count/components/SessionItemZoneCountStrip";
import { formatLastOrdered as formatLastOrderedHelper } from "@/domain/inventory/enterInventoryHelpers";
import { resolveSessionItemUnitPrice } from "@/domain/inventory/display/itemUnitPrice";
import type { InventorySessionDesktopCategoryListProps } from "@/features/inventory-count/types/inventorySessionDesktopCategoryListTypes";
import type { InventorySessionItemRow } from "@/domain/inventory/enterInventoryTypes";
import { computeOrderQty, formatNum, getRisk, getRowBgClass } from "@/lib/inventory-utils";
import { formatCurrency } from "@/lib/format";
import { cn } from "@/lib/utils";
import { ChevronDown, Lock } from "lucide-react";

function statusLabelForRow(risk: ReturnType<typeof getRisk>, needQty?: number | null): string {
  if (risk.level === "NO_PAR") return "—";
  if (risk.level === "RED") return needQty != null && needQty > 0 ? `Need ${needQty}` : "Critical";
  if (risk.level === "YELLOW") return "Low";
  return "OK";
}

export type InventorySessionCategoryCardListProps = Omit<
  InventorySessionDesktopCategoryListProps,
  "virtualListRef"
> & {
  showParColumn: boolean;
};

/**
 * Stacked card layout for &lt;lg — same data path and handlers as the desktop table.
 * No horizontal scroll: full-width column stack.
 */
export function InventorySessionCategoryCardList({
  categoryLabel,
  catItems,
  globalIndexByItemId,
  riskThresholds,
  showParColumn,
  parColumnVisible,
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
}: InventorySessionCategoryCardListProps) {
  return (
    <div
      className="w-full max-w-full space-y-3 overflow-x-hidden px-0.5 pb-2 pt-1 animate-fade-in"
      aria-label={`${categoryLabel} items, card view`}
    >
      {catItems.map((item) => (
        <SessionItemCard
          key={item.id}
          item={item}
          categoryLabel={categoryLabel}
          globalIndexByItemId={globalIndexByItemId}
          riskThresholds={riskThresholds}
          showParColumn={showParColumn}
          parColumnVisible={parColumnVisible}
          simplifyCountingRow={simplifyCountingRow}
          isCountingEditable={isCountingEditable}
          onUpdateStock={onUpdateStock}
          onSaveStock={onSaveStock}
          onSaveStockWithConversion={onSaveStockWithConversion}
          sessionUserId={sessionUserId}
          catalogById={catalogById}
          onKeyDown={onKeyDown}
          inputRefs={inputRefs}
          formatParColumnCell={formatParColumnCell}
          getProductNumber={getProductNumber}
          getLastOrderDate={getLastOrderDate}
          renderRowActionsMenu={renderRowActionsMenu}
          savingId={savingId}
          savedId={savedId}
          lastEditedId={lastEditedId}
          getApprovedPar={getApprovedPar}
          zoneStripEnabled={zoneStripEnabled}
          getZoneStripConfig={getZoneStripConfig}
          getZoneStripDraftResetNonce={getZoneStripDraftResetNonce}
          onCommitZoneCount={onCommitZoneCount}
          canEditPar={canEditPar}
        />
      ))}
    </div>
  );
}

type CardInnerProps = Omit<InventorySessionCategoryCardListProps, "catItems"> & {
  item: InventorySessionItemRow;
};

function SessionItemCard({
  item,
  categoryLabel,
  globalIndexByItemId,
  riskThresholds,
  showParColumn,
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
  parColumnVisible: _parColumnVisible,
}: CardInnerProps) {
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
  const metaParts = [item.vendor_name?.trim(), sku ? `#${sku}` : null].filter(Boolean);
  const cat = item.catalog_item_id ? (catalogById[item.catalog_item_id] ?? null) : null;
  const unitPrice = resolveSessionItemUnitPrice(item, cat);
  const onHandLabel =
    item.current_stock == null ? "—" : formatNum(Number(item.current_stock));

  return (
    <Card
      className={cn(
        "border-border/60 shadow-sm transition-shadow",
        rowBg,
        isRecentlyEdited && "ring-1 ring-blue-500/40 dark:ring-blue-500/30",
      )}
    >
      <CardContent className="p-4 space-y-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <h4 className="text-sm font-semibold leading-snug text-foreground">{item.item_name}</h4>
            {item.brand_name ? (
              <span className="text-[11px] italic text-muted-foreground mt-0.5 block">{item.brand_name}</span>
            ) : null}
            {metaParts.length > 0 ? (
              <p className="text-[11px] text-muted-foreground/85 mt-1 leading-snug break-words">
                {metaParts.join(" · ")}
              </p>
            ) : null}
          </div>
          <div className="flex shrink-0 items-center gap-0.5">
            {risk.level === "NO_PAR" ? (
              <span className="text-xs text-muted-foreground/50 px-1">—</span>
            ) : (
              <Badge className={cn("border-0 text-[10px] font-medium tabular-nums", risk.bgClass, risk.textClass)}>
                {statusLabelForRow(risk, needQty)}
              </Badge>
            )}
            {renderRowActionsMenu(item)}
          </div>
        </div>

        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 text-sm">
          <span className="text-muted-foreground">
            On hand: <span className="font-mono font-medium tabular-nums text-foreground">{onHandLabel}</span>
          </span>
          {showParColumn && (
            <span className="inline-flex items-center gap-1 text-muted-foreground">
              PAR:{" "}
              <span className="font-mono font-semibold tabular-nums text-foreground">
                {formatParColumnCell(item)}
              </span>
              {!canEditPar ? (
                <Lock className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-label="PAR locked by owner" />
              ) : null}
            </span>
          )}
        </div>

        <div className="w-full min-w-0">
          <CountSheetItemStockField
            item={item}
            variant="card"
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
            compactTable={false}
            userId={sessionUserId}
            categoryKey={categoryLabel}
            catalogItem={cat}
            zoneCountingActive={!!(zoneStripEnabled && strip)}
            onSaveStockWithConversion={onSaveStockWithConversion}
            rowPar={rowPar}
            touchProfile="responsive"
          />
        </div>

        {zoneStripEnabled ? (
          <div className="rounded-md border border-border/40 bg-muted/20 p-2">
            {strip ? (
              <SessionItemZoneCountStrip
                sessionItem={item}
                listCategoryId={strip.listCategoryId}
                unitOptions={strip.unitOptions}
                readOnly={!isCountingEditable}
                draftResetNonce={getZoneStripDraftResetNonce(item.id)}
                zoneLine={
                  zoneLine
                    ? {
                        entered_qty: Number(zoneLine.entered_qty),
                        entered_unit: zoneLine.entered_unit,
                      }
                    : undefined
                }
                onCommit={(qty, unit) => onCommitZoneCount(item, strip.listCategoryId, qty, unit)}
              />
            ) : (
              <div className="h-2" aria-hidden />
            )}
          </div>
        ) : null}

        <Collapsible defaultOpen={false}>
          <CollapsibleTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              className="min-h-11 w-full justify-between gap-2 px-2 py-2 h-auto font-normal text-muted-foreground hover:text-foreground"
            >
              <span className="text-sm">Details</span>
              <ChevronDown className="h-4 w-4 shrink-0" />
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <div className="space-y-2 border-t border-border/40 pt-3 text-xs text-muted-foreground">
              <div className="flex justify-between gap-2">
                <span>Pack</span>
                <span className="font-mono text-right text-foreground/90">
                  {item.pack_size?.trim() || "—"}
                </span>
              </div>
              <div className="flex justify-between gap-2">
                <span>Unit price</span>
                <span className="text-right text-foreground/90">
                  {unitPrice != null ? formatCurrency(unitPrice) : "—"}
                </span>
              </div>
              <div className="flex justify-between gap-2">
                <span>Need</span>
                <span className="text-right">
                  {needQty !== null ? (
                    <span
                      className={cn(
                        "font-mono font-semibold tabular-nums",
                        needQty > 0 ? "text-destructive" : "text-muted-foreground",
                      )}
                    >
                      {formatNum(needQty)}
                    </span>
                  ) : (
                    "—"
                  )}
                </span>
              </div>
              {!simplifyCountingRow && formatLastOrderedHelper(getLastOrderDate(item.item_name)) !== "—" ? (
                <div className="flex justify-between gap-2">
                  <span>Last ordered</span>
                  <span className="text-right text-foreground/90">
                    {formatLastOrderedHelper(getLastOrderDate(item.item_name))}
                  </span>
                </div>
              ) : null}
            </div>
          </CollapsibleContent>
        </Collapsible>
      </CardContent>
    </Card>
  );
}
