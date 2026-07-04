-- S0-5: Restrict inventory_sessions / inventory_session_items DELETE.
--
-- Problem: the DELETE policy on inventory_sessions was `is_member_of(restaurant_id)`
-- (any member, ANY status), so STAFF could delete APPROVED/IN_REVIEW count history
-- via the API — the immutable basis of inventory value, overstock, and reorder math.
-- (Migration 20260222022439 widened the original IN_PROGRESS-only rule to all statuses
-- without a role split.) The child table inventory_session_items had the same open
-- DELETE, so locking the session row alone would still let STAFF empty an approved
-- session's line items.
--
-- Fix (Model B — mirrors the existing UPDATE split and the original 20260219140640 intent):
--   * OWNER/MANAGER may delete ANY session.
--   * A non-manager member may delete ONLY their restaurant's IN_PROGRESS sessions
--     (preserves the STAFF "Clear my in-progress draft" workflow).
-- The same rule is applied to inventory_session_items via the parent session's
-- restaurant + status, so neither path can destroy approved/review count data.
--
-- Reuses existing helpers has_restaurant_role_any / is_member_of. No app/UI change.

-- ── inventory_sessions ──────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Members can delete sessions" ON public.inventory_sessions;
-- Legacy name (already superseded historically) — dropped defensively for idempotency.
DROP POLICY IF EXISTS "Members can delete in-progress sessions" ON public.inventory_sessions;

CREATE POLICY "Delete sessions: manager+ or own in-progress"
  ON public.inventory_sessions FOR DELETE TO authenticated
  USING (
    has_restaurant_role_any(restaurant_id, ARRAY['OWNER'::public.app_role, 'MANAGER'::public.app_role])
    OR (is_member_of(restaurant_id) AND status = 'IN_PROGRESS')
  );

-- ── inventory_session_items (same rule via parent session's restaurant + status) ──
DROP POLICY IF EXISTS "Members can delete session items" ON public.inventory_session_items;

CREATE POLICY "Delete session items: manager+ or in-progress"
  ON public.inventory_session_items FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.inventory_sessions s
      WHERE s.id = inventory_session_items.session_id
        AND (
          has_restaurant_role_any(s.restaurant_id, ARRAY['OWNER'::public.app_role, 'MANAGER'::public.app_role])
          OR (is_member_of(s.restaurant_id) AND s.status = 'IN_PROGRESS')
        )
    )
  );

NOTIFY pgrst, 'reload schema';
