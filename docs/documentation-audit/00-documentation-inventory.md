# Documentation inventory

**Audit date:** 2026-07-11  
**Scope:** Repository markdown before source-of-truth reset

---

## Authoritative (post-reset)

| Path | Role |
|------|------|
| `AGENTS.md` | Canonical agent instructions |
| `CLAUDE.md` | Pointer to AGENTS.md |
| `README.md` | Public repo entry |
| `.cursor/rules/*.mdc` | Cursor rules (reference AGENTS.md) |
| `docs/status/` | Current status, drift, blockers |
| `docs/product/` | Product definition, non-goals |
| `docs/architecture/` | System overview, data truth |
| `docs/security/` | Authorization model |
| `docs/workflows/` | Workflow authorities |
| `docs/decisions/` | ADRs 0001–0005 |
| `docs/system-audit/` | Dated verification audits (00–17) |
| `docs/runbooks/deployment.md` | Deployment placeholder |
| `docs/documentation-audit/` | This audit series |

---

## Reference (retained, not primary authority)

| Path | Notes |
|------|-------|
| `docs/testing/` | Test plans and local run evidence — verify dates; some results unavailable |
| `docs/role-permission-matrix.md` | Cross-check against `authorization-model.md` |
| `docs/kpi-definitions.md` | May predate LoadOutcome trust fixes |
| `docs/confidence-scoring.md` | KPI confidence helpers |
| `docs/new-table-checklist.md` | Operational checklist for migrations |
| `docs/email-alerts-setup.md` | Ops setup; contains legacy RestaurantIQ branding |
| `docs/owner-audit-center.md` | Feature notes |
| `docs/qa-universal-count-input.md` | QA notes |
| `SEED_README.md` | Seed script docs |

---

## Archived (non-authoritative)

See [`../archive/README.md`](../archive/README.md):

- `docs/archive/plans/` ← `docs/plans/`
- `docs/archive/investigations/` ← `docs/investigations/`
- `docs/archive/completed/` ← `docs/completed/`
- `docs/archive/restaurantiq/` ← RestaurantIQ plans
- `docs/archive/dashboard-trust/` ← trust roadmaps
- `docs/archive/audits-baseline/` ← `docs/audits/`
- `docs/archive/architecture-legacy/` ← old `docs/architecture/s0-*`, `t0-*`, `phase-3-*`
- `docs/archive/margin6-status/` ← root `MARGIN6_*.md`
- `docs/archive/readiness/` ← readiness scorecards from testing docs

---

## Root-level files (pre-reset)

| File | Disposition |
|------|-------------|
| `MARGIN6_MASTER_STATUS.md` | Archived |
| `MARGIN6_DEPLOY_RECONCILIATION.md` | Archived (superseded by `docs/status/production-drift.md`) |
| `MARGIN6_FIX_PLAN.md` | Archived |
| `.cursor/.cursorrules` | Removed (replaced by `.cursor/rules/`) |

---

## Count summary

| Category | Approx. files |
|----------|---------------|
| Authoritative new/retained | ~35 |
| system-audit (retained) | 18 |
| testing (retained) | ~50 |
| Archived | ~60+ |

Exact counts vary after git mv; use `find docs/archive -name '*.md' | wc -l` after merge.
