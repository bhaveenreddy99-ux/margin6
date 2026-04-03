import { useCallback, useMemo } from "react";
import { InvoiceItem } from "./types";

type MatchableCatalogItem = {
  id: string;
  item_name: string;
  vendor_sku?: string | null;
  product_number?: string | null;
  brand_name?: string | null;
  unit?: string | null;
  pack_size?: string | null;
};

type PreparedCatalogItem = MatchableCatalogItem & {
  normalized_name: string;
  normalized_brand: string;
  normalized_unit: string;
  normalized_pack_size: string;
  normalized_identifiers: string[];
};

function normalizeMatchToken(value: string | null | undefined) {
  return (value ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function prepareCatalogItems(catalogItems: MatchableCatalogItem[]): PreparedCatalogItem[] {
  return (catalogItems ?? []).map((item) => ({
    ...item,
    item_name: item.item_name ?? "",
    normalized_name: normalizeMatchToken(item.item_name),
    normalized_brand: normalizeMatchToken(item.brand_name),
    normalized_unit: normalizeMatchToken(item.unit),
    normalized_pack_size: normalizeMatchToken(item.pack_size),
    normalized_identifiers: [
      normalizeMatchToken(item.vendor_sku),
      normalizeMatchToken(item.product_number),
    ].filter(Boolean),
  }));
}

function getUniqueCandidate(candidates: PreparedCatalogItem[]): PreparedCatalogItem | null {
  const uniqueById = Array.from(new Map(candidates.map((candidate) => [candidate.id, candidate])).values());
  return uniqueById.length === 1 ? uniqueById[0] : null;
}

function findCatalogMatch(
  item: InvoiceItem,
  preparedCatalogItems: PreparedCatalogItem[],
): PreparedCatalogItem | null {
  const productNumberKey = normalizeMatchToken(item.product_number);
  if (productNumberKey) {
    const skuMatch = getUniqueCandidate(
      preparedCatalogItems.filter((catalogItem) =>
        catalogItem.normalized_identifiers.includes(productNumberKey),
      ),
    );
    if (skuMatch) return skuMatch;
  }

  const normalizedName = normalizeMatchToken(item.item_name);
  if (!normalizedName) return null;

  const exactNameCandidates = preparedCatalogItems.filter(
    (catalogItem) => catalogItem.normalized_name === normalizedName,
  );
  if (exactNameCandidates.length === 0) return null;

  let narrowedCandidates = exactNameCandidates;
  const narrowingRules = [
    { invoiceValue: normalizeMatchToken(item.pack_size), catalogField: "normalized_pack_size" as const },
    { invoiceValue: normalizeMatchToken(item.brand_name), catalogField: "normalized_brand" as const },
    { invoiceValue: normalizeMatchToken(item.unit), catalogField: "normalized_unit" as const },
  ];

  for (const rule of narrowingRules) {
    if (!rule.invoiceValue) continue;
    const nextCandidates = narrowedCandidates.filter(
      (catalogItem) => catalogItem[rule.catalogField] === rule.invoiceValue,
    );
    if (nextCandidates.length > 0) {
      narrowedCandidates = nextCandidates;
    }
  }

  return getUniqueCandidate(narrowedCandidates);
}

function createInvoiceItem(raw: any): InvoiceItem {
  return {
    product_number: raw.product_number || null,
    item_name: raw.item_name || "",
    quantity: Number(raw.quantity) || 0,
    unit_cost: raw.unit_cost != null ? Number(raw.unit_cost) : null,
    line_total: raw.line_total != null ? Number(raw.line_total) : null,
    unit: raw.unit || null,
    pack_size: raw.pack_size || null,
    brand_name: raw.brand_name || null,
    catalog_item_id: null,
    match_status: "UNMATCHED",
  };
}

function applyCatalogMatch(item: InvoiceItem, preparedCatalogItems: PreparedCatalogItem[]): InvoiceItem {
  const catalogMatch = findCatalogMatch(item, preparedCatalogItems);
  if (!catalogMatch) return item;

  return {
    ...item,
    catalog_item_id: catalogMatch.id,
    match_status: "MATCHED",
    catalog_match_name: catalogMatch.item_name,
  };
}

export function matchInvoiceItems(rawItems: any[], catalogItems: MatchableCatalogItem[]): InvoiceItem[] {
  const preparedCatalogItems = prepareCatalogItems(catalogItems);
  return rawItems.map((raw) => applyCatalogMatch(createInvoiceItem(raw), preparedCatalogItems));
}

export function useInvoiceMatching(catalogItems: MatchableCatalogItem[]) {
  const preparedCatalogItems = useMemo(() => prepareCatalogItems(catalogItems), [catalogItems]);

  const matchItems = useCallback((rawItems: any[]): InvoiceItem[] => {
    return rawItems.map((raw) => applyCatalogMatch(createInvoiceItem(raw), preparedCatalogItems));
  }, [preparedCatalogItems]);

  return { matchItems };
}
