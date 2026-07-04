# Investigation — S0-4: `submit_smart_order` ignores approval threshold + `can_approve_orders`

> **Date:** 2026-06-23 · **Type:** Investigation only (no code, no migration, no RPC change).
> **Roadmap item:** S0-4 (Phase 2 P0) — [trust-first-roadmap.md](../trust-first-roadmap.md). **Depends on S0-INFRA Phase A** (helpers shipped: `8d4859b`).
> **Sources:** code trace (cited), [role-permission-matrix.md](../role-permission-matrix.md) G1, [s0-infra-authorization-model.md](../architecture/s0-infra-authorization-model.md).
> **Companion:** [plans/s0-4-smart-order-submit-enforcement-plan.md](../plans/s0-4-smart-order-submit-enforcement-plan.md) (Architecture · Implementation · Test · Rollback).

---

## 1. Executive summary

`submit_smart_order(p_run_id)` — the **only** path that turns a smart-order run into a real purchase order — authorizes on **`is_member_of(restaurant_id)` only** ([20260327000004:20](../../supabase/migrations/20260327000004_serialize_smart_order_submit.sql#L20)). The UI gates submission on **two** per-location controls — `can_approve_orders` and `order_approval_threshold` — but both are **client-side only** ([SmartOrder.tsx:476-489, 668-672](../../src/pages/app/SmartOrder.tsx#L476)). So **any restaurant member (incl. a STAFF with `can_approve_orders=false`, or any member submitting an over-threshold order) can call the RPC directly and commit a real, any-size vendor PO** (role-permission-matrix **G1**, the top P0 in the gap table).

The good news from the trace: the RPC **already has everything it needs to self-enforce** — it can compute the order total from `smart_order_run_items` (it already does, to write `purchase_history_items.total_cost`) and it can read the run's `location_id` from the run row. So the fix is **RPC-only**: add a server gate calling the S0-INFRA helper `can_approve_order_amount(auth.uid(), restaurant_id, location_id, <server total>)`. **No new RPC param, no caller change, no UI change required.**

Two parity caveats matter (and are why this is an investigation, not a one-liner): the run's `location_id` is **nullable**, and the UI's displayed total uses *latest invoice* costs while the RPC's authoritative total uses the *run's* `unit_cost` — these can differ. Both are addressed in the plan.

---

## 2. `submit_smart_order` — current RPC behavior (Requirement 1 & 7)

[20260327000004_serialize_smart_order_submit.sql](../../supabase/migrations/20260327000004_serialize_smart_order_submit.sql):
- **Signature:** `submit_smart_order(p_run_id uuid) RETURNS jsonb`, `SECURITY DEFINER`.
- **Authorization:** the *only* check is in the run lookup — `SELECT * FROM smart_order_runs WHERE id = p_run_id AND is_member_of(restaurant_id) FOR UPDATE` → `RAISE 'not found or access denied'` if absent. **No role, no `can_approve_orders`, no threshold.**
- **What it does:** generates a PO number → sets run `status='submitted'` → upserts a `purchase_history` row → replaces `purchase_history_items` from the run's items:
  ```sql
  SELECT … item_name, GREATEST(suggested_order,0), unit_cost,
         GREATEST(suggested_order,0) * COALESCE(unit_cost,0) AS total_cost, …
  FROM smart_order_run_items WHERE run_id = p_run_id AND suggested_order > 0;
  ```
- **Key consequence:** the RPC **already computes each line's dollar value** (`qty × run unit_cost`). The **server-authoritative order total** is therefore `SUM(GREATEST(suggested_order,0) * COALESCE(unit_cost,0))` over the same rows — **available inside the RPC with no new input.**

## 3. Every caller (Requirement 2)

| Caller | Call | Notes |
|--------|------|-------|
| `src/pages/app/SmartOrder.tsx:500` | `supabase.rpc('submit_smart_order', { p_run_id: selectedRun.id })` | **The only invoker.** |
| `src/integrations/supabase/types.ts:3500` | `submit_smart_order: { Args: { p_run_id }, Returns: Json }` | generated type (signature) |
| `src/domain/ordering/smartOrderVendor.ts:2,68` | comments only | not a caller |

No edge function, cron, or other RPC calls it. **A signature-preserving RPC fix touches zero callers.**

## 4. Order total calculation (Requirement 3) — and the parity caveat

Two totals exist, computed differently:

| | Formula | Cost source |
|---|---------|-------------|
| **RPC / authoritative** (what gets written to `purchase_history_items.total_cost`) | `Σ GREATEST(suggested_order,0) × COALESCE(unit_cost,0)` | the run's stored `smart_order_run_items.unit_cost` (snapshot at run creation) |
| **UI displayed/gated** (`smartOrderDetailMetrics.totalEstCost`, [SmartOrder.tsx:288-302](../../src/pages/app/SmartOrder.tsx#L288)) | `Σ computeOrderDollars(suggested_order, resolveDisplayCost(item, invoiceCostMap))` | **latest invoice cost** (via `invoiceCostMap`), falling back to run `unit_cost` |

→ **The UI total and the RPC total can differ** when a newer invoice cost ≠ the run's `unit_cost`. The threshold the user *sees enforced* (UI) may not equal the value the *server* would check. For a **security** boundary the server must compute its **own** total (a client-supplied amount is spoofable) — so the server uses the RPC/authoritative total (which is also the real recorded order value). The divergence is a UX-consistency issue, not a security one (worst case: a safe-but-surprising server rejection). *(UI item filter also adds `riskLevel !== 'NO_PAR'`, but `suggested_order > 0` already implies a PAR, so the row sets match.)*

## 5. Location resolution (Requirement 4)

- `smart_order_runs` has a **nullable `location_id`** — added at [20260214020430:96](../../supabase/migrations/20260214020430_locations_and_settings_tables.sql#L96) (`ON DELETE SET NULL`), populated from the session's location at run creation (`location_id: session.location_id ?? null`, [smartOrderFromSession.ts:260](../../src/domain/inventory/smartOrderFromSession.ts#L260)).
- So the RPC can read `v_run.location_id` (it already `SELECT *`s the run). **The order's location is server-side, not client-chosen → not spoofable.**
- **Nullable is the catch:** single-location restaurants / older sessions may have `location_id = NULL`. The UI's `perms` come from `useLocationPermissions`, which uses the active `currentLocation` or, when absent, the caller's **primary** assignment ([useLocationPermissions.ts:24-44](../../src/hooks/useLocationPermissions.ts#L24)). The server must mirror that fallback for null-location runs (plan §Architecture decides the rule).
- Established precedent: `purchase_orders.location_id` is derived from `smart_order_runs.location_id` ([20260503000004:10-18](../../supabase/migrations/20260503000004_purchase_orders_location_id.sql#L10)) — the run→location path is canonical.

## 6. Approval threshold logic (Requirement 5)

- Stored: `user_location_assignments.order_approval_threshold numeric` (default **null = unlimited**), per (user, location).
- Read by `useLocationPermissions` → `perms.order_approval_threshold`. OWNER ⇒ null (unlimited).
- The S0-INFRA helper already encodes the exact rule: `can_approve_order_amount(uid, rest, loc, amount)` = OWNER ⇒ true; else `can_approve_orders` AND (threshold null ⇒ unlimited; else `amount ≤ threshold`), with the `==` boundary allowed. (Shipped + parity-tested in `8d4859b`.)

## 7. Current UI behavior (Requirement 6)

The submit button ([SmartOrder.tsx:668-672](../../src/pages/app/SmartOrder.tsx#L668)) is `disabled` when:
`submitting || vendorSubmitAnalysis.blocked || !perms.can_approve_orders || smartOrderDetailMetrics.thresholdExceeded`,
and `handleSubmitOrder` ([:476-489](../../src/pages/app/SmartOrder.tsx#L476)) re-checks the threshold and toasts *"exceeds your approval limit … Owner approval required"* before calling the RPC. **Effective UI rule:** member may submit only if `can_approve_orders` **and** `total ≤ threshold` (OWNER always passes). **All of this is client-side.**

## 8. Exact gap between UI and server (Requirement 8)

| Control | UI enforces? | Server (RPC) enforces? | Exploit |
|---------|:---:|:---:|---------|
| Must be a member | ✅ (route) | ✅ `is_member_of` | — |
| `can_approve_orders` | ✅ disables submit | ❌ **ignored** | STAFF with `can_approve_orders=false` calls `supabase.rpc('submit_smart_order', {p_run_id})` → **PO submitted** |
| `order_approval_threshold` | ✅ blocks over-limit | ❌ **ignored** | Any member submits an over-threshold run via the RPC → **PO submitted, no owner approval** |
| Role (Manager+) | partial (UI shows controls) | ❌ none | a limited member commits a vendor order |

**The gap is the entire approval model.** The UI is the *only* enforcement of who may approve and up to what amount; the RPC enforces neither. A single direct `rpc('submit_smart_order', …)` call bypasses both. Impact: **unauthorized real vendor commitments** (financial), exactly the G1 P0.

---

## 9. Why this is now a small, clean fix

- The RPC **already** computes line dollar values and reads the run (incl. `location_id`) — so the gate needs **no new input**.
- The authorization rule **already exists** as a tested S0-INFRA helper (`can_approve_order_amount`) — **no new permission logic** (honors CLAUDE.md "do not duplicate permission systems").
- **One caller**, signature unchanged → **no client/UI change** required for the security fix.

The only genuine design choices (in the plan): the **null-`location_id` fallback** and acknowledging the **UI-vs-server total** divergence (with an optional UI-alignment follow-up).

> No application code, migration, or RPC was modified in producing this investigation.
