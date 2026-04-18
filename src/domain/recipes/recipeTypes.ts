import type { Tables } from "@/integrations/supabase/types";

export type RecipeRow = Tables<"recipes">;
export type RecipeIngredientRow = Tables<"recipe_ingredients">;

export type CostSource = "invoice" | "catalog_default" | "missing";

/** A recipe ingredient with its resolved unit cost (from invoice or catalog fallback). */
export type ResolvedIngredient = RecipeIngredientRow & {
  unit_cost: number | null;
  line_cost: number;
  cost_source: CostSource;
};

/** A recipe with its computed cost metrics. */
export type RecipeWithCost = RecipeRow & {
  recipe_cost: number;
  food_cost_pct: number | null;
  status: FoodCostStatus;
};

export type FoodCostStatus = "good" | "warning" | "critical" | "unknown";

/** Catalog item shape needed for ingredient resolution. */
export type CatalogCostItem = Pick<
  Tables<"inventory_catalog_items">,
  "id" | "item_name" | "unit" | "default_unit_cost"
>;
