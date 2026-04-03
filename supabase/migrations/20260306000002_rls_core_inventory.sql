-- =============================================================================
-- RLS FIX (1/3): Core inventory, order, and invoice tables
--
-- Converts policies from TO public (default) → TO authenticated.
-- Adds WITH CHECK to all UPDATE policies.
-- Also patches Part-3/Part-4 items that belong to this domain:
--   • DELETE policies that were added later without TO authenticated
--   • UPDATE policies on tables from the initial migration that lacked WITH CHECK
-- =============================================================================


-- -----------------------------------------------------------------------------
-- import_templates
-- All restaurant members can read, create, update, and delete import templates.
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS "Members can view import templates"   ON public.import_templates;
DROP POLICY IF EXISTS "Members can create import templates" ON public.import_templates;
DROP POLICY IF EXISTS "Members can update import templates" ON public.import_templates;
DROP POLICY IF EXISTS "Members can delete import templates" ON public.import_templates;

-- Any restaurant member can view templates for their restaurant.
CREATE POLICY "Members can view import templates"
  ON public.import_templates FOR SELECT TO authenticated
  USING (is_member_of(restaurant_id));

-- Any restaurant member can create templates for their restaurant.
CREATE POLICY "Members can create import templates"
  ON public.import_templates FOR INSERT TO authenticated
  WITH CHECK (is_member_of(restaurant_id));

-- Any restaurant member can update templates; new values must stay in the same restaurant.
CREATE POLICY "Members can update import templates"
  ON public.import_templates FOR UPDATE TO authenticated
  USING     (is_member_of(restaurant_id))
  WITH CHECK (is_member_of(restaurant_id));

-- Any restaurant member can delete templates for their restaurant.
CREATE POLICY "Members can delete import templates"
  ON public.import_templates FOR DELETE TO authenticated
  USING (is_member_of(restaurant_id));


-- -----------------------------------------------------------------------------
-- inventory_catalog_items
-- All restaurant members can read and manage catalog items for their restaurant.
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS "Members can view catalog items"   ON public.inventory_catalog_items;
DROP POLICY IF EXISTS "Members can create catalog items" ON public.inventory_catalog_items;
DROP POLICY IF EXISTS "Members can update catalog items" ON public.inventory_catalog_items;
DROP POLICY IF EXISTS "Members can delete catalog items" ON public.inventory_catalog_items;

-- Any restaurant member can view their catalog.
CREATE POLICY "Members can view catalog items"
  ON public.inventory_catalog_items FOR SELECT TO authenticated
  USING (is_member_of(restaurant_id));

-- Any restaurant member can add items to their catalog.
CREATE POLICY "Members can create catalog items"
  ON public.inventory_catalog_items FOR INSERT TO authenticated
  WITH CHECK (is_member_of(restaurant_id));

-- Any restaurant member can edit catalog items; item must remain in the same restaurant.
CREATE POLICY "Members can update catalog items"
  ON public.inventory_catalog_items FOR UPDATE TO authenticated
  USING     (is_member_of(restaurant_id))
  WITH CHECK (is_member_of(restaurant_id));

-- Any restaurant member can remove catalog items.
CREATE POLICY "Members can delete catalog items"
  ON public.inventory_catalog_items FOR DELETE TO authenticated
  USING (is_member_of(restaurant_id));


-- -----------------------------------------------------------------------------
-- inventory_import_files
-- All restaurant members can read and create import file records; any member
-- can also delete them (upload history cleanup).
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS "Members can view import files"   ON public.inventory_import_files;
DROP POLICY IF EXISTS "Members can create import files" ON public.inventory_import_files;
DROP POLICY IF EXISTS "Members can delete import files" ON public.inventory_import_files;

-- Any restaurant member can view their import file history.
CREATE POLICY "Members can view import files"
  ON public.inventory_import_files FOR SELECT TO authenticated
  USING (is_member_of(restaurant_id));

-- Any restaurant member can create an import file record.
CREATE POLICY "Members can create import files"
  ON public.inventory_import_files FOR INSERT TO authenticated
  WITH CHECK (is_member_of(restaurant_id));

-- Any restaurant member can delete import file records.
CREATE POLICY "Members can delete import files"
  ON public.inventory_import_files FOR DELETE TO authenticated
  USING (is_member_of(restaurant_id));


-- -----------------------------------------------------------------------------
-- import_runs
-- All restaurant members can view and create import runs; any member can delete.
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS "Members can view import runs"   ON public.import_runs;
DROP POLICY IF EXISTS "Members can create import runs" ON public.import_runs;
DROP POLICY IF EXISTS "Members can delete import runs" ON public.import_runs;

-- Any restaurant member can view import run history.
CREATE POLICY "Members can view import runs"
  ON public.import_runs FOR SELECT TO authenticated
  USING (is_member_of(restaurant_id));

-- Any restaurant member can create an import run record.
CREATE POLICY "Members can create import runs"
  ON public.import_runs FOR INSERT TO authenticated
  WITH CHECK (is_member_of(restaurant_id));

-- Any restaurant member can delete import run records.
CREATE POLICY "Members can delete import runs"
  ON public.import_runs FOR DELETE TO authenticated
  USING (is_member_of(restaurant_id));


-- -----------------------------------------------------------------------------
-- purchase_history
-- All restaurant members can view purchase history.
-- Only Managers and Owners can create, update, or delete purchase history records.
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS "Members can view purchase history"    ON public.purchase_history;
DROP POLICY IF EXISTS "Manager+ can create purchase history" ON public.purchase_history;
DROP POLICY IF EXISTS "Manager+ can update purchase history" ON public.purchase_history;
DROP POLICY IF EXISTS "Manager+ can delete purchase history" ON public.purchase_history;

-- Any restaurant member can view purchase history.
CREATE POLICY "Members can view purchase history"
  ON public.purchase_history FOR SELECT TO authenticated
  USING (is_member_of(restaurant_id));

-- Only Managers and Owners can create purchase history records.
CREATE POLICY "Manager+ can create purchase history"
  ON public.purchase_history FOR INSERT TO authenticated
  WITH CHECK (has_restaurant_role_any(restaurant_id, ARRAY['OWNER'::app_role, 'MANAGER'::app_role]));

-- Only Managers and Owners can update purchase history (e.g. invoice workflow);
-- the record must remain associated with the same restaurant after update.
CREATE POLICY "Manager+ can update purchase history"
  ON public.purchase_history FOR UPDATE TO authenticated
  USING     (has_restaurant_role_any(restaurant_id, ARRAY['OWNER'::app_role, 'MANAGER'::app_role]))
  WITH CHECK (has_restaurant_role_any(restaurant_id, ARRAY['OWNER'::app_role, 'MANAGER'::app_role]));

-- Only Managers and Owners can delete purchase history records.
CREATE POLICY "Manager+ can delete purchase history"
  ON public.purchase_history FOR DELETE TO authenticated
  USING (has_restaurant_role_any(restaurant_id, ARRAY['OWNER'::app_role, 'MANAGER'::app_role]));


-- -----------------------------------------------------------------------------
-- purchase_history_items
-- All restaurant members can view line items; any member can insert or delete them.
-- Note: policy names say "Manager+" but the original conditions used is_member_of —
-- that original permissiveness is preserved intentionally.
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS "Members can view purchase history items"    ON public.purchase_history_items;
DROP POLICY IF EXISTS "Manager+ can create purchase history items" ON public.purchase_history_items;
DROP POLICY IF EXISTS "Manager+ can delete purchase history items" ON public.purchase_history_items;

-- Any restaurant member can view purchase history line items.
CREATE POLICY "Members can view purchase history items"
  ON public.purchase_history_items FOR SELECT TO authenticated
  USING (is_member_of(purchase_history_restaurant_id(purchase_history_id)));

-- Any restaurant member can create purchase history line items.
CREATE POLICY "Manager+ can create purchase history items"
  ON public.purchase_history_items FOR INSERT TO authenticated
  WITH CHECK (is_member_of(purchase_history_restaurant_id(purchase_history_id)));

-- Any restaurant member can delete purchase history line items.
CREATE POLICY "Manager+ can delete purchase history items"
  ON public.purchase_history_items FOR DELETE TO authenticated
  USING (is_member_of(purchase_history_restaurant_id(purchase_history_id)));


-- -----------------------------------------------------------------------------
-- invoice_line_comparisons
-- Replaces the single ALL-operation policy (no FOR, no TO, no WITH CHECK) with
-- explicit per-command policies scoped to authenticated.
-- All restaurant members can manage their invoice comparisons.
-- Uses existing purchase_history_restaurant_id() helper for restaurant scoping.
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS "Users can manage invoice_line_comparisons for their restaurant"
  ON public.invoice_line_comparisons;

-- Any restaurant member can view invoice line comparisons for their purchase history.
CREATE POLICY "Members can view invoice line comparisons"
  ON public.invoice_line_comparisons FOR SELECT TO authenticated
  USING (is_member_of(purchase_history_restaurant_id(purchase_history_id)));

-- Any restaurant member can create invoice line comparisons.
CREATE POLICY "Members can create invoice line comparisons"
  ON public.invoice_line_comparisons FOR INSERT TO authenticated
  WITH CHECK (is_member_of(purchase_history_restaurant_id(purchase_history_id)));

-- Any restaurant member can update invoice line comparisons; record must stay
-- linked to the same purchase history after update.
CREATE POLICY "Members can update invoice line comparisons"
  ON public.invoice_line_comparisons FOR UPDATE TO authenticated
  USING     (is_member_of(purchase_history_restaurant_id(purchase_history_id)))
  WITH CHECK (is_member_of(purchase_history_restaurant_id(purchase_history_id)));

-- Any restaurant member can delete invoice line comparisons.
CREATE POLICY "Members can delete invoice line comparisons"
  ON public.invoice_line_comparisons FOR DELETE TO authenticated
  USING (is_member_of(purchase_history_restaurant_id(purchase_history_id)));


-- -----------------------------------------------------------------------------
-- delivery_issues
-- Replaces the single ALL-operation policy with explicit per-command policies.
-- All restaurant members can manage delivery issues for their purchase history.
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS "Users can manage delivery_issues for their restaurant"
  ON public.delivery_issues;

-- Any restaurant member can view delivery issues for their purchase history.
CREATE POLICY "Members can view delivery issues"
  ON public.delivery_issues FOR SELECT TO authenticated
  USING (is_member_of(purchase_history_restaurant_id(purchase_history_id)));

-- Any restaurant member can report a delivery issue.
CREATE POLICY "Members can create delivery issues"
  ON public.delivery_issues FOR INSERT TO authenticated
  WITH CHECK (is_member_of(purchase_history_restaurant_id(purchase_history_id)));

-- Any restaurant member can update delivery issues; record must stay linked to
-- the same purchase history after update.
CREATE POLICY "Members can update delivery issues"
  ON public.delivery_issues FOR UPDATE TO authenticated
  USING     (is_member_of(purchase_history_restaurant_id(purchase_history_id)))
  WITH CHECK (is_member_of(purchase_history_restaurant_id(purchase_history_id)));

-- Any restaurant member can delete delivery issues.
CREATE POLICY "Members can delete delivery issues"
  ON public.delivery_issues FOR DELETE TO authenticated
  USING (is_member_of(purchase_history_restaurant_id(purchase_history_id)));


-- =============================================================================
-- Patch: DELETE policies added after the initial migration without TO authenticated
-- These belong to core inventory/order tables already converted to TO authenticated.
-- =============================================================================

-- inventory_sessions: any member can delete sessions for their restaurant.
DROP POLICY IF EXISTS "Members can delete sessions" ON public.inventory_sessions;
CREATE POLICY "Members can delete sessions"
  ON public.inventory_sessions FOR DELETE TO authenticated
  USING (is_member_of(restaurant_id));

-- smart_order_runs: any member can delete smart order runs for their restaurant.
DROP POLICY IF EXISTS "Members can delete smart order runs" ON public.smart_order_runs;
CREATE POLICY "Members can delete smart order runs"
  ON public.smart_order_runs FOR DELETE TO authenticated
  USING (is_member_of(restaurant_id));

-- smart_order_run_items: any member can delete run items (via parent run's restaurant).
DROP POLICY IF EXISTS "Members can delete run items" ON public.smart_order_run_items;
CREATE POLICY "Members can delete run items"
  ON public.smart_order_run_items FOR DELETE TO authenticated
  USING (is_member_of(smart_order_run_restaurant_id(run_id)));

-- orders: any member can delete orders for their restaurant.
DROP POLICY IF EXISTS "Members can delete orders" ON public.orders;
CREATE POLICY "Members can delete orders"
  ON public.orders FOR DELETE TO authenticated
  USING (is_member_of(restaurant_id));

-- order_items: any member can delete order items (via parent order's restaurant).
DROP POLICY IF EXISTS "Members can delete order items" ON public.order_items;
CREATE POLICY "Members can delete order items"
  ON public.order_items FOR DELETE TO authenticated
  USING (is_member_of(order_restaurant_id(order_id)));

-- usage_events: any member can delete usage events for their restaurant.
DROP POLICY IF EXISTS "Members can delete usage events" ON public.usage_events;
CREATE POLICY "Members can delete usage events"
  ON public.usage_events FOR DELETE TO authenticated
  USING (is_member_of(restaurant_id));


-- =============================================================================
-- Patch: UPDATE policies on core tables (from initial migration) missing WITH CHECK
-- WITH CHECK ensures updated rows cannot be moved to a restaurant the user lacks
-- access to, matching the intent of the original USING conditions.
-- =============================================================================

-- inventory_lists: only Managers and Owners can update; list must stay in the
-- same restaurant after update.
DROP POLICY IF EXISTS "Manager+ can update inventory lists" ON public.inventory_lists;
CREATE POLICY "Manager+ can update inventory lists"
  ON public.inventory_lists FOR UPDATE TO authenticated
  USING     (has_restaurant_role_any(restaurant_id, ARRAY['OWNER'::app_role, 'MANAGER'::app_role]))
  WITH CHECK (has_restaurant_role_any(restaurant_id, ARRAY['OWNER'::app_role, 'MANAGER'::app_role]));

-- inventory_session_items: any member can update session items; item must remain
-- in the same session's restaurant after update.
DROP POLICY IF EXISTS "Members can update session items" ON public.inventory_session_items;
CREATE POLICY "Members can update session items"
  ON public.inventory_session_items FOR UPDATE TO authenticated
  USING     (is_member_of(session_restaurant_id(session_id)))
  WITH CHECK (is_member_of(session_restaurant_id(session_id)));

-- par_guides: only Managers and Owners can update; guide must stay in the
-- same restaurant after update.
DROP POLICY IF EXISTS "Manager+ can update PAR guides" ON public.par_guides;
CREATE POLICY "Manager+ can update PAR guides"
  ON public.par_guides FOR UPDATE TO authenticated
  USING     (has_restaurant_role_any(restaurant_id, ARRAY['OWNER'::app_role, 'MANAGER'::app_role]))
  WITH CHECK (has_restaurant_role_any(restaurant_id, ARRAY['OWNER'::app_role, 'MANAGER'::app_role]));

-- par_guide_items: any member can update PAR items; item must remain in the
-- same guide's restaurant after update.
DROP POLICY IF EXISTS "Manager+ can update PAR items" ON public.par_guide_items;
CREATE POLICY "Manager+ can update PAR items"
  ON public.par_guide_items FOR UPDATE TO authenticated
  USING     (is_member_of(par_guide_restaurant_id(par_guide_id)))
  WITH CHECK (is_member_of(par_guide_restaurant_id(par_guide_id)));

-- custom_lists: any member can update custom lists; list must stay in the
-- same restaurant after update.
DROP POLICY IF EXISTS "Members can update custom lists" ON public.custom_lists;
CREATE POLICY "Members can update custom lists"
  ON public.custom_lists FOR UPDATE TO authenticated
  USING     (is_member_of(restaurant_id))
  WITH CHECK (is_member_of(restaurant_id));

-- custom_list_items: any member can update custom list items; item must remain
-- in the same list's restaurant after update.
DROP POLICY IF EXISTS "Members can update list items" ON public.custom_list_items;
CREATE POLICY "Members can update list items"
  ON public.custom_list_items FOR UPDATE TO authenticated
  USING     (is_member_of(custom_list_restaurant_id(list_id)))
  WITH CHECK (is_member_of(custom_list_restaurant_id(list_id)));

-- orders: any member can update orders; order must remain in the same restaurant.
DROP POLICY IF EXISTS "Members can update orders" ON public.orders;
CREATE POLICY "Members can update orders"
  ON public.orders FOR UPDATE TO authenticated
  USING     (is_member_of(restaurant_id))
  WITH CHECK (is_member_of(restaurant_id));

-- order_items: any member can update order items; item must remain in the same
-- order's restaurant after update.
DROP POLICY IF EXISTS "Members can update order items" ON public.order_items;
CREATE POLICY "Members can update order items"
  ON public.order_items FOR UPDATE TO authenticated
  USING     (is_member_of(order_restaurant_id(order_id)))
  WITH CHECK (is_member_of(order_restaurant_id(order_id)));

-- inventory_sessions (Manager+ update): Managers and Owners can update any
-- session (including approving); session must remain in the same restaurant.
-- (The Staff update policy "Staff can update in-progress sessions" already has
-- both USING and WITH CHECK and is not modified here.)
DROP POLICY IF EXISTS "Manager+ can update sessions" ON public.inventory_sessions;
CREATE POLICY "Manager+ can update sessions"
  ON public.inventory_sessions FOR UPDATE TO authenticated
  USING     (has_restaurant_role_any(restaurant_id, ARRAY['OWNER'::app_role, 'MANAGER'::app_role]))
  WITH CHECK (has_restaurant_role_any(restaurant_id, ARRAY['OWNER'::app_role, 'MANAGER'::app_role]));


NOTIFY pgrst, 'reload schema';
