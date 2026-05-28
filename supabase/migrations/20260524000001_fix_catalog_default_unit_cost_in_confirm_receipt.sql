-- Fix confirm_invoice_receipt: inventory_catalog_items has default_unit_cost, not unit_cost.

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
  v_movements_count   integer := 0;
  v_price_changes     jsonb   := '[]'::jsonb;
  v_results           jsonb   := '[]'::jsonb;
  v_old_cost          numeric;
  v_new_cost          numeric;
  v_pct_diff          numeric;
  v_abs_pct           numeric;
  v_catalog_pack      text;
  v_invoice_pack      text;
  v_units_match       boolean;
  v_classification    text;
  v_member            RECORD;
  v_price_increases   jsonb   := '[]'::jsonb;
  v_price_decreases   jsonb   := '[]'::jsonb;
  v_unit_mismatches   jsonb   := '[]'::jsonb;
BEGIN
  IF NOT public.is_member_of(p_restaurant_id) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  SELECT inv.receipt_status, inv.status
  INTO v_receipt_status, v_inv_status
  FROM public.invoices AS inv
  WHERE inv.id = p_invoice_id
    AND inv.restaurant_id = p_restaurant_id
  FOR UPDATE;

  IF NOT FOUND THEN
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

  FOR v_item IN
    SELECT
      ii.id,
      ii.item_name,
      ii.quantity_invoiced,
      ii.unit_cost                            AS invoiced_unit_cost,
      ii.pack_size                            AS invoiced_pack_size,
      ii.catalog_item_id,
      COALESCE(ilc.received_qty, ii.quantity_invoiced) AS qty_for_stock
    FROM public.invoice_items AS ii
    LEFT JOIN (
      SELECT DISTINCT ON (invoice_item_id)
        invoice_item_id,
        received_qty
      FROM public.invoice_line_comparisons
      WHERE invoice_id = p_invoice_id
      ORDER BY invoice_item_id, id ASC
    ) AS ilc ON ilc.invoice_item_id = ii.id
    WHERE ii.invoice_id = p_invoice_id
  LOOP

    IF v_item.catalog_item_id IS NULL THEN
      v_no_catalog_count := v_no_catalog_count + 1;
      v_results := v_results || jsonb_build_object(
        'item_name',          v_item.item_name,
        'quantity_confirmed', v_item.qty_for_stock,
        'status',             'no_catalog_match'
      );
      CONTINUE;
    END IF;

    v_confirmed_count := v_confirmed_count + 1;

    IF NOT v_already_confirmed
       AND v_item.qty_for_stock IS NOT NULL
       AND v_item.qty_for_stock > 0 THEN
      IF NOT EXISTS (
        SELECT 1 FROM public.stock_movements sm
        WHERE sm.invoice_item_id = v_item.id
          AND sm.movement_type  = 'receive'
      ) THEN
        INSERT INTO public.stock_movements (
          restaurant_id, catalog_item_id, movement_type, quantity,
          reference_type, reference_id, invoice_id, invoice_item_id, created_by
        ) VALUES (
          p_restaurant_id, v_item.catalog_item_id, 'receive', v_item.qty_for_stock,
          'invoice_receipt', p_invoice_id, p_invoice_id, v_item.id, auth.uid()
        );
        v_movements_count := v_movements_count + 1;
      END IF;
    END IF;

    IF NOT v_already_confirmed
       AND v_item.invoiced_unit_cost IS NOT NULL
       AND v_item.invoiced_unit_cost > 0 THEN

      SELECT default_unit_cost, pack_size
        INTO v_old_cost, v_catalog_pack
      FROM public.inventory_catalog_items
      WHERE id = v_item.catalog_item_id;

      v_new_cost := v_item.invoiced_unit_cost;
      v_invoice_pack := lower(coalesce(btrim(v_item.invoiced_pack_size), ''));
      v_catalog_pack := lower(coalesce(btrim(v_catalog_pack), ''));

      -- Units match when either side is blank (legacy data) or the trimmed
      -- pack_size strings are identical case-insensitively.
      v_units_match :=
        v_invoice_pack = '' OR v_catalog_pack = '' OR v_invoice_pack = v_catalog_pack;

      IF v_old_cost IS NULL
         OR (
           ABS(v_new_cost - v_old_cost) > 0.01
           AND (
             v_old_cost = 0
             OR (ABS(v_new_cost - v_old_cost) / ABS(v_old_cost)) * 100 > 1.0
           )
         )
      THEN
        UPDATE public.inventory_catalog_items
        SET
          default_unit_cost = v_new_cost,
          updated_at        = now()
        WHERE id = v_item.catalog_item_id;

        v_pct_diff := CASE
          WHEN v_old_cost IS NULL OR v_old_cost = 0 THEN NULL
          ELSE ROUND(((v_new_cost - v_old_cost) / ABS(v_old_cost)) * 100, 1)
        END;
        v_abs_pct := CASE WHEN v_pct_diff IS NULL THEN NULL ELSE ABS(v_pct_diff) END;

        -- Classify:
        --   * pack_size mismatch              → UNIT_MISMATCH
        --   * |%change| > 50% (suspect unit)  → UNIT_MISMATCH
        --   * |%change| <= 5%                 → not noteworthy, no notification
        --   * new > old by > 5%               → PRICE_INCREASE
        --   * new < old by > 5%               → PRICE_DECREASE
        IF NOT v_units_match THEN
          v_classification := 'unit_mismatch';
        ELSIF v_abs_pct IS NOT NULL AND v_abs_pct > 50 THEN
          v_classification := 'unit_mismatch';
        ELSIF v_abs_pct IS NULL OR v_abs_pct <= 5 THEN
          v_classification := 'no_alert';
        ELSIF v_new_cost > v_old_cost THEN
          v_classification := 'price_increase';
        ELSE
          v_classification := 'price_decrease';
        END IF;

        v_price_changes := v_price_changes || jsonb_build_object(
          'item_name',     v_item.item_name,
          'old_cost',      v_old_cost,
          'new_cost',      v_new_cost,
          'pct_change',    v_pct_diff,
          'invoice_pack',  v_invoice_pack,
          'catalog_pack',  v_catalog_pack,
          'classification', v_classification,
          'direction',     CASE WHEN v_new_cost > COALESCE(v_old_cost, 0) THEN 'up' ELSE 'down' END
        );

        IF v_classification = 'unit_mismatch' THEN
          v_unit_mismatches := v_unit_mismatches || jsonb_build_object(
            'item_name',    v_item.item_name,
            'old_cost',     v_old_cost,
            'new_cost',     v_new_cost,
            'pct_change',   v_pct_diff,
            'invoice_pack', v_invoice_pack,
            'catalog_pack', v_catalog_pack
          );
        ELSIF v_classification = 'price_increase' THEN
          v_price_increases := v_price_increases || jsonb_build_object(
            'item_name',  v_item.item_name,
            'old_cost',   v_old_cost,
            'new_cost',   v_new_cost,
            'pct_change', v_pct_diff
          );
        ELSIF v_classification = 'price_decrease' THEN
          v_price_decreases := v_price_decreases || jsonb_build_object(
            'item_name',  v_item.item_name,
            'old_cost',   v_old_cost,
            'new_cost',   v_new_cost,
            'pct_change', v_pct_diff
          );
        END IF;
      END IF;
    END IF;

    v_results := v_results || jsonb_build_object(
      'item_name',          v_item.item_name,
      'quantity_confirmed', v_item.qty_for_stock,
      'status',             CASE WHEN v_already_confirmed THEN 'already_confirmed' ELSE 'confirmed' END
    );
  END LOOP;

  IF NOT v_already_confirmed
     AND (
       jsonb_array_length(v_price_increases) > 0
       OR jsonb_array_length(v_price_decreases) > 0
       OR jsonb_array_length(v_unit_mismatches) > 0
     ) THEN
    FOR v_member IN
      SELECT user_id FROM public.restaurant_members
      WHERE restaurant_id = p_restaurant_id
        AND role IN ('OWNER', 'MANAGER')
    LOOP
      IF jsonb_array_length(v_price_increases) > 0 THEN
        INSERT INTO public.notifications (
          restaurant_id, user_id, type, title, message, severity, data
        ) VALUES (
          p_restaurant_id,
          v_member.user_id,
          'PRICE_INCREASE',
          format('%s item price increase%s on latest invoice',
            jsonb_array_length(v_price_increases),
            CASE WHEN jsonb_array_length(v_price_increases) > 1 THEN 's' ELSE '' END),
          (
            SELECT string_agg(
              format('%s: $%s to $%s%s',
                item->>'item_name',
                COALESCE(ROUND((item->>'old_cost')::numeric, 2)::text, '?'),
                ROUND((item->>'new_cost')::numeric, 2),
                CASE WHEN item->>'pct_change' IS NOT NULL
                     THEN ' (+' || item->>'pct_change' || '%)'
                     ELSE '' END),
              ', ' ORDER BY (item->>'item_name'))
            FROM jsonb_array_elements(v_price_increases) item
          ),
          'WARNING',
          jsonb_build_object('invoice_id', p_invoice_id, 'items', v_price_increases)
        );
      END IF;

      IF jsonb_array_length(v_price_decreases) > 0 THEN
        INSERT INTO public.notifications (
          restaurant_id, user_id, type, title, message, severity, data
        ) VALUES (
          p_restaurant_id,
          v_member.user_id,
          'PRICE_DECREASE',
          format('%s item price decrease%s on latest invoice',
            jsonb_array_length(v_price_decreases),
            CASE WHEN jsonb_array_length(v_price_decreases) > 1 THEN 's' ELSE '' END),
          (
            SELECT string_agg(
              format('%s: $%s to $%s%s',
                item->>'item_name',
                COALESCE(ROUND((item->>'old_cost')::numeric, 2)::text, '?'),
                ROUND((item->>'new_cost')::numeric, 2),
                CASE WHEN item->>'pct_change' IS NOT NULL
                     THEN ' (' || item->>'pct_change' || '%)'
                     ELSE '' END),
              ', ' ORDER BY (item->>'item_name'))
            FROM jsonb_array_elements(v_price_decreases) item
          ),
          'INFO',
          jsonb_build_object('invoice_id', p_invoice_id, 'items', v_price_decreases)
        );
      END IF;

      IF jsonb_array_length(v_unit_mismatches) > 0 THEN
        INSERT INTO public.notifications (
          restaurant_id, user_id, type, title, message, severity, data
        ) VALUES (
          p_restaurant_id,
          v_member.user_id,
          'UNIT_MISMATCH',
          format('%s item%s billed in a different unit — verify pricing',
            jsonb_array_length(v_unit_mismatches),
            CASE WHEN jsonb_array_length(v_unit_mismatches) > 1 THEN 's' ELSE '' END),
          (
            SELECT string_agg(
              format('%s: catalog %s vs invoice %s (was $%s, now $%s)',
                item->>'item_name',
                COALESCE(NULLIF(item->>'catalog_pack', ''), '—'),
                COALESCE(NULLIF(item->>'invoice_pack', ''), '—'),
                COALESCE(ROUND((item->>'old_cost')::numeric, 2)::text, '?'),
                ROUND((item->>'new_cost')::numeric, 2)),
              ', ' ORDER BY (item->>'item_name'))
            FROM jsonb_array_elements(v_unit_mismatches) item
          ),
          'WARNING',
          jsonb_build_object('invoice_id', p_invoice_id, 'items', v_unit_mismatches)
        );
      END IF;
    END LOOP;
  END IF;

  RETURN jsonb_build_object(
    'success',                 true,
    'already_confirmed',       v_already_confirmed,
    'confirmed',               v_confirmed_count,
    'no_catalog',              v_no_catalog_count,
    'inventory_updated',       v_movements_count > 0,
    'stock_movements_created', v_movements_count,
    'price_changes',           v_price_changes,
    'unit_mismatches',         v_unit_mismatches,
    'confirmed_at',            v_confirmed_at,
    'message', CASE
      WHEN v_already_confirmed THEN 'Receipt was already confirmed.'
      ELSE format('Receipt confirmed. %s stock movement(s) recorded. %s catalog price(s) updated.',
        v_movements_count, jsonb_array_length(v_price_changes))
    END,
    'items', v_results
  );
END;
$$;

NOTIFY pgrst, 'reload schema';
