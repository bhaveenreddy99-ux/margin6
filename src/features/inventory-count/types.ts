import type {
  InventoryCatalogItemRow,
  InventoryListRow,
  InventorySessionListRow,
  ParGuideRow,
} from "@/domain/inventory/enterInventoryTypes";
import type { Dispatch, SetStateAction } from "react";

export type UseInventoryCountDataArgs = {
  currentRestaurantId: string | null | undefined;
  approvedFilter: string;
  selectedList: string;
  selectedPar: string;
  setSelectedPar: Dispatch<SetStateAction<string>>;
};

export type SessionMetaRow = Pick<
  InventorySessionListRow,
  "inventory_list_id" | "counting_par_guide_id"
>;

export type ListModeRow = Pick<InventoryListRow, "active_category_mode">;

export type SmartOrderSettingsRow = {
  red_threshold: number | null;
  yellow_threshold: number | null;
};

export type ParGuidePickerOption = Pick<ParGuideRow, "id" | "name" | "inventory_list_id">;

export type CatalogListLinkRow = Pick<InventoryCatalogItemRow, "id" | "inventory_list_id">;
