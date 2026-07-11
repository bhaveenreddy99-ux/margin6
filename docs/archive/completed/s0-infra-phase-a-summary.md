# Completed — S0-INFRA Phase A: canonical authorization helpers (additive)

> **Date:** 2026-06-23 · **Workflow step:** STEP 6 — Final Review
> **Investigation:** [s0-infra-permission-architecture.md](../investigations/s0-infra-permission-architecture.md) · **Architecture:** [s0-infra-authorization-model.md](../architecture/s0-infra-authorization-model.md) · **Plan:** [s0-infra-implementation-plan.md](../plans/s0-infra-implementation-plan.md) (Phase A) · **Results:** [s0-infra-phase-a-results.md](../test-results/s0-infra-phase-a-results.md)

## 1. What changed

**Additive only — new functions + grants + a test. No enforcement, no UI, no columns, no policies.**

| File | Change |
|------|--------|
| `supabase/migrations/20260623000005_authz_helpers.sql` | **New.** Three `SECURITY DEFINER STABLE` helpers + grants + one hardening revoke. |
| `src/test/authz-parity.test.ts` | **New.** 70-case parity matrix (SQL logic ↔ `useLocationPermissions` logic). |

Helpers added:
- **`has_location_permission(p_uid, p_location_id, p_flag)` → boolean** — effective value of a per-location flag; OWNER ⇒ true; non-owner ⇒ assignment value; no assignment ⇒ false; unknown flag ⇒ raises (whitelist).
- **`can_approve_order_amount(p_uid, p_restaurant_id, p_location_id, p_amount)` → boolean** — OWNER ⇒ unlimited; else `can_approve_orders` AND (threshold null ⇒ unlimited; else `amount ≤ threshold`).
- **`can_confirm_receipt(p_uid, p_restaurant_id)` → boolean** — Manager+ (OWNER/MANAGER) role rule.

Grants: each new helper `REVOKE … FROM PUBLIC, anon` + `GRANT EXECUTE … TO authenticated`. Hardening: **`REVOKE ALL ON get_location_permissions(…) FROM anon`** (GA-11).

## 2. What this delivers

The single, server-callable permission layer the foundation needs — encoding the exact semantics the client already uses (OWNER⇒all; threshold-null⇒unlimited; no-assignment⇒denied), so future consumers call **one** source of truth instead of re-implementing role/flag logic. **Nothing is enforced yet** — this is the additive base; S0-4/S0-9/S1-1/S1-6/S1-7 will *use* these helpers in their own changes.

## 3. Parity contract (the key correctness property)

The helpers must agree with `useLocationPermissions.ts` or the UI and server would diverge. `authz-parity.test.ts` encodes **both** sides independently and asserts equality across the matrix (incl. OWNER-all, no-assignment-denied, MANAGER-not-auto-granted, threshold boundary `==` passes). Notable parity decision: **MANAGER is NOT auto-granted flags** — the client only short-circuits OWNER, so the helpers do too. (If product later wants Manager+ to always approve, that is a *deliberate* change to both client and `can_approve_order_amount`, made together.)

## 4. Verification
- **CI:** `tsc` clean; `vitest` **556 passed** (+70). Parity matrix green.
- **DB matrix + grant/`prosecdef` assertions:** documented in the results doc; **pending** at `supabase db reset` / staging (no DB in sandbox).
- **No behavior change** to observe in the app (additive).

## 5. What was explicitly NOT done (per instruction)
- ❌ S0-4 (`submit_smart_order`) — not started.
- ❌ S0-9 (`confirm_invoice_receipt`) — not started.
- ❌ No UI modified (`useLocationPermissions` untouched; helpers only *mirror* it).
- ❌ No deprecated column removed (`user_location_assignments.role` left in place).
- Phases B(client-side)/C/D/E/F of the plan — not started.

## 6. Risks / notes
- **Generic flag helper chosen** (one `has_location_permission` with the OWNER short-circuit) per plan decision #1.
- **`can_confirm_receipt` = Manager+** per plan decision #2 (no receiving flag exists).
- **Reserved param:** `can_approve_order_amount` takes `p_restaurant_id` (used for the OWNER check, robust to a null `p_location_id`); non-owner + null location ⇒ false (consumers pass the resolved location). S0-4 will decide how it reads the run's location/total.
- **DB verification still pending** (as with all S0 RLS/RPC items) — run the matrix at deploy.
- Migration `20260623000005` sorts after S0-8's `20260623000004`.

## 7. Rollback
Drop the three new functions and restore the `get_location_permissions` anon grant (or revert the migration). No data touched; nothing depends on these yet (no consumer wired) → zero-impact rollback.

## 8. Next (await approval)
Per the plan: **Phase B is already covered in CI** (the parity matrix) — the remaining Phase-B step is running the DB matrix at staging. Then Phase C wires **S0-4** then **S0-9** to these helpers. Not started — awaiting approval.
