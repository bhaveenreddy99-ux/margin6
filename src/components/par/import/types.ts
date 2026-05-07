export type Step = "upload" | "mapping" | "review" | "done";

export type PARCanonicalField =
  | "item_name"
  | "par_level"
  | "category"
  | "unit"
  | "pack_size"
  | "vendor_sku";

export interface PARCanonicalFieldDef {
  key: PARCanonicalField;
  label: string;
  required?: boolean;
  numeric?: boolean;
}

export const PAR_CANONICAL_FIELDS: PARCanonicalFieldDef[] = [
  { key: "item_name", label: "Item Name", required: true },
  { key: "par_level", label: "PAR Level", required: true, numeric: true },
  { key: "vendor_sku", label: "Product Number" },
  { key: "pack_size", label: "Pack Size" },
  { key: "unit", label: "Unit / UOM" },
  { key: "category", label: "Category" },
];

export const PAR_LEVEL_SYNONYMS = [
  "par", "parlevel", "par_level", "par level", "target", "targetlevel",
  "target_level", "target level", "reorder", "reorderlevel", "min",
  "minimum", "minlevel", "min_level",
];

export type MatchType = "product_number" | "name_pack" | "name_only" | "unmatched";
export type UnmatchedAction = "import_anyway" | "map_to_catalog" | "skip";

export interface MatchedRow {
  rowIdx: number;
  itemName: string;
  parLevel: number | null;
  category: string | null;
  unit: string | null;
  packSize: string | null;
  vendorSku: string | null;
  matchType: MatchType;
  catalogItemId: string | null;
  catalogItemName: string | null;
  action: UnmatchedAction;
  manualCatalogId?: string;
}

export interface PARImportResult {
  created: number;
  updated: number;
  skipped: number;
  guidesCreated: number;
}
