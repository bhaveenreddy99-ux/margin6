import type { Database } from "@/integrations/supabase/types";
import type { InvoiceItem } from "@/components/invoices/types";
import {
  resolveInvoiceLineCatalogMatchStrict,
  type CatalogRowForInvoiceMatch,
} from "@/domain/invoices/resolveInvoiceLineCatalogMatch";

export type VendorMappingRow = Database["public"]["Tables"]["vendor_item_mappings"]["Row"];

type CatalogRow = CatalogRowForInvoiceMatch;

export type InvoiceLineForStrongMatch = {
  catalog_item_id: string | null;
  product_number: string | null;
  /** When set (e.g. future column or joined data), uses same SKU path as review. */
  vendor_sku?: string | null;
  match_status: string | null;
};

/**
 * Conservative auto-match for invoice lines (parsed drafts, etc.):
 * Delegates to {@link resolveInvoiceLineCatalogMatchStrict} — identity + SKU / mapping / unique catalog SKU only.
 * Does NOT use name-only or weak fuzzy matching.
 */
export function resolveStrongCatalogMatchForLine(
  line: InvoiceLineForStrongMatch,
  catalogItems: CatalogRow[],
  mappings: VendorMappingRow[],
): { catalog_item_id: string } | null {
  const id = resolveInvoiceLineCatalogMatchStrict(
    {
      catalog_item_id: line.catalog_item_id,
      product_number: line.product_number,
      vendor_sku: line.vendor_sku,
      match_status: line.match_status,
    },
    catalogItems,
    mappings,
  );
  if (id === null) return null;
  return { catalog_item_id: id };
}

/** Parsed CSV / AI tool row shape (minimal fields for UI + strong match). */
export type RawInvoiceLineInput = {
  product_number?: string | null;
  item_name?: string;
  quantity?: unknown;
  unit_cost?: unknown;
  line_total?: unknown;
  unit?: string | null;
  pack_size?: string | null;
  brand_name?: string | null;
};

/**
 * Build `InvoiceItem` rows from parsed import data using the same strong rules as intake
 * (shared strict resolver — no name-only matching).
 */
export function matchRawInvoiceLinesStrong(
  rawRows: RawInvoiceLineInput[],
  catalogItems: CatalogRow[],
  mappings: VendorMappingRow[],
): InvoiceItem[] {
  return rawRows.map((raw) => {
    const product_number =
      raw.product_number != null && String(raw.product_number).trim() !== ""
        ? String(raw.product_number).trim()
        : null;
    const qty = Number(raw.quantity);
    const unitCost = raw.unit_cost != null ? Number(raw.unit_cost) : null;
    const lineTotal = raw.line_total != null ? Number(raw.line_total) : null;

    const resolved = resolveStrongCatalogMatchForLine(
      {
        catalog_item_id: null,
        product_number,
        match_status: "UNMATCHED",
      },
      catalogItems,
      mappings,
    );

    const catalog_item_id = resolved?.catalog_item_id ?? null;
    const catalog_match_name = catalog_item_id
      ? catalogItems.find((c) => c.id === catalog_item_id)?.item_name
      : undefined;

    return {
      product_number,
      item_name: String(raw.item_name ?? ""),
      quantity: Number.isFinite(qty) ? qty : 0,
      unit_cost: unitCost != null && Number.isFinite(unitCost) ? unitCost : null,
      line_total: lineTotal != null && Number.isFinite(lineTotal) ? lineTotal : null,
      unit: raw.unit ?? null,
      pack_size: raw.pack_size ?? null,
      brand_name: raw.brand_name ?? null,
      catalog_item_id,
      match_status: catalog_item_id ? "MATCHED" : "UNMATCHED",
      catalog_match_name,
    };
  });
}
