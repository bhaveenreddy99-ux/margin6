# Plan — T0-4: Audit Center error state (never render `$0` on load failure)

> **Date:** 2026-06-23 · **Status:** Recommended — awaiting approval; **nothing implemented**.
> **Investigation:** [t0-4-audit-center-error-state.md](../investigations/t0-4-audit-center-error-state.md). No code, no migration, no commit.

## 1. Root cause (one line)

`useDashboardData` keeps its **all-zero default snapshot** on error (catch sets `error` only, never resets the snapshot — `useDashboardData.ts:208-209` + `:31-60`), and the **Audit Center ignores `error`** with no error branch (`AuditCenter.tsx:60, 267`), so `fmtMoney(0)` renders **`$0`** for every KPI with confidence badges when the load fails.

## 2. Goal & success criteria

The trust page must **never present unverified numbers**. Done when:
- On a load **error**, the Audit Center renders an **explicit error state + Retry**, and renders **no** KPI values, **no** confidence badges, **no** data-quality score.
- On **success**, behavior is unchanged.
- On a **refetch-after-success failure**, the page shows the error state (not stale last-good values dressed as current).
- The misleading `// DEPRECATED: Not used` hook comment is corrected.
- CI green (tsc + vitest); a regression test pins "error ⇒ no `$0`, no badges."

## 3. Recommended fix (minimal, mirrors the working Dashboard pattern)

**Primary — Audit Center consumes the error (the actual T0-4 fix):**
- Stop discarding the error/refetch at [AuditCenter.tsx:60](../../src/pages/app/settings/AuditCenter.tsx#L60): destructure `error` and `refetch` for real.
- Add an `if (error)` branch **after** the `if (loading)` guard ([:267](../../src/pages/app/settings/AuditCenter.tsx#L267)) and **before** building/rendering `rows`, mirroring [Dashboard.tsx:1463](../../src/pages/app/Dashboard.tsx#L1463): an `AlertTriangle` + "Audit data couldn't load" + **Retry** button wired to `refetch`. Return early — do not render the table, DataQualityBanner, or score.
- (Optional polish) move/guard the `rows`/`moneyLostTotal`/`quality` computation so they aren't computed from a failed snapshot — not strictly required once the early return is in place, but cleaner.

**Defense-in-depth (recommended, in the shared hook — protects all 3 consumers):**
- In `useDashboardData`'s catch ([:208-209](../../src/hooks/useDashboardData.ts#L208)), **reset `setSnapshot(DEFAULT_SNAPSHOT)`** on error so a stale/zero snapshot can never leak through any consumer that forgets to gate on `error`. (Trade-off: this drops stale-but-real values on a transient refetch error; acceptable for a trust surface — "show error" beats "show stale as current.")
- **Delete the false `// DEPRECATED: Not used` comment** ([:1-2](../../src/hooks/useDashboardData.ts#L1)) — it has three live consumers; the comment invites a dangerous "cleanup."

**Explicitly out of scope (separate item T0-5):** the self-fetching `ShrinkageAlertCard` / `PriceHikeAlertsCard` swallow query errors → "all clear." That is the sibling fix with broader blast radius; call it out, don't bundle it here (keeps T0-4 a focused, low-risk change).

**Why this approach:** it reuses the **exact pattern already proven on the main Dashboard** (`if (loading)` → `if (error)` → content), touches one page (+ optionally the shared hook), changes **no KPI formula**, and is fully reversible.

## 4. Files affected

| File | Change | Risk |
|------|--------|------|
| `src/pages/app/settings/AuditCenter.tsx` | consume `error`/`refetch`; add `if (error)` early-return error state | Low |
| `src/hooks/useDashboardData.ts` *(defense-in-depth)* | `setSnapshot(DEFAULT_SNAPSHOT)` in catch; fix the stale comment | Low–Medium (affects Dashboard + PublicDemo too — both already gate on `error`, so safe) |
| `src/test/…` | new regression test (see §6) | Low |

No migration, no formula change, no other dashboard card touched.

## 5. Risks & mitigations

| # | Risk | Mitigation |
|---|------|-----------|
| R1 | Snapshot reset in the hook changes Dashboard/PublicDemo behavior | Both already early-return on `error` (`Dashboard.tsx:1463`), so they never render the reset snapshot — verify PublicDemo gates on `error` before including this; if it doesn't, fix it or scope the reset out and keep the AuditCenter-only fix. |
| R2 | Losing **stale-but-real** values on a transient refetch error | Intended for a *trust* page — explicit error + Retry is correct; the user can retry. Acceptable trade-off; document. |
| R3 | Error state hides the page entirely (even if some loaders succeeded) | `Promise.all` is all-or-nothing today, so a partial success isn't representable anyway; full error state is the honest outcome. (A future per-KPI error model is a separate enhancement.) |
| R4 | Confidence badge / data-quality score still computed | The early return prevents rendering them; optionally guard the `useMemo`s too. |
| R5 | Scope creep into T0-5 | Keep the self-fetching cards out; reference T0-5. |

## 6. Test strategy

- **Unit/component (vitest + RTL):** render `AuditCenterPage` with `useDashboardData` mocked to `{ loading:false, error: new Error('boom'), refetch, …DEFAULT_SNAPSHOT }` → assert: an error message + Retry button are present; **no `$0` text**, **no `KpiConfidenceBadge`**, **no "Data quality score"**; clicking Retry calls `refetch`. Mirror with `{ loading:false, error:null, …realSnapshot }` → KPI table renders as today (no regression).
- **Hook unit (defense-in-depth):** simulate a loader rejection → assert the returned `snapshot` equals `DEFAULT_SNAPSHOT` (not stale) and `error` is set.
- **Regression guard:** a test asserting AuditCenter destructures and *uses* `error` (e.g. the source contains an `if (error)` path) — cheap guard against re-introducing the `_error` ignore. (Pattern already used by `dashboard-reports-inventory-parity.test.ts` which reads the hook source.)
- **CI:** `tsc --noEmit` + `vitest run` green.
- **Manual (staging):** throttle/offline → open `/app/settings/audit` → see error+Retry, **not** `$0` rows; restore → Retry loads real values.

## 7. Effort estimate

**S (≈0.5 day).** AuditCenter error branch is a few lines (copy the Dashboard pattern) + one component test. The optional hook hardening + comment fix + hook test add ~0.25 day. Total **S–M**.

## 8. Rollback

Pure client change, no data touched → `git revert` the commit. If the hook reset proves to drop wanted stale values, revert just that line and keep the AuditCenter early-return (the two changes are independent).

## 9. Is this the highest trust issue? (carried from the investigation)

T0-4 is the **highest-severity *failure-mode* issue** and the most **symbolically** damaging (a verification page fabricating audited zeros), and it is **cheap (S)** — so it is the right **first** fix. It is **not** unambiguously the single highest dashboard trust issue: **T0-5** (self-fetching cards → "all clear" on failure) has **broader reach** (main dashboard), and **T0-1** (mixed-basis Profit Risk hero) misleads on **every** load, not just failures. Recommended order: **T0-4 → T0-5 → T0-0/T0-1**.

> No application code, hook, or dashboard was modified in producing this plan.
