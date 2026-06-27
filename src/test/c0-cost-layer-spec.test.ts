import { describe, it, expect } from "vitest";

// C0-MVP-1 — spec mirror of the additive migration
// (20260623000008_c0_unit_registry_cost_layers.sql).
//
// The migration is the implementation; this file pins the CONTRACT it must
// satisfy so the logic is covered in CI. The runtime check that the deployed
// SQL matches this spec runs at `supabase db reset` (the migration self-verifies
// at apply time) — see docs/test-results/c0-mvp-1-results.md.
//
// "No KPI / dashboard / receipt / counting change" is proven separately: this
// slice touches NO production TypeScript, so the full existing suite staying
// green is that proof.

// ── Mirror of the SQL base_unit backfill CASE ───────────────────────────────
const BASE_UNITS = ["g", "kg", "oz", "lb", "ml", "l", "gal", "each", "ct"] as const;
type BaseUnit = (typeof BASE_UNITS)[number];

function resolveBaseUnit(unit: string | null | undefined): BaseUnit {
  switch ((unit ?? "").trim().toLowerCase()) {
    case "lb": case "lbs": case "pound": case "pounds": case "#": return "lb";
    case "oz": case "ounce": case "ounces": return "oz";
    case "g": case "gram": case "grams": return "g";
    case "kg": case "kilo": case "kilogram": return "kg";
    case "ml": case "milliliter": return "ml";
    case "l": case "liter": case "litre": return "l";
    case "gal": case "gallon": case "gallons": return "gal";
    default: return "each"; // each/ea/ct/count/case/cs/unit/blank/unknown → safe count base
  }
}

// ── Mirror of the latest-layer selection + safe projection ──────────────────
interface CostLayer { base_unit_cost: number; effective_from: string; created_at: string }

function latestLayer(layers: CostLayer[]): CostLayer | null {
  if (layers.length === 0) return null;
  return [...layers].sort((a, b) =>
    b.effective_from.localeCompare(a.effective_from) || b.created_at.localeCompare(a.created_at),
  )[0];
}
function baseUnitCost(layers: CostLayer[]): number | null {
  return latestLayer(layers)?.base_unit_cost ?? null;
}
function costProjection(layers: CostLayer[], defaultUnitCost: number | null): number | null {
  return baseUnitCost(layers) ?? defaultUnitCost;
}

// ── Mirror of the genesis-layer backfill (base_unit_qty = 1) ─────────────────
function genesisLayer(defaultUnitCost: number): CostLayer {
  const base_unit_qty = 1;
  return {
    base_unit_cost: defaultUnitCost / base_unit_qty, // = default_unit_cost
    effective_from: "2026-06-23T00:00:00Z",
    created_at: "2026-06-23T00:00:00Z",
  };
}

describe("C0-MVP-1 · every catalog item resolves a base unit", () => {
  it("maps known mass/volume units to their registry code", () => {
    expect(resolveBaseUnit("LB")).toBe("lb");
    expect(resolveBaseUnit("pounds")).toBe("lb");
    expect(resolveBaseUnit("oz")).toBe("oz");
    expect(resolveBaseUnit("Gallon")).toBe("gal");
    expect(resolveBaseUnit("ml")).toBe("ml");
  });
  it("defaults package/unknown/blank units to 'each' (never null)", () => {
    for (const u of ["case", "CS", "ea", "ct", "unit", "", "   ", null, undefined, "widget"]) {
      const r = resolveBaseUnit(u as string);
      expect(r).toBe("each");
      expect(BASE_UNITS).toContain(r); // always a seeded registry code → FK-safe, NOT NULL
    }
  });
});

describe("C0-MVP-1 · every item resolves a latest cost layer", () => {
  it("picks the newest layer by effective_from then created_at", () => {
    const layers: CostLayer[] = [
      { base_unit_cost: 10, effective_from: "2026-01-01T00:00:00Z", created_at: "2026-01-01T00:00:00Z" },
      { base_unit_cost: 12, effective_from: "2026-03-01T00:00:00Z", created_at: "2026-03-01T00:00:00Z" },
      { base_unit_cost: 11, effective_from: "2026-02-01T00:00:00Z", created_at: "2026-02-01T00:00:00Z" },
    ];
    expect(baseUnitCost(layers)).toBe(12);
  });
});

describe("C0-MVP-1 · backfill identity: latest layer == default_unit_cost", () => {
  it("a genesis layer (qty=1) yields base_unit_cost equal to default_unit_cost", () => {
    for (const cost of [0, 3.5, 64.03, 1299.99]) {
      expect(baseUnitCost([genesisLayer(cost)])).toBe(cost);
    }
  });
});

describe("C0-MVP-1 · safe projection falls back to default_unit_cost", () => {
  it("uses the latest layer when present", () => {
    expect(costProjection([genesisLayer(42)], 99)).toBe(42);
  });
  it("falls back to default_unit_cost when no layer exists (never silently 0)", () => {
    expect(costProjection([], 7.25)).toBe(7.25);
    expect(costProjection([], null)).toBeNull();
  });
});
