-- Carry stable catalog_item_id values through inventory sessions and smart-order
-- rows so analytics and receiving flows do not rely on loose item-name matches.

ALTER TABLE public.inventory_session_items
  ADD COLUMN IF NOT EXISTS catalog_item_id uuid REFERENCES public.inventory_catalog_items(id) ON DELETE SET NULL;

ALTER TABLE public.smart_order_run_items
  ADD COLUMN IF NOT EXISTS catalog_item_id uuid REFERENCES public.inventory_catalog_items(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_inventory_session_items_catalog_item_id
  ON public.inventory_session_items(catalog_item_id);

CREATE INDEX IF NOT EXISTS idx_smart_order_run_items_catalog_item_id
  ON public.smart_order_run_items(catalog_item_id);

WITH unique_catalog_items AS (
  SELECT
    inventory_list_id,
    lower(trim(item_name)) AS item_name_key,
    min(id) AS catalog_item_id
  FROM public.inventory_catalog_items
  GROUP BY inventory_list_id, lower(trim(item_name))
  HAVING count(*) = 1
)
UPDATE public.inventory_session_items AS isi
SET catalog_item_id = uci.catalog_item_id
FROM public.inventory_sessions AS sess
JOIN unique_catalog_items AS uci
  ON uci.inventory_list_id = sess.inventory_list_id
WHERE isi.session_id = sess.id
  AND isi.catalog_item_id IS NULL
  AND lower(trim(isi.item_name)) = uci.item_name_key;

WITH unique_catalog_items AS (
  SELECT
    inventory_list_id,
    lower(trim(item_name)) AS item_name_key,
    min(id) AS catalog_item_id
  FROM public.inventory_catalog_items
  GROUP BY inventory_list_id, lower(trim(item_name))
  HAVING count(*) = 1
)
UPDATE public.smart_order_run_items AS sori
SET catalog_item_id = uci.catalog_item_id
FROM public.smart_order_runs AS sor
JOIN unique_catalog_items AS uci
  ON uci.inventory_list_id = sor.inventory_list_id
WHERE sori.run_id = sor.id
  AND sori.catalog_item_id IS NULL
  AND lower(trim(sori.item_name)) = uci.item_name_key;

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
  IF NOT is_member_of(p_restaurant_id) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  UPDATE public.purchase_history
  SET receipt_status = 'confirmed',
      invoice_status = 'COMPLETE',
      confirmed_at   = now()
  WHERE id = p_invoice_id
    AND restaurant_id = p_restaurant_id;

  SELECT id INTO v_session_id
  FROM public.inventory_sessions
  WHERE restaurant_id = p_restaurant_id
    AND approved_at IS NOT NULL
  ORDER BY approved_at DESC
  LIMIT 1;

  FOR v_item IN
    SELECT
      phi.id,
      phi.item_name,
      phi.quantity,
      phi.unit_cost,
      phi.catalog_item_id,
      ici.item_name AS catalog_name
    FROM public.purchase_history_items phi
    LEFT JOIN public.inventory_catalog_items ici ON ici.id = phi.catalog_item_id
    WHERE phi.purchase_history_id = p_invoice_id
  LOOP
    IF v_item.catalog_item_id IS NULL THEN
      v_no_catalog := v_no_catalog + 1;
      v_results := v_results || jsonb_build_object(
        'item_name',      v_item.item_name,
        'quantity_added', v_item.quantity,
        'status',         'no_catalog_match'
      );
      CONTINUE;
    END IF;

    IF v_session_id IS NULL THEN
      v_skipped := v_skipped + 1;
      v_results := v_results || jsonb_build_object(
        'item_name',      v_item.item_name,
        'quantity_added', v_item.quantity,
        'status',         'no_session'
      );
      CONTINUE;
    END IF;

    UPDATE public.inventory_session_items isi
    SET current_stock = current_stock + v_item.quantity
    WHERE isi.session_id = v_session_id
      AND isi.catalog_item_id = v_item.catalog_item_id;

    IF FOUND THEN
      SELECT isi.current_stock INTO v_new_stock
      FROM public.inventory_session_items isi
      WHERE isi.session_id = v_session_id
        AND isi.catalog_item_id = v_item.catalog_item_id
      LIMIT 1;

      v_updated := v_updated + 1;
      v_results := v_results || jsonb_build_object(
        'item_name',      v_item.item_name,
        'quantity_added', v_item.quantity,
        'new_stock',      v_new_stock,
        'status',         'updated'
      );
    ELSE
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
  SELECT * INTO v_run
  FROM public.smart_order_runs
  WHERE id = p_run_id AND is_member_of(restaurant_id);

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
