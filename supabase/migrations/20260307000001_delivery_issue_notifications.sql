-- =============================================================================
-- Delivery Issue Notifications
--
-- 1. Patches the invoice_line_comparisons CHECK constraint to include 'unmatched'
--    (fixes a pre-existing silent write-failure bug).
-- 2. Adds a partial unique index on notifications to prevent duplicate
--    DELIVERY_ISSUE notifications per user per PO.
-- 3. Creates notify_delivery_issues(p_purchase_history_id) — called from the
--    frontend after invoice comparisons are first generated.
-- 4. Creates get_delivery_issue_pos(p_restaurant_id) — used by Invoices page
--    and Dashboard to drive the delivery issues banner / action item.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. Fix invoice_line_comparisons status CHECK constraint
--    The original constraint omitted 'unmatched', causing silent INSERTs to fail
--    whenever generateComparisons() wrote rows for unresolvable vendor lines.
-- -----------------------------------------------------------------------------
ALTER TABLE public.invoice_line_comparisons
  DROP CONSTRAINT IF EXISTS invoice_line_comparisons_status_check;

ALTER TABLE public.invoice_line_comparisons
  ADD CONSTRAINT invoice_line_comparisons_status_check
  CHECK (status IN (
    'ok',
    'qty_mismatch',
    'price_mismatch',
    'missing_from_invoice',
    'extra_on_invoice',
    'unmatched'
  ));


-- -----------------------------------------------------------------------------
-- 2. Partial unique index for deduplication
--    Guarantees at most one DELIVERY_ISSUE notification per (user, PO).
--    ON CONFLICT DO NOTHING in notify_delivery_issues relies on this index.
-- -----------------------------------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS uq_notifications_delivery_issue_per_user
  ON public.notifications (user_id, (data->>'purchase_history_id'))
  WHERE type = 'DELIVERY_ISSUE';


-- -----------------------------------------------------------------------------
-- 3. notify_delivery_issues(p_purchase_history_id uuid) → jsonb
--
-- Called after invoice_line_comparisons rows are first written for a PO.
-- Inserts one in-app notification per OWNER/MANAGER for the restaurant.
-- Safe to call multiple times — idempotent via ON CONFLICT DO NOTHING.
--
-- Qualifying issues (catalog-matched lines only):
--   • missing_from_invoice  → item not delivered at all (CRITICAL)
--   • qty_mismatch + qty_diff < 0  → partial delivery (WARNING)
--   • price_mismatch + |cost_diff| > $1.00  → significant price gap (WARNING)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.notify_delivery_issues(
  p_purchase_history_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ph          public.purchase_history%ROWTYPE;
  v_missing     bigint;
  v_partial     bigint;
  v_price       bigint;
  v_severity    text;
  v_title       text;
  v_message     text;
  v_data        jsonb;
  v_notified    integer := 0;
  v_member      RECORD;
  v_parts       text[];
BEGIN
  -- Fetch the purchase history row and authorise the caller.
  SELECT * INTO v_ph
  FROM public.purchase_history
  WHERE id = p_purchase_history_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Purchase order not found';
  END IF;

  IF NOT is_member_of(v_ph.restaurant_id) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  -- Aggregate qualifying issues in a single pass.
  -- qty_diff and cost_diff are STORED generated columns — safe in WHERE.
  SELECT
    COUNT(*) FILTER (
      WHERE status = 'missing_from_invoice'
    )                                                            AS missing_count,
    COUNT(*) FILTER (
      WHERE status = 'qty_mismatch' AND qty_diff < 0
    )                                                            AS partial_count,
    COUNT(*) FILTER (
      WHERE status = 'price_mismatch' AND ABS(cost_diff) > 1.00
    )                                                            AS price_count
  INTO v_missing, v_partial, v_price
  FROM public.invoice_line_comparisons
  WHERE purchase_history_id = p_purchase_history_id
    AND catalog_item_id IS NOT NULL;

  -- Nothing actionable — exit early without creating noise.
  IF COALESCE(v_missing, 0) + COALESCE(v_partial, 0) + COALESCE(v_price, 0) = 0 THEN
    RETURN jsonb_build_object(
      'notified', 0,
      'reason',   'no_qualifying_issues'
    );
  END IF;

  -- Severity: CRITICAL when items are missing entirely, WARNING otherwise.
  v_severity := CASE WHEN v_missing > 0 THEN 'CRITICAL' ELSE 'WARNING' END;

  -- Build a human-readable message from the issue counts.
  v_parts := ARRAY[]::text[];
  IF v_missing > 0 THEN
    v_parts := array_append(v_parts, v_missing || ' missing item' || CASE WHEN v_missing > 1 THEN 's' ELSE '' END);
  END IF;
  IF v_partial > 0 THEN
    v_parts := array_append(v_parts, v_partial || ' partial delivery' || CASE WHEN v_partial > 1 THEN 's' ELSE '' END);
  END IF;
  IF v_price > 0 THEN
    v_parts := array_append(v_parts, v_price || ' price gap' || CASE WHEN v_price > 1 THEN 's' ELSE '' END);
  END IF;

  v_title   := 'Delivery Issues Detected';
  v_message := array_to_string(v_parts, ', ')
               || CASE WHEN v_ph.po_number IS NOT NULL
                        THEN ' on ' || v_ph.po_number
                        ELSE '' END
               || '. Review the invoice to resolve.';

  -- Shared JSONB payload included in every notification's data field.
  v_data := jsonb_build_object(
    'purchase_history_id',  p_purchase_history_id,
    'po_number',            v_ph.po_number,
    'missing_count',        COALESCE(v_missing, 0),
    'partial_count',        COALESCE(v_partial, 0),
    'price_mismatch_count', COALESCE(v_price,   0)
  );

  -- Insert one notification per OWNER/MANAGER; skip silently on conflict.
  FOR v_member IN
    SELECT user_id
    FROM public.restaurant_members
    WHERE restaurant_id = v_ph.restaurant_id
      AND role IN ('OWNER', 'MANAGER')
  LOOP
    INSERT INTO public.notifications (
      restaurant_id,
      location_id,
      user_id,
      type,
      title,
      message,
      severity,
      data
    ) VALUES (
      v_ph.restaurant_id,
      NULL,
      v_member.user_id,
      'DELIVERY_ISSUE',
      v_title,
      v_message,
      v_severity,
      v_data
    )
    ON CONFLICT DO NOTHING;   -- relies on uq_notifications_delivery_issue_per_user

    v_notified := v_notified + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'notified',             v_notified,
    'missing_count',        COALESCE(v_missing, 0),
    'partial_count',        COALESCE(v_partial, 0),
    'price_mismatch_count', COALESCE(v_price,   0)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.notify_delivery_issues(uuid) TO authenticated;


-- -----------------------------------------------------------------------------
-- 4. get_delivery_issue_pos(p_restaurant_id uuid)
--    → TABLE(purchase_history_id uuid, po_number text, issue_count bigint)
--
-- Returns one row per PO that has unresolved delivery issues, ordered by
-- issue_count DESC.  Used by the Invoices page banner and Dashboard action item.
-- Excludes POs where receipt_status = 'confirmed' (already resolved).
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_delivery_issue_pos(
  p_restaurant_id uuid
)
RETURNS TABLE (
  purchase_history_id uuid,
  po_number           text,
  issue_count         bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT is_member_of(p_restaurant_id) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  RETURN QUERY
  SELECT
    ph.id           AS purchase_history_id,
    ph.po_number    AS po_number,
    COUNT(*)::bigint AS issue_count
  FROM public.purchase_history ph
  JOIN public.invoice_line_comparisons ilc
    ON ilc.purchase_history_id = ph.id
  WHERE ph.restaurant_id  = p_restaurant_id
    AND ilc.catalog_item_id IS NOT NULL
    AND ph.receipt_status  != 'confirmed'
    AND (
      ilc.status = 'missing_from_invoice'
      OR (ilc.status = 'qty_mismatch'    AND ilc.qty_diff   <    0)
      OR (ilc.status = 'price_mismatch'  AND ABS(ilc.cost_diff) > 1.00)
    )
  GROUP BY ph.id, ph.po_number
  ORDER BY COUNT(*) DESC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_delivery_issue_pos(uuid) TO authenticated;


NOTIFY pgrst, 'reload schema';
