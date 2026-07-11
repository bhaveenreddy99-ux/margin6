# Investigation — T0-4: Audit Center renders `$0` "verified" on load error

> **Date:** 2026-06-23 · **Type:** Investigation only (no code, no migration, no commit).
> **Roadmap item:** T0-4 (P0 Trust) — [trust-first-roadmap.md](../trust-first-roadmap.md). Flagged the #1 trust risk in [t0-0-kpi-canonical-investigation.md](t0-0-kpi-canonical-investigation.md).
> **Companion:** [t0-4-audit-center-error-state-plan.md](../plans/t0-4-audit-center-error-state-plan.md).

---

## 0. Executive summary

The **Audit Center** — the page whose sole purpose is "verify every important dashboard number" ([AuditCenter.tsx:287](../../src/pages/app/settings/AuditCenter.tsx#L287)) — **ignores the data-load error and renders the all-zero default snapshot as audited KPIs, each with a confidence badge.** On a first-load failure every money KPI shows **`$0`** and every count shows **`0`**, presented as verified facts. This is the worst possible trust failure: the verification page fabricates "audited zeros / all clear" precisely when the data could not be loaded.

The defect is **two cooperating bugs**:
1. **The hook never clears the snapshot on error** ([useDashboardData.ts:208-209](../../src/hooks/useDashboardData.ts#L208)): the `catch` calls `setError` only — it does **not** reset/replace `snapshot`, which is initialized to an **all-zero `DEFAULT_SNAPSHOT`** ([:31-60](../../src/hooks/useDashboardData.ts#L31)). So on first-load failure the snapshot stays all-zero; on a later failure it keeps **stale** last-good values.
2. **The Audit Center ignores the error** ([AuditCenter.tsx:60](../../src/pages/app/settings/AuditCenter.tsx#L60)): it destructures `{ loading, error: _error, refetch: _refetch, ...snapshot }` — `error` and `refetch` are aliased to throwaway `_`-names and **never used**; the component branches only on `loading` ([:267](../../src/pages/app/settings/AuditCenter.tsx#L267)) and has **no `error` branch**, so after a failed load it falls straight through to the KPI table.

By contrast, the **main Dashboard handles the same hook's error correctly** ([Dashboard.tsx:1463](../../src/pages/app/Dashboard.tsx#L1463) `if (error) → error/Retry state`), so this `$0` behavior is **isolated to the Audit Center** (an Owner-only route). The genuinely broad failure-masking lives in the **self-fetching cards** (T0-5, §4).

---

## 1. Complete Audit Center data flow (Requirement 1)

```
Route /app/settings/audit (OwnerRoute)
  → AuditCenterPage()                              src/pages/app/settings/AuditCenter.tsx:54
     → useDashboardData({restaurantId, locationId, timeFilter:"this_week"})   :60
          ├─ state snapshot = DEFAULT_SNAPSHOT (all 0 / null)   useDashboardData.ts:108, :31-60
          ├─ useEffect run():
          │     setLoading(true) → Promise.all([loadInventoryMetrics, loadInvoiceMetrics,
          │       loadSpendMetrics, loadShrinkageValue, loadProfitLeaks, loadOverstockItems,
          │       loadWasteMetrics, loadFoodCostMetrics])                       :137-183
          │     SUCCESS → setSnapshot(buildDashboardSnapshot(...)); setError(null)  :194-206
          │     ERROR   → catch: setError(err)  ONLY — snapshot UNCHANGED         :208-209  ← bug #1
          │     finally → setLoading(false)                                       :210-211
          └─ returns { ...snapshot, loading, error, refetch }                     :221
     → consumes ONLY `loading` (error→_error ignored)                            AuditCenter.tsx:60  ← bug #2
     → derived: qualityInput, confidenceInput, rows[], moneyLostTotal            :71-260
     → if (loading) return <Skeleton/>                                           :267-275
     → (NO if(error) branch)
     → renders <DataQualityBanner/> + "Data quality score" + KPI table           :291-367
          each row.value = fmtMoney(snapshot.<field>)                            :116-246
          each row → <KpiConfidenceBadge level={row.confidence}/>                :349
```

**Loaders feeding it** (all under `src/domain/dashboard/`): `loadInventoryMetrics`, `loadInvoiceMetrics`, `loadSpendMetrics`, `loadShrinkageValue`, `loadProfitLeaks`, `loadOverstockItems`, `loadWasteMetrics`, `loadFoodCostMetrics` → composed by `buildDashboardSnapshot`. A throw in **any** of the eight (Promise.all) rejects the whole run → the catch path → bug #1.

**Stale-hazard note:** the hook is headed `// DEPRECATED: Not used.` ([useDashboardData.ts:1-2](../../src/hooks/useDashboardData.ts#L1)) — **false**: it has **three** live consumers (Dashboard.tsx:1288, AuditCenter.tsx:60, PublicDemo.tsx:204). The misleading comment is itself a risk (a "cleanup" could break the dashboard + audit center).

## 2. Exactly where `$0` originates (Requirement 2)

| Step | File:line | What |
|------|-----------|------|
| Zero defaults | `useDashboardData.ts:31-60` | `DEFAULT_SNAPSHOT`: `inventoryValue:0, overstockValue:0, recordedWasteValue:0, priceIncreaseImpact:0, shrinkageValue:0, periodSpend:0, deliveryIssuesCount:0, …`, `foodCostPct:null`, counts `0` |
| Snapshot init | `useDashboardData.ts:108` | `useState<KPISnapshot>(DEFAULT_SNAPSHOT)` |
| **Error swallow (snapshot not reset)** | `useDashboardData.ts:208-209` | `catch (err) { setError(err) }` — no `setSnapshot` → snapshot **remains** `DEFAULT_SNAPSHOT` (first load) or last-good (later) |
| Error returned but… | `useDashboardData.ts:221` | returns `error` — but the consumer drops it |
| **Error ignored** | `AuditCenter.tsx:60` | `error: _error` (unused); only `loading` consumed; no `if (error)` |
| **`0 → "$0"`** | `AuditCenter.tsx:116-117` | `fmtMoney = n => Number.isFinite(n) ? "$"+n… : "—"` — `0` is finite → **`"$0"`** (only NaN/∞ → "—") |
| Money rows | `AuditCenter.tsx:122,137,160,190,199,208,217,240` | `fmtMoney(snapshot.<field>)` → `"$0"` on failure |
| Profit-risk total | `AuditCenter.tsx:98-103,217` | `computeMoneyLostTotal({0,0,0,0}) = 0 → "$0"` |
| **Badges still render** | `AuditCenter.tsx:349` | `<KpiConfidenceBadge level={row.confidence}/>` unconditional, computed from the zero snapshot |

**Rendered outcome on first-load failure:** the "KPI verification" table shows `Inventory value $0`, `Overstock $0`, `Reorder $0`, `Critical low 0`, `Recorded waste $0`, `Price increase $0`, `Shrinkage $0`, `Profit risk total $0`, `Period spend $0`, `Food cost —` — **each with a confidence badge**, plus a "Data quality score" computed from zeros. No error, no retry, no staleness indicator.

## 3. Every Audit Center KPI — failure behavior (Requirement 3)

| KPI (row) | Value source | On load failure shows | Confidence badge on failure? |
|-----------|--------------|----------------------|:----------------------------:|
| Inventory value (`:122`) | `fmtMoney(snapshot.inventoryValue)` | **$0** (or "—" if cost perm off) | **Yes** |
| Overstock exposure (`:137`) | `fmtMoney(snapshot.overstockValue)` | **$0** | **Yes** |
| Reorder needed $ (`:160`) | `fmtMoney(reorderValue)` (from `reorderSummary:null`) | **$0** | **Yes** |
| Critical low stock (`:175`) | `String(criticalLowCount)` | **0** | **Yes** |
| Recorded waste (`:190`) | `fmtMoney(snapshot.recordedWasteValue)` | **$0** | **Yes** |
| Price increase impact (`:199`) | `fmtMoney(snapshot.priceIncreaseImpact)` | **$0** | **Yes** |
| Shrinkage alerts (`:208`) | `fmtMoney(snapshot.shrinkageValue)` | **$0** | **Yes** |
| Profit risk total (`:217`) | `fmtMoney(moneyLostTotal)` | **$0** | **Yes** |
| Food cost % (`:229`, perm) | `foodCostPct ?? "—"` | **—** (null) | **Yes** |
| Period spend (`:240`) | `fmtMoney(snapshot.periodSpend)` | **$0** | **Yes** |

Plus: **DataQualityBanner** + **"Data quality score N/100"** ([:291-311](../../src/pages/app/settings/AuditCenter.tsx#L291)) computed from the zero snapshot — so the page may even assert "No data quality issues detected" over fabricated zeros.

## 4. Other cards with the same failure pattern (Requirement 4)

| Surface | Hook/fetch | Error handling | Verdict |
|---------|-----------|----------------|---------|
| **Main Dashboard** | `useDashboardData` (`Dashboard.tsx:1288`, error at `:1263`) | **`if (error) return <error+Retry>`** at `:1463` | ✅ **handled** — no `$0` bug (the zero snapshot is never rendered) |
| **Audit Center** | `useDashboardData` (`:60`) | `error` ignored; only `loading` | ❌ **T0-4 bug** |
| **PublicDemo** | `useDashboardData` (`:204`) | (demo page — verify separately) | ⚠️ low stakes; confirm |
| **ShrinkageAlertCard** (self-fetch) | own `supabase.from("notifications")…` `ShrinkageAlertCard.tsx:79-91` | destructures **only `data`** (ignores Supabase `error`); `data ?? []`; **no catch** | ❌ **T0-5** — query error → empty → renders "all clear" |
| **PriceHikeAlertsCard** (self-fetch) | `loadPriceIncreaseAlertRows(...)` `PriceHikeAlertsCard.tsx:49-63` | `try…finally`, **no catch**; `rows` stays `[]` | ❌ **T0-5** — failure → "no price hikes" |
| **ProfitLeaksCard** | **props** (`items`, `loading`) — not self-fetching | inherits parent (Dashboard guards `error`) | ✅ in Dashboard |
| **OverstockCashTrapCard** | **props** (`items`) — not self-fetching | inherits parent | ✅ in Dashboard |

**Key distinction:** the `$0`-with-badges fabrication is **specific to the Audit Center** (T0-4). The self-fetching cards (Shrinkage, PriceHike) have the *sibling* "failure looks like real zero" defect (**T0-5**) and — because they fetch **independently** of `useDashboardData` — they can render "all clear" **on the main dashboard** even when the page-level error guard didn't fire. T0-5 has **broader blast radius** than T0-4; T0-4 has **higher symbolic severity** (the trust page itself lies).

## 5. Evidence summary (Requirement 5)

- **Exact code:** `AuditCenter.tsx:60` (`error:_error`), `:116-117` (`fmtMoney` 0→"$0"), `:267` (only `loading` guard), `:349` (badge unconditional); `useDashboardData.ts:31-60` (zero defaults), `:208-209` (catch sets error only), `:221` (returns error).
- **Exact failure path:** any of the 8 loaders throws → `Promise.all` rejects → `useDashboardData` catch sets `error`, leaves snapshot at zeros → returns `{…zeros, loading:false, error}` → AuditCenter drops `error`, sees `loading:false` → renders the KPI table from zeros.
- **Exact rendered outcome:** KPI verification table with `$0`/`0`/`—` values **and confidence badges**, a "Data quality score", and possibly "No data quality issues detected" — no error state, no Retry.

## 6. Fix direction (Requirement 6) — summary (detail in the plan)

1. **Failure must never render `$0`.** AuditCenter must **consume `error`** and, when set, render an **explicit error state** (mirror `Dashboard.tsx:1463` — message + `Retry` via the already-returned `refetch`) **instead of** the table.
2. **No KPI value when data failed.** Gate the entire KPI table + DataQualityBanner + score behind `!error`. Do not show partial/zeroed values.
3. **No confidence badges on failed data** — handled automatically once the table doesn't render under error.
4. **Defense-in-depth (recommended):** also reset the snapshot to `DEFAULT_SNAPSHOT` (or a distinct "no data" sentinel) in the hook's catch so a stale/zero snapshot can never leak through any consumer; and **delete the false `DEPRECATED: Not used` comment**.
5. **Out of scope but adjacent:** the self-fetching-card swallow (Shrinkage/PriceHike) is **T0-5** — a separate fix; this item is the Audit Center.

---

## FINAL — required answers

- **Root cause:** the data hook returns an **all-zero default snapshot** that it **does not clear on error** (`useDashboardData.ts:208-209` + `:31-60`), and the Audit Center **ignores the returned `error`** (`AuditCenter.tsx:60`) with **no error branch**, so `fmtMoney(0)` renders **`$0`** for every KPI with confidence badges on load failure.
- **Exact files/lines:** `src/pages/app/settings/AuditCenter.tsx:60, 116-117, 267-275, 349` · `src/hooks/useDashboardData.ts:31-60, 108, 194-211, 221` (+ misleading `:1-2`).
- **Is this truly the highest trust issue in the dashboard?** **It is the highest-*severity error-handling* issue and the most *symbolically* damaging** — a verification page fabricating audited zeros — and it is cheap to fix, so it's a correct high-priority first move. **But it is not unambiguously *the* single highest dashboard trust issue:** its blast radius is narrow (Owner-only Audit Center; the main Dashboard is correctly guarded). Two issues compete: (a) the **self-fetching-card swallow (T0-5)** masks failures as "all clear" on the **main dashboard** (broader audience); (b) the **mixed-basis Profit Risk hero (T0-1)** misleads on **every successful load**, not just failures — a Money-Rules violation shown to everyone. Honest ranking: **T0-4 = most damaging *failure mode*; T0-1 = most damaging *always-on* number; T0-5 = widest reach.** Fix T0-4 first (cheap, trust-page-critical), then T0-5, then T0-1.

> No application code, hook, or dashboard was modified in producing this investigation.
