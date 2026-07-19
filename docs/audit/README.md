# Margin6 / RestaurantIQ — Read-Only Implementation Audit

> **Type:** Read-only architecture & code audit. **No application code, migrations, or schema were modified.** Only these documentation files were added.
> **Method:** Every statement is derived from the *implementation* (source, SQL migrations, Supabase generated types, edge functions, tests) — not from the README or marketing docs. Claims that could not be verified from code are explicitly marked `NOT VERIFIED`.
> **Product name note:** The repository, package (`package.json` `name: "margin6"`) and UI brand the product **"Margin6"**. The workspace/product rules call it **"RestaurantIQ"**. They are the same application; this audit uses **Margin6** because that is what the code says.
> **Audit date basis:** Codebase as committed on branch `main` at audit time. Latest migration `20260711000001`.

## Repository at a glance (verified counts)

| Metric | Value | Source |
|---|---|---|
| SQL migrations | 131 | `supabase/migrations/*.sql` |
| Supabase Edge Functions | 12 (+6 `_shared` modules) | `supabase/functions/*` |
| Public DB tables | ~60 | `src/integrations/supabase/types.ts`, `supabase/migrations/*` |
| RPC / DB functions (public) | ~52 SECURITY DEFINER + helpers | migrations + types |
| React pages | 37 | `src/pages/**` |
| Domain logic files | 73 | `src/domain/**` |
| Custom hooks | 22 | `src/hooks/*` |
| shadcn/ui primitives | 46 | `src/components/ui/*` |
| Vitest unit-test files | 58 | `src/test/*`, `src/lib/*.test.*` |
| Playwright E2E specs | 13 | `tests/e2e/*.spec.ts` |

## Documents

| # | Document | Covers (audit phases) |
|---|---|---|
| 00 | [Executive Summary](./00-executive-summary.md) | Overall verdict, headline findings |
| 01 | [Architecture Guide](./01-architecture-guide.md) | Repository overview + layered architecture (Phases 1–2) |
| 02 | [Feature Inventory](./02-feature-inventory.md) | Every feature, status, gaps (Phase 3) |
| 03 | [Workflow Documentation](./03-workflow-documentation.md) | Every user workflow end-to-end (Phase 4) |
| 04 | [Business Rules Catalog](./04-business-rules-catalog.md) | Every business rule / formula (Phase 5) |
| 05 | [Database Documentation](./05-database-documentation.md) | Tables, RPCs, triggers, indexes, storage (Phase 6) |
| 06 | [Security Audit](./06-security-audit.md) | Auth, RLS, RPC, edge, isolation (Phase 7) |
| 07 | [API & RPC Documentation](./07-api-and-rpc-documentation.md) | Data-access patterns + every RPC (Phase 9) |
| 08 | [Edge Function Documentation](./08-edge-function-documentation.md) | Every edge function (Phases 9–10) |
| 09 | [Technical Debt Report](./09-technical-debt-report.md) | Ranked debt (Phase 12) |
| 10 | [Production Readiness Report](./10-production-readiness-report.md) | Scored 1–10 per category (Phase 11) |
| 11 | [Missing Features Report](./11-missing-features-report.md) | What is not implemented |
| 12 | [Founder PRD](./12-founder-prd.md) | PRD generated only from verified implementation (Phase 13) |

## How to read this audit

- **Frontend layers (UI route guards, per-location permission flags) are cosmetic** unless a matching server rule exists. Wherever the audit says a control is "UI-only," treat the server (RLS/RPC) as the real gate.
- The historical `docs/role-permission-matrix.md` (dated 2026-06-22) enumerated many `P0` security gaps. **The `s0-*` hardening migrations (20260623–20260624) and later invite RPCs remediated most of them.** This audit documents the *current* post-remediation state and flags what remains.
