import { computeOrderQty, formatCurrency, formatNum, getRisk, type RiskThresholds } from "@/lib/inventory-utils";
import { resolveSessionItemUnitPrice } from "@/domain/inventory/display/itemUnitPrice";
import { CountSheetItemStockField } from "@/features/inventory-count/components/CountSheetItemStockField";
import type { InventoryCatalogItemRow, InventorySessionItemRow } from "@/domain/inventory/enterInventoryTypes";
import type { SaveStockWithConversionPayload } from "@/features/inventory-count/hooks/useItemCommands";
import type { InventorySessionDesktopCategoryListProps } from "@/features/inventory-count/types/inventorySessionDesktopCategoryListTypes";
import { cn } from "@/lib/utils";
import { Lock } from "lucide-react";
import type { KeyboardEvent, MutableRefObject, ReactNode } from "react";

/* ─────────────────────────────────────────────────────────────
   STATUS PILL  (dot + label, no borders)
───────────────────────────────────────────────────────────── */
function StatusPill({ risk, needQty }: { risk: ReturnType<typeof getRisk>; needQty: number | null }) {
  if (risk.level === "NO_PAR")
    return <span className="text-[10px] font-medium text-muted-foreground/50">No PAR</span>;
  if (risk.level === "RED")
    return (
      <span className="inline-flex items-center gap-1 rounded-md bg-red-50 px-2 py-0.5 text-[11px] font-semibold text-red-700 dark:bg-red-950/40 dark:text-red-300">
        <span className="h-1.5 w-1.5 rounded-full bg-red-500 shrink-0" />
        {needQty != null && needQty > 0 ? `Need ${needQty}` : "Critical"}
      </span>
    );
  if (risk.level === "YELLOW")
    return (
      <span className="inline-flex items-center gap-1 rounded-md bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-700 dark:bg-amber-950/40 dark:text-amber-300">
        <span className="h-1.5 w-1.5 rounded-full bg-amber-500 shrink-0" />
        Under PAR
      </span>
    );
  return (
    <span className="inline-flex items-center gap-1 rounded-md bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
      <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 shrink-0" />
      At PAR
    </span>
  );
}

/* ─────────────────────────────────────────────────────────────
   TYPES  (shared across all layouts)
───────────────────────────────────────────────────────────── */
export type InventorySessionCategoryCardListProps = Omit<
  InventorySessionDesktopCategoryListProps,
  "virtualListRef"
> & { showParColumn: boolean };

type CardInnerProps = Omit<InventorySessionCategoryCardListProps, "catItems"> & {
  item: InventorySessionItemRow;
};

/* ─────────────────────────────────────────────────────────────
   CATEGORY CARD LIST  (public entry point)
───────────────────────────────────────────────────────────── */
export function InventorySessionCategoryCardList(props: InventorySessionCategoryCardListProps) {
  const { catItems, ...rest } = props;
  return (
    <div className="w-full max-w-full overflow-x-hidden animate-fade-in">
      {catItems.map((item) => (
        <PhoneFastRow key={item.id} item={item} {...rest} />
      ))}
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────
   PHONE  — fast-scan list row  (no cards, no collapsibles)
   Matches the reference: item name + meta on left, stepper +
   status on right, full-width count input below.
───────────────────────────────────────────────────────────── */
function PhoneFastRow({
  item,
  categoryLabel,
  globalIndexByItemId,
  riskThresholds,
  showParColumn,
  simplifyCountingRow,
  isCountingEditable,
  onUpdateStock,
  onSaveStock,
  onSaveStockWithConversion,
  sessionUserId,
  catalogById,
  onKeyDown,
  inputRefs,
  formatParColumnCell,
  getProductNumber,
  getLastOrderDate,
  renderRowActionsMenu,
  savingId,
  savedId,
  lastEditedId,
  getApprovedPar,
  zoneStripEnabled,
  getZoneStripConfig,
  getZoneStripDraftResetNonce,
  onCommitZoneCount,
  canEditPar = true,
}: CardInnerProps) {
  const globalIdx = globalIndexByItemId.get(item.id) ?? 0;
  const rowPar = getApprovedPar(item);
  const needQty = rowPar > 0 ? computeOrderQty(item.current_stock, rowPar, item.unit, item.pack_size) : null;
  const risk = getRisk(item.current_stock, rowPar, riskThresholds);
  const isCounted = item.current_stock != null && Number(item.current_stock) > 0;
  const cat = item.catalog_item_id ? (catalogById[item.catalog_item_id] ?? null) : null;
  const sku = item.vendor_sku?.trim() || getProductNumber(item);
  const isRecentlyEdited = lastEditedId === item.id;

  return (
    <div
      className={cn(
        "border-b border-border/40 px-4 py-3 transition-colors",
        isCounted && "bg-emerald-50/40 dark:bg-emerald-950/10",
        isRecentlyEdited && "bg-primary/[0.05] ring-inset ring-1 ring-primary/20",
        !isCounted && !isRecentlyEdited && "bg-background",
      )}
    >
      {/* Row 1: item info + status badge */}
      <div className="flex items-start justify-between gap-3 mb-2.5">
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-semibold leading-snug text-foreground truncate">{item.item_name}</p>
          <p className="text-[11px] text-muted-foreground/70 mt-0.5 truncate">
            {[item.vendor_name?.trim(), item.pack_size?.trim(), sku ? `#${sku}` : null]
              .filter(Boolean).join(" · ")}
          </p>
          {showParColumn && rowPar > 0 && (
            <p className="text-[11px] text-muted-foreground mt-0.5">
              PAR: <span className="font-mono font-semibold text-foreground">{formatParColumnCell(item)}</span>
              {!canEditPar && <Lock className="inline h-3 w-3 ml-1 text-muted-foreground" />}
            </p>
          )}
        </div>
        <div className="flex items-center gap-1 shrink-0 mt-0.5">
          <StatusPill risk={risk} needQty={needQty} />
          {renderRowActionsMenu(item)}
        </div>
      </div>

      {/* Row 2: count input — full width, tall, easy to tap */}
      <CountSheetItemStockField
        item={item}
        variant="card"
        isCountingEditable={isCountingEditable}
        simplifyCountingRow={simplifyCountingRow}
        onUpdateStock={onUpdateStock}
        onSaveStock={onSaveStock}
        onKeyDown={onKeyDown}
        globalIndex={globalIdx}
        inputRef={(el) => { inputRefs.current[item.id] = el; }}
        savingId={savingId}
        savedId={savedId}
        compactTable={false}
        userId={sessionUserId}
        categoryKey={categoryLabel}
        catalogItem={cat}
        zoneCountingActive={false}
        onSaveStockWithConversion={onSaveStockWithConversion}
        rowPar={rowPar}
        touchProfile="responsive"
      />
    </div>
  );
}
