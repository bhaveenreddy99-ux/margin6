// Canonical fields for inventory catalog import (catalog-only)
export type CanonicalField =
  | "item_name"
  | "vendor_sku"
  | "category"
  | "unit"
  | "pack_size"
  | "unitCost"
  | "vendor_name"
  | "brand";

export const CANONICAL_FIELDS: { key: CanonicalField; label: string; required?: boolean; numeric?: boolean }[] = [
  { key: "item_name", label: "Item Name", required: true },
  { key: "vendor_sku", label: "Product Number" },
  { key: "category", label: "Category" },
  { key: "unit", label: "Unit / UOM" },
  { key: "pack_size", label: "Pack Size" },
  { key: "unitCost", label: "Unit Cost", numeric: true },
  { key: "vendor_name", label: "Vendor Name" },
  { key: "brand", label: "Brand" },
];

// ─── Ignored columns (belong to sessions / PAR, NOT catalog) ──────────
export const IGNORED_COLUMN_PATTERNS: string[] = [
  "currentstock", "current_stock", "current stock",
  "qty", "quantity", "qtyonhand", "qty on hand", "quantity on hand",
  "onhand", "on hand", "on_hand",
  "inventory", "count", "stock level", "stocklevel",
  "par", "parlevel", "par_level", "par level",
  "suggestedorder", "suggested_order", "suggested order", "orderqty", "order qty", "order_qty",
  "leadtime", "lead_time", "lead time", "leadtimedays", "lead_time_days",
];

/** Check if a header should be ignored (session/PAR data) */
export function isIgnoredColumn(header: string): boolean {
  const norm = header.toLowerCase().replace(/[^a-z0-9 _]/g, "").trim();
  return IGNORED_COLUMN_PATTERNS.some(p => norm === p || norm.replace(/[\s_]/g, "") === p.replace(/[\s_]/g, ""));
}

export type VendorPreset = {
  id: string;
  label: string;
  detectHeaders: string[];
  mappings: Partial<Record<CanonicalField, string[]>>;
  defaultVendorName?: string;
};

export const VENDOR_PRESETS: VendorPreset[] = [
  {
    id: "sysco",
    label: "Sysco",
    detectHeaders: ["sysco", "sysco item", "sysco brand", "supc", "sysco sku"],
    defaultVendorName: "Sysco",
    mappings: {
      item_name: ["item description", "description", "product description", "item", "material description"],
      vendor_sku: ["sysco item", "item number", "item #", "supc", "sku", "material number"],
      unitCost: ["price", "unit price", "net price", "last price", "cost", "extended price"],
      unit: ["uom", "unit", "measure", "order uom"],
      pack_size: ["pack", "pack size", "pack/size", "case pack"],
      category: ["category", "product category", "dept", "commodity"],
      brand: ["brand", "sysco brand", "mfg brand", "manufacturer"],
    },
  },
  {
    id: "usfoods",
    label: "US Foods",
    detectHeaders: ["us foods", "stock id", "usf"],
    defaultVendorName: "US Foods",
    mappings: {
      item_name: ["product description", "item description", "item", "description"],
      vendor_sku: ["item #", "item number", "stock id", "sku", "product code"],
      unitCost: ["last cost", "price", "unit cost", "net cost", "avg cost"],
      unit: ["uom", "unit", "selling unit"],
      pack_size: ["pack", "pack size", "case pack"],
      category: ["category", "dept", "department"],
      brand: ["brand", "mfg", "manufacturer"],
    },
  },
  {
    id: "performance",
    label: "Performance Foodservice",
    detectHeaders: ["performance", "pfg", "pfs"],
    defaultVendorName: "Performance Foodservice",
    mappings: {
      item_name: ["item description", "description", "product", "product name"],
      vendor_sku: ["item number", "item #", "sku", "product code"],
      unitCost: ["cost", "net cost", "unit price", "price"],
      unit: ["uom", "unit", "unit of measure"],
      pack_size: ["pack size", "pack", "case size"],
      category: ["category", "dept", "class"],
      brand: ["brand", "manufacturer", "mfg"],
    },
  },
  {
    id: "r365",
    label: "Restaurant365",
    detectHeaders: ["r365", "restaurant365"],
    defaultVendorName: "Restaurant365",
    mappings: {
      item_name: ["item name", "name", "product name", "item"],
      vendor_sku: ["item code", "item number", "sku", "product code"],
      unitCost: ["last cost", "average cost", "current cost", "cost"],
      unit: ["uom", "unit of measure", "unit"],
      category: ["category", "storage location", "department"],
      vendor_name: ["vendor", "primary vendor", "supplier"],
      pack_size: ["pack size", "pack", "case size"],
      brand: ["brand", "manufacturer"],
    },
  },
  {
    id: "generic",
    label: "Generic CSV/XLSX",
    detectHeaders: [],
    mappings: {},
  },
];

// ─── Synonym dictionary per canonical field ────────────────────────────
const FIELD_SYNONYMS: Record<CanonicalField, string[]> = {
  item_name: [
    "item", "itemname", "name", "product", "description", "itemdescription",
    "productdescription", "productname", "materialdescription", "itemdesc",
    "desc", "article", "articlename", "ingredient", "ingredientname",
  ],
  vendor_sku: [
    "sku", "item#", "itemnumber", "stockid", "supc", "productcode", "itemcode",
    "vendorsku", "materialnumber", "upc", "barcode", "partnumber", "partno",
    "catalogno", "catalognumber", "articlenumber",
  ],
  unitCost: [
    "cost", "unitcost", "price", "unitprice", "lastcost", "avgcost", "netprice",
    "averagecost", "currentcost", "extendedprice", "purchaseprice", "buyprice",
    "casecost", "eachcost",
  ],
  unit: [
    "uom", "unit", "measure", "unitofmeasure", "sellingunit", "orderuom",
    "packuom", "purchaseunit",
  ],
  category: [
    "category", "dept", "department", "group", "storagelocation", "class",
    "commodity", "subcategory", "productcategory", "section", "area",
  ],
  pack_size: [
    "pack", "packsize", "pack/size", "casesize", "casepack", "packagesize",
    "portionsize", "packqty", "packquantity", "itemsize", "unitsize", "size",
  ],
  vendor_name: [
    "vendor", "vendorname", "supplier", "primaryvendor", "suppliername",
    "distributor", "source",
  ],
  brand: [
    "brand", "brandname", "manufacturer", "mfg", "mfgbrand", "maker",
  ],
};

// ─── Utilities ─────────────────────────────────────────────────────────

function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** Simple Dice coefficient for bigram similarity */
function bigrams(s: string): Set<string> {
  const bg = new Set<string>();
  for (let i = 0; i < s.length - 1; i++) bg.add(s.substring(i, i + 2));
  return bg;
}

function diceCoefficient(a: string, b: string): number {
  const bgA = bigrams(a);
  const bgB = bigrams(b);
  if (bgA.size === 0 || bgB.size === 0) return 0;
  let intersection = 0;
  bgA.forEach(bg => { if (bgB.has(bg)) intersection++; });
  return (2 * intersection) / (bgA.size + bgB.size);
}

/** Create a normalized header fingerprint for template matching */
export function createHeaderFingerprint(headers: string[]): string {
  return headers.map(normalize).sort().join("|");
}

/** Detect vendor from headers */
export function detectVendor(headers: string[]): VendorPreset {
  const lowerHeaders = headers.map(h => h.toLowerCase().trim());
  const joinedHeaders = lowerHeaders.join(" ");

  for (const preset of VENDOR_PRESETS) {
    if (preset.id === "generic") continue;
    for (const detect of preset.detectHeaders) {
      if (joinedHeaders.includes(detect.toLowerCase())) {
        return preset;
      }
    }
  }
  return VENDOR_PRESETS.find(p => p.id === "generic")!;
}

// ─── Confidence-scored auto-mapping ────────────────────────────────────

export interface FieldMapping {
  field: CanonicalField;
  column: string | null;
  confidence: number; // 0-100
  method: "preset" | "synonym" | "fuzzy" | "type_inference" | "template" | "none";
}

/** Infer whether a column is likely numeric from sample data */
function inferColumnType(rows: Record<string, any>[], colName: string): "numeric" | "text" | "mixed" {
  const sample = rows.slice(0, 50);
  let numCount = 0;
  let textCount = 0;
  for (const row of sample) {
    const val = row[colName];
    if (val === "" || val == null) continue;
    const cleaned = String(val).replace(/[$,\s]/g, "");
    if (!isNaN(Number(cleaned)) && cleaned !== "") numCount++;
    else textCount++;
  }
  if (numCount > 0 && textCount === 0) return "numeric";
  if (textCount > 0 && numCount === 0) return "text";
  return "mixed";
}

/**
 * Enhanced auto-mapping with confidence scoring.
 * Ignores columns that match session/PAR patterns.
 * Uses: preset mappings → synonym exact → synonym contains → fuzzy similarity → type inference
 */
export function autoMapColumnsWithConfidence(
  headers: string[],
  preset: VendorPreset,
  rows: Record<string, any>[] = [],
  savedTemplate?: Record<CanonicalField, string | null> | null
): FieldMapping[] {
  // Filter out ignored columns from mapping candidates
  const eligibleHeaders = headers.filter(h => !isIgnoredColumn(h));
  const normalizedHeaders = eligibleHeaders.map(h => ({ original: h, normalized: normalize(h) }));
  const usedColumns = new Set<string>();
  const result: FieldMapping[] = [];

  for (const field of CANONICAL_FIELDS) {
    let bestMatch: { column: string; confidence: number; method: FieldMapping["method"] } | null = null;

    // 0. Check saved template first (highest priority)
    if (savedTemplate && savedTemplate[field.key]) {
      const templateCol = savedTemplate[field.key]!;
      if (eligibleHeaders.includes(templateCol) && !usedColumns.has(templateCol)) {
        bestMatch = { column: templateCol, confidence: 98, method: "template" };
      } else {
        const normTemplate = normalize(templateCol);
        for (const h of normalizedHeaders) {
          if (usedColumns.has(h.original)) continue;
          const sim = diceCoefficient(normTemplate, h.normalized);
          if (sim > 0.7 && (!bestMatch || sim * 100 > bestMatch.confidence)) {
            bestMatch = { column: h.original, confidence: Math.round(sim * 95), method: "template" };
          }
        }
      }
    }

    // 1. Preset mappings (confidence 90-95)
    if (!bestMatch || bestMatch.confidence < 90) {
      const presetSynonyms = preset.mappings[field.key] || [];
      for (const syn of presetSynonyms) {
        const normSyn = normalize(syn);
        const match = normalizedHeaders.find(h => h.normalized === normSyn && !usedColumns.has(h.original));
        if (match) {
          const conf = 95;
          if (!bestMatch || conf > bestMatch.confidence) {
            bestMatch = { column: match.original, confidence: conf, method: "preset" };
          }
          break;
        }
      }
    }

    // 2. Global synonym exact match (confidence 85-90)
    if (!bestMatch || bestMatch.confidence < 85) {
      const globalSyns = FIELD_SYNONYMS[field.key] || [];
      for (const syn of globalSyns) {
        const normSyn = normalize(syn);
        const match = normalizedHeaders.find(h => h.normalized === normSyn && !usedColumns.has(h.original));
        if (match) {
          const conf = 88;
          if (!bestMatch || conf > bestMatch.confidence) {
            bestMatch = { column: match.original, confidence: conf, method: "synonym" };
          }
          break;
        }
      }
    }

    // 3. Contains match (confidence 70-80)
    if (!bestMatch || bestMatch.confidence < 70) {
      const allSyns = [...(preset.mappings[field.key] || []), ...(FIELD_SYNONYMS[field.key] || [])];
      for (const syn of allSyns) {
        const normSyn = normalize(syn);
        if (normSyn.length < 3) continue;
        const match = normalizedHeaders.find(
          h => h.normalized.includes(normSyn) && !usedColumns.has(h.original)
        );
        if (match) {
          const conf = 75;
          if (!bestMatch || conf > bestMatch.confidence) {
            bestMatch = { column: match.original, confidence: conf, method: "synonym" };
          }
          break;
        }
      }
    }

    // 4. Fuzzy similarity (confidence 50-70)
    if (!bestMatch || bestMatch.confidence < 60) {
      const allSyns = [...(preset.mappings[field.key] || []), ...(FIELD_SYNONYMS[field.key] || [])];
      for (const h of normalizedHeaders) {
        if (usedColumns.has(h.original)) continue;
        for (const syn of allSyns) {
          const normSyn = normalize(syn);
          const sim = diceCoefficient(h.normalized, normSyn);
          if (sim > 0.6) {
            const conf = Math.round(sim * 70);
            if (!bestMatch || conf > bestMatch.confidence) {
              bestMatch = { column: h.original, confidence: conf, method: "fuzzy" };
            }
          }
        }
      }
    }

    // 5. Type inference for numeric fields (confidence 40-55)
    if ((!bestMatch || bestMatch.confidence < 40) && field.numeric && rows.length > 0) {
      for (const h of normalizedHeaders) {
        if (usedColumns.has(h.original)) continue;
        const colType = inferColumnType(rows, h.original);
        if (colType === "numeric") {
          const fieldNorm = normalize(field.key);
          const sim = diceCoefficient(h.normalized, fieldNorm);
          if (sim > 0.3) {
            const conf = Math.round(40 + sim * 15);
            if (!bestMatch || conf > bestMatch.confidence) {
              bestMatch = { column: h.original, confidence: conf, method: "type_inference" };
            }
          }
        }
      }
    }

    if (bestMatch) {
      usedColumns.add(bestMatch.column);
      result.push({ field: field.key, ...bestMatch });
    } else {
      result.push({ field: field.key, column: null, confidence: 0, method: "none" });
    }
  }

  return result;
}

/** Convert FieldMapping[] back to the simple Record form */
export function fieldMappingsToRecord(mappings: FieldMapping[]): Record<CanonicalField, string | null> {
  const result: Record<string, string | null> = {};
  for (const m of mappings) {
    result[m.field] = m.column;
  }
  return result as Record<CanonicalField, string | null>;
}

/** Calculate overall confidence score (weighted average, item_name counts extra) */
export function overallConfidence(mappings: FieldMapping[]): number {
  const mapped = mappings.filter(m => m.column !== null);
  if (mapped.length === 0) return 0;
  let totalWeight = 0;
  let weightedSum = 0;
  for (const m of mapped) {
    const weight = m.field === "item_name" ? 3 : 1;
    totalWeight += weight;
    weightedSum += m.confidence * weight;
  }
  return Math.round(weightedSum / totalWeight);
}

// Legacy compatibility wrapper
export function autoMapColumns(
  headers: string[],
  preset: VendorPreset
): Record<CanonicalField, string | null> {
  const mappings = autoMapColumnsWithConfidence(headers, preset);
  return fieldMappingsToRecord(mappings);
}

export function validateNumericField(value: any): { valid: boolean; parsed: number | null } {
  if (value === null || value === undefined || value === "") return { valid: true, parsed: null };
  const cleaned = String(value).replace(/[$,\s]/g, "");
  const num = Number(cleaned);
  if (isNaN(num)) return { valid: false, parsed: null };
  return { valid: true, parsed: num };
}
