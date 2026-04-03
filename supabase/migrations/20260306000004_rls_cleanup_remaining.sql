-- =============================================================================
-- RLS FIX (3/3): Remaining tables + core table UPDATE WITH CHECK patches
--
-- Converts policies from TO public (default) → TO authenticated for:
--   categories, inventory_items, par_items, list_categories, list_category_sets,
--   list_item_category_map, vendor_integrations, invitations, waste_log
--
-- Also patches UPDATE policies on core auth/identity tables (restaurants,
-- restaurant_members, profiles) that were already TO authenticated but were
-- missing WITH CHECK clauses.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- categories
-- All restaurant members can read, create, update, and delete categories.
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS "Members can view categories"   ON public.categories;
DROP POLICY IF EXISTS "Members can create categories" ON public.categories;
DROP POLICY IF EXISTS "Members can update categories" ON public.categories;
DROP POLICY IF EXISTS "Members can delete categories" ON public.categories;

-- Any restaurant member can view categories for their restaurant.
CREATE POLICY "Members can view categories"
  ON public.categories FOR SELECT TO authenticated
  USING (is_member_of(restaurant_id));

-- Any restaurant member can create categories.
CREATE POLICY "Members can create categories"
  ON public.categories FOR INSERT TO authenticated
  WITH CHECK (is_member_of(restaurant_id));

-- Any restaurant member can update categories; category must remain in the
-- same restaurant after update.
CREATE POLICY "Members can update categories"
  ON public.categories FOR UPDATE TO authenticated
  USING     (is_member_of(restaurant_id))
  WITH CHECK (is_member_of(restaurant_id));

-- Any restaurant member can delete categories.
CREATE POLICY "Members can delete categories"
  ON public.categories FOR DELETE TO authenticated
  USING (is_member_of(restaurant_id));


-- -----------------------------------------------------------------------------
-- inventory_items
-- All restaurant members can read, create, update, and delete inventory items.
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS "Members can view inventory items"   ON public.inventory_items;
DROP POLICY IF EXISTS "Members can create inventory items" ON public.inventory_items;
DROP POLICY IF EXISTS "Members can update inventory items" ON public.inventory_items;
DROP POLICY IF EXISTS "Members can delete inventory items" ON public.inventory_items;

-- Any restaurant member can view inventory items for their restaurant.
CREATE POLICY "Members can view inventory items"
  ON public.inventory_items FOR SELECT TO authenticated
  USING (is_member_of(restaurant_id));

-- Any restaurant member can create inventory items.
CREATE POLICY "Members can create inventory items"
  ON public.inventory_items FOR INSERT TO authenticated
  WITH CHECK (is_member_of(restaurant_id));

-- Any restaurant member can update inventory items; item must remain in the
-- same restaurant after update.
CREATE POLICY "Members can update inventory items"
  ON public.inventory_items FOR UPDATE TO authenticated
  USING     (is_member_of(restaurant_id))
  WITH CHECK (is_member_of(restaurant_id));

-- Any restaurant member can delete inventory items.
CREATE POLICY "Members can delete inventory items"
  ON public.inventory_items FOR DELETE TO authenticated
  USING (is_member_of(restaurant_id));


-- -----------------------------------------------------------------------------
-- par_items
-- All restaurant members can read, create, update, and delete PAR items.
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS "Members can view par items"   ON public.par_items;
DROP POLICY IF EXISTS "Members can create par items" ON public.par_items;
DROP POLICY IF EXISTS "Members can update par items" ON public.par_items;
DROP POLICY IF EXISTS "Members can delete par items" ON public.par_items;

-- Any restaurant member can view PAR items for their restaurant.
CREATE POLICY "Members can view par items"
  ON public.par_items FOR SELECT TO authenticated
  USING (is_member_of(restaurant_id));

-- Any restaurant member can create PAR items.
CREATE POLICY "Members can create par items"
  ON public.par_items FOR INSERT TO authenticated
  WITH CHECK (is_member_of(restaurant_id));

-- Any restaurant member can update PAR items; item must remain in the same
-- restaurant after update.
CREATE POLICY "Members can update par items"
  ON public.par_items FOR UPDATE TO authenticated
  USING     (is_member_of(restaurant_id))
  WITH CHECK (is_member_of(restaurant_id));

-- Any restaurant member can delete PAR items.
CREATE POLICY "Members can delete par items"
  ON public.par_items FOR DELETE TO authenticated
  USING (is_member_of(restaurant_id));


-- -----------------------------------------------------------------------------
-- list_categories
-- All restaurant members can manage per-list categories.
-- Restaurant scope is resolved through the parent inventory list.
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS "Members can view list categories"   ON public.list_categories;
DROP POLICY IF EXISTS "Members can create list categories" ON public.list_categories;
DROP POLICY IF EXISTS "Members can update list categories" ON public.list_categories;
DROP POLICY IF EXISTS "Members can delete list categories" ON public.list_categories;

-- Any member of the restaurant owning the list can view its categories.
CREATE POLICY "Members can view list categories"
  ON public.list_categories FOR SELECT TO authenticated
  USING (is_member_of(list_category_restaurant_id(list_id)));

-- Any member of the restaurant owning the list can create categories for it.
CREATE POLICY "Members can create list categories"
  ON public.list_categories FOR INSERT TO authenticated
  WITH CHECK (is_member_of(list_category_restaurant_id(list_id)));

-- Any member can update list categories; category must remain linked to a list
-- in the same restaurant after update.
CREATE POLICY "Members can update list categories"
  ON public.list_categories FOR UPDATE TO authenticated
  USING     (is_member_of(list_category_restaurant_id(list_id)))
  WITH CHECK (is_member_of(list_category_restaurant_id(list_id)));

-- Any member of the restaurant owning the list can delete its categories.
CREATE POLICY "Members can delete list categories"
  ON public.list_categories FOR DELETE TO authenticated
  USING (is_member_of(list_category_restaurant_id(list_id)));


-- -----------------------------------------------------------------------------
-- list_category_sets
-- All restaurant members can manage category sets.
-- Restaurant scope is resolved through the parent inventory list.
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS "Members can view category sets"   ON public.list_category_sets;
DROP POLICY IF EXISTS "Members can create category sets" ON public.list_category_sets;
DROP POLICY IF EXISTS "Members can update category sets" ON public.list_category_sets;
DROP POLICY IF EXISTS "Members can delete category sets" ON public.list_category_sets;

-- Any member of the restaurant owning the list can view its category sets.
CREATE POLICY "Members can view category sets"
  ON public.list_category_sets FOR SELECT TO authenticated
  USING (is_member_of(list_category_restaurant_id(list_id)));

-- Any member of the restaurant owning the list can create category sets.
CREATE POLICY "Members can create category sets"
  ON public.list_category_sets FOR INSERT TO authenticated
  WITH CHECK (is_member_of(list_category_restaurant_id(list_id)));

-- Any member can update category sets; set must remain linked to a list in the
-- same restaurant after update.
CREATE POLICY "Members can update category sets"
  ON public.list_category_sets FOR UPDATE TO authenticated
  USING     (is_member_of(list_category_restaurant_id(list_id)))
  WITH CHECK (is_member_of(list_category_restaurant_id(list_id)));

-- Any member of the restaurant owning the list can delete category sets.
CREATE POLICY "Members can delete category sets"
  ON public.list_category_sets FOR DELETE TO authenticated
  USING (is_member_of(list_category_restaurant_id(list_id)));


-- -----------------------------------------------------------------------------
-- list_item_category_map
-- All restaurant members can manage item-to-category assignments.
-- Restaurant scope is resolved through the parent inventory list.
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS "Members can view item category map"   ON public.list_item_category_map;
DROP POLICY IF EXISTS "Members can create item category map" ON public.list_item_category_map;
DROP POLICY IF EXISTS "Members can update item category map" ON public.list_item_category_map;
DROP POLICY IF EXISTS "Members can delete item category map" ON public.list_item_category_map;

-- Any member of the restaurant owning the list can view its item-category mappings.
CREATE POLICY "Members can view item category map"
  ON public.list_item_category_map FOR SELECT TO authenticated
  USING (is_member_of(list_item_map_restaurant_id(list_id)));

-- Any member of the restaurant owning the list can create item-category mappings.
CREATE POLICY "Members can create item category map"
  ON public.list_item_category_map FOR INSERT TO authenticated
  WITH CHECK (is_member_of(list_item_map_restaurant_id(list_id)));

-- Any member can update item-category mappings; mapping must remain linked to
-- a list in the same restaurant after update.
CREATE POLICY "Members can update item category map"
  ON public.list_item_category_map FOR UPDATE TO authenticated
  USING     (is_member_of(list_item_map_restaurant_id(list_id)))
  WITH CHECK (is_member_of(list_item_map_restaurant_id(list_id)));

-- Any member of the restaurant owning the list can delete item-category mappings.
CREATE POLICY "Members can delete item category map"
  ON public.list_item_category_map FOR DELETE TO authenticated
  USING (is_member_of(list_item_map_restaurant_id(list_id)));


-- -----------------------------------------------------------------------------
-- vendor_integrations
-- All members can view vendor integrations.
-- Only Managers and Owners can create, update, or delete vendor integrations
-- (these may contain encrypted API keys and sensitive account details).
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS "Members can view vendor integrations"    ON public.vendor_integrations;
DROP POLICY IF EXISTS "Manager+ can create vendor integrations" ON public.vendor_integrations;
DROP POLICY IF EXISTS "Manager+ can update vendor integrations" ON public.vendor_integrations;
DROP POLICY IF EXISTS "Manager+ can delete vendor integrations" ON public.vendor_integrations;

-- Any restaurant member can view vendor integrations.
CREATE POLICY "Members can view vendor integrations"
  ON public.vendor_integrations FOR SELECT TO authenticated
  USING (is_member_of(restaurant_id));

-- Only Managers and Owners can create vendor integrations.
CREATE POLICY "Manager+ can create vendor integrations"
  ON public.vendor_integrations FOR INSERT TO authenticated
  WITH CHECK (has_restaurant_role_any(restaurant_id, ARRAY['OWNER'::app_role, 'MANAGER'::app_role]));

-- Only Managers and Owners can update vendor integrations; integration must
-- remain in the same restaurant after update.
CREATE POLICY "Manager+ can update vendor integrations"
  ON public.vendor_integrations FOR UPDATE TO authenticated
  USING     (has_restaurant_role_any(restaurant_id, ARRAY['OWNER'::app_role, 'MANAGER'::app_role]))
  WITH CHECK (has_restaurant_role_any(restaurant_id, ARRAY['OWNER'::app_role, 'MANAGER'::app_role]));

-- Only Managers and Owners can delete vendor integrations.
CREATE POLICY "Manager+ can delete vendor integrations"
  ON public.vendor_integrations FOR DELETE TO authenticated
  USING (has_restaurant_role_any(restaurant_id, ARRAY['OWNER'::app_role, 'MANAGER'::app_role]));


-- -----------------------------------------------------------------------------
-- invitations
-- All members can view pending invitations for their restaurant.
-- Only Owners can create, update, or delete invitations (they control access).
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS "Members can view invitations"  ON public.invitations;
DROP POLICY IF EXISTS "Owners can insert invitations" ON public.invitations;
DROP POLICY IF EXISTS "Owners can update invitations" ON public.invitations;
DROP POLICY IF EXISTS "Owners can delete invitations" ON public.invitations;

-- Any restaurant member can view invitations for their restaurant.
CREATE POLICY "Members can view invitations"
  ON public.invitations FOR SELECT TO authenticated
  USING (is_member_of(restaurant_id));

-- Only Owners can send invitations.
CREATE POLICY "Owners can insert invitations"
  ON public.invitations FOR INSERT TO authenticated
  WITH CHECK (has_restaurant_role(restaurant_id, 'OWNER'::app_role));

-- Only Owners can update invitations (e.g. revoke, extend expiry); invitation
-- must remain tied to the same restaurant after update.
CREATE POLICY "Owners can update invitations"
  ON public.invitations FOR UPDATE TO authenticated
  USING     (has_restaurant_role(restaurant_id, 'OWNER'::app_role))
  WITH CHECK (has_restaurant_role(restaurant_id, 'OWNER'::app_role));

-- Only Owners can delete invitations.
CREATE POLICY "Owners can delete invitations"
  ON public.invitations FOR DELETE TO authenticated
  USING (has_restaurant_role(restaurant_id, 'OWNER'::app_role));


-- -----------------------------------------------------------------------------
-- waste_log
-- All members can view waste log entries.
-- Members can only insert their own entries (logged_by must match caller).
-- Only Managers and Owners can delete entries.
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS "waste_log_read"   ON public.waste_log;
DROP POLICY IF EXISTS "waste_log_insert" ON public.waste_log;
DROP POLICY IF EXISTS "waste_log_delete" ON public.waste_log;

-- Any restaurant member can view waste log entries for their restaurant.
CREATE POLICY "waste_log_read"
  ON public.waste_log FOR SELECT TO authenticated
  USING (is_member_of(restaurant_id));

-- Any restaurant member can log waste, but only for themselves (logged_by = caller).
CREATE POLICY "waste_log_insert"
  ON public.waste_log FOR INSERT TO authenticated
  WITH CHECK (is_member_of(restaurant_id) AND logged_by = auth.uid());

-- Only Managers and Owners can delete waste log entries.
CREATE POLICY "waste_log_delete"
  ON public.waste_log FOR DELETE TO authenticated
  USING (has_restaurant_role_any(restaurant_id, ARRAY['OWNER'::app_role, 'MANAGER'::app_role]));


-- =============================================================================
-- Patch: UPDATE policies on core identity/auth tables (from the initial
-- 20260212001141 → 20260212003221 migration pair) that were already TO
-- authenticated but were missing WITH CHECK clauses.
-- =============================================================================

-- restaurants: only Owners can update their restaurant's details; the record
-- must remain owned by a restaurant the caller is Owner of after update.
DROP POLICY IF EXISTS "Owners can update restaurants" ON public.restaurants;
CREATE POLICY "Owners can update restaurants"
  ON public.restaurants FOR UPDATE TO authenticated
  USING     (has_restaurant_role(id, 'OWNER'::app_role))
  WITH CHECK (has_restaurant_role(id, 'OWNER'::app_role));

-- restaurant_members: only Owners can update member roles; the membership
-- record must remain in the same restaurant after update.
DROP POLICY IF EXISTS "Owners can update members" ON public.restaurant_members;
CREATE POLICY "Owners can update members"
  ON public.restaurant_members FOR UPDATE TO authenticated
  USING     (has_restaurant_role(restaurant_id, 'OWNER'::app_role))
  WITH CHECK (has_restaurant_role(restaurant_id, 'OWNER'::app_role));

-- profiles: users can only update their own profile; the profile must remain
-- owned by the same user after update (prevents user_id reassignment).
DROP POLICY IF EXISTS "Users can update own profile" ON public.profiles;
CREATE POLICY "Users can update own profile"
  ON public.profiles FOR UPDATE TO authenticated
  USING     (auth.uid() = id)
  WITH CHECK (auth.uid() = id);


NOTIFY pgrst, 'reload schema';
