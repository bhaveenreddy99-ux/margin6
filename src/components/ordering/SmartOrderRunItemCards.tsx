import { Link } from "react-router-dom";
import { format } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import type { Tables } from "@/integrations/supabase/types";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { ChevronDown } from "lucide-react";
import ItemIdentityBlock from "@/components/ItemIdentityBlock";
import { formatNum, formatCurrency } from "@/lib/inventory-utils";

const normalizeItemName = (value: string | null | undefined) => (value || "").trim().toLowerCase();

export type SmartOrderRunItemCardsProps = {
  items: Tables<"smart_order_run_items">[];
  catalogById: Record<string, { id: string; product_number?: string | null; vendor_sku?: string | null; vendor_name?: string | null } | undefined>;
  catalogLookup: Record<string, unknown>;
  lastOrderDates: Record<string, string | undefined>;
  riskBadge: (currentStock?: number, parLevel?: number, options?: { minTouch?: boolean }) => React.ReactNode;
  editingRunItem: string | null;
  setEditingRunItem: (id: string | null) => void;
  editRunValues: { par_level: string; unit_cost: string };
  setEditRunValues: React.Dispatch<React.SetStateAction<{ par_level: string; unit_cost: string }>>;
  setRunItems: React.Dispatch<React.SetStateAction<Tables<"smart_order_run_items">[]>>;
  lineEstCost: (i: Tables<"smart_order_run_items">) => number;
  getLineUom: (i: Tables<"smart_order_run_items">) => string;
  getUnitCostDisplay: (
    i: Tables<"smart_order_run_items">,
  ) => { cost: number | null; source: "invoice" | "count" | "none" };
};

function resolveCatalog(
  i: Tables<"smart_order_run_items">,
  catalogById: SmartOrderRunItemCardsProps["catalogById"],
  catalogLookup: SmartOrderRunItemCardsProps["catalogLookup"],
) {
  return i.catalog_item_id ? catalogById[i.catalog_item_id] : catalogLookup[normalizeItemName(i.item_name)] as
    | { id: string; product_number?: string | null; vendor_sku?: string | null; vendor_name?: string | null }
    | undefined;
}

export function SmartOrderRunItemCards({
  items,
  catalogById,
  catalogLookup,
  lastOrderDates,
  riskBadge,
  editingRunItem,
  setEditingRunItem,
  editRunValues,
  setEditRunValues,
  setRunItems,
  lineEstCost,
  getLineUom,
  getUnitCostDisplay,
}: SmartOrderRunItemCardsProps) {
  if (items.length === 0) {
    return (
      <div className="rounded-xl border bg-card p-4 text-sm text-muted-foreground">
        <p>No lines match the current view.</p>
        <p className="mt-2 text-xs text-muted-foreground/90">
          Try turning on <span className="font-medium text-foreground">Show OK items</span> or{" "}
          <span className="font-medium text-foreground">Show Missing PAR</span> above, or check that this run has
          lines with suggested order quantities.
        </p>
      </div>
    );
  }

  return (
    <div className="flex w-full max-w-full flex-col gap-3 overflow-x-hidden">
      {items.map((i) => {
        const catalogItem = resolveCatalog(i, catalogById, catalogLookup);
        const productLine = catalogItem?.product_number || catalogItem?.vendor_sku || "—";
        const lastOrdered = (() => {
          const d = catalogItem?.id ? lastOrderDates[catalogItem.id] : null;
          return d ? format(new Date(d), "MM/dd/yy") : "—";
        })();
        const vendorName = catalogItem?.vendor_name?.trim() || null;
        const orderDisplay = i.suggested_order > 0 ? formatNum(i.suggested_order) : "—";
        const { cost: displayCost, source: costSource } = getUnitCostDisplay(i);
        const uom = getLineUom(i);
        const hasIdentity = Boolean(i.brand_name?.trim());

        return (
          <Card key={i.id} className="w-full min-w-0 max-w-full overflow-hidden rounded-xl border p-0 shadow-sm">
            <CardContent className="flex flex-col gap-3 p-4">
              <div className="flex items-start justify-between gap-2 min-w-0">
                <h3 className="min-w-0 flex-1 text-base font-bold leading-snug break-words">{i.item_name}</h3>
                <div className="flex shrink-0 items-start justify-end">
                  {riskBadge(i.current_stock, i.par_level, { minTouch: true })}
                </div>
              </div>

              {hasIdentity && (
                <ItemIdentityBlock brandName={i.brand_name} className="text-sm text-muted-foreground" />
              )}

              <div className="grid grid-cols-2 gap-3 rounded-lg border border-border/50 bg-muted/20 px-3 py-2.5">
                <div className="min-w-0">
                  <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Unit cost</p>
                  <p className="font-mono text-sm font-semibold tabular-nums break-words text-muted-foreground">
                    {displayCost == null ? (
                      <span className="text-muted-foreground">—</span>
                    ) : (
                      <span className={costSource === "count" ? "text-amber-600" : "text-foreground"}>
                        {formatCurrency(displayCost)}/{uom}
                        {costSource === "count" && (
                          <span
                            className="ml-0.5 text-[10px] text-amber-500 cursor-help"
                            title="Based on catalog default — no recent invoice found"
                          >
                            †
                          </span>
                        )}
                      </span>
                    )}
                  </p>
                </div>
                <div className="min-w-0 text-right">
                  <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Order qty</p>
                  <p className="font-mono text-lg font-bold tabular-nums text-foreground">{orderDisplay}</p>
                </div>
              </div>

              <div className="text-sm">
                {vendorName ? (
                  <span className="text-foreground">{vendorName}</span>
                ) : (
                  <span className="text-muted-foreground">
                    —{" "}
                    <Link
                      to="/app/inventory/lists"
                      className="min-h-11 min-w-[44px] inline-flex items-center text-primary underline underline-offset-2"
                    >
                      Add vendor
                    </Link>
                  </span>
                )}
              </div>

              <div className="grid w-full min-w-0 grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="min-w-0 space-y-1.5">
                  <Label className="text-xs text-muted-foreground">PAR</Label>
                  {editingRunItem === `${i.id}_par` ? (
                    <Input
                      autoFocus
                      type="number"
                      inputMode="decimal"
                      min={0}
                      step={0.1}
                      className="h-11 min-h-11 w-full min-w-0 text-sm font-mono text-right [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                      value={editRunValues.par_level}
                      onFocus={(e) => e.target.select()}
                      onChange={(e) => setEditRunValues((prev) => ({ ...prev, par_level: e.target.value }))}
                      onBlur={async () => {
                        const parsed = Math.max(0, parseFloat(editRunValues.par_level) || 0);
                        setRunItems((prev) => prev.map((r) => (r.id === i.id ? { ...r, par_level: parsed } : r)));
                        await supabase.from("smart_order_run_items").update({ par_level: parsed }).eq("id", i.id);
                        setEditingRunItem(null);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Escape") setEditingRunItem(null);
                        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                      }}
                    />
                  ) : (
                    <button
                      type="button"
                      className="flex h-11 min-h-11 w-full min-w-0 items-center justify-end rounded-md border border-input bg-background px-3 font-mono text-sm text-muted-foreground transition-colors hover:bg-muted/40 hover:text-foreground"
                      onClick={() => {
                        setEditingRunItem(`${i.id}_par`);
                        setEditRunValues({ par_level: String(i.par_level ?? ""), unit_cost: String(i.unit_cost ?? "") });
                      }}
                    >
                      {formatNum(i.par_level)}
                    </button>
                  )}
                </div>
                <div className="min-w-0 space-y-1.5">
                  <Label className="text-xs text-muted-foreground">Est. cost (line)</Label>
                  {editingRunItem === `${i.id}_cost` ? (
                    <Input
                      autoFocus
                      type="number"
                      inputMode="decimal"
                      min={0}
                      step={0.01}
                      className="h-11 min-h-11 w-full min-w-0 text-sm font-mono text-right [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                      value={editRunValues.unit_cost}
                      placeholder="Unit price"
                      onFocus={(e) => e.target.select()}
                      onChange={(e) => setEditRunValues((prev) => ({ ...prev, unit_cost: e.target.value }))}
                      onBlur={async () => {
                        const rawCost = parseFloat(editRunValues.unit_cost);
                        const parsed = Number.isFinite(rawCost) && rawCost >= 0 ? rawCost : null;
                        setRunItems((prev) => prev.map((r) => (r.id === i.id ? { ...r, unit_cost: parsed } : r)));
                        await supabase.from("smart_order_run_items").update({ unit_cost: parsed }).eq("id", i.id);
                        setEditingRunItem(null);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Escape") setEditingRunItem(null);
                        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                      }}
                    />
                  ) : (
                    <button
                      type="button"
                      className="flex h-11 min-h-11 w-full min-w-0 items-center justify-end rounded-md border border-input bg-background px-3 font-mono text-sm transition-colors hover:bg-muted/40"
                      onClick={() => {
                        setEditingRunItem(`${i.id}_cost`);
                        setEditRunValues({ par_level: String(i.par_level ?? ""), unit_cost: String(i.unit_cost ?? "") });
                      }}
                    >
                      {getUnitCostDisplay(i).source === "none" ? (
                        <span className="text-muted-foreground">—</span>
                      ) : (
                        formatCurrency(lineEstCost(i))
                      )}
                    </button>
                  )}
                </div>
              </div>

              <Collapsible>
                <CollapsibleTrigger className="group flex w-full min-h-11 items-center justify-between gap-2 rounded-md py-1 text-left text-xs font-medium text-muted-foreground hover:text-foreground">
                  <span>Details</span>
                  <ChevronDown className="h-4 w-4 shrink-0 transition-transform duration-200 group-data-[state=open]:rotate-180" />
                </CollapsibleTrigger>
                <CollapsibleContent className="pt-1">
                  <dl className="grid grid-cols-1 gap-2 text-xs sm:grid-cols-2 sm:gap-x-3">
                    <div className="min-w-0">
                      <dt className="text-muted-foreground">Product #</dt>
                      <dd className="mt-0.5 font-mono text-muted-foreground/80 break-all">{productLine}</dd>
                    </div>
                    <div className="min-w-0">
                      <dt className="text-muted-foreground">Pack size</dt>
                      <dd className="mt-0.5 text-foreground/90">{i.pack_size || "—"}</dd>
                    </div>
                    <div className="min-w-0">
                      <dt className="text-muted-foreground">Last ordered</dt>
                      <dd className="mt-0.5 text-foreground/90">{lastOrdered}</dd>
                    </div>
                    <div className="min-w-0">
                      <dt className="text-muted-foreground">In Stock</dt>
                      <dd className="mt-0.5 font-mono tabular-nums text-foreground">{formatNum(i.current_stock)}</dd>
                    </div>
                  </dl>
                </CollapsibleContent>
              </Collapsible>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
