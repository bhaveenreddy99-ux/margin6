-- Child rows follow parent visibility: EXISTS on parent lets parent RLS enforce
-- tenant + location (same rules as invoices / purchase_orders / purchase_history).
-- Also tightens purchase_orders and purchase_history SELECT to match invoices.

-- -----------------------------------------------------------------------------
-- purchase_orders: SELECT matches invoices (was restaurant-only)
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS "Members can view purchase orders" ON public.purchase_orders;

CREATE POLICY "Members can view purchase orders"
  ON public.purchase_orders
  FOR SELECT TO authenticated
  USING (
    public.is_member_of(restaurant_id)
    AND (
      location_id IS NULL
      OR public.user_can_access_location(auth.uid(), location_id)
    )
  );

-- -----------------------------------------------------------------------------
-- purchase_history: SELECT matches invoices (was restaurant-only; has location_id)
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS "Members can view purchase history" ON public.purchase_history;

CREATE POLICY "Members can view purchase history"
  ON public.purchase_history
  FOR SELECT TO authenticated
  USING (
    public.is_member_of(restaurant_id)
    AND (
      location_id IS NULL
      OR public.user_can_access_location(auth.uid(), location_id)
    )
  );

-- -----------------------------------------------------------------------------
-- invoice_items
-- Old SELECT: USING (is_member_of(invoice_restaurant_id(invoice_id)))
-- New: EXISTS (… FROM invoices …) — parent "Members can view invoices" RLS applies.
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS "Members can view invoice items" ON public.invoice_items;
DROP POLICY IF EXISTS "Manager+ can insert invoice items" ON public.invoice_items;
DROP POLICY IF EXISTS "Manager+ can update invoice items" ON public.invoice_items;
DROP POLICY IF EXISTS "Manager+ can delete invoice items" ON public.invoice_items;

CREATE POLICY "Members can view invoice items"
  ON public.invoice_items
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.invoices i
      WHERE i.id = invoice_items.invoice_id
    )
  );

CREATE POLICY "Manager+ can insert invoice items"
  ON public.invoice_items
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.invoices i
      WHERE i.id = invoice_items.invoice_id
    )
    AND public.has_restaurant_role_any(
      public.invoice_restaurant_id(invoice_items.invoice_id),
      ARRAY['OWNER'::public.app_role, 'MANAGER'::public.app_role]
    )
  );

CREATE POLICY "Manager+ can update invoice items"
  ON public.invoice_items
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.invoices i
      WHERE i.id = invoice_items.invoice_id
    )
    AND public.has_restaurant_role_any(
      public.invoice_restaurant_id(invoice_items.invoice_id),
      ARRAY['OWNER'::public.app_role, 'MANAGER'::public.app_role]
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.invoices i
      WHERE i.id = invoice_items.invoice_id
    )
    AND public.has_restaurant_role_any(
      public.invoice_restaurant_id(invoice_items.invoice_id),
      ARRAY['OWNER'::public.app_role, 'MANAGER'::public.app_role]
    )
  );

CREATE POLICY "Manager+ can delete invoice items"
  ON public.invoice_items
  FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.invoices i
      WHERE i.id = invoice_items.invoice_id
    )
    AND public.has_restaurant_role_any(
      public.invoice_restaurant_id(invoice_items.invoice_id),
      ARRAY['OWNER'::public.app_role, 'MANAGER'::public.app_role]
    )
  );

-- -----------------------------------------------------------------------------
-- invoice_line_comparisons
-- Old: is_member_of(parent restaurant) only — no location gate on parents.
-- New: EXISTS on invoices / purchase_history so parent SELECT RLS enforces location.
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS "Members can view invoice line comparisons" ON public.invoice_line_comparisons;
DROP POLICY IF EXISTS "Members can create invoice line comparisons" ON public.invoice_line_comparisons;
DROP POLICY IF EXISTS "Members can update invoice line comparisons" ON public.invoice_line_comparisons;
DROP POLICY IF EXISTS "Members can delete invoice line comparisons" ON public.invoice_line_comparisons;

CREATE POLICY "Members can view invoice line comparisons"
  ON public.invoice_line_comparisons
  FOR SELECT TO authenticated
  USING (
    (
      invoice_id IS NOT NULL
      AND EXISTS (
        SELECT 1
        FROM public.invoices i
        WHERE i.id = invoice_line_comparisons.invoice_id
      )
    )
    OR (
      purchase_history_id IS NOT NULL
      AND EXISTS (
        SELECT 1
        FROM public.purchase_history ph
        WHERE ph.id = invoice_line_comparisons.purchase_history_id
      )
    )
  );

CREATE POLICY "Members can create invoice line comparisons"
  ON public.invoice_line_comparisons
  FOR INSERT TO authenticated
  WITH CHECK (
    (
      invoice_id IS NOT NULL
      AND EXISTS (
        SELECT 1
        FROM public.invoices i
        WHERE i.id = invoice_line_comparisons.invoice_id
      )
    )
    OR (
      purchase_history_id IS NOT NULL
      AND EXISTS (
        SELECT 1
        FROM public.purchase_history ph
        WHERE ph.id = invoice_line_comparisons.purchase_history_id
      )
    )
  );

CREATE POLICY "Members can update invoice line comparisons"
  ON public.invoice_line_comparisons
  FOR UPDATE TO authenticated
  USING (
    (
      invoice_id IS NOT NULL
      AND EXISTS (
        SELECT 1
        FROM public.invoices i
        WHERE i.id = invoice_line_comparisons.invoice_id
      )
    )
    OR (
      purchase_history_id IS NOT NULL
      AND EXISTS (
        SELECT 1
        FROM public.purchase_history ph
        WHERE ph.id = invoice_line_comparisons.purchase_history_id
      )
    )
  )
  WITH CHECK (
    (
      invoice_id IS NOT NULL
      AND EXISTS (
        SELECT 1
        FROM public.invoices i
        WHERE i.id = invoice_line_comparisons.invoice_id
      )
    )
    OR (
      purchase_history_id IS NOT NULL
      AND EXISTS (
        SELECT 1
        FROM public.purchase_history ph
        WHERE ph.id = invoice_line_comparisons.purchase_history_id
      )
    )
  );

CREATE POLICY "Members can delete invoice line comparisons"
  ON public.invoice_line_comparisons
  FOR DELETE TO authenticated
  USING (
    (
      invoice_id IS NOT NULL
      AND EXISTS (
        SELECT 1
        FROM public.invoices i
        WHERE i.id = invoice_line_comparisons.invoice_id
      )
    )
    OR (
      purchase_history_id IS NOT NULL
      AND EXISTS (
        SELECT 1
        FROM public.purchase_history ph
        WHERE ph.id = invoice_line_comparisons.purchase_history_id
      )
    )
  );

-- -----------------------------------------------------------------------------
-- purchase_order_items
-- Old SELECT: is_member_of(purchase_order_restaurant_id(purchase_order_id))
-- New: EXISTS (… FROM purchase_orders …) — parent policy above applies.
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS "Members can view purchase order items" ON public.purchase_order_items;
DROP POLICY IF EXISTS "Manager+ can insert purchase order items" ON public.purchase_order_items;
DROP POLICY IF EXISTS "Manager+ can update purchase order items" ON public.purchase_order_items;
DROP POLICY IF EXISTS "Manager+ can delete purchase order items" ON public.purchase_order_items;

CREATE POLICY "Members can view purchase order items"
  ON public.purchase_order_items
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.purchase_orders po
      WHERE po.id = purchase_order_items.purchase_order_id
    )
  );

CREATE POLICY "Manager+ can insert purchase order items"
  ON public.purchase_order_items
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.purchase_orders po
      WHERE po.id = purchase_order_items.purchase_order_id
    )
    AND public.has_restaurant_role_any(
      public.purchase_order_restaurant_id(purchase_order_items.purchase_order_id),
      ARRAY['OWNER'::public.app_role, 'MANAGER'::public.app_role]
    )
  );

CREATE POLICY "Manager+ can update purchase order items"
  ON public.purchase_order_items
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.purchase_orders po
      WHERE po.id = purchase_order_items.purchase_order_id
    )
    AND public.has_restaurant_role_any(
      public.purchase_order_restaurant_id(purchase_order_items.purchase_order_id),
      ARRAY['OWNER'::public.app_role, 'MANAGER'::public.app_role]
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.purchase_orders po
      WHERE po.id = purchase_order_items.purchase_order_id
    )
    AND public.has_restaurant_role_any(
      public.purchase_order_restaurant_id(purchase_order_items.purchase_order_id),
      ARRAY['OWNER'::public.app_role, 'MANAGER'::public.app_role]
    )
  );

CREATE POLICY "Manager+ can delete purchase order items"
  ON public.purchase_order_items
  FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.purchase_orders po
      WHERE po.id = purchase_order_items.purchase_order_id
    )
    AND public.has_restaurant_role_any(
      public.purchase_order_restaurant_id(purchase_order_items.purchase_order_id),
      ARRAY['OWNER'::public.app_role, 'MANAGER'::public.app_role]
    )
  );
