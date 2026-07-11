# 04 — Owner Experience

**Role definition in code:** `restaurant_members.role = 'OWNER'`  
**Route gate:** `OwnerRoute.tsx` for settings/billing/alert sub-routes  
**Dashboard:** Full `Dashboard.tsx` via `DashboardRouter` (same component as MANAGER)

---

## Navigation (owner-visible)

From `AppSidebar.tsx` when `isOwner === true`:

| Group | Items |
|-------|-------|
| Overview | Dashboard, My Restaurants (if ≥2) |
| Inventory | List Management, Inventory Management, PAR, Smart Order, Purchase History |
| Operations | Invoices, Waste Log, Sales Entry |
| Insights | Notifications |
| Admin | Settings, Billing |

---

## Owner capability classification

| Capability | Status | Evidence |
|------------|--------|----------|
| View all restaurant locations | **Working** | OWNER in `user_accessible_location_ids` returns all active locations |
| Cross-location dashboard filter | **Partial** | Header location switcher; portfolio mode in `RestaurantContext` |
| Compare locations side-by-side | **Missing** | No dedicated compare UI |
| Financial KPI dashboard | **Broken (baseline)** | DEF-LOCAL-002: $0 inventory vs $220 DB |
| Profit Risk Identified hero | **Partial** | Renders; sub-rows may error independently |
| Team invite (email) | **Working** | `sendTeamInviteEmail` → `send-invite` edge fn |
| Legacy + new invite listing | **Partial** | `list_invites` + `invitations` merged in Settings |
| Location CRUD | **Working** | Settings → Locations (ownerOnly section) |
| Manager permission assignment | **Working** | `user_location_assignments` flags in Settings |
| Audit Center | **UI only** | Route exists; baseline not executed |
| Billing / Stripe | **Partial** | `Billing.tsx`, `create-checkout-session`; trial columns on restaurants |
| Approve counts | **Working** | Same as manager; RPC enforces MANAGER+ |
| Approve high-value orders | **Working** | OWNER unlimited in `can_approve_order_amount` |
| Override approved count reopen | **Partial** | Blocked when downstream PO/invoice exists |
| Delete restaurant | **UI exists** | Danger zone in Settings; `delete_restaurant_cascade` RPC |
| Invoice email address | **Working** | Created on restaurant create flow |
| Alert preferences | **UI exists** | `/app/settings/alerts` |
| Reports tab | **Partial** | Inside Dashboard Reports tab; permission-gated subset |

---

## Dashboard KPI reference

| KPI label | Formula source | Tables | Location scope | Permission gate | Confidence | Tests | Status |
|-----------|----------------|--------|----------------|-----------------|------------|-------|--------|
| Profit Risk Identified | Sum of 4 rows | Composite | Current location filter | None | Partial-failure note | dashboard-trust-* | **Partial** |
| Recorded waste | `dollarsForWasteRow` | waste_log, catalog | Period filter | None | — | load-waste-metrics | **Unverified UI** |
| Price increase impact | `linePriceIncreaseImpact` + notifications | invoices, comparisons, notifications | Period | None | — | load-spend-metrics | **Broken card** (DEF-LOCAL-009) |
| Cash tied up above PAR | `computeLineOverstockValue` | approved session items | Latest APPROVED session | None | data-quality | load-inventory-metrics | **Partial** |
| Shrinkage alerts | Sum notification dollar_impact | notifications | Period | None | — | load-shrinkage-value | **Partial** |
| Critical low stock | RED band count | session items | Latest session | None | — | load-inventory-metrics | **Partial** |
| Reorder needed today | `totalReorderValue` | session items | Latest session | None | — | load-inventory-metrics | **Partial** |
| Inventory value | Σ on_hand × unit_cost | session items | Latest APPROVED | **`can_see_inventory_value`** | computeKpiConfidence | load-inventory-metrics | **Broken** ($0) |
| Last count | Latest APPROVED date | inventory_sessions | Location | None | — | load-inventory-metrics | **Partial** |
| Food cost % | spend / weekly_sales | invoices, weekly_sales | Period + location | **`can_see_food_cost_pct`** | classifyFoodCostStatus | load-food-cost-metrics | **Unverified UI** |
| Pending invoices | Count draft/review | invoices, purchase_history | Restaurant | None | — | load-invoice-metrics | **Partial** |
| Delivery issues | Problem comparison rows | invoice_line_comparisons | Period | None | — | load-spend-metrics | **Partial** |
| Spend overview | Vendor totals | confirmed invoices | Period | None | — | load-spend-metrics | **Partial** |
| Top Profit Risks | Bucketed leaks | waste, comparisons, notifications | Period | None | — | load-profit-leaks | **Partial** |

### Null / failure treatment

- Loader failures set `errors.*` on snapshot; Profit Risk rows show per-row error state
- Catastrophic hook failure → `DEFAULT_SNAPSHOT` + full-page error (`useDashboardData.ts`)
- **Silent zero risk:** Empty approved session or location mismatch may show $0 without error banner (baseline DEF-LOCAL-002 interpreted as aggregation bug, not query failure)

### Double-counting risks

- Price impact: both invoice comparisons AND `PRICE_INCREASE` notifications (dedup intent in RPC; card still empty in baseline)
- Spend: merges `invoices` + legacy `purchase_history`
- Overstock + reorder: same session items, different formulas (not double-summed in hero)

---

## Cross-location access

- **OWNER** sees all active locations in restaurant via SQL helper
- Portfolio summaries: `loadRestaurantPortfolioSummaries.ts` (multi-restaurant owners)
- **No** dedicated owner multi-location exception inbox

---

## Owner vs product intent gap

Owners get a **single-location money dashboard** with rich KPIs but:
- Trust broken on primary metric (inventory value)
- No "did the team fix it?" accountability workflow
- No credit recovery tracking
- No manager performance view
