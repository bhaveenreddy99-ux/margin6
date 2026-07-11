# ADR 0002 — Source-of-truth hierarchy

**Status:** Accepted (2026-07-11)

## Context

GitHub, Supabase production, migration ledger timestamps, generated types, and dozens of markdown docs frequently disagree.

## Decision

Trust order:

1. Live Supabase schema (read-only verification)
2. GitHub `main` code
3. `supabase/migrations/`
4. Generated types (verify; may be stale)
5. `docs/status/`, `docs/decisions/`
6. `docs/system-audit/` (dated)
7. `docs/archive/` — **never** for implementation guidance

ZIPs, AI summaries, and archived plans are **not** sources of truth.

## Consequences

- Agents must inspect before editing and report drift.
- No `supabase db push` / `migration repair` to prod without human review.
- [`docs/status/production-drift.md`](../status/production-drift.md) maintained for known gaps.

## Not in this PR

No migration repair or type regeneration.
