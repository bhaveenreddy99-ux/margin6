import { useMemo } from "react";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { VirtualizedDesktopCategoryBody } from "@/features/inventory-count/components/VirtualizedDesktopCategoryBody";
import { InventorySessionCategoryCardList } from "@/features/inventory-count/components/InventorySessionCategoryCardList";
import { InventorySessionDesktopItemRows } from "@/features/inventory-count/components/InventorySessionDesktopItemRows";
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
  const showParColumn = parColumnVisible && catItems.some((i) => getApprovedPar(i) > 0);

  const countedInCategory = useMemo(
    () => catItems.filter((i) => i.current_stock != null && Number(i.current_stock) > 0).length,
    [catItems],
  );

  const colSpan = showParColumn ? 8 : 7;
  const useVirtual = catItems.length >= 80;

  if (catItems.length === 0) {
    return (
      <div className="py-8 text-center text-sm text-muted-foreground">No items in this category.</div>
    );
  }

  const categoryHeaderRow = (
    <TableRow className="border-b border-border/40 bg-gray-50 dark:bg-muted/30 hover:bg-gray-50 dark:hover:bg-muted/30">
      <TableCell colSpan={colSpan} className="px-3 py-2.5">
        <div className="flex w-full min-w-0 flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
          <div className="flex min-w-0 items-center gap-2">
            <h3 className="truncate text-xs font-bold uppercase tracking-wider text-gray-900 dark:text-foreground">
              {categoryLabel}
            </h3>
            <Badge variant="secondary" className="shrink-0 font-mono text-[10px]">
              {catItems.length}
            </Badge>
          </div>
          <span className="shrink-0 font-mono text-[10px] tabular-nums text-gray-600 dark:text-muted-foreground">
            {countedInCategory}/{catItems.length} counted
          </span>
        </div>
      </TableCell>
    </TableRow>
  );

  return (
    <div className="w-full min-w-0 max-w-full">
      {useVirtual ? (
        <div className="flex w-full flex-col gap-2 border-b border-border/30 bg-gray-50 px-3 py-2.5 dark:bg-muted/30 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between sm:gap-3">
          <div className="flex min-w-0 items-center gap-2">
            <h3 className="truncate text-xs font-bold uppercase tracking-wider text-gray-900 dark:text-foreground">
              {categoryLabel}
            </h3>
            <Badge variant="secondary" className="shrink-0 font-mono text-[10px]">
              {catItems.length}
            </Badge>
          </div>
          <span className="shrink-0 font-mono text-[10px] tabular-nums text-gray-600 dark:text-muted-foreground">
            {countedInCategory}/{catItems.length} counted
          </span>
        </div>
      ) : (
        <div className="flex w-full flex-col gap-2 border-b border-border/30 bg-gray-50 px-3 py-2.5 dark:bg-muted/30 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between sm:gap-3 lg:hidden">
          <div className="flex min-w-0 items-center gap-2">
            <h3 className="truncate text-xs font-bold uppercase tracking-wider text-gray-900 dark:text-foreground">
              {categoryLabel}
            </h3>
            <Badge variant="secondary" className="shrink-0 font-mono text-[10px]">
              {catItems.length}
            </Badge>
          </div>
          <span className="shrink-0 font-mono text-[10px] tabular-nums text-gray-600 dark:text-muted-foreground">
            {countedInCategory}/{catItems.length} counted
          </span>
        </div>
      )}

      <div className="lg:hidden max-w-full overflow-x-hidden">
        <InventorySessionCategoryCardList
          showParColumn={showParColumn}
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

      {useVirtual ? (
        <div className="hidden lg:block w-full min-w-0 overflow-x-auto [-webkit-overflow-scrolling:touch]">
          <Table className="w-full min-w-[720px] table-fixed [table-layout:fixed]">
            <TableHeader>
              <TableRow className="border-b border-border/40 bg-muted/20 hover:bg-muted/20">
                <TableHead className="w-[24%] min-w-[150px] py-2.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                  Item
                </TableHead>
                <TableHead className="w-[40%] min-w-[220px] py-2.5 text-center text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                  Count
                </TableHead>
                <TableHead className="w-[10%] min-w-[72px] py-2.5 text-right text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                  Price
                </TableHead>
                {showParColumn && (
                  <TableHead className="w-[8%] min-w-[56px] py-2.5 text-right text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                    Par
                  </TableHead>
                )}
                <TableHead className="w-[9%] min-w-[56px] py-2.5 text-right text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                  Need
                </TableHead>
                <TableHead className="w-[10%] min-w-[72px] py-2.5 text-center text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                  Status
                </TableHead>
                <TableHead className="w-10 min-w-[40px] p-1" />
              </TableRow>
            </TableHeader>
          </Table>
          <VirtualizedDesktopCategoryBody
            listRef={(api) => virtualListRef?.(api ?? null)}
            categoryLabel={categoryLabel}
            catItems={catItems}
            globalIndexByItemId={globalIndexByItemId}
            riskThresholds={riskThresholds}
            parColumnVisible={parColumnVisible}
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
            simplifyCountingRow={simplifyCountingRow}
            zoneStripEnabled={zoneStripEnabled}
            getZoneStripConfig={getZoneStripConfig}
            getZoneStripDraftResetNonce={getZoneStripDraftResetNonce}
            onCommitZoneCount={onCommitZoneCount}
            showParColumn={showParColumn}
            canEditPar={canEditPar}
          />
        </div>
      ) : (
        <div className="hidden lg:block w-full min-w-0 overflow-x-auto [-webkit-overflow-scrolling:touch]">
      <Table className="w-full min-w-[720px] table-fixed [table-layout:fixed]">
        <TableHeader>
          <TableRow className="border-b border-border/40 bg-muted/20 hover:bg-muted/20">
            <TableHead className="w-[24%] min-w-[150px] py-2.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
              Item
            </TableHead>
            <TableHead className="w-[40%] min-w-[220px] py-2.5 text-center text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
              Count
            </TableHead>
            <TableHead className="w-[10%] min-w-[72px] py-2.5 text-right text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
              Price
            </TableHead>
            {showParColumn && (
              <TableHead className="w-[8%] min-w-[56px] py-2.5 text-right text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                Par
              </TableHead>
            )}
            <TableHead className="w-[9%] min-w-[56px] py-2.5 text-right text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
              Need
            </TableHead>
            <TableHead className="w-[10%] min-w-[72px] py-2.5 text-center text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
              Status
            </TableHead>
            <TableHead className="w-10 min-w-[40px] p-1" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {categoryHeaderRow}
          <InventorySessionDesktopItemRows
            categoryLabel={categoryLabel}
            catItems={catItems}
            globalIndexByItemId={globalIndexByItemId}
            riskThresholds={riskThresholds}
            showParColumn={showParColumn}
            colSpan={colSpan}
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
        </TableBody>
      </Table>
        </div>
      )}
    </div>
  );
}
