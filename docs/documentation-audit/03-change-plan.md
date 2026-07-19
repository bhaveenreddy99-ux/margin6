# Documentation change plan

**Executed in branch:** `docs/margin6-source-of-truth-reset`  
**Date:** 2026-07-11

---

## Phase 1 — Create authorities (this PR)

- [x] `AGENTS.md`, `CLAUDE.md`
- [x] `.cursor/rules/00–40*.mdc`
- [x] Rewrite `README.md`
- [x] `docs/status/*`, `docs/product/*`, `docs/architecture/*`, `docs/security/*`, `docs/workflows/*`
- [x] `docs/decisions/0001–0005`
- [x] `docs/archive/README.md`, `docs/runbooks/deployment.md`
- [x] `docs/documentation-audit/*`

---

## Phase 2 — Archive (this PR)

- [x] Move `docs/plans/`, `investigations/`, `completed/`, `audits/` to `docs/archive/`
- [x] Move RestaurantIQ and dashboard-trust standalone docs
- [x] Move legacy architecture drafts
- [x] Move root `MARGIN6_*.md`
- [x] Move selected readiness docs from testing baseline
- [x] Remove `.cursor/.cursorrules`

---

## Phase 3 — Not in this PR

- [ ] Apply RLS/grant migrations to staging/prod
- [ ] Regenerate Supabase types
- [ ] Fix broken links inside archived bodies (optional; bodies unchanged)
- [ ] Add CI markdown link checker
- [ ] Expand deployment runbook after first approved release

---

## Verification performed

- Grep for RestaurantIQ, Next.js, 3–50, recipe parity in non-archive paths
- `git diff --stat` scoped to docs + cursor + README + AGENTS + CLAUDE
- No code/SQL/migration/test changes

---

## Founder decisions encoded

All 16 founder decisions from the reset brief are reflected in `AGENTS.md`, ADRs, and status docs (see final PR report).
