-- S0-INFRA (Phase A): canonical server-side authorization helpers.
--
-- ADDITIVE ONLY — adds functions; enforces nothing yet. No table/policy/column
-- changes, no behavior change. These become the single source of truth that
-- future consumers (S0-4 submit_smart_order, S0-9 confirm_invoice_receipt,
-- S1-1 cost visibility, S1-6 PAR, S1-7 flags-for-real) call, so permission
-- logic is never re-implemented per fix (CLAUDE.md: do not duplicate permission
-- systems).
--
-- Parity contract: these mirror src/hooks/useLocationPermissions.ts exactly —
--   * OWNER  ⇒ every flag true, approval threshold unlimited (null).
--   * others ⇒ the per-location user_location_assignments flag; NO assignment ⇒
--              all false (mirrors the hook's `allDenied`).
--   * MANAGER is NOT auto-granted flags (the hook only short-circuits OWNER).
-- A TS parity matrix (src/test/authz-parity.test.ts) pins this contract.
--
-- Helpers take an explicit p_uid (consistent with the existing location-helper
-- family user_can_access_location / get_location_permissions) and resolve role
-- against restaurant_members directly (the canonical role source). Consumers
-- pass auth.uid() as p_uid.

-- ── has_location_permission ────────────────────────────────────────────────
-- Effective value of a per-location boolean permission flag for a user.
CREATE OR REPLACE FUNCTION public.has_location_permission(
  p_uid uuid,
  p_location_id uuid,
  p_flag text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
DECLARE
  v_val boolean;
BEGIN
  IF p_uid IS NULL OR p_location_id IS NULL THEN
    RETURN false;
  END IF;

  -- Whitelist the flag name (prevents column injection; surfaces caller bugs).
  IF p_flag NOT IN (
    'can_approve_orders', 'can_see_costs', 'can_see_food_cost_pct',
    'can_see_inventory_value', 'can_edit_par'
  ) THEN
    RAISE EXCEPTION 'has_location_permission: unknown flag %', p_flag;
  END IF;

  -- OWNER of the location's restaurant ⇒ all flags true.
  IF EXISTS (
    SELECT 1
    FROM public.locations l
    JOIN public.restaurant_members rm ON rm.restaurant_id = l.restaurant_id
    WHERE l.id = p_location_id
      AND rm.user_id = p_uid
      AND rm.role = 'OWNER'::public.app_role
  ) THEN
    RETURN true;
  END IF;

  -- Otherwise read the per-location assignment flag; no assignment ⇒ false.
  SELECT CASE p_flag
    WHEN 'can_approve_orders'      THEN ula.can_approve_orders
    WHEN 'can_see_costs'           THEN ula.can_see_costs
    WHEN 'can_see_food_cost_pct'   THEN ula.can_see_food_cost_pct
    WHEN 'can_see_inventory_value' THEN ula.can_see_inventory_value
    WHEN 'can_edit_par'            THEN ula.can_edit_par
  END
  INTO v_val
  FROM public.user_location_assignments ula
  WHERE ula.user_id = p_uid
    AND ula.location_id = p_location_id;

  RETURN COALESCE(v_val, false);
END;
$$;

-- ── can_approve_order_amount ───────────────────────────────────────────────
-- Can the user approve/submit an order of p_amount? Mirrors the SmartOrder UI
-- gate: can_approve_orders AND (threshold null ⇒ unlimited; else amount<=threshold).
-- OWNER ⇒ unlimited. p_location_id may be null (non-owner with no location ⇒ false).
CREATE OR REPLACE FUNCTION public.can_approve_order_amount(
  p_uid uuid,
  p_restaurant_id uuid,
  p_location_id uuid,
  p_amount numeric
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
DECLARE
  v_threshold numeric;
BEGIN
  IF p_uid IS NULL THEN
    RETURN false;
  END IF;

  -- OWNER ⇒ unlimited approval (works regardless of location).
  IF EXISTS (
    SELECT 1
    FROM public.restaurant_members rm
    WHERE rm.restaurant_id = p_restaurant_id
      AND rm.user_id = p_uid
      AND rm.role = 'OWNER'::public.app_role
  ) THEN
    RETURN true;
  END IF;

  -- Non-owner needs a location assignment granting the approve flag.
  IF p_location_id IS NULL THEN
    RETURN false;
  END IF;
  IF NOT public.has_location_permission(p_uid, p_location_id, 'can_approve_orders') THEN
    RETURN false;
  END IF;

  -- Threshold: null ⇒ unlimited; else amount must be within it (== threshold passes).
  SELECT ula.order_approval_threshold
  INTO v_threshold
  FROM public.user_location_assignments ula
  WHERE ula.user_id = p_uid
    AND ula.location_id = p_location_id;

  RETURN v_threshold IS NULL OR p_amount <= v_threshold;
END;
$$;

-- ── can_confirm_receipt ────────────────────────────────────────────────────
-- Who may confirm invoice receipt: Manager+ (OWNER or MANAGER) of the restaurant.
-- (No per-location "receiving" flag exists today; this is a pure role rule.)
CREATE OR REPLACE FUNCTION public.can_confirm_receipt(
  p_uid uuid,
  p_restaurant_id uuid
)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT p_uid IS NOT NULL AND EXISTS (
    SELECT 1
    FROM public.restaurant_members rm
    WHERE rm.restaurant_id = p_restaurant_id
      AND rm.user_id = p_uid
      AND rm.role = ANY (ARRAY['OWNER'::public.app_role, 'MANAGER'::public.app_role])
  );
$$;

-- ── Grants: authenticated only; never anon/public ──────────────────────────
REVOKE ALL ON FUNCTION public.has_location_permission(uuid, uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.can_approve_order_amount(uuid, uuid, uuid, numeric) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.can_confirm_receipt(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_location_permission(uuid, uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_approve_order_amount(uuid, uuid, uuid, numeric) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_confirm_receipt(uuid, uuid) TO authenticated;

-- ── Harden the existing (currently dead) permission reader: drop anon (GA-11) ─
-- get_location_permissions was GRANT ALL TO anon; it should never be anon-callable.
REVOKE ALL ON FUNCTION public.get_location_permissions(uuid, uuid) FROM anon;

NOTIFY pgrst, 'reload schema';
