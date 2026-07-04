# S0-INFRA — Dependency Map

> **Date:** 2026-06-23 · Companion to [s0-infra-authorization-model.md](s0-infra-authorization-model.md) and [the investigation](../investigations/s0-infra-permission-architecture.md). No code.

## 1. What each dependent needs from S0-INFRA

| Roadmap item | Needs from S0-INFRA | Exact helper(s) | Without S0-INFRA |
|--------------|---------------------|-----------------|------------------|
| **S0-4** Smart Order submit enforcement (P0) | Server gate for role + `can_approve_orders` + `order_approval_threshold` vs order total | `can_approve_order_amount(uid, rest, loc, amount)` (or `has_restaurant_role_any` + `has_location_permission(…, 'can_approve_orders')` + threshold) | Would re-implement threshold/flag logic inline in `submit_smart_order` → a 4th copy of permission logic (drift) |
| **S0-9** Receipt confirmation (P0) | Server gate for "manager (or authorized) may confirm" | `can_confirm_receipt(uid, rest)` (≈ `has_restaurant_role_any(OWNER,MANAGER)`) | Inline role check in each `confirm_invoice_receipt` migration variant (there are ~10 variants — high drift risk) |
| **S1-1** Cost visibility (P1) | Server reader for `can_see_costs` to gate cost fields on Invoices/Review/PurchaseHistory | `has_location_permission(uid, loc, 'can_see_costs')` | Flag stays cosmetic; owner's cost-hiding ignored (GA-4) |
| **S1-6** PAR permissions (P1) | RLS/RPC reader for `can_edit_par` on `par_*` writes | `has_location_permission(uid, loc, 'can_edit_par')` | PAR editable past the UI gate (GA-5) |
| **S1-7** Make per-location flags real (P1, **L**) | The whole helper layer + parity contract; every flag enforced once | `has_location_permission` (all flags) + location-scoped write policies | The 6 flags remain UI-only (GA-6); this item *is* the generalization of S0-INFRA |

## 2. Dependency graph

```
                         ┌─────────────────────────────┐
                         │  S0-INFRA  (helper library)  │
                         │  • has_location_permission   │
                         │  • can_approve_order_amount  │
                         │  • can_confirm_receipt       │
                         │  • is_owner_or_manager (sugar)│
                         │  • parity contract (SQL↔TS)  │
                         │  • deprecate ula.role, anon  │
                         └───────┬───────────┬──────────┘
              ┌──────────────────┘           └──────────────────┐
        P0 (Phase 2)                                       P1 (Phase 4)
   ┌────────────┐   ┌──────────────────┐        ┌───────────┐ ┌───────────┐ ┌───────────────┐
   │   S0-4     │   │      S0-9        │        │   S1-1    │ │   S1-6    │ │     S1-7      │
   │ smart order│   │ confirm receipt  │        │ cost vis. │ │ PAR perms │ │ flags-for-real│
   │ threshold  │   │ manager re-check │        │can_see_   │ │can_edit_  │ │  (all flags + │
   │+can_approve│   │                  │        │  costs    │ │   par     │ │ loc-scoping)  │
   └────────────┘   └──────────────────┘        └───────────┘ └─────┬─────┘ └───────┬───────┘
                                                                     │               │
                                                                     └──────┬────────┘
                                                                            ▼
                                                                  ┌──────────────────┐
                                                                  │  T1-10 MANAGER-  │
                                                                  │  without-location│
                                                                  │  onboarding      │
                                                                  └──────────────────┘
```

## 3. Ordering & rationale

1. **S0-INFRA first** — the helper layer + parity contract, shipped additively (no enforcement change). Verifies the SQL helpers return the same answers the client already computes.
2. **S0-4, S0-9 next** (Phase 2 P0) — wire the two privileged RPCs to the helpers. These are the active P0 holes; they are *small* once the helpers exist (one preamble each).
3. **S1-1, S1-6** (Phase 4 P1) — point specific read/write paths at `has_location_permission`. Independent of each other; both depend only on the helper.
4. **S1-7** (Phase 4 P1, L) — the generalization: enforce *all six* flags everywhere + location-scope write policies. This is large and effectively "finishes" S0-INFRA's promise across the app.
5. **T1-10** (MANAGER-without-location) depends on S1-7 — once location access is the real gate, the onboarding dead-end must be handled (a restaurant-level manager with no `user_location_assignment` must still function or be guided to get one).

## 4. Shared-helper guarantee (why this avoids new duplication)

Every box above calls **the same** functions. If the order-approval rule changes, it changes in `can_approve_order_amount` once — `submit_smart_order` (S0-4) and any future "approve" surface inherit it. This is the explicit CLAUDE.md mandate ("do not duplicate permission systems") made structural: S0-INFRA is the **single** permission system, and S0-4/S0-9/S1-1/S1-6/S1-7 are *consumers*, not re-implementers.

## 5. Non-dependents (do not block on S0-INFRA)
- Edge-function auth (S0-1/2/3) — already shipped, uses service-role/signature, not the role/flag model.
- `notifications` RPC (S0-8) — uses `is_member_of` + allowlist; could *optionally* adopt `is_owner_or_manager` later but doesn't need to.
- KPI/trust items (T0-*) — orthogonal; T0-7 was unblocked by S0-8, not S0-INFRA.

> No application code or migration was created in producing this dependency map.
