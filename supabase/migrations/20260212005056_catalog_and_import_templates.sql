
-- Import templates table
CREATE TABLE public.import_templates (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  restaurant_id uuid NOT NULL REFERENCES public.restaurants(id),
  name text NOT NULL,
  vendor_name text,
  file_type text DEFAULT 'csv',
  mapping_json jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.import_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can view import templates"
  ON public.import_templates FOR SELECT
  USING (is_member_of(restaurant_id));

CREATE POLICY "Members can create import templates"
  ON public.import_templates FOR INSERT
  WITH CHECK (is_member_of(restaurant_id));

CREATE POLICY "Members can update import templates"
  ON public.import_templates FOR UPDATE
  USING (is_member_of(restaurant_id));

CREATE POLICY "Members can delete import templates"
  ON public.import_templates FOR DELETE
  USING (is_member_of(restaurant_id));

-- Inventory catalog items table
CREATE TABLE public.inventory_catalog_items (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  restaurant_id uuid NOT NULL REFERENCES public.restaurants(id),
  inventory_list_id uuid REFERENCES public.inventory_lists(id),
  item_name text NOT NULL,
  vendor_sku text,
  category text,
  unit text,
  pack_size text,
  default_par_level numeric,
  default_unit_cost numeric,
  vendor_name text,
  metadata jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.inventory_catalog_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can view catalog items"
  ON public.inventory_catalog_items FOR SELECT
  USING (is_member_of(restaurant_id));

CREATE POLICY "Members can create catalog items"
  ON public.inventory_catalog_items FOR INSERT
  WITH CHECK (is_member_of(restaurant_id));

CREATE POLICY "Members can update catalog items"
  ON public.inventory_catalog_items FOR UPDATE
  USING (is_member_of(restaurant_id));

CREATE POLICY "Members can delete catalog items"
  ON public.inventory_catalog_items FOR DELETE
  USING (is_member_of(restaurant_id));

-- Add vendor_sku to inventory_session_items
ALTER TABLE public.inventory_session_items ADD COLUMN IF NOT EXISTS vendor_sku text;
ALTER TABLE public.inventory_session_items ADD COLUMN IF NOT EXISTS pack_size text;
ALTER TABLE public.inventory_session_items ADD COLUMN IF NOT EXISTS vendor_name text;
ALTER TABLE public.inventory_session_items ADD COLUMN IF NOT EXISTS metadata jsonb;
