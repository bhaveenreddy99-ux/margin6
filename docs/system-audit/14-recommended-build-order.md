# 14 — Recommended Build Order

Phased plan starting from audit findings. **No code in this audit** — sequencing only.

---

## Phase 0 — Repository and production-state reconciliation (1–2 weeks)

**Why first:** Cannot trust any UI demo or sell story until dashboard and types match database truth.

| # | Work item | Likely files |
|---|-----------|--------------|
| 0.1 | Fix owner dashboard inventory value $0 (location + session scope) | `src/domain/dashboard/loadInventoryMetrics.ts`, `src/domain/dashboard/dashboardSelectors.ts`, `src/hooks/useDashboardData.ts`, `src/pages/app/Dashboard.tsx` |
| 0.2 | Fix `locations` SELECT RLS for MANAGER/STAFF | New migration superseding policy in `supabase/migrations/20260306000003_rls_settings_notifications.sql` |
| 0.3 | Regenerate Supabase types; remove recipe dead code | `src/integrations/supabase/types.ts`, delete `src/hooks/useRecipe*.ts`, `src/domain/recipes/*` |
| 0.4 | Fix typecheck (stop importing Deno edge code from Vitest or add Deno types shim) | `src/test/app-base-url.test.ts`, `supabase/functions/_shared/appBaseUrl.ts` |
| 0.5 | Update dashboard.smoke selectors | `tests/e2e/dashboard.smoke.spec.ts` |
| 0.6 | Document Playwright install in CI/dev | `.github/workflows/ci.yml`, `tests/e2e/README.md` |

**Exit criteria:** Local baseline S8 inventory value PASS; DEF-LOCAL-001 closed; CI green.

---

## Phase 1 — Capability and permission foundation (1–2 weeks)

**Why second:** Managers and employees cannot be safe until permissions apply to data fetch, not just two KPI cards.

| # | Work item | Likely files |
|---|-----------|--------------|
| 1.1 | Gate `useDashboardData` loaders by `can_see_costs`, `can_see_inventory_value`, `can_see_food_cost_pct` | `src/hooks/useDashboardData.ts`, `src/hooks/useLocationPermissions.ts` |
| 1.2 | Wire `has_location_permission` into sensitive RLS or move cost reads to RPC | `supabase/migrations/*`, `20260623000005_authz_helpers.sql` |
| 1.3 | Consolidate invites onto `restaurant_invites`; retire legacy reads | `src/hooks/useLocationSettings.ts`, `src/contexts/RestaurantContext.tsx`, migrations |
| 1.4 | Extend authz-parity tests for dashboard gating | `src/test/authz-parity.test.ts` |

**Exit criteria:** Manager without `can_see_costs` gets no spend/profit data in network tab; single invite path.

---

## Phase 2 — Exception data model (2–3 weeks)

**Why third:** Product promise is exception management — need resolved/unresolved state.

| # | Work item | Likely files |
|---|-----------|--------------|
| 2.1 | Define exception entity (price hike, short ship, overorder) with status | New migration + `src/domain/exceptions/*` |
| 2.2 | Link exceptions to invoice_line_comparisons, delivery_issues, notifications | `delivery_issues`, `notifications` |
| 2.3 | Owner exception inbox (minimal page or dashboard section) | `src/pages/app/Dashboard.tsx` or new route |
| 2.4 | Fix price hike card data path (DEF-LOCAL-009) | `src/domain/dashboard/priceIncreaseFromNotifications.ts`, `PriceHikeAlertsCard` |

**Exit criteria:** Seeded price increase visible once; exceptions listable with open/resolved.

---

## Phase 3 — Three-way matching hardening (2–3 weeks)

| # | Work item | Likely files |
|---|-----------|--------------|
| 3.1 | Receipt confirm E2E with stock_movement assertions | `tests/e2e/invoice-flow.spec.ts`, new receipt spec |
| 3.2 | Idempotency + double-click concurrency test | Two-context Playwright |
| 3.3 | Wire or remove `ready_to_receive` status | `invoicesPageHelpers.ts`, `invoiceStatusLifecycle.ts` |
| 3.4 | Retire purchase_history fallback (read path first) | `src/data/invoice/fetchInvoiceReviewDoc.ts` |

**Exit criteria:** DEF-LOCAL-008 closed; single movement per line under retry.

---

## Phase 4 — Manager operations dashboard (2–3 weeks)

| # | Work item | Likely files |
|---|-----------|--------------|
| 4.1 | Manager landing: action queue (counts in review, invoices pending, delivery issues) | New `ManagerDashboard.tsx` or branch in `DashboardRouter.tsx` |
| 4.2 | Route managers to queue instead of owner KPI wall | `src/pages/app/DashboardRouter.tsx` |
| 4.3 | Allow manager Settings subset (team invite if authorized) | `src/App.tsx`, `Settings.tsx`, `OwnerRoute.tsx` |

**Exit criteria:** Manager daily workflow obvious without scrolling KPI cards.

---

## Phase 5 — Employee count and receiving workflows (2–3 weeks)

| # | Work item | Likely files |
|---|-----------|--------------|
| 5.1 | Fix desktop/mobile count qty inputs (DEF-LOCAL-003) | `InventorySessionEditor.tsx`, zone components, `sessionDisplayHelpers.ts` |
| 5.2 | Employee count E2E through submit | `tests/e2e/baseline/local-full-baseline.spec.ts` |
| 5.3 | Optional: staff delivery qty capture (if in MVP scope) | TBD — not in current routes |

**Exit criteria:** Suite 1 steps 5–19 PASS; mixed-unit chicken UI verified.

---

## Phase 6 — Credit recovery (post-MVP)

| # | Work item | Notes |
|---|-----------|-------|
| 6.1 | Credit memo / vendor claim entity | Not in schema today |
| 6.2 | Link to delivery_issues | |
| 6.3 | Owner recovered $ KPI | |

---

## Phase 7 — Pilot onboarding and hardening

| # | Work item |
|---|-----------|
| 7.1 | Staging seed + Playwright in CI |
| 7.2 | Full 8-user authorization matrix |
| 7.3 | Recovery suite (refresh, offline, two tabs) |
| 7.4 | Founder demo script with verified KPIs |

---

## Epic 0 recommendation (start tomorrow)

**Epic: Dashboard Trust + Location RLS Reconciliation**

**Why first:** Blocks every demo, design partner conversation, and downstream test meaning. Without trusted inventory value and location scoping, manager/employee work cannot be validated.

**Exact files:**
- `src/domain/dashboard/loadInventoryMetrics.ts`
- `src/domain/dashboard/dashboardSelectors.ts`
- `src/hooks/useDashboardData.ts`
- `src/pages/app/Dashboard.tsx`
- `supabase/migrations/20260306000003_rls_settings_notifications.sql` (new migration to replace locations SELECT policy)
- `docs/testing/local/full-baseline-run/defects.json` (verify DEF-LOCAL-001/002 closed after fix)
