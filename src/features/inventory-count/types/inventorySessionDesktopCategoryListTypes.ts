import type { KeyboardEvent, MutableRefObject, ReactNode } from "react";
import type { ListImperativeAPI } from "react-window";
import type { ZoneUnitOption } from "@/features/inventory-count/components/SessionItemZoneCountStrip";
import type { InventoryCatalogItemRow, InventorySessionItemRow } from "@/domain/inventory/enterInventoryTypes";
import type { SaveStockWithConversionPayload } from "@/features/inventory-count/hooks/useItemCommands";
import type { RiskThresholds } from "@/lib/inventory-utils";

export type ZoneStripConfig = { listCategoryId: string; unitOptions: ZoneUnitOption[] } | null;

export type InventorySessionDesktopCategoryListProps = {
  categoryLabel: string;
  catItems: InventorySessionItemRow[];
  globalIndexByItemId: Map<string, number>;
  riskThresholds: RiskThresholds;
  parColumnVisible: boolean;
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
  simplifyCountingRow: boolean;
  zoneStripEnabled: boolean;
  getZoneStripConfig: (item: InventorySessionItemRow) => ZoneStripConfig;
  getZoneStripDraftResetNonce: (itemId: string) => number;
  onCommitZoneCount: (
    item: InventorySessionItemRow,
    listCategoryId: string,
    qty: number,
    unit: string,
  ) => void | Promise<void>;
  /** Set when the category body is virtualized so keyboard nav can scroll rows into view. */
  virtualListRef?: (api: ListImperativeAPI | null) => void;
  /** When false, PAR levels cannot be edited and a lock is shown next to PAR values. */
  canEditPar?: boolean;
};
