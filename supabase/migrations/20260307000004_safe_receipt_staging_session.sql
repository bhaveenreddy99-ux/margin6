-- Preserve approved inventory snapshots during receipt confirmation by posting
-- confirmed quantities into a mutable in-progress session instead.

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
  v_item                RECORD;
  v_invoice             RECORD;
  v_target_session_id   uuid;
  v_target_session_name text;
  v_source_session_id   uuid;
  v_source_session_name text;
  v_new_stock           numeric;
  v_updated             integer := 0;
  v_skipped             integer := 0;
  v_no_catalog          integer := 0;
  v_created_session     boolean := false;
  v_results             jsonb   := '[]'::jsonb;
BEGIN
  IF NOT is_member_of(p_restaurant_id) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  SELECT
    ph.id,
    ph.created_by,
    ph.receipt_status,
    ph.inventory_list_id,
    ph.location_id,
    ph.po_number,
    ph.invoice_number,
    COALESCE(ph.inventory_list_id, sor.inventory_list_id) AS effective_inventory_list_id,
    COALESCE(ph.location_id, sor.location_id) AS effective_location_id
  INTO v_invoice
  FROM public.purchase_history ph
  LEFT JOIN public.smart_order_runs sor ON sor.id = ph.smart_order_run_id
  WHERE ph.id = p_invoice_id
    AND ph.restaurant_id = p_restaurant_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invoice not found';
  END IF;

  IF v_invoice.receipt_status = 'confirmed' THEN
    RETURN jsonb_build_object(
      'success', true,
      'already_confirmed', true,
      'snapshot_preserved', true,
      'created_session', false,
      'target_session_id', null,
      'target_session_name', null,
      'updated', 0,
      'skipped', 0,
      'no_catalog', 0,
      'items', v_results
    );
  END IF;

  UPDATE public.purchase_history
  SET receipt_status = 'confirmed',
      invoice_status = 'COMPLETE',
      confirmed_at   = now()
  WHERE id = p_invoice_id
    AND restaurant_id = p_restaurant_id;

  IF v_invoice.effective_inventory_list_id IS NOT NULL THEN
    SELECT
      s.id,
      s.name
    INTO
      v_target_session_id,
      v_target_session_name
    FROM public.inventory_sessions s
    WHERE s.restaurant_id = p_restaurant_id
      AND s.inventory_list_id = v_invoice.effective_inventory_list_id
      AND s.location_id IS NOT DISTINCT FROM v_invoice.effective_location_id
      AND s.status = 'IN_PROGRESS'
    ORDER BY s.updated_at DESC
    LIMIT 1;

    IF v_target_session_id IS NULL THEN
      SELECT
        s.id,
        s.name
      INTO
        v_source_session_id,
        v_source_session_name
      FROM public.inventory_sessions s
      WHERE s.restaurant_id = p_restaurant_id
        AND s.inventory_list_id = v_invoice.effective_inventory_list_id
        AND s.location_id IS NOT DISTINCT FROM v_invoice.effective_location_id
        AND s.status = 'APPROVED'
        AND s.approved_at IS NOT NULL
      ORDER BY s.approved_at DESC
      LIMIT 1;

      INSERT INTO public.inventory_sessions (
        id,
        restaurant_id,
        inventory_list_id,
        location_id,
        name,
        status,
        created_by,
        updated_at
      )
      VALUES (
        gen_random_uuid(),
        p_restaurant_id,
        v_invoice.effective_inventory_list_id,
        v_invoice.effective_location_id,
        COALESCE(v_source_session_name || ' - receipt staging', 'Receipt staging'),
        'IN_PROGRESS',
        COALESCE(auth.uid(), v_invoice.created_by),
        now()
      )
      RETURNING id, name
      INTO v_target_session_id, v_target_session_name;

      v_created_session := true;

      IF v_source_session_id IS NOT NULL THEN
        INSERT INTO public.inventory_session_items (
          session_id,
          catalog_item_id,
          item_name,
          category,
          unit,
          current_stock,
          par_level,
          unit_cost,
          vendor_sku,
          pack_size,
          vendor_name,
          brand_name,
          lead_time_days,
          metadata
        )
        SELECT
          v_target_session_id,
          isi.catalog_item_id,
          isi.item_name,
          isi.category,
          isi.unit,
          isi.current_stock,
          isi.par_level,
          isi.unit_cost,
          isi.vendor_sku,
          isi.pack_size,
          isi.vendor_name,
          isi.brand_name,
          isi.lead_time_days,
          isi.metadata
        FROM public.inventory_session_items isi
        WHERE isi.session_id = v_source_session_id;
      ELSE
        INSERT INTO public.inventory_session_items (
          session_id,
          catalog_item_id,
          item_name,
          category,
          unit,
          current_stock,
          par_level,
          unit_cost,
          vendor_sku,
          pack_size,
          vendor_name,
          brand_name
        )
        SELECT
          v_target_session_id,
          ici.id,
          ici.item_name,
          ici.category,
          ici.unit,
          0,
          COALESCE(ici.default_par_level, 0),
          ici.default_unit_cost,
          COALESCE(ici.product_number, ici.vendor_sku),
          ici.pack_size,
          ici.vendor_name,
          ici.brand_name
        FROM public.inventory_catalog_items ici
        WHERE ici.restaurant_id = p_restaurant_id
          AND ici.inventory_list_id = v_invoice.effective_inventory_list_id;
      END IF;
    END IF;
  END IF;

  FOR v_item IN
    SELECT
      phi.id,
      phi.item_name,
      phi.quantity,
      phi.unit_cost,
      phi.catalog_item_id
    FROM public.purchase_history_items phi
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

    IF v_target_session_id IS NULL THEN
      v_skipped := v_skipped + 1;
      v_results := v_results || jsonb_build_object(
        'item_name',      v_item.item_name,
        'quantity_added', v_item.quantity,
        'status',         'no_session'
      );
      CONTINUE;
    END IF;

    UPDATE public.inventory_session_items isi
    SET current_stock = COALESCE(isi.current_stock, 0) + COALESCE(v_item.quantity, 0)
    WHERE isi.session_id = v_target_session_id
      AND isi.catalog_item_id = v_item.catalog_item_id;

    IF FOUND THEN
      SELECT isi.current_stock
      INTO v_new_stock
      FROM public.inventory_session_items isi
      WHERE isi.session_id = v_target_session_id
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

  IF v_target_session_id IS NOT NULL AND (v_updated > 0 OR v_created_session) THEN
    UPDATE public.inventory_sessions
    SET updated_at = now()
    WHERE id = v_target_session_id;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'already_confirmed', false,
    'snapshot_preserved', true,
    'created_session', v_created_session,
    'target_session_id', v_target_session_id,
    'target_session_name', v_target_session_name,
    'updated', v_updated,
    'skipped', v_skipped,
    'no_catalog', v_no_catalog,
    'items', v_results
  );
END;
$$;

NOTIFY pgrst, 'reload schema';
