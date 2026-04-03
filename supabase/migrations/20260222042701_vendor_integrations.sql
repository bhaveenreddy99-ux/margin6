
-- Create vendor_integrations table for storing vendor API connections
CREATE TABLE public.vendor_integrations (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  restaurant_id uuid NOT NULL REFERENCES public.restaurants(id),
  location_id uuid REFERENCES public.locations(id),
  vendor_name text NOT NULL,
  api_key_encrypted text,
  account_id text,
  customer_number text,
  is_enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.vendor_integrations ENABLE ROW LEVEL SECURITY;

-- RLS policies
CREATE POLICY "Members can view vendor integrations"
ON public.vendor_integrations FOR SELECT
USING (is_member_of(restaurant_id));

CREATE POLICY "Manager+ can create vendor integrations"
ON public.vendor_integrations FOR INSERT
WITH CHECK (has_restaurant_role_any(restaurant_id, ARRAY['OWNER'::app_role, 'MANAGER'::app_role]));

CREATE POLICY "Manager+ can update vendor integrations"
ON public.vendor_integrations FOR UPDATE
USING (has_restaurant_role_any(restaurant_id, ARRAY['OWNER'::app_role, 'MANAGER'::app_role]));

CREATE POLICY "Manager+ can delete vendor integrations"
ON public.vendor_integrations FOR DELETE
USING (has_restaurant_role_any(restaurant_id, ARRAY['OWNER'::app_role, 'MANAGER'::app_role]));
