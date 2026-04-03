
-- Add missing brand_name column to smart_order_run_items
ALTER TABLE public.smart_order_run_items
  ADD COLUMN IF NOT EXISTS brand_name text;

-- Replace the RPC with the corrected version (now brand_name column exists)
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
  -- Fetch run and verify caller is a member of the restaurant (RLS enforcement)
  SELECT * INTO v_run
  FROM public.smart_order_runs
  WHERE id = p_run_id AND is_member_of(restaurant_id);

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Smart order run not found or access denied';
  END IF;

  -- Mark run as submitted (preserve original submitted_at on re-sync)
  UPDATE public.smart_order_runs
  SET status       = 'submitted',
      submitted_at = COALESCE(submitted_at, now())
  WHERE id = p_run_id;

  -- Upsert purchase_history row (no duplicates via unique constraint)
  INSERT INTO public.purchase_history (
    id,
    restaurant_id,
    inventory_list_id,
    smart_order_run_id,
    invoice_status,
    source,
    created_by,
    created_at
  )
  VALUES (
    gen_random_uuid(),
    v_run.restaurant_id,
    v_run.inventory_list_id,
    p_run_id,
    'RECEIVED',
    'smart_order',
    v_run.created_by,
    now()
  )
  ON CONFLICT (restaurant_id, smart_order_run_id)
  DO UPDATE SET invoice_status = EXCLUDED.invoice_status
  RETURNING id INTO v_ph_id;

  -- Replace all items for this purchase history with current smart order items
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
    brand_name
  )
  SELECT
    gen_random_uuid(),
    v_ph_id,
    item_name,
    GREATEST(suggested_order, 0),
    unit_cost,
    GREATEST(suggested_order, 0) * COALESCE(unit_cost, 0),
    pack_size,
    brand_name
  FROM public.smart_order_run_items
  WHERE run_id = p_run_id
    AND suggested_order > 0;

  RETURN v_ph_id;
END;
$$;

NOTIFY pgrst, 'reload schema';
