-- =============================================================================
-- Invoice Line Total Variance
--
-- 1. Adds persisted PO/invoice line totals and generated total_diff to
--    invoice_line_comparisons.
-- 2. Extends invoice comparison statuses with total_mismatch.
-- 3. Backfills existing rows and re-derives statuses with the same percentage-
--    aware thresholds used by the review UI.
-- 4. Updates delivery-issue helper functions to include line-total mismatches.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. Persist line totals alongside qty/unit cost comparisons
-- -----------------------------------------------------------------------------
ALTER TABLE public.invoice_line_comparisons
  ADD COLUMN IF NOT EXISTS po_total_cost numeric,
  ADD COLUMN IF NOT EXISTS invoiced_total_cost numeric;

UPDATE public.invoice_line_comparisons AS ilc
SET
  po_total_cost = COALESCE(
    ilc.po_total_cost,
    CASE
      WHEN ilc.po_qty IS NOT NULL AND ilc.po_unit_cost IS NOT NULL
        THEN ilc.po_qty * ilc.po_unit_cost
      ELSE NULL
    END
  ),
  invoiced_total_cost = COALESCE(
    ilc.invoiced_total_cost,
    COALESCE(
      (
        SELECT phi.total_cost
        FROM public.purchase_history_items AS phi
        WHERE phi.id = ilc.purchase_history_item_id
      ),
      CASE
        WHEN ilc.invoiced_qty IS NOT NULL AND ilc.invoiced_unit_cost IS NOT NULL
          THEN ilc.invoiced_qty * ilc.invoiced_unit_cost
        ELSE NULL
      END
    )
  );

ALTER TABLE public.invoice_line_comparisons
  ADD COLUMN IF NOT EXISTS total_diff numeric
  GENERATED ALWAYS AS (invoiced_total_cost - po_total_cost) STORED;


-- -----------------------------------------------------------------------------
-- 2. Extend status constraint with total_mismatch
-- -----------------------------------------------------------------------------
ALTER TABLE public.invoice_line_comparisons
  DROP CONSTRAINT IF EXISTS invoice_line_comparisons_status_check;

ALTER TABLE public.invoice_line_comparisons
  ADD CONSTRAINT invoice_line_comparisons_status_check
  CHECK (status IN (
    'ok',
    'qty_mismatch',
    'price_mismatch',
    'total_mismatch',
    'missing_from_invoice',
    'extra_on_invoice',
    'unmatched'
  ));


-- -----------------------------------------------------------------------------
-- 3. Re-derive existing statuses using the shared tolerance rules
--    qty:   > 0.01 absolute and > 0.5%
--    price: > 0.01 absolute and > 1.0%
--    total: > 1.00 absolute and > 1.0%
-- -----------------------------------------------------------------------------
UPDATE public.invoice_line_comparisons AS ilc
SET status = CASE
  WHEN ilc.status IN ('missing_from_invoice', 'extra_on_invoice', 'unmatched') THEN ilc.status
  WHEN ilc.po_qty IS NOT NULL
    AND ilc.invoiced_qty IS NOT NULL
    AND ABS(ilc.invoiced_qty - ilc.po_qty) > 0.01
    AND CASE
      WHEN GREATEST(ABS(ilc.invoiced_qty), ABS(ilc.po_qty)) > 0
        THEN (ABS(ilc.invoiced_qty - ilc.po_qty) / GREATEST(ABS(ilc.invoiced_qty), ABS(ilc.po_qty))) * 100
      ELSE 0
    END > 0.5
    THEN 'qty_mismatch'
  WHEN ilc.po_unit_cost IS NOT NULL
    AND ilc.invoiced_unit_cost IS NOT NULL
    AND ABS(ilc.invoiced_unit_cost - ilc.po_unit_cost) > 0.01
    AND CASE
      WHEN GREATEST(ABS(ilc.invoiced_unit_cost), ABS(ilc.po_unit_cost)) > 0
        THEN (ABS(ilc.invoiced_unit_cost - ilc.po_unit_cost) / GREATEST(ABS(ilc.invoiced_unit_cost), ABS(ilc.po_unit_cost))) * 100
      ELSE 0
    END > 1.0
    THEN 'price_mismatch'
  WHEN ilc.po_total_cost IS NOT NULL
    AND ilc.invoiced_total_cost IS NOT NULL
    AND ABS(ilc.invoiced_total_cost - ilc.po_total_cost) > 1.00
    AND CASE
      WHEN GREATEST(ABS(ilc.invoiced_total_cost), ABS(ilc.po_total_cost)) > 0
        THEN (ABS(ilc.invoiced_total_cost - ilc.po_total_cost) / GREATEST(ABS(ilc.invoiced_total_cost), ABS(ilc.po_total_cost))) * 100
      ELSE 0
    END > 1.0
    THEN 'total_mismatch'
  ELSE 'ok'
END;


-- -----------------------------------------------------------------------------
-- 4. notify_delivery_issues(p_purchase_history_id uuid) → jsonb
--    Include line-total mismatches alongside missing, partial, and price gaps.
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
  v_total       bigint;
  v_severity    text;
  v_title       text;
  v_message     text;
  v_data        jsonb;
  v_notified    integer := 0;
  v_member      RECORD;
  v_parts       text[];
BEGIN
  SELECT * INTO v_ph
  FROM public.purchase_history
  WHERE id = p_purchase_history_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Purchase order not found';
  END IF;

  IF NOT is_member_of(v_ph.restaurant_id) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  SELECT
    COUNT(*) FILTER (
      WHERE status = 'missing_from_invoice'
    )                                                            AS missing_count,
    COUNT(*) FILTER (
      WHERE status = 'qty_mismatch' AND qty_diff < 0
    )                                                            AS partial_count,
    COUNT(*) FILTER (
      WHERE status = 'price_mismatch' AND ABS(cost_diff) > 1.00
    )                                                            AS price_count,
    COUNT(*) FILTER (
      WHERE status = 'total_mismatch' AND ABS(total_diff) > 1.00
    )                                                            AS total_count
  INTO v_missing, v_partial, v_price, v_total
  FROM public.invoice_line_comparisons
  WHERE purchase_history_id = p_purchase_history_id
    AND catalog_item_id IS NOT NULL;

  IF COALESCE(v_missing, 0) + COALESCE(v_partial, 0) + COALESCE(v_price, 0) + COALESCE(v_total, 0) = 0 THEN
    RETURN jsonb_build_object(
      'notified', 0,
      'reason',   'no_qualifying_issues'
    );
  END IF;

  v_severity := CASE WHEN v_missing > 0 THEN 'CRITICAL' ELSE 'WARNING' END;

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
  IF v_total > 0 THEN
    v_parts := array_append(v_parts, v_total || ' line-total gap' || CASE WHEN v_total > 1 THEN 's' ELSE '' END);
  END IF;

  v_title   := 'Delivery Issues Detected';
  v_message := array_to_string(v_parts, ', ')
               || CASE WHEN v_ph.po_number IS NOT NULL
                        THEN ' on ' || v_ph.po_number
                        ELSE '' END
               || '. Review the invoice to resolve.';

  v_data := jsonb_build_object(
    'purchase_history_id',   p_purchase_history_id,
    'po_number',             v_ph.po_number,
    'missing_count',         COALESCE(v_missing, 0),
    'partial_count',         COALESCE(v_partial, 0),
    'price_mismatch_count',  COALESCE(v_price, 0),
    'total_mismatch_count',  COALESCE(v_total, 0)
  );

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
    ON CONFLICT DO NOTHING;

    v_notified := v_notified + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'notified',              v_notified,
    'missing_count',         COALESCE(v_missing, 0),
    'partial_count',         COALESCE(v_partial, 0),
    'price_mismatch_count',  COALESCE(v_price, 0),
    'total_mismatch_count',  COALESCE(v_total, 0)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.notify_delivery_issues(uuid) TO authenticated;


-- -----------------------------------------------------------------------------
-- 5. get_delivery_issue_pos(p_restaurant_id uuid)
--    Include total_mismatch rows in the unresolved issue banner count.
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
    ph.id            AS purchase_history_id,
    ph.po_number     AS po_number,
    COUNT(*)::bigint AS issue_count
  FROM public.purchase_history AS ph
  JOIN public.invoice_line_comparisons AS ilc
    ON ilc.purchase_history_id = ph.id
  WHERE ph.restaurant_id = p_restaurant_id
    AND ilc.catalog_item_id IS NOT NULL
    AND ph.receipt_status != 'confirmed'
    AND (
      ilc.status = 'missing_from_invoice'
      OR (ilc.status = 'qty_mismatch'   AND ilc.qty_diff < 0)
      OR (ilc.status = 'price_mismatch' AND ABS(ilc.cost_diff) > 1.00)
      OR (ilc.status = 'total_mismatch' AND ABS(ilc.total_diff) > 1.00)
    )
  GROUP BY ph.id, ph.po_number
  ORDER BY COUNT(*) DESC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_delivery_issue_pos(uuid) TO authenticated;


NOTIFY pgrst, 'reload schema';
