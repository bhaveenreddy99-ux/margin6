import { useMemo } from "react";
import { VirtualizedDesktopCategoryBody } from "@/features/inventory-count/components/VirtualizedDesktopCategoryBody";
import { InventorySessionCategoryCardList } from "@/features/inventory-count/components/InventorySessionCategoryCardList";
import {
  InventoryCountCategoryDivider,
  InventoryCountTableHeader,
  InventorySessionDesktopItemRows,
} from "@/features/inventory-count/components/InventorySessionDesktopItemRows";
import { INVENTORY_COUNT_MIN_WIDTH } from "@/domain/inventory/display/sessionDisplayHelpers";
import {
  type InventorySessionDesktopCategoryListProps,
  type ZoneStripConfig,
} from "@/features/inventory-count/types/inventorySessionDesktopCategoryListTypes";

export type { ZoneStripConfig, InventorySessionDesktopCategoryListProps };

export function InventorySessionDesktopCategoryList({
  categoryLabel,
  catItems,
  globalIndexByItemId,
  riskThresholds,
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
  virtualListRef,
  canEditPar = true,
}: InventorySessionDesktopCategoryListProps) {
  const countedInCategory = useMemo(
    () => catItems.filter((i) => i.current_stock != null && Number(i.current_stock) > 0).length,
    [catItems],
  );
  const useVirtual = catItems.length >= 80;

  if (catItems.length === 0) {
    return <div className="py-8 text-center text-sm text-muted-foreground">No items in this category.</div>;
  }

  const sharedRowProps = {
    categoryLabel,
    catItems,
    globalIndexByItemId,
    riskThresholds,
    parColumnVisible,
    showParColumn: false,
    colSpan: 6,
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
    canEditPar,
  } as const;

  return (
    <div className="w-full min-w-0 max-w-full">
      {/* ── PHONE (<md) ── unchanged compact card list ── */}
      <div className="md:hidden max-w-full overflow-x-hidden">
        <div
          className="flex items-center justify-between border-b border-white/10 bg-[hsl(222,28%,9%)]"
          style={{ padding: "10px 16px" }}
        >
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-bold uppercase tracking-[0.1em] text-white/65">
              {categoryLabel}
            </span>
            <span className="rounded-full bg-white/10 px-1.5 py-px font-mono text-[10px] text-white/45">
              {catItems.length}
            </span>
          </div>
          <span className="font-mono text-[10px] text-white/40">
            {countedInCategory}/{catItems.length}
          </span>
        </div>
        <InventorySessionCategoryCardList
          showParColumn={false}
          categoryLabel={categoryLabel}
          catItems={catItems}
          globalIndexByItemId={globalIndexByItemId}
          riskThresholds={riskThresholds}
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
      </div>

      {/* ── TABLET + DESKTOP (≥md) — pure CSS grid, single shared template ── */}
      <div className="hidden md:block w-full overflow-x-auto">
        <div style={{ minWidth: INVENTORY_COUNT_MIN_WIDTH }}>
          <InventoryCountTableHeader />
          <InventoryCountCategoryDivider
            label={categoryLabel}
            total={catItems.length}
            counted={countedInCategory}
          />
          {useVirtual ? (
            <VirtualizedDesktopCategoryBody
              listRef={(api) => virtualListRef?.(api ?? null)}
              showParColumn={false}
              {...sharedRowProps}
            />
          ) : (
            <InventorySessionDesktopItemRows {...sharedRowProps} />
          )}
        </div>
      </div>
    </div>
  );
}
