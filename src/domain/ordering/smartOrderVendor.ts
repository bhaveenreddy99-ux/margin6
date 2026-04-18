/**
 * Mirrors `submit_smart_order` vendor resolution (weighted run lines, then list fallback)
 * so the UI can block submit before the RPC when no PO vendor can be chosen.
 */

export type SmartOrderRunItemForVendor = {
  suggested_order: number;
  catalog_item_id: string | null;
  item_name: string;
};

export type CatalogItemVendorFields = {
  id: string;
  vendor_name: string | null;
  inventory_list_id: string | null;
};

function trimVendor(v: string | null | undefined): string {
  return (v ?? "").trim();
}

export function canResolvePurchaseOrderVendor(
  runItems: SmartOrderRunItemForVendor[],
  inventoryListId: string | null,
  catalogById: Record<string, CatalogItemVendorFields>,
): boolean {
  const withOrder = runItems.filter((i) => Number(i.suggested_order) > 0);

  const fromRunLines = withOrder.some((line) => {
    if (!line.catalog_item_id) return false;
    return trimVendor(catalogById[line.catalog_item_id]?.vendor_name) !== "";
  });
  if (fromRunLines) return true;

  if (inventoryListId) {
    const fromList = Object.values(catalogById).some(
      (ci) =>
        ci.inventory_list_id === inventoryListId &&
        trimVendor(ci.vendor_name) !== "",
    );
    if (fromList) return true;
  }

  return false;
}

/** When {@link canResolvePurchaseOrderVendor} is false, sample names for operator messaging. */
export function sampleItemsMissingVendorForSubmit(
  runItems: SmartOrderRunItemForVendor[],
  catalogById: Record<string, CatalogItemVendorFields>,
  maxNames: number,
): string[] {
  const withOrder = runItems.filter((i) => Number(i.suggested_order) > 0);
  const names: string[] = [];
  for (const line of withOrder) {
    const vid = line.catalog_item_id;
    const hasVendor =
      vid && trimVendor(catalogById[vid]?.vendor_name) !== "";
    if (!hasVendor && names.length < maxNames && !names.includes(line.item_name)) {
      names.push(line.item_name);
    }
  }
  return names;
}

/**
 * More than one distinct non-empty vendor among order lines with suggested_order > 0
 * (catalog-backed). RPC `submit_smart_order` picks a single vendor — block mixed-vendor orders.
 */
export function analyzeMultiVendorBlockForSubmit(
  runItems: SmartOrderRunItemForVendor[],
  catalogById: Record<string, CatalogItemVendorFields>,
): { blocked: false } | { blocked: true; sampleVendors: string[] } {
  const names = new Set<string>();
  for (const line of runItems) {
    if (Number(line.suggested_order) <= 0) continue;
    const vid = line.catalog_item_id;
    if (!vid) continue;
    const v = trimVendor(catalogById[vid]?.vendor_name);
    if (v) names.add(v);
  }
  if (names.size <= 1) return { blocked: false };
  return { blocked: true, sampleVendors: [...names].sort((a, b) => a.localeCompare(b)) };
}

export function analyzeVendorBlockForSubmit(
  runItems: SmartOrderRunItemForVendor[],
  inventoryListId: string | null,
  catalogById: Record<string, CatalogItemVendorFields>,
):
  | { blocked: false }
  | { blocked: true; sampleNames: string[]; problemLineCount: number; listLevelOnly: boolean } {
  if (canResolvePurchaseOrderVendor(runItems, inventoryListId, catalogById)) {
    return { blocked: false };
  }
  const withOrder = runItems.filter((i) => Number(i.suggested_order) > 0);
  if (withOrder.length === 0) {
    return { blocked: true, sampleNames: [], problemLineCount: 0, listLevelOnly: true };
  }
  const problemLines = withOrder.filter((line) => {
    const vid = line.catalog_item_id;
    return !vid || trimVendor(catalogById[vid]?.vendor_name) === "";
  });
  const sampleNames = problemLines.slice(0, 5).map((l) => l.item_name);
  return { blocked: true, sampleNames, problemLineCount: problemLines.length, listLevelOnly: false };
}
