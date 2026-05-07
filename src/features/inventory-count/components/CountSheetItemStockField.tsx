import { useEffect, useState, type FocusEvent, type KeyboardEvent, type Ref } from "react";
import { Input } from "@/components/ui/input";
import { UniversalCountInput, type CountTouchProfile } from "@/components/inventory/UniversalCountInput";
import { formatPackSize } from "@/domain/inventory/display/sessionDisplayHelpers";
import {
  countBaseLabelForDualStock,
  parseUnitsPerPlanningUnitFromPackSize,
} from "@/domain/inventory/planningUnitMeta";
import type { InventoryCatalogItemRow, InventorySessionItemRow } from "@/domain/inventory/enterInventoryTypes";
import { getFeatureFlags } from "@/lib/feature-flags";
import { inputDisplayValue, parseInputValue } from "@/lib/inventory-utils";
import { cn } from "@/lib/utils";
import { Check } from "lucide-react";
import type { SaveStockWithConversionPayload } from "@/features/inventory-count/hooks/useItemCommands";

type CountUnit = "CS" | "LBS";

function secondaryCountButtonLabel(baseLabel: string): string {
  const u = baseLabel.trim().toLowerCase();
  if (u === "lb" || u === "lbs" || u === "pound" || u === "pounds" || u === "#") return "Pounds";
  if (u) return baseLabel.trim();
  return "Count unit";
}

/** Convert entered qty to case-equivalent for storage. LBS without parseable pack uses raw number as cases. */
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

type Variant = "desktop" | "card";

const inputClassDesktop = `w-full max-w-[5.5rem] rounded-lg border-2 border-gray-300 bg-background text-center font-mono text-base font-semibold text-gray-900
  [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none
  h-11 focus-visible:border-blue-500 focus-visible:ring-2 focus-visible:ring-blue-500/25`;

const inputClassDesktopSimplified = `w-full max-w-[6rem] rounded-lg border-2 border-gray-300 bg-background text-center font-mono text-base font-semibold text-gray-900 shadow-sm
  [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none
  h-11 focus-visible:border-blue-500 focus-visible:ring-2 focus-visible:ring-blue-500/25`;

/** List Management–style compact qty cell */
const inputClassTable = `h-8 w-[4.5rem] rounded-md border border-gray-300 bg-background px-2 text-center font-mono text-sm font-semibold tabular-nums text-gray-900
  [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none
  focus-visible:border-blue-500 focus-visible:ring-1 focus-visible:ring-blue-500/25`;

const inputClassCard = `h-12 text-lg font-mono text-center font-semibold rounded-lg border-2 border-gray-300 text-gray-900
  focus-visible:border-blue-500 focus-visible:ring-2 focus-visible:ring-blue-500/25
  [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none
  w-full min-w-0`;

const toggleBtn = cn(
  "min-h-11 flex-1 rounded-lg border border-gray-200 bg-gray-100 px-2 text-xs font-semibold text-gray-700 transition-colors hover:bg-gray-200",
  "dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700",
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/30 focus-visible:ring-offset-2 focus-visible:ring-offset-background",
  "disabled:pointer-events-none disabled:opacity-50",
);
const toggleBtnActive =
  "border-blue-600 bg-blue-600 text-white shadow-sm hover:bg-blue-600 dark:hover:bg-blue-600";

type CountSheetItemStockFieldProps = {
  item: InventorySessionItemRow;
  variant: Variant;
  isCountingEditable: boolean;
  simplifyCountingRow: boolean;
  onUpdateStock: (id: string, raw: string) => void;
  onSaveStock: (id: string, stock: number | null) => void | Promise<void>;
  onKeyDown: (event: KeyboardEvent, index: number, field?: "stock") => void;
  globalIndex: number;
  inputRef: Ref<HTMLInputElement | null>;
  savingId: string | null;
  savedId: string | null;
  /** When set, row-level Cases/Pounds toggles are hidden (category header controls unit). */
  forcedCountUnit?: "CS" | "LBS";
  /** Dense table cell (no labels, List Management–style input). */
  compactTable?: boolean;
  /** Tighter inline count UI for wide desktop tables. */
  countDensity?: "default" | "laptop" | "tablet";
  userId?: string | null;
  /** Section / shelf label for feature flags (e.g. "DRY"). */
  categoryKey?: string;
  catalogItem?: InventoryCatalogItemRow | null;
  /** When true, row uses zone strip — use legacy count UI. */
  zoneCountingActive?: boolean;
  onSaveStockWithConversion?: (id: string, payload: SaveStockWithConversionPayload) => void | Promise<void>;
  rowPar?: number;
  touchProfile?: CountTouchProfile;
};

type LegacyCountFieldProps = CountSheetItemStockFieldProps;

/**
 * On-hand count: stores case-equivalent upstream. Optional per-row toggles, or `forcedCountUnit` from category header.
 */
function CountSheetItemStockFieldLegacy({
  item,
  variant,
  isCountingEditable,
  simplifyCountingRow,
  onUpdateStock,
  onSaveStock,
  onKeyDown,
  globalIndex,
  inputRef,
  savingId,
  savedId,
  forcedCountUnit,
  compactTable = false,
}: LegacyCountFieldProps) {
  const W = parseUnitsPerPlanningUnitFromPackSize(item.pack_size);
  const dual = W != null;
  const baseLabel = countBaseLabelForDualStock(item.pack_size, item.unit);
  const packSizeLabel = formatPackSize(item);
  const secondaryLabel = secondaryCountButtonLabel(baseLabel);

  const [internalCountUnit, setInternalCountUnit] = useState<CountUnit>("CS");
  const [quantity, setQuantity] = useState("");

  const showRowToggles = forcedCountUnit == null;
  const activeUnit: CountUnit = forcedCountUnit ?? internalCountUnit;

  useEffect(() => {
    if (!dual || W == null) return;
    const Qn =
      item.current_stock == null || !Number.isFinite(Number(item.current_stock))
        ? 0
        : Math.max(0, Number(item.current_stock));
    if (activeUnit === "CS") {
      setQuantity(Qn === 0 ? "" : String(Qn));
    } else {
      const lbs = W > 0 ? Qn * W : Qn;
      setQuantity(Qn === 0 ? "" : String(Math.round(lbs * 1e6) / 1e6));
    }
  }, [item.id, item.current_stock, item.pack_size, dual, W, activeUnit]);

  if (!dual || W == null) {
    const oneInputClass = compactTable
      ? inputClassTable
      : variant === "card"
        ? inputClassCard
        : simplifyCountingRow
          ? inputClassDesktopSimplified
          : `w-24 ${inputClassDesktop}`;
    return (
      <div
        className={
          variant === "card"
            ? "flex min-w-0 flex-1 flex-col items-stretch gap-1"
            : compactTable
              ? "flex items-center justify-center gap-1"
              : "flex flex-col items-center justify-center gap-1"
        }
      >
        {variant === "card" && !compactTable && (
          <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            Quantity (cases)
          </span>
        )}
        <div
          className={
            variant === "card" ? "flex items-center justify-center gap-2" : "flex items-center gap-2"
          }
        >
          <Input
            ref={inputRef}
            type="number"
            inputMode="decimal"
            min={0}
            step={0.01}
            readOnly={!isCountingEditable}
            value={inputDisplayValue(item.current_stock)}
            onFocus={(e) => e.target.select()}
            onChange={(e) => onUpdateStock(item.id, e.target.value)}
            onBlur={() => void onSaveStock(item.id, item.current_stock)}
            onKeyDown={(e) => onKeyDown(e, globalIndex, "stock")}
            className={cn(oneInputClass, !compactTable && variant !== "card" && "min-h-11")}
          />
          {!compactTable && variant === "desktop" && (
            <div className="w-5">
              {savingId === item.id && <span className="animate-pulse text-xs text-muted-foreground">...</span>}
              {savedId === item.id && <Check className="h-3.5 w-3.5 text-success" aria-hidden />}
            </div>
          )}
          {compactTable && savingId === item.id && (
            <span className="text-[10px] text-muted-foreground">…</span>
          )}
          {compactTable && savedId === item.id && <Check className="h-3.5 w-3.5 text-success shrink-0" aria-hidden />}
        </div>
      </div>
    );
  }

  const pushCasesFromQuantityString = (raw: string) => {
    const parsed = parseInputValue(raw);
    const cases = casesFromUiQuantity(activeUnit, parsed, W);
    if (cases === null) {
      onUpdateStock(item.id, "");
      return;
    }
    onUpdateStock(item.id, String(cases));
  };

  const saveQuantityString = (raw: string) => {
    const parsed = parseInputValue(raw);
    const cases = casesFromUiQuantity(activeUnit, parsed, W);
    void onSaveStock(item.id, cases);
  };

  const onBlurInput = (_e: FocusEvent<HTMLInputElement>) => {
    saveQuantityString(quantity);
  };

  const parsedQty = parseInputValue(quantity);
  const showHints = !compactTable;
  const equivCases =
    showHints && activeUnit === "LBS" && parsedQty !== null && parsedQty > 0 && W != null
      ? Math.round((parsedQty / W) * 100) / 100
      : null;
  const equivBase =
    showHints && activeUnit === "CS" && parsedQty !== null && parsedQty > 0 && W != null
      ? Math.round(parsedQty * W * 100) / 100
      : null;

  const dualInputClass = compactTable
    ? inputClassTable
    : variant === "card"
      ? inputClassCard
      : simplifyCountingRow
        ? inputClassDesktopSimplified
        : inputClassDesktop;

  if (compactTable || !showRowToggles) {
    return (
      <div className="flex items-center justify-center gap-1">
        <Input
          ref={inputRef}
          type="number"
          inputMode="decimal"
          min={0}
          step={0.01}
          readOnly={!isCountingEditable}
          value={quantity}
          onFocus={(e) => e.target.select()}
          onChange={(e) => {
            const v = e.target.value;
            setQuantity(v);
            pushCasesFromQuantityString(v);
          }}
          onBlur={onBlurInput}
          onKeyDown={(e) => onKeyDown(e, globalIndex, "stock")}
          className={dualInputClass}
        />
        {savingId === item.id && <span className="text-[10px] text-muted-foreground">…</span>}
        {savedId === item.id && <Check className="h-3.5 w-3.5 text-success shrink-0" aria-hidden />}
      </div>
    );
  }

  const dualBlock = (
    <div
      className={cn(
        "flex w-full min-w-0 flex-col gap-2",
        variant === "desktop" ? "max-w-[11rem] mx-auto" : "",
      )}
    >
      <div className="flex flex-col gap-1">
        <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
          Count in
        </span>
        <div className="flex gap-2">
          <button
            type="button"
            disabled={!isCountingEditable}
            onClick={() => setInternalCountUnit("CS")}
            className={cn(toggleBtn, internalCountUnit === "CS" ? toggleBtnActive : null)}
          >
            Cases
          </button>
          <button
            type="button"
            disabled={!isCountingEditable}
            onClick={() => setInternalCountUnit("LBS")}
            className={cn(toggleBtn, internalCountUnit === "LBS" ? toggleBtnActive : null)}
          >
            {secondaryLabel}
          </button>
        </div>
      </div>
      <div className="flex flex-col gap-1">
        <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
          Quantity
        </span>
        <Input
          ref={inputRef}
          type="number"
          inputMode="decimal"
          min={0}
          step={0.01}
          readOnly={!isCountingEditable}
          value={quantity}
          onFocus={(e) => e.target.select()}
          onChange={(e) => {
            const v = e.target.value;
            setQuantity(v);
            pushCasesFromQuantityString(v);
          }}
          onBlur={onBlurInput}
          onKeyDown={(e) => onKeyDown(e, globalIndex, "stock")}
          className={dualInputClass}
        />
      </div>
      {activeUnit === "LBS" && equivCases != null && equivCases > 0 && (
        <p className="text-[11px] text-muted-foreground tabular-nums">
          ≈ {equivCases.toFixed(2)} cases
          {packSizeLabel ? (
            <span className="text-muted-foreground/70"> ({packSizeLabel})</span>
          ) : null}
        </p>
      )}
      {activeUnit === "CS" && equivBase != null && equivBase > 0 && (
        <p className="text-[11px] text-muted-foreground tabular-nums">
          ≈ {equivBase.toFixed(2)} {baseLabel || "units"} in this quantity
        </p>
      )}
    </div>
  );

  if (variant === "card") {
    return <div className="w-full min-w-0">{dualBlock}</div>;
  }

  return (
    <div className="flex flex-col items-stretch justify-center gap-1 py-0.5">
      {dualBlock}
      <div className="flex justify-end pr-0.5">
        {savingId === item.id && <span className="animate-pulse text-xs text-muted-foreground">...</span>}
        {savedId === item.id && <Check className="h-3.5 w-3.5 text-success" aria-hidden />}
      </div>
    </div>
  );
}

/**
 * On-hand count: case-equivalent. Uses {@link UniversalCountInput} for DRY (feature flag) when conversion save handler is present.
 */
export function CountSheetItemStockField({
  userId = null,
  categoryKey = "",
  catalogItem = null,
  zoneCountingActive = false,
  onSaveStockWithConversion,
  rowPar = 0,
  touchProfile,
  ...legacy
}: CountSheetItemStockFieldProps) {
  const flags = getFeatureFlags(userId ?? "", categoryKey);
  const useUniversal =
    flags.useUniversalCountInput && !zoneCountingActive && typeof onSaveStockWithConversion === "function";
  const resolvedTouch: CountTouchProfile =
    touchProfile ?? (legacy.variant === "card" && !legacy.compactTable ? "responsive" : "default");
  const resolvedCountDensity = legacy.countDensity ?? "default";

  if (useUniversal) {
    return (
      <UniversalCountInput
        item={legacy.item}
        catalogItem={catalogItem}
        variant={legacy.variant}
        compactTable={legacy.compactTable}
        countDensity={resolvedCountDensity}
        isCountingEditable={legacy.isCountingEditable}
        rowPar={rowPar}
        onUpdateStock={legacy.onUpdateStock}
        onSaveStockWithConversion={onSaveStockWithConversion!}
        onKeyDown={legacy.onKeyDown}
        globalIndex={legacy.globalIndex}
        inputRef={legacy.inputRef}
        savingId={legacy.savingId}
        savedId={legacy.savedId}
        showItemHeader={!legacy.compactTable && legacy.variant === "desktop"}
        touchProfile={resolvedTouch}
      />
    );
  }

  return <CountSheetItemStockFieldLegacy {...legacy} />;
}
