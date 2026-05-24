import { Fragment } from "react";
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
  phoneCompact?: boolean;
  hideCategoryHeaders?: boolean;
  inputResetKey?: number;
};

export function InventorySessionUnitedDesktopTable(props: InventorySessionUnitedDesktopTableProps) {
  const {
    sortedCategoryKeys,
    groupedItems,
    globalIndexByItemId,
    phoneCompact = false,
    hideCategoryHeaders = false,
    inputResetKey = 0,
  } = props;
  const canEditPar = props.canEditPar ?? true;

  const rowProps = {
    globalIndexByItemId,
    riskThresholds: props.riskThresholds,
    showParColumn: false,
    colSpan: 6,
    simplifyCountingRow: props.simplifyCountingRow,
    isCountingEditable: props.isCountingEditable,
    onUpdateStock: props.onUpdateStock,
    onSaveStock: props.onSaveStock,
    onSaveStockWithConversion: props.onSaveStockWithConversion,
    sessionUserId: props.sessionUserId,
    catalogById: props.catalogById,
    onKeyDown: props.onKeyDown,
    inputRefs: props.inputRefs,
    formatParColumnCell: props.formatParColumnCell,
    getProductNumber: props.getProductNumber,
    getLastOrderDate: props.getLastOrderDate,
    renderRowActionsMenu: props.renderRowActionsMenu,
    savingId: props.savingId,
    savedId: props.savedId,
    lastEditedId: props.lastEditedId,
    getApprovedPar: props.getApprovedPar,
    zoneStripEnabled: props.zoneStripEnabled,
    getZoneStripConfig: props.getZoneStripConfig,
    getZoneStripDraftResetNonce: props.getZoneStripDraftResetNonce,
    onCommitZoneCount: props.onCommitZoneCount,
    canEditPar,
    phoneCompact,
    inputResetKey,
  };

  return (
    <div className="w-full overflow-x-auto">
      <div style={{ minWidth: phoneCompact ? 320 : INVENTORY_COUNT_MIN_WIDTH }}>
        <InventoryCountTableHeader phoneCompact={phoneCompact} />
        {sortedCategoryKeys.map((catLabel) => {
          const catItems = groupedItems[catLabel] ?? [];
          if (!catItems.length) return null;
          const counted = catItems.filter(
            (i) => i.current_stock != null && Number(i.current_stock) > 0,
          ).length;
          const showCatHeader =
            !hideCategoryHeaders &&
            !phoneCompact &&
            catLabel !== "ALL ITEMS" &&
            sortedCategoryKeys.length > 1;

          return (
            <Fragment key={catLabel}>
              {showCatHeader ? (
                <InventoryCountCategoryDivider
                  label={catLabel}
                  total={catItems.length}
                  counted={counted}
                />
              ) : null}
              <InventorySessionDesktopItemRows
                categoryLabel={catLabel}
                catItems={catItems}
                {...rowProps}
              />
            </Fragment>
          );
        })}
      </div>
    </div>
  );
}
