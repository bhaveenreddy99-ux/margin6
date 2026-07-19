# Plan — S0-8: Route notification creation through a validated RPC; lock down direct INSERT

> **Date:** 2026-06-23
> **Roadmap item:** S0-8 (P0 Security), effort **M** — [trust-first-roadmap.md](../trust-first-roadmap.md)
> **Workflow step:** STEP 3 — Create Plan ([engineering-workflow.md](../engineering-workflow.md))
> **Investigation:** [s0-8-notifications-insert-spoofing.md](../investigations/s0-8-notifications-insert-spoofing.md)
> **Status:** Awaiting approval — **decision required (§2)** — no code changed yet.
> **Scope note:** Unlike S0-5/6/7, this is **not** migration-only — it adds an RPC, changes **4 client call sites**, updates a test, and changes RLS. Migration + client must ship/rollback **together**.

## 1. Root cause (one line)

`notifications` INSERT is `is_member_of(restaurant_id)` with no `user_id`/type/severity guard, so any member can forge alerts to any user and pollute the Shrinkage KPI; the legitimate flows are cross-user, so the fix routes them through a validated `SECURITY DEFINER` RPC and removes the direct client INSERT.

## 2. Decision required

**After routing the 4 client creates through the RPC, what should the RLS INSERT policy be?**
- **(A) Drop the client INSERT policy entirely (recommended)** — no member may `INSERT` directly; all creation goes via the RPC (definer) or server functions (service-role, bypass RLS). Strongest; nothing legitimately self-inserts today.
- **(B) Replace with `auth.uid() = user_id` self-only** — keeps a narrow direct path for future self-notifications. Slightly more permissive; still blocks cross-user forging.

This plan is written for **(A)** + the 4-type allowlist. If you prefer (B), I swap the DROP for a self-only policy.

## 3. Goal & success criteria

**Goal:** members can no longer forge notifications (to others, or KPI-polluting types) via the API; the four legitimate flows keep working through a validated RPC.

Done when:
- Direct client `INSERT notifications` → **blocked** (policy dropped/self-only).
- RPC `create_member_notifications` → inserts only for **member recipients**, only **allowlisted types**, stamps provenance; rejects non-members and disallowed types (esp. `SHRINK_ALERT`/`COUNT_VARIANCE`).
- The 4 client sites use the RPC; PAR/price requests, PAR suggestions, and low-stock approval alerts still arrive.
- Server creators (cron/edge) unchanged.
- CI green (vitest + tsc); RLS/RPC verified via SQL matrix.

## 4. Chosen approach (RPC routing + drop INSERT)

### 4a. New migration `supabase/migrations/<ts>_notifications_create_rpc.sql`
A `SECURITY DEFINER` RPC + RLS lockdown:
```sql
CREATE OR REPLACE FUNCTION public.create_member_notifications(
  p_restaurant_id uuid,
  p_recipient_ids uuid[],
  p_type     text,
  p_severity text,
  p_title    text,
  p_message  text,
  p_data     jsonb DEFAULT '{}'::jsonb
) RETURNS integer            -- # rows attempted (dedupe trigger may drop some)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_caller uuid := auth.uid(); v_count int := 0; v_rid uuid;
BEGIN
  IF v_caller IS NULL OR NOT is_member_of(p_restaurant_id) THEN
    RAISE EXCEPTION 'not a member of this restaurant';
  END IF;
  -- Client-allowed types only — excludes server-only / KPI types
  IF p_type NOT IN ('PAR_CHANGE_REQUEST','PRICE_CHANGE_REQUEST','PAR_SUGGESTIONS','LOW_STOCK') THEN
    RAISE EXCEPTION 'notification type % not allowed from client', p_type;
  END IF;
  FOREACH v_rid IN ARRAY p_recipient_ids LOOP
    IF EXISTS (SELECT 1 FROM restaurant_members m
               WHERE m.restaurant_id = p_restaurant_id AND m.user_id = v_rid) THEN
      INSERT INTO public.notifications (restaurant_id, user_id, type, severity, title, message, data)
      VALUES (p_restaurant_id, v_rid, p_type, p_severity, p_title, p_message,
              coalesce(p_data,'{}'::jsonb) || jsonb_build_object('source_user_id', v_caller));
      v_count := v_count + 1;   -- dedupe trigger may still drop the row
    END IF;
  END LOOP;
  RETURN v_count;
END $$;
REVOKE ALL ON FUNCTION public.create_member_notifications(uuid,uuid[],text,text,text,text,jsonb) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.create_member_notifications(uuid,uuid[],text,text,text,text,jsonb) TO authenticated;

-- Lock down direct client INSERT (Decision A):
DROP POLICY IF EXISTS "Members can create notifications" ON public.notifications;
-- (Decision B alternative would CREATE a self-only INSERT policy here instead.)

NOTIFY pgrst, 'reload schema';
```
Notes: recipients are filtered to members (non-members silently skipped — defensive, mirrors current behavior of sending to resolved member lists); provenance `source_user_id` stamped; severity passed through (LOW_STOCK legitimately uses CRITICAL — type allowlist, not severity, is the guard); the existing dedupe trigger still applies.

### 4b. Client changes (4 sites → RPC)
Replace each `await supabase.from("notifications").insert(rows)` with
`await supabase.rpc("create_member_notifications", { p_restaurant_id, p_recipient_ids, p_type, p_severity, p_title, p_message, p_data })`:
- [useManagerCommands.ts:209](../../src/features/inventory-count/hooks/useManagerCommands.ts#L209) (PAR_CHANGE_REQUEST), [:263](../../src/features/inventory-count/hooks/useManagerCommands.ts#L263) (PRICE_CHANGE_REQUEST)
- [PARSuggestions.tsx:427](../../src/pages/app/PARSuggestions.tsx#L427) (PAR_SUGGESTIONS)
- [smartOrderFromSession.ts:100](../../src/domain/inventory/smartOrderFromSession.ts#L100) (LOW_STOCK)

Each currently builds a per-recipient row array with identical type/title/message/severity/data → maps cleanly to one RPC call with `p_recipient_ids` + shared fields. A tiny client helper (e.g. `domain/notifications/createMemberNotifications.ts`) keeps the call shape consistent and testable. No behavior change for users.

### 4c. Test update
`smart-order-from-session.test.ts` mocks `.from("notifications").insert` — switch the mock to `supabase.rpc` and assert the RPC is called with the right type/recipients.

## 5. Files affected

| # | File | Change | Risk |
|---|------|--------|------|
| 1 | `supabase/migrations/<ts>_notifications_create_rpc.sql` | **New** RPC + drop INSERT policy | Med (definer correctness; exhaustive client migration) |
| 2 | `src/domain/notifications/createMemberNotifications.ts` | **New** thin client wrapper for the RPC | Low |
| 3 | useManagerCommands.ts (×2), PARSuggestions.tsx, smartOrderFromSession.ts | route to RPC | Med (must cover all 4) |
| 4 | `src/test/smart-order-from-session.test.ts` | update mock to RPC | Low |

No schema/column change, no data migration. `notification_preferences` (S1-5) and dedupe-`data` (T1-6) explicitly **out of scope**.

## 6. Risks & mitigations

- **R1 missed client insert** → exhaustive grep = exactly 4 sites; re-verify at implementation before dropping the policy.
- **R2 server creators break** → they use service-role (bypass RLS) and direct INSERT — unaffected by the policy drop (they don't use the RPC).
- **R3 RPC rejects a legit type** → allowlist includes all 4 observed types; SQL matrix covers each.
- **R4 co-dependency** → migration + client ship and roll back **together** (one commit). Documented.
- **R5 dedupe interplay** → RPC inserts pass through the BEFORE INSERT dedupe trigger exactly as today; no change.

## 7. Implementation order

1. Confirm Decision (§2: A vs B) + allowlist.
2. Add migration (RPC + policy lockdown).
3. Add client wrapper; migrate the 4 sites.
4. Update the test mock.
5. `vitest` + `tsc` green; run the SQL matrix at `supabase db reset`/staging.

## 8. Test plan (preview — detailed in STEP 5)

**RPC / RLS (SQL, role-based):**
| Actor | Action | Expected |
|-------|--------|:--------:|
| any member | `rpc create_member_notifications` allowlisted type → member recipients | rows inserted, `source_user_id` stamped |
| any member | rpc with `SHRINK_ALERT` / `COUNT_VARIANCE` / other server type | **rejected** (raises) |
| any member | rpc targeting a non-member `user_id` | that recipient **skipped** |
| non-member | rpc | **rejected** (raises) |
| STAFF | **direct** `INSERT notifications` (forge CRITICAL / SHRINK to any user) | **blocked** by RLS (policy dropped) |
| service-role (cron/edge) | direct INSERT (SHRINK_ALERT, etc.) | allowed (bypass) — unchanged |

Policy-shape assertion: no `INSERT` policy on `notifications` for `authenticated` (Decision A), or only `auth.uid()=user_id` (Decision B); SELECT/UPDATE still self-only.

**Client (vitest + tsc):** updated `smart-order-from-session.test.ts` green; `tsc` clean; the 4 flows compile against the RPC wrapper.

**KPI integrity:** confirm `SHRINK_ALERT`/`COUNT_VARIANCE` can no longer be created by a member (direct INSERT blocked + RPC disallows the type) → Shrinkage KPI input is server-only (unblocks T0-7).

**Manual (post-deploy):** STAFF PAR/price change request still notifies managers; count approval still alerts managers; PAR suggestions still notify.

## 9. Rollback strategy

Co-dependent change → **rollback = revert the whole S0-8 commit** (migration + client together): restores the `is_member_of` INSERT policy and removes the RPC + client calls atomically. No data touched (no rows modified) → instantaneous; nothing to backfill. (Rollback re-opens the leak.)

## 10. Final-review questions to answer at STEP 6

What changed (server-mediated creation + INSERT lockdown) · problem solved (no forged alerts / KPI pollution; unblocks Shrinkage trust) · residual risk (benign same-restaurant spam of allowlisted types; `notification_preferences` still S1-5) · next (Phase-1 P0 complete → S0-INFRA / Phase 2, or T0-7).

> No application code was modified in producing this plan.
