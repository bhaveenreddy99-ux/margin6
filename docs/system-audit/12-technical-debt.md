# 12 — Technical Debt

---

## Legacy / parallel systems

| Item | Files | Action |
|------|-------|--------|
| Triple invite system | `invitations`, `user_invites`, `restaurant_invites`; `useLocationSettings.ts`, `RestaurantContext.accept_user_invites` | Consolidate on `restaurant_invites` |
| Dual PO model | `purchase_orders` + `purchase_history`; `fetchInvoiceReviewDoc.ts`, `SmartOrder.tsx` delete path | Migrate reads/writes to PO tables |
| Dual receipt RPC | `confirm_invoice_receipt` + `_legacy` | Keep until PH retired |
| POS `orders` table | Schema only; route redirects to invoices | Remove or document dormant |
| Recipe module | `src/domain/recipes/*`, `useRecipeData.ts`; tables dropped `20260502000001` | **Delete dead code** |
| Recipe E2E | `tests/e2e/recipes.smoke.spec.ts` | Remove or skip permanently |

---

## Duplicated logic

| Logic | Locations |
|-------|-----------|
| Order qty cases | `inventory-utils.computeOrderQtyCases` vs `casePlanningEngine.computeSuggestedOrderCases` |
| Price hike impact | `priceIncreaseFromNotifications` vs `dashboardSelectors.linePriceIncreaseImpact` |
| Shrinkage fetch | `loadShrinkageValue.ts` vs `ShrinkageAlertCard.tsx` inline |
| Item name normalize | 4 variants across inventory + invoice domains |
| `KPISnapshot` type | `domain/metrics/types.ts` vs `domain/dashboard/dashboardTypes.ts` |

---

## Overlarge files

| File | Lines (approx) | Risk |
|------|----------------|------|
| `Dashboard.tsx` | 1600+ | Hard to test UI branches |
| `Settings.tsx` | 1600+ | Team + locations + profile monolith |
| `SmartOrder.tsx` | 1100+ | Order submit + display mixed |
| `process-notifications/index.ts` | 1300+ | Cron complexity |

---

## Stale generated artifacts

| Artifact | Issue |
|----------|-------|
| `src/integrations/supabase/types.ts` | Missing `restaurant_invites`, `restaurant_invite_status`; references dropped `recipes` in hooks |
| `dashboard.smoke.spec.ts` | Headings from old dashboard copy |
| Comments referencing "Phase 0/4" | Accurate but scattered |

---

## Mock systems

| System | Evidence |
|--------|----------|
| Vendor import edge fns | `is_mock: true` |
| Demo restaurant | `p_is_demo` flag |
| `DemoRoleSwitcher` | Local role override |

---

## Naming inconsistencies

| Issue | Example |
|-------|---------|
| `computeWasteValue` means overstock | `reorderEngine.ts` |
| `purchase_history_id` param on invoice RPCs | Legacy naming |
| `MAPPED` vs `MATCHED` match_status | Invoice review vs types |
| `restaurant_invite_status` lowercase vs uppercase enums elsewhere | SQL enum |

---

## Unsafe shortcuts

| Shortcut | Risk |
|----------|------|
| Direct table UPDATE for count status (non-approve) | Relies on RLS not RPC audit |
| Optimistic UI on receipt confirm | May desync if RPC partial fail |
| Fire-and-forget `notify_delivery_issues` | Silent failure |
| Import edge shared code into Vitest via Deno file | Breaks typecheck |

---

## Migration notes

- 131 migrations; multiple `CREATE OR REPLACE` on same RPCs (expected)
- No verified duplicate migration timestamps found
- Latest: `20260711000001_get_invite_preview_rpc.sql`

---

## Empty domain placeholders

- `src/domain/alerts/.gitkeep` — no alert domain logic ( lives in notifications + dashboard)
- `src/domain/ordering/.gitkeep`

---

## Dependency / build

- Chunk size warnings on build (>600kB pdf/xlsx bundles)
- ESLint 29 warnings (mostly hooks deps)
