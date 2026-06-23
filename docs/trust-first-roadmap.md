# Margin6 — Trust-First Roadmap

> **Date:** 2026-06-23
> **Ordering principle (from `CLAUDE.MD/` Pilot Rules):** Security → Permission enforcement → KPI correctness → Workflow reliability → Features. "Do not add features while trust issues remain unresolved."
> **Sources:** [product-reality.md](product-reality.md), [kpi-source-of-truth.md](kpi-source-of-truth.md), [role-permission-matrix.md](role-permission-matrix.md), [product-vision.md](product-vision.md), [full-human-product-code-audit.md](full-human-product-code-audit.md), [high-risk-fix-roadmap.md](archive/high-risk-fix-roadmap.md) _(archived predecessor)_.
> **Constraint:** Documentation only — no code changed, no tasks created.
> **Effort key:** S ≤ 0.5d · M = 1–2d · L = 3–5d.

## Gate before anything ships

**GATE — Green CI.** 8 failing unit tests + 13 type errors today. Until the suite is green, every fix below ships blind. *Files:* `src/test/*`, `src/hooks/useMathBreakdown.ts`, `src/components/dashboard/DataQualityBanner.tsx`, seed fixtures. *Effort:* M. *Dependency:* none — **do first.**

---

## P0 — SECURITY (exploitable today; protect financial data)

| ID | Issue | Business impact | Customer impact | Files | Effort | Dependencies |
|----|-------|-----------------|-----------------|-------|:------:|--------------|
| S0-1 | `parse-invoice` no membership auth | Unbounded Anthropic spend; abuse | None visible until bill/outage | `supabase/functions/parse-invoice/index.ts:147-153`, `config.toml` | S | GATE |
| S0-2 | `process-notifications` publicly invokable | Anyone triggers mass email across all restaurants | Spam to customers; sender-reputation damage | `supabase/functions/process-notifications/index.ts`, `config.toml` | S–M | GATE |
| S0-3 | `inbound-invoice-email` no webhook auth | Forged invoice/alert injection | Fake invoices/alerts in owner's account | `supabase/functions/inbound-invoice-email/index.ts:155-308` | S–M | GATE |
| S0-4 | `submit_smart_order` RPC ignores approval/threshold | Unauthorized POs; vendor commitments | Staff/limited mgr places real orders | `supabase/migrations/20260327000004…:20`, `src/pages/app/SmartOrder.tsx:476-489` | M | GATE, **S0-INFRA** |
| S0-5 | `inventory_sessions` DELETE open to STAFF | Destroyed count history (basis of all value math) | Lost inventory records | `supabase/migrations/20260306000002…:253-255` | S | GATE |
| S0-6 | `purchase_history_items` write open (name lies "Manager+") | Corrupted PO/invoice line items | Wrong purchase records | `…20260306000002…:172-179` | S | GATE |
| S0-7 | **CORRECTED — not a leak in source.** `weekly_sales`/`daily_sales` writes already enforce Manager+ (`has_restaurant_role_any(OWNER,MANAGER)` + location); the "name lies / `is_member_of`" claim was stale. Defensively re-asserted so every environment matches source. | — | — | `20260518000001_sales_entry.sql:207-281`; re-assert `20260623000003`; see `docs/investigations/s0-7-weekly-sales-write-rls.md` | S | GATE |
| S0-8 | `notifications` INSERT has no `user_id` check | Any member forges "CRITICAL" alerts to any user; pollutes shrinkage KPI | Phishing/spoofed alerts to owner | `…20260306000003…:198-200` | S–M | GATE; route real creates via RPC/edge |
| S0-9 | `confirm_invoice_receipt` no role/confirm re-check | Unauthorized stock + destructive cost overwrite | Costs changed without authorization | `…20260524000001…:36` | M | GATE, **S0-INFRA**; co-change with T1-? cost-history |
| **S0-INFRA** | **Server-side permission enforcement model** (a SQL `get_location_permissions`/role check RLS+RPCs can call) | Foundation so S0-4/S0-9 + P1 gates are enforced once, not per-table | — | `supabase/migrations/20260503000005_location_rls_helpers.sql` (extend), new migration | M | GATE — **build before S0-4/S0-9** |

## P0 — TRUST (numbers owners see; "trust is the product")

| ID | Issue | Business impact | Customer impact | Files | Effort | Dependencies |
|----|-------|-----------------|-----------------|-------|:------:|--------------|
| **T0-0** | **Adopt canonical formulas** (UI bypasses `dashboardTrustFormulas.ts`) | Fixes land once, tests protect the rendered number | — | `src/domain/dashboard/dashboardTrustFormulas.ts`, `ProfitRiskWidget.tsx:93`, `Dashboard.tsx:765`, `AuditCenter.tsx`, `loadProfitLeaks.ts` | M | GATE — **do before T0-1/2/3** |
| T0-1 | Profit Risk hero mixes Verified period flows with Potential snapshot overstock | Violates Money Rules; headline number self-contradicts | Owner distrusts dashboard | `src/components/ProfitRiskWidget.tsx:93-94` | M | T0-0 |
| T0-2 | Savings banner counts overstock as recoverable savings | Overstates recoverable upside; same $ labeled two ways | Owner plans around money that isn't there | `src/pages/app/Dashboard.tsx:765,908` | S–M | T0-0 |
| T0-3 | Price-Increase double-count + divergent qty bases | Inflated, inconsistent leak dollars | Two screens disagree on same hike | `loadSpendMetrics.ts:169-181`, `loadProfitLeaks.ts:217-251` | M | T0-0 |
| T0-4 | Audit Center renders $0 "verified" on load error | The trust page fabricates audited zeros | Owner shown false "all clear" | `src/pages/app/AuditCenter.tsx:60`, `useDashboardData.ts:194` | S | GATE |
| T0-5 | Self-fetching cards swallow errors → $0 "all clear" | Failure indistinguishable from real zero | Hidden outages on financial cards | PriceHike/Shrinkage cards, `loadProfitLeaks.ts` | M | GATE |
| T0-6 | Fake "Vendor Connect" shows `MOCK_INVOICES` as real | Mock-as-real destroys credibility instantly | Owner sees invoices they never connected | `supabase/functions/vendor-import-invoices/index.ts:9-23,68`, `Invoices.tsx` tab | S | GATE |
| T0-7 | Shrinkage sourced only from member-writable notifications | Forged/duplicate rows inflate a "verified" loss | Wrong shrinkage dollars | `loadShrinkageValue.ts` | M | **S0-8** |
| T0-8 | `useSubscription` fails open to "trial" + price contradiction ($69.99 vs $99) | Billing mis-gating; pricing looks broken | Paying user sees "trial ended"; conflicting price | `useSubscription.ts:54`, `Billing.tsx:20`, `TrialBanner.tsx:31` | S–M | GATE |

## P1 — SECURITY (before paid customers)

| ID | Issue | Business impact | Customer impact | Files | Effort | Dependencies |
|----|-------|-----------------|-----------------|-------|:------:|--------------|
| S1-1 | `can_see_costs` not enforced (Invoices/Review/PurchaseHistory) | Cost-hiding owners configure is ignored | Mgr/staff see vendor prices owner hid | `Invoices.tsx:945-953`, `ComparisonTable.tsx:327,333`, `PurchaseHistory.tsx` | M | S0-INFRA |
| S1-2 | Settings UPDATE Manager+ vs Owner-only route | Mgr changes "owner-locked" settings via API | Settings change owners think are locked | `…20260306000003…:32-35` | M | — |
| S1-3 | Locations CRUD Manager+ vs Owner UI | Same UI-stricter-than-DB gap | Unexpected location edits | `…20260306000003…:59-73` | S | — |
| S1-4 | Reminders/alert recipients writable too broadly | Members alter who gets alerts | Missed/misrouted alerts | `…20260306000003…:252-316` | M | — |
| S1-5 | `notification_preferences` writable by any member | Staff disables owner's alerts | Owner stops receiving alerts silently | `…20260306000003…:219-233` | S | — |
| S1-6 | PAR write open vs `can_edit_par` flag | PAR (drives ordering) editable past UI gate | Wrong order quantities | `par_settings`/`par_guide_items` RLS | M | S0-INFRA |
| S1-7 | Per-location permission flags are UI-only | All 6 flags cosmetic; no server enforcement | Any flag bypassable via API | `src/hooks/useLocationPermissions.ts` + RLS/RPC | L | **S0-INFRA** |
| S1-8 | "Current Password" collected but never verified | Weak credential-change flow | Account-takeover risk on session hijack | `src/pages/app/Settings.tsx:195-210` | S | — |
| S1-9 | Write policies not location-scoped (only SELECT is) | Member writes rows in non-assigned locations | Cross-location data edits | `…20260503000006_extend_location_rls.sql` | M | S0-INFRA |

## P1 — TRUST (workflow reliability + honest numbers)

| ID | Issue | Business impact | Customer impact | Files | Effort | Dependencies |
|----|-------|-----------------|-----------------|-------|:------:|--------------|
| T1-1 | Receipt confirm doesn't update dashboard on-hand | Confirmed deliveries invisible to inventory | "I received it, why no change?" | `loadInventoryMetrics.ts`, `confirm_invoice_receipt` | L (project) / S (label) | S0-9 |
| T1-2 | No `catalog_cost_history` audit trail | Cost overwritten in place; no record | Can't see when/why a cost changed | `confirm_invoice_receipt` migration | L | S0-9 (co-change RPC) |
| T1-3 | Inventory value hero vs trend chart dedupe divergence | Two "current value" numbers on one screen | Visible contradiction | `dashboardSelectors.ts:199` vs `:339` | M | T0-0 |
| T1-4 | Missing-delivery dollars computed but never rendered | A Verified-loss pillar is invisible | Owner sees count, no $ | `invoice-comparison.ts`, `Dashboard.tsx` | M | T0-0 |
| T1-5 | Two disagreeing order engines on screen | Deprecated `computeOrderQty` contradicts current | Two order numbers for same item | `Review.tsx:323`, `Approved.tsx:235`, `inventory-utils.ts:217` | M | — |
| T1-6 | LOW_STOCK dual-create + dedupe ignores `data` | Notification fatigue / dropped distinct alerts | Missed or duplicate alerts | `smartOrderFromSession.ts:100-117`, dedupe trigger | M | — |
| T1-7 | Invoices error → silent "No invoices yet" | Failure looks like empty account | Owner thinks data lost | `useInvoicesData.ts:80` | S | T0-5 pattern |
| T1-8 | Waste `total_cost` client-set/STAFF-inflatable | A Verified input can be gamed | Inflated waste/Profit Risk | `WasteLog.tsx` + RLS | M | S0-INFRA |
| T1-9 | Food Cost % 30-day spend vs sales window mismatch | Skewed % on the 30-day view | Wrong food-cost ratio | `loadFoodCostMetrics.ts:44-65` | M | — |
| T1-10 | MANAGER without location assignment broken | Manager sees empty data despite role | Onboarding dead-end for groups | `RestaurantContext.tsx`, location RLS | M | S1-7 |
| T1-11 | "Money Lost this week" (portfolio) formula UNVERIFIED | Label asserts realized loss; source unknown | Possibly wrong per-restaurant loss | `loadRestaurantPortfolioSummaries.ts` | S (verify) + TBD | T0-0 |
| T1-12 | Stripe webhook missing `customer.subscription.updated` | past_due→active never auto-recovers | Paid customer stays locked out | `stripe-webhook/index.ts` | M | — |

## P2 — CLEANUP (maintainability; after trust is restored)

| ID | Issue | Business/Customer impact | Files | Effort | Dependencies |
|----|-------|--------------------------|-------|:------:|--------------|
| C-1 | Currency formatting duplicated (10+ formatters, already disagree 0 vs 2 decimals) | Inconsistent $ display | `src/lib/format.ts` + ~20 sites | M | T0-0 |
| C-2 | Inline role checks (~12 sites) vs shared helper | Drift risk | `Approved.tsx:60`, `Review.tsx:270`, etc. | M | S0-INFRA |
| C-3 | Two toast systems mounted | ~190 LOC dead mechanism | `hooks/use-toast.ts` vs `sonner` | S | — |
| C-4 | "RestaurantIQ" brand on password pages | Phishing-like inconsistency | `ForgotPassword.tsx:38`, `ResetPassword.tsx:59` | S | — |
| C-5 | Dead code (recipes, Phone/Tablet count views, `domain/metrics/types.ts`) | ~3,400 LOC noise | dead-code-audit list | M | product decision |
| C-6 | Monolith pages (ListManagement 1831, Dashboard 1758, Settings 1521) | Velocity drag | those files | L (ongoing) | — |
| C-7 | PAR null→0 coercion; bulk edits local-only | Silent data surprises | `PARManagement.tsx:379-382,1138` | S | — |
| C-8 | PAR suggestions duplicate `par_guide_items` | Duplicate rows | `PARSuggestions.tsx:230-279` | S | — |
| C-9 | "Counted" definition mismatch (`>0` vs `!==null`) | Inconsistent counts | `InventoryCountPage.tsx:255-257`, `itemView.ts:580` | S | — |
| C-10 | Non-persisted "Suggested Order" edits (Approved) | Edits silently lost | `Approved.tsx:269-279` | S | — |
| C-11 | Silent approval-notification failure (console.warn) | Missed alert, no surface | `sessionWorkflow.ts:653-659` | S | — |
| C-12 | 6-char password min; raw Supabase errors shown | Weak/confusing auth UX | `Signup.tsx`, `Login.tsx` | S | — |
| C-13 | vendor-import-* lack membership checks (mock today) | Unsafe pattern when real | `vendor-import-*` | S | — |

---

## EXACT IMPLEMENTATION ORDER

Dependency-ordered. Each phase ends green (tests + types) before the next.

**Phase 0 — Gate (do first)**
1. GATE: green CI (fix 8 tests + 13 type errors).

**Phase 1 — P0 Security: cheap shutoffs (independent, parallelizable)**
2. S0-1 parse-invoice auth
3. S0-2 process-notifications secret
4. S0-3 inbound-invoice-email webhook auth
5. S0-5 inventory_sessions DELETE → Manager+
6. S0-6 purchase_history_items write → Manager+ (and rename policy)
7. S0-7 weekly_sales/daily_sales write — **verified already Manager+ in source (not a leak)**; defensively re-asserted (migration `20260623000003`)
8. S0-8 notifications INSERT → enforce `user_id`/route via RPC

**Phase 2 — P0 Security: shared enforcement infra**
9. **S0-INFRA** server-side permission/role helper for RLS+RPC
10. S0-4 submit_smart_order RPC enforces approval + threshold (uses S0-INFRA)
11. S0-9 confirm_invoice_receipt enforces role + confirmation (uses S0-INFRA; co-plan with T1-2)

**Phase 3 — P0 Trust: honest numbers + no fake zeros**
12. **T0-0** route all KPIs through canonical `dashboardTrustFormulas.ts` (prerequisite for the next three)
13. T0-1 split Profit Risk hero (Verified vs Potential; period vs snapshot)
14. T0-2 fix savings banner (remove/relabel overstock)
15. T0-3 dedupe Price-Increase to one source + one qty basis
16. T0-4 Audit Center error state (never render zeros on failure)
17. T0-5 surface errors on self-fetching cards (no silent $0)
18. T0-6 hide/flag "Vendor Connect" mock
19. T0-7 re-source shrinkage off notifications (depends on S0-8)
20. T0-8 subscription fail-closed + reconcile price ($69.99/$99)

> **Pilot gate:** after Phase 3, the security holes and the shown money numbers are defensible. This is the minimum bar to put real customer data in (per Pilot Rules).

**Phase 4 — P1 Security (before paid customers)**
21. S1-1 cost-gating everywhere (uses S0-INFRA)
22. S1-2 / S1-3 Settings + Locations RLS↔UI alignment
23. S1-4 / S1-5 reminders/recipients/notification_preferences tighten
24. S1-6 PAR write enforcement (uses S0-INFRA)
25. S1-7 make per-location flags real (RLS/RPC) — largest; unlocks S1-1/S1-6 fully and T1-10
26. S1-8 verify current password on change
27. S1-9 location-scope write policies

**Phase 5 — P1 Trust (workflow reliability)**
28. T1-3 inventory value hero==trend dedupe
29. T1-4 render missing-delivery dollars
30. T1-5 unify order engine (remove deprecated path)
31. T1-1 receipt→on-hand (label-only first; projection later)
32. T1-2 add `catalog_cost_history` (co-change with S0-9 RPC)
33. T1-6 LOW_STOCK dedupe (include `data`, single path)
34. T1-7 Invoices error state
35. T1-8 waste cost integrity
36. T1-9 food-cost window alignment
37. T1-10 MANAGER-without-location onboarding (depends on S1-7)
38. T1-11 verify "Money Lost this week" formula
39. T1-12 Stripe subscription.updated handling

**Phase 6 — P2 Cleanup (ongoing, after trust restored)**
40. C-1 currency formatter consolidation → then C-2 role-helper, C-3 toast, C-4 branding
41. C-5 dead-code removal (with product sign-off) ; C-7..C-13 hygiene
42. C-6 monolith decomposition (continuous)

### Why this order
- **Security first, cheapest-highest-impact first** (Phase 1) — the name-lies RLS fixes and edge-fn auth are S-effort and stop active exploits.
- **S0-INFRA before the permission-dependent fixes** so authorization is enforced once, not re-implemented per table (honors "no duplicate permission systems").
- **T0-0 before any KPI fix** so corrections land in the canonical helper and tests protect the rendered number (honors "no duplicate formulas").
- **Shrinkage (T0-7) after notifications lock (S0-8)** — its data source must be trustworthy first.
- **Cleanup last** — never before trust issues are closed (Pilot Rules).

> No application code was modified in producing this roadmap.
