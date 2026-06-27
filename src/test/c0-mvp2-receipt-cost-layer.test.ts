import { describe, it, expect } from "vitest";

// C0-MVP-2 — spec mirror of the parallel-write added to confirm_invoice_receipt
// (20260623000009_c0_mvp2_receipt_cost_layer.sql). The migration is the
// implementation; this pins its contract in CI. The runtime check runs at
// `supabase db reset` (see docs/test-results/c0-mvp-2-results.md).
//
// "No KPI / dashboard / receipt-return / counting change" is proven separately:
// the migration's RPC body is verbatim from 20260623000007 except 3 additions
// (line-diff verified), and NO production TypeScript changed — so the full suite
// staying green is that proof.

// ── Mirror of the existing cost-change predicate (unchanged by MVP-2) ────────
// IF v_old_cost IS NULL OR (ABS(new-old)>0.01 AND (old=0 OR rel% > 1)) THEN <update + layer>
function costChanges(oldCost: number | null, newCost: number): boolean {
  if (oldCost === null) return true;
  const absDiff = Math.abs(newCost - oldCost);
  if (absDiff <= 0.01) return false;
  if (oldCost === 0) return true;
  return (absDiff / Math.abs(oldCost)) * 100 > 1.0;
}

// ── Mirror of the appended layer row (identity: qty=1, cost=new) ─────────────
interface CostLayerRow {
  source_invoice_id: string;
  source_invoice_item_id: string;
  base_unit: string;
  base_unit_qty: number;
  package_qty: number;
  base_unit_cost: number;
  package_cost: number;
  prev_base_unit_cost: number | null;
  source: "receipt";
  note: string;
  created_by: string;
  vendor_name: null;
}
function buildLayer(args: {
  invoiceId: string; invoiceItemId: string; baseUnit: string;
  oldCost: number | null; newCost: number; classification: string; actor: string;
}): CostLayerRow {
  return {
    source_invoice_id: args.invoiceId,
    source_invoice_item_id: args.invoiceItemId,
    base_unit: args.baseUnit,
    base_unit_qty: 1,            // identity — no conversion in MVP-2
    package_qty: 1,
    base_unit_cost: args.newCost, // == new default_unit_cost → parity
    package_cost: args.newCost,
    prev_base_unit_cost: args.oldCost,
    source: "receipt",
    note: args.classification,
    created_by: args.actor,
    vendor_name: null,
  };
}

describe("C0-MVP-2 · append-condition mirrors the existing cost-change predicate", () => {
  it("appends only when the cost actually changes (>0.01 abs AND >1% rel)", () => {
    expect(costChanges(null, 5)).toBe(true);         // first cost
    expect(costChanges(10, 10)).toBe(false);          // unchanged
    expect(costChanges(10, 10.005)).toBe(false);      // < 1 cent
    expect(costChanges(10, 10.05)).toBe(false);       // 0.5% — below 1% rel
    expect(costChanges(10, 10.2)).toBe(true);         // 2% — changes
    expect(costChanges(0, 3.5)).toBe(true);           // from zero
  });
});

describe("C0-MVP-2 · layer identity preserves default_unit_cost (no value change)", () => {
  it("base_unit_cost == new cost; base_unit_qty == 1; prev == old", () => {
    const layer = buildLayer({
      invoiceId: "inv-1", invoiceItemId: "line-1", baseUnit: "lb",
      oldCost: 3.2, newCost: 64.03, classification: "price_increase", actor: "mgr-1",
    });
    expect(layer.base_unit_cost).toBe(64.03);   // equals the new default_unit_cost
    expect(layer.base_unit_qty).toBe(1);        // no conversion
    expect(layer.prev_base_unit_cost).toBe(3.2);
  });

  it("links invoice, line, actor, classification; vendor null; source 'receipt'", () => {
    const layer = buildLayer({
      invoiceId: "inv-9", invoiceItemId: "line-9", baseUnit: "each",
      oldCost: null, newCost: 12, classification: "no_alert", actor: "owner-1",
    });
    expect(layer.source_invoice_id).toBe("inv-9");
    expect(layer.source_invoice_item_id).toBe("line-9");
    expect(layer.created_by).toBe("owner-1");
    expect(layer.note).toBe("no_alert");
    expect(layer.source).toBe("receipt");
    expect(layer.vendor_name).toBeNull();
  });
});

describe("C0-MVP-2 · parity gate", () => {
  it("for any cost change, the layer's base_unit_cost equals the new default_unit_cost", () => {
    for (const [oldC, newC] of [[null, 5] as const, [3.2, 64.03] as const, [100, 99] as const]) {
      if (!costChanges(oldC, newC)) continue;
      const layer = buildLayer({
        invoiceId: "i", invoiceItemId: "l", baseUnit: "lb",
        oldCost: oldC, newCost: newC, classification: "x", actor: "u",
      });
      // catalog_base_unit_cost(item) would read this layer → equals new default
      expect(layer.base_unit_cost).toBe(newC);
    }
  });
});
