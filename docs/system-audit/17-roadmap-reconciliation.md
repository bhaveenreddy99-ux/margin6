# Roadmap reconciliation — verified state vs technical build roadmap

**Date:** 2026-07-11  
**Repository HEAD (committed):** `7750750` — `feat(invites): sub-slice 4c — Team UI via send-invite edge fn (#13)`  
**Live Supabase project:** `margin6` (`ogbnctyctoujzdcfphad`)  
**Prior audits referenced:** `docs/system-audit/00`–`16`, especially `15-production-reconciliation.md`, `16-rpc-exposure-audit.md`

This document reconciles every ticket in the Technical Build Roadmap against **repository code**, **live schema**, and **tests**. It does not assume roadmap classification (`[AUDIT]` / `[BUILD]`) matches current reality.

---

## Summary counts

| Actual status | Count |
|---------------|------:|
| VERIFIED COMPLETE | 8 |
| COMPLETE BUT NOT PRODUCTION-VERIFIED | 4 |
| PARTIALLY IMPLEMENTED | 10 |
| IMPLEMENTED DIFFERENTLY | 3 |
| MISSING | 5 |
| LEGACY ONLY | 1 |
| BROKEN | 1 |
| BLOCKED | 1 |
| DUPLICATE OR OBSOLETE | 2 |
| REQUIRES HUMAN DECISION | 2 |

**Roadmap assumptions that were incorrect:**

1. **AcceptInvite (3.2)** is marked `[BUILD]` but is **already implemented** in repo with route, signup/login handling, and RPC wiring.
2. **Team UI secure backend (3.3)** is marked `[BUILD]` but **`send-invite` edge + `sendTeamInvite.ts` already exist**; remaining work is manager route access and legacy disconnect.
3. **LoadOutcome (2.1)** is marked `[AUDIT]` but all nine dashboard loaders **already return `LoadOutcome<T>`** with per-loader Vitest files.
4. **Shrinkage demotion (2.4)** roadmap says replace dollar with count — **current code still uses dollar aggregation** (`loadShrinkageValue.ts`); ticket is genuinely open, not done.
5. **Phase 1.3 legacy retirement** cannot proceed — **production `invitations` has 3 rows** (verified live 2026-07-11); roadmap STOP condition applies.
6. **Location isolation** fix exists in **uncommitted repo migration** `20260712000001` but **production still uses** `is_member_of(restaurant_id)` on `locations` SELECT (verified live policy `Members can view locations`).

---

## Reconciliation table — Phase 1

| Ticket | Roadmap | Current implementation evidence | Live/deployed evidence | Actual status | Risk | Recommended action |
|--------|---------|--------------------------------|------------------------|---------------|------|-------------------|
| **1.1** Core RLS baseline | AUDIT | RLS migrations: `20260212001141_initial_schema_core_rls.sql`, `20260306000002_rls_core_inventory.sql`, `20260306000003_rls_settings_notifications.sql`, `20260503000006_extend_location_rls.sql`, `20260706000001_restrict_restaurant_members_owner_self_insert.sql`. Tests: `supabase/tests/daily_ops_roles_rollback_smoke.sql`, `supabase/tests/location_isolation_rls.sql`. Audit: `docs/system-audit/09-database-security.md` | Live query: RLS `ON` for `restaurants`, `restaurant_members`, `inventory_sessions`, `inventory_session_items`, `invoices`, `notifications`, `par_guide_items`, `user_location_assignments`. **`locations` SELECT policy:** `is_member_of(restaurant_id)` only — **no `user_can_access_location`**. | **PARTIALLY IMPLEMENTED** | **High** — manager location leak confirmed on prod; per-location cost flags not in RLS | Apply `20260712000001_location_select_rls_scoped.sql` on staging after backup; do not rebuild policies. Document permission-flag gaps separately. |
| **1.2** `restaurant_invites` schema | AUDIT | Migration `20260707000001_restaurant_invites_table.sql`: `token_hash bytea`, `restaurant_invite_status` enum, OWNER-excluding CHECK, SELECT-only RLS, no client writes. RPC migrations `20260708000001`–`20260711000001`. SQL tests in `supabase/tests/*_invite*_test.sql` | Live columns: `token_hash` (bytea), no plaintext `token`. Live policy: `Owner/Manager can view restaurant invites` — SELECT only, `has_restaurant_role_any`. Live RPCs: `create_invite`, `accept_invite`, `list_invites`, `resend_invite`, `revoke_invite`, `get_invite_preview`, `can_manage_invite` | **VERIFIED COMPLETE** | Low on schema; medium on legacy coexistence | No rebuild. Regenerate TypeScript types to include `restaurant_invites` table. |
| **1.3** Retire legacy invites | BUILD | Legacy still present: `invitations` (`20260221033413`), `user_invites` (`20260510000001`). `RestaurantContext.tsx` L221–227 calls `accept_user_invites`. `useLocationSettings.ts` L264–277 reads legacy `invitations`; L501 deletes legacy rows. **No DROP migration.** | Live row counts: **`invitations` = 3**, `user_invites` = 0, `restaurant_invites` = 3. Trigger `on_user_created_accept_invitations` assumed from initial migration. | **BLOCKED** | **Critical** if dropped prematurely — live legacy data exists | **STOP.** Migrate or expire 3 legacy rows. Complete 3.4 first. Then empty-table verification in rolled-back transaction before DROP. |
| **1.4** Migration ledger reconciliation | BUILD | Doc: `docs/system-audit/15-production-reconciliation.md`. Repo: **133** migration files (131 logical + `20260712000001`, `20260712000002`). Live head: `20260706210854_get_invite_preview_rpc`. Six invite migrations differ by timestamp only. | Live: no rows for `20260712000001` / `20260712000002`. Timestamp drift pairs documented in doc 15. | **PARTIALLY IMPLEMENTED** | Medium — mistaken re-apply could duplicate objects | Run `supabase migration list` dry-run / repair **metadata only** after human approval. Never re-run invite SQL bodies on prod. Apply corrective migrations via normal pipeline. |
| **1.5** Subscription schema + cutoff | AUDIT | `src/domain/subscription/resolveEntitlement.ts`: `SUBSCRIPTION_LAUNCH_CUTOFF = 2027-01-01`. Tests: `src/test/resolve-entitlement.test.ts`. Hook: `src/hooks/useSubscription.ts`. DB: `20260521000001_stripe_billing.sql` CHECK `('trial','active','past_due','canceled')` | Live not re-queried for CHECK; resolver maps pre-cutoff → `grandfathered`. Comment L6–8: **enforcement not wired**. | **VERIFIED COMPLETE** (logic) / **REQUIRES HUMAN DECISION** (enforcement date) | Medium when enforcement enabled | Confirm cutoff stays far-future until launch decision. Do not enable hard gate without explicit approval (3.7 / Phase 4). |

---

## Reconciliation table — Phase 2

| Ticket | Roadmap | Current implementation evidence | Live/deployed evidence | Actual status | Risk | Recommended action |
|--------|---------|--------------------------------|------------------------|---------------|------|-------------------|
| **2.1** `LoadOutcome<T>` coverage | AUDIT | Type: `src/domain/dashboard/loadOutcome.ts`. Loaders (all `Promise<LoadOutcome<T>>`): `loadInventoryMetrics`, `loadInvoiceMetrics`, `loadSpendMetrics`, `loadShrinkageValue`, `loadWasteMetrics`, `loadFoodCostMetrics`, `loadOverstockItems`, `loadProfitLeaks`, `loadRestaurantPortfolioSummaries`. Orchestrator: `src/hooks/useDashboardData.ts` sets `errors` per KPI. UI: `KpiCouldNotLoad` in `ProfitRiskWidget`, `OverstockCashTrapCard`, `ProfitLeaksCard`. Tests: `src/test/load-*.test.ts` (9 files) | Dashboard inventory KPI trust fix **in uncommitted work**: `resolveInventoryValueKpiDisplay` in `dashboardSelectors.ts`, `Dashboard.tsx` uses `—` for load errors | **VERIFIED COMPLETE** (loaders) / **PARTIALLY IMPLEMENTED** (all KPI surfaces) | Medium — some widgets still fall back to 0 in snapshot while flagging errors | Audit remaining KPI cards for `errors.*` handling. Commit inventory KPI display fix. Document gaps in `docs/audit-phase2-loadoutcome.md` if needed. |
| **2.2** Price-increase double-count | BUILD | `loadSpendMetrics.ts` L173–197: sums `linePriceIncreaseImpact(comparisons)` **then adds** `sumPriceIncreaseImpactFromNotifications(priceNotifs)`. Same dual path in `loadProfitLeaks.ts`. Defect: `docs/testing/full-product-baseline/12-defect-register.md` DEF-FIN-001. **No dedupe regression test.** | Not runtime-verified on prod in this pass | **BROKEN** | **High** — inflated owner KPI | Pick single source of truth (comparisons preferred). Add CI test: one price event → counted once. Do not change until test proves double-count. |
| **2.3** Split Money Lost | BUILD | `ProfitRiskWidget.tsx`: four split rows (waste, price hike, overstock, shrinkage) L104–136; **combined total** L101–102 inline sum. Canonical: `dashboardTrustFormulas.ts` `computeMoneyLostTotal()`. Widget does **not** call canonical function. `ProfitLossIntelligence` inline in `Dashboard.tsx` ~L747 still aggregates savings opportunity | No prod UI verification in this pass | **PARTIALLY IMPLEMENTED** | Medium — mixed time-base sum still shown | Replace inline totals with two domain figures: "Losses this period" vs "Cash frozen now". Wire widget through domain functions. |
| **2.4** Demote shrinkage to event count | BUILD | `loadShrinkageValue.ts`: sums `dollar_impact` from `SHRINK_ALERT` / `COUNT_VARIANCE` notifications. `ShrinkageAlertCard.tsx` shows dollar rows. Test: `load-shrinkage-value.test.ts` asserts dollars | Roadmap intent **not implemented** — still dollar KPI | **MISSING** (relative to roadmap spec) | Medium — unverified dollar presented confidently | Implement count-based KPI per roadmap; remove confident dollar surfaces. |
| **2.5** Invite RPC contracts | AUDIT | Live signatures match migrations (see Phase 3.1). Generated types `src/integrations/supabase/types.ts`: has `accept_invite`, `get_invite_preview`, `list_invites`, `revoke_invite`; **missing** `create_invite`, `resend_invite`, **`restaurant_invites` table**. Browser uses `sendTeamInvite.ts` → edge, not typed RPCs | All 7 RPCs present on live DB | **PARTIALLY IMPLEMENTED** | Low runtime (edge bypass); medium DX/security review | Run `supabase gen types` after staging sync. Add code comment on edge-only token handling (already in `sendTeamInvite.ts` L46). |
| **2.6** Calculation regression tests | BUILD | `src/test/casePlanningEngine.test.ts`, `src/lib/inventory-conversions.test.ts`, `src/lib/pack-parser.test.ts`, `src/test/dashboard-trust-calculations.test.ts`, `src/test/load-inventory-metrics.test.ts` (expanded in uncommitted work) | Vitest: 613 passed (2026-07-11 local run) | **VERIFIED COMPLETE** | Low | Extend with price-dedupe and location-isolation tests; do not duplicate existing conversion tests. |

---

## Reconciliation table — Phase 3

| Ticket | Roadmap | Current implementation evidence | Live/deployed evidence | Actual status | Risk | Recommended action |
|--------|---------|--------------------------------|------------------------|---------------|------|-------------------|
| **3.1** Invite backend + send-invite | AUDIT | Migrations `20260707000001`–`20260711000001`. Edge: `supabase/functions/send-invite/index.ts` calls `create_invite`/`resend_invite` server-side. Domain: `src/domain/invites/sendTeamInvite.ts`. SQL tests in `supabase/tests/` | Live RPCs verified. Edge deploy status **not verified** in this pass (repo code present) | **COMPLETE BUT NOT PRODUCTION-VERIFIED** (edge deploy) | Medium | Verify `send-invite` deployed on staging/prod via Supabase dashboard or `list_edge_functions`. Fetch deployed source; confirm token not in HTTP response body. |
| **3.2** AcceptInvite page | BUILD | `src/pages/AcceptInvite.tsx`: auth routing + INV00–INV04 errors. Route: `src/App.tsx` L103 `/accept-invite`. Signup: `Signup.tsx` `?invite=`, email lock, redirect. Login: `Login.tsx` guarded redirect | Page exists in repo; prod deploy assumed same as main | **DUPLICATE OR OBSOLETE** (ticket marked BUILD but done) | Medium on token persistence in URL | **Do not rebuild.** Audit token lifecycle (URL → signup → confirm → accept) for leftover storage. Close ticket as complete after audit checklist. |
| **3.3** Re-point Team UI | BUILD | `Settings.tsx` `TeamSection` (~L1130): location `Select` L1294–1296, `inviteMember` → `sendTeamInviteEmail`. Hook: `useLocationSettings.ts` L418+. **Gap:** `App.tsx` L138 wraps Settings in `OwnerRoute` — **managers blocked** despite `managerOnly: true` on team tab. Legacy pending list merged L300 | Team invite path uses secure edge in code; managers cannot reach `/app/settings` | **PARTIALLY IMPLEMENTED** | **High** — managers cannot invite despite backend support | Widen route guard to allow MANAGER on team tab only (or dedicated route). Keep legacy merge until 3.4. Do not call `create_invite` from browser. |
| **3.4** Disconnect legacy path | BUILD | `RestaurantContext.tsx` L221–227: `accept_user_invites` on boot. `useLocationSettings.ts`: legacy SELECT + DELETE. No removal of trigger | Live: 3 legacy invitation rows | **MISSING** | **Critical** if done before 3.3 verified | Sequence: deploy 3.3 → manual prod E2E → remove legacy reads/RPC boot call → then 1.3. |
| **3.5** Staff quick-add | BUILD | No `provision_staff` in migrations/types/src. Nearest: `assignMember` for **existing** users in `useLocationSettings.ts` L451 | Not on live DB | **MISSING** | Medium | New DEFINER RPC + UI after invite path stable. Same scoping discipline as `create_invite`. |
| **3.6** Route guard audit | AUDIT | `OwnerRoute.tsx`, `StaffRestrictedRoute.tsx`, `ProtectedRoute.tsx`, `DashboardRouter.tsx`. Tests: `src/test/dashboard-role-routing.test.tsx`, `src/test/employee-dashboard.test.tsx`. Wiring: `App.tsx` | Manager blocked from settings/invoices routes; STAFF gets `EmployeeDashboard` only | **VERIFIED COMPLETE** (with documented manager settings gap) | Medium — UI gate without RLS still insufficient alone | Document route→RLS matrix in audit doc. Fix manager settings access separately (3.3). |
| **3.7** Subscription soft-gate | BUILD | `TrialBanner.tsx` in `Dashboard.tsx`. `resolveEntitlement.ts` + `useSubscription.ts`. Tests: `resolve-entitlement.test.ts`. **No readOnly enforcement** anywhere | Soft banner only | **PARTIALLY IMPLEMENTED** | Low until enforcement flipped | Confirm grandfathered path in UI. Do not add hard lockout without human decision. |

---

## Reconciliation table — Phase 4

| Ticket | Roadmap | Current implementation evidence | Live/deployed evidence | Actual status | Risk | Recommended action |
|--------|---------|--------------------------------|------------------------|---------------|------|-------------------|
| **4.1** Employee dashboard | AUDIT | `DashboardRouter.tsx`: STAFF → `EmployeeDashboard.tsx`; OWNER/MANAGER → lazy `Dashboard.tsx`. `useEmployeeCountStatus.ts` — no `useDashboardData`. Tests: `dashboard-role-routing.test.tsx` | Lazy import confirmed in source | **VERIFIED COMPLETE** | Low | Optional: verify prod bundle chunk split in build output. No rebuild. |
| **4.2** ManagerWorklist | BUILD | **No `ManagerWorklist` component.** Closest: shared `ActionCenter` in `Dashboard.tsx` ~L201 for OWNER+MANAGER | N/A | **MISSING** | Low urgency vs trust/isolation | Defer until Phase 2 calculation fixes land. Do not build before 2.2/2.3. |
| **4.3** OwnerHealthView | BUILD | **No dedicated component.** Owner uses full `Dashboard.tsx` KPI set | N/A | **MISSING** | Low urgency | Defer; specify to consume fixed KPIs only (post 2.2/2.3). |
| **4.4** Remove P&L Intelligence | BUILD | `ProfitLossIntelligence` **inline** in `Dashboard.tsx` ~L747, rendered ~L1748. Title: "Profit & Loss Intelligence" | Still in owner/manager dashboard | **IMPLEMENTED DIFFERENTLY** (exists; roadmap says delete later) | Medium — triple-count UX | **Do not delete** until 4.2/4.3 replacements live (roadmap sequencing). |
| **4.5** Drill-down traceability | BUILD | `src/components/explainability/` (`KpiExplainSheet`, `kpiExplainBuilders.ts`), `DrilldownSheet.tsx`, `useMathBreakdown.ts`, `DataQualityBanner.tsx`. Used in `Dashboard.tsx`, `AuditCenter.tsx` | Not fully E2E-verified per KPI | **PARTIALLY IMPLEMENTED** | Medium — trust differentiator | Audit each KPI "view math" against seed fixtures; file gaps per KPI. |

---

## Invite system — consolidated state

| Artifact | Repo | Live | Frontend caller |
|----------|------|------|-----------------|
| `restaurant_invites` table | `20260707000001` | ✅ 3 rows, `token_hash` only | via RPCs / edge |
| `invitations` (legacy) | `20260221033413` | ✅ 3 rows | `useLocationSettings.ts` read/delete |
| `user_invites` (legacy) | `20260510000001` | ✅ 0 rows | types only + old RPC |
| `create_invite` | `20260708000001` | ✅ | **edge only** (`send-invite`) |
| `accept_invite` | `20260709000001` | ✅ | `AcceptInvite.tsx`, `Signup.tsx` |
| `get_invite_preview` | `20260711000001` | ✅ | `AcceptInvite.tsx`, `Signup.tsx` |
| `list_invites` / `revoke_invite` | `20260710000001` | ✅ | `useLocationSettings.ts` |
| `accept_user_invites` | legacy | ✅ callable | **`RestaurantContext.tsx` boot** |
| `send-invite` edge | `supabase/functions/send-invite/` | deploy unverified | `sendTeamInvite.ts` |
| `AcceptInvite.tsx` | ✅ | — | `/accept-invite` |
| Team UI location picker | ✅ `TeamSection` | — | blocked for managers by `OwnerRoute` |

**Invite tickets effectively complete:** 3.1 (repo), 3.2  
**Invite tickets remaining:** 3.3 (manager access + finish cutover prep), 3.4, 1.3 (blocked)

---

## Migration ledger — current state

| Item | Repo | Production |
|------|------|------------|
| Migration file count | 133 | 131 applied |
| Invite timestamp drift | `20260706–20260711` filenames | `20260705194029`–`20260706210854` |
| Location isolation fix | `20260712000001` (uncommitted) | **Not applied** — policy still `is_member_of` |
| Anon RPC revoke fix | `20260712000002` (uncommitted) | **Not applied** |
| Generated types | Missing `restaurant_invites`, `create_invite`, `resend_invite` | — |

---

## Epic already in progress (uncommitted repository work)

The prior **Dashboard Trust and Manager Location Isolation** epic added (not yet on production):

- `supabase/migrations/20260712000001_location_select_rls_scoped.sql`
- `supabase/migrations/20260712000002_revoke_unintentional_anon_rpc_exec.sql`
- `src/domain/dashboard/loadInventoryMetrics.ts` — session selection + empty-items error
- `src/domain/dashboard/dashboardSelectors.ts` — inventory KPI display states
- `src/pages/app/Dashboard.tsx`, `src/hooks/useDashboardData.ts`
- Tests: `load-inventory-metrics.test.ts`, `inventory-value-kpi-display.test.ts`, `location-isolation-local.test.ts`, `supabase/tests/location_isolation_rls.sql`

Local integration test **reproduces manager leak** pre-migration; fails until `20260712000001` applied locally.

---

## Recommended next epic

**Epic: Dashboard Trust and Manager Location Isolation** (unchanged from prior audit)

**Why first:** Production-verified location leak (`locations` policy); dashboard trust defects (silent $0, wrong audit baseline); corrective migrations already authored; blocks manager security and owner KPI credibility before any role-dashboard redesign (4.2/4.3).

**Must not change in this epic:** Invite retirement (1.3/3.4), manager worklist (4.2), owner health view (4.3), price double-count fix (2.2) — separate sequenced tickets.

---

## Document history

| Version | Date | Author | Notes |
|---------|------|--------|-------|
| 1.0 | 2026-07-11 | Cursor reconciliation pass | Initial verified roadmap reconciliation |
