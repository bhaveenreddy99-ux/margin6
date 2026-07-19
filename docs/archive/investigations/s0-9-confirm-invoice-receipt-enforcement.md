# Investigation — S0-9: `confirm_invoice_receipt` is membership-only (unauthorized receipt confirmation)

> **Date:** 2026-06-23 · **Type:** Investigation only (no code, no migration, no RPC change, no commit).
> **Roadmap item:** S0-9 (Phase 2 P0) — [trust-first-roadmap.md](../trust-first-roadmap.md). **Depends on S0-INFRA** (helper `can_confirm_receipt` shipped in `8d4859b`). Follows the S0-4 pattern (`a486715`).
> **Sources:** code trace (cited), [role-permission-matrix.md](../role-permission-matrix.md) G9, [product-reality.md](../product-reality.md) §3 (receipt confirmation PARTIAL), [s0-infra-authorization-model.md](../architecture/s0-infra-authorization-model.md).
> **Companion:** [plans/s0-9-confirm-invoice-receipt-enforcement-plan.md](../plans/s0-9-confirm-invoice-receipt-enforcement-plan.md) (Architecture review · Implementation · Risk · Test matrix · Rollback · Trust summary).

---

## 1. Executive summary

`confirm_invoice_receipt` is the **single most destructive write path in the product** — confirming a receipt **overwrites canonical catalog costs**, **creates inventory stock movements**, marks the invoice confirmed, and **emits PRICE_INCREASE/DECREASE/UNIT_MISMATCH notifications** that feed money KPIs. Its only authorization is `IF NOT public.is_member_of(p_restaurant_id) THEN RAISE 'Access denied'` ([20260524000001:36-38](../../supabase/migrations/20260524000001_fix_catalog_default_unit_cost_in_confirm_receipt.sql#L36)) — **membership-only, no role check** — even though the UI explicitly promises the action is *"confirmed by a manager"* ([InvoiceReview.tsx:188](../../src/pages/app/InvoiceReview.tsx#L188)) and the page is Manager+-gated. **Any restaurant member, including STAFF, can call the RPC directly and rewrite every cost the dashboard depends on** (role-permission-matrix **G9**).

This mirrors S0-4 exactly: the fix is a one-line server gate calling the already-shipped S0-INFRA helper `can_confirm_receipt(auth.uid(), p_restaurant_id)` — **no new logic, one UI caller unchanged**. The one extra finding: a sibling `confirm_invoice_receipt_legacy` is **also** membership-only and **directly callable**, so the gate must cover both.

---

## 2. Receipt confirmation workflow (Requirement 1)

Full path from intake to KPI, with every component:

| Stage | Component(s) | Tables touched | Notes |
|-------|--------------|----------------|-------|
| **Upload** | client `useInvoiceActions` (file/photo) **or** edge `inbound-invoice-email` (email) | `invoices` (draft), `invoice_ingestions`, storage `invoice-uploads` | email path now signature-gated (S0-3) |
| **Parse** | edge `parse-invoice` (Claude) | `invoice_items` (lines) | now membership-gated (S0-1) |
| **Match** | client `strongMatchInvoiceItems` / `matchInvoiceCatalogItems` | `invoice_items.catalog_item_id`, `invoice_line_comparisons` | links lines to catalog |
| **Review** | page `/app/invoices/:id/review` (`InvoiceReview.tsx`, `ComparisonTable`), `useInvoiceReviewActions` | `invoice_line_comparisons` (`received_qty`, manager-confirmed flag) | **StaffRestricted route** (Manager+ in UI) |
| **CONFIRM** | **RPC `confirm_invoice_receipt`** (and `_legacy` for purchase_history rows) | see §5 — `invoices`, `stock_movements`, `inventory_catalog_items`, `notifications`, `purchase_history` (legacy) | **the S0-9 target** |
| **Post-confirm** | RPC `notify_delivery_issues` (called by the UI right after) | `notifications` (DELIVERY_ISSUE) | adjacent, also membership-only (out of S0-9 scope; noted) |
| **KPI impact** | dashboard selectors / loaders | reads `inventory_catalog_items.default_unit_cost`, `notifications`, `invoices.receipt_status`, `stock_movements` | §5 |

So receipt confirmation is the hinge where **review → recorded financial truth**. Everything upstream is staging; this RPC commits it.

## 3. The live confirmation entry point (Requirement 2)

- **Live function:** `public.confirm_invoice_receipt(p_invoice_id uuid, p_restaurant_id uuid) RETURNS jsonb`, `SECURITY DEFINER`, last `CREATE OR REPLACE` at **[20260524000001](../../supabase/migrations/20260524000001_fix_catalog_default_unit_cost_in_confirm_receipt.sql)** (highest timestamp ⇒ the definition Postgres executes today).
- **Historical / superseded versions (12), all `CREATE OR REPLACE` of the same signature** — each replaced by the next; only the latest is live:
  `20260305000002` → `20260307000002` → `20260307000004` → `20260327000002` → `20260329120000` → `20260411000000` → `20260504000002` → `20260505000001` → `20260507000001` → `20260522000001` → `20260523000001` → **`20260524000001`** (live).
- **Sibling:** `public.confirm_invoice_receipt_legacy(p_invoice_id, p_restaurant_id)` — defined at [20260507000001:346](../../supabase/migrations/20260507000001_production_schema_repair.sql#L346), `GRANT EXECUTE … TO authenticated` ([:421](../../supabase/migrations/20260507000001_production_schema_repair.sql#L421)). The live `confirm_invoice_receipt` **calls it** as a fallback when the id is a `purchase_history` row (not an `invoices` row) ([20260524000001:46-52](../../supabase/migrations/20260524000001_fix_catalog_default_unit_cost_in_confirm_receipt.sql#L46)).

## 4. Every caller (Requirement 3)

| Caller | Call | Path |
|--------|------|------|
| `src/hooks/useInvoiceReviewActions.ts:139` | `supabase.rpc("confirm_invoice_receipt", { p_invoice_id, p_restaurant_id })` | **the only UI/client caller** |
| `src/integrations/supabase/types.ts:3330,3334` | generated signatures for both fns | types only |
| `src/test/invoice-review-actions.test.ts:197` | asserts the rpc is *called with* the args (mocked) | test (mocks rpc; auth not exercised) |
| `src/test/price-increase-notifications.test.ts:10` | parses a PRICE_INCREASE payload shape | test (payload only) |
| `confirm_invoice_receipt_legacy` | invoked **internally** by `confirm_invoice_receipt`; **not** called directly from `src/` | but it is granted to `authenticated` ⇒ **directly callable via REST** |

**Conclusion:** **one** legitimate client caller (`useInvoiceReviewActions`), so a signature-preserving RPC fix needs **no client change**. **But** `confirm_invoice_receipt_legacy` is a **second, independently-callable** membership-only entry point — the fix must gate it too (or it's a bypass).

## 5. Current authorization review (Requirement 4) — with proof

**What exists today:** exactly one check at the top of the live function ([20260524000001:36-38](../../supabase/migrations/20260524000001_fix_catalog_default_unit_cost_in_confirm_receipt.sql#L36)):
```sql
IF NOT public.is_member_of(p_restaurant_id) THEN
  RAISE EXCEPTION 'Access denied';
END IF;
```

| Question | Answer | Proof |
|----------|--------|-------|
| Membership-only? | **Yes** | the sole gate is `is_member_of` |
| Role-based? | **No** | no `has_restaurant_role*` / `can_confirm_receipt` anywhere in the body |
| Location-aware? | **No** | takes `p_restaurant_id` only; `invoices` is restaurant-scoped (no `location_id`) |
| Flag-aware? | **No** | no `user_location_assignments` read |
| **Can STAFF confirm today?** | **YES** | STAFF satisfies `is_member_of` ⇒ a direct `supabase.rpc('confirm_invoice_receipt', …)` (or `…_legacy`) succeeds, despite the StaffRestricted UI route and the *"confirmed by a manager"* copy at [InvoiceReview.tsx:188](../../src/pages/app/InvoiceReview.tsx#L188) |

This is the textbook "UI-only permission" anti-pattern: the route is Manager+, the copy says "manager," but RLS/RPC — the real boundary — let any member through. The legacy fn has the identical hole ([20260507000001:364](../../supabase/migrations/20260507000001_production_schema_repair.sql#L364)).

## 6. Business impact analysis (Requirement 5)

What a single `confirm_invoice_receipt` call changes (all reachable by STAFF today):

| Effect | Table / write | Downstream | Risk |
|--------|---------------|-----------|:----:|
| **Overwrites catalog cost** | `inventory_catalog_items.default_unit_cost := invoiced_unit_cost` ([:138-145](../../supabase/migrations/20260524000001_fix_catalog_default_unit_cost_in_confirm_receipt.sql#L138)) | the canonical per-unit cost behind **Inventory Value, Overstock, Reorder $, Food Cost %** — and it is overwritten **in place with no `catalog_cost_history`** (T1-2) → silent, unauditable | **Critical** |
| **Emits PRICE_INCREASE / DECREASE / UNIT_MISMATCH notifications** | `notifications` (OWNER+MANAGER) ([:200+](../../supabase/migrations/20260524000001_fix_catalog_default_unit_cost_in_confirm_receipt.sql#L200)) | feeds the **Price-Increase Impact KPI** and the weekly loss digest; a STAFF can fabricate price-increase signals by confirming a crafted invoice | **Critical** |
| **Marks invoice confirmed** | `invoices.status='confirmed', receipt_status='confirmed', confirmed_at` ([:60-70](../../supabase/migrations/20260524000001_fix_catalog_default_unit_cost_in_confirm_receipt.sql#L60)) | drives **Invoice Discrepancy / Delivery-Issue** counts and Period Spend inclusion; irreversible workflow state | **High** |
| **Creates stock movements (receiving)** | `stock_movements` (`movement_type='receive'`, qty) ([:108-120](../../supabase/migrations/20260524000001_fix_catalog_default_unit_cost_in_confirm_receipt.sql#L108)) | receiving ledger; dashboard on-hand does **not** currently read it (T1-1), so KPI impact is muted **today** but the records are authoritative and future on-hand wiring uses them | **Medium** |
| **Purchase-history path** | `confirm_invoice_receipt_legacy` writes the same classes against `purchase_history` | same as above for PO-sourced receipts | **High** |
| Post-confirm delivery issues | `notify_delivery_issues` (adjacent) | DELIVERY_ISSUE notifications | **Low–Medium** (separate item) |

**Net:** receipt confirmation is the product's **cost-of-record** mutation. Letting a non-manager perform it means a low-privilege (or compromised) account can **silently rewrite every money number** the owner trusts, with no audit trail. That is the worst-case trust failure for a "Vendor Cost Intelligence" product whose entire promise is traceable, trustworthy cost numbers.

---

## 7. Why this is a clean S0-INFRA consumer (preview — full design in the plan)

- The authorization rule already exists, tested: `can_confirm_receipt(p_uid, p_restaurant_id)` = Manager+ (OWNER/MANAGER), shipped in `8d4859b`, matching the UI's "manager confirms" promise.
- The function already takes `p_restaurant_id` → the helper needs **no new input**.
- **One** client caller, unchanged → **no client/UI change**.
- The only design nuances (in the plan): gate **both** `confirm_invoice_receipt` and `confirm_invoice_receipt_legacy`; decide whether to keep `is_member_of` as a not-found discriminator vs replace it; confirm location-awareness is not needed (invoices are restaurant-scoped).

> No application code, migration, or RPC was modified in producing this investigation.
