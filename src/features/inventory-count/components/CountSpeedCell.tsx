import { useEffect, useState, type KeyboardEvent, type Ref } from "react";
import { cn } from "@/lib/utils";
import { getRowState, parseInputValue } from "@/lib/inventory-utils";
import { parseUnitsPerPlanningUnitFromPackSize } from "@/domain/inventory/planningUnitMeta";
import type { InventorySessionItemRow } from "@/domain/inventory/enterInventoryTypes";

export type SpeedCountUnit = "Cases" | "Units" | "Bags" | "Weight";

function casesFromUiQuantity(
  unit: SpeedCountUnit,
  parsed: number | null,
  unitsPerCase: number | null,
): number | null {
  if (parsed === null) return null;
  if (unit === "Cases" || unit === "Units" || unit === "Bags") return parsed;
  if (unitsPerCase == null || !Number.isFinite(unitsPerCase) || unitsPerCase <= 0) return parsed;
  return Math.round((parsed / unitsPerCase) * 1e6) / 1e6;
}

function availableUnits(item: InventorySessionItemRow): SpeedCountUnit[] {
  const W = parseUnitsPerPlanningUnitFromPackSize(item.pack_size);
  const u = (item.unit || "").trim().toUpperCase();
  const units: SpeedCountUnit[] = ["Cases"];
  if (u === "EA" || u === "EACH" || u === "UNIT" || u === "UNITS") units.push("Units");
  if (u.includes("BAG")) units.push("Bags");
  if (W != null) units.push("Weight");
  return [...new Set(units)];
}

function stockDisplayValue(
  stock: number | null | undefined,
  unit: SpeedCountUnit,
  W: number | null,
): string {
  if (stock === null || stock === undefined) return "";
  const Qn = Number(stock);
  if (!Number.isFinite(Qn)) return "";
  if (unit === "Weight" && W != null && W > 0 && Qn > 0) {
    return String(Math.round(Qn * W * 1e6) / 1e6);
  }
  return String(Qn);
}

export type CountSpeedCellProps = {
  item: InventorySessionItemRow;
  rowPar: number;
  isCountingEditable: boolean;
  onUpdateStock: (id: string, raw: string) => void;
  onSaveStock: (id: string, stock: number | null) => void | Promise<void>;
  onKeyDown?: (event: KeyboardEvent, index: number) => void;
  globalIndex?: number;
  inputRef?: Ref<HTMLInputElement | null>;
  /** Increments on Clear All Counts to force input reset */
  inputResetKey?: number;
};

export function CountSpeedCell({
  item,
  rowPar,
  isCountingEditable,
  onUpdateStock,
  onSaveStock,
  onKeyDown,
  globalIndex = 0,
  inputRef,
  inputResetKey = 0,
}: CountSpeedCellProps) {
  const W = parseUnitsPerPlanningUnitFromPackSize(item.pack_size);
  const unitOptions = availableUnits(item);
  const [activeUnit, setActiveUnit] = useState<SpeedCountUnit>(unitOptions[0]);
  const [draft, setDraft] = useState(() =>
    stockDisplayValue(item.current_stock, unitOptions[0], W),
  );
  const [focused, setFocused] = useState(false);

  useEffect(() => {
    if (!unitOptions.includes(activeUnit)) setActiveUnit(unitOptions[0]);
  }, [item.id, unitOptions, activeUnit]);

  useEffect(() => {
    if (!focused) {
      setDraft(stockDisplayValue(item.current_stock, activeUnit, W));
    }
  }, [item.id, item.current_stock, activeUnit, W, inputResetKey, focused]);

  const effectiveStock = focused ? parseInputValue(draft) : item.current_stock;
  const rowState = getRowState(effectiveStock);
  const atOrAbovePar =
    rowPar > 0 && rowState !== "uncounted" && Number(effectiveStock ?? 0) >= rowPar;

  const persist = async (raw: string) => {
    const trimmed = raw.trim();
    if (trimmed === "") {
      onUpdateStock(item.id, "");
      await onSaveStock(item.id, null);
      setDraft("");
      return;
    }
    const parsed = parseInputValue(trimmed);
    const cases = casesFromUiQuantity(activeUnit, parsed, W);
    onUpdateStock(item.id, trimmed);
    await onSaveStock(item.id, cases);
    setDraft(stockDisplayValue(cases, activeUnit, W));
  };

  return (
    <div className="flex flex-col items-center gap-1.5 py-1">
      {unitOptions.length > 1 ? (
        <div className="flex flex-wrap items-center justify-center gap-0.5 max-w-[140px]">
          {unitOptions.map((u) => (
            <button
              key={u}
              type="button"
              disabled={!isCountingEditable}
              onClick={() => {
                setActiveUnit(u);
                if (!focused) {
                  setDraft(stockDisplayValue(item.current_stock, u, W));
                }
              }}
              className={cn(
                "rounded-full px-[5px] py-[2px] text-[9px] font-medium leading-tight transition-colors",
                activeUnit === u
                  ? "bg-[#f97316] text-white border-0"
                  : "bg-white text-muted-foreground border border-border/80",
              )}
            >
              {u}
            </button>
          ))}
        </div>
      ) : null}

      <input
        ref={inputRef}
        type="text"
        inputMode="decimal"
        readOnly={!isCountingEditable}
        value={draft}
        placeholder="—"
        onFocus={(e) => {
          setFocused(true);
          e.target.select();
        }}
        onBlur={(e) => {
          setFocused(false);
          void persist(e.target.value);
        }}
        onChange={(e) => {
          setDraft(e.target.value);
          onUpdateStock(item.id, e.target.value);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            void persist((e.target as HTMLInputElement).value);
            (e.target as HTMLInputElement).blur();
          }
          onKeyDown?.(e, globalIndex);
        }}
        className={cn(
          "w-16 h-9 rounded-[7px] border-[1.5px] text-center text-[17px] font-medium tabular-nums",
          "[appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none",
          focused ? "border-[#f97316] outline-none" : "border-border",
          atOrAbovePar
            ? "border-[#16a34a] bg-[#f0fdf4] text-[#15803d]"
            : "bg-white text-foreground",
        )}
      />
    </div>
  );
}
