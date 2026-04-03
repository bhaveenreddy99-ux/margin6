
-- Enums for notifications
CREATE TYPE public.notification_severity AS ENUM ('INFO', 'WARNING', 'CRITICAL');
CREATE TYPE public.email_digest_mode AS ENUM ('IMMEDIATE', 'DAILY_DIGEST');

-- User UI state for restaurant/location selection persistence
CREATE TABLE public.user_ui_state (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE,
  selected_restaurant_id uuid REFERENCES public.restaurants(id) ON DELETE SET NULL,
  selected_location_id uuid REFERENCES public.locations(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.user_ui_state ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own ui state" ON public.user_ui_state
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own ui state" ON public.user_ui_state
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own ui state" ON public.user_ui_state
  FOR UPDATE USING (auth.uid() = user_id);

-- Notifications table
CREATE TABLE public.notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id uuid NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  location_id uuid REFERENCES public.locations(id) ON DELETE SET NULL,
  user_id uuid NOT NULL,
  type text NOT NULL,
  title text NOT NULL,
  message text NOT NULL,
  severity notification_severity NOT NULL DEFAULT 'INFO',
  data jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  read_at timestamptz,
  emailed_at timestamptz
);

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own notifications" ON public.notifications
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can update own notifications" ON public.notifications
  FOR UPDATE USING (auth.uid() = user_id);

-- Allow edge functions to insert via service role; members can also insert
CREATE POLICY "Members can create notifications" ON public.notifications
  FOR INSERT WITH CHECK (is_member_of(restaurant_id));

-- Notification preferences
CREATE TABLE public.notification_preferences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id uuid NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  location_id uuid REFERENCES public.locations(id) ON DELETE SET NULL,
  user_id uuid,
  channel_in_app boolean NOT NULL DEFAULT true,
  channel_email boolean NOT NULL DEFAULT true,
  email_digest_mode email_digest_mode NOT NULL DEFAULT 'IMMEDIATE',
  digest_hour integer NOT NULL DEFAULT 8,
  timezone text NOT NULL DEFAULT 'America/New_York',
  low_stock_red boolean NOT NULL DEFAULT true,
  low_stock_yellow boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.notification_preferences ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can view notification prefs" ON public.notification_preferences
  FOR SELECT USING (is_member_of(restaurant_id));

CREATE POLICY "Members can insert notification prefs" ON public.notification_preferences
  FOR INSERT WITH CHECK (is_member_of(restaurant_id));

CREATE POLICY "Members can update notification prefs" ON public.notification_preferences
  FOR UPDATE USING (is_member_of(restaurant_id));

-- Reminders
CREATE TABLE public.reminders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id uuid NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  location_id uuid REFERENCES public.locations(id) ON DELETE SET NULL,
  created_by uuid,
  name text NOT NULL,
  days_of_week jsonb NOT NULL DEFAULT '[]',
  time_of_day text NOT NULL DEFAULT '21:00',
  timezone text NOT NULL DEFAULT 'America/New_York',
  is_enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.reminders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Manager+ can view reminders" ON public.reminders
  FOR SELECT USING (is_member_of(restaurant_id));

CREATE POLICY "Manager+ can create reminders" ON public.reminders
  FOR INSERT WITH CHECK (has_restaurant_role_any(restaurant_id, ARRAY['OWNER'::app_role, 'MANAGER'::app_role]));

CREATE POLICY "Manager+ can update reminders" ON public.reminders
  FOR UPDATE USING (has_restaurant_role_any(restaurant_id, ARRAY['OWNER'::app_role, 'MANAGER'::app_role]));

CREATE POLICY "Manager+ can delete reminders" ON public.reminders
  FOR DELETE USING (has_restaurant_role_any(restaurant_id, ARRAY['OWNER'::app_role, 'MANAGER'::app_role]));

-- Reminder targets
CREATE TABLE public.reminder_targets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reminder_id uuid NOT NULL REFERENCES public.reminders(id) ON DELETE CASCADE,
  user_id uuid NOT NULL
);

ALTER TABLE public.reminder_targets ENABLE ROW LEVEL SECURITY;

-- Helper function to get restaurant_id from reminder
CREATE OR REPLACE FUNCTION public.reminder_restaurant_id(r_id uuid)
RETURNS uuid
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT restaurant_id FROM public.reminders WHERE id = r_id
$$;

CREATE POLICY "Members can view reminder targets" ON public.reminder_targets
  FOR SELECT USING (is_member_of(reminder_restaurant_id(reminder_id)));

CREATE POLICY "Manager+ can create reminder targets" ON public.reminder_targets
  FOR INSERT WITH CHECK (is_member_of(reminder_restaurant_id(reminder_id)));

CREATE POLICY "Manager+ can delete reminder targets" ON public.reminder_targets
  FOR DELETE USING (is_member_of(reminder_restaurant_id(reminder_id)));

-- Add location_id to orders if not present (other tables already have it)
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS location_id uuid REFERENCES public.locations(id) ON DELETE SET NULL;

-- Add location_id to par_guides if not present
ALTER TABLE public.par_guides ADD COLUMN IF NOT EXISTS location_id uuid REFERENCES public.locations(id) ON DELETE SET NULL;

-- Add location_id to purchase_history if not present  
ALTER TABLE public.purchase_history ADD COLUMN IF NOT EXISTS location_id uuid REFERENCES public.locations(id) ON DELETE SET NULL;

-- Grant necessary permissions
GRANT ALL ON public.user_ui_state TO authenticated;
GRANT ALL ON public.notifications TO authenticated;
GRANT ALL ON public.notification_preferences TO authenticated;
GRANT ALL ON public.reminders TO authenticated;
GRANT ALL ON public.reminder_targets TO authenticated;

NOTIFY pgrst, 'reload schema';
