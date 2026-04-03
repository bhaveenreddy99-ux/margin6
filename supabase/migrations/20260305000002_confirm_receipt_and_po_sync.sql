-- Fix 1: Add confirmed_at to purchase_history
ALTER TABLE purchase_history
  ADD COLUMN IF NOT EXISTS confirmed_at timestamptz;

-- Fix 2: Sync po_number inside submit_smart_order RPC
CREATE OR REPLACE FUNCTION public.submit_smart_order(p_run_id UUID)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_run   public.smart_order_runs%ROWTYPE;
  v_ph_id UUID;
BEGIN
  SELECT * INTO v_run
  FROM public.smart_order_runs
  WHERE id = p_run_id AND is_member_of(restaurant_id);

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Smart order run not found or access denied';
  END IF;

  UPDATE public.smart_order_runs
  SET status       = 'submitted',
      submitted_at = COALESCE(submitted_at, now())
  WHERE id = p_run_id;

  INSERT INTO public.purchase_history (
    id, restaurant_id, inventory_list_id, smart_order_run_id,
    invoice_status, source, created_by, created_at
  ) VALUES (
    gen_random_uuid(), v_run.restaurant_id, v_run.inventory_list_id, p_run_id,
    'RECEIVED', 'smart_order', v_run.created_by, now()
  )
  ON CONFLICT (restaurant_id, smart_order_run_id)
  DO UPDATE SET invoice_status = EXCLUDED.invoice_status
  RETURNING id INTO v_ph_id;

  -- Sync po_number from smart_order_runs to purchase_history
  UPDATE public.purchase_history
  SET po_number = v_run.po_number
  WHERE id = v_ph_id
    AND v_run.po_number IS NOT NULL;

  DELETE FROM public.purchase_history_items
  WHERE purchase_history_id = v_ph_id;

  INSERT INTO public.purchase_history_items (
    id, purchase_history_id, item_name, quantity, unit_cost,
    total_cost, pack_size, brand_name
  )
  SELECT
    gen_random_uuid(), v_ph_id, item_name,
    GREATEST(suggested_order, 0),
    unit_cost,
    GREATEST(suggested_order, 0) * COALESCE(unit_cost, 0),
    pack_size, brand_name
  FROM public.smart_order_run_items
  WHERE run_id = p_run_id AND suggested_order > 0;

  RETURN v_ph_id;
END;
$$;

-- Fix 3: confirm_invoice_receipt RPC
-- Updates the most recent approved inventory session's stock levels
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
  v_item        RECORD;
  v_session_id  uuid;
  v_new_stock   numeric;
  v_updated     integer := 0;
  v_skipped     integer := 0;
  v_no_catalog  integer := 0;
  v_results     jsonb   := '[]'::jsonb;
BEGIN
  -- Verify caller has access to this restaurant
  IF NOT is_member_of(p_restaurant_id) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  -- Mark invoice confirmed
  UPDATE purchase_history
  SET receipt_status = 'confirmed',
      invoice_status = 'COMPLETE',
      confirmed_at   = now()
  WHERE id = p_invoice_id
    AND restaurant_id = p_restaurant_id;

  -- Find most recent approved inventory session for this restaurant
  SELECT id INTO v_session_id
  FROM inventory_sessions
  WHERE restaurant_id = p_restaurant_id
    AND approved_at IS NOT NULL
  ORDER BY approved_at DESC
  LIMIT 1;

  -- Loop through each invoice line item
  FOR v_item IN
    SELECT phi.id, phi.item_name, phi.quantity, phi.unit_cost, phi.catalog_item_id,
           ici.item_name AS catalog_name
    FROM purchase_history_items phi
    LEFT JOIN inventory_catalog_items ici ON ici.id = phi.catalog_item_id
    WHERE phi.purchase_history_id = p_invoice_id
  LOOP
    -- Skip items with no catalog match
    IF v_item.catalog_item_id IS NULL THEN
      v_no_catalog := v_no_catalog + 1;
      v_results := v_results || jsonb_build_object(
        'item_name',      v_item.item_name,
        'quantity_added', v_item.quantity,
        'status',         'no_catalog_match'
      );
      CONTINUE;
    END IF;

    -- No approved session → can't update stock
    IF v_session_id IS NULL THEN
      v_skipped := v_skipped + 1;
      v_results := v_results || jsonb_build_object(
        'item_name',      v_item.item_name,
        'quantity_added', v_item.quantity,
        'status',         'no_session'
      );
      CONTINUE;
    END IF;

    -- Update stock in the most recent approved session
    -- Match by catalog item_name (case-insensitive) within that session
    UPDATE inventory_session_items isi
    SET current_stock = current_stock + v_item.quantity
    WHERE isi.session_id = v_session_id
      AND lower(trim(isi.item_name)) = lower(trim(v_item.catalog_name));

    IF FOUND THEN
      -- Read updated stock value
      SELECT isi.current_stock INTO v_new_stock
      FROM inventory_session_items isi
      WHERE isi.session_id = v_session_id
        AND lower(trim(isi.item_name)) = lower(trim(v_item.catalog_name))
      LIMIT 1;

      v_updated := v_updated + 1;
      v_results := v_results || jsonb_build_object(
        'item_name',      v_item.item_name,
        'quantity_added', v_item.quantity,
        'new_stock',      v_new_stock,
        'status',         'updated'
      );
    ELSE
      -- Item not found in that session
      v_skipped := v_skipped + 1;
      v_results := v_results || jsonb_build_object(
        'item_name',      v_item.item_name,
        'quantity_added', v_item.quantity,
        'status',         'not_in_session'
      );
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'success',    true,
    'updated',    v_updated,
    'skipped',    v_skipped,
    'no_catalog', v_no_catalog,
    'items',      v_results
  );
END;
$$;
