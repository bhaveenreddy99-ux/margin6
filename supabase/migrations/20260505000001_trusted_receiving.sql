-- Phase 4: Trusted Receiving
--
-- 1. invoice_line_comparisons: track whether received_qty was manager-confirmed
-- 2. stock_movements: record original (source) quantity + unit alongside normalized cases
-- 3. Helper: normalize_received_qty_to_cases
-- 4. Updated confirm_invoice_receipt: blocks unconfirmed rows, normalizes to cases

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. invoice_line_comparisons.received_qty_confirmed
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.invoice_line_comparisons
  ADD COLUMN IF NOT EXISTS received_qty_confirmed BOOLEAN DEFAULT false;

COMMENT ON COLUMN public.invoice_line_comparisons.received_qty_confirmed IS
  'True only when a manager/staff explicitly confirmed the received_qty (not auto-filled from invoiced qty).';

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. stock_movements new columns
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.stock_movements
  ADD COLUMN IF NOT EXISTS quantity_unit       TEXT    DEFAULT 'case',
  ADD COLUMN IF NOT EXISTS source_quantity     NUMERIC NULL,
  ADD COLUMN IF NOT EXISTS source_quantity_unit TEXT   NULL,
  ADD COLUMN IF NOT EXISTS conversion_status  TEXT    DEFAULT 'converted_to_case';

COMMENT ON COLUMN public.stock_movements.quantity         IS 'Normalized quantity in CASES — canonical unit for all inventory math.';
COMMENT ON COLUMN public.stock_movements.quantity_unit    IS 'Always ''case'' for movements created by confirm_invoice_receipt.';
COMMENT ON COLUMN public.stock_movements.source_quantity  IS 'Original received quantity as entered/stored (may be in lbs, each, etc.).';
COMMENT ON COLUMN public.stock_movements.source_quantity_unit IS 'Unit of source_quantity (CS, LB, EA, …).';
COMMENT ON COLUMN public.stock_movements.conversion_status IS 'converted_to_case | passthrough_case | conversion_failed.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Helper: normalize a received quantity to CASES using pack_size
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.normalize_received_qty_to_cases(
  p_qty       numeric,
  p_unit      text,
  p_pack_size text
)
RETURNS TABLE(
  cases            numeric,
  ok               boolean,
  reason           text,
  conv_status      text
)
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_unit_upper      text    := upper(trim(coalesce(p_unit, 'CS')));
  v_units_per_case  numeric := NULL;
  v_total_per_case  numeric := NULL;
  v_match           text[];
BEGIN
  -- Parse pack_size: "6/4 LB" -> first=6 (units/case), second=4 (lbs each) -> total=24 lbs/case
  --                 "24/1 EA" -> first=24 (ea/case), second=1 -> total=24 ea/case
  IF p_pack_size IS NOT NULL THEN
    v_match := regexp_match(p_pack_size, '(\d+(?:\.\d+)?)\s*/\s*(\d+(?:\.\d+)?)');
    IF v_match IS NOT NULL THEN
      v_units_per_case := v_match[1]::numeric;
      v_total_per_case := v_match[1]::numeric * v_match[2]::numeric;
    ELSE
      v_match := regexp_match(p_pack_size, '(\d+(?:\.\d+)?)');
      IF v_match IS NOT NULL THEN
        v_units_per_case := v_match[1]::numeric;
        v_total_per_case := v_units_per_case;
      END IF;
    END IF;
  END IF;

  -- Case-based units: passthrough
  IF v_unit_upper IN ('CS', 'CASE', 'CASES', 'CA', 'CSE', '') THEN
    RETURN QUERY SELECT p_qty, true, NULL::text, 'passthrough_case'::text;
    RETURN;
  END IF;

  -- Weight-based units (lbs, oz, etc.)
  IF v_unit_upper IN ('LB', 'LBS', 'POUND', 'POUNDS') THEN
    IF v_total_per_case IS NOT NULL AND v_total_per_case > 0 THEN
      RETURN QUERY SELECT round(p_qty / v_total_per_case, 4), true, NULL::text, 'converted_to_case'::text;
    ELSE
      RETURN QUERY SELECT 0::numeric, false,
        format('Cannot convert LB to cases: pack_size "%s" has no usable totalPerCase', coalesce(p_pack_size, '(null)')),
        'conversion_failed'::text;
    END IF;
    RETURN;
  END IF;

  IF v_unit_upper IN ('OZ', 'OUNCE', 'OUNCES') THEN
    IF v_total_per_case IS NOT NULL AND v_total_per_case > 0 THEN
      -- convert oz → lb → cases (assuming pack is in lbs)
      RETURN QUERY SELECT round((p_qty / 16.0) / v_total_per_case, 4), true, NULL::text, 'converted_to_case'::text;
    ELSE
      RETURN QUERY SELECT 0::numeric, false,
        'Cannot convert OZ to cases: no pack totalPerCase',
        'conversion_failed'::text;
    END IF;
    RETURN;
  END IF;

  -- Count-based units (each, piece, etc.)
  IF v_unit_upper IN ('EA', 'EACH', 'PC', 'PCS', 'PIECE', 'PIECES', 'CT', 'COUNT', 'UN', 'UNIT', 'UNITS') THEN
    IF v_units_per_case IS NOT NULL AND v_units_per_case > 0 THEN
      RETURN QUERY SELECT round(p_qty / v_units_per_case, 4), true, NULL::text, 'converted_to_case'::text;
    ELSE
      RETURN QUERY SELECT 0::numeric, false,
        format('Cannot convert EA to cases: pack_size "%s" has no usable unitsPerCase', coalesce(p_pack_size, '(null)')),
        'conversion_failed'::text;
    END IF;
    RETURN;
  END IF;

  -- Unknown unit
  RETURN QUERY SELECT 0::numeric, false,
    format('Unknown unit "%s" — cannot convert to cases safely', coalesce(p_unit, '(null)')),
    'conversion_failed'::text;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Updated confirm_invoice_receipt: enforce confirmation + normalize to cases
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.confirm_invoice_receipt(
  p_invoice_id    uuid,
  p_restaurant_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_item              RECORD;
  v_receipt_status    text;
  v_inv_status        text;
  v_confirmed_at      timestamptz;
  v_already_confirmed boolean := false;
  v_confirmed_count   integer := 0;
  v_no_catalog_count  integer := 0;
  v_conv_failed_count integer := 0;
  v_unconfirmed_count integer := 0;
  v_movements_count   integer := 0;
  v_results           jsonb   := '[]'::jsonb;
  v_cases             numeric;
  v_conv_ok           boolean;
  v_conv_reason       text;
  v_conv_status_str   text;
BEGIN
  IF NOT public.is_member_of(p_restaurant_id) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  -- ── Check for unconfirmed received quantities ──────────────────────────────
  SELECT COUNT(*) INTO v_unconfirmed_count
  FROM public.invoice_line_comparisons ilc
  WHERE ilc.invoice_id = p_invoice_id
    AND ilc.invoiced_qty > 0
    AND ilc.status NOT IN ('missing_from_invoice')
    AND (ilc.received_qty_confirmed IS NULL OR ilc.received_qty_confirmed = false);

  IF v_unconfirmed_count > 0 THEN
    RETURN jsonb_build_object(
      'success', false,
      'error',   'received_qty_not_confirmed',
      'unconfirmed_count', v_unconfirmed_count,
      'message', format(
        '%s line(s) have auto-filled received quantities that have not been confirmed by a manager. '
        'Please confirm all received quantities before posting.',
        v_unconfirmed_count
      )
    );
  END IF;

  -- ── Lock and update invoice header ────────────────────────────────────────
  SELECT inv.receipt_status, inv.status
  INTO v_receipt_status, v_inv_status
  FROM public.invoices AS inv
  WHERE inv.id = p_invoice_id
    AND inv.restaurant_id = p_restaurant_id
  FOR UPDATE;

  IF NOT FOUND THEN
    -- Legacy: row only in purchase_history
    PERFORM 1 FROM public.purchase_history AS ph
    WHERE ph.id = p_invoice_id AND ph.restaurant_id = p_restaurant_id;
    IF FOUND THEN
      RETURN public.confirm_invoice_receipt_legacy(p_invoice_id, p_restaurant_id);
    END IF;
    RAISE EXCEPTION 'Invoice not found';
  END IF;

  IF v_receipt_status = 'confirmed' OR v_inv_status = 'confirmed' THEN
    v_already_confirmed := true;
  ELSE
    UPDATE public.invoices
    SET
      receipt_status = 'confirmed',
      status         = 'confirmed',
      confirmed_at   = COALESCE(confirmed_at, now()),
      updated_at     = now()
    WHERE id = p_invoice_id
      AND restaurant_id = p_restaurant_id
    RETURNING confirmed_at INTO v_confirmed_at;
  END IF;

  -- ── Process each invoice line ─────────────────────────────────────────────
  IF NOT v_already_confirmed THEN
    FOR v_item IN
      SELECT
        ii.id,
        ii.item_name,
        ii.quantity           AS billed_qty,
        ii.unit               AS billed_unit,
        ii.catalog_item_id,
        COALESCE(ilc.received_qty, ii.quantity)        AS received_qty_raw,
        COALESCE(ii.unit, 'CS')                        AS source_unit,
        cat.pack_size
      FROM public.invoice_items AS ii
      LEFT JOIN LATERAL (
        SELECT received_qty
        FROM public.invoice_line_comparisons
        WHERE invoice_item_id = ii.id
          AND invoice_id      = p_invoice_id
        ORDER BY id ASC
        LIMIT 1
      ) AS ilc ON true
      LEFT JOIN public.inventory_catalog_items cat ON cat.id = ii.catalog_item_id
      WHERE ii.invoice_id = p_invoice_id
    LOOP
      IF v_item.catalog_item_id IS NULL THEN
        v_no_catalog_count := v_no_catalog_count + 1;
        v_results := v_results || jsonb_build_object(
          'item_name',         v_item.item_name,
          'quantity_confirmed', v_item.received_qty_raw,
          'status',            'no_catalog_match'
        );
        CONTINUE;
      END IF;

      -- Normalize received qty to CASES
      SELECT n.cases, n.ok, n.reason, n.conv_status
      INTO v_cases, v_conv_ok, v_conv_reason, v_conv_status_str
      FROM public.normalize_received_qty_to_cases(
        v_item.received_qty_raw,
        v_item.source_unit,
        v_item.pack_size
      ) AS n;

      IF NOT v_conv_ok THEN
        v_conv_failed_count := v_conv_failed_count + 1;
        v_results := v_results || jsonb_build_object(
          'item_name',   v_item.item_name,
          'source_qty',  v_item.received_qty_raw,
          'source_unit', v_item.source_unit,
          'status',      'unit_conversion_failed',
          'reason',      v_conv_reason
        );
        CONTINUE;
      END IF;

      v_confirmed_count := v_confirmed_count + 1;

      IF v_cases IS NOT NULL AND v_cases > 0 THEN
        IF NOT EXISTS (
          SELECT 1 FROM public.stock_movements sm
          WHERE sm.invoice_item_id = v_item.id
            AND sm.movement_type   = 'receive'
        ) THEN
          INSERT INTO public.stock_movements (
            restaurant_id,
            catalog_item_id,
            movement_type,
            quantity,
            quantity_unit,
            source_quantity,
            source_quantity_unit,
            conversion_status,
            reference_type,
            reference_id,
            invoice_id,
            invoice_item_id,
            created_by
          ) VALUES (
            p_restaurant_id,
            v_item.catalog_item_id,
            'receive',
            v_cases,
            'case',
            v_item.received_qty_raw,
            v_item.source_unit,
            v_conv_status_str,
            'invoice_receipt',
            p_invoice_id,
            p_invoice_id,
            v_item.id,
            auth.uid()
          );
          v_movements_count := v_movements_count + 1;
        END IF;
      END IF;

      v_results := v_results || jsonb_build_object(
        'item_name',         v_item.item_name,
        'quantity_confirmed', v_cases,
        'quantity_unit',     'case',
        'source_qty',        v_item.received_qty_raw,
        'source_unit',       v_item.source_unit,
        'status',            'confirmed'
      );
    END LOOP;
  ELSE
    -- Already confirmed — return current state only
    FOR v_item IN
      SELECT ii.id, ii.item_name, ii.catalog_item_id,
             COALESCE(ilc.received_qty, ii.quantity) AS received_qty_raw
      FROM public.invoice_items AS ii
      LEFT JOIN LATERAL (
        SELECT received_qty FROM public.invoice_line_comparisons
        WHERE invoice_item_id = ii.id AND invoice_id = p_invoice_id
        ORDER BY id ASC LIMIT 1
      ) AS ilc ON true
      WHERE ii.invoice_id = p_invoice_id
    LOOP
      IF v_item.catalog_item_id IS NULL THEN
        v_no_catalog_count := v_no_catalog_count + 1;
      ELSE
        v_confirmed_count := v_confirmed_count + 1;
      END IF;
      v_results := v_results || jsonb_build_object(
        'item_name',         v_item.item_name,
        'quantity_confirmed', v_item.received_qty_raw,
        'status', CASE WHEN v_item.catalog_item_id IS NULL THEN 'no_catalog_match' ELSE 'already_confirmed' END
      );
    END LOOP;
  END IF;

  RETURN jsonb_build_object(
    'success',                 true,
    'already_confirmed',       v_already_confirmed,
    'confirmed',               v_confirmed_count,
    'no_catalog',              v_no_catalog_count,
    'unit_conversion_failed',  v_conv_failed_count,
    'inventory_updated',       v_movements_count > 0,
    'stock_movements_created', v_movements_count,
    'confirmed_at',            v_confirmed_at,
    'message', CASE
      WHEN v_already_confirmed THEN 'Receipt was already confirmed.'
      WHEN v_conv_failed_count > 0 THEN
        format('Receipt confirmed. %s stock movement(s) recorded; %s item(s) skipped due to unit conversion failure.',
               v_movements_count, v_conv_failed_count)
      ELSE
        format('Receipt confirmed. %s stock movement(s) recorded (normalized to cases).',
               v_movements_count)
    END,
    'items', v_results
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.normalize_received_qty_to_cases(numeric, text, text) TO authenticated;

NOTIFY pgrst, 'reload schema';
