# Investigation — S0-7: `weekly_sales` write policy

> **Date:** 2026-06-23
> **Roadmap item:** S0-7 (P0 Security), [trust-first-roadmap.md](../trust-first-roadmap.md)
> **Workflow step:** STEP 2 — Investigate ([engineering-workflow.md](../engineering-workflow.md))
> **Status:** Investigation complete — no code changed.
> **Headline:** ⚠️ **The described vulnerability does NOT exist in the current source.** `weekly_sales` (and its sibling `daily_sales`) write policies already enforce Manager+. The roadmap/audit claim is **stale/incorrect**. This changes the nature of S0-7 from "fix a leak" to "verify + reconcile the audit" (see plan).

## 1. What the roadmap claims (the alleged bug)

S0-7 / role-permission-matrix **G4** assert: *"`weekly_sales` write open (name lies 'Managers+') — policies named 'Managers+ …' but the clause is `is_member_of` (`20260518000001_sales_entry.sql:207-231`) → STAFF writes sales via API."* Same as S0-6's "lying policy" pattern.

## 2. What the code actually says (verified)

The live policies in [20260518000001_sales_entry.sql:207-235](../../supabase/migrations/20260518000001_sales_entry.sql#L207) **do** enforce the role check — they are **not** `is_member_of`-only:

```sql
CREATE POLICY "Managers+ can insert weekly sales"
  ON public.weekly_sales FOR INSERT TO authenticated
  WITH CHECK (
    is_member_of(restaurant_id)
    AND user_can_access_location(auth.uid(), location_id)
    AND has_restaurant_role_any(restaurant_id, ARRAY['OWNER'::app_role, 'MANAGER'::app_role])   -- ← role gate present
  );

CREATE POLICY "Managers+ can update weekly sales"  -- USING + WITH CHECK, both with has_restaurant_role_any(OWNER,MANAGER)
CREATE POLICY "Managers+ can delete weekly sales"  -- USING with has_restaurant_role_any(OWNER,MANAGER)
```

Each write policy ANDs three conditions: membership **and** location access **and** `has_restaurant_role_any(OWNER, MANAGER)`. The policy **name matches the rule** — there is no lie. The same is true for the sibling **`daily_sales`** ([:256-281](../../supabase/migrations/20260518000001_sales_entry.sql#L256)).

**RLS is enabled** on both tables ([:185-186](../../supabase/migrations/20260518000001_sales_entry.sql#L185)). The `user_can_access_location` and `has_restaurant_role_any` helpers exist ([20260503000005_location_rls_helpers.sql](../../supabase/migrations/20260503000005_location_rls_helpers.sql), [20260212001141:87](../../supabase/migrations/20260212001141_initial_schema_core_rls.sql#L87)), so the policies are valid and active (the migration applied).

## 3. Policy name vs actual rule

| Policy | Name claims | Actual condition | Verdict |
|--------|-------------|------------------|---------|
| INSERT | "Managers+ can insert…" | member **AND** location **AND** `has_restaurant_role_any(OWNER,MANAGER)` | ✅ **Accurate** |
| UPDATE | "Managers+ can update…" | same (USING + WITH CHECK) | ✅ **Accurate** |
| DELETE | "Managers+ can delete…" | same | ✅ **Accurate** |
| SELECT | "Members can view…" | member **AND** location **AND** (OWNER **OR** `can_see_food_cost_pct`) | read-gate (not S0-7) |

→ **No name/clause mismatch.** Contrast S0-6, where the conditions genuinely were `is_member_of` under "Manager+" names — that was a real leak; this is not.

## 4. Who should create/edit/delete — and who can today

- **Should:** OWNER/MANAGER (with location access). **Can today:** exactly that — the policies enforce it.
- **STAFF API write access:** **NO.** A STAFF member fails the `has_restaurant_role_any(OWNER, MANAGER)` conjunct, so INSERT/UPDATE/DELETE are blocked at the RLS layer. (Even more restrictive than S0-6 — there's also a location-access conjunct.)

## 5. Drift / coexistence check (rigorous)

- **Only one migration** defines or alters `weekly_sales`/`daily_sales` policies: `20260518000001_sales_entry.sql` (verified by grepping all migrations for `create/drop/alter policy` on these tables). No later migration loosens them; no second permissive write policy is OR'd in.
- **Git history:** the migration was introduced in a single commit (`ac3e680 feat: weekly_sales + daily_sales tables with RLS …`) and has **not** been modified since; the working tree is clean for this file. So the committed/source state = the Manager+ version shown above.

## 6. Why the audit likely says otherwise (reconciliation)

The audit docs are dated 2026-06-22 and cite `:207-231`. The most likely explanations:
1. **The audit was written against an earlier draft** of the migration (pre-hardening) and was not re-verified after the role check was added; the committed version already includes it. (Plausible — the line numbers roughly match, but the *content* at those lines now includes the role gate.)
2. **Audit error** — the reviewer read the policy *name* pattern (matching S0-6's real lie) and generalized without re-reading the clause.

Either way, **current source is correct.** What I **cannot** verify from here is the **deployed database**: if production ever had a looser policy applied (older draft, or a manual `ALTER POLICY`), the running DB could differ from source. Migrations are the source of truth and they are correct — but a deployed-state confirmation (or a defensive re-assertion) is the only way to be certain in every environment. This is the crux of the plan decision.

## 7. App write path (context)

`upsertWeeklySales` / `upsertDailySales` ([src/domain/sales/upsertSales.ts:87,120](../../src/domain/sales/upsertSales.ts#L87)) `upsert` into these tables. The Sales page is **StaffRestricted** ([App.tsx:134](../../src/App.tsx#L134)) — STAFF have no UI to write sales, and RLS blocks them regardless. No legitimate STAFF write workflow exists.

## 8. Business / user impact

- **Current real-world risk: none from this policy** — the leak the roadmap describes is not present in source; STAFF cannot write sales via the API (sales feed Food Cost %, so this protects that KPI input).
- **The real risk is documentation drift:** the audit/roadmap assert a P0 leak that isn't there. Acting on it blindly (e.g., re-writing the policy to `is_member_of` "to match the audit") would *introduce* the very bug. Conversely, leaving the docs uncorrected wastes future effort and undermines audit trust.
- **Residual uncertainty:** the deployed DB cannot be inspected from here; only a re-assertion migration or a prod `pg_policies` check can guarantee the environment matches source.

## 9. Affected components

| Layer | File | State |
|-------|------|-------|
| RLS (subject) | [20260518000001_sales_entry.sql:207-281](../../supabase/migrations/20260518000001_sales_entry.sql#L207) | Already Manager+ (weekly_sales + daily_sales) |
| Helpers | `has_restaurant_role_any`, `user_can_access_location` | exist; used correctly |
| Stale docs | [trust-first-roadmap.md](../trust-first-roadmap.md) (S0-7), [role-permission-matrix.md](../role-permission-matrix.md) (G4, Part B), [product-reality.md](../product-reality.md) (Sales row) | **claim a leak that doesn't exist — need correction** |
| App / UI | `upsertSales.ts`, Sales page (StaffRestricted) | unaffected |

## 10. Affected tables

`weekly_sales`, `daily_sales` — **no change required in source**; policies already correct.

## 11. Migration risk & rollback

- If a **defensive idempotent re-assertion** migration is chosen (plan §B): it DROP/CREATEs the **same** Manager+ write policies — zero behavior change where source is already correct; guarantees the posture where a deployed environment drifted. Risk: must reproduce the existing conditions **exactly** (incl. the location-access conjunct) so as not to weaken or alter them. Rollback: trivial (the policies are unchanged in intent); revert the migration. No data touched.
- If **doc-only** (plan §A): no migration, no risk; but the deployed-DB guarantee rests on trusting that migrations applied unaltered.

## 12. Open questions for the plan

1. **Close S0-7 by doc-correction only, or also ship a defensive idempotent re-assertion migration** (to guarantee the deployed DB matches the correct source, since it can't be inspected here)? — **decision required.**
2. **If re-asserting, include `daily_sales`** (identical sibling, same posture, feeds the weekly digest) or `weekly_sales` only (literal S0-7 scope)? — **decision required.**
3. Must correct the stale audit docs (G4 / S0-7 / product-reality) regardless of 1–2.

## 13. Dependencies / sequencing

GATE green. Independent of S0-INFRA. No app code involved either way. Next Phase-1 item after S0-6.

> No application code was modified in producing this investigation. Finding: S0-7's described vulnerability is **not present in current source** — the write policies already enforce Manager+.
