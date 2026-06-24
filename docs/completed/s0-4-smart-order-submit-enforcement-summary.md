# Completed — S0-4: `submit_smart_order` enforces approval threshold + `can_approve_orders`

> **Date:** 2026-06-23 · **Workflow step:** STEP 6 — Final Review
> **Investigation:** [s0-4-smart-order-submit-enforcement.md](../investigations/s0-4-smart-order-submit-enforcement.md) · **Plan:** [s0-4-smart-order-submit-enforcement-plan.md](../plans/s0-4-smart-order-submit-enforcement-plan.md) · **Results:** [s0-4-smart-order-submit-enforcement-results.md](../test-results/s0-4-smart-order-submit-enforcement-results.md)

## 1. What changed

**Migration-only — one RPC re-created with an added gate. No caller, signature, UI, or types change.**

| File | Change |
|------|--------|
| `supabase/migrations/20260623000006_submit_smart_order_enforce_approval.sql` | **New.** `CREATE OR REPLACE FUNCTION submit_smart_order(p_run_id uuid)` (same signature/body) with a server-side approval gate inserted after the `FOR UPDATE` run lookup and before any write. |

The gate, using server-authoritative inputs only:
- **amount** = `Σ GREATEST(suggested_order,0) * COALESCE(unit_cost,0)` over the run's items (exactly the value written to `purchase_history_items.total_cost`);
- **location** = `run.location_id`, falling back to the caller's **primary** `user_location_assignments` location in the restaurant when the run has none;
- **rule** = `can_approve_order_amount(auth.uid(), restaurant_id, location, amount)` (the S0-INFRA helper from `8d4859b`) → `RAISE … USING ERRCODE='check_violation'` if false.

Applies on **every** call (including re-submit). The existing `is_member_of` run-lookup and all downstream writes are unchanged.

## 2. What problem was solved

`submit_smart_order` authorized on membership only, so any member — incl. STAFF with `can_approve_orders=false` or anyone submitting an over-threshold order — could commit a real, any-size vendor PO by calling the RPC directly (G1, the top P0 in the gap table). The RPC now enforces the **same approval model the UI shows** (`can_approve_orders` + `order_approval_threshold`, OWNER unlimited), server-side and unspoofable. Honors CLAUDE.md "RPCs must enforce permissions; never trust UI" and reuses the single S0-INFRA permission helper (no duplicated logic).

## 3. Decisions applied (per approval)
- **Server-computed authoritative total** (not a client param → unspoofable).
- **`COALESCE(run.location_id, caller primary assignment location)`** for null run location.
- **Gate applies unconditionally** (incl. re-submit).
- **No UI change, no caller/signature change.**

## 4. Why it's safe (no legitimate flow broken)
- One caller (`SmartOrder.tsx:500`), unchanged — the RPC signature is identical.
- OWNER always passes (`can_approve_order_amount` OWNER short-circuit).
- Members who pass the UI gate (have `can_approve_orders` and are within threshold) pass the server gate too — the server mirrors the UI rule.
- The gate is additive, runs before any write; a rejected submit modifies no rows.

## 5. Verification
- **CI:** `tsc` clean; `vitest` **556 passed** (no client change). The approval rule is unit-covered by the S0-INFRA parity matrix.
- **RPC matrix** (10 role/threshold/location cases) + `pg_proc` shape assertion documented in the results doc; **pending** at `supabase db reset` / staging (no DB in sandbox).

## 6. Risks / notes
- **UI-vs-server total divergence (Decision 2):** the UI gates on an invoice-cost estimate; the server enforces the run-cost total it actually records. A safe-but-surprising server rejection is possible where they straddle the threshold. **Recommended follow-up (UI-only, P2):** align the UI's threshold display/check to the run-cost total. Not part of this fix.
- **Manager-without-assignment + null run location (T1-10):** such a non-owner is blocked (no location ⇒ helper false). Known, documented; not expanded here. OWNER unaffected.
- **DB verification pending** (as with all S0 RLS/RPC items) — run the matrix at deploy.
- Migration `20260623000006` sorts after S0-INFRA's `20260623000005`.

## 7. Rollback
`CREATE OR REPLACE` the prior body (drop the gate) via a follow-up migration, or `git revert` this commit + redeploy; the S0-INFRA helper can remain (harmless). No data touched (the gate only rejects before writing). Rollback re-opens G1 — prefer a forward fix to the fallback rule over reverting if a legitimate submit is blocked.

## 8. Not done (per instruction)
- ❌ S0-9 (`confirm_invoice_receipt`) — not started.
- ❌ No UI / caller / signature change.
- The optional UI message-map and the UI total-alignment follow-up — not done (out of scope).
