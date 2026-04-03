
-- Categories table (per restaurant)
CREATE TABLE public.categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id uuid NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  name text NOT NULL,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (restaurant_id, name)
);

ALTER TABLE public.categories ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can view categories" ON public.categories FOR SELECT USING (is_member_of(restaurant_id));
CREATE POLICY "Members can create categories" ON public.categories FOR INSERT WITH CHECK (is_member_of(restaurant_id));
CREATE POLICY "Members can update categories" ON public.categories FOR UPDATE USING (is_member_of(restaurant_id));
CREATE POLICY "Members can delete categories" ON public.categories FOR DELETE USING (is_member_of(restaurant_id));

-- Inventory Items table (per restaurant, must belong to a category)
CREATE TABLE public.inventory_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id uuid NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  category_id uuid NOT NULL REFERENCES public.categories(id) ON DELETE CASCADE,
  item_name text NOT NULL,
  item_number text,
  pack_size text NOT NULL,
  unit_price numeric NOT NULL DEFAULT 0,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.inventory_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can view inventory items" ON public.inventory_items FOR SELECT USING (is_member_of(restaurant_id));
CREATE POLICY "Members can create inventory items" ON public.inventory_items FOR INSERT WITH CHECK (is_member_of(restaurant_id));
CREATE POLICY "Members can update inventory items" ON public.inventory_items FOR UPDATE USING (is_member_of(restaurant_id));
CREATE POLICY "Members can delete inventory items" ON public.inventory_items FOR DELETE USING (is_member_of(restaurant_id));

-- Par Items table (1:1 with inventory_items per restaurant)
CREATE TABLE public.par_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id uuid NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  inventory_item_id uuid NOT NULL REFERENCES public.inventory_items(id) ON DELETE CASCADE,
  category_id uuid NOT NULL REFERENCES public.categories(id) ON DELETE CASCADE,
  par_level numeric NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (restaurant_id, inventory_item_id)
);

ALTER TABLE public.par_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can view par items" ON public.par_items FOR SELECT USING (is_member_of(restaurant_id));
CREATE POLICY "Members can create par items" ON public.par_items FOR INSERT WITH CHECK (is_member_of(restaurant_id));
CREATE POLICY "Members can update par items" ON public.par_items FOR UPDATE USING (is_member_of(restaurant_id));
CREATE POLICY "Members can delete par items" ON public.par_items FOR DELETE USING (is_member_of(restaurant_id));

-- Helper function to sync par_items.category_id when inventory_items.category_id changes
CREATE OR REPLACE FUNCTION public.sync_par_item_category()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF OLD.category_id IS DISTINCT FROM NEW.category_id THEN
    UPDATE public.par_items SET category_id = NEW.category_id WHERE inventory_item_id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER sync_par_category_on_item_update
  AFTER UPDATE ON public.inventory_items
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_par_item_category();

-- Indexes for performance
CREATE INDEX idx_categories_restaurant ON public.categories(restaurant_id, sort_order);
CREATE INDEX idx_inventory_items_restaurant_category ON public.inventory_items(restaurant_id, category_id, sort_order);
CREATE INDEX idx_par_items_restaurant ON public.par_items(restaurant_id);

-- Grant access
GRANT ALL ON public.categories TO authenticated;
GRANT ALL ON public.inventory_items TO authenticated;
GRANT ALL ON public.par_items TO authenticated;
