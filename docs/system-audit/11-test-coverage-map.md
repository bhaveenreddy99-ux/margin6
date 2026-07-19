# 11 — Test Coverage Map

**Executed 2026-07-10 in audit environment**

| Command | Result |
|---------|--------|
| `npm run test` | **604/604 pass** (59 files) |
| `npm run build` | **Pass** |
| `npm run typecheck` | **Fail** — `Deno` not found in `supabase/functions/_shared/appBaseUrl.ts` imported by `src/test/app-base-url.test.ts` |
| `npm run lint` | **1 error, 29 warnings** |
| `npm run test:e2e:smoke` | **11 fail** — Playwright Chromium not installed |
| `npx playwright test --list` | **720 tests** in 16 files (5 browser projects) |

**CI (`.github/workflows/ci.yml`):** lint, typecheck, unit test, build — **no Playwright**

---

## Unit / domain tests by workflow

| Workflow | Test files | Pass |
|----------|------------|------|
| Count approve / submit | `inventory-session-workflow.test.ts` | ✓ |
| Smart order from session | `smart-order-from-session.test.ts` | ✓ |
| Zone counting | `zone-counting.test.ts`, `zone-count-phase4.test.ts`, `zone-reconcile.test.ts` | ✓ |
| PAR resolution | `canonicalParResolver.test.ts` | ✓ |
| Case planning engine | `casePlanningEngine.test.ts` | ✓ |
| Invoice lifecycle | `invoice-status-lifecycle.test.ts` | ✓ |
| Invoice review actions | `invoice-review-actions.test.ts` | ✓ |
| Invoice comparison | `invoice-comparison.test.ts`, `build-comparison-rows.test.ts` | ✓ |
| Receiving validation | `phase4.test.ts` | ✓ |
| Dashboard trust | `dashboard-trust-calculations.test.ts`, `dashboard-trust-e2e.test.ts`, `dashboard-trust-p0-polish.test.ts` | ✓ |
| Dashboard loaders | `load-*.test.ts` (inventory, spend, waste, etc.) | ✓ |
| Dashboard role routing | `dashboard-role-routing.test.tsx`, `employee-dashboard.test.tsx` | ✓ |
| Authz parity TS↔SQL | `authz-parity.test.ts` (70 tests) | ✓ |
| Notifications | `create-member-notifications.test.ts`, `process-notifications-auth.test.ts`, `price-increase-notifications.test.ts` | ✓ |
| Edge auth | `parse-invoice-auth.test.ts`, `inbound-invoice-email-auth.test.ts` | ✓ |
| Waste value | `recorded-waste-value.test.ts`, `waste-metrics-aggregate.test.ts` | ✓ |
| List management | `list-management-helpers.test.ts` | ✓ |
| Subscription | `resolve-entitlement.test.ts` | ✓ |

---

## SQL tests (`supabase/tests/`)

| File | Topic |
|------|-------|
| `accept_invite_test.sql` | Invite accept |
| `create_invite_test.sql` | Invite create |
| `get_invite_preview_test.sql` | Preview RPC |
| `invite_support_rpcs_test.sql` | list/resend/revoke |
| `restaurant_invites_rls_test.sql` | RLS |
| `daily_ops_roles_rollback_smoke.sql` | approve RPC role gate |

**Not run in this audit** (require live Supabase)

---

## Playwright E2E inventory

| Spec | Focus | Baseline / status |
|------|-------|-------------------|
| `auth.smoke.spec.ts` | Shell boot | Fail (browser) |
| `navigation.smoke.spec.ts` | Sidebar routes | Fail (browser) |
| `dashboard.smoke.spec.ts` | KPI headings | **Stale selectors** DEF-LOCAL-004 |
| `inventory.smoke.spec.ts` | Enter inventory | Mutations suite |
| `invoice-flow.spec.ts` | Invoice mutations | Staging guard |
| `restaurant-isolation.spec.ts` | UI isolation | Security smoke |
| `tenant-isolation-local.spec.ts` | JWT probes | **3/3 pass** (documented) |
| `three-role-local.spec.ts` | Role routes | Local seed |
| `local-full-baseline.spec.ts` | Full baseline | 2026-07-10 run |
| `human-dashboard-trust-flow.spec.ts` | Trust audit | Human-assisted |
| `recipes.smoke.spec.ts` | `/app/recipes` | **Dead route** |
| `full-suite.spec.ts` | Aggregate | — |

---

## Human audit / baseline docs

| Artifact | Location |
|----------|----------|
| Local full baseline | `docs/testing/local/full-baseline-run/` |
| Defect register | `defects.json` (11 defects) |
| Readiness 44/100 | `15-readiness-scorecard.md` |

---

## Critical workflows with NO or weak E2E proof

| Workflow | Unit | E2E | SQL |
|----------|------|-----|-----|
| Employee count entry + persist | Partial | **SKIP** | — |
| Manager reject → resubmit → approve | Partial | **Not run** | — |
| Smart order submit → PO | — | **Not run** | — |
| Receipt confirm + stock movement | Partial | **Not run** | — |
| Receipt idempotency / concurrency | — | **Not run** | — |
| Email invoice ingest | Auth test only | — | — |
| Owner dashboard $ matches DB | Domain ✓ | **FAIL UI** | — |
| Manager location isolation | — | API fail | — |
| Offline / recovery | — | **Not run** | — |
| Stripe billing | — | — | — |

---

## Test environment blockers

1. Playwright browsers not installed in audit sandbox
2. Production guard blocks E2E without staging env (`tests/e2e/helpers/safety.ts`)
3. Staging seed + role credentials not configured per `docs/testing/playwright/10-readiness.md`
