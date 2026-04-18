-- Recipe Costing MVP
-- recipes: one row per menu item / dish
-- recipe_ingredients: ingredients linking back to inventory_catalog_items

CREATE TABLE public.recipes (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id   uuid NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  name            text NOT NULL,
  category        text,
  selling_price   numeric(10,2),
  notes           text,
  created_by      uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.recipe_ingredients (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recipe_id       uuid NOT NULL REFERENCES public.recipes(id) ON DELETE CASCADE,
  catalog_item_id uuid REFERENCES public.inventory_catalog_items(id) ON DELETE SET NULL,
  item_name       text NOT NULL,
  quantity        numeric(10,4) NOT NULL DEFAULT 1,
  unit            text,
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- Indexes
CREATE INDEX idx_recipes_restaurant_id          ON public.recipes (restaurant_id);
CREATE INDEX idx_recipe_ingredients_recipe_id   ON public.recipe_ingredients (recipe_id);
CREATE INDEX idx_recipe_ingredients_catalog_id  ON public.recipe_ingredients (catalog_item_id)
  WHERE catalog_item_id IS NOT NULL;

-- RLS
ALTER TABLE public.recipes           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.recipe_ingredients ENABLE ROW LEVEL SECURITY;

CREATE POLICY "restaurant members manage recipes"
  ON public.recipes FOR ALL
  USING (
    restaurant_id IN (
      SELECT restaurant_id FROM public.restaurant_members WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "restaurant members manage recipe ingredients"
  ON public.recipe_ingredients FOR ALL
  USING (
    recipe_id IN (
      SELECT id FROM public.recipes
      WHERE restaurant_id IN (
        SELECT restaurant_id FROM public.restaurant_members WHERE user_id = auth.uid()
      )
    )
  );

-- Grant to authenticated
GRANT ALL ON public.recipes            TO authenticated;
GRANT ALL ON public.recipe_ingredients TO authenticated;

-- Realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.recipes;
ALTER PUBLICATION supabase_realtime ADD TABLE public.recipe_ingredients;
