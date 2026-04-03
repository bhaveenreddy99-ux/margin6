
-- Create recipients_mode enum
CREATE TYPE public.recipients_mode AS ENUM ('OWNERS_MANAGERS', 'ALL', 'CUSTOM');

-- Add recipients_mode to notification_preferences (for alerts)
ALTER TABLE public.notification_preferences
  ADD COLUMN recipients_mode public.recipients_mode NOT NULL DEFAULT 'OWNERS_MANAGERS';

-- Add recipients_mode to reminders
ALTER TABLE public.reminders
  ADD COLUMN recipients_mode public.recipients_mode NOT NULL DEFAULT 'OWNERS_MANAGERS';

-- Create alert_recipients table for CUSTOM mode
CREATE TABLE public.alert_recipients (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  notification_pref_id uuid NOT NULL REFERENCES public.notification_preferences(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  UNIQUE (notification_pref_id, user_id)
);

ALTER TABLE public.alert_recipients ENABLE ROW LEVEL SECURITY;

-- RLS for alert_recipients: use a helper function
CREATE OR REPLACE FUNCTION public.alert_pref_restaurant_id(pref_id uuid)
RETURNS uuid
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT restaurant_id FROM public.notification_preferences WHERE id = pref_id
$$;

CREATE POLICY "Members can view alert recipients"
  ON public.alert_recipients FOR SELECT
  USING (is_member_of(alert_pref_restaurant_id(notification_pref_id)));

CREATE POLICY "Members can insert alert recipients"
  ON public.alert_recipients FOR INSERT
  WITH CHECK (is_member_of(alert_pref_restaurant_id(notification_pref_id)));

CREATE POLICY "Members can delete alert recipients"
  ON public.alert_recipients FOR DELETE
  USING (is_member_of(alert_pref_restaurant_id(notification_pref_id)));
