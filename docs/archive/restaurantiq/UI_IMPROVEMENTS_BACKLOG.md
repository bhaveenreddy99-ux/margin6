# RestaurantIQ — UI improvement backlog

> Sourced from a code review of **Dashboard (single restaurant)**, **Inventory Counting**, and **Smart Order**: visual hierarchy, flows, mobile, errors, loading, empty states, and consistency.  
> **Severity:** 🔴 blocks / 🟡 confusing / 🟢 polish

## Implemented (rolling)

| ID | What changed | Where |
|----|----------------|--------|
| **C1 / V1** | “Start / Continue count” uses same **gradient orange** CTA as Dashboard | `src/features/inventory-count/components/InventoryHubHeader.tsx` |
| **F1** | **Review** and **Approved** in sidebar under Inventory | `src/components/AppSidebar.tsx` |
| **F2** | Smart Order list empty: **Open Inventory Management** → `/app/inventory/enter` | `src/pages/app/SmartOrder.tsx` |
| **E2** | `formatSmartOrderSubmitError()` for RPC submit failures (network, session, permission, generic) | `src/pages/app/SmartOrder.tsx` |
| **E3** | Empty run table: copy references **Show OK** / **Show Missing PAR** | `src/pages/app/SmartOrder.tsx` |
| **M1** (partial) | Larger targets: back **44px**, list row View/delete **40px+**, filter `Select` **h-10** | `src/pages/app/SmartOrder.tsx` |
| **M3** | PAR / cost inline inputs **h-10** in run detail | `src/pages/app/SmartOrder.tsx` |
| **Toggles** | Filter row **flex-wrap** + `min-h-10` on switch rows | `src/pages/app/SmartOrder.tsx` |
| **Detail header** | **flex-wrap** so actions don’t overflow on narrow viewports | `src/pages/app/SmartOrder.tsx` |
| **C3** | Risk badge: **Popover** (tap/click) instead of hover-only Tooltip | `src/pages/app/SmartOrder.tsx` |
| **Header titles** | Session review / Approved counts labels in `routeNames` | `src/components/AppHeader.tsx` |

**Still open (bigger / follow-up):** **UI-M2** card layout for wide tables on phone; **UI-L3** loading audit on Inventory Count; **V2/V3** dashboard layout tweaks.

---

## 1. Visual hierarchy

| # | Finding | Severity | File / location | Suggested fix | Est. |
|---|---------|----------|-----------------|-----------------|------|
| V1 | Two competing “primary” styles for the same job: **orange** “Start inventory” on Dashboard vs **blue** “Start new count / Continue” in Inventory hub | 🟡 | `src/pages/app/Dashboard.tsx` (`TodaysBriefing`); `src/features/inventory-count/components/InventoryHubHeader.tsx` | Standardize on one brand primary (e.g. `bg-gradient-orange` or theme `default`) for all count entry CTAs | 1h |
| V2 | **Smart Order** preview on Dashboard: “Generate Smart Order” is easy to miss when KPI grid above is dense | 🟡 | `src/pages/app/Dashboard.tsx` — `SmartOrderPreview` (~372–377) | Optional: move preview higher on `sm` or add subtle section divider; A/B in QA | 2h |
| V3 | Many **KPI cards** back-to-back (`SingleDashboard` “Today’s situation” / “This period”) | 🟡 | `src/pages/app/Dashboard.tsx` | Optional collapse “This period” on small viewports; tabs for “Today vs period” | 2–4h |
| — | **Color system** (destructive / warning / success / primary) | 🟢 | Cross-page | No change required; keep orange gradient for branded CTAs only | — |

---

## 2. User flow

| # | Finding | Severity | File / location | Suggested fix | Est. |
|---|---------|----------|-----------------|-----------------|------|
| F1 | **Review** and **Approved** inventory routes are not in the sidebar; users may miss them | 🟡 | `src/components/AppSidebar.tsx`; hub in `InventoryCountPage` | Add nav item or “Pending reviews” with badge; or first-run coachmark | 2–4h |
| F2 | **Smart Order** list empty state explains origin but has **no CTA** to Inventory (unlike Dashboard card empty state) | 🟡 | `src/pages/app/SmartOrder.tsx` (~696–703) | Add `Button` + `Link` to `/app/inventory/enter` (mirror `SmartOrderPreview` in Dashboard) | 0.5h |
| F3 | Run list → detail flow | 🟢 | `src/pages/app/SmartOrder.tsx` | Row click + View; `stopPropagation` on destructive actions — keep as-is | — |
| F4 | Inventory hub breadcrumb + primary CTA | 🟢 | `InventoryHubHeader.tsx`, `InventoryCountPage.tsx` | Clear entry — keep; optional link to List Management in empty list | 1h |

**Tickets (copy-paste)**

- **[UI-F1]** Add Review/Approved discoverability (sidebar or badge + link).
- **[UI-F2]** Smart Order empty: add primary CTA “Go to inventory” → `/app/inventory/enter`.

---

## 3. Mobile responsiveness

| # | Finding | Severity | File / location | Suggested fix | Est. |
|---|---------|----------|-----------------|-----------------|------|
| M1 | **Touch targets** &lt; ~44px: `h-7` / `h-8` on View, back, trash, some icon buttons | 🟡 | `src/pages/app/SmartOrder.tsx` (e.g. ~347–349, 740–745); similar in dense toolbars | `min-h-11` / `min-w-11` or padding slop; avoid `h-7` for primary or destructive on touch | 2–4h |
| M2 | **Wide tables** on phone: horizontal scroll only | 🟡 | `SmartOrder.tsx` detail table (~10 cols); `InventorySessionDesktopCategoryList.tsx` + virtualized body | At `useIsCompact()`, use **card/stack** layout or fewer columns + row sheet | 8–16h |
| M3 | Inline **PAR/cost** inputs `h-8` on Smart Order detail | 🟡 | `SmartOrder.tsx` | Increase to `h-10`+ on compact or `min-h-11` when `inputMode=decimal` | 1h |
| M4 | `CountSheetItemStockField` uses `min-h-11` in some paths | 🟢 | `src/features/inventory-count/components/CountSheetItemStockField.tsx` | Preserve; extend pattern to other critical inputs | — |

**Tickets**

- **[UI-M1]** Smart Order: 44px minimum touch targets for back, view, delete, primary submit.
- **[UI-M2]** Inventory + Smart Order: compact layout — cards or column reduction for run/session detail (large).

---

## 4. Error states

| # | Finding | Severity | File / location | Suggested fix | Est. |
|---|---------|----------|-----------------|-----------------|------|
| E1 | Vendor / multi-vendor: **toasts** + List Management path | 🟢 | `SmartOrder.tsx` ~221–240 | Keep; ensure toast duration/readability on mobile | — |
| E2 | RPC `submit` **failure** shows raw `e.message` | 🟡 | `SmartOrder.tsx` ~285 | Map common errors; friendly one-liner + “Retry”; optional `aria-live` | 1–2h |
| E3 | Detail table **“No items to display”** doesn’t mention **Show OK / Missing PAR** | 🟡 | `SmartOrder.tsx` ~555–560 | Add one line referring to toggles above | 0.5h |

**Tickets**

- **[UI-E2]** Smart Order submit: user-friendly error mapping.
- **[UI-E3]** Empty filter result copy: reference toggle controls.

---

## 5. Loading states

| # | Finding | Severity | File / location | Suggested fix | Est. |
|---|---------|----------|-----------------|-----------------|------|
| L1 | Dashboard **skeleton** for single restaurant | 🟢 | `src/pages/app/Dashboard.tsx` `SingleDashboard` ~997–1020 | Maintain | — |
| L2 | Smart Order list **skeleton** | 🟢 | `SmartOrder.tsx` ~692–695 | Maintain | — |
| L3 | Inventory hub branches | 🟡 | `InventoryCountPage` + data hooks | Audit: every `loading` path shows skeleton or content (no blank flash) | 2h |

**Tickets**

- **[UI-L3]** Audit Inventory Count page for uncovered loading branches.

---

## 6. Empty states

| # | Finding | Severity | File / location | Suggested fix | Est. |
|---|---------|----------|-----------------|-----------------|------ |
| P1 | Dashboard **Smart Order** preview empty: strong (icon, copy, CTA) | 🟢 | `Dashboard.tsx` ~381–397 | Use as template for Smart Order list page | — |
| P2 | Smart Order list empty: no CTA | 🟡 | `SmartOrder.tsx` ~696–703 | See **F2** | 0.5h |
| P3 | “You’re in good shape” in action center | 🟢 | `Dashboard.tsx` | Optional secondary link (low priority) | 1h |

---

## 7. Consistency

| # | Finding | Severity | File / location | Suggested fix | Est. |
|---|---------|----------|-----------------|-----------------|------|
| C1 | **Primary CTA** color: orange vs blue for “start count” | 🟡 | `Dashboard.tsx` vs `InventoryHubHeader.tsx` | Unify (see V1) | 1h |
| C2 | **Button sizes** mix (`h-8`, `h-9`, `h-10`) for similar actions | 🟡 | Same three surfaces | Document tokens: `default` = primary, `sm` = secondary row actions; only use `h-8` in dense tables with larger row height | 2h design QA |
| C3 | **Tooltips** for risk on Smart Order: hover/focus only | 🟡 | `SmartOrder.tsx` `riskBadge` | On touch: `Popover` on tap or short label in badge | 2–3h |

**Tickets**

- **[UI-C1]** Unify “start/continue count” button styling.
- **[UI-C3]** Risk badge: non-hover access on mobile (popover or inline abbrev).

---

## Top 10 by impact (priority stack)

| Rank | ID | Title | Severity | Est. | Owner |
|------|----|----|----------|------|--------|
| 1 | UI-M2 | Compact layouts: card/stack for Smart Order detail + session table (replace or supplement wide table on phone) | 🟡 | 8–16h | — |
| 2 | UI-M1 | 44px touch targets: Smart Order + critical inventory actions | 🟡 | 2–4h | — |
| 3 | UI-C1 / V1 | Unify primary “start count” CTA (Inventory hub vs Dashboard) | 🟡 | 1h | — |
| 4 | UI-F2 | Smart Order empty: CTA to `/app/inventory/enter` | 🟡 | 0.5h | — |
| 5 | UI-F1 | Review/Approved discoverability (nav or badge) | 🟡 | 2–4h | — |
| 6 | UI-C3 | Risk info without hover (popover / inline) | 🟡 | 2–3h | — |
| 7 | V3 / — | Smart Order filter row: `flex-wrap` / stack on narrow | 🟢 | 1h | — |
| 8 | UI-E2 | Friendly submit error messages (Smart Order) | 🟡 | 1–2h | — |
| 9 | UI-E3 | “No items” copy: mention PAR toggles | 🟡 | 0.5h | — |
| 10 | V3 | Dashboard: optional collapse/shorten “This period” on small screens | 🟢 | 2–4h | — |

---

## How to use this doc

- **Engineering:** Implement tickets top-down; **UI-F2**, **UI-E3**, **UI-C1** are quick wins.
- **PM/Design:** M2/M1 are the largest mobile UX bet; schedule before a mobile-heavy demo.
- **Related:** [`UI_INVENTORY.md`](./UI_INVENTORY.md) for route map and feature coverage.

---

*Last updated from internal UI pass (Dashboard, Inventory Counting, Smart Order).*
