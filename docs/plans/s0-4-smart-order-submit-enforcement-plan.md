# Plan — S0-4: Enforce approval threshold + `can_approve_orders` in `submit_smart_order`

> **Date:** 2026-06-23 · **Status:** Recommended — **awaiting approval; nothing implemented.**
> **Investigation:** [s0-4-smart-order-submit-enforcement.md](../investigations/s0-4-smart-order-submit-enforcement.md) · **Depends on:** S0-INFRA Phase A (`8d4859b`).
> Contains the four required deliverables as labeled sections: **Architecture · Implementation · Test plan · Rollback.**

## 0. Root cause (one line)

`submit_smart_order` authorizes on `is_member_of` only; the approval rule (`can_approve_orders` + `order_approval_threshold`) lives only in the UI, so any member can submit any-size PO via the RPC (G1).

---

## A. ARCHITECTURE

**Principle:** the RPC becomes the enforcement boundary, calling the already-shipped S0-INFRA helper; the UI keeps its identical gate as UX. No new permission logic, no signature change.

**The gate (server-authoritative inputs only):**
```
amount  := Σ GREATEST(suggested_order,0) × COALESCE(unit_cost,0)   -- from smart_order_run_items (run-cost; the value actually written)
location := effective location for this run (see Decision 1)
require   can_approve_order_amount(auth.uid(), v_run.restaurant_id, location, amount)   -- else RAISE
```
Placed in the RPC **after** the `FOR UPDATE` run lookup (so it serializes and the row is loaded) and **before** any write (PO number, status, purchase_history). Idempotency note: a run already `submitted` should still re-pass the gate or short-circuit — see Decision 3.

**Why server-computed amount (not a client param):** a client-supplied amount is spoofable (pass `$0` to skip the threshold). The RPC computes the same total it writes to `purchase_history_items.total_cost` → authoritative and tamper-proof.

**Why no new param / no caller change:** `restaurant_id`, `location_id`, and the items are all on/under the run the RPC already loads. The single caller (`SmartOrder.tsx:500`) stays byte-for-byte the same.

### Decisions required (before implementation)
1. **Null `location_id` fallback.** Runs may have `location_id = NULL`. Recommended rule, mirroring `useLocationPermissions`'s fallback:
   `effective_location := COALESCE(v_run.location_id, <caller's PRIMARY user_location_assignments.location_id in this restaurant>)`.
   - OWNER ⇒ passes regardless (helper returns true).
   - Non-owner, null run-location, has a primary assignment ⇒ uses that assignment's threshold (matches what the UI showed).
   - Non-owner, null run-location, **no** assignment ⇒ helper returns false ⇒ blocked (consistent with the known MANAGER-without-assignment gap, T1-10 — document, don't expand scope).
   *Alternative (simpler, stricter): if `v_run.location_id` is null, require Manager+ only. Rejected — diverges from the UI's per-location perms.*
2. **UI-vs-server total divergence (§4 of investigation).** Enforce on the **server** total (authoritative). Accept that the UI's invoice-cost "estimated" total may differ from the run-cost total the server checks → a possible safe-but-surprising rejection. **Recommended follow-up (separate, P2, UI-only):** align the UI threshold check to the run-cost total so the number the user sees equals what's enforced. **Not** part of this RPC fix.
3. **Already-submitted re-submit.** Today the RPC is idempotent (re-running re-writes the same PO). Decide: gate applies on every call (re-submit by a now-unauthorized user blocked) vs. short-circuit when `status='submitted'`. **Recommend:** apply the gate unconditionally (safer); the upsert stays idempotent for authorized callers.
4. **Helper signature already matches** — `can_approve_order_amount(p_uid, p_restaurant_id, p_location_id, p_amount)`; no change to S0-INFRA.

---

## B. IMPLEMENTATION

**One new migration** `<ts>_submit_smart_order_enforce_approval.sql` — `CREATE OR REPLACE FUNCTION public.submit_smart_order(p_run_id uuid)` (same signature/body) with the gate inserted. **RPC-only; no client/UI/types change.**

Sketch (additive gate; rest of the body unchanged):
```sql
-- … after: SELECT * INTO v_run FROM smart_order_runs WHERE id=p_run_id AND is_member_of(restaurant_id) FOR UPDATE;
--          IF NOT FOUND THEN RAISE 'Smart order run not found or access denied'; END IF;

-- S0-4: server-side approval enforcement (mirrors the SmartOrder UI gate).
DECLARE
  v_amount   numeric;
  v_location uuid;
BEGIN
  SELECT COALESCE(SUM(GREATEST(suggested_order,0) * COALESCE(unit_cost,0)), 0)
    INTO v_amount
    FROM public.smart_order_run_items
   WHERE run_id = p_run_id AND suggested_order > 0;

  v_location := v_run.location_id;
  IF v_location IS NULL THEN
    SELECT ula.location_id INTO v_location
      FROM public.user_location_assignments ula
      JOIN public.locations l ON l.id = ula.location_id
     WHERE ula.user_id = auth.uid()
       AND l.restaurant_id = v_run.restaurant_id
     ORDER BY ula.is_primary DESC
     LIMIT 1;
  END IF;

  IF NOT public.can_approve_order_amount(auth.uid(), v_run.restaurant_id, v_location, v_amount) THEN
    RAISE EXCEPTION 'order approval required: amount % exceeds your limit or you cannot approve orders', v_amount
      USING ERRCODE = 'check_violation';
  END IF;
END;
-- … then the existing PO-number / status / purchase_history writes unchanged …
```
Notes: keep `SECURITY DEFINER SET search_path=public`; the gate runs inside the same transaction as the `FOR UPDATE` lock; reuse the existing `is_member_of` run-lookup (membership stays). Map the new exception to a friendly toast in `SmartOrder.tsx`'s existing error handler *(optional polish — the handler at [:170](../../src/pages/app/SmartOrder.tsx#L170) already converts RPC errors; a UI string tweak is optional and would be the only client touch — recommend a tiny message map, still no behavior change).* 

**Order of work:** (1) confirm Decisions 1–3; (2) write the migration; (3) optional one-line friendly-message map in the existing UI error handler; (4) tests; (5) DB matrix at staging.

---

## C. TEST PLAN

**Unit (CI, no DB):** the authorization rule is already covered by the S0-INFRA parity matrix (`authz-parity.test.ts`, 70 cases — `can_approve_order_amount`). Add a small **amount-computation** unit if the total formula is extracted to a testable helper; otherwise the amount logic is pure SQL (covered by the DB matrix). Regression: `vitest` + `tsc` green (no client logic changes).

**DB / RPC matrix (run at `supabase db reset` / staging):** seed OWNER, MANAGER, STAFF, assignments, a run with items summing to a known total, at a known location.

| # | Caller | Run total | Threshold / flag | Expect |
|---|--------|-----------|------------------|:------:|
| 1 | OWNER | $5,000 | — | submit OK |
| 2 | member `can_approve_orders=false` | $10 | flag false | **RAISE** (approval required) |
| 3 | member `can_approve_orders=true`, threshold null | $9,999 | unlimited | OK |
| 4 | member threshold $1,000 | $1,000 | == limit | OK (boundary) |
| 5 | member threshold $1,000 | $1,000.01 | over | **RAISE** |
| 6 | non-member | any | — | **RAISE** ('not found or access denied' — existing) |
| 7 | member, run `location_id` null, primary assignment threshold $500 | $400 | within | OK (fallback location) |
| 8 | member, run `location_id` null, **no** assignment | $400 | — | **RAISE** (documented T1-10 edge) |
| 9 | OWNER re-submit already-submitted run | — | — | OK + idempotent (same PO) |
| 10 | member now over-threshold re-submitting a previously-submitted run | over | — | **RAISE** (gate applies unconditionally) |

**Parity / UX check:** for a representative run, confirm the UI gate (`thresholdExceeded`, `can_approve_orders`) and the server gate agree for OWNER/Manager/Staff; note any case where invoice-cost vs run-cost totals straddle the threshold (Decision 2 caveat) and confirm the server rejects safely.

**No-regression smoke:** a normal authorized submit still creates the PO + `purchase_history(_items)` exactly as before (the gate is purely additive before the writes).

---

## D. ROLLBACK

- **Mechanism:** `CREATE OR REPLACE` the prior `submit_smart_order` body (drop the gate) via a follow-up migration, **or** `git revert` the S0-4 migration commit + redeploy. The S0-INFRA helper can stay (unused by the reverted RPC; harmless).
- **Data impact:** none — the gate only *rejects before writing*; it modifies no rows. A rejected submit leaves the run/PO untouched. Rollback is instantaneous, nothing to backfill.
- **Re-opens leak?** Yes — reverting restores the `is_member_of`-only behavior (G1). Only roll back if the gate demonstrably blocks legitimate submits (e.g., a null-location fallback miss), in which case prefer a *forward* fix to the fallback rule over reverting.
- **Co-dependency:** none — RPC-only; no client co-deploy needed (unlike S0-8). If the optional UI message-map is included, it is cosmetic and independent.

---

## E. RISKS

| # | Risk | Mitigation |
|---|------|-----------|
| R1 | Null-location fallback blocks a legitimate single-location member | Decision 1 (COALESCE with primary assignment); DB matrix cases 7–8; OWNER always passes. |
| R2 | UI shows "OK" but server rejects (cost-source divergence) | Decision 2: enforce server total; recommend follow-up UI alignment; friendly error message so the user understands. |
| R3 | Over-tight gate blocks managers without assignments (T1-10) | Known, documented; do not expand scope; surfaced by case 8. |
| R4 | Idempotent re-submit semantics change | Decision 3: gate applies unconditionally; case 9/10. |
| R5 | Amount rounding/units | Use `numeric` throughout (already); boundary `==` allowed; case 4. |
| R6 | DB verification not executed in sandbox | Matrix documented; run at staging (same posture as all S0 RLS/RPC items). |

---

## F. ESTIMATED EFFORT
RPC gate + tests: **M** (≈1 day). Optional UI message map: **S**. DB matrix run at staging: **S**.

> No application code, migration, or RPC was modified in producing this plan. S0-9 not started.
