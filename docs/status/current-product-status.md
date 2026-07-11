# Current product status

**Verification date:** 2026-07-11  
**Git branch (status baseline):** `main` @ `7750750`  
**Supabase project:** `margin6` · ref `ogbnctyctoujzdcfphad` · Postgres 17 · `us-east-1`

**Readiness label:** **Internal-demo ready** — suitable for controlled demos and local/staging validation. **Not commercial-ready.**

---

## What works

| Area | Evidence |
|------|----------|
| Auth (login, signup, reset) | `src/pages/Login.tsx`, `Signup.tsx`, `AuthContext` |
| Onboarding | `create_restaurant_with_owner`, `CreateRestaurant.tsx` |
| Multi-restaurant + locations | `RestaurantContext`, `user_location_assignments` |
| Secure invites | `restaurant_invites`, `AcceptInvite.tsx`, `send-invite` edge, `sendTeamInvite.ts` |
| Inventory count + zones | `InventoryCountPage`, `inventory_session_item_zones` |
| Count approval → smart order | `approve_inventory_session_atomic` |
| Smart order → PO | `submit_smart_order`, `SmartOrder.tsx` |
| Invoice intake / review | `InvoiceReview.tsx`, `parse-invoice` edge |
| Receipt confirm RPC | `confirm_invoice_receipt` (Manager+ gate in RPC) |
| Waste log | `WasteLog.tsx` |
| Staff financial isolation (dashboard route) | `DashboardRouter.tsx` → `EmployeeDashboard` |
| Domain tests + build | `npm run test`, `npm run build` per `docs/system-audit/00-executive-summary.md` |

---

## What is partial

| Area | Notes |
|------|-------|
| Manager experience | Reuses owner money dashboard; no dedicated operations worklist |
| Team settings | Secure invite send wired; `/app/settings` still **OwnerRoute** — managers blocked |
| Legacy + secure invites | Both active; `accept_user_invites` on boot; legacy `invitations` rows on prod |
| Dashboard KPIs | LoadOutcome on loaders; UI still mixes error/empty/zero in places |
| Subscription | `resolveEntitlement` logic exists; **enforcement not wired** |
| Playwright | Large suite exists; **not fully in CI** |
| Generated Supabase types | Missing some invite RPCs/table types |

---

## What is unsafe (do not claim fixed)

| Issue | Severity |
|-------|----------|
| Manager can list/read unassigned **locations** (prod RLS) | P1 security |
| Anon EXECUTE on sensitive RPCs (prod grants drift) | P1 security |
| Manager cost data may appear in API responses | P1 privacy |
| Price-increase KPI double-count suspected | P1 trust |
| Money Lost mixes period flow + point-in-time stock | P1 trust |
| Legacy invite tables + plaintext-token era paths | P2 security debt |
| `purchase_orders` vs `purchase_history` fragmentation | P2 workflow |

Details: [`known-blockers.md`](known-blockers.md), [`production-drift.md`](production-drift.md), [`../system-audit/`](../system-audit/).

---

## What should be hidden or de-emphasized (pilot scope)

Per founder decision, **outside trusted pilot scope** until repair epics complete:

- Food Cost %, Sales, P&L, Money Lost aggregate, blended Profit Risk as **trusted** numbers
- Shrinkage **dollar** KPI (unverified notification math)
- Commercial readiness claims, “complete RLS isolation,” “trusted three-way match”

UI may still show some of these with low confidence — treat as **demo-only**, not contractual truth.

---

## Current repair priority

1. Backend financial and location authorization  
2. Receipt confirmation trust  
3. Counted-zero vs uncounted semantics  
4. GitHub/Supabase reproducibility  
5. Dashboard formula alignment  

Full ordered list: [`known-blockers.md`](known-blockers.md)

---

## No-new-feature rule

Do not start manager dashboard, employee task system, Exception Inbox, credit recovery, POS, recipes, or net-new KPI surfaces until the **approved trust/isolation epic** is complete and production-verified.

---

## How to refresh this document

Re-run verification against `main`, live Supabase (read-only), and `npm run test` / `npm run build`. Update the verification date and commit hash. Do not copy pass counts from memory or archived reports.
