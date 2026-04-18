import type { CostSource, FoodCostStatus, RecipeIngredientRow, ResolvedIngredient, RecipeRow, RecipeWithCost } from "./recipeTypes";

export const FOOD_COST_THRESHOLD = 35; // %

/**
 * Resolve a unit cost for a single ingredient using:
 *  1. latestInvoiceCosts map (catalog_item_id → confirmed unit cost)
 *  2. catalogDefaultCosts map (catalog_item_id → default_unit_cost)
 */
export function resolveUnitCost(
  catalogItemId: string | null,
  latestInvoiceCosts: Map<string, number>,
  catalogDefaultCosts: Map<string, number>,
): number | null {
  if (!catalogItemId) return null;
  if (latestInvoiceCosts.has(catalogItemId)) return latestInvoiceCosts.get(catalogItemId)!;
  if (catalogDefaultCosts.has(catalogItemId)) return catalogDefaultCosts.get(catalogItemId)!;
  return null;
}

/** Compute the line cost for a single ingredient. */
export function computeLineCost(quantity: number, unitCost: number | null): number {
  if (!unitCost || unitCost <= 0) return 0;
  return Math.round(quantity * unitCost * 10000) / 10000;
}

function resolveCostSource(
  catalogItemId: string | null,
  latestInvoiceCosts: Map<string, number>,
  catalogDefaultCosts: Map<string, number>,
): CostSource {
  if (!catalogItemId) return "missing";
  if (latestInvoiceCosts.has(catalogItemId)) return "invoice";
  if (catalogDefaultCosts.has(catalogItemId)) return "catalog_default";
  return "missing";
}

/** Attach resolved cost data to each raw ingredient row. */
export function resolveIngredients(
  ingredients: RecipeIngredientRow[],
  latestInvoiceCosts: Map<string, number>,
  catalogDefaultCosts: Map<string, number>,
): ResolvedIngredient[] {
  return ingredients.map((ing) => {
    const unit_cost = resolveUnitCost(ing.catalog_item_id, latestInvoiceCosts, catalogDefaultCosts);
    const line_cost = computeLineCost(Number(ing.quantity), unit_cost);
    const cost_source = resolveCostSource(ing.catalog_item_id, latestInvoiceCosts, catalogDefaultCosts);
    return { ...ing, unit_cost, line_cost, cost_source };
  });
}

/** Sum all ingredient line costs → total recipe cost. */
export function computeRecipeCost(resolved: ResolvedIngredient[]): number {
  return Math.round(resolved.reduce((sum, i) => sum + i.line_cost, 0) * 100) / 100;
}

/** food_cost_pct = recipe_cost / selling_price * 100. Returns null if no selling price. */
export function computeFoodCostPct(recipeCost: number, sellingPrice: number | null): number | null {
  if (!sellingPrice || sellingPrice <= 0) return null;
  return Math.round((recipeCost / sellingPrice) * 10000) / 100;
}

/** Status badge based on food cost %. */
export function foodCostStatus(pct: number | null, threshold = FOOD_COST_THRESHOLD): FoodCostStatus {
  if (pct === null) return "unknown";
  if (pct <= threshold) return "good";
  if (pct <= threshold * 1.15) return "warning";
  return "critical";
}

/** Attach cost metrics to a recipe row. */
export function enrichRecipe(
  recipe: RecipeRow,
  resolved: ResolvedIngredient[],
): RecipeWithCost {
  const recipe_cost = computeRecipeCost(resolved);
  const food_cost_pct = computeFoodCostPct(recipe_cost, recipe.selling_price ? Number(recipe.selling_price) : null);
  const status = foodCostStatus(food_cost_pct);
  return { ...recipe, recipe_cost, food_cost_pct, status };
}
