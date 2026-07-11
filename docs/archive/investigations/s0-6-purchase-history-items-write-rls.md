# Investigation — S0-6: `purchase_history_items` write policy open to STAFF (name lies)

> **Date:** 2026-06-23
> **Roadmap item:** S0-6 (P0 Security), [trust-first-roadmap.md](../trust-first-roadmap.md)
> **Workflow step:** STEP 2 — Investigate ([engineering-workflow.md](../engineering-workflow.md))
> **Status:** Investigation complete — no code changed.

## 1. Summary

The write RLS policies on `purchase_history_items` are **named** "Manager+ can create / delete purchase history items" but their **conditions** are `is_member_of(...)` — so **any restaurant member, including STAFF, can INSERT and DELETE purchase-history line items via the PostgREST API**, despite the UI exposing these only on Manager+/Owner pages. The migration even documents the lie. This is role-permission-matrix **G3** (P0) and one of the "two policies that actively lie" called out in the matrix's pattern summary.

The mismatch matters because `purchase_history_items` hold realized vendor purchase cost/quantity data that feed Period Spend, Food Cost %, price comparisons, and last-order context. A STAFF account (or a compromised one) can forge or delete these rows directly.

## 2. Current RLS write policies (verified)

From [20260306000002_rls_core_inventory.sql:160-181](../../supabase/migrations/20260306000002_rls_core_inventory.sql#L160) — the live set after all migrations:

```sql
-- Comment in the migration itself:
-- "policy names say 'Manager+' but the original conditions used is_member_of —
--  that original permissiveness is preserved intentionally."

CREATE POLICY "Members can view purchase history items"        -- SELECT, is_member_of   (OK: any member view)
CREATE POLICY "Manager+ can create purchase history items"     -- INSERT, is_member_of   ← LIE: any member
CREATE POLICY "Manager+ can delete purchase history items"     -- DELETE, is_member_of   ← LIE: any member
-- (no UPDATE policy exists)
```

- **INSERT**: `WITH CHECK (is_member_of(purchase_history_restaurant_id(purchase_history_id)))` — any member.
- **DELETE**: `USING (is_member_of(purchase_history_restaurant_id(purchase_history_id)))` — any member.
- **UPDATE**: **no policy at all** → with RLS enabled, UPDATE is **denied for everyone** (see §6).
- RLS is enabled: `ALTER TABLE public.purchase_history_items ENABLE ROW LEVEL SECURITY` ([20260212042953:48](../../supabase/migrations/20260212042953_purchase_history_par_columns_demo_seed.sql#L48)).
- **No leftover/duplicate policy:** the seed migration ([20260212042953:62-71](../../supabase/migrations/20260212042953_purchase_history_par_columns_demo_seed.sql#L62)) created SELECT + INSERT with the **same names**, which `20260306000002` drops (`DROP POLICY IF EXISTS`) and recreates — so exactly one policy per command is live. I verified the full history; no second permissive write policy is OR'd in.

## 3. Policy name vs actual rule (the core finding)

| Policy | Name claims | Actual condition | Verdict |
|--------|-------------|------------------|---------|
| INSERT | "Manager+ can create…" | `is_member_of` | **Lies — any member** |
| DELETE | "Manager+ can delete…" | `is_member_of` | **Lies — any member** |
| UPDATE | (none) | — denied — | No policy |
| SELECT | "Members can view…" | `is_member_of` | Accurate |

The names match the **parent** table's correct model but the child's conditions were never converted. The lie hides the gap from anyone reviewing policy names instead of clauses.

## 4. The intended model — the parent `purchase_history` (verified correct)

[20260306000002:134-153](../../supabase/migrations/20260306000002_rls_core_inventory.sql#L134) shows what the child should mirror:

| Op | `purchase_history` (parent) | `purchase_history_items` (child, today) |
|----|------------------------------|------------------------------------------|
| SELECT | `is_member_of` | `is_member_of` ✅ matches |
| INSERT | **`has_restaurant_role_any(OWNER,MANAGER)`** | `is_member_of` ❌ |
| UPDATE | **`has_restaurant_role_any(OWNER,MANAGER)`** | none (denied) ❌ (no parity) |
| DELETE | **`has_restaurant_role_any(OWNER,MANAGER)`** | `is_member_of` ❌ |

→ **Target: child writes = Manager+**, matching the parent. Reuse the existing `has_restaurant_role_any` helper (no new helper) over `purchase_history_restaurant_id(purchase_history_id)`.

## 5. Who should create / edit / delete — and who can today

**Should:** OWNER/MANAGER only (writes), any member may SELECT — same as the parent and the UI's StaffRestricted/Owner gating.

**Can today (the leak):**
- **STAFF can INSERT** `purchase_history_items` via the API (forge purchase line items / vendor cost data).
- **STAFF can DELETE** `purchase_history_items` via the API (erase purchase records).
- Nobody can UPDATE via RLS (no policy).

**Confirmed STAFF API write access:** yes — the INSERT and DELETE policies resolve to `is_member_of`, which is true for STAFF. The UI hides these (all write pages are StaffRestricted/Owner — §7), but RLS is the real gate and it is open.

## 6. Client write call sites (who actually writes, and the impact of tightening)

Enumerated every `purchase_history_items` reference in `src/`:

| Site | Operation | Route / role | Impact of Manager+ tightening |
|------|-----------|--------------|-------------------------------|
| `useInvoiceReviewActions.ts:262-264` | **UPDATE** (`catalog_item_id`, `match_status`) | `/app/invoices/:id/review` — **StaffRestricted (Manager+)** ([App.tsx:125](../../src/App.tsx#L125)) | Currently **silently blocked** (no UPDATE policy) — see note |
| `Settings.tsx:787` | DELETE | `/app/settings` — **OwnerRoute** ([App.tsx:136](../../src/App.tsx#L136)) | Unaffected (OWNER) |
| `SmartOrder.tsx:439` | DELETE | `/app/smart-order` — **StaffRestricted (Manager+)** ([App.tsx:118](../../src/App.tsx#L118)) | Unaffected (Manager+) |
| useLastOrderDates, useListManagementData, fetchInvoiceReviewDoc, usage-analytics, PurchaseHistory, loadSpendMetrics | **SELECT** only | various | Unaffected (SELECT unchanged) |

**Two important facts:**
1. **There is no client INSERT** of `purchase_history_items`. Creation happens exclusively through **`SECURITY DEFINER` RPCs** (smart-order submit, confirm-receipt, PO sync — e.g. `20260226000001_smart_order_submit`, `20260305000002_confirm_receipt_and_po_sync`, `20260327000004_serialize_smart_order_submit`). Those **bypass RLS**, so tightening the INSERT policy has **zero effect** on legitimate creation. (Whether the *RPC* itself is properly role-gated is a separate item — e.g. S0-4 `submit_smart_order`; S0-6 only closes the **direct table-API** leak.)
2. **The one client UPDATE** (`useInvoiceReviewActions.ts:263`, invoice-review catalog mapping) targets a Manager+ page but is **currently denied by RLS** (no UPDATE policy) — a latent, silently-swallowed failure. Adding a **Manager+ UPDATE** policy would both achieve parent-parity and repair this path; leaving it absent preserves the status quo (mapping stays blocked). This is the one open decision (§13 / plan).

So: tightening INSERT + DELETE to Manager+ breaks **no** legitimate client flow; STAFF simply lose the **direct API** write they should never have had.

## 7. UI dependency on STAFF write? (verified — none)

All pages that write `purchase_history_items` are STAFF-blocked at the route:
- `/app/smart-order`, `/app/invoices/:id/review` → **StaffRestricted** ([App.tsx:118,125](../../src/App.tsx#L118)).
- `/app/settings` → **OwnerRoute** ([App.tsx:136](../../src/App.tsx#L136)).
- `/app/purchase-history` → StaffRestricted (read-only page) ([App.tsx:132](../../src/App.tsx#L132)).

No STAFF-reachable UI writes these rows (unlike the S0-5 "Clear" surprise). So a Manager+ tightening needs **no UI change**.

## 8. Root cause

When core inventory RLS was consolidated in `20260306000002`, the **parent** `purchase_history` was correctly converted to `has_restaurant_role_any(OWNER,MANAGER)`, but the **child** `purchase_history_items` write policies were re-created with the **old `is_member_of` condition under Manager+ names** ("original permissiveness preserved intentionally," per the migration comment). The name/clause mismatch made the gap invisible to name-only reviewers.

## 9. Business impact

- **Forged / deleted purchase records** by a low-privilege user — corrupts realized vendor cost & quantity data feeding Period Spend, Food Cost %, price comparisons, and last-order context.
- **Silent integrity loss** — no audit trail; downstream money numbers shift.
- **Trust violation** — CLAUDE.md "RLS is the source of truth … never trust UI permissions"; P0 pilot gate. The "lying" policy name is itself a review hazard.

## 10. User impact

- An owner could find purchase-history line items altered/missing, or fabricated cost lines, with no record of who did it.
- **No legitimate STAFF workflow is lost** — STAFF have no UI to write these and shouldn't write them.
- Manager+/Owner flows are unaffected (their writes go via RPC or Manager+/Owner routes).

## 11. Affected components

| Layer | File | Note |
|-------|------|------|
| RLS (target) | [20260306000002:160-181](../../supabase/migrations/20260306000002_rls_core_inventory.sql#L160) | INSERT/DELETE `is_member_of` → Manager+; (optionally add Manager+ UPDATE) |
| Role helper | [20260212001141:87-99](../../supabase/migrations/20260212001141_initial_schema_core_rls.sql#L87) | reuse `has_restaurant_role_any` (no new helper) |
| Scoping helper | `purchase_history_restaurant_id(ph_id)` ([20260212042953:51-60](../../supabase/migrations/20260212042953_purchase_history_par_columns_demo_seed.sql#L51)) | already used by these policies |
| RPCs (unaffected) | smart-order submit, confirm-receipt, PO sync, delete-restaurant-cascade | `SECURITY DEFINER` → bypass RLS |
| UI (no change) | SmartOrder/Settings/InvoiceReview | all Manager+/Owner |

## 12. Affected tables

`purchase_history_items` only (policy change). No schema/column change, no data migration. Parent `purchase_history` is already correct and untouched.

## 13. Migration risk & rollback

- **R1 — break a legitimate write:** none for INSERT (no client insert; RPCs bypass RLS) or DELETE (Owner/Manager+ routes). 
- **R2 — UPDATE decision:** if a Manager+ UPDATE policy is added, the invoice-review catalog-mapping update starts persisting (a behavior change — repairs a latent bug, Manager+-only, strictly safe). If not added, status quo (denied) is preserved. **Decision required** (plan §2).
- **R3 — leftover permissive policy:** mitigated by `DROP POLICY IF EXISTS` on the exact names before recreate (verified there are no other write policies on the table).
- **R4 — RPC creation path:** unchanged — S0-6 does not touch RPC-mediated creation (governed by each RPC's own checks, e.g. S0-4).
- **Rollback:** self-contained migration; revert with a follow-up migration restoring `is_member_of` on INSERT/DELETE (and dropping any added UPDATE policy). No data touched → instantaneous; nothing to backfill. (Rollback re-opens the leak.)

## 14. Open questions for the plan

1. **Add a Manager+ UPDATE policy** (parent-parity + repairs the silently-blocked invoice-review mapping) **or leave UPDATE denied** (pure leak fix, no behavior change)? Recommend **add** (completes parity; strictly safe). — **needs user confirmation.**
2. Testability: RLS not unit-testable under vitest; plan documents a role-based SQL matrix + a `pg_policies` shape assertion.

## 15. Dependencies / sequencing

GATE green (S0-1..S0-5). Independent of S0-INFRA. Migration-only; no app code (regardless of the UPDATE decision). Next Phase-1 item after S0-5; S0-7 (`weekly_sales`) is the same "name lies" pattern and a natural follow-on.

> No application code was modified in producing this investigation.
