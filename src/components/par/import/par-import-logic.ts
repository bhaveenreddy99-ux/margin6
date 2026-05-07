import {
  autoMapColumnsWithConfidence,
  validateNumericField,
  type CanonicalField,
  type FieldMapping,
  type VendorPreset,
} from "@/lib/vendor-presets";
import {
  PAR_CANONICAL_FIELDS,
  PAR_LEVEL_SYNONYMS,
  type MatchedRow,
  type MatchType,
  type PARCanonicalField,
} from "./types";

const PAR_FIELD_KEYS = new Set<string>(PAR_CANONICAL_FIELDS.map(f => f.key));

export function emptyPARMapping(): Record<PARCanonicalField, string | null> {
  return Object.fromEntries(
    PAR_CANONICAL_FIELDS.map(f => [f.key, null]),
  ) as Record<PARCanonicalField, string | null>;
}

export function parMappingsToRecord(
  mappings: FieldMapping[],
): Record<PARCanonicalField, string | null> {
  const rec = emptyPARMapping();
  for (const m of mappings) {
    if (PAR_FIELD_KEYS.has(m.field)) {
      rec[m.field as PARCanonicalField] = m.column;
    }
  }
  return rec;
}

export function truncate(val: unknown, max: number): string | null {
  if (val == null) return null;
  const s = String(val).trim();
  return s ? s.substring(0, max) : null;
}

export function autoMapPARFields(
  hdrs: string[],
  preset: VendorPreset,
  dataRows: Record<string, unknown>[],
): FieldMapping[] {
  const catalogMappings = autoMapColumnsWithConfidence(
    hdrs,
    preset,
    dataRows as Record<string, any>[],
  );
  const result: FieldMapping[] = [];
  const usedColumns = new Set<string>();

  for (const field of PAR_CANONICAL_FIELDS) {
    if (field.key === "par_level") {
      const normHeaders = hdrs.map(h => ({
        original: h,
        normalized: h.toLowerCase().replace(/[^a-z0-9]/g, ""),
      }));
      let bestMatch: { column: string; confidence: number; method: FieldMapping["method"] } | null = null;
      for (const syn of PAR_LEVEL_SYNONYMS) {
        const normSyn = syn.replace(/[^a-z0-9]/g, "");
        const match = normHeaders.find(h => h.normalized === normSyn && !usedColumns.has(h.original));
        if (match) { bestMatch = { column: match.original, confidence: 92, method: "synonym" }; break; }
      }
      if (!bestMatch) {
        for (const syn of PAR_LEVEL_SYNONYMS) {
          const normSyn = syn.replace(/[^a-z0-9]/g, "");
          if (normSyn.length < 3) continue;
          const match = normHeaders.find(h => h.normalized.includes(normSyn) && !usedColumns.has(h.original));
          if (match) { bestMatch = { column: match.original, confidence: 78, method: "synonym" }; break; }
        }
      }
      if (bestMatch) {
        usedColumns.add(bestMatch.column);
        result.push({ field: "par_level" as CanonicalField, ...bestMatch });
      } else {
        result.push({ field: "par_level" as CanonicalField, column: null, confidence: 0, method: "none" });
      }
    } else {
      const catalogMapping = catalogMappings.find(m => m.field === field.key);
      if (catalogMapping?.column && !usedColumns.has(catalogMapping.column)) {
        usedColumns.add(catalogMapping.column);
        result.push(catalogMapping);
      } else {
        result.push({ field: field.key as CanonicalField, column: null, confidence: 0, method: "none" });
      }
    }
  }
  return result;
}

export interface CatalogLookupItem {
  id: string;
  item_name: string;
  vendor_sku: string | null;
  pack_size: string | null;
  inventory_list_id: string | null;
}

export interface CatalogLookups {
  bySku: Map<string, CatalogLookupItem>;
  byNamePack: Map<string, CatalogLookupItem>;
  byName: Map<string, CatalogLookupItem>;
}

export function buildCatalogLookups(catalog: CatalogLookupItem[]): CatalogLookups {
  const bySku = new Map<string, CatalogLookupItem>();
  const byNamePack = new Map<string, CatalogLookupItem>();
  const byName = new Map<string, CatalogLookupItem>();
  for (const c of catalog) {
    if (c.vendor_sku) bySku.set(c.vendor_sku.toLowerCase().trim(), c);
    const nameKey = c.item_name.toLowerCase().trim();
    const namePackKey = `${nameKey}|${(c.pack_size || "").toLowerCase().trim()}`;
    if (!byNamePack.has(namePackKey)) byNamePack.set(namePackKey, c);
    if (!byName.has(nameKey)) byName.set(nameKey, c);
  }
  return { bySku, byNamePack, byName };
}

function getMappedValue(
  row: Record<string, unknown>,
  field: PARCanonicalField,
  mapping: Record<PARCanonicalField, string | null>,
): unknown {
  const col = mapping[field];
  return col ? (row[col] ?? null) : null;
}

export function matchRows(
  rows: Record<string, unknown>[],
  mapping: Record<PARCanonicalField, string | null>,
  lookups: CatalogLookups,
): MatchedRow[] {
  const { bySku, byNamePack, byName } = lookups;
  const matched: MatchedRow[] = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const itemName = truncate(getMappedValue(row, "item_name", mapping), 200);
    if (!itemName) continue;

    const parLevelRaw = getMappedValue(row, "par_level", mapping);
    const { parsed: parLevel } = validateNumericField(parLevelRaw);
    const category = truncate(getMappedValue(row, "category", mapping), 100);
    const unit = truncate(getMappedValue(row, "unit", mapping), 50);
    const packSize = truncate(getMappedValue(row, "pack_size", mapping), 100);
    const vendorSku = truncate(getMappedValue(row, "vendor_sku", mapping), 100);

    let matchType: MatchType = "unmatched";
    let catalogItemId: string | null = null;
    let catalogItemName: string | null = null;

    if (vendorSku) {
      const match = bySku.get(vendorSku.toLowerCase().trim());
      if (match) {
        matchType = "product_number";
        catalogItemId = match.id;
        catalogItemName = match.item_name;
      }
    }

    if (matchType === "unmatched") {
      const nameKey = itemName.toLowerCase().trim();
      const namePackKey = `${nameKey}|${(packSize || "").toLowerCase().trim()}`;
      const match = byNamePack.get(namePackKey);
      if (match) {
        matchType = "name_pack";
        catalogItemId = match.id;
        catalogItemName = match.item_name;
      }
    }

    if (matchType === "unmatched") {
      const match = byName.get(itemName.toLowerCase().trim());
      if (match) {
        matchType = "name_only";
        catalogItemId = match.id;
        catalogItemName = match.item_name;
      }
    }

    matched.push({
      rowIdx: i,
      itemName,
      parLevel,
      category,
      unit,
      packSize,
      vendorSku,
      matchType,
      catalogItemId,
      catalogItemName,
      action: "import_anyway",
    });
  }

  return matched;
}
