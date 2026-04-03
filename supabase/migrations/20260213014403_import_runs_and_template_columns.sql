
-- Add missing columns to import_templates for adaptive matching
ALTER TABLE public.import_templates
  ADD COLUMN IF NOT EXISTS header_fingerprint text,
  ADD COLUMN IF NOT EXISTS inventory_list_id uuid REFERENCES public.inventory_lists(id),
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS last_used_at timestamptz;

-- Create import_runs table for tracking each import execution
CREATE TABLE IF NOT EXISTS public.import_runs (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  restaurant_id uuid NOT NULL REFERENCES public.restaurants(id),
  inventory_list_id uuid REFERENCES public.inventory_lists(id),
  vendor_name text,
  file_name text NOT NULL,
  uploaded_by uuid,
  uploaded_at timestamptz NOT NULL DEFAULT now(),
  mapping_used_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  confidence_score numeric,
  created_count integer DEFAULT 0,
  updated_count integer DEFAULT 0,
  skipped_count integer DEFAULT 0,
  warnings_json jsonb DEFAULT '[]'::jsonb,
  template_id uuid REFERENCES public.import_templates(id)
);

-- Enable RLS
ALTER TABLE public.import_runs ENABLE ROW LEVEL SECURITY;

-- RLS policies for import_runs
CREATE POLICY "Members can view import runs"
  ON public.import_runs FOR SELECT
  USING (public.is_member_of(restaurant_id));

CREATE POLICY "Members can create import runs"
  ON public.import_runs FOR INSERT
  WITH CHECK (public.is_member_of(restaurant_id));
