# 14 — Development Gap Roadmap

**Baseline date:** 2026-07-10  
**Principle:** Smallest targeted tickets; no broad rewrites

---

## Phase 0 — Environment (blocks all product testing)

### TICKET-ENV-1: Provision staging stack

| Field | Value |
|-------|-------|
| Defects | DEF-ENV-001 |
| Business reason | Safe E2E and human testing |
| Dependencies | None |
| Allowed files | Infra docs, CI secrets, seed scripts |
| Prohibited | Production data copy with PII |
| Acceptance | Staging URL + Supabase project; synthetic orgs A/B |
| Migration | Apply full ledger to staging |
| Deploy | Staging Vercel preview |
| Rollback | N/A |

### TICKET-ENV-2: Seed orgs A/B + 30-item matrix

| Defects | — |
| Script | New `scripts/seed-test-orgs-ab.ts` |
| Acceptance | All users in §2 can log in; reconciliation anchor data present |

---

## Phase 1 — P0 security and data integrity

### TICKET-SEC-1: Fix STAFF session DELETE RLS

| Defects | DEF-SEC-001 |
| Allowed | `supabase/migrations/*` (new migration only) |
| Prohibited | Weakening approved immutability |
| Invariant | Approved sessions immutable |
| Tests | Extend `authz-parity.test.ts`; SQL test |
| Deploy | Supabase migration required |

### TICKET-SEC-2: Verify/deploy smart order + receipt RPC enforcement

| Defects | DEF-SEC-002, DEF-SEC-003 |
| Allowed | migrations, RPC definitions |
| Tests | authz-parity against staging |
| Rollback | Previous RPC version restore |

### TICKET-SEC-3: Fix purchase_history_items RLS

| Defects | DEF-SEC-004 |

### TICKET-SEC-4: parse-invoice auth hardening

| Defects | DEF-SEC-006 |
| Allowed | `supabase/functions/parse-invoice` |
| Tests | `parse-invoice-auth` tests in CI |

### TICKET-SEC-5: Retire or lock legacy invitations

| Defects | DEF-SEC-007, DEF-WF-004, DEF-WF-005 |

---

## Phase 2 — P1 core-loop blockers

### TICKET-WF-1: Manager Team route (not OwnerRoute)

| Defects | DEF-WF-003 |
| Allowed | `src/App.tsx`, Settings split, minimal route guard |
| Prohibited | Rewriting Settings.tsx entirely |
| Tests | E2E manager invite |

### TICKET-WF-2: Single invite path enforcement

| Defects | DEF-WF-005, DEF-WF-006 |
| Allowed | `useLocationSettings.ts`, remove legacy INSERT paths |
| Tests | SQL invite tests + E2E accept-invite |

### TICKET-FIN-1: Price increase deduplication audit

| Defects | DEF-FIN-001 |
| Allowed | `src/domain/dashboard/*` |
| Tests | Reconciliation test with fixture notifications + comparisons |

### TICKET-UI-1: Gate invoice costs on can_see_costs

| Defects | DEF-UI-001 |
| Allowed | `Invoices.tsx`, comparison table |
| Consider | Server field policy long-term |

---

## Phase 3 — CI and test coverage

### TICKET-TEST-1: Add staging E2E to CI

| Defects | DEF-TEST-003 |
| Acceptance | 129 tests run against staging; fail on skip |

### TICKET-TEST-2: Receipt idempotency integration test

| Defects | DEF-TEST-001 |

### TICKET-TEST-3: Mobile interruption E2E

| Defects | DEF-TEST-002 |
| Allowed | Playwright mobile project |

### TICKET-TEST-4: Add `npm run test:integration`

| Scope | RPC + RLS smoke against local/staging Supabase |

---

## Phase 4 — P1 authorization depth

### TICKET-SEC-6: Enforce location permission flags server-side

| Defects | DEF-SEC-005 |
| Options | RLS helper reading `user_location_assignments` OR RPC checks |
| Prohibited | UI-only fix alone |

---

## Phase 5 — P2 usability (post design-partner)

- Manager ops dashboard (worklist vs financial wall)
- Onboarding checklist wizard
- Open PO deduction visibility in smart order UI
- Approved page persist suggested order edits (if intended)

---

## Dependency graph

```
ENV-1 → ENV-2 → all live tests
SEC-1..5 → design partner gate
WF-1, WF-2 → manager self-service
TEST-1..4 → regression safety
SEC-6 → enterprise permission trust
```

---

## Design partner minimum bar

Before **one** design-partner restaurant:

1. Staging + seed complete
2. All P0 SEC tickets deployed to production
3. Invite flow unified and verified end-to-end
4. Receipt idempotency test green
5. One full core loop documented on staging with reconciliation sheet signed
6. Tenant isolation live test pass (A vs B)

**Estimated critical path:** Environment → P0 security deploy verification → invite fix → mobile count smoke → design partner

---

## Explicitly deferred (post-pilot)

- Catch-weight items
- ACCOUNTANT role
- Heavy analytics / POS
- Broad Settings.tsx refactor
- Edge function lint cleanup (68 errors excluded)
