import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Send } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatNum, inputDisplayValue, parseInputValue } from "@/lib/inventory-utils";
import {
  countBaseLabelForDualStock,
  parseUnitsPerPlanningUnitFromPackSize,
} from "@/domain/inventory/planningUnitMeta";
import { useHoldRepeat } from "@/features/inventory-count/hooks/useHoldRepeat";
import type { InventorySessionItemRow } from "@/domain/inventory/enterInventoryTypes";
import type { SaveStockWithConversionPayload } from "@/features/inventory-count/hooks/useItemCommands";

export type PhoneCountViewProps = {
  filteredItems: InventorySessionItemRow[];
  sortedCategoryKeys: string[];
  groupedItems: Record<string, InventorySessionItemRow[]>;
  countedItems: number;
  totalItems: number;
  progressPct: number;
  isCountingEditable: boolean;
  canCloudActions: boolean;
  submittingForReview: boolean;
  getApprovedPar: (item: InventorySessionItemRow) => number;
  getProductNumber: (item: InventorySessionItemRow) => string | null;
  getItemCategory: (item: InventorySessionItemRow) => string;
  onUpdateStock: (id: string, raw: string) => void;
  onSaveStock: (id: string, stock: number | null) => Promise<void>;
  onSaveStockWithConversion?: (
    id: string,
    payload: SaveStockWithConversionPayload,
  ) => Promise<void>;
  onSubmitClick: () => void;
};

type CountUnit = "CS" | "LBS" | "UNITS";

function casesFromUiQuantity(
  countUnit: CountUnit,
  parsed: number | null,
  unitsPerCase: number | null,
): number | null {
  if (parsed === null) return null;
  if (countUnit === "CS") return parsed;
  if (unitsPerCase == null || !Number.isFinite(unitsPerCase) || unitsPerCase <= 0) return parsed;
  return Math.round((parsed / unitsPerCase) * 1e6) / 1e6;
}

export function PhoneCountView({
  filteredItems,
  sortedCategoryKeys,
  groupedItems,
  countedItems,
  totalItems,
  progressPct,
  isCountingEditable,
  canCloudActions,
  submittingForReview,
  getApprovedPar,
  getProductNumber,
  getItemCategory,
  onUpdateStock,
  onSaveStock,
  onSaveStockWithConversion,
  onSubmitClick,
}: PhoneCountViewProps) {
  const [index, setIndex] = useState(0);
  const [slideDir, setSlideDir] = useState<"left" | "right" | null>(null);
  const [flashOk, setFlashOk] = useState(false);
  const [countUnit, setCountUnit] = useState<CountUnit>("CS");
  const inputRef = useRef<HTMLInputElement>(null);
  const touchStart = useRef<{ x: number; y: number } | null>(null);

  const item = filteredItems[index] ?? null;
  const rowPar = item ? getApprovedPar(item) : 0;
  const W = item ? parseUnitsPerPlanningUnitFromPackSize(item.pack_size) : null;
  const dual = W != null;
  const baseLabel = item ? countBaseLabelForDualStock(item.pack_size, item.unit) : "Units";

  const categoryLabel = item ? getItemCategory(item) : "";
  const categoryItems = useMemo(() => {
    if (!item) return [];
    for (const key of sortedCategoryKeys) {
      const list = groupedItems[key] ?? [];
      if (list.some((i) => i.id === item.id)) return list;
    }
    return [item];
  }, [item, sortedCategoryKeys, groupedItems]);

  const categoryIndex = item ? categoryItems.findIndex((i) => i.id === item.id) + 1 : 0;
  const categoryTotal = categoryItems.length;

  const unitOptions = useMemo((): CountUnit[] => {
    if (!item) return ["CS"];
    if (dual && W != null) return ["CS", "LBS"];
    const u = (item.unit || "").trim().toUpperCase();
    if (u === "LB" || u === "LBS") return ["LBS"];
    if (u === "EA" || u === "EACH" || u === "UNIT" || u === "UNITS") return ["UNITS"];
    return ["CS"];
  }, [item, dual, W]);

  useEffect(() => {
    if (!unitOptions.includes(countUnit)) setCountUnit(unitOptions[0]);
  }, [item?.id, unitOptions, countUnit]);

  useEffect(() => {
    setIndex((i) => Math.min(i, Math.max(0, filteredItems.length - 1)));
  }, [filteredItems.length]);

  const focusInput = useCallback(() => {
    requestAnimationFrame(() => {
      const el = inputRef.current;
      if (!el) return;
      el.focus();
      el.select();
    });
  }, []);

  useEffect(() => {
    focusInput();
  }, [index, item?.id, focusInput]);

  const persistCount = useCallback(
    async (stockVal: number | null) => {
      if (!item || !isCountingEditable) return;
      onUpdateStock(item.id, stockVal == null ? "" : String(stockVal));
      await onSaveStock(item.id, stockVal);
    },
    [item, isCountingEditable, onUpdateStock, onSaveStock],
  );

  const adjustCount = useCallback(
    (delta: number) => {
      if (!item || !isCountingEditable) return;
      const current = Number(item.current_stock ?? 0);
      const next = Math.max(0, current + delta);
      void persistCount(next);
    },
    [item, isCountingEditable, persistCount],
  );

  const minusHold = useHoldRepeat(() => adjustCount(-1));
  const plusHold = useHoldRepeat(() => adjustCount(1));

  const advance = useCallback(
    async (dir: "next" | "prev") => {
      if (filteredItems.length === 0) return;
      setSlideDir(dir === "next" ? "left" : "right");
      if (dir === "next") {
        setFlashOk(true);
        window.setTimeout(() => setFlashOk(false), 200);
      }
      setIndex((i) => {
        if (dir === "next") return Math.min(i + 1, filteredItems.length - 1);
        return Math.max(i - 1, 0);
      });
      window.setTimeout(() => setSlideDir(null), 100);
    },
    [filteredItems.length],
  );

  const goNext = useCallback(async () => {
    if (!item) return;
    const raw = inputRef.current?.value ?? "";
    const parsed = parseInputValue(raw);
    const cases = casesFromUiQuantity(countUnit, parsed, W);
    if (cases !== null) await persistCount(cases);
    if (index >= filteredItems.length - 1) {
      onSubmitClick();
      return;
    }
    await advance("next");
  }, [item, countUnit, W, persistCount, index, filteredItems.length, advance, onSubmitClick]);

  const goPrev = useCallback(() => {
    void advance("prev");
  }, [advance]);

  const skipZero = useCallback(async () => {
    await persistCount(0);
    if (index < filteredItems.length - 1) await advance("next");
  }, [persistCount, index, filteredItems.length, advance]);

  const onTouchStart = (e: React.TouchEvent) => {
    touchStart.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
  };

  const onTouchEnd = (e: React.TouchEvent) => {
    const start = touchStart.current;
    touchStart.current = null;
    if (!start) return;
    const dx = e.changedTouches[0].clientX - start.x;
    const dy = e.changedTouches[0].clientY - start.y;
    if (Math.abs(dx) < 60 || Math.abs(dy) > 75) return;
    if (dx < 0) void goNext();
    else void goPrev();
  };

  if (!item) {
    return (
      <div className="py-20 text-center text-sm text-muted-foreground">
        No items match your filters.
      </div>
    );
  }

  const sku = item.vendor_sku?.trim() || getProductNumber(item);
  const vendorLine = [item.vendor_name?.trim(), sku ? `#${sku}` : null, item.pack_size?.trim()]
    .filter(Boolean)
    .join(" · ");
  const displayVal =
    dual && countUnit === "LBS" && W != null
      ? (() => {
          const Qn = Number(item.current_stock ?? 0);
          return Qn === 0 ? "" : String(Math.round(Qn * W * 1e6) / 1e6);
        })()
      : inputDisplayValue(item.current_stock);

  const isLast = index >= filteredItems.length - 1;

  return (
    <div className="fixed inset-0 z-40 flex flex-col bg-background pt-16 pb-[60px]">
      {/* Top bar */}
      <div className="fixed top-16 left-0 right-0 z-50 bg-white border-b border-border/40">
        <div className="flex items-center justify-between px-4 h-11">
          <span className="text-sm font-semibold tabular-nums">
            {countedItems} / {totalItems}
          </span>
          <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground truncate max-w-[40%] text-center">
            {categoryLabel}
          </span>
          {countedItems > 0 ? (
            <Button
              size="sm"
              className="h-8 px-3 bg-gradient-orange text-white text-xs"
              disabled={!canCloudActions || submittingForReview}
              onClick={onSubmitClick}
            >
              <Send className="h-3 w-3 mr-1" />
              Submit
            </Button>
          ) : (
            <span className="w-16" />
          )}
        </div>
        <div className="h-1 w-full bg-muted/40">
          <div
            className="h-full bg-gradient-orange transition-all duration-300"
            style={{ width: `${progressPct}%` }}
          />
        </div>
      </div>

      {/* Item area */}
      <div
        className={cn(
          "flex-1 flex flex-col justify-center px-5 transition-transform duration-100",
          slideDir === "left" && "-translate-x-2 opacity-90",
          slideDir === "right" && "translate-x-2 opacity-90",
          flashOk && "bg-emerald-50/80",
        )}
        onTouchStart={onTouchStart}
        onTouchEnd={onTouchEnd}
      >
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
          {categoryLabel} · {categoryIndex} of {categoryTotal}
        </p>

        <h2 className="text-2xl font-bold leading-tight text-foreground break-words">
          {item.item_name}
        </h2>

        {vendorLine ? (
          <p className="text-xs text-muted-foreground mt-1">{vendorLine}</p>
        ) : null}

        {rowPar > 0 ? (
          <p className="text-sm text-muted-foreground mt-1">PAR: {formatNum(rowPar)}</p>
        ) : null}

        {unitOptions.length > 1 ? (
          <div className="mt-6 flex rounded-full border border-input p-1 gap-1">
            {unitOptions.map((u) => (
              <button
                key={u}
                type="button"
                disabled={!isCountingEditable}
                className={cn(
                  "flex-1 min-h-[44px] rounded-full text-sm font-semibold transition-colors",
                  countUnit === u
                    ? "bg-primary text-primary-foreground"
                    : "bg-background text-foreground border border-transparent",
                )}
                onClick={() => setCountUnit(u)}
              >
                {u === "CS" ? "Cases" : u === "LBS" ? "Weight" : "Units"}
              </button>
            ))}
          </div>
        ) : null}

        <div className="mt-6 flex items-center justify-center gap-4">
          <Button
            type="button"
            variant="outline"
            className="w-16 h-16 rounded-2xl text-2xl shrink-0"
            disabled={!isCountingEditable}
            {...minusHold}
          >
            −
          </Button>

          <Input
            ref={inputRef}
            inputMode="decimal"
            disabled={!isCountingEditable}
            defaultValue={displayVal}
            key={`${item.id}-${countUnit}`}
            className="w-[60%] max-w-xs text-6xl font-bold text-center border-2 rounded-2xl py-4 h-auto tabular-nums"
            onFocus={(e) => e.target.select()}
            onChange={(e) => onUpdateStock(item.id, e.target.value)}
            onBlur={async (e) => {
              const parsed = parseInputValue(e.target.value);
              const cases = casesFromUiQuantity(countUnit, parsed, W);
              await persistCount(cases);
            }}
          />

          <Button
            type="button"
            className="w-16 h-16 rounded-2xl text-2xl shrink-0 bg-gradient-orange text-white hover:opacity-90"
            disabled={!isCountingEditable}
            {...plusHold}
          >
            +
          </Button>
        </div>

        {isCountingEditable ? (
          <button
            type="button"
            className="mt-4 mx-auto text-xs text-muted-foreground underline"
            onClick={() => void skipZero()}
          >
            Skip (0)
          </button>
        ) : null}
      </div>

      {/* Bottom nav */}
      <div className="fixed bottom-0 left-0 right-0 z-50 h-[60px] bg-white border-t border-border/40 grid grid-cols-3 items-stretch safe-area-bottom">
        <button
          type="button"
          disabled={index === 0}
          className={cn(
            "text-sm font-medium",
            index === 0 ? "text-muted-foreground/40" : "text-foreground",
          )}
          onClick={goPrev}
        >
          ← PREV
        </button>
        <span className="flex items-center justify-center text-sm text-muted-foreground tabular-nums">
          {index + 1} / {totalItems}
        </span>
        {isLast ? (
          <button
            type="button"
            className="text-sm font-semibold bg-gradient-orange text-white"
            disabled={!canCloudActions || submittingForReview}
            onClick={() => void goNext()}
          >
            Submit ✓
          </button>
        ) : (
          <button
            type="button"
            className="text-sm font-semibold text-[hsl(25,95%,53%)]"
            onClick={() => void goNext()}
          >
            NEXT →
          </button>
        )}
      </div>
    </div>
  );
}
