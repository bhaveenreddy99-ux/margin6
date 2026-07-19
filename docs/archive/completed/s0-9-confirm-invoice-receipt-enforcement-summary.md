# Completed — S0-9: `confirm_invoice_receipt` requires a manager/owner

> **Date:** 2026-06-23 · **Workflow step:** STEP 6 — Final Review
> **Investigation:** [s0-9-confirm-invoice-receipt-enforcement.md](../investigations/s0-9-confirm-invoice-receipt-enforcement.md) · **Plan:** [s0-9-confirm-invoice-receipt-enforcement-plan.md](../plans/s0-9-confirm-invoice-receipt-enforcement-plan.md) · **Results:** [s0-9-confirm-invoice-receipt-enforcement-results.md](../test-results/s0-9-confirm-invoice-receipt-enforcement-results.md)

## 1. What changed

**Migration-only — both confirm functions re-created with the gate swapped in. No client/UI/signature change.**

| File | Change |
|------|--------|
| `supabase/migrations/20260623000007_confirm_receipt_enforce_manager.sql` | **New.** `CREATE OR REPLACE` of `confirm_invoice_receipt` and `confirm_invoice_receipt_legacy`, replacing the `is_member_of` preamble with `can_confirm_receipt(auth.uid(), p_restaurant_id)`. |

The preamble in **both** functions:
```sql
IF NOT public.can_confirm_receipt(auth.uid(), p_restaurant_id) THEN
  RAISE EXCEPTION 'Access denied: a manager or owner role is required to confirm receipt'
    USING ERRCODE = 'insufficient_privilege';
END IF;
```
`can_confirm_receipt` (S0-INFRA, `8d4859b`) = Manager+ (OWNER/MANAGER) and **implies membership**, so this both authenticates and authorizes, **before any write**. Everything below the preamble is reproduced **verbatim** from the live definitions.

## 2. What problem was solved

`confirm_invoice_receipt` (+ `_legacy`) authorized on membership only, so any member — incl. STAFF — could perform the product's most destructive write: overwrite canonical catalog costs, create receiving stock movements, mark invoices confirmed, and emit price-change notifications that feed money KPIs — despite the *"confirmed by a manager"* UI promise and the Manager+ route (G9). Now only a manager/owner can confirm. Honors CLAUDE.md "RPCs must enforce permissions; never trust UI" and reuses the single S0-INFRA helper (no duplicated logic).

## 3. Decisions applied (per approval)
- Gate `confirm_invoice_receipt` **and** `confirm_invoice_receipt_legacy` (the latter is granted to `authenticated` and directly callable).
- Fail closed **before any write**.
- **No client / UI / signature change.** Manager+ (no location/flag — invoices are restaurant-scoped).

## 4. Why it's safe (no legitimate flow broken)
- One client caller (`useInvoiceReviewActions.ts:139`), unchanged — signature identical.
- The review route is StaffRestricted (Manager+) and the copy says "manager," so no legitimate STAFF path is lost; OWNER/MANAGER unaffected (the helper returns true for them).
- **Body-fidelity verified:** a line diff confirms the post-preamble body of each function is **byte-for-byte identical** to its live source (`20260524000001` / `20260507000001`) — only the preamble changed (R1, the top risk, mitigated).
- Gate is additive and first → a rejected call mutates nothing.

## 5. Verification
- **CI:** `tsc` clean; `vitest` **556 passed** (no client change). Manager+ rule unit-covered by the S0-INFRA parity matrix.
- **RPC role matrix** (8 cases incl. legacy direct, re-confirm, side-effect assertions that a STAFF attempt writes nothing) + `pg_proc` shape assertion documented in the results doc; **pending** at `supabase db reset` / staging.

## 6. Risks / notes
- **Adjacent `notify_delivery_issues`** (called by the UI right after confirm) remains membership-only — a **separate follow-up** (creates only DELIVERY_ISSUE notifications, not cost mutations). Not in S0-9 scope.
- **Audit trail still absent (T1-2):** receipt confirmation still overwrites `default_unit_cost` with no `catalog_cost_history`. S0-9 shrinks *who* can trigger it (to managers); the history gap is a separate KPI/trust item — **not started** (per instruction).
- **DB verification pending** (as with all S0 RLS/RPC items) — run the matrix at deploy.
- Migration `20260623000007` sorts after S0-4's `20260623000006`.

## 7. Rollback
`CREATE OR REPLACE` both functions back to the `is_member_of` preamble (follow-up migration), or `git revert` this commit + redeploy; the `can_confirm_receipt` helper can remain (harmless). No data touched (gate only rejects before writing). Rollback re-opens G9 — prefer a forward fix over revert.

## 8. Not done (per instruction)
- ❌ No KPI work (T0-7 / T1-2 / `catalog_cost_history`).
- ❌ No client / UI / signature change.
- ❌ `notify_delivery_issues` not gated (separate follow-up).

## 9. Phase 2 status
Phase 2 P0 RPC enforcement is now complete: **S0-INFRA** (helpers) → **S0-4** (`submit_smart_order`) → **S0-9** (`confirm_invoice_receipt`) — all three consume the single permission helper layer.
