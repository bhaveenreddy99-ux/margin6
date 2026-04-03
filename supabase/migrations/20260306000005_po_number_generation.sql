-- =============================================================================
-- PO Number Generation
--
-- Adds a per-restaurant counter table and a database-level PO number generator
-- so that PO numbers are never created on the client.
--
-- submit_smart_order return type changes UUID → JSONB, so the old function
-- must be dropped before the new one is created.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- restaurant_counters
-- Stores monotonically-increasing per-restaurant sequences.
-- Rows are created on-demand by generate_po_number().
-- Direct writes are intentionally blocked; only the SECURITY DEFINER function
-- may increment the counter.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.restaurant_counters (
  restaurant_id uuid    NOT NULL PRIMARY KEY
                        REFERENCES public.restaurants(id) ON DELETE CASCADE,
  po_sequence   bigint  NOT NULL DEFAULT 0
);

ALTER TABLE public.restaurant_counters ENABLE ROW LEVEL SECURITY;

-- Members can read their restaurant's current counter (useful for display/debug).
CREATE POLICY "Members can view restaurant counters"
  ON public.restaurant_counters FOR SELECT TO authenticated
  USING (is_member_of(restaurant_id));

-- No INSERT / UPDATE / DELETE policies — all mutations go through
-- generate_po_number() which runs as SECURITY DEFINER.

GRANT SELECT ON public.restaurant_counters TO authenticated;


-- -----------------------------------------------------------------------------
-- generate_po_number(p_restaurant_id)
--
-- Atomically increments the per-restaurant po_sequence counter and returns a
-- formatted PO number:  PO-YYYYMMDD-NNNN  (zero-padded 4-digit sequence;
-- grows naturally beyond 4 digits once a restaurant exceeds 9999 POs).
--
-- Uses INSERT … ON CONFLICT … DO UPDATE to upsert-and-increment in a single
-- statement so the function is safe under concurrent calls (no lost updates).
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.generate_po_number(p_restaurant_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_seq bigint;
BEGIN
  INSERT INTO public.restaurant_counters (restaurant_id, po_sequence)
  VALUES (p_restaurant_id, 1)
  ON CONFLICT (restaurant_id)
  DO UPDATE SET po_sequence = restaurant_counters.po_sequence + 1
  RETURNING po_sequence INTO v_seq;

  RETURN 'PO-' || to_char(now(), 'YYYYMMDD') || '-' || lpad(v_seq::text, 4, '0');
END;
$$;


-- -----------------------------------------------------------------------------
-- submit_smart_order(p_run_id)
--
-- Changes vs. previous version:
--   • Return type is now JSONB { purchase_history_id, po_number } instead of
--     UUID so the caller always gets the generated PO number back.
--   • If smart_order_runs.po_number is NULL the function calls
--     generate_po_number() and writes the result back to the run row before
--     continuing. Re-submissions reuse the existing po_number unchanged.
--
-- Because PostgreSQL does not allow changing a function's return type with
-- CREATE OR REPLACE, the old function is dropped first.
-- -----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.submit_smart_order(uuid);

CREATE FUNCTION public.submit_smart_order(p_run_id uuid)
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
  -- Verify the caller belongs to the restaurant that owns this run.
  SELECT * INTO v_run
  FROM public.smart_order_runs
  WHERE id = p_run_id AND is_member_of(restaurant_id);

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Smart order run not found or access denied';
  END IF;

  -- Generate a PO number if the run does not already have one.
  -- On re-submission the existing number is preserved unchanged.
  v_po_number := v_run.po_number;
  IF v_po_number IS NULL THEN
    v_po_number := generate_po_number(v_run.restaurant_id);
    UPDATE public.smart_order_runs
    SET po_number = v_po_number
    WHERE id = p_run_id;
  END IF;

  -- Mark the run as submitted (idempotent; preserves the original submitted_at).
  UPDATE public.smart_order_runs
  SET status       = 'submitted',
      submitted_at = COALESCE(submitted_at, now())
  WHERE id = p_run_id;

  -- Upsert the purchase_history row and carry the PO number through.
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

  -- Replace all line items for this purchase history with the current run items.
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

  RETURN jsonb_build_object(
    'purchase_history_id', v_ph_id,
    'po_number',           v_po_number
  );
END;
$$;


NOTIFY pgrst, 'reload schema';
