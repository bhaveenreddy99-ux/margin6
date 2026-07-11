# Investigation — T0-5: Self-fetching KPI cards swallow errors → false "all clear"

> **Date:** 2026-06-23 · **Type:** Investigation only (no code, no migration, no commit).
> **Roadmap item:** T0-5 (P0 Trust) — [trust-first-roadmap.md](../trust-first-roadmap.md). Sibling of T0-4 (Audit Center), but **broader**: it covers the systemic loader-swallow pattern that T0-4 did not.
> **Sources:** code trace (cited). Builds on [t0-0-kpi-canonical-investigation.md](./t0-0-kpi-canonical-investigation.md) and the T0-4 work (`9083205`).
> **Companion:** [t0-5-kpi-error-handling-plan.md](../plans/t0-5-kpi-error-handling-plan.md).

---

## 0. Executive summary

Margin6's financial leak cards **report "all clear" when their data fails to load.** The failure has two layers:

1. **Component layer** — the self-fetching cards (`PriceHikeAlertsCard`, `ShrinkageAlertCard`, and the `ProfitRiskWidget` drill-down) use `try { …fetch… } finally { setLoading(false) }` with **no `catch` and no `error` state**. On failure `rows` stays `[]` (or stale), so the card renders its **empty "all clear"** branch — *"No price hikes detected this period"* / *"No variance detected — counts are matching expected usage"* — indistinguishable from a genuine zero.
2. **Loader layer (systemic, deeper)** — essentially **every** dashboard loader swallows query errors: `const { data } = await q; … (data ?? [])` discards Supabase's `error` field, plus explicit `return 0` / `catch {}` / `return []`. Because the loaders **don't throw**, a partial failure produces a `0`/empty value that flows into the centralized `useDashboardData` snapshot **without** triggering its catch — so the **main dashboard silently shows `$0`** for that KPI too. **This bypasses the T0-4 fix**, which only resets the snapshot when a loader *throws*.

**Net:** T0-4 stopped the Audit Center from fabricating zeros on a *total* load failure; T0-5 is the rule it implements applied **everywhere** — *failure ≠ zero* — at both the loader and component layers. This is the systemic version of the same trust violation and is arguably the higher-reach issue (it affects the headline dashboard, not just the audit page).

---

## 1. Inventory of self-fetching KPI cards (Goal 1)

| Card | Self-fetches? | What it fetches | Rendered at |
|------|:-------------:|-----------------|-------------|
| **PriceHikeAlertsCard** | **Yes** | `loadPriceIncreaseAlertRows(supabase, …)` | [Dashboard.tsx:1561](../../src/pages/app/Dashboard.tsx#L1561) |
| **ShrinkageAlertCard** | **Yes** | direct `supabase.from("notifications")…` | [Dashboard.tsx:1571](../../src/pages/app/Dashboard.tsx#L1571) |
| **ProfitRiskWidget** (drill-down only) | **Partial** | total is props (centralized); but `handleOpenRow` self-fetches breakdown rows | [Dashboard.tsx:1536](../../src/pages/app/Dashboard.tsx#L1536) |
| OverstockCashTrapCard | No (props `items`) | — (covered by `useDashboardData`) | [:1566](../../src/pages/app/Dashboard.tsx#L1566) |
| *(non-KPI self-fetchers: OnboardingChecklist, AddToCatalogSheet, VendorConnectTab=mock/T0-6)* | — | — | — |

Only **two** genuine self-fetching KPI cards, plus one drill-down. But they bypass the centralized `useDashboardData` / T0-4 error path entirely.

## 2. Data flow per card (Goal 2)

**ShrinkageAlertCard** ([ShrinkageAlertCard.tsx:73-156](../../src/components/ShrinkageAlertCard.tsx#L73)):
```
Card mounts/props change
 → useEffect: setLoading(true)
 → supabase.from("notifications").select(...).in(type, [SHRINK_ALERT, COUNT_VARIANCE])…   ← notifications
 → const { data } = await q            // NOTE: `error` field NOT destructured/checked
 → iterate (data ?? [])  → rows[]
 → finally setLoading(false)            // NO catch
 → render: loading? skeleton : rows.length===0 ? "No variance detected…" : list + total
```
**PriceHikeAlertsCard** ([PriceHikeAlertsCard.tsx:45-66](../../src/components/PriceHikeAlertsCard.tsx#L45)):
```
useEffect: setLoading(true)
 → loadPriceIncreaseAlertRows(supabase,…)   ← notifications (loader; catch→[] internally)
 → setRows(next)
 → finally setLoading(false)                 // NO catch
 → render: loading? skeleton : rows.length===0 ? "No price hikes detected…" : list
```
**ProfitRiskWidget drill-down** ([ProfitRiskWidget.tsx:130-156](../../src/components/ProfitRiskWidget.tsx#L130)): `setRows([]); setRowsLoading(true); try { … fetch<metric>Breakdown(…); setRows(result) } finally { setRowsLoading(false) }` — **no catch**.

## 3. Exact failure behavior (Goal 3)

| Card | Mechanism on query failure | Rendered outcome |
|------|----------------------------|------------------|
| **ShrinkageAlertCard** | Supabase returns `{ data: null, error }`; card destructures only `data`, `data ?? []` → `rows = []` (no throw) | **"No variance detected — counts are matching expected usage"** + `$0 total unaccounted` — **false all-clear** |
| **PriceHikeAlertsCard** | loader internally `catch { return [] }` → `rows = []`; *or* loader throws → no catch → `setRows` not called → rows stay **stale/initial** | **"No price hikes detected this period"** (first load / swallowed) **or stale rows** (throw after a prior success) |
| **ProfitRiskWidget drill-down** | fetch throws → no catch → `setRows` not called after the initial `setRows([])` → rows `[]` | empty "evidence" drill-down — looks like **"no records,"** not "failed to load" |

Supabase note: `from().select()` resolves to `{ data, error }` and **does not throw** — so the swallow is silent by default; the only way the component would even see an error is by reading `error`, which none of them do.

## 4. Silent-failure verification (Goal 4)

| Symptom | Present? | Where |
|---------|:--------:|-------|
| Shows **`$0`** on failure | **Yes** | Shrinkage "total unaccounted" = `$0`; centralized `shrinkageValue`/`priceIncreaseImpact` = `0` via loader swallow |
| Shows **"All Clear"** copy on failure | **Yes** | "No variance detected — counts are matching expected usage"; "No price hikes detected this period" |
| Shows **empty state** indistinguishable from real-zero | **Yes** | both cards' `rows.length === 0` branch is identical for real-empty and failure |
| Shows **stale values** after a failed refetch | **Yes** | PriceHike (loader throws → `setRows` skipped → old rows persist); ProfitRiskWidget drill-down likewise |
| Presents **success state after failure** | **Yes** | `loading=false` + content + **no error indicator** → a failure looks like a completed, healthy load |
| Confidence badge / "verified" on failed data | n/a here (these cards have no badge) — but the **centralized** Audit/Dashboard numbers fed by swallowing loaders did (T0-4 fixed the Audit page; the Dashboard hero still trusts loader zeros) | — |

## 5. The systemic loader-swallow pattern (the shared root cause)

Every loader erases the **error-vs-empty** distinction, by one of three mechanisms:

| Loader | Swallow mechanism | Result on failure |
|--------|-------------------|-------------------|
| `loadShrinkageValue.ts:33` | `if (error || !data) return 0;` | **0** |
| `loadProfitLeaks.ts:142,161,255` | `} catch { … }` (continue) | partial / **[]** |
| `loadPriceIncreaseAlertRows` (`priceIncreaseFromNotifications.ts:221`) | `catch { return []; }` | **[]** |
| `loadFoodCostMetrics.ts:35,62,109` | `catch {}` | **null/0** |
| `loadInventoryMetrics`, `loadWasteMetrics`, `loadSpendMetrics`, `loadOverstockItems`, `loadInvoiceMetrics` | `const { data } = await q; …(data ?? [])` — **`error` field ignored**, null→empty | **0 / []** |

**Why this matters for T0-4:** `useDashboardData` only resets the snapshot in its `catch` ([useDashboardData.ts:208](../../src/hooks/useDashboardData.ts#L208)). These loaders **don't throw** → the catch never fires → the snapshot carries a *swallowed* `0`/`[]` → the **main Dashboard renders `$0` with no error**, and (pre-T0-4) the Audit Center did too. T0-4 closed the *total-failure* path; the swallow pattern is the *partial-failure* path it cannot see.

## 6. Trust-impact ranking (Goal 5)

| Rank | Issue | Why |
|:----:|-------|-----|
| **Critical-1** | **Loader swallow pattern** (`?? []` / `return 0` / `catch {}` across all loaders) | Systemic; silently zeros individual KPIs on the **main dashboard** (Profit Risk, Shrinkage, Price Increase, Food Cost), bypassing T0-4. A real outage reads as "$0 / all clear" platform-wide. |
| **Critical-2** | **ShrinkageAlertCard / PriceHikeAlertsCard false "all clear"** | These are the *leak-detection* cards; "counts are matching" / "no price hikes" on a silent failure tells the owner they're safe when they may not be — the exact "trust is the product" violation. |
| **High** | **PriceHike stale-after-failure** | A failed refetch leaves old rows on screen as if current. |
| **High** | **ProfitRiskWidget drill-down empty-on-failure** | The "evidence/records" layer (the trust drill-down) shows "no records" instead of "couldn't load." |
| **Medium** | **No retry anywhere** | Even when a user suspects staleness, there's no recovery affordance on these cards. |

## 7. Grouping by shared root cause (Goal 6 — what fixes together)

Two fix-groups, one architecture:

- **Group A — Loaders stop swallowing** (`loadShrinkageValue`, `loadProfitLeaks`, `loadPriceIncreaseAlertRows`, `loadFoodCostMetrics`, and the `?? []`/`error`-ignoring loaders). Surface the error (throw or return a `Result`) so empty ≠ error. *Fixes Critical-1 and restores T0-4's catch for partial failures.*
- **Group B — Self-fetching cards adopt a consistent error+retry state** (`PriceHikeAlertsCard`, `ShrinkageAlertCard`, `ProfitRiskWidget` drill-down). *Fixes Critical-2 / High.*

Both are the **same root cause** — *empty and error are conflated* — at two layers. A single architecture (next) addresses both so the pattern can't recur.

## 8. Recommended single architecture (Goal 7) — summary (detail in the plan)

A consistent **KPI resource contract**:
1. **Loaders never swallow:** check the Supabase `error`; on error **throw** (or return a `Result<T> = {ok:true,data}|{ok:false,error}`). Empty data (`[]`/`0`/`null`) means *verified empty*; an error means *unknown*.
2. **One async hook** `useKpiResource(fetcher, deps)` → `{ data, loading, error, refetch }` (or fold the two cards into the centralized `useDashboardData` snapshot so they inherit T0-4's handling).
3. **One card-state wrapper** `<KpiCardState loading error empty onRetry>` guaranteeing four *visually distinct* states — Loading · **Error + Retry** · Empty ("none detected") · Data — so error can never render as `$0`/all-clear, and "empty" always reads as a verified zero (not a failure).
4. **Consistency with T0-4:** on error, suppress values/badges and show an explicit message + Retry (the AuditCenter pattern already shipped).

---

## Final answers

- **Root cause:** *empty and error are conflated* at two layers — loaders swallow query errors into `0`/`[]` (ignoring Supabase's `error` field), and self-fetching cards have no `catch`/error state, so a failed load renders the "all clear" empty branch (or stale values) as a successful zero.
- **Exact files/lines:** cards — `ShrinkageAlertCard.tsx:79-160`, `PriceHikeAlertsCard.tsx:48-66`, `ProfitRiskWidget.tsx:130-156`; loaders — `loadShrinkageValue.ts:33`, `loadProfitLeaks.ts:142/161/255`, `priceIncreaseFromNotifications.ts:221`, `loadFoodCostMetrics.ts:35/62/109`, plus the `data ?? []` (error-ignoring) pattern in `loadInventoryMetrics/loadWasteMetrics/loadSpendMetrics/loadOverstockItems/loadInvoiceMetrics`.
- **Is this the highest trust issue in the dashboard?** It is the **highest-reach** failure-mode issue — broader than T0-4 (which it generalizes) because the loader swallow silently zeros the *main* dashboard, not just the audit page. The **Profit Risk hero mixing** (T0-1) remains the most dangerous *single number*; T0-5 is the most dangerous *systemic behavior* (any outage reads as "all clear" everywhere). Both are P0; T0-5 should land alongside/after T0-4 since it completes "failure ≠ zero."

> No application code, loader, card, or formula was modified in producing this investigation.
