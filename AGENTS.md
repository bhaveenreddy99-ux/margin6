# Margin6 — Agent instructions (authoritative)

**Product name:** Margin6 (never RestaurantIQ in new work)  
**Read this file first.** All AI agents, Cursor rules, and thin pointer files defer here.

---

## Product definition

Margin6 is a back-of-house operations platform for **independent restaurant groups (~2–10 locations)**.

**Core workflow:** Count → Review/Approve → Smart Order → Purchase Order → Invoice → Receipt → Dashboard/Alerts

**Stack:** Vite, React 18, TypeScript, Supabase (PostgreSQL, Auth, RLS, Edge Functions), TanStack Query, Vitest, Playwright.

**Maturity (founder decision):** **Internal-demo ready.** Development is **paused for trust and workflow repair.** Not commercial-ready.

---

## Non-goals (do not build)

- POS, recipes, menu profitability, theoretical food cost
- Payroll, scheduling, full accounting
- Food Cost / Sales / P&L / Money Lost / blended Profit Risk as **trusted pilot KPIs** (outside current trusted scope)
- Manager or employee “full product” dashboards until trust/isolation epics complete

See [`docs/product/non-goals.md`](docs/product/non-goals.md).

---

## Source-of-truth hierarchy

When documents conflict, trust in this order:

1. **Live Supabase schema** (production project `margin6`, ref `ogbnctyctoujzdcfphad`) — for deployed behavior
2. **Current GitHub `main` code** — for application logic
3. **Migrations in `supabase/migrations/`** — for intended schema (may differ from prod ledger timestamps)
4. **Generated types** (`src/integrations/supabase/types.ts`) — may be stale; verify against schema
5. **`docs/status/` and `docs/decisions/`** — current product/status ADRs
6. **`docs/system-audit/`** — verified read-only audits (dated)
7. **`docs/archive/`** — **non-authoritative** history only

**Never trust:** ZIP exports, AI chat summaries, archived docs, code comments, or README marketing copy over code + live schema.

---

## Read-only-first rule

1. **Inspect** code, migrations, policies, tests, and live schema before editing.
2. **Report drift** (GitHub vs Supabase vs docs) before fixing.
3. **One epic → one branch → one PR.** No drive-by changes.
4. **Stop** if a ticket is already implemented — do not rebuild.

---

## Security rules

- **RLS and SECURITY DEFINER RPCs** enforce authorization. Hidden UI is not security.
- Do not **broadly revoke** function grants from advisor warnings alone — verify callers and dependencies.
- Do not **drop legacy tables** until new flows are verified and row counts checked.
- Do not **apply migrations to production** or run `supabase db push` / `migration repair` without explicit human approval.
- **Managers invite STAFF only**, for **assigned locations only**. Managers cannot invite managers or owners.
- **Managers and staff** must not receive **locationless** operational records; null-`location_id` history is **owner-only** until repaired.
- **Receipt confirmation:** Owner/Manager only (current policy).

See [`docs/security/authorization-model.md`](docs/security/authorization-model.md).

---

## Calculation rules

- Business math lives in **`src/domain/*`** or **SQL/RPC** — never inline in React pages.
- Use **`LoadOutcome<T>`** for dashboard loaders — distinguish **error**, **empty**, and **genuine zero**.
- Never render a **failed query** or **missing cost** as a confident `$0`.
- **Latest approved physical count** = current operational on-hand source of truth.
- **Stock movements** = audit ledger until continuous on-hand is explicitly approved.
- **Unit/pack mismatches** must block catalog-cost updates (future repair epic; document, do not silently guess).

---

## Testing rules

- Run **`npm run test`**, **`npm run build`**, and relevant **`npm run test:e2e:*`** before claiming done.
- Add **regression tests** for every security or trust fix.
- Do **not** invent historical test-result files. If evidence is missing, say so.
- Playwright is **not fully in CI** — do not claim full E2E coverage.

---

## Migration and deployment rules

- **Local/staging first.** Production changes require backup, review, and rollback plan.
- **Migration ledger drift** exists (invite timestamps). Do not re-apply equivalent migrations under new version numbers on prod.
- **`supabase migration repair`** is metadata-only — never a substitute for schema review.
- **Edge Functions** deploy separately; GitHub may lag production for `send-invite` and others — see [`docs/status/production-drift.md`](docs/status/production-drift.md).

---

## Documentation authority

| Path | Role |
|------|------|
| `AGENTS.md` | This file — canonical agent instructions |
| `docs/status/` | Current product status, drift, blockers |
| `docs/product/` | Product definition and non-goals |
| `docs/architecture/` | System overview and data truth |
| `docs/security/` | Authorization model |
| `docs/workflows/` | End-to-end workflows |
| `docs/decisions/` | ADRs |
| `docs/system-audit/` | Dated verification audits |
| `docs/archive/` | Historical — **not implementation guidance** |

---

## Before creating anything new

Search the repo for existing tables, RPCs, policies, components, routes, and tests. **Extend** rather than duplicate.

---

## Order record model (founder decision)

**`purchase_orders`** is the **intended authoritative** future order record. Current production behavior may still use **`purchase_history`** and related paths — treat as **documented drift**, not something to “fix” silently in unrelated PRs.

---

## Current repair priority

See [`docs/status/known-blockers.md`](docs/status/known-blockers.md). Trust, tenant isolation, and receipt/count integrity come before new product surfaces.

**No new features** until the active repair epic is approved and complete.
