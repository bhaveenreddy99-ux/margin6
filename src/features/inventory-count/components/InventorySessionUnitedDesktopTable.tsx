import { Fragment, useMemo } from "react";
import { InventorySessionCategoryCardList } from "@/features/inventory-count/components/InventorySessionCategoryCardList";
import {
  InventoryCountCategoryDivider,
  InventoryCountTableHeader,
  InventorySessionDesktopItemRows,
} from "@/features/inventory-count/components/InventorySessionDesktopItemRows";
import { INVENTORY_COUNT_MIN_WIDTH } from "@/domain/inventory/display/sessionDisplayHelpers";
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
  const { sortedCategoryKeys, groupedItems, globalIndexByItemId } = props;
  const canEditPar = props.canEditPar ?? true;

  const allItems = useMemo(
    () => sortedCategoryKeys.flatMap((k) => groupedItems[k] ?? []),
    [sortedCategoryKeys, groupedItems],
  );

  if (allItems.length === 0) {
    return <div className="py-16 text-center text-sm text-muted-foreground">No items in this list.</div>;
  }

  return (
    <div className="w-full">
      {/* ═══ PHONE only (<md) — unchanged compact card list per category ═══ */}
      <div className="md:hidden">
        {sortedCategoryKeys.map((catLabel) => {
          const catItems = groupedItems[catLabel] ?? [];
          if (!catItems.length) return null;
          const counted = catItems.filter(i => i.current_stock != null && Number(i.current_stock) > 0).length;
          const pct = catItems.length > 0 ? Math.round((counted / catItems.length) * 100) : 0;
          return (
            <Fragment key={catLabel}>
              <div className="sticky top-[var(--header-offset,96px)] z-10 flex items-center justify-between bg-[hsl(222,28%,9%)] px-4 py-2.5 border-b border-white/10">
                <div className="flex items-center gap-2">
                  <span className="text-[11px] font-bold uppercase tracking-widest text-white/70">{catLabel}</span>
                  <span className="rounded-full bg-white/10 px-1.5 py-0.5 font-mono text-[10px] text-white/50">{catItems.length}</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="h-1 w-12 overflow-hidden rounded-full bg-white/15">
                    <div className="h-full rounded-full bg-emerald-400 transition-all" style={{ width: `${pct}%` }} />
                  </div>
                  <span className="font-mono text-[10px] text-white/40 tabular-nums">{counted}/{catItems.length}</span>
                </div>
              </div>
              <InventorySessionCategoryCardList
                showParColumn={false}
                categoryLabel={catLabel}
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
                getApprovedPar={props.getApprovedPar}
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

      {/* ═══ TABLET + DESKTOP (≥md) — pure CSS grid, single shared column template ═══ */}
      <div className="hidden md:block w-full overflow-x-auto">
        <div style={{ minWidth: INVENTORY_COUNT_MIN_WIDTH }}>
          <InventoryCountTableHeader />
          {sortedCategoryKeys.map((catLabel) => {
            const catItems = groupedItems[catLabel] ?? [];
            if (!catItems.length) return null;
            const counted = catItems.filter(i => i.current_stock != null && Number(i.current_stock) > 0).length;
            return (
              <Fragment key={catLabel}>
                <InventoryCountCategoryDivider label={catLabel} total={catItems.length} counted={counted} />
                <InventorySessionDesktopItemRows
                  categoryLabel={catLabel}
                  catItems={catItems}
                  globalIndexByItemId={globalIndexByItemId}
                  riskThresholds={props.riskThresholds}
                  showParColumn={false}
                  colSpan={7}
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
                  getApprovedPar={props.getApprovedPar}
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
      </div>
    </div>
  );
}
