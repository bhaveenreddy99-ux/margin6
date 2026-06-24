-- S0-4: enforce order-approval authorization in submit_smart_order.
--
-- Problem: submit_smart_order — the only path that commits a smart-order run into
-- a real purchase order — authorized on is_member_of(restaurant_id) ONLY. The
-- approval model (can_approve_orders + order_approval_threshold, OWNER unlimited)
-- lived only in the SmartOrder UI, so any member (incl. STAFF with
-- can_approve_orders=false, or any member submitting an over-threshold order)
-- could call the RPC directly and commit an any-size vendor PO (G1).
--
-- Fix: add a server-side gate that calls the S0-INFRA helper
-- can_approve_order_amount (shipped in 20260623000005). The amount and location
-- are computed from the RUN itself — never from client input — so neither is
-- spoofable:
--   * amount   = Σ GREATEST(suggested_order,0) * COALESCE(unit_cost,0) over the
--                run's items (exactly the order value written to
--                purchase_history_items.total_cost below).
--   * location = run.location_id, falling back to the caller's PRIMARY location
--                assignment in this restaurant when the run has no location
--                (mirrors useLocationPermissions' fallback; OWNER passes regardless).
-- The gate runs on EVERY call (incl. re-submit), after the FOR UPDATE lock and
-- BEFORE any write. Same signature/body otherwise — no caller or UI change.

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
  v_amount     numeric;
  v_location   uuid;
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

  -- ── S0-4 approval gate (server-authoritative; applies to every submit) ─────
  SELECT COALESCE(SUM(GREATEST(suggested_order, 0) * COALESCE(unit_cost, 0)), 0)
  INTO v_amount
  FROM public.smart_order_run_items
  WHERE run_id = p_run_id
    AND suggested_order > 0;

  v_location := v_run.location_id;
  IF v_location IS NULL THEN
    SELECT ula.location_id
    INTO v_location
    FROM public.user_location_assignments ula
    JOIN public.locations l ON l.id = ula.location_id
    WHERE ula.user_id = auth.uid()
      AND l.restaurant_id = v_run.restaurant_id
    ORDER BY ula.is_primary DESC
    LIMIT 1;
  END IF;

  IF NOT public.can_approve_order_amount(auth.uid(), v_run.restaurant_id, v_location, v_amount) THEN
    RAISE EXCEPTION
      'order approval required: order total % exceeds your approval limit or you are not permitted to approve orders', v_amount
      USING ERRCODE = 'check_violation';
  END IF;
  -- ───────────────────────────────────────────────────────────────────────────

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
