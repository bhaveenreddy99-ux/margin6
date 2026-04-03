-- Serialize smart-order submission so duplicate submits for the same run cannot
-- race each other and rewrite purchase history inconsistently.

CREATE OR REPLACE FUNCTION public.submit_smart_order(p_run_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_run        public.smart_order_runs%ROWTYPE;
  v_ph_id      uuid;
  v_po_number  text;
BEGIN
  -- Lock the run row so concurrent submits for the same run serialize.
  SELECT *
  INTO v_run
  FROM public.smart_order_runs
  WHERE id = p_run_id
    AND is_member_of(restaurant_id)
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Smart order run not found or access denied';
  END IF;

  v_po_number := v_run.po_number;
  IF v_po_number IS NULL THEN
    v_po_number := generate_po_number(v_run.restaurant_id);
    UPDATE public.smart_order_runs
    SET po_number = v_po_number
    WHERE id = p_run_id;
  END IF;

  UPDATE public.smart_order_runs
  SET status       = 'submitted',
      submitted_at = COALESCE(submitted_at, now())
  WHERE id = p_run_id;

  INSERT INTO public.purchase_history (
    id,
    restaurant_id,
    inventory_list_id,
    smart_order_run_id,
    invoice_status,
    source,
    po_number,
    created_by,
    created_at
  ) VALUES (
    gen_random_uuid(),
    v_run.restaurant_id,
    v_run.inventory_list_id,
    p_run_id,
    'RECEIVED',
    'smart_order',
    v_po_number,
    v_run.created_by,
    now()
  )
  ON CONFLICT (restaurant_id, smart_order_run_id)
  DO UPDATE
    SET invoice_status = EXCLUDED.invoice_status,
        po_number      = EXCLUDED.po_number
  RETURNING id INTO v_ph_id;

  DELETE FROM public.purchase_history_items
  WHERE purchase_history_id = v_ph_id;

  INSERT INTO public.purchase_history_items (
    id,
    purchase_history_id,
    item_name,
    quantity,
    unit_cost,
    total_cost,
    pack_size,
    brand_name,
    catalog_item_id
  )
  SELECT
    gen_random_uuid(),
    v_ph_id,
    item_name,
    GREATEST(suggested_order, 0),
    unit_cost,
    GREATEST(suggested_order, 0) * COALESCE(unit_cost, 0),
    pack_size,
    brand_name,
    catalog_item_id
  FROM public.smart_order_run_items
  WHERE run_id = p_run_id
    AND suggested_order > 0;

  RETURN jsonb_build_object(
    'purchase_history_id', v_ph_id,
    'po_number',           v_po_number
  );
END;
$$;

NOTIFY pgrst, 'reload schema';
