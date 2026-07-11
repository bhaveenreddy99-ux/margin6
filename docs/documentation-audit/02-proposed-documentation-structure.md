# Proposed documentation structure

**Status:** Implemented by source-of-truth reset PR (2026-07-11)

---

## Top level

```text
AGENTS.md              ← canonical agent instructions
CLAUDE.md              ← pointer only
README.md              ← public entry, honest maturity
.cursor/rules/*.mdc    ← Cursor (reference AGENTS.md)
```

---

## docs/

```text
docs/
├── status/                 ← CURRENT: product status, drift, blockers
├── product/                ← CURRENT: definition, non-goals
├── architecture/           ← CURRENT: overview, data truth
├── security/               ← CURRENT: authorization
├── workflows/              ← CURRENT: end-to-end workflows
├── decisions/              ← ADRs
├── system-audit/           ← Dated verification audits
├── runbooks/               ← deployment placeholder
├── documentation-audit/    ← meta audit (this series)
├── testing/                ← test plans & evidence (dated)
├── archive/                ← NON-AUTHORITATIVE history
└── [reference *.md]        ← checklists, KPI defs (secondary)
```

---

## Principles

1. **One canonical agent file** (`AGENTS.md`).
2. **Status** separated from **architecture** and **history**.
3. **Archive everything** that contradicts or predates system-audit without deleting.
4. **No duplicate** product scope in Claude/Cursor long-form rulebooks.

---

## Not included

- Auto-generated API docs (future)
- User-facing help center (future)
