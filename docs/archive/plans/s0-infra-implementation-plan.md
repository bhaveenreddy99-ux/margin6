# Plan — S0-INFRA: Implementation strategy (recommended)

> **Date:** 2026-06-23 · **Status:** Recommended plan — **awaiting approval; nothing implemented.**
> **Inputs:** [investigation](../investigations/s0-infra-permission-architecture.md) · [architecture](../architecture/s0-infra-authorization-model.md) · [dependency map](../architecture/s0-infra-dependency-map.md)
> **Effort key:** S ≤ 0.5d · M = 1–2d · L = 3–5d.

## 1. Strategy in one line

Ship the **canonical permission helper layer additively** (no enforcement change), prove it agrees with the client via a **parity matrix**, then wire enforcement **one consumer at a time** (S0-4 → S0-9 → S1-1 → S1-6 → S1-7), each its own revertable migration.

## 2. Migration strategy (phased, additive-first)

### Phase A — S0-INFRA core (the foundation). Effort: **M**
*New migration `<ts>_authz_helpers.sql` — adds functions only, enforces nothing yet.*
- `has_location_permission(p_uid, p_location_id, p_flag text) → boolean` — OWNER short-circuit; whitelisted flag names; default = false if no assignment.
- `can_approve_order_amount(p_uid, p_restaurant_id, p_location_id, p_amount numeric) → boolean` — OWNER/MANAGER ⇒ true; else `can_approve_orders` AND (threshold null OR amount ≤ threshold).
- `can_confirm_receipt(p_uid, p_restaurant_id) → boolean` — `has_restaurant_role_any(OWNER,MANAGER)` (product may extend to a receiving flag).
- *(optional)* `is_owner_or_manager(r_id) → boolean` sugar.
- All `SECURITY DEFINER STABLE SET search_path=public`; `REVOKE … FROM public, anon`; `GRANT EXECUTE … TO authenticated`.
- **Hardening in the same migration:** `REVOKE ALL ON FUNCTION get_location_permissions(…) FROM anon` (GA-11).
- **No table/policy changes.** Behavior identical to today. (Reversible: drop the new functions.)

### Phase B — Parity verification (gate before wiring). Effort: **S**
- A test/seed matrix asserting `has_location_permission` / `can_approve_order_amount` return the **same** answers as `useLocationPermissions` for a fixed set of (role, assignment, flag, threshold, amount) cases — incl. OWNER⇒all and threshold-null⇒unlimited. Run at `supabase db reset` + a TS unit mirror.
- **Do not proceed to enforcement until parity is green.**

### Phase C — P0 consumers (Phase 2 of the roadmap). Effort: **M** each
- **S0-4:** `submit_smart_order` preamble → reject unless `can_approve_order_amount(auth.uid(), restaurant_id, location_id, <order total>)`. (Compute total inside the RPC from the run.) One migration; co-verify the SmartOrder UI still matches.
- **S0-9:** `confirm_invoice_receipt` preamble → reject unless `can_confirm_receipt(auth.uid(), p_restaurant_id)`. Apply to the **current** function variant ([20260524000001](../../supabase/migrations/20260524000001_fix_catalog_default_unit_cost_in_confirm_receipt.sql)); note the ~10 historical variants are superseded — only the live one needs the gate (verify with `pg_proc`). Co-plan with T1-2 (`catalog_cost_history`) per roadmap.

### Phase D — P1 consumers (Phase 4 of the roadmap). Effort: S1-1 **M** · S1-6 **M** · S1-7 **L**
- **S1-1:** gate cost fields on Invoices/Review/PurchaseHistory read paths via `has_location_permission(…, 'can_see_costs')` (RLS column-masking is limited in PG — likely enforce in the RPC/view or split cost columns; design in S1-1's own investigation).
- **S1-6:** `par_*` write policies AND `has_location_permission(…, 'can_edit_par')`.
- **S1-7:** enforce all six flags wherever they govern + add location scoping to write policies (G18). Largest; unlocks T1-10.

### Phase E — Client consolidation (P2 / C-2). Effort: **M, ongoing**
- A single `useAuthz()` resolver mirroring the server helpers; migrate the ~82 inline role checks incrementally. Optionally re-point reads at `get_location_permissions`. Not a security change — drift reduction.

### Phase F — Deprecation cleanup. Effort: **S**
- After confirming nothing reads it, drop `user_location_assignments.role` (GA-10) in a late migration.

## 3. Risks & mitigations

| # | Risk | Mitigation |
|---|------|-----------|
| R1 | **Server/client divergence** → broken UX or false locks | Parity matrix (Phase B) is a hard gate; encode OWNER⇒all + threshold-null⇒unlimited identically. |
| R2 | **Enforcing defaults changes effective behavior** (`can_approve_orders` default true, `can_see_costs` default false) for existing assignments | Audit existing `user_location_assignments` data before Phase C/D; communicate that hidden-by-default `can_see_costs` will now actually hide. |
| R3 | **MANAGER without a location assignment** locked out once location access is enforced (T1-10) | Helpers already give OWNER all; for MANAGER, decide: restaurant-role implies access to restaurant's locations, OR require assignment + fix onboarding. Resolve in S1-7. |
| R4 | **RLS hot-path performance** (helpers called per row) | `STABLE` functions; `user_location_assignments` is indexed on (user_id), (location_id), (user_id,is_primary). Benchmark on the heaviest list. |
| R5 | **`SECURITY DEFINER` + `auth.uid()`** subtlety | `auth.uid()` is the caller inside DEFINER fns (verified in S0-5/6/8); keep `SET search_path=public`. |
| R6 | **Cost-column masking is hard in pure RLS** (PG RLS is row-, not column-level) | S1-1 likely needs RPC/view-based cost gating, not just a policy — flag for its own design. |
| R7 | **Threshold semantics** (null = unlimited; what currency/units is `amount`?) | Use the same total the UI computes (`SmartOrder.tsx` estimated cost); document units; test boundary (== threshold passes). |
| R8 | **Deploying enforcement re-orders behavior** mid-flight | Each consumer is its own migration; revert is a follow-up migration. No data touched. |

## 4. Rollout plan

1. **Phase A** (helpers, additive) → deploy → `pg_proc`/`has_function_privilege` assertions; **no behavior change** to verify in prod.
2. **Phase B** parity → must be green before any enforcement.
3. **S0-4** → staging role matrix (STAFF over-threshold rejected; MANAGER/OWNER pass; UI still matches) → deploy.
4. **S0-9** → staging matrix (STAFF confirm rejected; Manager+ pass) → deploy (co-plan T1-2).
5. **Pause / re-baseline** — Phase 2 P0 done; security bar for paid customers met.
6. **S1-1 → S1-6 → S1-7** (Phase 4) each with its own investigation/plan/matrix; S1-7 last (largest), then **T1-10**.
7. **Client consolidation (C-2)** and **ula.role removal** as trailing hygiene.

Each step: green CI (tsc + vitest) + a DB role matrix + `pg_policies`/`pg_proc` shape assertions, following the established S0 pattern. Every migration is additive and individually revertable; no rows are modified.

## 5. Estimated effort (summary)

| Work | Effort |
|------|:------:|
| S0-INFRA core helpers (Phase A) | **M** |
| Parity matrix (Phase B) | **S** |
| S0-4 (consumer) | **M** |
| S0-9 (consumer; + T1-2 co-plan) | **M** (RPC) / L (with cost-history) |
| S1-1 cost visibility | **M** (design-dependent) |
| S1-6 PAR | **M** |
| S1-7 flags-for-real + loc-scoping | **L** |
| C-2 client resolver + ula.role removal | **M**, ongoing |
| **Foundation + P0 dependents (A+B+S0-4+S0-9)** | **~M×4 ≈ 4–6 dev-days** |

## 6. Recommended decision points (for approval before implementation)

1. **Generic `has_location_permission(…, flag)` vs six bespoke helpers** — recommend generic (one OWNER short-circuit).
2. **`can_confirm_receipt` = Manager+ only, or Manager+/STAFF-with-a-receiving-flag?** — product call (today there's no receiving flag; recommend Manager+).
3. **Order-approval amount source** — use the SmartOrder estimated total; confirm units/rounding.
4. **`ula.role` fate** — deprecate now, remove in Phase F (recommend).
5. **S1-1 cost masking mechanism** — accept it likely needs RPC/view, not pure RLS (defer detailed design to S1-1).

> No application code or migration was created in producing this plan. Implementation is **not** started; awaiting approval. S0-4 / S0-9 are **not** started.
