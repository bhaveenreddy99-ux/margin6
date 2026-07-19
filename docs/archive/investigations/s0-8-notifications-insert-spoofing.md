# Investigation — S0-8: `notifications` INSERT allows forged alerts (no `user_id`/type guard)

> **Date:** 2026-06-23
> **Roadmap item:** S0-8 (P0 Security), [trust-first-roadmap.md](../trust-first-roadmap.md)
> **Workflow step:** STEP 2 — Investigate ([engineering-workflow.md](../engineering-workflow.md))
> **Status:** Investigation complete — no code changed.
> **Note:** This is the **most involved** P0 — unlike S0-5/6/7 (migration-only), the legitimate flows here are **cross-user client inserts**, so the fix must **route creation through a server-mediated path** (RPC), not just tighten RLS. Touches client code + a new RPC + the RLS policy.

## 1. Summary

The `notifications` INSERT policy is `WITH CHECK (is_member_of(restaurant_id))` — **any restaurant member can insert a notification for any `user_id`, of any `type` and `severity`, with arbitrary `data`** ([20260306000003:198-200](../../supabase/migrations/20260306000003_rls_settings_notifications.sql#L198)). There is no `auth.uid() = user_id` check, no role check, and no type/severity constraint. The policy comment ("e.g. to alert a colleague") shows cross-user insert is **intentional by design** — which is exactly why a naive self-only tightening would break real features.

Two concrete abuses (role-permission-matrix **G5**):
1. **Forged alerts to any user** — a member (incl. STAFF, or a compromised account) can insert a `severity:"CRITICAL"` notification addressed to the owner (phishing/spoofing inside the app).
2. **KPI pollution** — a member can insert `SHRINK_ALERT` / `COUNT_VARIANCE` rows with arbitrary `data.items[].dollar_impact`, which **directly inflates the Shrinkage KPI** (§5). This is the dependency that makes kpi-source-of-truth's "Shrinkage = UNSAFE" (and roadmap **T0-7**) blocked on S0-8.

## 2. Current `notifications` policies (verified)

[20260306000003:188-209](../../supabase/migrations/20260306000003_rls_settings_notifications.sql#L188):
```sql
CREATE POLICY "Users can view own notifications"     -- SELECT,  auth.uid() = user_id     ✅ self-only
CREATE POLICY "Members can create notifications"     -- INSERT,  is_member_of(restaurant_id)  ← LEAK: any member, any user_id/type/severity
CREATE POLICY "Users can update own notifications"    -- UPDATE,  auth.uid() = user_id (USING+CHECK) ✅ self-only
-- (no DELETE policy)
```
SELECT and UPDATE are correctly self-scoped; **INSERT is the hole.** RLS is enabled (the policies exist and apply). There is a `BEFORE INSERT` dedupe trigger ([20260522000002](../../supabase/migrations/20260522000002_notification_dedup.sql)) that drops duplicate `(restaurant_id, user_id, type)` within 1h — it fires on **all** inserts (including server/RPC), so it composes with any fix.

## 3. Who legitimately creates notifications (verified)

**A. Server-side (service-role / `verify_jwt`-gated → bypass RLS; the trusted path):**
| Creator | Types | Auth |
|---------|-------|------|
| `process-notifications` (cron) | LOW_STOCK, REMINDER, SCHEDULE_OVERDUE, **SHRINK_ALERT**, **COUNT_VARIANCE**, WEEKLY_DIGEST, HIGH_USAGE | service-role (gated by S0-2) |
| `dispatch-app-notifications` (edge, `verify_jwt=true`) | COUNT_SUBMITTED, COUNT_APPROVED, SMART_ORDER_READY | service-role |
| `inbound-invoice-email` (edge) | INVOICE_PARSED/FAILED, MISSING_ITEMS | service-role (gated by S0-3) |
| invoice price-sync (DB) | PRICE_INCREASE | trigger/RPC |

These **bypass RLS** and are unaffected by an INSERT-policy change. **All KPI-relevant types (SHRINK_ALERT, COUNT_VARIANCE) are created here only.**

**B. Client-side, cross-user direct inserts (subject to RLS — the at-risk surface). Exactly four, verified exhaustively:**
| # | Site | Type | Severity | Recipients | Caller |
|---|------|------|----------|-----------|--------|
| 1 | [useManagerCommands.ts:209](../../src/features/inventory-count/hooks/useManagerCommands.ts#L209) | `PAR_CHANGE_REQUEST` | INFO | OWNER/MANAGER | **STAFF** (on `/inventory/enter`, not StaffRestricted) |
| 2 | [useManagerCommands.ts:263](../../src/features/inventory-count/hooks/useManagerCommands.ts#L263) | `PRICE_CHANGE_REQUEST` | INFO | OWNER/MANAGER | **STAFF** |
| 3 | [PARSuggestions.tsx:427](../../src/pages/app/PARSuggestions.tsx#L427) | `PAR_SUGGESTIONS` | INFO/varies | recipients | Manager+ (StaffRestricted page) |
| 4 | [smartOrderFromSession.ts:100](../../src/domain/inventory/smartOrderFromSession.ts#L100) | `LOW_STOCK` | CRITICAL/WARNING | OWNER/MANAGER/ALL/CUSTOM | approver (Manager+) during approval |

**All four are cross-user** (insert for other members), which is why `auth.uid() = user_id` self-only cannot be the fix — it would break STAFF→manager PAR/price requests, low-stock alerts, and PAR-suggestion alerts.

## 4. Should edge/RPC be the only creators? (answer: yes)

Yes. The trusted model (per CLAUDE.md "RPCs must enforce permissions; never trust UI") is **server-mediated creation**. Server functions already create the sensitive types; the four client paths are the gap. The roadmap dependency note for S0-8 — *"route real creates via RPC/edge"* — is exactly this. The fix: route the four legitimate client creates through a **`SECURITY DEFINER` RPC** that validates and constrains, then **remove the direct client INSERT policy** so no member can `INSERT` notifications directly. (A new edge function is unnecessary — these four are pure DB inserts with no email; emails are sent by the cron. An RPC is simpler, transactional, and testable.)

## 5. How shrinkage / alert KPIs depend on notifications (verified)

- **Shrinkage KPI** ([loadShrinkageValue.ts:21-44](../../src/domain/dashboard/loadShrinkageValue.ts#L21)) sums `data.items[].dollar_impact` across **`SHRINK_ALERT` + `COUNT_VARIANCE`** notifications in the period. Because INSERT is member-open, any member can forge these rows with arbitrary `dollar_impact` → **directly inflates the dashboard shrinkage dollar** (kpi-source-of-truth §14, "member-writable source"). Also read by `loadProfitLeaks.ts:309`, `priceIncreaseFromNotifications.ts:82` (PRICE_INCREASE), and the weekly digest.
- **Alert integrity** — `useNotifications`/`ShrinkageAlertCard` render whatever rows are addressed to the user; forged CRITICAL rows look identical to real ones.
- **Fix impact:** restricting the **client** path to a type allowlist that **excludes `SHRINK_ALERT`/`COUNT_VARIANCE`** (and other server-only types) removes the client KPI-pollution vector entirely; those types remain creatable only by the (trusted) server. This is the prerequisite the Shrinkage KPI needs before it can be trusted (T0-7).

## 6. Root cause

When notifications RLS was consolidated (`20260306000003`), INSERT was deliberately left at `is_member_of` to support "alert a colleague" cross-user sends, but with **no constraint on recipient legitimacy, type, severity, or `data`**, and **no server mediation** — so the same open door that enables a STAFF PAR-request-to-manager also enables forging CRITICAL alerts and KPI-polluting shrink rows.

## 7. Business impact

- **In-app phishing/spoofing** — forged CRITICAL alerts to the owner/managers erode trust in every alert.
- **Corrupted Shrinkage / loss KPIs** — forged SHRINK/variance rows inflate a "verified loss" figure (violates Money Rules; this is why Shrinkage is currently unsafe to show).
- **Trust violation** — CLAUDE.md "never trust UI permissions"; P0 pilot gate; blocks T0-7.

## 8. User impact

- Owners could receive convincing fake alerts and see inflated shrinkage dollars.
- **No legitimate flow is lost under the RPC routing** (the four real flows keep working through the RPC) — STAFF can still request PAR/price changes; approvals still alert managers.

## 9. Affected components

| Layer | File | Note |
|-------|------|------|
| RLS (target) | [20260306000003:198-200](../../supabase/migrations/20260306000003_rls_settings_notifications.sql#L198) | drop/lock down the member INSERT policy |
| New RPC | new migration | `SECURITY DEFINER` validated creator (allowlist + recipient/membership checks + provenance) |
| Client (route to RPC) | useManagerCommands.ts (×2), PARSuggestions.tsx, smartOrderFromSession.ts | replace `.from("notifications").insert()` with `supabase.rpc(...)` |
| Tests | `smart-order-from-session.test.ts` (mocks the insert) + new RPC contract notes | update |
| Server creators (unaffected) | process-notifications, dispatch-app-notifications, inbound-invoice-email | service-role bypass |
| Dedupe trigger (composes) | 20260522000002 | still fires on RPC inserts |

## 10. Affected tables

`notifications` (RLS + creation path). No schema/column change. `notification_preferences` is a **separate** over-broad-write item (G14 / S1-5, P1) — **out of S0-8 scope** (noted, not fixed here).

## 11. Migration & code risk

- **R1 — miss a client insert site → it breaks** once the INSERT policy is dropped. Mitigated: exhaustive grep found **exactly four** `.from("notifications").insert(` sites; all four are migrated. Re-verify at implementation.
- **R2 — RPC over/under-restricts.** Allowlist must include the four real types (`PAR_CHANGE_REQUEST`, `PRICE_CHANGE_REQUEST`, `PAR_SUGGESTIONS`, `LOW_STOCK`) and exclude server-only/KPI types. Recipient must be a member.
- **R3 — `SECURITY DEFINER` correctness.** `auth.uid()` is the caller inside the RPC; validate membership before insert; `set search_path = public`.
- **R4 — residual (accepted):** a member can still create an allowlisted, benign cross-user notification (e.g., a fake LOW_STOCK or a PAR request) with custom text — mild same-restaurant spam, **not** KPI pollution or arbitrary-type/CRITICAL forging. Server-side templating could harden this later (follow-up).
- **Rollback:** revert the migration (restores the `is_member_of` INSERT policy and drops the RPC) **and** the client changes together — they are co-dependent (client calls the RPC). If only the migration is reverted, the client RPC calls 404 (notifications fail, non-fatal toasts). So **rollback = revert the whole S0-8 commit.** No data touched (no rows altered). (Rollback re-opens the leak.)

## 12. Open questions for the plan

1. **After routing, drop the client INSERT policy entirely** (recommended — nothing legitimately self-inserts) **or** keep `auth.uid() = user_id` self-only? — decision.
2. **Confirm the client type allowlist** (the four observed types). — recommend yes.
3. (Out of scope, note only) `notification_preferences` over-broad write (S1-5) and the dedupe-ignores-`data` issue (T1-6) — not S0-8.
4. Testability: RPC via SQL matrix; client via vitest (update mocks) + tsc; RLS deny of direct insert via SQL.

## 13. Dependencies / sequencing

GATE green. **Unblocks T0-7** (re-source/trust Shrinkage) once SHRINK/variance are server-only. Larger than S0-5/6/7 (client + RPC + RLS). Last Phase-1 P0 item.

> No application code was modified in producing this investigation.
