import type { Dispatch, SetStateAction } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import type { RecipeRow, ResolvedIngredient } from "@/domain/recipes/recipeTypes";

type StateSetter<T> = Dispatch<SetStateAction<T>>;

type UseRecipeActionsArgs = {
  restaurantId: string | null | undefined;
  userId: string | null | undefined;
  selectedRecipeId: string | null;
  setRecipes: StateSetter<RecipeRow[]>;
  setSelectedRecipeId: StateSetter<string | null>;
  setIngredients: StateSetter<ResolvedIngredient[]>;
  refreshRecipes: () => Promise<void>;
  loadIngredients: (recipeId: string, restaurantId: string) => Promise<void>;
};

export function useRecipeActions({
  restaurantId,
  userId,
  selectedRecipeId,
  setRecipes,
  setSelectedRecipeId,
  setIngredients,
  refreshRecipes,
  loadIngredients,
}: UseRecipeActionsArgs) {

  // ── Recipe CRUD ───────────────────────────────────────────────────────────

  const handleCreateRecipe = async (
    name: string,
    category: string,
    sellingPrice: string,
  ) => {
    if (!restaurantId || !name.trim()) return;

    const { data, error } = await supabase
      .from("recipes")
      .insert({
        restaurant_id: restaurantId,
        name: name.trim(),
        category: category.trim() || null,
        selling_price: sellingPrice ? Number(sellingPrice) : null,
        created_by: userId ?? null,
      })
      .select()
      .single();

    if (error || !data) {
      toast.error(`Could not create recipe: ${error?.message ?? "Unknown error"}`);
      return;
    }

    toast.success("Recipe created");
    await refreshRecipes();
    setSelectedRecipeId(data.id);
  };

  const handleUpdateRecipe = async (
    recipeId: string,
    fields: { name?: string; category?: string; selling_price?: number | null; notes?: string | null },
  ) => {
    const { error } = await supabase
      .from("recipes")
      .update({ ...fields, updated_at: new Date().toISOString() })
      .eq("id", recipeId);

    if (error) {
      toast.error(`Could not update recipe: ${error.message}`);
      return;
    }
    // Optimistic update in list
    setRecipes((prev) =>
      prev.map((r) => (r.id === recipeId ? { ...r, ...fields } : r)),
    );
  };

  const handleDeleteRecipe = async (recipeId: string) => {
    const { error } = await supabase.from("recipes").delete().eq("id", recipeId);
    if (error) {
      toast.error(`Could not delete recipe: ${error.message}`);
      return;
    }
    toast.success("Recipe deleted");
    setRecipes((prev) => prev.filter((r) => r.id !== recipeId));
    if (selectedRecipeId === recipeId) {
      setSelectedRecipeId(null);
      setIngredients([]);
    }
  };

  // ── Ingredient CRUD ───────────────────────────────────────────────────────

  const handleAddIngredient = async (
    catalogItemId: string,
    itemName: string,
    quantity: number,
    unit: string | null,
  ) => {
    if (!selectedRecipeId || !restaurantId) return;

    const { error } = await supabase.from("recipe_ingredients").insert({
      recipe_id: selectedRecipeId,
      catalog_item_id: catalogItemId,
      item_name: itemName,
      quantity: Math.max(0.0001, quantity),
      unit: unit ?? null,
    });

    if (error) {
      toast.error(`Could not add ingredient: ${error.message}`);
      return;
    }

    await loadIngredients(selectedRecipeId, restaurantId);
  };

  const handleUpdateIngredient = async (
    ingredientId: string,
    quantity: number,
    unit: string | null,
  ) => {
    if (!selectedRecipeId || !restaurantId) return;

    const { error } = await supabase
      .from("recipe_ingredients")
      .update({ quantity: Math.max(0.0001, quantity), unit: unit ?? null })
      .eq("id", ingredientId);

    if (error) {
      toast.error(`Could not update ingredient: ${error.message}`);
      return;
    }

    await loadIngredients(selectedRecipeId, restaurantId);
  };

  const handleRemoveIngredient = async (ingredientId: string) => {
    if (!selectedRecipeId || !restaurantId) return;

    const { error } = await supabase
      .from("recipe_ingredients")
      .delete()
      .eq("id", ingredientId);

    if (error) {
      toast.error(`Could not remove ingredient: ${error.message}`);
      return;
    }

    setIngredients((prev) => prev.filter((i) => i.id !== ingredientId));
  };

  return {
    handleCreateRecipe,
    handleUpdateRecipe,
    handleDeleteRecipe,
    handleAddIngredient,
    handleUpdateIngredient,
    handleRemoveIngredient,
  };
}
