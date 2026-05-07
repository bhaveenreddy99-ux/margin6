import { Fragment, useMemo } from "react";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { InventorySessionCategoryCardList } from "@/features/inventory-count/components/InventorySessionCategoryCardList";
import { InventorySessionDesktopItemRows } from "@/features/inventory-count/components/InventorySessionDesktopItemRows";
import type { InventorySessionItemRow } from "@/domain/inventory/enterInventoryTypes";
import type { InventorySessionDesktopCategoryListProps } from "@/features/inventory-count/types/inventorySessionDesktopCategoryListTypes";

export type InventorySessionUnitedDesktopTableProps = Omit<
  InventorySessionDesktopCategoryListProps,
  "categoryLabel" | "catItems" | "virtualListRef"
> & {
  sortedCategoryKeys: string[];
  groupedItems: Record<string, InventorySessionItemRow[]>;
};

export function InventorySessionUnitedDesktopTable(props: InventorySessionUnitedDesktopTableProps) {
  const { sortedCategoryKeys, groupedItems, parColumnVisible, globalIndexByItemId, getApprovedPar } = props;
  const canEditPar = props.canEditPar ?? true;

  const allItems = useMemo(
    () => sortedCategoryKeys.flatMap((k) => groupedItems[k] ?? []),
    [sortedCategoryKeys, groupedItems],
  );

  const showParColumn = parColumnVisible && allItems.some((i) => getApprovedPar(i) > 0);
  const colSpan = showParColumn ? 8 : 7;

  if (allItems.length === 0) {
    return (
      <div className="py-8 text-center text-sm text-muted-foreground">No items in this list.</div>
    );
  }

  return (
    <div className="w-full min-w-0 max-w-full">
      <div className="lg:hidden max-w-full overflow-x-hidden">
        {sortedCategoryKeys.map((categoryLabel) => {
          const catItems = groupedItems[categoryLabel] ?? [];
          if (catItems.length === 0) return null;
          const countedInCategory = catItems.filter(
            (i) => i.current_stock != null && Number(i.current_stock) > 0,
          ).length;
          return (
            <Fragment key={categoryLabel}>
              <div className="mb-2 flex w-full flex-col gap-2 border-b border-border/30 bg-gray-50 px-1 py-2 dark:bg-muted/30 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
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
              <InventorySessionCategoryCardList
                showParColumn={showParColumn}
                categoryLabel={categoryLabel}
                catItems={catItems}
                globalIndexByItemId={globalIndexByItemId}
                riskThresholds={props.riskThresholds}
                parColumnVisible={props.parColumnVisible}
                simplifyCountingRow={props.simplifyCountingRow}
                isCountingEditable={props.isCountingEditable}
                onUpdateStock={props.onUpdateStock}
                onSaveStock={props.onSaveStock}
                onSaveStockWithConversion={props.onSaveStockWithConversion}
                sessionUserId={props.sessionUserId}
                catalogById={props.catalogById}
                onKeyDown={props.onKeyDown}
                inputRefs={props.inputRefs}
                formatParColumnCell={props.formatParColumnCell}
                getProductNumber={props.getProductNumber}
                getLastOrderDate={props.getLastOrderDate}
                renderRowActionsMenu={props.renderRowActionsMenu}
                savingId={props.savingId}
                savedId={props.savedId}
                lastEditedId={props.lastEditedId}
                getApprovedPar={getApprovedPar}
                zoneStripEnabled={props.zoneStripEnabled}
                getZoneStripConfig={props.getZoneStripConfig}
                getZoneStripDraftResetNonce={props.getZoneStripDraftResetNonce}
                onCommitZoneCount={props.onCommitZoneCount}
                canEditPar={canEditPar}
              />
            </Fragment>
          );
        })}
      </div>

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
            {sortedCategoryKeys.map((categoryLabel) => {
              const catItems = groupedItems[categoryLabel] ?? [];
              if (catItems.length === 0) return null;
              const countedInCategory = catItems.filter(
                (i) => i.current_stock != null && Number(i.current_stock) > 0,
              ).length;
              return (
                <Fragment key={categoryLabel}>
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
                  <InventorySessionDesktopItemRows
                    categoryLabel={categoryLabel}
                    catItems={catItems}
                    globalIndexByItemId={globalIndexByItemId}
                    riskThresholds={props.riskThresholds}
                    showParColumn={showParColumn}
                    colSpan={colSpan}
                    simplifyCountingRow={props.simplifyCountingRow}
                    isCountingEditable={props.isCountingEditable}
                    onUpdateStock={props.onUpdateStock}
                    onSaveStock={props.onSaveStock}
                    onSaveStockWithConversion={props.onSaveStockWithConversion}
                    sessionUserId={props.sessionUserId}
                    catalogById={props.catalogById}
                    onKeyDown={props.onKeyDown}
                    inputRefs={props.inputRefs}
                    formatParColumnCell={props.formatParColumnCell}
                    getProductNumber={props.getProductNumber}
                    getLastOrderDate={props.getLastOrderDate}
                    renderRowActionsMenu={props.renderRowActionsMenu}
                    savingId={props.savingId}
                    savedId={props.savedId}
                    lastEditedId={props.lastEditedId}
                    getApprovedPar={getApprovedPar}
                    zoneStripEnabled={props.zoneStripEnabled}
                    getZoneStripConfig={props.getZoneStripConfig}
                    getZoneStripDraftResetNonce={props.getZoneStripDraftResetNonce}
                    onCommitZoneCount={props.onCommitZoneCount}
                    canEditPar={canEditPar}
                  />
                </Fragment>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
