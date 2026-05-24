import { computeOrderQty, getRowState } from "@/lib/inventory-utils";

export type CountRowRisk = "uncounted" | "ok" | "low" | "critical";

export function getCountRowRisk(args: {
  currentStock: number | null | undefined;
  par: number;
}): CountRowRisk {
  const base = getRowState(args.currentStock);
  if (base === "uncounted") return "uncounted";
  if (args.par <= 0) return "ok";
  const stock = Number(args.currentStock ?? 0);
  if (stock >= args.par) return "ok";
  const need = computeOrderQty(args.currentStock, args.par, null, null);
  if (need != null && need >= 3) return "critical";
  if (need != null && need >= 1) return "low";
  return "low";
}

/** 4px left border + row background per approved design */
export function countRowSurfaceClass(risk: CountRowRisk): string {
  switch (risk) {
    case "ok":
      return "border-l-4 border-l-[#16a34a] bg-[#f0fdf4]";
    case "critical":
      return "border-l-4 border-l-[#dc2626] bg-[#fff5f5]";
    case "low":
      return "border-l-4 border-l-[#ca8a04] bg-[#fefce8]";
    default:
      return "border-l-4 border-l-transparent bg-white";
  }
}

export type NeedBadge = {
  text: string;
  className: string;
};

export function countNeedBadge(args: {
  currentStock: number | null | undefined;
  par: number;
  unit?: string | null;
  packSize?: string | null;
}): NeedBadge {
  const base = getRowState(args.currentStock);
  if (base === "uncounted") {
    return {
      text: "—",
      className:
        "inline-block rounded-[5px] px-[5px] py-[3px] text-[10px] font-semibold whitespace-nowrap bg-[#f3f4f6] text-[#9ca3af]",
    };
  }
  if (args.par <= 0) {
    return {
      text: "✓ OK",
      className:
        "inline-block rounded-[5px] px-[5px] py-[3px] text-[10px] font-semibold whitespace-nowrap bg-[#bbf7d0] text-[#14532d]",
    };
  }
  const stock = Number(args.currentStock ?? 0);
  if (stock >= args.par) {
    return {
      text: "✓ OK",
      className:
        "inline-block rounded-[5px] px-[5px] py-[3px] text-[10px] font-semibold whitespace-nowrap bg-[#bbf7d0] text-[#14532d]",
    };
  }
  const need = computeOrderQty(args.currentStock, args.par, args.unit, args.packSize);
  const n = need != null && need > 0 ? need : 1;
  if (n >= 3) {
    return {
      text: `Need ${n}`,
      className:
        "inline-block rounded-[5px] px-[5px] py-[3px] text-[10px] font-semibold whitespace-nowrap bg-[#fecaca] text-[#7f1d1d]",
    };
  }
  return {
    text: `Need ${n}`,
    className:
      "inline-block rounded-[5px] px-[5px] py-[3px] text-[10px] font-semibold whitespace-nowrap bg-[#fef08a] text-[#713f12]",
  };
}

export function isLastPurchaseRecent(iso: string | null | undefined): boolean {
  if (!iso) return false;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return false;
  const days = (Date.now() - d.getTime()) / (1000 * 60 * 60 * 24);
  return days <= 7;
}
