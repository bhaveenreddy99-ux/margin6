# Plan — T0-5: Consistent KPI loading / error-handling architecture

> **Date:** 2026-06-23 · **Status:** Recommended — **awaiting approval; nothing implemented.**
> **Investigation:** [t0-5-kpi-error-handling.md](../investigations/t0-5-kpi-error-handling.md) · **Builds on:** T0-4 (`9083205`).
> **Effort key:** S ≤ 0.5d · M = 1–2d · L = 3–5d.

## 1. Root cause (one line)

*Empty and error are conflated* at two layers — loaders swallow query errors into `0`/`[]` (ignoring Supabase's `error`), and self-fetching cards have no `catch`/error state — so a failed load renders "all clear" (or stale) as a verified zero.

## 2. Goal & invariant

Establish one rule, enforced structurally so it can't recur: **failure ≠ zero.** Every KPI surface resolves to exactly one of four *visually distinct* states — **Loading · Error (+Retry) · Empty (verified none) · Data** — and a failed load never renders `$0`, "all clear," a value, or a confidence badge.

## 3. Architecture (the single pattern)

### 3a. Loader contract — stop swallowing (Group A)
Loaders must **distinguish empty from error**. Two acceptable forms (pick one project-wide — recommend **throw**, since `useDashboardData`'s catch + T0-4 already handle throws):
- **Throw:** replace `const { data } = await q; …(data ?? [])` with `const { data, error } = await q; if (error) throw error; …(data ?? [])`. Replace `return 0` / `catch {}` swallows with rethrow (or a typed error).
- **Result:** `type Result<T> = { ok: true; data: T } | { ok: false; error: Error }`. More explicit but touches more call sites.

**Effect:** a partial failure now propagates → `useDashboardData`'s catch fires → T0-4's snapshot-reset + Dashboard error gate engage → the **main dashboard** stops silently zeroing. (This is the highest-leverage change.)

### 3b. One async hook (Group B, layer 1)
A generic `useKpiResource<T>(fetcher, deps): { data, loading, error, refetch }` (mirrors `useDashboardData`'s shape: load → success(setData,clearError) → catch(setError) → finally(setLoading)). Self-fetching cards use it instead of hand-rolled `try/finally`. *(Alternative: fold the two cards into the centralized `useDashboardData` snapshot — cleaner long-term, but the snapshot must carry per-section error + the cards need their own drill-down rows, so a shared hook is the pragmatic first step.)*

### 3c. One card-state wrapper (Group B, layer 2)
`<KpiCardState loading={…} error={…} isEmpty={…} onRetry={…} emptyLabel={…}>{data UI}</KpiCardState>` renders:
- `loading` → skeleton (existing).
- `error` → explicit message + **Retry** button (mirrors the shipped AuditCenter error UI). **Never** a value/badge.
- `isEmpty` → the *verified* empty copy ("No price hikes detected") — only reachable when the load **succeeded** with zero rows.
- else → the data UI.

This makes "empty" and "error" structurally separate, so the all-clear copy can only appear on a successful empty load.

## 4. Migration strategy (phased, low-risk)

| Phase | Work | Effort |
|-------|------|:------:|
| **P1 — Loaders stop swallowing** (Group A) | Add `error` checks/throws to `loadShrinkageValue`, `loadProfitLeaks`, `loadPriceIncreaseAlertRows`, `loadFoodCostMetrics`, and the `?? []` loaders. Verify `useDashboardData` catch now fires on partial failure (regression: real-empty still → `0`/`[]`, not error). | **M** |
| **P2 — Shared primitives** | Add `useKpiResource` hook + `KpiCardState` wrapper (+ unit tests). | **S–M** |
| **P3 — Self-fetching cards adopt them** (Group B) | Migrate `PriceHikeAlertsCard`, `ShrinkageAlertCard`, and the `ProfitRiskWidget` drill-down to the hook + wrapper; add error+retry; clear stale rows on refetch. | **M** |
| **P4 — Guard against recurrence** | A lint rule / test asserting no dashboard card renders an empty/zero state without an `error` branch; document the contract. | **S** |

Each phase is independently shippable and reversible. P1 alone removes the systemic Critical-1; P3 removes the visible Critical-2.

## 5. Test strategy

- **Loaders (unit):** mock the Supabase client to return `{ data: null, error }` → assert the loader **throws** (or returns `{ok:false}`), and `{ data: [], error: null }` → returns empty **without** error. (Pins empty ≠ error.)
- **`useKpiResource` (renderHook):** loading → success → first-load failure (error set, data empty) → retry success → retry failure. Mirrors the T0-4 hook tests.
- **Cards (RTL):** for each card — (a) success-with-rows → list; (b) success-empty → "none detected"; (c) **failure → error + Retry, no `$0`, no "all clear," no list**; (d) failure-after-success → no stale rows; (e) retry. Reuse the AuditCenter test harness/mocks from T0-4.
- **Regression:** full `vitest` + `tsc` green; the centralized Dashboard/Audit paths still behave (T0-4 unaffected).

## 6. Risks

| # | Risk | Mitigation |
|---|------|-----------|
| R1 | **Throwing loaders surface previously-hidden errors** → cards/Dashboard now show error states that were silently zero before | Intended (that's the fix); verify real-empty still resolves to `0`/`[]` not error; roll out P1 behind the existing T0-4 error UI |
| R2 | **`useDashboardData` is the deprecated-comment hook** (corrected in T0-4) and feeds Audit + Dashboard + PublicDemo | P1 makes its catch fire more often → confirm Dashboard's error gate + PublicDemo behave (PublicDemo has no error gate — may need one, scope-flag) |
| R3 | **Over-eager error state** (a benign null treated as error) | only treat the Supabase `error` field as error; `data: []`/`null` with no error = empty |
| R4 | **Scope creep across ~10 loaders** | phase it; P1 can target the 3 KPI-card loaders first (shrinkage/price/profit-leaks), then the rest |
| R5 | **Drill-down (ProfitRiskWidget) is secondary** | include in P3 but lower priority than the two headline cards |

## 7. Rollback
Each phase is additive/behavioral and touches no data. Revert the phase's commit; loaders return to swallowing (re-opens the silent-zero) — prefer a forward fix. No migration, no schema, nothing to backfill.

## 8. Effort estimate
P1 **M** · P2 **S–M** · P3 **M** · P4 **S** → **~3–5 dev-days** total; the systemic Critical-1 lands in P1 (~1–2 days).

## 9. Relationship to other items
- **Completes T0-4:** same "failure ≠ zero" rule, applied to the loader layer (partial failures) and the self-fetching cards — the cases T0-4 structurally could not reach.
- **Feeds T0-0 registry rule 4** ("Failure ≠ zero") — this is its enforcement.
- **Unblocks honest Shrinkage/Price cards** ahead of T0-7/T0-3 (a card that errors honestly is safe to show even before its formula is finalized).

> No application code, loader, card, or formula was modified in producing this plan.
