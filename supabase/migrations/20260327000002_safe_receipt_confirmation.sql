-- Receipt confirmation should not mutate approved inventory count snapshots.
-- Confirm the receipt, preserve historical counts, and return a receipt summary.

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
  v_confirmed_at      timestamptz;
  v_already_confirmed boolean := false;
  v_confirmed_count   integer := 0;
  v_no_catalog_count  integer := 0;
  v_results           jsonb := '[]'::jsonb;
BEGIN
  IF NOT is_member_of(p_restaurant_id) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  SELECT
    ph.receipt_status,
    ph.confirmed_at
  INTO
    v_receipt_status,
    v_confirmed_at
  FROM public.purchase_history AS ph
  WHERE ph.id = p_invoice_id
    AND ph.restaurant_id = p_restaurant_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invoice not found';
  END IF;

  IF v_receipt_status = 'confirmed' THEN
    v_already_confirmed := true;
  ELSE
    UPDATE public.purchase_history
    SET receipt_status = 'confirmed',
        invoice_status = 'COMPLETE',
        confirmed_at   = COALESCE(confirmed_at, now())
    WHERE id = p_invoice_id
      AND restaurant_id = p_restaurant_id
    RETURNING confirmed_at INTO v_confirmed_at;
  END IF;

  FOR v_item IN
    SELECT
      phi.item_name,
      phi.quantity,
      phi.catalog_item_id
    FROM public.purchase_history_items AS phi
    WHERE phi.purchase_history_id = p_invoice_id
  LOOP
    IF v_item.catalog_item_id IS NULL THEN
      v_no_catalog_count := v_no_catalog_count + 1;
      v_results := v_results || jsonb_build_object(
        'item_name',          v_item.item_name,
        'quantity_confirmed', v_item.quantity,
        'status',             'no_catalog_match'
      );
    ELSE
      v_confirmed_count := v_confirmed_count + 1;
      v_results := v_results || jsonb_build_object(
        'item_name',          v_item.item_name,
        'quantity_confirmed', v_item.quantity,
        'status', CASE
          WHEN v_already_confirmed THEN 'already_confirmed'
          ELSE 'confirmed'
        END
      );
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'success', true,
    'already_confirmed', v_already_confirmed,
    'confirmed', v_confirmed_count,
    'no_catalog', v_no_catalog_count,
    'inventory_updated', false,
    'confirmed_at', v_confirmed_at,
    'message', CASE
      WHEN v_already_confirmed THEN 'Receipt was already confirmed. Approved inventory snapshots were left unchanged.'
      ELSE 'Receipt confirmed. Approved inventory snapshots were left unchanged.'
    END,
    'items', v_results
  );
END;
$$;

NOTIFY pgrst, 'reload schema';
