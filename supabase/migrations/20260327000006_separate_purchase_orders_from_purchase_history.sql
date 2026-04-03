-- Keep purchase_history for invoice/receipt documents instead of using it for
-- draft and submitted smart-order placeholders.

-- Reclassify existing rows linked to smart orders:
--   * invoice/receipt-like rows become source = 'invoice'
--   * remaining linked rows become source = 'smart_order'
UPDATE public.purchase_history AS ph
SET source = 'invoice'
WHERE ph.smart_order_run_id IS NOT NULL
  AND (
    ph.vendor_name IS NOT NULL
    OR ph.invoice_number IS NOT NULL
    OR ph.invoice_date IS NOT NULL
    OR ph.invoice_subtotal IS NOT NULL
    OR ph.invoice_tax IS NOT NULL
    OR ph.invoice_total IS NOT NULL
    OR ph.confirmed_at IS NOT NULL
    OR ph.receipt_status IN ('reviewing', 'confirmed', 'issues_reported')
    OR EXISTS (
      SELECT 1
      FROM public.invoice_line_comparisons AS ilc
      WHERE ilc.purchase_history_id = ph.id
    )
    OR EXISTS (
      SELECT 1
      FROM public.delivery_issues AS di
      WHERE di.purchase_history_id = ph.id
    )
  );

UPDATE public.purchase_history AS ph
SET source = 'smart_order'
WHERE ph.smart_order_run_id IS NOT NULL
  AND COALESCE(ph.source, '') <> 'invoice';

CREATE OR REPLACE FUNCTION public.submit_smart_order(p_run_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_run        public.smart_order_runs%ROWTYPE;
  v_po_number  text;
BEGIN
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

  RETURN jsonb_build_object(
    'purchase_history_id', NULL,
    'po_number',           v_po_number
  );
END;
$$;

NOTIFY pgrst, 'reload schema';
