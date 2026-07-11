# Plan — S0-9: Enforce manager authorization in `confirm_invoice_receipt`

> **Date:** 2026-06-23 · **Status:** Recommended — **awaiting approval; nothing implemented.**
> **Investigation:** [s0-9-confirm-invoice-receipt-enforcement.md](../investigations/s0-9-confirm-invoice-receipt-enforcement.md) · **Depends on:** S0-INFRA (`8d4859b`). **Pattern:** S0-4 (`a486715`).
> Contains the required deliverables as labeled sections: **Architecture Review · Implementation Plan · Risk Assessment · Test Matrix · Rollback Plan · Trust Summary.**

## 0. Root cause (one line)

`confirm_invoice_receipt` (and its sibling `_legacy`) authorize on `is_member_of` only, so any member can perform the product's most destructive write (catalog-cost overwrite + receiving + price notifications) — the UI's "manager confirms" promise is unenforced (G9).

---

## A. ARCHITECTURE REVIEW — `can_confirm_receipt(uid, restaurant)` (Requirement 6)

The S0-INFRA helper (`8d4859b`): `can_confirm_receipt(p_uid, p_restaurant_id)` = `has_restaurant_role_any(restaurant, {OWNER, MANAGER})`.

| Question | Recommendation | Reasoning |
|----------|----------------|-----------|
| **Is Manager+ sufficient?** | **Yes — adopt as-is.** | It exactly matches the UI's *"confirmed by a manager"* copy and the Manager+ StaffRestricted route. Receipt confirmation commits cost-of-record; restricting it to Manager+ is the minimum defensible bar and closes G9. |
| **Should location permissions matter?** | **No (for now).** | `invoices` is **restaurant-scoped** (no `location_id`; confirmed in investigation §5). There is no per-location receiving grant to honor. A future refinement could scope confirmation to managers of the invoice's location *if* invoices gain a `location_id` — note as a follow-up, not S0-9. |
| **Should a future receiving permission exist?** | **Optional future** (`can_receive` flag). | Some operators let trusted line staff receive deliveries. If product wants that, add a `can_receive` flag to `user_location_assignments` and extend `can_confirm_receipt` to `Manager+ OR (member AND can_receive)`. **Out of S0-9** — today there is no such flag, and the UI promises a manager. |
| **Should OWNER always bypass?** | **Yes (already).** | `can_confirm_receipt` returns true for OWNER via `has_restaurant_role_any(OWNER,…)`. Owners must always be able to confirm. |

**Recommendation:** use `can_confirm_receipt(auth.uid(), p_restaurant_id)` unchanged — no helper change, no new flag.

---

## B. IMPLEMENTATION PLAN (Requirement 7)

**One migration**, `CREATE OR REPLACE` of **both** functions (same signatures/bodies) with the gate swapped in. **RPC-only; no client/UI/types change.**

### Exact insertion point & preamble
Replace the existing membership check at the **top** of each function — in `confirm_invoice_receipt` ([20260524000001:36-38](../../supabase/migrations/20260524000001_fix_catalog_default_unit_cost_in_confirm_receipt.sql#L36)) and identically in `confirm_invoice_receipt_legacy` ([20260507000001:364](../../supabase/migrations/20260507000001_production_schema_repair.sql#L364)):
```sql
-- before:
IF NOT public.is_member_of(p_restaurant_id) THEN
  RAISE EXCEPTION 'Access denied';
END IF;

-- after (S0-9): manager authorization (mirrors the "confirmed by a manager" UI promise).
IF NOT public.can_confirm_receipt(auth.uid(), p_restaurant_id) THEN
  RAISE EXCEPTION 'Access denied: a manager or owner role is required to confirm receipt'
    USING ERRCODE = 'insufficient_privilege';
END IF;
```
- `can_confirm_receipt` **implies membership** (it requires a `restaurant_members` row with OWNER/MANAGER), so this both authenticates and authorizes — `is_member_of` is fully subsumed; no separate membership line needed.
- Placed **first**, before the `FOR UPDATE` invoice lookup and every write — fail-closed, nothing mutates on rejection.
- **Both** functions gated: `confirm_invoice_receipt` covers the normal path *and* its internal `_legacy` fallback; gating `_legacy` directly closes the independent REST entry point (defense-in-depth).
- Everything below the preamble is **byte-for-byte the current body** (re-stated in the `CREATE OR REPLACE`).

### Error behavior
- `RAISE EXCEPTION … USING ERRCODE='insufficient_privilege'` → PostgREST returns an error → the UI's existing `if (error) throw error` handler ([useInvoiceReviewActions.ts:142](../../src/hooks/useInvoiceReviewActions.ts#L142)) toasts it. **Optional, separate UI polish:** map this to a friendly string ("Only a manager can confirm receipt") — not required for the security fix.
- Distinct from the function's existing `success:false` soft-returns (e.g. unconfirmed received_qty) — those remain unchanged; this is a hard authorization raise.

### Deployment strategy
- Migration-only; **no co-deploy** (signature unchanged, one caller untouched — unlike S0-8). Apply migration → `NOTIFY pgrst`. Run the staging matrix (§D).
- Timestamp after S0-4's `20260623000006` (e.g. `20260623000007`).

### Order of work
1. Confirm decisions (gate both fns ✓; Manager+ ✓; no location/flag ✓).
2. Write the migration (re-state both bodies with the swapped preamble).
3. (Optional) friendly UI error string — only client touch, behavior-neutral; recommend deferring.
4. Tests (regression) + staging matrix.

---

## C. RISK ASSESSMENT

| # | Risk | Severity | Mitigation |
|---|------|:--------:|-----------|
| R1 | **Re-stating the large body introduces a transcription error** (this fn is ~250 lines) | High | Copy the live body verbatim from `20260524000001`; diff against it to confirm only the preamble changed; regression test the confirm payload (`price-increase-notifications.test.ts`). |
| R2 | A legitimate STAFF receiving workflow breaks | Low | None exists — the route is StaffRestricted (Manager+); STAFF have no UI path. OWNER/MANAGER unaffected. |
| R3 | `_legacy` left ungated (bypass) | High → mitigated | Gate **both** functions in the same migration. |
| R4 | OWNER/MANAGER without expected membership row blocked | Low | `can_confirm_receipt` returns true for any OWNER/MANAGER member; no location dependency (invoices restaurant-scoped). |
| R5 | DB verification not run in sandbox | Medium | Matrix documented (§D); run at staging — same posture as all S0 items. |
| R6 | Adjacent `notify_delivery_issues` remains membership-only | Low (separate) | Out of S0-9 scope; note as a follow-up (it only creates DELIVERY_ISSUE notifications, not cost mutations). |
| R7 | Hidden second caller emerges | Low | Investigation §4 confirms one client caller + internal fallback; grep re-run at implementation. |

---

## D. TEST MATRIX (Requirement 8)

**Unit (CI, no DB):** the Manager+ rule is already pinned by the S0-INFRA parity matrix (`authz-parity.test.ts` — `can_confirm_receipt`). Regression: `vitest` + `tsc` green; the existing `invoice-review-actions.test.ts` (mocks the rpc) and `price-increase-notifications.test.ts` (payload shape) **must stay green** (server gate doesn't change the client call or payload).

**Role matrix (run at `supabase db reset` / staging)** — seed OWNER, MANAGER, STAFF members + a confirmable invoice with catalog-linked lines:

| # | Actor | Path | Expect |
|---|-------|------|:------:|
| 1 | **OWNER** | `rpc confirm_invoice_receipt` | success; catalog cost updated, stock movements + price notifications created |
| 2 | **MANAGER** | `rpc confirm_invoice_receipt` | success (same as owner) |
| 3 | **STAFF** | `rpc confirm_invoice_receipt` | **RAISE** `Access denied: a manager or owner role is required` — **no** catalog/stock/notification writes |
| 4 | **non-member** | `rpc confirm_invoice_receipt` | **RAISE** (denied) |
| 5 | **STAFF** | `rpc confirm_invoice_receipt_legacy` (direct) | **RAISE** (legacy gated too) |
| 6 | MANAGER | `rpc confirm_invoice_receipt_legacy` (purchase_history id) | success |
| 7 | OWNER | re-confirm already-confirmed invoice | success + `already_confirmed:true`, idempotent (no double cost overwrite / double movements) |
| 8 | STAFF | already-confirmed invoice | **RAISE** (gate is first, before the already-confirmed short-circuit) |

**Side-effect assertions for case 3 (the core security property):** after a STAFF attempt, assert **zero** new rows in `stock_movements`, **no** change to `inventory_catalog_items.default_unit_cost`, **no** new `notifications`, and `invoices.receipt_status` unchanged.

**Shape assertion:**
```sql
SELECT proname, prosecdef, pg_get_function_identity_arguments(oid)
FROM pg_proc WHERE proname IN ('confirm_invoice_receipt','confirm_invoice_receipt_legacy');
-- both prosecdef=true; args = 'p_invoice_id uuid, p_restaurant_id uuid'
```

**Regression smoke:** a MANAGER confirm still produces the full result payload (confirmed counts, price_changes, stock_movements) exactly as before — gate is additive, before the body.

**Staging verification steps:** (1) `supabase db reset` applies `20260623000001`–`0007` cleanly; (2) run cases 1–8 as each seeded role; (3) run the side-effect assertions for case 3; (4) confirm the InvoiceReview page (as a MANAGER) still posts an invoice end-to-end.

---

## E. ROLLBACK PLAN

- **Mechanism:** `CREATE OR REPLACE` both functions back to their prior (`is_member_of`) preambles via a follow-up migration, **or** `git revert` the S0-9 migration commit + redeploy. The `can_confirm_receipt` helper can remain (unused by the reverted fns; harmless).
- **Data impact:** none — the gate only **rejects before any write**; a denied call mutates nothing. No rows to backfill.
- **Re-opens leak?** Yes — reverting restores G9 (STAFF can confirm). Only roll back if the gate demonstrably blocks a legitimate manager (none expected, since the helper is the same Manager+ rule used elsewhere). Prefer a forward fix over revert.
- **Co-dependency:** none (RPC-only, signature unchanged, one untouched caller).

---

## F. ESTIMATED EFFORT
RPC gate on both fns (careful body re-statement) + tests: **M** (≈1 day, most of it verifying the verbatim body copy). Optional friendly UI string: **S**. Staging matrix: **S**.

---

## FINAL — Trust summary (required questions)

- **What is the trust problem?** The product's promise is *traceable, trustworthy cost numbers*. Today a low-privilege (or compromised) member can silently **rewrite every catalog cost** and **fabricate price-change signals** by calling one RPC — the exact opposite of the promise.
- **What is the root cause?** `confirm_invoice_receipt` (+ `_legacy`) authorize on `is_member_of` only; the manager requirement lives only in the UI route/copy. Classic UI-only permission (G9).
- **Why is this P0?** It is the **cost-of-record mutation** with the widest blast radius (catalog cost → Inventory Value, Overstock, Reorder, Food Cost; plus price-increase KPIs and the weekly digest) and **no audit trail** (T1-2). Unauthorized use corrupts the numbers the whole product exists to protect.
- **Why does S0-INFRA solve it cleanly?** The exact rule already exists, tested, as `can_confirm_receipt` (Manager+, OWNER-inclusive) — matching the UI promise. The fix reuses it: **no new permission logic** (CLAUDE.md "do not duplicate permission systems"), one helper call, no client change.
- **What exact change will be made?** Replace the `is_member_of` preamble with `can_confirm_receipt(auth.uid(), p_restaurant_id)` in **both** `confirm_invoice_receipt` and `confirm_invoice_receipt_legacy`, fail-closed before any write. Migration-only.
- **What customer trust improves after deployment?** Only managers/owners can confirm receipts — so catalog costs and price-change KPIs can only be changed by an authorized person. The owner regains the guarantee that *the numbers moved because a manager confirmed a real delivery*, not because any staffer (or attacker) poked an API. This also de-risks the still-open audit-trail gap (T1-2) by shrinking who can trigger a cost change.

> No application code, migration, or RPC was modified in producing this plan. Implementation not started; awaiting approval.
