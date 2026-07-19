# 13 — Product Readiness Scorecard

**Baseline date:** 2026-07-10  
**Evidence mode:** Code audit + unit tests + blocked live tests

---

## Scores

| Area | Score /5 | Evidence | Blockers |
|------|:--------:|----------|----------|
| Repository reproducibility | **5** | npm ci/lint/tc/test/build all pass; CI workflow exists | E2E not in CI |
| Authentication | **3** | Supabase Auth; signup/login routes | Staging verify blocked |
| Tenant isolation | **3** | RLS by restaurant_id; isolation E2E exists | Live attack suite blocked |
| Role authorization | **2** | UI guards + authz tests; multiple API leaks documented | P0 SEC-001–004 |
| Onboarding | **3** | RPC create restaurant; no wizard | Invite path confusion |
| Multi-location behavior | **3** | Context + assignments | Live switch test blocked |
| Inventory setup | **3** | Import + list mgmt | 30-item matrix not seeded |
| Mobile counting | **2** | Responsive UI | No device/interruption tests |
| Count approval | **4** | Atomic RPC + tests | Audit trail live blocked |
| Smart ordering | **3** | Domain tests | Open PO deduction unclear |
| Invoice ingestion | **2** | UI paths | Email/AI infra blocked |
| Invoice review | **4** | Feature module + tests | Cost gate leak |
| Receipt integrity | **3** | RPC idempotency in migrations | No integration test |
| Waste | **3** | Page + loaders | Reconciliation blocked |
| Sales/food cost | **3** | Sales page + food cost loader tests | Closed period blocked |
| Dashboard trust | **4** | LoadOutcome + 601 unit tests | Human audit not run |
| Notifications | **3** | Page + edge function | Spoofing fixes deploy uncertain |
| Audit trail | **3** | Audit Center owner route | Completeness unverified |
| Error recovery | **3** | LoadOutcome pattern | Offline/concurrency weak |
| Observability | **2** | Edge logs via Supabase | No unified runbook |

**Average (weighted toward core loop):** **3.0 / 5**

---

## Final classification

| Gate | Verdict |
|------|---------|
| Ready for internal testing | **Conditionally ready** — engineers can run locally with quality gate green |
| Ready for staging | **Not ready** — staging does not exist |
| Ready for founder-led demo | **Conditionally ready** — happy path on demo data; do not demo invite or STAFF API |
| Ready for design partner | **Not ready** — P0 auth leaks + invite + mobile unproven |
| Ready for paying customer | **Not ready** |
| Ready for broad launch | **Not ready** |

---

## Human usability overall

| Workflow | Score |
|----------|-------|
| Owner onboarding | 3 |
| Manager onboarding | 2 |
| Employee onboarding | 3 |
| Mobile counting | Unable to verify |
| Count approval | 4 |
| Smart ordering | 3 |
| Invoice review | 4 |
| Receipt confirmation | 3 |
| Owner dashboard | 4 |
| Manager dashboard | 3 |
| Employee home | 4 |
| Error recovery | 2 |
| Overall trust | 3 |

---

## What would move the needle fastest

1. Staging environment (DEF-ENV-001)
2. Close P0 RLS/RPC leaks (DEF-SEC-001–004)
3. Unified invite path (DEF-WF-004/005)
4. Manager Team route (DEF-WF-003)
5. Receipt + mobile E2E (DEF-TEST-001/002)
