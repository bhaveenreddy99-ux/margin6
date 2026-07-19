# 09 — Technical Debt Report (Phase 12)

Ranked Critical / High / Medium / Low. Every item is verified in code.

## Critical

### C1 — UI/RLS authorization divergence (systemic)
The UI is, for many write paths, the **only** real gate. Per-location permission flags are cosmetic; many tables are `is_member_of`-writable. A crafted `supabase-js`/REST call bypasses the UI. (See [06 — Security](./06-security-audit.md) M1–M3, M7.) This is architectural debt because the intended permission model is not expressed at the enforcement layer.

### C2 — Legacy `anon` EXECUTE grants + default privileges
Initial-schema grants + `ALTER DEFAULT PRIVILEGES … TO anon` leave many SECURITY DEFINER functions callable by anon, including check-less helpers (`generate_po_number`, `*_restaurant_id`). (Security H1.)

## High

### H1 — Oversized page/component files
Business logic and data access are concentrated in very large components, contrary to the repo's own architecture rules:
| File | LOC |
|---|---|
| `src/pages/app/ListManagement.tsx` | 1831 |
| `src/pages/app/Dashboard.tsx` | 1779 |
| `src/pages/app/Settings.tsx` | 1599 |
| `src/features/inventory-count/components/InventorySessionEditor.tsx` | 1492 |
| `src/hooks/useListManagementActions.ts` | 1425 |
| `src/pages/app/PARManagement.tsx` | 1334 |
| `src/pages/app/SmartOrder.tsx` | 1195 |
| `supabase/functions/process-notifications/index.ts` | 1321 |
These pages also call Supabase directly (deviating from "no data access in pages").

### H2 — No observability
No error tracking (Sentry-style), structured logging, metrics, tracing, or uptime/alerting is wired. Edge functions `console.log`; many best-effort writes ignore Supabase errors, so failures are invisible.

### H3 — Write-path / RLS tests missing
58 vitest files cover **pure domain logic** well; E2E (13 specs) covers happy paths + isolation. There is **no automated test** asserting that RLS blocks cross-role writes or that RPC authorization holds. Security posture is thus regression-prone. (There are SQL tests only for invite RPCs, and an `authz-parity.test.ts`.)

### H4 — Multiple parallel invite systems
`invitations` (+ accept trigger), `user_invites`, and `restaurant_invites` coexist, plus `send-invite` edge fn and `create_invite`/`accept_invite` RPCs and `accept_user_invites`. High confusion/maintenance risk and potential for inconsistent authorization.

### H5 — Stale generated types + casts
`types.ts` omits `restaurants` billing columns and `restaurant_invites`, forcing `as unknown as {...}` casts (`useSubscription.ts`) — violates the "avoid unsafe casts / use Supabase types" rule and hides drift.

## Medium

### M1 — Dead / superseded code
- Recipes (`recipeCostEngine`, `useRecipeData/Actions`) — tables dropped; feature unusable.
- `buildMoneyLeakSnapshot` — only referenced by its test.
- Legacy tables `categories`, `inventory_items`, `par_items`, `orders`, `order_items`, `usage_events`.
- `portfolio-dashboard` edge fn (deprecated) still used by PublicDemo.
- Two category models (legacy vs `list_categories`).

### M2 — Duplicated logic
- `shouldPersistDerivedStatus` exists in `invoiceStatusLifecycle.ts` but is re-implemented inline in `useInvoiceReviewActions.ts`.
- Suggested-order/risk math appears in `inventory-utils.ts`, `casePlanningEngine.ts`, and `itemView.ts` — consistent, but 3 call sites of similar formulas.

### M3 — Domain layer does data access
Several `src/domain/*` modules (`loadInventoryMetrics.ts`, `sessionWorkflow.ts`, dashboard loaders) call Supabase directly, blending pure logic with I/O and complicating unit isolation.

### M4 — Best-effort error handling
`process-notifications`, `matchInvoiceCatalogItems`, and inbound email frequently don't inspect Supabase/fetch errors → silent partial failures.

### M5 — `no-unused-vars` disabled in ESLint
`@typescript-eslint/no-unused-vars: "off"` allows dead variables/imports to accumulate unnoticed.

### M6 — Fixed-offset timezone handling
`process-notifications` uses hard-coded `-5/-6/-7/-8` offsets (no DST) for digest/reminder scheduling — correctness debt.

### M7 — Deprecated dependency risk
`vite.config.ts` chunks `html2canvas` and `jspdf-autotable`, and `xlsx@0.18.5` (a version with known advisories historically) — verify supply-chain currency. `NOT VERIFIED` against an advisory DB here.

## Low

### L1 — `restaurant-logos` bucket public.
### L2 — Marketing/README drift (TanStack "state management", "3-way matching" phrasing, Margin6 vs RestaurantIQ naming).
### L3 — `tsconfig.app.tsbuildinfo` and `.temp/` committed artifacts.
### L4 — Pricing label inconsistency historically noted ($69.99 vs $99).
### L5 — Some `any` casts in `RestaurantContext.fetchRestaurants` (`m: any`).

## Debt themes
1. **Enforcement debt** (C1, C2) is the highest-leverage: align server rules with UI intent.
2. **Structure debt** (H1, M3) — extract logic out of mega-pages per the repo's own skill.
3. **Operational debt** (H2, H3, M4) — observability + write-path tests.
4. **Cleanup debt** (H4, M1, M2, M5) — retire legacy invite/recipe/category paths.
