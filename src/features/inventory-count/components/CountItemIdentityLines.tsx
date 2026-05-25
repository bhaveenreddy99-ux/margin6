import {
  formatCountItemSkuPackLine,
  resolveSessionItemBrandName,
} from "@/domain/inventory/display/sessionItemIdentity";
import { formatLastOrdered } from "@/domain/inventory/display/sessionDisplayHelpers";
import type { InventoryCatalogItemRow, InventorySessionItemRow } from "@/domain/inventory/enterInventoryTypes";
import { cn } from "@/lib/utils";

type CountItemIdentityLinesProps = {
  item: InventorySessionItemRow;
  catalog: InventoryCatalogItemRow | null;
  getProductNumber: (item: InventorySessionItemRow) => string | null;
  showLastOrdered?: boolean;
  lastIso?: string | null;
  lastRecent?: boolean;
};

export function CountItemIdentityLines({
  item,
  catalog,
  getProductNumber,
  showLastOrdered = false,
  lastIso = null,
  lastRecent = false,
}: CountItemIdentityLinesProps) {
  const sku = item.vendor_sku?.trim() || getProductNumber(item);
  const skuPackLine = formatCountItemSkuPackLine(sku, item.pack_size);
  const brandName = resolveSessionItemBrandName(item, catalog);

  return (
    <>
      <p className="text-sm font-semibold truncate max-w-[180px] text-foreground">{item.item_name}</p>
      {skuPackLine ? (
        <p className="text-xs text-muted-foreground mt-px truncate max-w-[180px]">{skuPackLine}</p>
      ) : null}
      {brandName ? (
        <p className="text-xs font-medium text-orange-600 mt-px truncate max-w-[180px]">{brandName}</p>
      ) : null}
      {showLastOrdered ? (
        <p
          className={cn(
            "text-[10px] mt-px",
            lastRecent ? "text-[#f97316]" : "text-muted-foreground",
          )}
        >
          Last: {formatLastOrdered(lastIso)}
        </p>
      ) : null}
    </>
  );
}
