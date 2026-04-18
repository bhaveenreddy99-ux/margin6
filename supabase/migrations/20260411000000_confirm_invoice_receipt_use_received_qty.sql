-- Stock movements on receipt confirmation: use reviewed invoice_line_comparisons.received_qty
-- when present; otherwise invoice_items.quantity (unchanged fallback).

CREATE OR REPLACE FUNCTION public.confirm_invoice_receipt(
  p_invoice_id uuid,
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
  v_results           jsonb := '[]'::jsonb;
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

  IF FOUND THEN
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

    IF NOT v_already_confirmed THEN
      FOR v_item IN
        SELECT
          ii.id,
          ii.item_name,
          ii.quantity,
          ii.catalog_item_id,
          COALESCE(ilc.received_qty, ii.quantity) AS qty_for_stock
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
            'item_name', v_item.item_name,
            'quantity_confirmed', v_item.qty_for_stock,
            'status', 'no_catalog_match'
          );
        ELSE
          v_confirmed_count := v_confirmed_count + 1;
          IF v_item.qty_for_stock IS NOT NULL AND v_item.qty_for_stock > 0 THEN
            IF NOT EXISTS (
              SELECT 1 FROM public.stock_movements sm
              WHERE sm.invoice_item_id = v_item.id
                AND sm.movement_type = 'receive'
            ) THEN
              INSERT INTO public.stock_movements (
                restaurant_id, catalog_item_id, movement_type, quantity,
                reference_type, reference_id, invoice_id, invoice_item_id, created_by
              )
              VALUES (
                p_restaurant_id,
                v_item.catalog_item_id,
                'receive',
                v_item.qty_for_stock,
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
            'item_name', v_item.item_name,
            'quantity_confirmed', v_item.qty_for_stock,
            'status', CASE WHEN v_already_confirmed THEN 'already_confirmed' ELSE 'confirmed' END
          );
        END IF;
      END LOOP;
    ELSE
      FOR v_item IN
        SELECT
          ii.id,
          ii.item_name,
          ii.quantity,
          ii.catalog_item_id,
          COALESCE(ilc.received_qty, ii.quantity) AS qty_for_stock
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
        ELSE
          v_confirmed_count := v_confirmed_count + 1;
        END IF;
        v_results := v_results || jsonb_build_object(
          'item_name', v_item.item_name,
          'quantity_confirmed', v_item.qty_for_stock,
          'status', CASE WHEN v_item.catalog_item_id IS NULL THEN 'no_catalog_match' ELSE 'already_confirmed' END
        );
      END LOOP;
    END IF;

    RETURN jsonb_build_object(
      'success', true,
      'already_confirmed', v_already_confirmed,
      'confirmed', v_confirmed_count,
      'no_catalog', v_no_catalog_count,
      'inventory_updated', v_movements_count > 0,
      'stock_movements_created', v_movements_count,
      'confirmed_at', v_confirmed_at,
      'message', CASE
        WHEN v_already_confirmed THEN 'Receipt was already confirmed.'
        ELSE format('Receipt confirmed. %s stock movement(s) recorded.', v_movements_count)
      END,
      'items', v_results
    );
  END IF;

  -- Legacy: row only in purchase_history (not migrated to invoices)
  PERFORM 1 FROM public.purchase_history AS ph
  WHERE ph.id = p_invoice_id AND ph.restaurant_id = p_restaurant_id;
  IF FOUND THEN
    RETURN public.confirm_invoice_receipt_legacy(p_invoice_id, p_restaurant_id);
  END IF;

  RAISE EXCEPTION 'Invoice not found';
END;
$$;

NOTIFY pgrst, 'reload schema';
