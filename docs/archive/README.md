# Documentation archive

> **Historical document — not current implementation guidance. Verify all claims against current GitHub code and live Supabase.**

This directory preserves plans, investigations, completion reports, and superseded audits. **Do not use for engineering decisions.**

---

## Archive categories

| Directory | Contents | Approx. era |
|-----------|----------|-------------|
| [`plans/`](plans/) | S0/T0/phase implementation plans | 2026 Q1–Q2 |
| [`investigations/`](investigations/) | Security and KPI investigations | 2026 |
| [`completed/`](completed/) | Slice completion summaries | 2026 |
| [`restaurantiq/`](restaurantiq/) | RestaurantIQ-era product plans | Pre-rename |
| [`dashboard-trust/`](dashboard-trust/) | Superseded trust roadmaps and root-cause notes | 2026 |
| [`audits-baseline/`](audits-baseline/) | Pre–system-audit baseline audits | 2026 |
| [`architecture-legacy/`](architecture-legacy/) | S0/T0 architecture drafts superseded by `docs/architecture/` | 2026 |
| [`margin6-status/`](margin6-status/) | Root-level status snapshots superseded by `docs/status/` | 2026 |
| [`readiness/`](readiness/) | Readiness scorecards and gap roadmaps | 2026 |

---

## Why documents were archived

- Product renamed to **Margin6**; RestaurantIQ branding obsolete.
- **`docs/system-audit/`** and **`docs/status/`** supersede older audits and master status files.
- Plans marked complete or abandoned remain for history only.
- Test result artifacts may be missing — **do not reconstruct**; see notes in [`../documentation-audit/01-conflict-map.md`](../documentation-audit/01-conflict-map.md).

---

## How to use

1. Read [`../../AGENTS.md`](../../AGENTS.md) and [`../status/current-product-status.md`](../status/current-product-status.md) first.
2. Use archive only for **historical context** or blame/archaeology.
3. If archive contradicts code or Supabase, **code and Supabase win**.
