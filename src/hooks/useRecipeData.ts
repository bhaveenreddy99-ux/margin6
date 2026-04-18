import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { resolveIngredients } from "@/domain/recipes/recipeCostEngine";
import type { CatalogCostItem, RecipeIngredientRow, RecipeRow, ResolvedIngredient } from "@/domain/recipes/recipeTypes";

type UseRecipeDataArgs = {
  restaurantId: string | null | undefined;
};

export function useRecipeData({ restaurantId }: UseRecipeDataArgs) {
  const [recipes, setRecipes] = useState<RecipeRow[]>([]);
  const [selectedRecipeId, setSelectedRecipeId] = useState<string | null>(null);
  const [ingredients, setIngredients] = useState<ResolvedIngredient[]>([]);
  const [catalogItems, setCatalogItems] = useState<CatalogCostItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [ingredientsLoading, setIngredientsLoading] = useState(false);

  // ── Catalog items (needed for ingredient picker + cost fallback) ──────────
  const loadCatalogItems = useCallback(async (restId: string) => {
    const { data, error } = await supabase
      .from("inventory_catalog_items")
      .select("id, item_name, unit, default_unit_cost")
      .eq("restaurant_id", restId)
      .order("item_name", { ascending: true });

    if (error) {
      toast.error(`Could not load catalog items: ${error.message}`);
      return;
    }
    setCatalogItems((data ?? []) as CatalogCostItem[]);
  }, []);

  // ── Recipe list ───────────────────────────────────────────────────────────
  const refreshRecipes = useCallback(async () => {
    if (!restaurantId) return;
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("recipes")
        .select("*")
        .eq("restaurant_id", restaurantId)
        .order("name", { ascending: true });

      if (error) {
        toast.error(`Could not load recipes: ${error.message}`);
        return;
      }
      setRecipes((data ?? []) as RecipeRow[]);
    } finally {
      setLoading(false);
    }
  }, [restaurantId]);

  // ── Build cost lookup maps ────────────────────────────────────────────────
  const buildCostMaps = useCallback(async (restId: string) => {
    // Step 1: fetch confirmed invoice IDs ordered by confirmed_at desc (most recent first)
    const { data: invoiceData, error: invoiceError } = await supabase
      .from("invoices")
      .select("id")
      .eq("restaurant_id", restId)
      .eq("status", "confirmed")
      .not("confirmed_at", "is", null)
      .order("confirmed_at", { ascending: false })
      .limit(150);

    if (invoiceError || !invoiceData?.length) return new Map<string, number>();

    const invoiceIds = (invoiceData as Array<{ id: string }>).map((r) => r.id);
    const invoiceOrder = new Map<string, number>(invoiceIds.map((id, i) => [id, i]));

    // Step 2: fetch invoice_items for those invoices
    const { data: itemData } = await supabase
      .from("invoice_items")
      .select("invoice_id, catalog_item_id, unit_cost")
      .in("invoice_id", invoiceIds)
      .not("catalog_item_id", "is", null);

    // Sort by invoice recency so dedup picks the most-recent price per catalog_item_id
    const sorted = ((itemData ?? []) as Array<{
      invoice_id: string;
      catalog_item_id: string | null;
      unit_cost: number | null;
    }>)
      .slice()
      .sort((a, b) => (invoiceOrder.get(a.invoice_id) ?? 999) - (invoiceOrder.get(b.invoice_id) ?? 999));

    const invoiceMap = new Map<string, number>();
    for (const row of sorted) {
      if (row.catalog_item_id && row.unit_cost != null && !invoiceMap.has(row.catalog_item_id)) {
        invoiceMap.set(row.catalog_item_id, Number(row.unit_cost));
      }
    }
    return invoiceMap;
  }, []);

  // ── Load ingredients for selected recipe ──────────────────────────────────
  const loadIngredients = useCallback(async (recipeId: string, restId: string) => {
    setIngredientsLoading(true);
    try {
      const { data, error } = await supabase
        .from("recipe_ingredients")
        .select("*")
        .eq("recipe_id", recipeId)
        .order("created_at", { ascending: true });

      if (error) {
        toast.error(`Could not load ingredients: ${error.message}`);
        setIngredients([]);
        return;
      }

      const raw = (data ?? []) as RecipeIngredientRow[];

      // Build cost maps fresh each time so price changes are reflected
      const invoiceMap = await buildCostMaps(restId);
      const catalogDefaultMap = new Map<string, number>(
        (await supabase
          .from("inventory_catalog_items")
          .select("id, default_unit_cost")
          .eq("restaurant_id", restId)
          .then(({ data: cd }) => (cd ?? []).map((c: { id: string; default_unit_cost: number | null }) => [c.id, Number(c.default_unit_cost ?? 0)])))
      );

      setIngredients(resolveIngredients(raw, invoiceMap, catalogDefaultMap));
    } finally {
      setIngredientsLoading(false);
    }
  }, [buildCostMaps]);

  // ── Effects ───────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!restaurantId) return;
    let cancelled = false;
    setLoading(true);
    Promise.all([refreshRecipes(), loadCatalogItems(restaurantId)]).finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => { cancelled = true; };
  }, [restaurantId, refreshRecipes, loadCatalogItems]);

  useEffect(() => {
    if (!selectedRecipeId || !restaurantId) {
      setIngredients([]);
      return;
    }
    let cancelled = false;
    loadIngredients(selectedRecipeId, restaurantId).then(() => {
      if (cancelled) setIngredients([]);
    });
    return () => { cancelled = true; };
  }, [selectedRecipeId, restaurantId, loadIngredients]);

  return {
    recipes,
    setRecipes,
    selectedRecipeId,
    setSelectedRecipeId,
    ingredients,
    setIngredients,
    catalogItems,
    loading,
    ingredientsLoading,
    refreshRecipes,
    loadIngredients,
  };
}
