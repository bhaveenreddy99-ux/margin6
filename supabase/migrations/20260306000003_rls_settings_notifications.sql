-- =============================================================================
-- RLS FIX (2/3): Settings, notifications, and reminders tables
--
-- Converts policies from TO public (default) → TO authenticated.
-- Adds WITH CHECK to all UPDATE policies.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- restaurant_settings
-- All members can view settings.
-- Only Managers and Owners can create or update settings.
-- Only Owners can delete settings.
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS "Members can view settings"    ON public.restaurant_settings;
DROP POLICY IF EXISTS "Manager+ can insert settings" ON public.restaurant_settings;
DROP POLICY IF EXISTS "Manager+ can update settings" ON public.restaurant_settings;
DROP POLICY IF EXISTS "Owner can delete settings"    ON public.restaurant_settings;

-- Any restaurant member can view their restaurant's settings.
CREATE POLICY "Members can view settings"
  ON public.restaurant_settings FOR SELECT TO authenticated
  USING (is_member_of(restaurant_id));

-- Only Managers and Owners can create restaurant settings.
CREATE POLICY "Manager+ can insert settings"
  ON public.restaurant_settings FOR INSERT TO authenticated
  WITH CHECK (has_restaurant_role_any(restaurant_id, ARRAY['OWNER'::app_role, 'MANAGER'::app_role]));

-- Only Managers and Owners can update settings; settings must remain tied to
-- the same restaurant after update.
CREATE POLICY "Manager+ can update settings"
  ON public.restaurant_settings FOR UPDATE TO authenticated
  USING     (has_restaurant_role_any(restaurant_id, ARRAY['OWNER'::app_role, 'MANAGER'::app_role]))
  WITH CHECK (has_restaurant_role_any(restaurant_id, ARRAY['OWNER'::app_role, 'MANAGER'::app_role]));

-- Only Owners can delete restaurant settings.
CREATE POLICY "Owner can delete settings"
  ON public.restaurant_settings FOR DELETE TO authenticated
  USING (has_restaurant_role(restaurant_id, 'OWNER'::app_role));


-- -----------------------------------------------------------------------------
-- locations
-- All members can view locations.
-- Only Managers and Owners can create, update, or delete locations.
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS "Members can view locations"    ON public.locations;
DROP POLICY IF EXISTS "Manager+ can insert locations" ON public.locations;
DROP POLICY IF EXISTS "Manager+ can update locations" ON public.locations;
DROP POLICY IF EXISTS "Manager+ can delete locations" ON public.locations;

-- Any restaurant member can view their restaurant's locations.
CREATE POLICY "Members can view locations"
  ON public.locations FOR SELECT TO authenticated
  USING (is_member_of(restaurant_id));

-- Only Managers and Owners can create locations.
CREATE POLICY "Manager+ can insert locations"
  ON public.locations FOR INSERT TO authenticated
  WITH CHECK (has_restaurant_role_any(restaurant_id, ARRAY['OWNER'::app_role, 'MANAGER'::app_role]));

-- Only Managers and Owners can update locations; location must remain in the
-- same restaurant after update.
CREATE POLICY "Manager+ can update locations"
  ON public.locations FOR UPDATE TO authenticated
  USING     (has_restaurant_role_any(restaurant_id, ARRAY['OWNER'::app_role, 'MANAGER'::app_role]))
  WITH CHECK (has_restaurant_role_any(restaurant_id, ARRAY['OWNER'::app_role, 'MANAGER'::app_role]));

-- Only Managers and Owners can delete locations.
CREATE POLICY "Manager+ can delete locations"
  ON public.locations FOR DELETE TO authenticated
  USING (has_restaurant_role_any(restaurant_id, ARRAY['OWNER'::app_role, 'MANAGER'::app_role]));


-- -----------------------------------------------------------------------------
-- inventory_settings
-- All members can view inventory settings.
-- Only Managers and Owners can create or update inventory settings.
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS "Members can view inv settings"    ON public.inventory_settings;
DROP POLICY IF EXISTS "Manager+ can insert inv settings" ON public.inventory_settings;
DROP POLICY IF EXISTS "Manager+ can update inv settings" ON public.inventory_settings;

-- Any restaurant member can view inventory settings.
CREATE POLICY "Members can view inv settings"
  ON public.inventory_settings FOR SELECT TO authenticated
  USING (is_member_of(restaurant_id));

-- Only Managers and Owners can create inventory settings.
CREATE POLICY "Manager+ can insert inv settings"
  ON public.inventory_settings FOR INSERT TO authenticated
  WITH CHECK (has_restaurant_role_any(restaurant_id, ARRAY['OWNER'::app_role, 'MANAGER'::app_role]));

-- Only Managers and Owners can update inventory settings; settings must remain
-- in the same restaurant after update.
CREATE POLICY "Manager+ can update inv settings"
  ON public.inventory_settings FOR UPDATE TO authenticated
  USING     (has_restaurant_role_any(restaurant_id, ARRAY['OWNER'::app_role, 'MANAGER'::app_role]))
  WITH CHECK (has_restaurant_role_any(restaurant_id, ARRAY['OWNER'::app_role, 'MANAGER'::app_role]));


-- -----------------------------------------------------------------------------
-- par_settings
-- All members can view PAR settings.
-- Only Managers and Owners can create or update PAR settings.
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS "Members can view par settings"    ON public.par_settings;
DROP POLICY IF EXISTS "Manager+ can insert par settings" ON public.par_settings;
DROP POLICY IF EXISTS "Manager+ can update par settings" ON public.par_settings;

-- Any restaurant member can view PAR settings.
CREATE POLICY "Members can view par settings"
  ON public.par_settings FOR SELECT TO authenticated
  USING (is_member_of(restaurant_id));

-- Only Managers and Owners can create PAR settings.
CREATE POLICY "Manager+ can insert par settings"
  ON public.par_settings FOR INSERT TO authenticated
  WITH CHECK (has_restaurant_role_any(restaurant_id, ARRAY['OWNER'::app_role, 'MANAGER'::app_role]));

-- Only Managers and Owners can update PAR settings; settings must remain in
-- the same restaurant after update.
CREATE POLICY "Manager+ can update par settings"
  ON public.par_settings FOR UPDATE TO authenticated
  USING     (has_restaurant_role_any(restaurant_id, ARRAY['OWNER'::app_role, 'MANAGER'::app_role]))
  WITH CHECK (has_restaurant_role_any(restaurant_id, ARRAY['OWNER'::app_role, 'MANAGER'::app_role]));


-- -----------------------------------------------------------------------------
-- smart_order_settings
-- All members can view smart order settings.
-- Only Managers and Owners can create or update smart order settings.
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS "Members can view so settings"    ON public.smart_order_settings;
DROP POLICY IF EXISTS "Manager+ can insert so settings" ON public.smart_order_settings;
DROP POLICY IF EXISTS "Manager+ can update so settings" ON public.smart_order_settings;

-- Any restaurant member can view smart order settings.
CREATE POLICY "Members can view so settings"
  ON public.smart_order_settings FOR SELECT TO authenticated
  USING (is_member_of(restaurant_id));

-- Only Managers and Owners can create smart order settings.
CREATE POLICY "Manager+ can insert so settings"
  ON public.smart_order_settings FOR INSERT TO authenticated
  WITH CHECK (has_restaurant_role_any(restaurant_id, ARRAY['OWNER'::app_role, 'MANAGER'::app_role]));

-- Only Managers and Owners can update smart order settings; settings must remain
-- in the same restaurant after update.
CREATE POLICY "Manager+ can update so settings"
  ON public.smart_order_settings FOR UPDATE TO authenticated
  USING     (has_restaurant_role_any(restaurant_id, ARRAY['OWNER'::app_role, 'MANAGER'::app_role]))
  WITH CHECK (has_restaurant_role_any(restaurant_id, ARRAY['OWNER'::app_role, 'MANAGER'::app_role]));


-- -----------------------------------------------------------------------------
-- user_ui_state
-- Each user owns their own UI state row; only they can read or modify it.
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS "Users can view own ui state"   ON public.user_ui_state;
DROP POLICY IF EXISTS "Users can insert own ui state" ON public.user_ui_state;
DROP POLICY IF EXISTS "Users can update own ui state" ON public.user_ui_state;

-- Users can only view their own UI state.
CREATE POLICY "Users can view own ui state"
  ON public.user_ui_state FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

-- Users can only create a UI state row for themselves.
CREATE POLICY "Users can insert own ui state"
  ON public.user_ui_state FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- Users can only update their own UI state; row must remain owned by them after update.
CREATE POLICY "Users can update own ui state"
  ON public.user_ui_state FOR UPDATE TO authenticated
  USING     (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);


-- -----------------------------------------------------------------------------
-- notifications
-- Users can only read and mark their own notifications.
-- Any restaurant member can create notifications (e.g. edge functions acting
-- on behalf of the restaurant, stock alerts).
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS "Users can view own notifications"   ON public.notifications;
DROP POLICY IF EXISTS "Members can create notifications"   ON public.notifications;
DROP POLICY IF EXISTS "Users can update own notifications" ON public.notifications;

-- Users can only view notifications addressed to them.
CREATE POLICY "Users can view own notifications"
  ON public.notifications FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

-- Any restaurant member can insert notifications (e.g. to alert a colleague).
CREATE POLICY "Members can create notifications"
  ON public.notifications FOR INSERT TO authenticated
  WITH CHECK (is_member_of(restaurant_id));

-- Users can only update their own notifications (e.g. marking as read);
-- notification must remain addressed to the same user after update.
CREATE POLICY "Users can update own notifications"
  ON public.notifications FOR UPDATE TO authenticated
  USING     (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);


-- -----------------------------------------------------------------------------
-- notification_preferences
-- All restaurant members can view, create, and update notification preferences.
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS "Members can view notification prefs"   ON public.notification_preferences;
DROP POLICY IF EXISTS "Members can insert notification prefs" ON public.notification_preferences;
DROP POLICY IF EXISTS "Members can update notification prefs" ON public.notification_preferences;

-- Any restaurant member can view notification preferences for their restaurant.
CREATE POLICY "Members can view notification prefs"
  ON public.notification_preferences FOR SELECT TO authenticated
  USING (is_member_of(restaurant_id));

-- Any restaurant member can create notification preferences.
CREATE POLICY "Members can insert notification prefs"
  ON public.notification_preferences FOR INSERT TO authenticated
  WITH CHECK (is_member_of(restaurant_id));

-- Any restaurant member can update notification preferences; preferences must
-- remain in the same restaurant after update.
CREATE POLICY "Members can update notification prefs"
  ON public.notification_preferences FOR UPDATE TO authenticated
  USING     (is_member_of(restaurant_id))
  WITH CHECK (is_member_of(restaurant_id));


-- -----------------------------------------------------------------------------
-- reminders
-- All members can view reminders.
-- Only Managers and Owners can create, update, or delete reminders.
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS "Manager+ can view reminders"   ON public.reminders;
DROP POLICY IF EXISTS "Manager+ can create reminders" ON public.reminders;
DROP POLICY IF EXISTS "Manager+ can update reminders" ON public.reminders;
DROP POLICY IF EXISTS "Manager+ can delete reminders" ON public.reminders;

-- Any restaurant member can view reminders for their restaurant.
CREATE POLICY "Manager+ can view reminders"
  ON public.reminders FOR SELECT TO authenticated
  USING (is_member_of(restaurant_id));

-- Only Managers and Owners can create reminders.
CREATE POLICY "Manager+ can create reminders"
  ON public.reminders FOR INSERT TO authenticated
  WITH CHECK (has_restaurant_role_any(restaurant_id, ARRAY['OWNER'::app_role, 'MANAGER'::app_role]));

-- Only Managers and Owners can update reminders; reminder must stay in the
-- same restaurant after update.
CREATE POLICY "Manager+ can update reminders"
  ON public.reminders FOR UPDATE TO authenticated
  USING     (has_restaurant_role_any(restaurant_id, ARRAY['OWNER'::app_role, 'MANAGER'::app_role]))
  WITH CHECK (has_restaurant_role_any(restaurant_id, ARRAY['OWNER'::app_role, 'MANAGER'::app_role]));

-- Only Managers and Owners can delete reminders.
CREATE POLICY "Manager+ can delete reminders"
  ON public.reminders FOR DELETE TO authenticated
  USING (has_restaurant_role_any(restaurant_id, ARRAY['OWNER'::app_role, 'MANAGER'::app_role]));


-- -----------------------------------------------------------------------------
-- reminder_targets
-- All restaurant members can view, create, and delete reminder targets.
-- Restaurant scope is resolved via the parent reminder.
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS "Members can view reminder targets"    ON public.reminder_targets;
DROP POLICY IF EXISTS "Manager+ can create reminder targets" ON public.reminder_targets;
DROP POLICY IF EXISTS "Manager+ can delete reminder targets" ON public.reminder_targets;

-- Any member of the restaurant owning the reminder can view its targets.
CREATE POLICY "Members can view reminder targets"
  ON public.reminder_targets FOR SELECT TO authenticated
  USING (is_member_of(reminder_restaurant_id(reminder_id)));

-- Any member of the restaurant owning the reminder can add targets.
CREATE POLICY "Manager+ can create reminder targets"
  ON public.reminder_targets FOR INSERT TO authenticated
  WITH CHECK (is_member_of(reminder_restaurant_id(reminder_id)));

-- Any member of the restaurant owning the reminder can remove targets.
CREATE POLICY "Manager+ can delete reminder targets"
  ON public.reminder_targets FOR DELETE TO authenticated
  USING (is_member_of(reminder_restaurant_id(reminder_id)));


-- -----------------------------------------------------------------------------
-- alert_recipients
-- All restaurant members can view, create, and delete alert recipients.
-- Restaurant scope is resolved via the parent notification preference.
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS "Members can view alert recipients"   ON public.alert_recipients;
DROP POLICY IF EXISTS "Members can insert alert recipients" ON public.alert_recipients;
DROP POLICY IF EXISTS "Members can delete alert recipients" ON public.alert_recipients;

-- Any member of the restaurant owning the notification preference can view recipients.
CREATE POLICY "Members can view alert recipients"
  ON public.alert_recipients FOR SELECT TO authenticated
  USING (is_member_of(alert_pref_restaurant_id(notification_pref_id)));

-- Any member of the restaurant owning the notification preference can add recipients.
CREATE POLICY "Members can insert alert recipients"
  ON public.alert_recipients FOR INSERT TO authenticated
  WITH CHECK (is_member_of(alert_pref_restaurant_id(notification_pref_id)));

-- Any member of the restaurant owning the notification preference can remove recipients.
CREATE POLICY "Members can delete alert recipients"
  ON public.alert_recipients FOR DELETE TO authenticated
  USING (is_member_of(alert_pref_restaurant_id(notification_pref_id)));


NOTIFY pgrst, 'reload schema';
