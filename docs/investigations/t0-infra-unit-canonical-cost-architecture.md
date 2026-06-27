# T0-INFRA-UNIT — Canonical Inventory, Unit Conversion & Cost-Flow Architecture

> **Date:** 2026-06-25
> **Type:** Architecture investigation (STEP 2 of the engineering workflow). **No code, migrations, or data were modified.**
> **Scope:** The entire inventory & cost lifecycle — supplier invoice → parse → match → receipt → catalog cost → count → waste → reorder → KPIs → dashboard.
> **Goal (the acceptance test):** For any dashboard dollar, prove which invoice created it, which conversion was applied, which movement changed it, and why it is mathematically correct. Where the chain cannot be proven, it is logged as a **trust gap**.
> **Verification note:** Every claim below is tied to `file:line`. The highest-impact claims (cost write-back, waste unit guard, zone dedupe divergence, recipe-table status, the two parsers) were re-read directly from source by the author, not just reported by a sub-agent.

---

## 0. TL;DR — the one-paragraph truth

Margin6 has **one declared canonical unit: the CASE**. PAR, on-hand stock, and unit cost are all *asserted* to be per-case (`casePlanningEngine.ts:1-14`). That assertion is enforced in exactly one place — the TypeScript planning engine — and **nowhere in the database**: there is no units-of-measure table, no `unit_conversions` table, no CHECK constraint, and no `catalog_cost_history`. Conversion is derived at runtime from a free-text `pack_size` string by **two different parsers that can disagree**. Cost enters the catalog by a **direct overwrite with no unit conversion and no audit trail**. The dashboard's strongest links (inventory value math, the waste unit-guard) are genuinely sound; its weakest links (cost write-back unit safety, zone-dedupe divergence, invoice-unit price KPIs, mutable shrinkage source) cannot currently be proven back to the invoice. **The acceptance test fails today** — for an Inventory Value of \$42,518 we can trace the *formula* and the *approved session*, but not guarantee each `unit_cost` inside it is truly per-case rather than a per-pound figure an overwrite left behind.

---

## PART 1 — Complete inventory lifecycle (one item, end to end)

Tracing **one chicken item** through every table, function, RPC and trigger.

| # | Stage | Where | Table(s) written | Unit at this stage | Conversion? |
|---|-------|-------|------------------|--------------------|-------------|
| 1 | Vendor invoice (PDF/photo/email) | `parse-invoice/index.ts`, `inbound-invoice-email/index.ts` | — | vendor's own (CS, LB, EA, "6/10#") | none |
| 2 | AI parse (Claude Sonnet) | `parse-invoice/index.ts:330-337` | — | extracts `quantity`, `unit_cost`, `line_total`, `unit`, `pack_size` | none |
| 3 | Weight-item cost correction | `_shared/resolveInvoiceUnitCost.ts:2-25` | — | heuristic: if `line_total/(unit_cost×qty) > 3` → `unit_cost := line_total/qty` | **heuristic only** |
| 4 | Persist invoice lines | invoice insert path | `invoices`, `invoice_items` | `unit_cost`, `quantity_invoiced`, `pack_size` — **no unit column on cost/qty** | none |
| 5 | Match to catalog | `useInvoiceMatching.ts:46-86` | `invoice_items.catalog_item_id` | string-normalized SKU/name/pack/brand | none (no UoM equivalence) |
| 6 | 3-way comparison (PO vs billed vs received) | `20260305000001`, `20260329130000` | `invoice_line_comparisons` | `po_qty/po_unit_cost`, `invoiced_qty/invoiced_unit_cost`, `received_qty` | none |
| 7 | Receipt confirmation (RPC) | `confirm_invoice_receipt` (latest `20260623000007`) | `inventory_catalog_items.default_unit_cost` (overwrite); `stock_movements` (insert); `notifications` | **writes invoiced unit cost directly as per-case** | **NONE — see PART 5** |
| 8 | Catalog cost is now "truth" | `inventory_catalog_items.default_unit_cost` | — | *assumed* per-case (`cost_unit` default `'case'`) | — |
| 9 | Inventory count (sessions) | `InventoryCountPage`, zone pipeline | `inventory_session_items.current_stock`, `..._zones` | staff count → normalized to **cases** | **PART 2/4 parsers** |
| 10 | Count approval (RPC) | `approve_inventory_session_atomic` (`20260418222826`) | session `status='APPROVED'`; `smart_order_runs` | cases | none |
| 11 | Waste | `WasteLog.tsx`, `recordedWasteValue.ts` | `waste_log` (`quantity`, `quantity_unit`, `unit_cost`, `total_cost`) | logged unit (case/lb/each) | **guarded** (PART 5) |
| 12 | Recipe usage | `recipeCostEngine.ts` | — (tables **DROPPED** `20260502000001`) | n/a | **DEAD** |
| 13 | Smart Order | `smartOrderFromSession.ts`, `reorderEngine.ts` | `smart_order_run_items.suggested_order` | whole cases (`Math.ceil`) | PART 7 |
| 14 | Purchase history / PO submit | `submit_smart_order` RPC | `purchase_orders`, `purchase_order_items` | cases | none |
| 15 | KPIs | `domain/dashboard/*` | — | mixed (PART 6) | mixed |
| 16 | Dashboard render | `Dashboard.tsx`, `ProfitRiskWidget.tsx` | — | mixed | — |

**System-of-record note:** `stock_movements` is explicitly a **shadow ledger** ("Currently empty — do not drop. Will become the source of truth … in a future sprint," `20260502000002:45-49`). The *current* on-hand source of truth is the **latest APPROVED session** (`loadInventoryMetrics.ts`). Receipt confirmation writes movements but the dashboard on-hand reads sessions — so a confirmed delivery does **not** move dashboard on-hand (a known PARTIAL, product-reality §3 / T1-1). Two prospective sources of truth coexist with no reconciliation.

---

## PART 2 — Unit-conversion architecture: where is "canonical"?

**There is no canonical unit registry.** Findings:

- **No `units` / `units_of_measure` / `unit_conversions` table exists** anywhere in `supabase/migrations/`. Conversion is *purely runtime-derived from the `pack_size` free-text string*.
- The canonical unit is declared **by convention + COMMENT only**:
  - `inventory_catalog_items.cost_unit TEXT DEFAULT 'case'` — *"always case in the canonical model"* (`20260504000001:19-25`)
  - `inventory_session_items.stock_unit DEFAULT 'case'`, `par_guide_items.par_unit DEFAULT 'case'` (same migration)
  - `waste_log.quantity_unit DEFAULT 'case'` — but explicitly *"(case, lb, each, etc.)"* (i.e. genuinely varies)
- The only **enforcement** of "everything is cases" lives in `casePlanningEngine.ts` (a TS module). The database accepts any number in any unit; nothing stops a per-pound value from sitting in a per-case column.
- Parsed structure columns exist on the catalog (`units_per_case`, `unit_size`, `unit_type`, `total_per_case`, `pack_parse_success`, `20260424120000`) — these are the *output* of the pack parser, snapshotted onto the row, but they are **not** used by the receipt cost path or the zone-count path (which re-derives its own number — PART 4).

**Verdict:** Margin6 does *not* normalize everything to a stored base unit. It stores a per-case **assumption** and re-derives conversion factors on the fly from text, in more than one place, with more than one algorithm.

---

## PART 3 — Purchase unit vs inventory unit vs … (can they differ?)

Yes — and they routinely do. Each "unit" is a different column or a runtime label:

| Role | Source | Example | Notes |
|------|--------|---------|-------|
| Vendor/purchase unit | `invoice_items.unit` / `pack_size` | "6/10#", "CS" | free text from AI parse |
| Receiving unit | `stock_movements.source_quantity_unit` | "LB" | preserved for audit (`20260507000001:117`) |
| Inventory count unit | `inventory_session_items.counted_as` + `stock_unit` | "bags" → "case" | dual-unit; normalized to cases |
| PAR unit | `par_guide_items.par_unit` | "case" | always case by assertion |
| Cost unit | `inventory_catalog_items.cost_unit` | "case" | always case by assertion |
| Reporting/display unit | UI labels (`planningUnitMeta.ts:5-10`) | "case (order)" / "lb (count)" | derived |
| Recipe unit | `recipe_ingredients.unit` | oz/each | **table dropped** |

**They can differ, and the system's correctness depends entirely on the runtime conversion between them being right.** The places that conversion is *not* applied (PART 5) are where money breaks.

---

## PART 4 — The conversion engine(s): two parsers, latent drift

There are **two independent pack-size parsers**, and they disagree on a common format.

### Parser A — `parsePackSize` (rich, well-tested) — `src/lib/pack-parser.ts`
Regex battery handling 40+ formats. For `"6/5 Lb"` → `{ unitsPerCase: 6, unitSize: 5, unitType: "lb", totalPerCase: 30 }` (`pack-parser.ts:265-273`). Has its own `.test.ts`. Snapshotted into catalog columns by the import path.

### Parser B — `parseUnitsPerPlanningUnitFromPackSize` (naive "first number") — `src/domain/inventory/planningUnitMeta.ts:17-26`
```ts
const m = s.match(/(\d+(?:\.\d+)?)/);  // FIRST numeric token only
```
This is the parser **actually used by zone counting** (`resolvePlanningUnitMetaFromCatalogItem:73-86` → `units_per_planning_unit`).

### The drift
| `pack_size` | Parser A `totalPerCase` / `unitsPerCase` | Parser B (first number) | Agree? |
|-------------|------------------------------------------|--------------------------|--------|
| `"6/5 Lb"` | 30 / **6** | **6** | ✅ by coincidence |
| `"5 Lb"` (single 5-lb unit) | unitsPerCase **1** | **5** | ❌ **5× error** |
| `"40 lb"` | unitsPerCase **1** | **40** | ❌ **40× error** |

For a single-unit weight pack, Parser B returns the *weight*, not units-per-case. A staff member counting that item in pounds would have their count divided by the wrong factor (`zoneCounting.ts:51-69`: `enteredQty / meta.units_per_planning_unit`). **A 40-lb count would become 1 case instead of 1 case only if the catalog `unit` happens to make the count path treat it as cases; in the weight branch it is off by the pack weight.**

**Ownership / drift questions answered:**
- *Where stored?* Nowhere as a factor — re-derived each render from `pack_size` text (plus a stale snapshot in catalog columns that the live paths ignore).
- *Can vendors override?* No per-vendor conversion (`vendor_item_mappings` has **no** `units_per_case`/`case_size` column, `20260306000006`). One catalog item = one assumed case size, regardless of vendor.
- *Can restaurants customize?* Only by editing the `pack_size` string — which silently re-derives every downstream conversion.
- *Can conversions drift / conflict?* **Yes** — Parser A vs Parser B disagree on common formats; the snapshot columns can go stale vs the live string; no test asserts parity between the two parsers.

---

## PART 5 — Cost propagation: tracing one dollar (the critical section)

**Invoice: 1 case chicken, billed "WEIGHING 40.02 LBS @ \$3.20", line total \$128.06, qty 2 cases.**

1. **Parse** (`parse-invoice/index.ts:330-337`) extracts `unit_cost`, `line_total=128.06`, `quantity=2`, `pack_size`.
2. **Weight correction** (`resolveInvoiceUnitCost.ts:18-22`): `ratio = 128.06 / (3.20×2) ≈ 20 > 3` → `unit_cost := round(128.06/2) = 64.03`. **Heuristic, threshold 3 is arbitrary.** If a true per-lb line has ratio ≤ 3 (e.g. a 2-lb pack at \$2/lb), it is **not** corrected and a per-lb cost flows downstream as if per-case.
3. **Store** → `invoice_items.unit_cost = 64.03`, **no `cost_unit` column** records what 64.03 is per.
4. **Match** (`useInvoiceMatching.ts:70-83`) links to a catalog item by normalized strings. **No unit equivalence** — "40 Lb" never equals "24 CT", so genuine matches with differing pack text either fail or rely on SKU.
5. **Confirm receipt** — `confirm_invoice_receipt` (latest `20260623000007`), verified directly:
   ```
   :146  SELECT default_unit_cost, pack_size INTO v_old_cost, v_catalog_pack ...
   :151  v_new_cost := v_item.invoiced_unit_cost;          -- DIRECT, no conversion
   :157  v_units_match := invoice_pack='' OR catalog_pack='' OR invoice_pack=catalog_pack;  -- string equality
   :160-167  IF cost changed > 1% THEN
   :171      UPDATE inventory_catalog_items SET default_unit_cost = v_new_cost ...  -- OVERWRITE
   :187-196  classify as unit_mismatch / price_increase / price_decrease  -- NOTIFY ONLY
   ```
   **Critical facts (verified):**
   - **No unit conversion** between invoiced cost and the per-case catalog cost. `v_new_cost` is the raw invoiced number.
   - The `unit_mismatch` detection (`:187-190`) is **string equality on `pack_size` + a >50% jump heuristic**. When it fires it **emits a notification but does NOT block the overwrite** (`:171` runs regardless).
   - **No `catalog_cost_history` / cost-audit table exists** in any migration. `v_old_cost` survives only inside an ephemeral, member-writable `notifications` row. **The overwrite is unrecoverable.**
6. **Inventory Value** (`casePlanningEngine.ts:103-108`, summed `dashboardSelectors.ts:235-244`): `Σ current_stock(cases) × default_unit_cost`. If step 5 left a per-pound \$64.03 where the catalog is "per 24-ct case", every value/overstock/reorder dollar for that item is wrong by the pack ratio — **silently**.
7. **Waste / Food Cost / Profit** consume the same `default_unit_cost` (PART 6).

**Rounding sites:** `resolveInvoiceUnitCost.ts:21` (2dp), `casePlanningEngine.round2` per line then per aggregate (`:56-58,221-223` — deliberately rounds per-line then re-rounds totals to avoid compounding — good), `confirm RPC` pct `ROUND(...,1)` (`:177`). Rounding is disciplined; it is **unit mismatch**, not rounding, that drives money drift.

---

## PART 6 — Mathematical consistency: do all KPIs use the same canonical cost?

| KPI | Cost field | Unit basis | Same canonical cost? | Evidence |
|-----|-----------|------------|----------------------|----------|
| Inventory Value (hero) | `unit_cost` (session) | per-case | ✅ | `dashboardSelectors.ts:199,235-244` (dedupes zones) |
| Inventory Value (trend chart) | `unit_cost` (session) | per-case | ⚠️ **diverges** | `buildInventoryTrendData:339-361` **does NOT dedupe zones** — verified |
| Overstock | `unit_cost` (session) | per-case | ✅ | `casePlanningEngine.ts:134-148` |
| Reorder $ | `unit_cost` (session) | per-case | ✅ | `casePlanningEngine.ts:116-125` |
| Waste | `total_cost` → else case-only | guarded | ✅ **strong** | `recordedWasteValue.ts:34-61` |
| Food Cost % | `invoice_items.total_cost` | dollars | ✅ (cost-unit-independent) | `loadFoodCostMetrics.ts`, `loadSpendMetrics.ts` |
| Price Increase | `invoiced_unit_cost − po_unit_cost` | **invoice unit (unverified per-case)** | ⚠️ | `dashboardSelectors.ts:127-146`; second basis in `loadProfitLeaks.ts` |
| Missing Delivery $ | `invoiced_unit_cost` | **invoice unit** | ⚠️ | `dashboardTrustFormulas.ts:90-97` |
| Shrinkage | notifications `dollar_impact` | pre-computed, **mutable source** | ❌ | `loadShrinkageValue.ts` |
| Recipe cost | — | — | n/a — **DEAD** | tables dropped `20260502000001` |

**Two genuinely strong points worth preserving:**
1. **Waste unit-guard** (`recordedWasteValue.ts:44`): for non-case units it returns 0 rather than multiplying a per-case cost by a pound quantity — the exact class of bug that breaks the cost path elsewhere. This is the correct pattern and should be the template for the receipt path.
2. **Per-line-then-aggregate rounding** in the planning engine.

**Where it diverges:** (a) trend chart double-counts zone-split rows the hero merges; (b) price-increase/missing-delivery trust invoice unit costs that were never proven per-case; (c) shrinkage sums a member-writable source.

---

## PART 7 — Smart Order unit handling

- **Need → cases:** `computeOrderQtyCases(stock, par) = Math.ceil(max(0, par − stock))` (`inventory-utils.ts:197-207`); stock/par already in cases. A 220-oz need is *never seen* as oz here — it was converted to cases at **count** time, so reorder operates purely in cases. The "220 oz → 0.34 case → 1 case" conversion therefore depends entirely on the count-time parser (PART 4) being right.
- **Two engines on screen:** the **deprecated** `computeOrderQty` (unit-aware: returns decimals for LB/GAL, ceil for cases — `inventory-utils.ts:217-235`) is still rendered in `Review.tsx:323` and `Approved.tsx:235`, while the canonical `computeOrderQtyCases` runs everywhere else. For weight items they **disagree on screen** (e.g. GAL → 2.5 vs 3).
- **Partial cases:** always `Math.ceil` → whole cases. **No minimum-order / breakpoint logic** anywhere (no `min_case_qty` column or check).
- **Vendor case-size variability:** **not modeled.** No per-vendor `units_per_case`. If vendor A ships 38-lb cases and the catalog assumes 40-lb, every count and value for goods from A is ~5% off, and `stock_movements.source_quantity` records the discrepancy for audit but **nothing uses it to correct**.
- **Zone double-count:** duplicate parent rows for one `catalog_item_id` are summed by smart order (`zoneReconcile.ts:44-58` warns but does not merge; the hero merges, smart order may not).

---

## PART 8 — Real restaurant operations (can one truth survive?)

| Scenario | Survives today? | Why / gap |
|----------|:---------------:|-----------|
| Vendor changes case 40→38 lb | ❌ | single catalog `units_per_case`; no per-vendor size; no re-derivation |
| Invoice "1.5 case" | ⚠️ | fractional cases OK in math; but `Math.ceil` on order only |
| Count in lb, recipe in oz | ❌ recipe (dead); ⚠️ count via naive parser | recipe tables dropped; weight count drift (PART 4) |
| Vendor changes pack size | ❌ | overwrites `default_unit_cost` with no history, no pack reconciliation |
| Partial damage / half case returned | ❌ | no returns/credit-memo concept; no negative receipt path proven |
| Credit memo | ❌ | no table/flow |
| Inventory correction / transfer | ⚠️ | `stock_movements` has `adjustment` type but ledger inactive |
| Multiple vendors, same item | ❌ | one cost, one pack; last invoice overwrites |

**One mathematical truth cannot currently be maintained** across vendor pack changes, multi-vendor items, returns, or weight-based recipes.

---

## PART 9 — Industry comparison (architecture, not features)

| Pattern | R365 / MarginEdge / SAP B1 / Dynamics BC | Margin6 today |
|---------|------------------------------------------|---------------|
| Canonical base unit | Per-item **base UoM** + stored **UoM conversion table** (purchase↔stock↔recipe) | Single assumed "case"; **no conversion table**; runtime text parsing |
| Cost layers | Perpetual valuation (FIFO/avg/standard) with **immutable cost layers** | Single mutable `default_unit_cost`, **overwrite-in-place, no history** |
| Receiving | GRN posts to a **ledger** that is the system of record | Movements written but **sessions are SoR**; ledger dormant |
| Vendor pack variance | Vendor-specific item/pack/price records | None — one pack per catalog item |
| Recipe costing | Recipe BoM costed from base-unit cost with explicit UoM conversion | **Dropped** |
| Audit | Full cost & movement history | Notifications only (mutable, dedup-dropped) |

**Where Margin6 is stronger:** *explainability surface* ("View Math", `counted_as`/`conversion_formula` audit columns, confidence badges) — mature ERPs rarely show the math to the operator. The waste unit-guard is a genuinely correct, defensible pattern.

**Where Margin6 is weaker:** no UoM/conversion table, no cost history/layers, mutable single cost, no per-vendor pack, dormant ledger with a competing SoR. These are the foundations the incumbents treat as non-negotiable.

---

## PART 10 — Trust analysis (ranked)

| # | Risk | Stage | Can become wrong? | Severity |
|---|------|-------|-------------------|:--------:|
| 1 | Invoiced cost overwrites catalog cost with **no unit conversion**; per-lb can land in a per-case column | Receipt (PART 5) | **Yes — silent** | **Critical** |
| 2 | **No `catalog_cost_history`** → cost overwrite unrecoverable; old cost only in mutable notification | Receipt | Yes | **Critical** |
| 3 | Two parsers disagree (`"5 Lb"`/`"40 lb"` → 5×/40× count error) | Count (PART 4) | Yes | **Critical** |
| 4 | Shrinkage from **member-writable** notifications; dedup trigger ignores `data` payload | KPI | Yes — forgeable/inflatable | **High** |
| 5 | Price-increase / missing-delivery use **invoice unit costs not proven per-case** | KPI (PART 6) | Yes | **High** |
| 6 | Trend chart **double-counts zones** the hero merges | KPI | Yes — visible contradiction | **High** |
| 7 | **No per-vendor case size**; vendor pack change unmodeled | Reorder/value | Yes — ~pack-ratio drift | **High** |
| 8 | Weight-cost correction is an **arbitrary ratio>3 heuristic** | Parse | Yes (edge cases) | Medium |
| 9 | Duplicate parent rows double-count in smart order | Reorder | Yes | Medium |
| 10 | Deprecated `computeOrderQty` still rendered → two order numbers | Reorder UI | Display only | Medium |
| 11 | Receipt confirms don't move dashboard on-hand (sessions vs movements) | Lifecycle | Confusing, not wrong-money | Medium |
| 12 | `counted` defined inconsistently (`>0` vs `!==null`) | Count | Count drift | Low |
| 13 | Recipe engine dead code | Recipe | Inert | Low |

**Can suppliers manipulate values?** Indirectly yes — a vendor invoice drives an unguarded cost overwrite (risk 1). **Can users accidentally break conversions?** Yes — editing `pack_size` text silently re-derives every conversion (risk 3). **Can duplicate inventory exist?** Yes — duplicate parent rows (risk 9). **Can dashboard dollars differ across one screen?** Yes — risk 6.

---

## PART 11 — Recommended architecture (if I were CTO)

Yes — redesign the unit/cost foundation. Target model, per inventory item:

1. **Canonical base unit** (stored, e.g. `base_unit` = lb/each/ml) — the single unit all math reduces to. **Not "case"** — case is a *purchase pack*, not a base unit.
2. **Conversion table** `item_unit_conversions(item_id, from_unit, to_unit, factor, source, effective_from)` — explicit, queryable, versioned. Replace both runtime parsers with one resolver that reads this table; seed it from `parsePackSize` but make it editable and auditable.
3. **Purchase unit + purchase conversion** per **vendor** (`vendor_item_mappings.units_per_purchase_unit`, `base_unit`) — so a 38-lb vendor case and a 40-lb vendor case for the same item coexist truthfully.
4. **Immutable cost layers / `catalog_cost_history`** (`item_id, base_unit_cost, source_invoice_id, effective_from, created_by`) — cost is *appended*, never overwritten; `default_unit_cost` becomes a view over the latest layer. This alone makes every dashboard dollar traceable to an invoice.
5. **Cost write-back must convert** invoiced cost → base-unit cost using the vendor purchase conversion, and **block (not just notify)** on unit mismatch.
6. **Recipe unit + inventory unit + display unit** all expressed via the conversion table; recipe costing reads base-unit cost.
7. **Conversion history** mirrors cost history — every factor change is auditable.

**Why:** this is the only structure under which the acceptance test ("trace \$42,518 to invoices and conversions") is *provable* rather than *assumed*. It also matches what R365/MarginEdge/SAP treat as table stakes, and it generalizes the one pattern Margin6 already gets right (the waste unit-guard) into a system-wide rule.

---

## PART 12 — Implementation roadmap (no code; sequencing only)

> Honors the trust-first ordering (Security → Permission → KPI correctness). Effort: S ≤0.5d · M 1–2d · L 3–5d · XL >1wk. **Gate first:** green CI before any of this.

| Pri | Item | Effort | Dep |
|:---:|------|:------:|-----|
| **Critical** | **C1** Add immutable `catalog_cost_history`; make receipt *append* a layer, never bare-overwrite | L | green CI |
| **Critical** | **C2** Receipt cost write-back: convert invoiced→per-case via pack/vendor factor; **block on unit_mismatch** instead of notify-only | L | C1 |
| **Critical** | **C3** Unify the two pack parsers into one resolver; add a parity test; fix `"5 Lb"`/single-unit weight drift | M | — |
| **High** | **C4** Re-source shrinkage off member-writable notifications (depends on notifications lock S0-8) | M | S0-8 |
| **High** | **C5** Dedupe zones in `buildInventoryTrendData` to match the hero | S | T0-0 |
| **High** | **C6** Pin price-increase / missing-delivery to a proven per-case (or per-base) cost; single qty basis | M | C2 |
| **High** | **C7** Vendor-specific purchase unit/case size on `vendor_item_mappings`; use in count/value | L | C3 |
| **Med** | **C8** Replace `resolveUnitCost` ratio>3 heuristic with pack-aware conversion | M | C3 |
| **Med** | **C9** Merge duplicate parent rows in smart order (match hero dedupe) | M | — |
| **Med** | **C10** Remove deprecated `computeOrderQty` from Review/Approved | S | — |
| **Med** | **C11** Decide system-of-record: activate ledger OR drop movement writes; reconcile receipt→on-hand | XL | C1 |
| **Low** | **C12** Unify `counted` definition (`>0`) across `InventoryCountPage` / `itemView` | S | — |
| **Low** | **C13** Remove dead recipe engine or rebuild on the new conversion table | S/L | C3 |
| **Foundation** | **C0** `item_unit_conversions` + per-item `base_unit` (PART 11) — the substrate C2/C3/C6/C7 should ideally build on | XL | scoping |

---

## Final goal — can we prove a dashboard dollar today?

For **"Why is my Inventory Value \$42,518?"** we can show:
- ✅ the **formula** (`Σ current_stock × unit_cost`, `casePlanningEngine.ts:103-108`),
- ✅ the **source** (latest APPROVED session),
- ✅ the **per-item math** ("View Math"),
- ⚠️ the **count conversion** (audit string exists, but the factor may be from the drift-prone parser),
- ❌ that each **`unit_cost` is truly per-case** (could be an unconverted per-lb overwrite — PART 5),
- ❌ **which invoice set that cost and what it replaced** (no cost history — PART 5 #2).

**The chain breaks at cost provenance and unit safety.** Until `catalog_cost_history` + unit-converting, blocking receipt + a single conversion resolver exist (C1–C3), the dollar is *explainable in form but not provable in fact*. Everything needed to close the gap is in PART 11–12; nothing in this document changed any code, migration, or data.
