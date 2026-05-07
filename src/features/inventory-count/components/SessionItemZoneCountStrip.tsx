import { useEffect, useState } from "react";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { InventorySessionItemRow } from "@/domain/inventory/enterInventoryTypes";
import { parseInputValue } from "@/lib/inventory-utils";

export type ZoneUnitOption = { value: string; label: string };

type SessionItemZoneCountStripProps = {
  sessionItem: InventorySessionItemRow;
  listCategoryId: string;
  unitOptions: ZoneUnitOption[];
  readOnly: boolean;
  /** Existing zone line for this section, if any */
  zoneLine: { entered_qty: number; entered_unit: string } | undefined;
  /** Increment (e.g. after canceling legacy-total ack) to re-sync draft from persisted zoneLine */
  draftResetNonce?: number;
  onCommit: (qty: number, unit: string) => void | Promise<void>;
};

/**
 * Per-section zone qty entry. Parsing only; all stock math runs in the zone pipeline.
 */
export function SessionItemZoneCountStrip({
  sessionItem,
  listCategoryId,
  unitOptions,
  readOnly,
  zoneLine,
  draftResetNonce = 0,
  onCommit,
}: SessionItemZoneCountStripProps) {
  const defaultUnit = unitOptions[0]?.value ?? "";
  const [qtyRaw, setQtyRaw] = useState(() =>
    zoneLine != null && Number(zoneLine.entered_qty) !== 0
      ? String(zoneLine.entered_qty)
      : zoneLine != null
        ? String(zoneLine.entered_qty)
        : "",
  );
  const [unit, setUnit] = useState(() => zoneLine?.entered_unit ?? defaultUnit);

  useEffect(() => {
    const nextQty =
      zoneLine != null ? String(zoneLine.entered_qty) : "";
    const nextUnit = zoneLine?.entered_unit ?? defaultUnit;
    setQtyRaw(nextQty);
    setUnit(nextUnit);
  }, [
    sessionItem.id,
    listCategoryId,
    zoneLine?.entered_qty,
    zoneLine?.entered_unit,
    defaultUnit,
    draftResetNonce,
  ]);

  const commit = () => {
    const parsed = parseInputValue(qtyRaw);
    const qty = parsed === null || parsed === undefined ? 0 : Number(parsed);
    void onCommit(qty, unit || defaultUnit);
  };

  if (unitOptions.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
      <span className="shrink-0 font-medium text-muted-foreground/80">Zone qty</span>
      <Input
        type="number"
        inputMode="decimal"
        min={0}
        step={0.01}
        readOnly={readOnly}
        value={qtyRaw}
        onChange={(e) => setQtyRaw(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        }}
        className="h-7 w-20 rounded-md border-border/60 px-2 font-mono text-xs [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
      />
      <Select
        value={unit || defaultUnit}
        onValueChange={(v) => {
          setUnit(v);
          const parsed = parseInputValue(qtyRaw);
          const qty = parsed === null ? 0 : parsed;
          void onCommit(qty, v);
        }}
        disabled={readOnly}
      >
        <SelectTrigger className="h-7 w-[7.5rem] text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {unitOptions.map((o) => (
            <SelectItem key={o.value} value={o.value} className="text-xs">
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <span className="text-[10px] text-muted-foreground/55">(total above = all zones, cases)</span>
    </div>
  );
}
