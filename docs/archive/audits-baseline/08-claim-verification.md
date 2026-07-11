# Claim Verification Table

**Date:** 2026-07-10  
**Rule:** Documentation is not proof. Status based on code/test/deployment evidence available in repo and audit session.

| Claim | Source | Code evidence | Test evidence | Deployment evidence | Status |
|-------|--------|---------------|---------------|---------------------|--------|
| RLS on all tables | MARGIN6_MASTER_STATUS.md | 131 migrations, Mar 2026 RLS cleanup | SQL tests partial | Not verified this audit | **Partially verified** |
| Silent $0 dashboard fixed | docs/t0-5, trust roadmap | LoadOutcome in domain loaders | 601 tests include trust tests | Jul 2026 deploy claimed | **Partially verified** — Reports still degrades |
| STAFF gets lean dashboard only | Conversation / Phase 0 | `DashboardRouter.tsx`, lazy import | `dashboard-role-routing.test.tsx` | Prod bundle check Jul 2026 | **Verified** (code) |
| Secure invite system live | MARGIN6_DEPLOY_RECONCILIATION | RPCs + AcceptInvite + send-invite | supabase/tests/*.sql | PR #12/#13 merged Jul 2026 | **Partially verified** — legacy path still active |
| OWNER self-insert escalation fixed | Migration 20260706000001 | SQL in migration | — | Conversation confirmed prod | **Code exists; deployment uncertain from repo alone** |
| delete_inventory_list anon hole closed | docs/completed/s0 | Migration + grant revoke | authz tests | MASTER_STATUS says live | **Partially verified** |
| approve_inventory_session immutable | docs | RPC + DELETE policy Jun 2026 | authz-parity | — | **Verified** (code) |
| confirm_invoice_receipt manager-only | S0-9 docs | 20260623000007 migration | authz tests | — | **Verified** (code) |
| Food cost = spend/sales | kpi-definitions.md | dashboardTrustFormulas.ts | load-food-cost-metrics.test | — | **Verified** |
| Profit Risk = waste+price+overstock+shrink | kpi-definitions.md | dashboardTrustFormulas.ts | dashboard-trust-calculations | — | **Verified** |
| Invoice three-way match UI | MASTER_STATUS | InvoiceReview feature | invoice-comparison tests | ui claim in doc | **Partially verified** |
| >5% price confirm crash fixed | MASTER_STATUS §1 | Multiple confirm_receipt migrations | Not found | **Contradicted or outdated** — needs prod retest |
| ACCOUNTANT role | Product concept | grep: no matches | — | — | **Contradicted** — not implemented |
| React Query for data fetching | — | Provider only, no hooks | — | — | **Contradicted** — not used |
| CI runs on every PR | — | No .github/workflows | — | — | **Contradicted** |
| Catch-weight supported | Out of scope note | No catch-weight domain found | — | — | **Verified out of scope** |
| Unit conversion 2 cases + 8 lb | MASTER_STATUS | casePlanningEngine + tests | casePlanningEngine.test.ts | — | **Verified** |
| Manager can invite staff | Product spec | create_invite RPC + Settings Team | create_invite_test.sql | Blocked by OwnerRoute | **Partially verified** — UI route gap |
| Email sent on team invite | Product spec | send-invite edge only | — | Prod incident Jul 2026 | **Partially verified** — legacy path breaks |
| Migration filenames = prod ledger | MARGIN6_DEPLOY_RECONCILIATION | Drift documented | — | Conversation | **Contradicted** for invite migrations |
| ESLint blocks bad code | — | 180 errors, exit 0 | — | — | **Contradicted** — ineffective gate |
| strict TypeScript | — | strict: false | tsc passes | — | **Contradicted** |
| 601 unit tests pass | This audit | vitest | npm run test exit 0 | — | **Verified** |
| E2E suite runs green without env | — | test.skip without auth | Not run | — | **Environment-dependent** |

---

## Documentation Inventory (Key)

| Document | Purpose |
|----------|---------|
| `docs/role-permission-matrix.md` | UI vs RLS gap analysis |
| `docs/kpi-definitions.md` | KPI registry |
| `docs/architecture/t0-0-kpi-trust-matrix.md` | Trust design |
| `MARGIN6_MASTER_STATUS.md` | Handoff status (Jul 2026) |
| `MARGIN6_DEPLOY_RECONCILIATION.md` | Prod vs repo drift |
| `docs/completed/s0-*` | Security fix summaries |

---

## Items Requiring Human Confirmation

1. Exact production migration ledger vs repo filenames
2. Whether Jun 2026 RLS fixes are all applied on prod
3. Current active pilot restaurants and their data shape
4. Resend domain deliverability (hello@margin6.com)
5. Whether invoice >5% price confirm crash still reproduces on prod
