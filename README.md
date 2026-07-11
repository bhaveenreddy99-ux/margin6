# Margin6

Back-of-house operations for **independent restaurant groups** (~2–10 locations): inventory counting, count approval, PAR-based ordering, purchase orders, invoice intake and review, receipt confirmation, waste, alerts, and owner oversight.

**Maturity:** Internal-demo ready. Active work is **trust and workflow repair**, not new product surfaces.

**Canonical agent instructions:** [`AGENTS.md`](AGENTS.md)

---

## Stack

| Layer | Technology |
|-------|------------|
| Frontend | React 18, TypeScript, Vite, Tailwind, shadcn/ui |
| State / data | TanStack Query |
| Backend | Supabase (PostgreSQL, Auth, RLS, Storage, Edge Functions) |
| Tests | Vitest, Playwright |
| Deploy | Vercel (app) + Supabase (data) |

---

## What works (verified in repo audits)

- Auth, signup, password reset
- Restaurant onboarding (`create_restaurant_with_owner`)
- Multi-restaurant and location selection
- Secure invite flow (`restaurant_invites`, `send-invite`, `AcceptInvite`)
- Inventory counting with zones and approval RPC
- Smart order submission → purchase orders
- Invoice intake, review, comparison rows
- Receipt confirmation RPC (Owner/Manager gate)
- Waste log
- Staff dashboard isolation (count-only; money dashboard not loaded for STAFF)
- Large Vitest domain test suite; production build succeeds

See [`docs/status/current-product-status.md`](docs/status/current-product-status.md) for detail and caveats.

---

## Known high-risk gaps (not fixed by README)

- Manager **location isolation** RLS gap on `locations` (fix authored; not production-verified)
- Dashboard **financial KPI trust** (silent `$0`, price double-count, Money Lost mixing time bases)
- **Legacy invite** paths coexist with secure invites; production has rows in both systems
- **GitHub ↔ Supabase** migration ledger timestamp drift and possible edge-function drift
- Manager **cost permissions** enforced in UI more than in API responses
- Playwright **not fully in CI**

See [`docs/status/known-blockers.md`](docs/status/known-blockers.md).

---

## Explicit non-goals

POS, recipes, menu profitability, theoretical food cost, payroll, scheduling, full accounting, and **trusted** Food Cost / P&L / Money Lost KPIs for the current pilot scope.

Full list: [`docs/product/non-goals.md`](docs/product/non-goals.md)

---

## Local setup (safe)

```bash
# Prerequisites: Node 20+, Supabase CLI, Docker (for local Supabase)

npm install
supabase start
bash scripts/local/export-local-env.sh   # writes .env.local.supabase (gitignored)
npm run dev
```

Optional baseline seed (local only):

```bash
node scripts/local/seed-full-product-baseline.mjs
```

**Do not** point local scripts at production. See `scripts/local/verify-not-production.sh`.

---

## Testing

```bash
npm run test          # Vitest
npm run build         # Production build
npm run typecheck     # TypeScript (may fail on edge-shared imports)
npm run test:e2e:local  # Playwright against local stack (when configured)
```

Run tests after changes; do not trust stale pass counts in old documents.

---

## Source-of-truth hierarchy

1. Live Supabase schema (production)
2. GitHub `main` application code
3. `supabase/migrations/`
4. `docs/status/` and `docs/decisions/`
5. `docs/system-audit/` (dated verifications)
6. `docs/archive/` — **historical only**

Details: [`docs/decisions/0002-source-of-truth-hierarchy.md`](docs/decisions/0002-source-of-truth-hierarchy.md)

---

## Documentation map

| Document | Purpose |
|----------|---------|
| [`AGENTS.md`](AGENTS.md) | Canonical AI/agent instructions |
| [`docs/status/current-product-status.md`](docs/status/current-product-status.md) | What works / partial / unsafe |
| [`docs/status/production-drift.md`](docs/status/production-drift.md) | GitHub vs Supabase drift |
| [`docs/status/known-blockers.md`](docs/status/known-blockers.md) | Repair priority |
| [`docs/system-audit/`](docs/system-audit/) | Dated verification audits |
| [`docs/product/`](docs/product/) | Product definition |
| [`docs/architecture/`](docs/architecture/) | System and data truth |
| [`docs/decisions/`](docs/decisions/) | ADRs |
| [`docs/archive/`](docs/archive/) | Non-authoritative history |

**Deployment runbook:** [`docs/runbooks/deployment.md`](docs/runbooks/deployment.md) (placeholder — requires human approval for prod)

---

## Production warning

**Do not** run `supabase db push`, `migration repair`, or production data changes without explicit review, backup, and staging verification.

See [`docs/status/production-drift.md`](docs/status/production-drift.md).

---

## License / contact

Private repository. Built by Bhaveen Padigapati.
