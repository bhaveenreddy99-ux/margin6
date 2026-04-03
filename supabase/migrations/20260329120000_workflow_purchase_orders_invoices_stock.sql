-- =============================================================================
-- RestaurantIQ workflow: real purchase orders, separate invoices, stock movements
-- - purchase_orders / purchase_order_items: PO document from submitted smart order
-- - invoices / invoice_items: vendor invoice (separate from PO)
-- - stock_movements: receive (and future waste/adjustment)
-- - submit_smart_order creates PO rows; confirm_invoice_receipt inserts receives
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Purchase orders
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.purchase_orders (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id        uuid NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  po_number              text NOT NULL,
  vendor_name            text,
  status                 text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'submitted', 'partially_received', 'closed', 'cancelled')),
  smart_order_run_id     uuid UNIQUE REFERENCES public.smart_order_runs(id) ON DELETE CASCADE,
  created_from_session_id uuid REFERENCES public.inventory_sessions(id) ON DELETE SET NULL,
  inventory_list_id     uuid REFERENCES public.inventory_lists(id) ON DELETE SET NULL,
  created_by              uuid REFERENCES auth.users(id),
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),
  submitted_at            timestamptz
);

CREATE INDEX IF NOT EXISTS idx_purchase_orders_restaurant_id ON public.purchase_orders (restaurant_id);
CREATE INDEX IF NOT EXISTS idx_purchase_orders_po_number ON public.purchase_orders (po_number);
CREATE INDEX IF NOT EXISTS idx_purchase_orders_status ON public.purchase_orders (restaurant_id, status);

CREATE TABLE IF NOT EXISTS public.purchase_order_items (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_order_id      uuid NOT NULL REFERENCES public.purchase_orders(id) ON DELETE CASCADE,
  catalog_item_id        uuid REFERENCES public.inventory_catalog_items(id) ON DELETE SET NULL,
  item_name              text NOT NULL,
  quantity_ordered       numeric NOT NULL DEFAULT 0,
  unit_cost              numeric,
  total_cost             numeric,
  pack_size              text,
  brand_name             text,
  smart_order_run_item_id uuid REFERENCES public.smart_order_run_items(id) ON DELETE SET NULL,
  created_at             timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_purchase_order_items_po ON public.purchase_order_items (purchase_order_id);
CREATE INDEX IF NOT EXISTS idx_purchase_order_items_catalog ON public.purchase_order_items (catalog_item_id);

-- -----------------------------------------------------------------------------
-- 2. Invoices (vendor documents; optional link to purchase_orders)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.invoices (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id      uuid NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  purchase_order_id  uuid REFERENCES public.purchase_orders(id) ON DELETE SET NULL,
  vendor_name        text,
  invoice_number     text,
  invoice_date       date,
  location_id        uuid REFERENCES public.locations(id) ON DELETE SET NULL,
  invoice_subtotal   numeric,
  invoice_tax        numeric,
  invoice_total      numeric,
  status             text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'review', 'ready_to_receive', 'confirmed')),
  receipt_status     text DEFAULT 'pending'
    CHECK (receipt_status IN ('pending', 'reviewing', 'confirmed', 'issues_reported')),
  pdf_url            text,
  created_by         uuid REFERENCES auth.users(id),
  confirmed_at       timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_invoices_restaurant_id ON public.invoices (restaurant_id);
CREATE INDEX IF NOT EXISTS idx_invoices_purchase_order_id ON public.invoices (purchase_order_id);
CREATE INDEX IF NOT EXISTS idx_invoices_status ON public.invoices (restaurant_id, status);

CREATE TABLE IF NOT EXISTS public.invoice_items (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id     uuid NOT NULL REFERENCES public.invoices(id) ON DELETE CASCADE,
  catalog_item_id uuid REFERENCES public.inventory_catalog_items(id) ON DELETE SET NULL,
  item_name      text NOT NULL,
  quantity       numeric NOT NULL DEFAULT 0,
  unit_cost      numeric,
  total_cost     numeric,
  pack_size      text,
  brand_name     text,
  vendor_sku     text,
  match_status   text NOT NULL DEFAULT 'MANUAL',
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_invoice_items_invoice ON public.invoice_items (invoice_id);
CREATE INDEX IF NOT EXISTS idx_invoice_items_catalog ON public.invoice_items (catalog_item_id);

-- -----------------------------------------------------------------------------
-- 3. Stock movements
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.stock_movements (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id   uuid NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  catalog_item_id uuid NOT NULL REFERENCES public.inventory_catalog_items(id) ON DELETE CASCADE,
  movement_type   text NOT NULL CHECK (movement_type IN ('receive', 'waste', 'adjustment')),
  quantity        numeric NOT NULL,
  reference_type  text,
  reference_id    uuid,
  invoice_id      uuid REFERENCES public.invoices(id) ON DELETE SET NULL,
  invoice_item_id uuid REFERENCES public.invoice_items(id) ON DELETE SET NULL,
  notes           text,
  created_by      uuid REFERENCES auth.users(id),
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_stock_movements_restaurant_catalog ON public.stock_movements (restaurant_id, catalog_item_id);
CREATE INDEX IF NOT EXISTS idx_stock_movements_invoice ON public.stock_movements (invoice_id);

-- At most one receive movement per invoice line (idempotent confirm)
CREATE UNIQUE INDEX IF NOT EXISTS uq_stock_movements_receive_per_invoice_item
  ON public.stock_movements (invoice_item_id)
  WHERE movement_type = 'receive' AND invoice_item_id IS NOT NULL;

-- -----------------------------------------------------------------------------
-- 4. Helper functions for RLS
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.invoice_restaurant_id(p_invoice_id uuid)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT restaurant_id FROM public.invoices WHERE id = p_invoice_id
$$;

CREATE OR REPLACE FUNCTION public.purchase_order_restaurant_id(p_po_id uuid)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT restaurant_id FROM public.purchase_orders WHERE id = p_po_id
$$;

-- -----------------------------------------------------------------------------
-- 5. RLS
-- -----------------------------------------------------------------------------
ALTER TABLE public.purchase_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.purchase_order_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invoice_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stock_movements ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can view purchase orders"
  ON public.purchase_orders FOR SELECT TO authenticated
  USING (public.is_member_of(restaurant_id));

CREATE POLICY "Manager+ can insert purchase orders"
  ON public.purchase_orders FOR INSERT TO authenticated
  WITH CHECK (public.has_restaurant_role_any(restaurant_id, ARRAY['OWNER'::public.app_role, 'MANAGER'::public.app_role]));

CREATE POLICY "Manager+ can update purchase orders"
  ON public.purchase_orders FOR UPDATE TO authenticated
  USING (public.has_restaurant_role_any(restaurant_id, ARRAY['OWNER'::public.app_role, 'MANAGER'::public.app_role]))
  WITH CHECK (public.has_restaurant_role_any(restaurant_id, ARRAY['OWNER'::public.app_role, 'MANAGER'::public.app_role]));

CREATE POLICY "Manager+ can delete purchase orders"
  ON public.purchase_orders FOR DELETE TO authenticated
  USING (public.has_restaurant_role_any(restaurant_id, ARRAY['OWNER'::public.app_role, 'MANAGER'::public.app_role]));

CREATE POLICY "Members can view purchase order items"
  ON public.purchase_order_items FOR SELECT TO authenticated
  USING (public.is_member_of(public.purchase_order_restaurant_id(purchase_order_id)));

CREATE POLICY "Manager+ can insert purchase order items"
  ON public.purchase_order_items FOR INSERT TO authenticated
  WITH CHECK (public.is_member_of(public.purchase_order_restaurant_id(purchase_order_id)));

CREATE POLICY "Manager+ can update purchase order items"
  ON public.purchase_order_items FOR UPDATE TO authenticated
  USING (public.has_restaurant_role_any(public.purchase_order_restaurant_id(purchase_order_id), ARRAY['OWNER'::public.app_role, 'MANAGER'::public.app_role]))
  WITH CHECK (public.has_restaurant_role_any(public.purchase_order_restaurant_id(purchase_order_id), ARRAY['OWNER'::public.app_role, 'MANAGER'::public.app_role]));

CREATE POLICY "Manager+ can delete purchase order items"
  ON public.purchase_order_items FOR DELETE TO authenticated
  USING (public.has_restaurant_role_any(public.purchase_order_restaurant_id(purchase_order_id), ARRAY['OWNER'::public.app_role, 'MANAGER'::public.app_role]));

CREATE POLICY "Members can view invoices"
  ON public.invoices FOR SELECT TO authenticated
  USING (public.is_member_of(restaurant_id));

CREATE POLICY "Manager+ can insert invoices"
  ON public.invoices FOR INSERT TO authenticated
  WITH CHECK (public.has_restaurant_role_any(restaurant_id, ARRAY['OWNER'::public.app_role, 'MANAGER'::public.app_role]));

CREATE POLICY "Manager+ can update invoices"
  ON public.invoices FOR UPDATE TO authenticated
  USING (public.has_restaurant_role_any(restaurant_id, ARRAY['OWNER'::public.app_role, 'MANAGER'::public.app_role]))
  WITH CHECK (public.has_restaurant_role_any(restaurant_id, ARRAY['OWNER'::public.app_role, 'MANAGER'::public.app_role]));

CREATE POLICY "Manager+ can delete invoices"
  ON public.invoices FOR DELETE TO authenticated
  USING (public.has_restaurant_role_any(restaurant_id, ARRAY['OWNER'::public.app_role, 'MANAGER'::public.app_role]));

CREATE POLICY "Members can view invoice items"
  ON public.invoice_items FOR SELECT TO authenticated
  USING (public.is_member_of(public.invoice_restaurant_id(invoice_id)));

CREATE POLICY "Manager+ can insert invoice items"
  ON public.invoice_items FOR INSERT TO authenticated
  WITH CHECK (public.is_member_of(public.invoice_restaurant_id(invoice_id)));

CREATE POLICY "Manager+ can update invoice items"
  ON public.invoice_items FOR UPDATE TO authenticated
  USING (public.has_restaurant_role_any(public.invoice_restaurant_id(invoice_id), ARRAY['OWNER'::public.app_role, 'MANAGER'::public.app_role]))
  WITH CHECK (public.has_restaurant_role_any(public.invoice_restaurant_id(invoice_id), ARRAY['OWNER'::public.app_role, 'MANAGER'::public.app_role]));

CREATE POLICY "Manager+ can delete invoice items"
  ON public.invoice_items FOR DELETE TO authenticated
  USING (public.has_restaurant_role_any(public.invoice_restaurant_id(invoice_id), ARRAY['OWNER'::public.app_role, 'MANAGER'::public.app_role]));

CREATE POLICY "Members can view stock movements"
  ON public.stock_movements FOR SELECT TO authenticated
  USING (public.is_member_of(restaurant_id));

CREATE POLICY "Members can insert stock movements"
  ON public.stock_movements FOR INSERT TO authenticated
  WITH CHECK (public.is_member_of(restaurant_id));

-- -----------------------------------------------------------------------------
-- 6. Backfill purchase_orders from submitted smart order runs
-- -----------------------------------------------------------------------------
INSERT INTO public.purchase_orders (
  id, restaurant_id, po_number, vendor_name, status, smart_order_run_id,
  created_from_session_id, inventory_list_id, created_by, created_at, submitted_at
)
SELECT
  gen_random_uuid(),
  sor.restaurant_id,
  COALESCE(sor.po_number, 'LEGACY-' || sor.id::text),
  NULL,
  CASE WHEN sor.status = 'submitted' THEN 'submitted' ELSE 'draft' END,
  sor.id,
  sor.session_id,
  sor.inventory_list_id,
  sor.created_by,
  sor.created_at,
  sor.submitted_at
FROM public.smart_order_runs sor
WHERE sor.status = 'submitted'
  AND NOT EXISTS (SELECT 1 FROM public.purchase_orders po WHERE po.smart_order_run_id = sor.id);

-- Lines for backfilled POs
INSERT INTO public.purchase_order_items (
  purchase_order_id, catalog_item_id, item_name, quantity_ordered, unit_cost, total_cost,
  pack_size, brand_name, smart_order_run_item_id
)
SELECT
  po.id,
  sri.catalog_item_id,
  sri.item_name,
  GREATEST(sri.suggested_order, 0),
  sri.unit_cost,
  GREATEST(sri.suggested_order, 0) * COALESCE(sri.unit_cost, 0),
  sri.pack_size,
  sri.brand_name,
  sri.id
FROM public.smart_order_runs sor
JOIN public.purchase_orders po ON po.smart_order_run_id = sor.id
JOIN public.smart_order_run_items sri ON sri.run_id = sor.id
WHERE sor.status = 'submitted'
  AND sri.suggested_order > 0
  AND NOT EXISTS (SELECT 1 FROM public.purchase_order_items x WHERE x.purchase_order_id = po.id);

-- -----------------------------------------------------------------------------
-- 7. Migrate purchase_history → invoices (preserve ids for stable URLs)
-- -----------------------------------------------------------------------------
INSERT INTO public.invoices (
  id, restaurant_id, purchase_order_id, vendor_name, invoice_number, invoice_date,
  location_id, invoice_subtotal, invoice_tax, invoice_total, status, receipt_status,
  pdf_url, created_by, confirmed_at, created_at, updated_at
)
SELECT
  ph.id,
  ph.restaurant_id,
  po.id,
  ph.vendor_name,
  ph.invoice_number,
  ph.invoice_date,
  ph.location_id,
  ph.invoice_subtotal,
  ph.invoice_tax,
  ph.invoice_total,
  CASE
    WHEN ph.invoice_status = 'DRAFT' THEN 'draft'
    WHEN ph.invoice_status = 'RECEIVED' THEN 'review'
    WHEN ph.invoice_status = 'COMPLETE' THEN 'confirmed'
    ELSE 'review'
  END,
  COALESCE(ph.receipt_status, 'pending'),
  ph.pdf_url,
  ph.created_by,
  ph.confirmed_at,
  ph.created_at,
  now()
FROM public.purchase_history ph
LEFT JOIN public.purchase_orders po ON po.smart_order_run_id = ph.smart_order_run_id
WHERE
  ph.vendor_name IS NOT NULL
  OR ph.invoice_number IS NOT NULL
  OR ph.invoice_date IS NOT NULL
  OR ph.confirmed_at IS NOT NULL
  OR ph.receipt_status IS NOT NULL
  OR EXISTS (SELECT 1 FROM public.invoice_line_comparisons ilc WHERE ilc.purchase_history_id = ph.id)
  OR EXISTS (SELECT 1 FROM public.delivery_issues di WHERE di.purchase_history_id = ph.id)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.invoice_items (
  id, invoice_id, catalog_item_id, item_name, quantity, unit_cost, total_cost,
  pack_size, brand_name, vendor_sku, match_status, created_at
)
SELECT
  phi.id,
  phi.purchase_history_id,
  phi.catalog_item_id,
  phi.item_name,
  phi.quantity,
  phi.unit_cost,
  phi.total_cost,
  phi.pack_size,
  phi.brand_name,
  phi.vendor_sku,
  COALESCE(phi.match_status, 'MANUAL'),
  now()
FROM public.purchase_history_items phi
WHERE EXISTS (SELECT 1 FROM public.invoices inv WHERE inv.id = phi.purchase_history_id)
ON CONFLICT (id) DO NOTHING;

-- -----------------------------------------------------------------------------
-- 8. invoice_line_comparisons + delivery_issues: support invoices
-- -----------------------------------------------------------------------------
ALTER TABLE public.invoice_line_comparisons
  ADD COLUMN IF NOT EXISTS invoice_id uuid REFERENCES public.invoices(id) ON DELETE CASCADE;

ALTER TABLE public.invoice_line_comparisons
  ADD COLUMN IF NOT EXISTS invoice_item_id uuid REFERENCES public.invoice_items(id) ON DELETE SET NULL;

ALTER TABLE public.invoice_line_comparisons
  ADD COLUMN IF NOT EXISTS purchase_order_item_id uuid REFERENCES public.purchase_order_items(id) ON DELETE SET NULL;

UPDATE public.invoice_line_comparisons ilc
SET invoice_id = ilc.purchase_history_id
WHERE ilc.invoice_id IS NULL
  AND EXISTS (SELECT 1 FROM public.invoices i WHERE i.id = ilc.purchase_history_id);

ALTER TABLE public.invoice_line_comparisons
  DROP CONSTRAINT IF EXISTS invoice_line_comparisons_purchase_history_id_fkey;

ALTER TABLE public.invoice_line_comparisons
  ALTER COLUMN purchase_history_id DROP NOT NULL;

ALTER TABLE public.invoice_line_comparisons
  ADD CONSTRAINT invoice_line_comparisons_purchase_history_id_fkey
  FOREIGN KEY (purchase_history_id) REFERENCES public.purchase_history(id) ON DELETE CASCADE;

ALTER TABLE public.invoice_line_comparisons
  DROP CONSTRAINT IF EXISTS invoice_line_comparisons_invoice_or_ph_chk;

ALTER TABLE public.invoice_line_comparisons
  ADD CONSTRAINT invoice_line_comparisons_invoice_or_ph_chk
  CHECK (invoice_id IS NOT NULL OR purchase_history_id IS NOT NULL);

DROP POLICY IF EXISTS "Users can manage invoice_line_comparisons for their restaurant" ON public.invoice_line_comparisons;
DROP POLICY IF EXISTS "Members can view invoice line comparisons" ON public.invoice_line_comparisons;
DROP POLICY IF EXISTS "Members can create invoice line comparisons" ON public.invoice_line_comparisons;
DROP POLICY IF EXISTS "Members can update invoice line comparisons" ON public.invoice_line_comparisons;
DROP POLICY IF EXISTS "Members can delete invoice line comparisons" ON public.invoice_line_comparisons;

CREATE POLICY "Members can view invoice line comparisons"
  ON public.invoice_line_comparisons FOR SELECT TO authenticated
  USING (
    (invoice_id IS NOT NULL AND public.is_member_of((SELECT restaurant_id FROM public.invoices WHERE id = invoice_line_comparisons.invoice_id)))
    OR (purchase_history_id IS NOT NULL AND public.is_member_of(public.purchase_history_restaurant_id(invoice_line_comparisons.purchase_history_id)))
  );

CREATE POLICY "Members can create invoice line comparisons"
  ON public.invoice_line_comparisons FOR INSERT TO authenticated
  WITH CHECK (
    (invoice_id IS NOT NULL AND public.is_member_of((SELECT restaurant_id FROM public.invoices WHERE id = invoice_line_comparisons.invoice_id)))
    OR (purchase_history_id IS NOT NULL AND public.is_member_of(public.purchase_history_restaurant_id(invoice_line_comparisons.purchase_history_id)))
  );

CREATE POLICY "Members can update invoice line comparisons"
  ON public.invoice_line_comparisons FOR UPDATE TO authenticated
  USING (
    (invoice_id IS NOT NULL AND public.is_member_of((SELECT restaurant_id FROM public.invoices WHERE id = invoice_line_comparisons.invoice_id)))
    OR (purchase_history_id IS NOT NULL AND public.is_member_of(public.purchase_history_restaurant_id(invoice_line_comparisons.purchase_history_id)))
  )
  WITH CHECK (
    (invoice_id IS NOT NULL AND public.is_member_of((SELECT restaurant_id FROM public.invoices WHERE id = invoice_line_comparisons.invoice_id)))
    OR (purchase_history_id IS NOT NULL AND public.is_member_of(public.purchase_history_restaurant_id(invoice_line_comparisons.purchase_history_id)))
  );

CREATE POLICY "Members can delete invoice line comparisons"
  ON public.invoice_line_comparisons FOR DELETE TO authenticated
  USING (
    (invoice_id IS NOT NULL AND public.is_member_of((SELECT restaurant_id FROM public.invoices WHERE id = invoice_line_comparisons.invoice_id)))
    OR (purchase_history_id IS NOT NULL AND public.is_member_of(public.purchase_history_restaurant_id(invoice_line_comparisons.purchase_history_id)))
  );

CREATE INDEX IF NOT EXISTS idx_invoice_line_comparisons_invoice_id ON public.invoice_line_comparisons (invoice_id);

-- delivery_issues
ALTER TABLE public.delivery_issues
  ADD COLUMN IF NOT EXISTS invoice_id uuid REFERENCES public.invoices(id) ON DELETE CASCADE;

UPDATE public.delivery_issues di
SET invoice_id = di.purchase_history_id
WHERE di.invoice_id IS NULL
  AND EXISTS (SELECT 1 FROM public.invoices i WHERE i.id = di.purchase_history_id);

ALTER TABLE public.delivery_issues
  DROP CONSTRAINT IF EXISTS delivery_issues_purchase_history_id_fkey;

ALTER TABLE public.delivery_issues
  ALTER COLUMN purchase_history_id DROP NOT NULL;

ALTER TABLE public.delivery_issues
  ADD CONSTRAINT delivery_issues_purchase_history_id_fkey
  FOREIGN KEY (purchase_history_id) REFERENCES public.purchase_history(id) ON DELETE CASCADE;

ALTER TABLE public.delivery_issues
  DROP CONSTRAINT IF EXISTS delivery_issues_invoice_or_ph_chk;

ALTER TABLE public.delivery_issues
  ADD CONSTRAINT delivery_issues_invoice_or_ph_chk
  CHECK (invoice_id IS NOT NULL OR purchase_history_id IS NOT NULL);

DROP POLICY IF EXISTS "Users can manage delivery_issues for their restaurant" ON public.delivery_issues;
DROP POLICY IF EXISTS "Members can view delivery issues" ON public.delivery_issues;
DROP POLICY IF EXISTS "Members can insert delivery issues" ON public.delivery_issues;

CREATE POLICY "Members can view delivery issues"
  ON public.delivery_issues FOR SELECT TO authenticated
  USING (
    (invoice_id IS NOT NULL AND public.is_member_of((SELECT restaurant_id FROM public.invoices WHERE id = delivery_issues.invoice_id)))
    OR (purchase_history_id IS NOT NULL AND public.is_member_of(public.purchase_history_restaurant_id(delivery_issues.purchase_history_id)))
  );

CREATE POLICY "Members can insert delivery issues"
  ON public.delivery_issues FOR INSERT TO authenticated
  WITH CHECK (
    (invoice_id IS NOT NULL AND public.is_member_of((SELECT restaurant_id FROM public.invoices WHERE id = delivery_issues.invoice_id)))
    OR (purchase_history_id IS NOT NULL AND public.is_member_of(public.purchase_history_restaurant_id(delivery_issues.purchase_history_id)))
  );

CREATE POLICY "Members can update delivery issues"
  ON public.delivery_issues FOR UPDATE TO authenticated
  USING (
    (invoice_id IS NOT NULL AND public.is_member_of((SELECT restaurant_id FROM public.invoices WHERE id = delivery_issues.invoice_id)))
    OR (purchase_history_id IS NOT NULL AND public.is_member_of(public.purchase_history_restaurant_id(delivery_issues.purchase_history_id)))
  )
  WITH CHECK (
    (invoice_id IS NOT NULL AND public.is_member_of((SELECT restaurant_id FROM public.invoices WHERE id = delivery_issues.invoice_id)))
    OR (purchase_history_id IS NOT NULL AND public.is_member_of(public.purchase_history_restaurant_id(delivery_issues.purchase_history_id)))
  );

CREATE POLICY "Members can delete delivery issues"
  ON public.delivery_issues FOR DELETE TO authenticated
  USING (
    (invoice_id IS NOT NULL AND public.has_restaurant_role_any((SELECT restaurant_id FROM public.invoices WHERE id = delivery_issues.invoice_id), ARRAY['OWNER'::public.app_role, 'MANAGER'::public.app_role]))
    OR (purchase_history_id IS NOT NULL AND public.has_restaurant_role_any(public.purchase_history_restaurant_id(delivery_issues.purchase_history_id), ARRAY['OWNER'::public.app_role, 'MANAGER'::public.app_role]))
  );

CREATE INDEX IF NOT EXISTS idx_delivery_issues_invoice_id ON public.delivery_issues (invoice_id);

-- -----------------------------------------------------------------------------
-- 9. submit_smart_order → purchase_orders
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.submit_smart_order(p_run_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_run        public.smart_order_runs%ROWTYPE;
  v_po_number  text;
  v_po_id      uuid;
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
      NULL,
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

-- -----------------------------------------------------------------------------
-- 10. Legacy receipt (purchase_history only; no stock) — called by confirm wrapper
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.confirm_invoice_receipt_legacy(
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
  IF NOT public.is_member_of(p_restaurant_id) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  SELECT ph.receipt_status, ph.confirmed_at
  INTO v_receipt_status, v_confirmed_at
  FROM public.purchase_history AS ph
  WHERE ph.id = p_invoice_id AND ph.restaurant_id = p_restaurant_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Legacy purchase_history row not found';
  END IF;

  IF v_receipt_status = 'confirmed' THEN
    v_already_confirmed := true;
  ELSE
    UPDATE public.purchase_history
    SET receipt_status = 'confirmed',
        invoice_status = 'COMPLETE',
        confirmed_at   = COALESCE(confirmed_at, now())
    WHERE id = p_invoice_id AND restaurant_id = p_restaurant_id
    RETURNING confirmed_at INTO v_confirmed_at;
  END IF;

  FOR v_item IN
    SELECT phi.item_name, phi.quantity, phi.catalog_item_id
    FROM public.purchase_history_items AS phi
    WHERE phi.purchase_history_id = p_invoice_id
  LOOP
    IF v_item.catalog_item_id IS NULL THEN
      v_no_catalog_count := v_no_catalog_count + 1;
    ELSE
      v_confirmed_count := v_confirmed_count + 1;
    END IF;
    v_results := v_results || jsonb_build_object(
      'item_name', v_item.item_name,
      'quantity_confirmed', v_item.quantity,
      'status', CASE WHEN v_item.catalog_item_id IS NULL THEN 'no_catalog_match' ELSE
 CASE WHEN v_already_confirmed THEN 'already_confirmed' ELSE 'confirmed' END END
    );
  END LOOP;

  RETURN jsonb_build_object(
    'success', true,
    'already_confirmed', v_already_confirmed,
    'confirmed', v_confirmed_count,
    'no_catalog', v_no_catalog_count,
    'inventory_updated', false,
    'stock_movements_created', 0,
    'confirmed_at', v_confirmed_at,
    'message', 'Legacy purchase_history receipt confirmed (migrate to invoices for stock movements).',
    'items', v_results
  );
END;
$$;

-- -----------------------------------------------------------------------------
-- 11. confirm_invoice_receipt → stock movements (invoices table)
-- -----------------------------------------------------------------------------
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
  v_inv_status        text;
  v_confirmed_at      timestamptz;
  v_already_confirmed boolean := false;
  v_confirmed_count   integer := 0;
  v_no_catalog_count  integer := 0;
  v_movements_count   integer := 0;
  v_results           jsonb := '[]'::jsonb;
BEGIN
  IF NOT public.is_member_of(p_restaurant_id) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  SELECT inv.receipt_status, inv.status
  INTO v_receipt_status, v_inv_status
  FROM public.invoices AS inv
  WHERE inv.id = p_invoice_id
    AND inv.restaurant_id = p_restaurant_id
  FOR UPDATE;

  IF FOUND THEN
    IF v_receipt_status = 'confirmed' OR v_inv_status = 'confirmed' THEN
      v_already_confirmed := true;
    ELSE
      UPDATE public.invoices
      SET
        receipt_status = 'confirmed',
        status         = 'confirmed',
        confirmed_at   = COALESCE(confirmed_at, now()),
        updated_at     = now()
      WHERE id = p_invoice_id
        AND restaurant_id = p_restaurant_id
      RETURNING confirmed_at INTO v_confirmed_at;
    END IF;

    IF NOT v_already_confirmed THEN
      FOR v_item IN
        SELECT ii.id, ii.item_name, ii.quantity, ii.catalog_item_id
        FROM public.invoice_items AS ii
        WHERE ii.invoice_id = p_invoice_id
      LOOP
        IF v_item.catalog_item_id IS NULL THEN
          v_no_catalog_count := v_no_catalog_count + 1;
          v_results := v_results || jsonb_build_object(
            'item_name', v_item.item_name,
            'quantity_confirmed', v_item.quantity,
            'status', 'no_catalog_match'
          );
        ELSE
          v_confirmed_count := v_confirmed_count + 1;
          IF v_item.quantity IS NOT NULL AND v_item.quantity > 0 THEN
            IF NOT EXISTS (
              SELECT 1 FROM public.stock_movements sm
              WHERE sm.invoice_item_id = v_item.id
                AND sm.movement_type = 'receive'
            ) THEN
              INSERT INTO public.stock_movements (
                restaurant_id, catalog_item_id, movement_type, quantity,
                reference_type, reference_id, invoice_id, invoice_item_id, created_by
              )
              VALUES (
                p_restaurant_id,
                v_item.catalog_item_id,
                'receive',
                v_item.quantity,
                'invoice_receipt',
                p_invoice_id,
                p_invoice_id,
                v_item.id,
                auth.uid()
              );
              v_movements_count := v_movements_count + 1;
            END IF;
          END IF;
          v_results := v_results || jsonb_build_object(
            'item_name', v_item.item_name,
            'quantity_confirmed', v_item.quantity,
            'status', CASE WHEN v_already_confirmed THEN 'already_confirmed' ELSE 'confirmed' END
          );
        END IF;
      END LOOP;
    ELSE
      FOR v_item IN
        SELECT ii.id, ii.item_name, ii.quantity, ii.catalog_item_id
        FROM public.invoice_items AS ii
        WHERE ii.invoice_id = p_invoice_id
      LOOP
        IF v_item.catalog_item_id IS NULL THEN
          v_no_catalog_count := v_no_catalog_count + 1;
        ELSE
          v_confirmed_count := v_confirmed_count + 1;
        END IF;
        v_results := v_results || jsonb_build_object(
          'item_name', v_item.item_name,
          'quantity_confirmed', v_item.quantity,
          'status', CASE WHEN v_item.catalog_item_id IS NULL THEN 'no_catalog_match' ELSE 'already_confirmed' END
        );
      END LOOP;
    END IF;

    RETURN jsonb_build_object(
      'success', true,
      'already_confirmed', v_already_confirmed,
      'confirmed', v_confirmed_count,
      'no_catalog', v_no_catalog_count,
      'inventory_updated', v_movements_count > 0,
      'stock_movements_created', v_movements_count,
      'confirmed_at', v_confirmed_at,
      'message', CASE
        WHEN v_already_confirmed THEN 'Receipt was already confirmed.'
        ELSE format('Receipt confirmed. %s stock movement(s) recorded.', v_movements_count)
      END,
      'items', v_results
    );
  END IF;

  -- Legacy: row only in purchase_history (not migrated to invoices)
  PERFORM 1 FROM public.purchase_history AS ph
  WHERE ph.id = p_invoice_id AND ph.restaurant_id = p_restaurant_id;
  IF FOUND THEN
    RETURN public.confirm_invoice_receipt_legacy(p_invoice_id, p_restaurant_id);
  END IF;

  RAISE EXCEPTION 'Invoice not found';
END;
$$;

-- -----------------------------------------------------------------------------
-- 12. notify_delivery_issues + get_delivery_issue_pos (invoices + legacy ph)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.notify_delivery_issues(
  p_purchase_history_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_restaurant_id   uuid;
  v_po_number       text;
  v_missing         bigint;
  v_partial         bigint;
  v_price           bigint;
  v_total           bigint;
  v_severity        text;
  v_title           text;
  v_message         text;
  v_data            jsonb;
  v_notified        integer := 0;
  v_member          RECORD;
  v_parts           text[];
BEGIN
  SELECT inv.restaurant_id INTO v_restaurant_id
  FROM public.invoices inv WHERE inv.id = p_purchase_history_id;
  IF NOT FOUND THEN
    SELECT ph.restaurant_id INTO v_restaurant_id
    FROM public.purchase_history ph WHERE ph.id = p_purchase_history_id;
  END IF;
  IF v_restaurant_id IS NULL THEN
    RAISE EXCEPTION 'Document not found';
  END IF;
  IF NOT public.is_member_of(v_restaurant_id) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  v_po_number := '';
  SELECT COALESCE(po.po_number, '')
  INTO v_po_number
  FROM public.invoices inv
  LEFT JOIN public.purchase_orders po ON po.id = inv.purchase_order_id
  WHERE inv.id = p_purchase_history_id;
  IF NOT FOUND OR v_po_number = '' THEN
    SELECT COALESCE(ph.po_number, '') INTO v_po_number
    FROM public.purchase_history ph WHERE ph.id = p_purchase_history_id;
  END IF;

  SELECT
    COUNT(*) FILTER (WHERE ilc.status = 'missing_from_invoice'),
    COUNT(*) FILTER (WHERE ilc.status = 'qty_mismatch' AND ilc.qty_diff < 0),
    COUNT(*) FILTER (WHERE ilc.status = 'price_mismatch' AND ABS(ilc.cost_diff) > 1.00),
    COUNT(*) FILTER (WHERE ilc.status = 'total_mismatch' AND ABS(ilc.total_diff) > 1.00)
  INTO v_missing, v_partial, v_price, v_total
  FROM public.invoice_line_comparisons ilc
  WHERE (ilc.invoice_id = p_purchase_history_id OR ilc.purchase_history_id = p_purchase_history_id)
    AND ilc.catalog_item_id IS NOT NULL;

  IF COALESCE(v_missing, 0) + COALESCE(v_partial, 0) + COALESCE(v_price, 0) + COALESCE(v_total, 0) = 0 THEN
    RETURN jsonb_build_object('notified', 0, 'reason', 'no_qualifying_issues');
  END IF;

  v_severity := CASE WHEN v_missing > 0 THEN 'CRITICAL' ELSE 'WARNING' END;
  v_parts := ARRAY[]::text[];
  IF v_missing > 0 THEN
    v_parts := array_append(v_parts, v_missing || ' missing item' || CASE WHEN v_missing > 1 THEN 's' ELSE '' END);
  END IF;
  IF v_partial > 0 THEN
    v_parts := array_append(v_parts, v_partial || ' partial delivery' || CASE WHEN v_partial > 1 THEN 's' ELSE '' END);
  END IF;
  IF v_price > 0 THEN
    v_parts := array_append(v_parts, v_price || ' price gap' || CASE WHEN v_price > 1 THEN 's' ELSE '' END);
  END IF;
  IF v_total > 0 THEN
    v_parts := array_append(v_parts, v_total || ' line-total gap' || CASE WHEN v_total > 1 THEN 's' ELSE '' END);
  END IF;

  v_title   := 'Delivery Issues Detected';
  v_message := array_to_string(v_parts, ', ')
    || CASE WHEN v_po_number IS NOT NULL AND v_po_number <> '' THEN ' on ' || v_po_number ELSE '' END
    || '. Review the invoice to resolve.';

  v_data := jsonb_build_object(
    'purchase_history_id', p_purchase_history_id,
    'po_number', v_po_number,
    'missing_count', COALESCE(v_missing, 0),
    'partial_count', COALESCE(v_partial, 0),
    'price_mismatch_count', COALESCE(v_price, 0),
    'total_mismatch_count', COALESCE(v_total, 0)
  );

  FOR v_member IN
    SELECT user_id
    FROM public.restaurant_members
    WHERE restaurant_id = v_restaurant_id
      AND role IN ('OWNER', 'MANAGER')
  LOOP
    INSERT INTO public.notifications (
      restaurant_id, location_id, user_id, type, title, message, severity, data
    ) VALUES (
      v_restaurant_id, NULL, v_member.user_id, 'DELIVERY_ISSUE',
      v_title, v_message, v_severity, v_data
    )
    ON CONFLICT DO NOTHING;
    v_notified := v_notified + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'notified', v_notified,
    'missing_count', COALESCE(v_missing, 0),
    'partial_count', COALESCE(v_partial, 0),
    'price_mismatch_count', COALESCE(v_price, 0),
    'total_mismatch_count', COALESCE(v_total, 0)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.get_delivery_issue_pos(
  p_restaurant_id uuid
)
RETURNS TABLE (
  purchase_history_id uuid,
  po_number text,
  issue_count bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_member_of(p_restaurant_id) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  RETURN QUERY
  SELECT x.purchase_history_id, x.po_number, x.issue_count
  FROM (
    SELECT
      inv.id AS purchase_history_id,
      COALESCE(po.po_number, ''::text) AS po_number,
      COUNT(*)::bigint AS issue_count
    FROM public.invoices inv
    LEFT JOIN public.purchase_orders po ON po.id = inv.purchase_order_id
    JOIN public.invoice_line_comparisons ilc ON ilc.invoice_id = inv.id
    WHERE inv.restaurant_id = p_restaurant_id
      AND ilc.catalog_item_id IS NOT NULL
      AND COALESCE(inv.receipt_status, '') <> 'confirmed'
      AND inv.status <> 'confirmed'
      AND (
        ilc.status = 'missing_from_invoice'
        OR (ilc.status = 'qty_mismatch' AND ilc.qty_diff < 0)
        OR (ilc.status = 'price_mismatch' AND ABS(ilc.cost_diff) > 1.00)
        OR (ilc.status = 'total_mismatch' AND ABS(ilc.total_diff) > 1.00)
      )
    GROUP BY inv.id, po.po_number

    UNION ALL

    SELECT
      ph.id AS purchase_history_id,
      COALESCE(ph.po_number, ''::text) AS po_number,
      COUNT(*)::bigint AS issue_count
    FROM public.purchase_history ph
    JOIN public.invoice_line_comparisons ilc ON ilc.purchase_history_id = ph.id
    WHERE ph.restaurant_id = p_restaurant_id
      AND ilc.invoice_id IS NULL
      AND ilc.catalog_item_id IS NOT NULL
      AND COALESCE(ph.receipt_status, '') <> 'confirmed'
      AND (
        ilc.status = 'missing_from_invoice'
        OR (ilc.status = 'qty_mismatch' AND ilc.qty_diff < 0)
        OR (ilc.status = 'price_mismatch' AND ABS(ilc.cost_diff) > 1.00)
        OR (ilc.status = 'total_mismatch' AND ABS(ilc.total_diff) > 1.00)
      )
    GROUP BY ph.id, ph.po_number
  ) x
  ORDER BY x.issue_count DESC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.confirm_invoice_receipt_legacy(uuid, uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';