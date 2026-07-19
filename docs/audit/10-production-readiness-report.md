# 10 — Production Readiness Report (Phase 11)

Each category scored **1–10** (10 = production-excellent) with reason, risk, and recommendation. Scores reflect the *current* codebase.

| # | Category | Score | Reason (verified) | Risk | Recommendation |
|---|---|:--:|---|---|---|
| 1 | **Architecture** | 8 | Clean layering; real domain extraction; typed Supabase client; role-adaptive routing; lazy loading + vendor chunking. | Mega-pages + domain-layer I/O blur boundaries. | Extract logic from 1000+ LOC pages per the in-repo skill. |
| 2 | **Scalability** | 6 | Postgres + PostgREST scales; indexes on hot paths. But dashboard/portfolio do N+1-style nested reads client-side and in `portfolio-dashboard`. | KPI/portfolio loads degrade with data volume. | Push aggregation into SQL views/RPCs; paginate. |
| 3 | **Performance** | 6 | Lazy routes, manual chunks, ref caching, `refetchOnMount:false`. | No real query cache (TanStack unused); repeated full-table reads; large bundles (1.8k-LOC pages). | Adopt actual query caching or server aggregation; code-split mega-pages. |
| 4 | **Maintainability** | 7 | Strong domain conventions, tests for logic, documented rules, skill file. | Oversized files, dead/legacy code, 3 invite systems, disabled unused-vars lint. | Retire legacy paths; enforce file-size + lint discipline. |
| 5 | **Testing** | 5 | 58 vitest (good pure-logic coverage), 13 Playwright specs incl. isolation + "human audit" harness. | No RLS/RPC write-path authorization tests; write paths under-tested. | Add RLS/authorization integration tests (pgTAP + API-level). |
| 6 | **Security** | 6 | RLS everywhere; RPCs hardened (June wave); edge auth present. | UI-only permission flags; `is_member_of` writes; anon definer grants; no rate limiting. | Execute Security §Recommendations 1–6. |
| 7 | **Observability** | 2 | Essentially none — console logs only. | Blind to prod errors/failures; silent best-effort writes. | Wire error tracking + structured edge logging + uptime checks. |
| 8 | **Error handling** | 6 | Root + dashboard error boundaries; loud-fail KPIs; toasts. | Many edge/hook writes ignore errors; inbound email drops silently. | Check + surface write errors; dead-letter inbound failures. |
| 9 | **Recovery / DR** | 4 | Supabase managed backups (assumed, NOT VERIFIED); atomic approval RPC. | No documented backup/restore/runbook; partial-seed risk on restaurant creation. | Document backup/restore + idempotent seeding; wrap multi-step flows in RPCs. |
| 10 | **Logging** | 3 | `console.*` in edge functions; some verbose (payload/attachment). | Sensitive-data leakage; not aggregated/searchable. | Central log drain + redaction. |
| 11 | **Monitoring** | 2 | No metrics/alerting/tracing found. | No SLOs, no cron-failure alerts. | Add metrics + cron heartbeat alerting. |
| 12 | **Deployment** | 7 | Vercel SPA + Supabase migrations + edge functions; sitemap; env template. | No CI/CD pipeline config found in repo; per-function `verify_jwt` deploy drift risk; two functions absent from `config.toml`. | Add CI (build/lint/test/migration-check) + deploy guards. |
| 13 | **Documentation** | 7 | Rich `docs/` (design, investigations, KPI defs, role matrix) + this audit. | Some docs stale vs implementation (role matrix pre-hardening; README claims). | Keep docs implementation-synced; mark stale ones. |
| 14 | **Configuration** | 6 | Clear env template; per-function config; feature flags. | Anon key + project ref committed in `.env.example` (anon key is public, acceptable); billing enforcement flag off; secrets rely on deploy env. | Document required secrets; verify `verify_jwt` invariants in CI. |
| 15 | **Technical debt** | 6 | Managed via `docs/` trackers; hardening executed. | Enforcement/structure/observability debt remains (see [09](./09-technical-debt-report.md)). | Burn down C1/C2/H1–H3 first. |

## Weighted verdict
**Overall ≈ 5.5 / 10 — "advanced beta / demo-grade, not yet production-hardened SaaS."**

- **Green to ship for demos and design partners:** architecture, features, data model, and core workflows are solid and coherent.
- **Must-fix before broad multi-tenant production launch:**
  1. **Authorization parity** (make RLS/RPC enforce the UI's intent; lock anon grants).
  2. **Observability** (error tracking + logging + cron alerting).
  3. **Write-path/RLS tests**.
  4. **CI/CD + deploy guards** for `verify_jwt` and migrations.
  5. Then **enable billing enforcement**.

## Production-readiness gates (checklist)
- [ ] RLS write policies match UI permissions (incl. location scoping).
- [ ] Anon `EXECUTE` revoked on definer functions (except `get_invite_preview`).
- [ ] Rate limiting on public/AI endpoints; PDF size cap.
- [ ] Error tracking + structured logging live.
- [ ] Cron heartbeat + failure alerting.
- [ ] RLS/authorization integration test suite green in CI.
- [ ] Backup/restore runbook documented.
- [ ] `verify_jwt` per-function verified in deploy pipeline.
- [ ] Legacy invite/recipe/category code retired.
- [ ] Billing enforcement flag flipped with a real launch cutoff.
