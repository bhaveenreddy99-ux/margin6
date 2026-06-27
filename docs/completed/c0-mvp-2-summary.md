# Completed — C0-MVP-2: receipt cost-layer parallel-write

> **Date:** 2026-06-23 · **Workflow step:** STEP 6 — Final Review
> **Investigation:** [c0-mvp-2-receipt-cost-layer-parallel-write.md](../investigations/c0-mvp-2-receipt-cost-layer-parallel-write.md) · **Plan:** [c0-mvp-2-receipt-cost-layer-parallel-write-plan.md](../plans/c0-mvp-2-receipt-cost-layer-parallel-write-plan.md) · **Results:** [c0-mvp-2-results.md](../test-results/c0-mvp-2-results.md)

## 1. What changed

**One migration (RPC) + one spec test. No production behavior change.**

| File | Change |
|------|--------|
| `supabase/migrations/20260623000009_c0_mvp2_receipt_cost_layer.sql` | **New.** `CREATE OR REPLACE confirm_invoice_receipt` — the `20260623000007` body **verbatim** plus exactly 3 additions. |
| `src/test/c0-mvp2-receipt-cost-layer.test.ts` | **New.** 4 spec tests pinning the parallel-write contract. |

The 3 additions (line-diff verified):
- **(a)** declare `v_base_unit text;`
- **(b)** add `base_unit` to the existing `SELECT default_unit_cost, pack_size … INTO v_old_cost, v_catalog_pack` → `… , base_unit INTO … , v_base_unit`.
- **(c)** right after the `default_unit_cost` UPDATE + classification, a **non-fatal** `INSERT INTO catalog_cost_layers` mirroring the cost change.

## 2. What this delivers

Receipt confirmation now leaves an **immutable, invoice-linked cost-history layer** every time it changes a catalog cost — capturing source invoice, source line, actor, old→new cost, unit, and classification. The provenance gap (cost overwritten with no recoverable history) is closed **going forward**, while the dashboard, receipt behavior, and live cost source stay exactly as they were.

## 3. Why it's safe (no behavior change — proven)
- **Identity layer:** `base_unit_qty = 1` and `base_unit_cost = v_new_cost` ⇒ `catalog_base_unit_cost(item) == default_unit_cost` → **no number can move**, even if something read the projection (nothing does — no `src/` reference).
- **Non-fatal:** the INSERT is wrapped in `BEGIN … EXCEPTION WHEN OTHERS THEN RAISE WARNING … END` (a savepoint) → a layer failure **never blocks a receipt**; `default_unit_cost`, stock movements, and notifications proceed.
- **Append discipline:** the INSERT lives inside the existing `IF cost-changed` block (itself inside `IF NOT v_already_confirmed`) → exactly one layer per real cost change, never on re-confirm or no-change.
- **Verbatim body:** `diff` vs `20260623000007` shows only the 3 additions; the S0-9 `can_confirm_receipt` gate, the cost-change predicate, the notifications, and the return JSON are unchanged. **`confirm_invoice_receipt_legacy` is not re-created** (0 redefinitions).
- **No production TS touched** → the full 569-test suite still passes (573 with the 4 new spec tests).

## 4. Scope honored (per approval)
- ✅ main `confirm_invoice_receipt` only · ✅ non-fatal parallel-write after the cost update · ✅ insert only when cost changes · ✅ `base_unit_qty=1` · ✅ `base_unit_cost=v_new_cost` · ✅ links source invoice, line, actor, old/new cost, classification · ✅ exception-wrapped.
- ❌ legacy untouched · ❌ receipt return shape unchanged · ❌ UI unchanged · ❌ KPIs unchanged · ❌ `default_unit_cost` still the live source · ❌ no conversion logic · ❌ no receipt blocking · ❌ C0-MVP-3 not started.

## 5. Verification
- **CI:** `tsc` clean; `vitest` **573 passed** (+4). Verbatim-body + legacy-untouched proven by `diff`/`grep`.
- **DB matrix** (9 checks incl. one-layer-per-change, parity `==default`, re-confirm/no-change/legacy → none, non-fatal-on-failure, immutability, RLS) documented in the results doc; run at `supabase db reset` / staging.

## 6. Risks / notes
- **Provenance gap on insert failure** (accepted trade-off): a rare layer-insert failure leaves no history for that confirm; the cost is still correct in `default_unit_cost`. Far safer than blocking receiving. Atomic/blocking is MVP-3+ (explicit approval).
- **vendor_name is NULL** in MVP-2 (not in the approved link list); it joins in a later slice.
- **Genesis vs receipt layers:** pre-existing costs have a `source='backfill'` genesis layer (MVP-1); new confirms append `source='receipt'` layers from deploy forward.
- **DB not applied in sandbox** — same posture as all migrations here.
- Migration `20260623000009` sorts after C0-MVP-1's `20260623000008`.

## 7. Rollback
`CREATE OR REPLACE` `confirm_invoice_receipt` back to the `20260623000007` body (drop the 3 additions), or `git revert` + redeploy. Appended `'receipt'` layers remain (immutable, harmless, `==default`); optional cleanup by temporarily dropping the immutability trigger. No data loss; no dashboard impact.

## 8. Next (await approval)
**C0-MVP-3** (not started): introduce package→base **conversion** in the layer write (so `base_unit_qty`/`base_unit_cost` reflect true base units), then the **projection cutover** (`default_unit_cost` derived from the latest layer) and **warn→block** on unsafe units — each behind parity gates. That is the first slice that *changes* numbers/flow.
