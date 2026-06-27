# Completed — C0-MVP-1: unit registry + immutable cost layers (additive foundation)

> **Date:** 2026-06-23 · **Workflow step:** STEP 6 — Final Review
> **Architecture:** [c0-canonical-inventory-cost-architecture.md](../architecture/c0-canonical-inventory-cost-architecture.md) · **Plan:** [c0-canonical-inventory-cost-implementation-plan.md](../plans/c0-canonical-inventory-cost-implementation-plan.md) (MVP step 1) · **Results:** [c0-mvp-1-results.md](../test-results/c0-mvp-1-results.md)

## 1. What changed

**One additive migration + one spec test. No production behavior change.**

| File | Change |
|------|--------|
| `supabase/migrations/20260623000008_c0_unit_registry_cost_layers.sql` | **New.** Unit registry, `base_unit` column, immutable `catalog_cost_layers`, backfill, 3 helper functions, apply-time self-verification. |
| `src/test/c0-cost-layer-spec.test.ts` | **New.** 6 spec tests pinning the migration's contract. |

The migration adds:
1. **`units`** registry (9 rows: g, kg, oz, lb, ml, l, gal, each, ct) with dimension + `to_base_factor` (standard physics; not yet consumed). RLS: read-only.
2. **`inventory_catalog_items.base_unit`** — backfilled from the free-text `unit` (package/unknown → `each`), `NOT NULL DEFAULT 'each'`, FK→`units.code`. Not consumed by any production path.
3. **`catalog_cost_layers`** — immutable, append-only cost history (invoice/vendor/package/base-unit/cost/effective_from/created_by/prev_cost/source). RLS member-read, **no client write**, and a trigger that **blocks UPDATE/DELETE** (truly append-only).
4. **Backfill** — one genesis layer per item with a `default_unit_cost`, `base_unit_qty=1` ⇒ `base_unit_cost == default_unit_cost`.
5. **Helpers** (additive, unwired): `catalog_latest_cost_layer`, `catalog_base_unit_cost`, `catalog_cost_projection` (latest layer, else fall back to `default_unit_cost`). `SECURITY DEFINER`, anon revoked.
6. **Self-verification** — the migration `RAISE`s (fails to apply) if any item lacks a `base_unit` or any latest layer ≠ `default_unit_cost`.

## 2. What this delivers

The cost-history foundation: every catalog cost now has a place to live as an **immutable, invoice-traceable layer**, and every item has a canonical **base unit** — the substrate the later slices (converting/blocking receipt, base-unit KPIs, vendor pack variance) build on. Crucially, it ships **without changing a single production number or flow** — `default_unit_cost` is still the live source; the layers and `base_unit` are read by nothing yet.

## 3. Scope honored (per approval)
- ✅ unit registry · ✅ `base_unit` · ✅ immutable `catalog_cost_layers` · ✅ backfill · ✅ 3 helpers · ✅ tests.
- ❌ receipt confirmation — **unchanged** · ❌ invoice parsing — **unchanged** · ❌ counting — **unchanged** · ❌ KPI formulas — **unchanged** · ❌ Smart Order — **unchanged**.
- ❌ `default_unit_cost` not removed · ❌ cost layers not made the live source · ❌ no receipt blocking · ❌ no vendor package logic · ❌ C0-MVP-2 not started.

## 4. Why it's safe (no behavior change — proven)
- **No production TypeScript touched** → the full 563-test suite still passes (now 569 with the 6 new spec tests) = proof KPI/dashboard/receipt/counting math is unchanged.
- Backfill identity (`base_unit_qty=1`) makes `catalog_base_unit_cost == default_unit_cost`, enforced by the migration's self-check → even if something *did* read the projection, it would return today's value.
- Nothing in `src/` references `catalog_cost_layers`, `base_unit`, or the helpers (verified) → the new surface is inert in production.
- All changes additive: new tables/columns/functions; nothing dropped; `default_unit_cost` intact.

## 5. Verification
- **CI:** `tsc` clean; `vitest` **569 passed** (+6).
- **DB matrix** (10 checks incl. immutability + RLS + grants) documented in the results doc; the migration **self-verifies the two core invariants at apply time** (base_unit non-null; latest layer == default). Run at `supabase db reset` / staging.

## 6. Risks / notes
- **`base_unit` is a conservative placeholder** for package/unknown units (→ `each`). It is **not consumed** in MVP-1; true per-item base resolution comes with the conversion tables in MVP-2. No risk today.
- **Backfill `effective_from`** uses `updated_at`/`created_at` — approximate provenance for pre-existing costs (the genesis layer has no `source_invoice_id`; real invoice links begin when receipt starts appending layers in MVP-2).
- **DB not applied in sandbox** — same posture as all migrations here; the self-check guarantees correctness on apply.
- Migration `20260623000008` sorts after S0-9's `20260623000007`.

## 7. Rollback
Drop the two tables (`catalog_cost_layers`, `units`), the three functions + the immutability trigger/function, the FK, and the `base_unit` column — or `git revert` the commit + redeploy. No production path depends on any of it → zero-impact rollback; `default_unit_cost` and all KPIs are unaffected either way.

## 8. Next (await approval)
**C0-MVP-2** (not started): wire `record_cost_layer` into receipt confirmation as a **parallel write** (append a layer alongside the existing `default_unit_cost` set), verify parity, then convert package→base + warn→block on unsafe units. Per the plan, that is the first slice that changes a flow — behind parity gates.
