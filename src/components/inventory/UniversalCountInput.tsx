import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { FocusEvent, KeyboardEvent, Ref } from "react";
import { Input } from "@/components/ui/input";
import { formatPackSize } from "@/domain/inventory/display/sessionDisplayHelpers";
import type { InventoryCatalogItemRow, InventorySessionItemRow } from "@/domain/inventory/enterInventoryTypes";
import {
  buildContextualCountSentence,
  buildConversionLines,
  convertToCases,
  countUnitsButtonLabel,
  getDisplayValue,
  getPackFromCatalogItem,
} from "@/lib/inventory-conversions";
import type { CountInput } from "@/lib/inventory-conversions";
import type { PackStructure } from "@/lib/pack-parser";
import { parseInputValue } from "@/lib/inventory-utils";
import { cn } from "@/lib/utils";
import { Check, Info } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { SaveStockWithConversionPayload } from "@/features/inventory-count/hooks/useItemCommands";

const SAVE_DEBOUNCE_MS = (() => {
  const n = Number(import.meta.env.VITE_COUNT_SAVE_DEBOUNCE_MS);
  return Number.isFinite(n) && n >= 200 && n <= 10_000 ? n : 1000;
})();

const toggleBtn = cn(
  "min-h-11 flex-1 rounded-lg border px-2 text-xs font-semibold transition-colors",
  "border-gray-200 bg-gray-100 text-gray-700 hover:bg-gray-200",
  "dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700",
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/30 focus-visible:ring-offset-2 focus-visible:ring-offset-background",
  "disabled:pointer-events-none disabled:opacity-50",
);
const toggleBtnActive = "border-blue-600 bg-blue-600 text-white shadow-sm hover:bg-blue-600 dark:hover:bg-blue-600";

const laptopToggle = cn(
  "shrink-0 rounded-md border px-1.5 h-7 min-h-7 text-[10px] font-semibold transition-colors",
  "border-gray-200 bg-gray-100 text-gray-700 hover:bg-gray-200",
  "dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700",
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/30 focus-visible:ring-offset-2 focus-visible:ring-offset-background",
  "disabled:pointer-events-none disabled:opacity-50",
);
const laptopToggleActive = "border-blue-600 bg-blue-600 text-white shadow-sm hover:bg-blue-600 dark:hover:bg-blue-600";

export type CountTouchProfile = "default" | "responsive" | "mobile" | "tablet";

function touchClassesForToggles(
  touchProfile: CountTouchProfile,
  variant: "desktop" | "card",
  compactTable: boolean,
): string | null {
  if (compactTable || variant !== "card") return null;
  switch (touchProfile) {
    case "mobile":
      return "min-h-[50px] min-w-[3rem] text-sm sm:text-sm";
    case "tablet":
      return "min-h-14 min-w-[3rem] text-sm";
    case "responsive":
      return "min-h-[50px] min-w-[3rem] text-sm sm:min-h-14 sm:text-sm";
    default:
      return null;
  }
}

function touchClassesForInput(
  touchProfile: CountTouchProfile,
  variant: "desktop" | "card",
  compactTable: boolean,
  inputClass: string,
): string {
  if (compactTable || variant !== "card" || touchProfile === "default") {
    return inputClass;
  }
  const base =
    "w-full min-w-0 text-center font-mono font-semibold text-gray-900 rounded-lg border-2 border-gray-300 " +
    "[appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none " +
    "focus-visible:border-blue-500 focus-visible:ring-2 focus-visible:ring-blue-500/25";
  if (touchProfile === "mobile") {
    return cn(base, "min-h-[50px] h-[50px] text-lg px-4");
  }
  if (touchProfile === "tablet") {
    return cn(base, "h-14 min-h-[50px] text-base px-3");
  }
  if (touchProfile === "responsive") {
    return cn(base, "min-h-[50px] h-[50px] text-lg px-4 sm:h-14 sm:min-h-[50px]");
  }
  return inputClass;
}

function showUnitsOption(pack: PackStructure): boolean {
  return pack.unitsPerCase > 1;
}

function showWeightOption(pack: PackStructure): boolean {
  if (pack.isWeightBased) return true;
  return ["gal", "l", "fl_oz", "ml", "pt", "qt"].includes(pack.unitType);
}

type CountMode = CountInput["unit"];

function parseUnitFromDisplay(u: string): CountMode {
  if (u === "weight" || u === "units") return u;
  return "cases";
}

export type UniversalCountInputProps = {
  item: InventorySessionItemRow;
  catalogItem: InventoryCatalogItemRow | null;
  variant: "desktop" | "card";
  compactTable?: boolean;
  isCountingEditable: boolean;
  rowPar: number;
  onUpdateStock: (id: string, raw: string) => void;
  onSaveStockWithConversion: (id: string, payload: SaveStockWithConversionPayload) => void | Promise<void>;
  onKeyDown: (event: KeyboardEvent, index: number, field?: "stock") => void;
  globalIndex: number;
  inputRef: Ref<HTMLInputElement | null>;
  savingId: string | null;
  savedId: string | null;
  showItemHeader?: boolean;
  /** Larger tap targets for card layout on small screens. */
  touchProfile?: CountTouchProfile;
  /** `laptop` = inline toggles, conversion in tooltip (use with `compactTable`). */
  countDensity?: "default" | "laptop" | "tablet";
};

export function UniversalCountInput({
  item,
  catalogItem,
  variant,
  compactTable = false,
  isCountingEditable,
  rowPar,
  onUpdateStock,
  onSaveStockWithConversion,
  onKeyDown,
  globalIndex,
  inputRef,
  savingId,
  savedId,
  showItemHeader = true,
  touchProfile = "default",
  countDensity = "default",
}: UniversalCountInputProps) {
  const pack: PackStructure = useMemo(
    () =>
      catalogItem != null
        ? getPackFromCatalogItem(catalogItem)
        : getPackFromCatalogItem({ pack_size: item.pack_size ?? "EACH" }),
    [catalogItem, item.pack_size],
  );

  const [countMode, setCountMode] = useState<CountMode>("cases");
  const [rawInput, setRawInput] = useState("");
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /**
   * Tracks the case-equivalent value this component last pushed to the parent.
   * Used to distinguish "the parent's `current_stock` change came from us
   * (typing/save round-trip)" from "the parent reset us externally (Clear All
   * Counts, server reload, optimistic rollback)". On external resets the local
   * `rawInput` is rebuilt from `item.current_stock`; on round-trips it isn't
   * (otherwise typing in `weight` or `units` mode would be clobbered when the
   * parent updates the case-equivalent stock).
   */
  const lastPushedCasesRef = useRef<number | null>(null);

  // Initial sync when the row identity changes (mount, or row swap).
  useEffect(() => {
    const d = getDisplayValue({
      current_stock: item.current_stock,
      counted_as: item.counted_as,
      counted_value: item.counted_value,
    });
    setCountMode(parseUnitFromDisplay(d.unit));
    setRawInput(d.value === 0 ? "" : String(d.value));
    lastPushedCasesRef.current =
      item.current_stock == null || Number(item.current_stock) === 0
        ? null
        : Number(item.current_stock);
  }, [item.id]);

  // External-change sync: detect when `item.current_stock` differs from what we
  // last pushed and resync local state. This catches Clear All Counts and
  // server reloads without breaking active typing.
  useEffect(() => {
    const incoming =
      item.current_stock == null || Number(item.current_stock) === 0
        ? null
        : Number(item.current_stock);
    if (incoming === lastPushedCasesRef.current) return;
    const d = getDisplayValue({
      current_stock: item.current_stock,
      counted_as: item.counted_as,
      counted_value: item.counted_value,
    });
    setCountMode(parseUnitFromDisplay(d.unit));
    setRawInput(d.value === 0 ? "" : String(d.value));
    lastPushedCasesRef.current = incoming;
  }, [item.current_stock, item.counted_as, item.counted_value]);

  const parsedValue = useMemo(() => parseInputValue(rawInput), [rawInput]);
  const inputInvalid = useMemo(() => {
    const t = rawInput.trim();
    if (t === "" || t === "." || t === "-") return false;
    return parsedValue === null;
  }, [rawInput, parsedValue]);

  const conversion = useMemo(() => {
    if (parsedValue === null) {
      return convertToCases({ value: 0, unit: countMode }, pack);
    }
    return convertToCases({ value: parsedValue, unit: countMode }, pack);
  }, [parsedValue, countMode, pack]);

  const displayLines = useMemo(() => {
    if (parsedValue === null || rawInput.trim() === "") {
      return {
        sentence: "",
        line1: "—",
        line2: "",
        line3: "",
      };
    }
    const c = convertToCases({ value: parsedValue, unit: countMode }, pack);
    const lines = buildConversionLines(c.casesValue, pack);
    const sentence = buildContextualCountSentence({
      rawValue: parsedValue,
      countMode,
      pack,
      casesValue: c.casesValue,
    });
    return { sentence, ...lines };
  }, [parsedValue, rawInput, countMode, pack]);

  const pushCasesToParent = useCallback(
    (nextRaw: string, mode: CountMode) => {
      const p = parseInputValue(nextRaw);
      if (nextRaw.trim() === "") {
        lastPushedCasesRef.current = null;
        onUpdateStock(item.id, "");
        return;
      }
      if (p === null) return;
      const c = convertToCases({ value: p, unit: mode }, pack);
      lastPushedCasesRef.current = c.casesValue === 0 ? null : c.casesValue;
      onUpdateStock(item.id, String(c.casesValue));
    },
    [item.id, onUpdateStock, pack],
  );

  const flushSave = useCallback(
    (modeOverride?: CountMode) => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
        debounceRef.current = null;
      }
      const mode = modeOverride ?? countMode;
      const p = parseInputValue(rawInput);
      if (rawInput.trim() !== "" && p === null) return;
      if (p === null || rawInput.trim() === "") {
        void onSaveStockWithConversion(item.id, {
          cases: null,
          countedAs: null,
          rawValue: null,
          formula: null,
        });
        return;
      }
      const c = convertToCases({ value: p, unit: mode }, pack);
      void onSaveStockWithConversion(item.id, {
        cases: c.casesValue,
        countedAs: mode,
        rawValue: p,
        formula: c.formula,
      });
    },
    [item.id, onSaveStockWithConversion, rawInput, countMode, pack],
  );

  const scheduleSave = useCallback(
    (modeOverride?: CountMode) => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        flushSave(modeOverride);
        debounceRef.current = null;
      }, SAVE_DEBOUNCE_MS);
    },
    [flushSave],
  );

  useEffect(
    () => () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    },
    [],
  );

  const onBlurInput = (_e: FocusEvent<HTMLInputElement>) => {
    const p = parseInputValue(rawInput);
    if (rawInput.trim() !== "" && p === null) return;
    flushSave();
  };

  const onChangeInput = (v: string) => {
    setRawInput(v);
    const p = parseInputValue(v);
    if (v.trim() === "") {
      lastPushedCasesRef.current = null;
      onUpdateStock(item.id, "");
      scheduleSave();
      return;
    }
    if (p === null) return;
    pushCasesToParent(v, countMode);
    scheduleSave();
  };

  const setMode = (m: CountMode) => {
    setCountMode(m);
    const p = parseInputValue(rawInput);
    if (rawInput.trim() !== "" && p === null) return;
    pushCasesToParent(rawInput, m);
    scheduleSave(m);
  };

  const unitsLabel = countUnitsButtonLabel(pack);
  const showUnits = showUnitsOption(pack);
  const showWeight = showWeightOption(pack);

  const parLine = useMemo(() => {
    if (rowPar <= 0) return "No PAR set";
    const cv = conversion.casesValue;
    if (cv > rowPar) return `${cv.toFixed(2)} cs vs ${rowPar} par (over)`;
    if (cv < rowPar) return `${cv.toFixed(2)} cs vs ${rowPar} par (under)`;
    return `${cv.toFixed(2)} cs matches ${rowPar} par`;
  }, [conversion.casesValue, rowPar]);

  const isLaptopDensity = countDensity === "laptop" && compactTable;

  const laptopConversionTooltip = useMemo(() => {
    if (!isLaptopDensity) return "";
    const parts: string[] = [];
    if (rawInput.trim() !== "" && parsedValue !== null) {
      if (displayLines.sentence) parts.push(displayLines.sentence);
      if (displayLines.line1 && displayLines.line1 !== "—") parts.push(displayLines.line1);
      if (displayLines.line2?.trim()) parts.push(displayLines.line2);
      if (displayLines.line3?.trim()) parts.push(displayLines.line3);
    }
    if (rowPar > 0 && rawInput.trim() !== "" && parsedValue !== null) {
      parts.push(parLine);
    } else if (rowPar > 0 && (rawInput.trim() === "" || parsedValue === null)) {
      parts.push(`Counting PAR: ${rowPar} cases`);
    }
    return parts.join("\n").trim();
  }, [
    isLaptopDensity,
    rawInput,
    parsedValue,
    displayLines.sentence,
    displayLines.line1,
    displayLines.line2,
    displayLines.line3,
    rowPar,
    parLine,
  ]);

  const inputClassBase = isLaptopDensity
    ? `h-7 w-[4.5rem] min-w-[3.5rem] max-w-[5.5rem] rounded-md border border-gray-300 bg-background px-1.5 text-center font-mono text-xs font-semibold tabular-nums text-gray-900
      [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none
      focus-visible:border-blue-500 focus-visible:ring-1 focus-visible:ring-blue-500/25`
    : compactTable
      ? `h-8 w-full min-w-[4.5rem] max-w-[7rem] rounded-md border border-gray-300 bg-background px-2 text-center font-mono text-sm font-semibold tabular-nums text-gray-900
        [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none
        focus-visible:border-blue-500 focus-visible:ring-1 focus-visible:ring-blue-500/25`
      : variant === "card"
        ? `h-12 w-full min-w-0 text-lg font-mono text-center font-semibold rounded-lg border-2 border-gray-300 text-gray-900
          focus-visible:border-blue-500 focus-visible:ring-2 focus-visible:ring-blue-500/25
          [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none`
        : `w-full max-w-[6rem] rounded-lg border-2 border-gray-300 bg-background text-center font-mono text-base font-semibold text-gray-900
          [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none
          h-11 focus-visible:border-blue-500 focus-visible:ring-2 focus-visible:ring-blue-500/25`;

  const inputClass = touchClassesForInput(
    touchProfile,
    variant,
    compactTable,
    inputClassBase,
  );

  const toggleTouchExtra = touchClassesForToggles(touchProfile, variant, compactTable);

  const onKeyDownInput = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      setRawInput("");
      lastPushedCasesRef.current = null;
      onUpdateStock(item.id, "");
      void onSaveStockWithConversion(item.id, {
        cases: null,
        countedAs: null,
        rawValue: null,
        formula: null,
      });
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
        debounceRef.current = null;
      }
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      flushSave();
    }
    onKeyDown(e, globalIndex, "stock");
  };

  return (
    <div
      className={cn(
        "flex w-full min-w-0 flex-col",
        isLaptopDensity
          ? "gap-0.5"
          : compactTable
            ? "items-stretch gap-2"
            : variant === "desktop"
              ? "max-w-[14rem] gap-2"
              : "gap-4",
      )}
    >
      {showItemHeader && !compactTable && (
        <div className="min-w-0">
          <p className="truncate text-xs font-semibold leading-tight text-gray-900 dark:text-foreground">
            {item.item_name}
          </p>
          <p className="font-mono text-[10px] text-gray-600 dark:text-muted-foreground">{formatPackSize(item)}</p>
          {item.unit_cost == null ? (
            <p className="text-[10px] text-amber-700 dark:text-amber-500/90 mt-1 leading-snug" role="status">
              ⚠️ No price set - won&apos;t contribute to inventory value
            </p>
          ) : null}
        </div>
      )}

      {isLaptopDensity ? (
        <>
          <span className="sr-only">
            {item.item_name} — {formatPackSize(item)}
          </span>
          {item.unit_cost == null ? (
            <span className="sr-only" role="status">
              No unit price; won&apos;t contribute to inventory value
            </span>
          ) : null}
          <div className="flex w-full min-w-0 flex-wrap items-center gap-1.5">
            <div className="flex min-w-0 flex-wrap items-center gap-0.5" role="group" aria-label="Count unit">
              <button
                type="button"
                disabled={!isCountingEditable}
                aria-pressed={countMode === "cases"}
                onClick={() => setMode("cases")}
                className={cn(laptopToggle, countMode === "cases" ? laptopToggleActive : null)}
              >
                Cases
              </button>
              {showUnits ? (
                <button
                  type="button"
                  disabled={!isCountingEditable}
                  aria-pressed={countMode === "units"}
                  onClick={() => setMode("units")}
                  className={cn(laptopToggle, countMode === "units" ? laptopToggleActive : null)}
                >
                  {unitsLabel}
                </button>
              ) : null}
              {showWeight ? (
                <button
                  type="button"
                  disabled={!isCountingEditable}
                  aria-pressed={countMode === "weight"}
                  onClick={() => setMode("weight")}
                  className={cn(laptopToggle, countMode === "weight" ? laptopToggleActive : null)}
                >
                  Weight
                </button>
              ) : null}
            </div>
            <div className="flex min-w-0 shrink-0 items-center gap-0.5">
              <label className="sr-only" htmlFor={`ucount-${item.id}`}>
                Quantity ({countMode})
              </label>
              <Input
                id={`ucount-${item.id}`}
                ref={inputRef}
                type="number"
                inputMode="decimal"
                min={0}
                step={0.01}
                readOnly={!isCountingEditable}
                aria-invalid={inputInvalid}
                aria-describedby={inputInvalid ? `ucount-err-${item.id}` : undefined}
                value={rawInput}
                onFocus={(e) => e.target.select()}
                onChange={(e) => onChangeInput(e.target.value)}
                onBlur={onBlurInput}
                onKeyDown={onKeyDownInput}
                className={cn(
                  inputClass,
                  inputInvalid && "border-destructive focus-visible:ring-destructive/30",
                )}
              />
              {laptopConversionTooltip ? (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      className="shrink-0 rounded p-0.5 text-muted-foreground transition-colors hover:text-foreground"
                      aria-label="Case conversion and PAR details"
                    >
                      <Info className="h-3.5 w-3.5" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="left" className="max-w-sm text-left text-xs">
                    <p className="whitespace-pre-line tabular-nums leading-relaxed">{laptopConversionTooltip}</p>
                  </TooltipContent>
                </Tooltip>
              ) : null}
              <span className="inline-flex min-w-0 items-center gap-0.5" role="status" aria-live="polite">
                {savingId === item.id && (
                  <span className="shrink-0 text-[9px] text-muted-foreground">…</span>
                )}
                {savedId === item.id && <Check className="h-3.5 w-3.5 shrink-0 text-success" aria-hidden />}
              </span>
            </div>
          </div>
          {inputInvalid ? (
            <p id={`ucount-err-${item.id}`} className="text-[10px] text-destructive" role="alert">
              Enter a valid number (zero or greater).
            </p>
          ) : null}
        </>
      ) : (
        <>
          {compactTable && (
            <div className="min-w-0">
              <span className="sr-only">
                {item.item_name} — {formatPackSize(item)}
              </span>
              {item.unit_cost == null ? (
                <p className="text-[9px] text-amber-700 dark:text-amber-500/90 leading-tight" role="status">
                  ⚠️ No price set - won&apos;t contribute to inventory value
                </p>
              ) : null}
            </div>
          )}

          <div
            role="group"
            aria-label="Count unit"
            className={cn("flex flex-wrap", variant === "card" && !compactTable ? "gap-4" : "gap-2")}
          >
            <button
              type="button"
              disabled={!isCountingEditable}
              aria-pressed={countMode === "cases"}
              onClick={() => setMode("cases")}
              className={cn(toggleBtn, countMode === "cases" ? toggleBtnActive : null, toggleTouchExtra)}
            >
              Cases
            </button>
            {showUnits ? (
              <button
                type="button"
                disabled={!isCountingEditable}
                aria-pressed={countMode === "units"}
                onClick={() => setMode("units")}
                className={cn(toggleBtn, countMode === "units" ? toggleBtnActive : null, toggleTouchExtra)}
              >
                {unitsLabel}
              </button>
            ) : null}
            {showWeight ? (
              <button
                type="button"
                disabled={!isCountingEditable}
                aria-pressed={countMode === "weight"}
                onClick={() => setMode("weight")}
                className={cn(toggleBtn, countMode === "weight" ? toggleBtnActive : null, toggleTouchExtra)}
              >
                Weight
              </button>
            ) : null}
          </div>

          <label className="sr-only" htmlFor={`ucount-${item.id}`}>
            Quantity ({countMode})
          </label>
          <Input
            id={`ucount-${item.id}`}
            ref={inputRef}
            type="number"
            inputMode="decimal"
            min={0}
            step={0.01}
            readOnly={!isCountingEditable}
            aria-invalid={inputInvalid}
            aria-describedby={inputInvalid ? `ucount-err-${item.id}` : undefined}
            value={rawInput}
            onFocus={(e) => e.target.select()}
            onChange={(e) => onChangeInput(e.target.value)}
            onBlur={onBlurInput}
            onKeyDown={onKeyDownInput}
            className={cn(
              inputClass,
              compactTable
                ? "min-h-8"
                : variant === "card" && touchProfile !== "default"
                  ? "min-h-[50px] sm:min-h-14"
                  : "min-h-11",
              inputInvalid && "border-destructive focus-visible:ring-destructive/30",
            )}
          />
          {inputInvalid ? (
            <p id={`ucount-err-${item.id}`} className="text-[10px] text-destructive" role="alert">
              Enter a valid number (zero or greater).
            </p>
          ) : null}

          {rawInput.trim() !== "" && parsedValue !== null ? (
            <div
              className={cn(
                "space-y-1 text-[11px] leading-snug text-gray-600 dark:text-muted-foreground",
                variant === "card" && !compactTable && "space-y-2",
              )}
            >
              {displayLines.sentence ? (
                <p className="text-[11px] font-medium text-gray-900 dark:text-foreground/95">
                  {displayLines.sentence}
                </p>
              ) : null}
              <p className="tabular-nums font-medium text-gray-800 dark:text-foreground/90">
                {displayLines.line1}
              </p>
              <p className="tabular-nums">{displayLines.line2}</p>
              <p className="tabular-nums">{displayLines.line3}</p>
              <p className="text-[10px] font-medium text-gray-900 dark:text-foreground/90">{parLine}</p>
            </div>
          ) : (
            <p className="text-[11px] text-gray-600 dark:text-muted-foreground/80">{parLine}</p>
          )}

          <div className="flex items-center gap-1" role="status" aria-live="polite" aria-atomic="true">
            {savingId === item.id && <span className="text-[10px] text-muted-foreground">Saving…</span>}
            {savedId === item.id && (
              <span className="flex items-center gap-0.5 text-[10px] text-success">
                <Check className="h-3.5 w-3.5 shrink-0" aria-hidden />
                <span className="sr-only">Saved</span>
              </span>
            )}
          </div>
        </>
      )}
    </div>
  );
}
