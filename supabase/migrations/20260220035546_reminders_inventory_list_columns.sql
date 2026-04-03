ALTER TABLE public.reminders
  ADD COLUMN IF NOT EXISTS inventory_list_id uuid REFERENCES public.inventory_lists(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS auto_create_session boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS reminder_lead_minutes integer NOT NULL DEFAULT 60,
  ADD COLUMN IF NOT EXISTS lock_after_hours integer;
