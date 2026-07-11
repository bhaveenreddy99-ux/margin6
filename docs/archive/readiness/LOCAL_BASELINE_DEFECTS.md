# Local Baseline — Defect Register

**Date:** 2026-07-10  
**Environment:** Local Supabase (`http://127.0.0.1:54321`) + Vite (`http://127.0.0.1:4173`)  
**Production touched:** No  
**Fix policy:** Document only — no fixes applied during baseline

---

## P0 — Security

| ID | Title | Status | Evidence |
|----|-------|--------|----------|
| DEF-LOCAL-SEC-001 | Cross-tenant restaurant read via JWT | **Pass (no defect)** | Owner A SELECT org B → 0 rows; Owner B SELECT org A → 0 rows; Employee A1 SELECT org B locations → 0 rows |

---

## P1 — Test infrastructure / selectors

| ID | Title | Severity | Status | Evidence |
|----|-------|----------|--------|----------|
| DEF-LOCAL-E2E-001 | `auth.smoke` expects sidebar link `/dashboard/i` but UI uses **Overview** | P2 | Confirmed | Playwright: link not found; `three-role-local` Owner A passes using `expectAppShell` |
| DEF-LOCAL-E2E-002 | `navigation.smoke` same stale dashboard link selector | P2 | Confirmed | Timeout clicking dashboard link |
| DEF-LOCAL-E2E-003 | `loginIfNeeded` assumes full owner shell for all roles | P1 | Confirmed | Employee A1 login fails at `list management` sidebar expectation |

---

## P2 — Role / UX (product behavior observed, not fixed)

| ID | Title | Severity | Status | Evidence |
|----|-------|----------|--------|----------|
| DEF-LOCAL-ROLE-001 | Employee STAFF sidebar may differ from owner/manager shell | P2 | Suspected | Employee test fails before billing check; owner/manager pass |
| DEF-LOCAL-ROLE-002 | Billing route guard for STAFF not verified | P2 | Blocked | Blocked by DEF-LOCAL-E2E-003 |

---

## P2 — Local environment gaps

| ID | Title | Severity | Status | Evidence |
|----|-------|----------|--------|----------|
| DEF-LOCAL-ENV-001 | `.env.local` still points at production ref | P1 | Confirmed | Warning from `verify-not-production.sh`; mitigated by `.env.local.supabase` |
| DEF-LOCAL-ENV-002 | Edge Functions local runtime stopped | P2 | Not run | `supabase status` lists edge runtime stopped; invite/email/parse not exercised |
| DEF-LOCAL-ENV-003 | Stripe / Anthropic / Resend not configured locally | P2 | By design | External services mocked/disabled unless keys set |
| DEF-LOCAL-ENV-004 | Docker required; cold start ~30s+ | P3 | Confirmed | Initial `supabase start` wait |

---

## Database verification (post-seed)

| Check | Expected | Actual |
|-------|----------|--------|
| Migration ledger | 131 | **131** |
| RLS policies (public) | >0 | **204** |
| RPC `create_restaurant_with_owner` | exists | **yes** |
| RPC `approve_inventory_session_atomic` | exists | **yes** |
| RPC `submit_smart_order` | exists | **yes** |
| RPC `confirm_invoice_receipt` | exists | **yes** |
| RPC `get_invite_preview` | exists | **yes** |
| Restaurants | 2 | **2** |
| Auth users | 7 | **7** |
| Cross-tenant JWT reads | 0 rows | **0 rows** |

---

## Playwright summary

| Suite | Pass | Fail |
|-------|------|------|
| Tenant isolation (API) | 3 | 0 |
| Three-role (browser) | 2 | 1 |
| auth.smoke | 0 | 1 |
| navigation.smoke | 0 | 1 |
| **Total** | **5** | **3** |

---

## Readiness

| Gate | Result |
|------|--------|
| Tenant isolation precheck | **PASS** |
| Full synthetic seed (30+ items, workflows) | **Not run** (per instruction) |
| Three-role browser baseline | **Partial** (owner + manager pass) |
| Production safety | **PASS** (no remote mutations) |

---

## Recommended next steps (not executed)

1. Update smoke specs to use `Overview` / `expectAppShell` pattern
2. Add role-aware login helper (skip owner-only nav for STAFF)
3. Run full seed + invoice/count workflows on local only
4. Start local edge runtime if testing invites/parse
