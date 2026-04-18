---
name: react-page-refactor-clean-architecture
description: Refactors React pages by extracting domain logic into src/domain, tightening TypeScript types, and splitting oversized components while preserving behavior. Use when refactoring page components, moving business rules out of UI, fixing unsafe types, breaking up large files, or enforcing layered architecture in this codebase.
---

# React page refactor & clean architecture

## When to use

Apply this skill when the work involves:

- Moving logic out of `src/pages/**` (or heavy route components)
- Creating or extending `src/domain/**` modules
- Replacing `any`, unsafe casts, or duplicated calculations
- Splitting a component that is hard to reason about or test
- Aligning code with a clear **data → domain → UI** boundary

## Layering model

Classify code before moving it:

| Layer | Belongs in | Examples |
|-------|------------|----------|
| Data access | Hooks/services near Supabase | Queries, realtime subscriptions, auth context |
| Commands / mutations | Hooks or thin `src/domain/*` orchestrators | Approve count, post invoice, create PO |
| Domain rules | `src/domain/<area>/` | Inventory math, pricing rules, alert thresholds, pure transforms |
| Presentation | Components under `src/components`, pages under `src/pages` | Layout, forms, tables, loading/error UI |

**Rule:** Pages render UI and call hooks/selectors/commands. They do not own core business rules if those rules are reusable or test-worthy.

## Refactor workflow (in order)

1. **Understand behavior** — Identify inputs, outputs, side effects, and invariants. Do not change product behavior unless the task says so.
2. **Name the root cause** — e.g. duplicated formula, untyped API row, god component.
3. **Smallest safe step** — Extract one function or one hook boundary before large rewrites.
4. **Extract domain first** — Pure functions and single-source-of-truth calculations go to `src/domain/<area>/`.
5. **Split UI second** — Extract presentational pieces (list row, modal, filter bar) with explicit props; avoid prop drilling explosions; prefer composition.
6. **Types** — Narrow types at boundaries (Supabase generated types, `Pick<>`, discriminated unions). Prefer inference; avoid `any` and avoid silencing ESLint.
7. **Verify** — Run typecheck/lint on touched files. Call out regression risks (especially money and inventory).

## Domain extraction checklist

- [ ] Logic is deterministic or clearly documents non-determinism (e.g. “now” only at the edge).
- [ ] One source of truth per calculation — no copy-paste variants across pages.
- [ ] Names reflect business language (count, par, variance, last paid cost), not widget names.
- [ ] Multi-tenant and id rules respected (e.g. `catalog_item_id` over raw names where the schema expects it).

## TypeScript guidelines

- Derive types from Supabase/schema where possible; wrap only at the edge when shapes differ.
- Use `Pick<>`, `Readonly<>`, and small helper types instead of repeating object shapes.
- Replace broad unions with discriminated unions when behavior branches on a `type`/`status` field.
- Do not add `as` casts to silence errors; fix the model or the caller.

## Splitting large components

- **By responsibility:** data container vs dumb view vs form section.
- **By feature slice:** e.g. “line items table”, “totals summary”, “header actions”.
- **Stable props:** prefer explicit interfaces; avoid passing whole app state when a few fields suffice.
- **Files:** new files should have a single obvious purpose; avoid “misc” barrels unless the repo already uses them.

## Guardrails (this product)

- **Stabilization:** avoid new features while refactoring; fix one issue at a time.
- **Do not** rewrite entire files in one pass unless explicitly requested.
- **Do not** put money-critical or inventory-critical rules only inside JSX conditionals.
- **Preserve** existing behavior unless the task changes requirements.

## Done when

- Domain logic lives in `src/domain/*` (or justified exception documented in code review notes).
- Pages/components are thinner and easier to scan.
- Types are stricter at boundaries without eslint suppressions.
- You can state what could regress and how you’d catch it (manual path or test).
