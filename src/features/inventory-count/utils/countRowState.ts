import { computeOrderQty, getRowState } from "@/lib/inventory-utils";

export type CountRowVisualState =
  | "uncounted"
  | "zero"
  | "at_par"
  | "below_par"
  | "focused";

export function getCountRowVisualState(args: {
  currentStock: number | null | undefined;
  par: number;
  focused?: boolean;
}): CountRowVisualState {
  if (args.focused) return "focused";
  const base = getRowState(args.currentStock);
  if (base === "uncounted") return "uncounted";
  if (base === "zero") return "zero";
  if (args.par > 0 && Number(args.currentStock) >= args.par) return "at_par";
  if (args.par > 0 && Number(args.currentStock) < args.par) return "below_par";
  return "at_par";
}

export function countRowBorderClass(state: CountRowVisualState): string {
  switch (state) {
    case "at_par":
      return "border-l-[3px] border-l-emerald-500 bg-emerald-50/40 dark:bg-emerald-950/10";
    case "below_par":
      return "border-l-[3px] border-l-amber-500 bg-amber-50/30 dark:bg-amber-950/10";
    case "zero":
      return "border-l-[3px] border-l-red-500 bg-red-50/25 dark:bg-red-950/10";
    case "focused":
      return "border-l-[3px] border-l-blue-500 bg-blue-50/30 dark:bg-blue-950/10";
    default:
      return "";
  }
}

export function countRowNeedLabel(args: {
  currentStock: number | null | undefined;
  par: number;
  unit: string | null | undefined;
  packSize: string | null | undefined;
}): { text: string; className: string } {
  const base = getRowState(args.currentStock);
  if (base === "uncounted") {
    return { text: "0", className: "text-muted-foreground" };
  }
  if (args.par <= 0) {
    return { text: "✓ OK", className: "text-emerald-600 font-semibold" };
  }
  const need = computeOrderQty(args.currentStock, args.par, args.unit, args.packSize);
  if (need != null && need > 0) {
    return { text: `Need ${need}`, className: "text-red-600 font-semibold" };
  }
  return { text: "✓ OK", className: "text-emerald-600 font-semibold" };
}
