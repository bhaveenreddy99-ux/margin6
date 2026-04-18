-- submit_smart_order: always set purchase_orders.vendor_name from catalog (no silent NULL).
-- Resolution: (1) mode by weighted suggested qty on run lines with catalog vendor;
--             (2) else mode from all catalog items on the run's inventory list;
--             (3) else RAISE (user must add vendor on catalog items).

CREATE OR REPLACE FUNCTION public.submit_smart_order(p_run_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_run          public.smart_order_runs%ROWTYPE;
  v_po_number    text;
  v_po_id        uuid;
  v_vendor_name  text;
BEGIN
  SELECT *
  INTO v_run
  FROM public.smart_order_runs
  WHERE id = p_run_id
    AND public.is_member_of(restaurant_id)
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Smart order run not found or access denied';
  END IF;

  -- 1) Vendor from catalog items on this run (weighted by suggested order qty)
  SELECT btrim(ici.vendor_name)
  INTO v_vendor_name
  FROM public.smart_order_run_items AS sri
  INNER JOIN public.inventory_catalog_items AS ici
    ON ici.id = sri.catalog_item_id
   AND ici.restaurant_id = v_run.restaurant_id
  WHERE sri.run_id = p_run_id
    AND sri.suggested_order > 0
    AND ici.vendor_name IS NOT NULL
    AND btrim(ici.vendor_name) <> ''
  GROUP BY btrim(ici.vendor_name)
  ORDER BY SUM(GREATEST(sri.suggested_order, 0)) DESC, COUNT(*) DESC
  LIMIT 1;

  -- 2) Fallback: list-level catalog vendor (same list as the run)
  IF v_vendor_name IS NULL AND v_run.inventory_list_id IS NOT NULL THEN
    SELECT btrim(ici.vendor_name)
    INTO v_vendor_name
    FROM public.inventory_catalog_items AS ici
    WHERE ici.inventory_list_id = v_run.inventory_list_id
      AND ici.restaurant_id = v_run.restaurant_id
      AND ici.vendor_name IS NOT NULL
      AND btrim(ici.vendor_name) <> ''
    GROUP BY btrim(ici.vendor_name)
    ORDER BY COUNT(*) DESC
    LIMIT 1;
  END IF;

  IF v_vendor_name IS NULL OR btrim(v_vendor_name) = '' THEN
    RAISE EXCEPTION 'Cannot submit purchase order: no vendor on catalog items for this order. Add vendor names in List Management for items on this list, then try again.';
  END IF;

  v_po_number := v_run.po_number;
  IF v_po_number IS NULL THEN
    v_po_number := public.generate_po_number(v_run.restaurant_id);
    UPDATE public.smart_order_runs
    SET po_number = v_po_number
    WHERE id = p_run_id;
  END IF;

  UPDATE public.smart_order_runs
  SET status       = 'submitted',
      submitted_at = COALESCE(submitted_at, now())
  WHERE id = p_run_id;

  SELECT id INTO v_po_id
  FROM public.purchase_orders
  WHERE smart_order_run_id = p_run_id;

  IF v_po_id IS NULL THEN
    INSERT INTO public.purchase_orders (
      restaurant_id, po_number, vendor_name, status, smart_order_run_id,
      created_from_session_id, inventory_list_id, created_by, submitted_at
    )
    VALUES (
      v_run.restaurant_id,
      v_po_number,
      v_vendor_name,
      'submitted',
      v_run.id,
      v_run.session_id,
      v_run.inventory_list_id,
      v_run.created_by,
      COALESCE(v_run.submitted_at, now())
    )
    RETURNING id INTO v_po_id;
  ELSE
    UPDATE public.purchase_orders
    SET
      po_number     = v_po_number,
      vendor_name   = v_vendor_name,
      status        = 'submitted',
      submitted_at  = COALESCE(submitted_at, now()),
      updated_at    = now()
    WHERE id = v_po_id;
  END IF;

  DELETE FROM public.purchase_order_items WHERE purchase_order_id = v_po_id;

  INSERT INTO public.purchase_order_items (
    purchase_order_id, catalog_item_id, item_name, quantity_ordered, unit_cost, total_cost,
    pack_size, brand_name, smart_order_run_item_id
  )
  SELECT
    v_po_id,
    sri.catalog_item_id,
    sri.item_name,
    GREATEST(sri.suggested_order, 0),
    sri.unit_cost,
    GREATEST(sri.suggested_order, 0) * COALESCE(sri.unit_cost, 0),
    sri.pack_size,
    sri.brand_name,
    sri.id
  FROM public.smart_order_run_items sri
  WHERE sri.run_id = p_run_id
    AND sri.suggested_order > 0;

  RETURN jsonb_build_object(
    'purchase_order_id', v_po_id,
    'po_number',         v_po_number,
    'purchase_history_id', NULL
  );
END;
$$;

NOTIFY pgrst, 'reload schema';
