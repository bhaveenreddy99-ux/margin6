# Local Human + Playwright Baseline Report

**Date:** 2026-07-10

---

## Safety verdict

| Check | Result |
|-------|--------|
| Remote production Supabase touched | **No** |
| Production ref in active test env | **No** (`.env.local.supabase` → `127.0.0.1:54321`) |
| `supabase db reset` target | **Local Docker only** |
| Linked CLI project_id in config.toml | Still production name (container label only); **no remote push** |

---

## Infrastructure

| Step | Result |
|------|--------|
| Docker running | **Yes** |
| `supabase start` | **Yes** — API `http://127.0.0.1:54321` |
| `supabase db reset` | **Yes** — 131 migrations applied |
| Vite against local Supabase | **Yes** — via Playwright webServer + `VITE_*` env |
| Seed Org A + B | **Yes** — `scripts/local/seed-isolation-orgs.mjs` |
| Users created | **7** (`*@example.test`) |

---

## Commands

```bash
# One-time / repeat local baseline
supabase start
bash scripts/local/verify-not-production.sh
supabase db reset                    # LOCAL Docker volume only
bash -c 'source scripts/local/export-local-env.sh && node scripts/local/seed-isolation-orgs.mjs'
bash scripts/local/run-local-e2e.sh
```

Default password: `LOCAL_SEED_DEFAULT_PASSWORD` or `TestPass123!`

---

## Tenant isolation precheck

**PASS — no cross-tenant access observed**

- Owner A cannot read Restaurant B (JWT query → 0 rows)
- Owner B cannot read Restaurant A (JWT query → 0 rows)
- Employee A1 cannot read Org B locations (JWT query → 0 rows)

---

## Playwright three-role workflow

| Role | Browser test | Result |
|------|--------------|--------|
| Owner A | Dashboard + app shell | **Pass** |
| Manager A1 | App shell | **Pass** |
| Employee A1 | Inventory + billing guard | **Fail** (test assumes owner nav) |

---

## Artifacts

- Defect register: `LOCAL_BASELINE_DEFECTS.md`
- Playwright report: `playwright-report/` (after run)
- Generated env: `.env.local.supabase` (gitignored)

---

## Not run (by design)

- Full synthetic catalog / count / invoice workflows
- Edge Function deploy (local runtime stopped)
- Stripe / Resend / Anthropic integration
- Remote staging / production
