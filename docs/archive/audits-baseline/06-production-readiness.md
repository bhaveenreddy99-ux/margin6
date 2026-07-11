# Production Readiness Audit

**Date:** 2026-07-10  
**Mode:** Read-only (repo + documented prod incidents; live prod not fully audited this session)

---

## Deployment Topology

| Component | Target | Config evidence |
|-----------|--------|-----------------|
| Frontend | Vercel | `vercel.json`, package deploy script |
| API/DB | Supabase | `supabase/config.toml` project_id |
| Email | Resend via `send-email` edge | `supabase/functions/send-email/index.ts` |
| Payments | Stripe | `create-checkout-session`, `stripe-webhook` |
| Cron | pg_cron → `process-notifications` | Migration `20260522000003` |

---

## CI/CD

**Status:** **Not ready** — no GitHub Actions workflows (Confirmed: no `.github/workflows/`).

Implications:
- No automated lint/test/build on PR
- No migration apply verification in pipeline
- Deploy relies on manual Vercel + Supabase CLI

---

## Environment Separation

| Env | Evidence |
|-----|----------|
| Local | `.env.local`, `.env.example` (VITE_SUPABASE_*) |
| Staging | **Not verifiable from repo** |
| Production | margin6.com, Supabase project in config |

---

## Observability

| Capability | Status |
|------------|--------|
| Structured logging | Minimal — `console.error` in edge functions |
| Error tracking (Sentry etc.) | **Not found** |
| Correlation IDs | **Not found** |
| Supabase edge logs | Available via dashboard/MCP (ops tool) |
| Audit logs | Owner Audit Center UI + DB tables partial |
| Health checks | **Not found** |
| Incident runbook | Partial in docs/ |
| Feature flags | **Not found** |

---

## Secret Hygiene (paths only — no values)

| Path | Type | Action |
|------|------|--------|
| `.env.local` | Supabase/Stripe keys | gitignore; rotate if leaked |
| `supabase/.temp/` | CLI artifacts | gitignore recommended |
| `playwright/.auth/user.json` | Session state | gitignore; may contain tokens |
| `seed-test-data.js` | Test seed script | Review before prod use |

---

## Production Incidents (Documented Jul 2026)

1. **Invite email not sent** — legacy `invitations.insert` from cached pre-deploy JS (Confirmed in conversation + DB)
2. **Cancel legacy invite fails** — unique constraint on `(restaurant_id, email, status)` (Confirmed)
3. **Migration ledger drift** — repo filenames ≠ prod applied versions for invite RPCs (`MARGIN6_DEPLOY_RECONCILIATION.md`)
4. **Manager cannot reach Settings** — Team UI behind OwnerRoute (Confirmed `App.tsx`)

---

## Readiness Verdicts

| Stage | Verdict |
|-------|---------|
| Local development | **Ready** — build + 601 tests pass |
| Staging | **Unable to verify** |
| Design-partner pilots | **Conditionally ready** — after invite flow + cancel fix deployed |
| Paying customers | **Not ready** — CI absent, legacy invite paths, permission UI/API gaps |
| Broad production launch | **Not ready** |

---

## Rollback

- Vercel: deployment history (ops)
- Supabase migrations: forward-only; rollback requires manual SQL
- No documented rollback playbook in repo
