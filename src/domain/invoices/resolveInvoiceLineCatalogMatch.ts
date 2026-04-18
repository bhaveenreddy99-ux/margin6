import type { Database } from "@/integrations/supabase/types";

export type VendorMappingRow = Database["public"]["Tables"]["vendor_item_mappings"]["Row"];

export type CatalogRowForInvoiceMatch = {
  id: string;
  item_name: string;
  vendor_sku?: string | null;
  product_number?: string | null;
};

/** Same normalization as review UI (alphanumeric only) for unique catalog name match. */
export function normalizeInvoiceNameKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * SKU / dictionary path shared by intake (strict) and review (strict + extensions).
 * product_number or vendor_sku → mapping.vendor_sku, else unique catalog hit on product_number or vendor_sku.
 */
export function matchInvoiceLineSkuPath(
  catalogItems: CatalogRowForInvoiceMatch[],
  mappings: VendorMappingRow[],
  product_number: string | null | undefined,
  vendor_sku: string | null | undefined,
): string | null {
  const skuRaw = (product_number ?? vendor_sku ?? "").trim();
  if (!skuRaw) return null;

  const skuLower = skuRaw.toLowerCase();
  const mapMatches = mappings.filter(
    (m) => m.vendor_sku?.toLowerCase() === skuLower && m.catalog_item_id,
  );
  const distinctMapCatalogIds = new Set(mapMatches.map((m) => m.catalog_item_id!));
  if (distinctMapCatalogIds.size > 1) return null;
  if (distinctMapCatalogIds.size === 1) return [...distinctMapCatalogIds][0];

  const catBySku = catalogItems.filter(
    (c) =>
      (c.product_number && c.product_number.toLowerCase() === skuLower) ||
      (c.vendor_sku && c.vendor_sku.toLowerCase() === skuLower),
  );
  if (catBySku.length === 1) return catBySku[0].id;

  return null;
}

export type StrictInvoiceLineMatchInput = {
  catalog_item_id: string | null;
  product_number: string | null;
  /** When present (e.g. legacy / PH lines), participates like review. */
  vendor_sku?: string | null;
  match_status: string | null;
};

/**
 * Intake / draft auto-match: same trust rules as legacy strong match.
 * MANUAL → no match; MATCHED + id → no re-match; explicit id → identity; else SKU path only.
 */
export function resolveInvoiceLineCatalogMatchStrict(
  line: StrictInvoiceLineMatchInput,
  catalogItems: CatalogRowForInvoiceMatch[],
  mappings: VendorMappingRow[],
): string | null {
  if (line.match_status === "MANUAL") return null;

  if (line.match_status === "MATCHED" && line.catalog_item_id) return null;

  if (line.catalog_item_id) {
    return line.catalog_item_id;
  }

  return matchInvoiceLineSkuPath(catalogItems, mappings, line.product_number, line.vendor_sku);
}

export type ReviewInvoiceLineMatchInput = {
  catalog_item_id?: string | null;
  vendor_sku?: string | null;
  product_number?: string | null;
  item_name: string;
};

/**
 * Review / comparison: strict SKU path first, then learned vendor_item_name, then unique normalized catalog name.
 */
export function resolveInvoiceLineCatalogMatchReview(
  line: ReviewInvoiceLineMatchInput,
  catalogItems: CatalogRowForInvoiceMatch[],
  mappings: VendorMappingRow[],
): string | null {
  if (line.catalog_item_id) return line.catalog_item_id;

  const bySku = matchInvoiceLineSkuPath(catalogItems, mappings, line.product_number, line.vendor_sku);
  if (bySku) return bySku;

  const nameTrim = line.item_name?.toLowerCase().trim() ?? "";
  const vendorNameMatches = mappings.filter(
    (m) => m.vendor_item_name?.toLowerCase().trim() === nameTrim && m.catalog_item_id,
  );
  const distinctVendorNameIds = new Set(vendorNameMatches.map((m) => m.catalog_item_id!));
  if (distinctVendorNameIds.size > 1) return null;
  if (distinctVendorNameIds.size === 1) return [...distinctVendorNameIds][0];

  const nameKey = normalizeInvoiceNameKey(line.item_name || "");
  if (nameKey) {
    const catByName = catalogItems.filter((c) => normalizeInvoiceNameKey(c.item_name || "") === nameKey);
    if (catByName.length === 1) return catByName[0].id;
  }

  return null;
}
