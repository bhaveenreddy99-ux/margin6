# T0-0 — KPI Trust Matrix

> **Date:** 2026-06-23 · Companion to [t0-0-kpi-canonical-investigation.md](../investigations/t0-0-kpi-canonical-investigation.md). No code.
> **Confidence:** High = sound formula + tested rendered path + honest label · Medium = sound but a gap (label/period/untested path) · Low = defect/double-count/mixed-basis/silent-failure.
> **Readiness:** YES (show as-is) · CONDITIONAL (show with a fix/caveat) · NO (hide until remediated).
> **Post Phase 1/2:** notification-sourced KPIs (Shrinkage, Price-Increase) are no longer client-forgeable (S0-8); catalog cost overwrites are manager-gated (S0-9). Reflected below.

## Master trust matrix

| KPI | Class | Confidence | Customer-ready? | Reasoning (one line) |
|-----|:-----:|:----------:|:---------------:|----------------------|
| **K5 Period Spend** | Verified | High | **YES** | Sum of confirmed invoice line totals — immutable, no mixing. |
| **K1 Inventory Value** | Verified | Medium | **CONDITIONAL** | Hero is sound (deduped); trend chart beside it is **not** deduped → two "current" numbers (T1-3). Show hero alone. |
| **K2 Overstock (Cash Trap)** | Potential | High | **CONDITIONAL** | Math tested, hero==card parity asserted. Safe **only** as "cash tied up," never as "savings" or inside a loss total. |
| **K3 Reorder / Critical-Low** | Potential | Medium | **CONDITIONAL** | Sound, but a **deprecated** order engine (`computeOrderQty`) still renders elsewhere and disagrees (T1-5). Show one engine. |
| **K4 Waste** | Verified (weak) | Medium | **CONDITIONAL** | `total_cost` is member/STAFF-editable → inflatable; show with a "logged cost" caveat. |
| **K10 Food Cost %** | Forecast→Verified | Medium | **CONDITIONAL** | Depends on **manual** weekly sales (no POS); honest null when absent; 30-day window vs sales window can mismatch (T1-9). Show only with confirmed sales. |
| **K11 Invoice Discrepancy (count)** | Verified | Medium | **CONDITIONAL** | A trustworthy **count**, but labels mix ("delivery issues" vs "discrepancies"); relabel before showing. |
| **K12 Missing Deliveries ($)** | Verified | — | **CONDITIONAL** | Formula correct + tested but **not rendered** (orphaned, T1-4). Safe to surface once baseline reconciled. |
| **K15 Pending Invoices (count)** | Verified | Medium | **YES** | Simple status count; low stakes. |
| **K8 Price Increase Impact (aggregate)** | Verified (double-counted) | Low | **NO** (aggregate) | Two sources summed, disjointness unenforced, divergent qty bases (T0-3). Per-invoice **flag** is YES. |
| **K9 Shrinkage** | Derived (estimate) | Low–Medium | **NO** | Heuristic `dollar_impact` from the cron anomaly detector; no longer forgeable (S0-8) but still an **estimate**, not a counted loss — don't present as "verified loss." |
| **K6 Profit Risk hero (Money Lost)** | **Mixed (invalid)** | Low | **NO** | Verified period + Potential snapshot + Derived shrinkage summed; time bases mixed; inline composition (T0-1). |
| **K7 Savings banner** | **Mixed (invalid)** | Low | **NO** | Potential overstock relabeled "recoverable savings"; same $ also called "exposure" in K6 (T0-2). |
| **K13 Top Profit Leaks (Top 5)** | Mixed | Low | **NO** (aggregate) | Uses a **different** price-qty basis than K6/K8; per-item list could be CONDITIONAL after T0-3. |
| **K14 Portfolio "Money Lost this week"** | Mixed | Low | **NO** | Per-restaurant copy of K6's mixing; label asserts realized loss. |
| **K16 Audit Center table** | Unknown-on-error | Low | **NO** | Renders **`$0` "verified" on load error** (T0-4) — the trust page fabricates audited zeros. Fix error state first. |
| *Vendor Connect* (not a KPI) | — | — | **REMOVE** | Returns `MOCK_INVOICES` presented as real (T0-6). |

## Why each class (the evidence basis)

- **Verified** = built only from immutable/operational records: confirmed invoice lines (K5), approved counts (K1), comparison/receipt flags (K11/K12). *Editable inputs degrade this:* waste `total_cost` is member-editable → K4 is "Verified (weak)."
- **Potential** = cash *at risk* or *tied up*, not realized: overstock (K2), reorder need (K3). Legitimate **as risk/opportunity**, never inside a "lost" or "saved" total.
- **Forecast** = predicted/derived from manual input: Food Cost % (K10) needs manually-entered sales.
- **Derived** = heuristic estimate: Shrinkage (K9) `dollar_impact` is the cron's anomaly estimate (usage vs rolling average × resolved unit cost), not a counted variance.
- **Mixed (invalid)** = a single KPI that **combines** the above classes — the Money-Rules violation (K6, K7, K13, K14).
- **Unknown-on-error** = the value can't be trusted because the failure path is swallowed (K16; also the self-fetching cards, T0-5).

## Money-Rules compliance check (CLAUDE.md: Verified · Potential · Forecast, never combined)

| KPI | Single class? | Compliant? |
|-----|:-------------:|:----------:|
| K5, K1, K2, K3, K4, K10, K11, K12, K15 | yes | ✅ (with the noted caveats) |
| **K6, K7, K13, K14** | **no — combines classes** | ❌ **violates the Money Rules** |
| K8 | single class but double-counted | ⚠️ |
| K9 | single class but estimate-labeled-as-loss | ⚠️ |
| K16 | n/a (display of others) but lies on error | ❌ (failure mode) |

## Trust-floor changes since the 2026-06-22 audit (Phase 1/2)
- **Shrinkage (K9):** prior audit = "UNSAFE, member-writable notifications." Now: client cannot INSERT `SHRINK_ALERT`/`COUNT_VARIANCE` (S0-8 RPC allowlist excludes them; only the cron creates them) → **forgery vector closed**. Still an estimate → stays **NO** as a "verified loss," but the reason shifts from "forgeable" to "heuristic estimate."
- **Inventory Value (K1) cost:** catalog `default_unit_cost` can no longer be overwritten by STAFF (S0-9) → the cost feeding K1/K2/K3 is **manager-gated** → integrity up.
- **Price-Increase notifications (K8):** created only by manager-gated `confirm_invoice_receipt` / cron → not forgeable; the **double-count** (T0-3) is unchanged.

> No application code, KPI logic, or dashboard was modified in producing this matrix.
