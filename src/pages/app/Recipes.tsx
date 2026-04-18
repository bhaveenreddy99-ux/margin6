import { useMemo, useState } from "react";
import { ChefHat, Plus, Trash2, AlertTriangle, Pencil, Check, X } from "lucide-react";
import { useRestaurant } from "@/contexts/RestaurantContext";
import { useAuth } from "@/contexts/AuthContext";
import { useRecipeData } from "@/hooks/useRecipeData";
import { useRecipeActions } from "@/hooks/useRecipeActions";
import {
  computeRecipeCost,
  computeFoodCostPct,
  foodCostStatus,
  FOOD_COST_THRESHOLD,
} from "@/domain/recipes/recipeCostEngine";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";

// ── Helpers ──────────────────────────────────────────────────────────────────

function formatCurrency(n: number) {
  return `$${n.toFixed(2)}`;
}

function statusBadge(status: string, pct: number | null) {
  const label = pct != null ? `${pct.toFixed(1)}%` : "—";
  if (status === "good")
    return <Badge className="bg-green-100 text-green-800 border-0">{label}</Badge>;
  if (status === "warning")
    return <Badge className="bg-amber-100 text-amber-800 border-0">{label}</Badge>;
  if (status === "critical")
    return <Badge className="bg-red-100 text-red-800 border-0">{label}</Badge>;
  return <Badge variant="secondary">{label}</Badge>;
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function RecipesPage() {
  const { currentRestaurant } = useRestaurant();
  const { user } = useAuth();

  const restaurantId = currentRestaurant?.id;
  const userId = user?.id;

  const {
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
  } = useRecipeData({ restaurantId });

  const {
    handleCreateRecipe,
    handleUpdateRecipe,
    handleDeleteRecipe,
    handleAddIngredient,
    handleUpdateIngredient,
    handleRemoveIngredient,
  } = useRecipeActions({
    restaurantId,
    userId,
    selectedRecipeId,
    setRecipes,
    setSelectedRecipeId,
    setIngredients,
    refreshRecipes,
    loadIngredients,
  });

  const selectedRecipe = useMemo(
    () => recipes.find((r) => r.id === selectedRecipeId) ?? null,
    [recipes, selectedRecipeId],
  );

  // ── Computed cost metrics for selected recipe ─────────────────────────────
  const recipeCost = useMemo(() => computeRecipeCost(ingredients), [ingredients]);
  const foodCostPct = useMemo(
    () =>
      computeFoodCostPct(
        recipeCost,
        selectedRecipe?.selling_price ? Number(selectedRecipe.selling_price) : null,
      ),
    [recipeCost, selectedRecipe?.selling_price],
  );
  const costStatus = useMemo(() => foodCostStatus(foodCostPct), [foodCostPct]);

  // ── New recipe dialog ─────────────────────────────────────────────────────
  const [newOpen, setNewOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [newCategory, setNewCategory] = useState("");
  const [newSellingPrice, setNewSellingPrice] = useState("");

  const onCreateSubmit = async () => {
    await handleCreateRecipe(newName, newCategory, newSellingPrice);
    setNewOpen(false);
    setNewName("");
    setNewCategory("");
    setNewSellingPrice("");
  };

  // ── Delete recipe dialog ──────────────────────────────────────────────────
  const [deleteRecipeId, setDeleteRecipeId] = useState<string | null>(null);

  // ── Inline selling price edit ─────────────────────────────────────────────
  const [editingPrice, setEditingPrice] = useState(false);
  const [priceInput, setPriceInput] = useState("");

  const startEditPrice = () => {
    setPriceInput(selectedRecipe?.selling_price?.toString() ?? "");
    setEditingPrice(true);
  };

  const commitPrice = async () => {
    if (!selectedRecipeId) return;
    const parsed = parseFloat(priceInput);
    const selling_price = Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
    await handleUpdateRecipe(selectedRecipeId, { selling_price });
    setEditingPrice(false);
  };

  // ── Add ingredient dialog ─────────────────────────────────────────────────
  const [addIngOpen, setAddIngOpen] = useState(false);
  const [ingCatalogId, setIngCatalogId] = useState("");
  const [ingQty, setIngQty] = useState("1");
  const [ingSearch, setIngSearch] = useState("");

  const filteredCatalog = useMemo(() => {
    if (!ingSearch.trim()) return catalogItems;
    const q = ingSearch.toLowerCase();
    return catalogItems.filter((c) => c.item_name.toLowerCase().includes(q));
  }, [catalogItems, ingSearch]);

  const onAddIngredient = async () => {
    const item = catalogItems.find((c) => c.id === ingCatalogId);
    if (!item) return;
    const qty = Math.max(0.0001, parseFloat(ingQty) || 1);
    await handleAddIngredient(item.id, item.item_name, qty, item.unit ?? null);
    setAddIngOpen(false);
    setIngCatalogId("");
    setIngQty("1");
    setIngSearch("");
  };

  // ── Inline ingredient quantity edit ──────────────────────────────────────
  const [editingIngId, setEditingIngId] = useState<string | null>(null);
  const [editingIngQty, setEditingIngQty] = useState("");

  const commitIngQty = async (ingId: string, unit: string | null) => {
    const qty = Math.max(0.0001, parseFloat(editingIngQty) || 0.0001);
    await handleUpdateIngredient(ingId, qty, unit);
    setEditingIngId(null);
  };

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="flex h-full overflow-hidden">
      {/* Left panel — recipe list */}
      <div className="w-72 shrink-0 border-r border-border bg-muted/30 flex flex-col">
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <div className="flex items-center gap-2">
            <ChefHat className="h-4 w-4 text-muted-foreground" />
            <span className="font-semibold text-sm">Recipes</span>
          </div>
          <Button size="sm" variant="ghost" className="gap-1 h-7 text-xs" onClick={() => setNewOpen(true)}>
            <Plus className="h-3.5 w-3.5" /> New
          </Button>
        </div>

        <div className="flex-1 overflow-y-auto p-2 space-y-1">
          {loading ? (
            Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-14 w-full rounded-lg" />
            ))
          ) : recipes.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-40 text-center px-4">
              <ChefHat className="h-8 w-8 text-muted-foreground/40 mb-2" />
              <p className="text-sm text-muted-foreground">No recipes yet</p>
              <p className="text-xs text-muted-foreground/60 mt-1">
                Create your first recipe to start tracking food cost
              </p>
            </div>
          ) : (
            recipes.map((recipe) => {
              const isSelected = recipe.id === selectedRecipeId;
              return (
                <button
                  key={recipe.id}
                  onClick={() => setSelectedRecipeId(recipe.id)}
                  className={`w-full text-left rounded-lg px-3 py-2.5 transition-colors ${
                    isSelected
                      ? "bg-primary/10 border border-primary/20"
                      : "hover:bg-muted border border-transparent"
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium truncate">{recipe.name}</p>
                      {recipe.category && (
                        <p className="text-xs text-muted-foreground truncate">{recipe.category}</p>
                      )}
                    </div>
                  </div>
                  {recipe.selling_price != null && (
                    <p className="text-xs text-muted-foreground mt-1">
                      Sell: {formatCurrency(Number(recipe.selling_price))}
                    </p>
                  )}
                </button>
              );
            })
          )}
        </div>
      </div>

      {/* Right panel — recipe detail */}
      <div className="flex-1 overflow-y-auto">
        {!selectedRecipe ? (
          <div className="flex flex-col items-center justify-center h-full text-center px-8">
            <ChefHat className="h-12 w-12 text-muted-foreground/30 mb-3" />
            <p className="text-muted-foreground">Select a recipe to view details</p>
          </div>
        ) : (
          <div className="p-6 max-w-4xl mx-auto space-y-6">
            {/* Header */}
            <div className="flex items-start justify-between gap-4">
              <div>
                <h1 className="text-2xl font-bold">{selectedRecipe.name}</h1>
                {selectedRecipe.category && (
                  <p className="text-sm text-muted-foreground mt-0.5">{selectedRecipe.category}</p>
                )}
              </div>
              <Button
                variant="ghost"
                size="sm"
                className="text-destructive hover:text-destructive gap-1.5"
                onClick={() => setDeleteRecipeId(selectedRecipe.id)}
              >
                <Trash2 className="h-4 w-4" /> Delete
              </Button>
            </div>

            {/* Selling price + cost summary cards */}
            <div className="grid grid-cols-3 gap-4">
              {/* Selling price */}
              <Card>
                <CardHeader className="pb-1 pt-4 px-4">
                  <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                    Selling Price
                  </CardTitle>
                </CardHeader>
                <CardContent className="px-4 pb-4">
                  {editingPrice ? (
                    <div className="flex items-center gap-1">
                      <span className="text-sm text-muted-foreground">$</span>
                      <Input
                        autoFocus
                        type="number"
                        min={0}
                        step={0.01}
                        className="h-7 text-lg font-bold w-24 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                        value={priceInput}
                        onChange={(e) => setPriceInput(e.target.value)}
                        onBlur={commitPrice}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") commitPrice();
                          if (e.key === "Escape") setEditingPrice(false);
                        }}
                      />
                    </div>
                  ) : (
                    <button
                      onClick={startEditPrice}
                      className="flex items-center gap-1.5 group"
                    >
                      <span className="text-2xl font-bold">
                        {selectedRecipe.selling_price != null
                          ? formatCurrency(Number(selectedRecipe.selling_price))
                          : "—"}
                      </span>
                      <Pencil className="h-3.5 w-3.5 opacity-0 group-hover:opacity-50 transition-opacity" />
                    </button>
                  )}
                </CardContent>
              </Card>

              {/* Recipe cost */}
              <Card>
                <CardHeader className="pb-1 pt-4 px-4">
                  <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                    Recipe Cost
                  </CardTitle>
                </CardHeader>
                <CardContent className="px-4 pb-4">
                  {ingredientsLoading ? (
                    <Skeleton className="h-8 w-20" />
                  ) : (
                    <span className="text-2xl font-bold">{formatCurrency(recipeCost)}</span>
                  )}
                </CardContent>
              </Card>

              {/* Food cost % */}
              <Card>
                <CardHeader className="pb-1 pt-4 px-4">
                  <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                    Food Cost %
                  </CardTitle>
                </CardHeader>
                <CardContent className="px-4 pb-4">
                  {ingredientsLoading ? (
                    <Skeleton className="h-8 w-20" />
                  ) : (
                    <div className="flex items-center gap-2">
                      <span className="text-2xl font-bold">
                        {foodCostPct != null ? `${foodCostPct.toFixed(1)}%` : "—"}
                      </span>
                      {statusBadge(costStatus, foodCostPct)}
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>

            {/* Warning banner */}
            {costStatus === "warning" || costStatus === "critical" ? (
              <div className="flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-amber-800">
                <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
                <p className="text-sm">
                  {costStatus === "critical"
                    ? `Food cost is ${foodCostPct?.toFixed(1)}% — well above the ${FOOD_COST_THRESHOLD}% target. Consider repricing this dish or substituting a cheaper ingredient.`
                    : `Food cost is ${foodCostPct?.toFixed(1)}% — approaching the ${FOOD_COST_THRESHOLD}% target. Keep an eye on supplier prices.`}
                </p>
              </div>
            ) : null}

            {/* Pack-size / invoice cost warning */}
            {ingredients.length > 0 && !ingredientsLoading && ingredients.some((i) => i.cost_source === "invoice") && (
              <div className="flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-amber-800">
                <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
                <p className="text-sm">
                  Invoice costs may reflect case or pack pricing — verify units before relying on food cost %.
                </p>
              </div>
            )}

            {/* Ingredients table */}
            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base">Ingredients</CardTitle>
                  <Button
                    size="sm"
                    variant="outline"
                    className="gap-1.5 h-8"
                    onClick={() => setAddIngOpen(true)}
                  >
                    <Plus className="h-3.5 w-3.5" /> Add Ingredient
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="p-0">
                {ingredientsLoading ? (
                  <div className="p-4 space-y-2">
                    {Array.from({ length: 3 }).map((_, i) => (
                      <Skeleton key={i} className="h-10 w-full" />
                    ))}
                  </div>
                ) : ingredients.length === 0 ? (
                  <div className="py-10 text-center text-sm text-muted-foreground">
                    No ingredients yet — add your first ingredient above
                  </div>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Ingredient</TableHead>
                        <TableHead className="w-28 text-right">Qty</TableHead>
                        <TableHead className="w-20">Unit</TableHead>
                        <TableHead className="w-28 text-right">Unit Cost</TableHead>
                        <TableHead className="w-28 text-right">Line Cost</TableHead>
                        <TableHead className="w-10" />
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {ingredients.map((ing) => (
                        <TableRow key={ing.id}>
                          <TableCell className="font-medium">{ing.item_name}</TableCell>

                          {/* Quantity — inline editable */}
                          <TableCell className="text-right">
                            {editingIngId === ing.id ? (
                              <Input
                                autoFocus
                                type="number"
                                min={0}
                                step={0.01}
                                className="h-7 w-20 text-right text-sm [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none ml-auto"
                                value={editingIngQty}
                                onChange={(e) => setEditingIngQty(e.target.value)}
                                onBlur={() => commitIngQty(ing.id, ing.unit)}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter") commitIngQty(ing.id, ing.unit);
                                  if (e.key === "Escape") setEditingIngId(null);
                                }}
                              />
                            ) : (
                              <button
                                className="tabular-nums hover:underline decoration-dotted"
                                onClick={() => {
                                  setEditingIngId(ing.id);
                                  setEditingIngQty(String(ing.quantity));
                                }}
                              >
                                {Number(ing.quantity).toLocaleString(undefined, { maximumFractionDigits: 4 })}
                              </button>
                            )}
                          </TableCell>

                          <TableCell className="text-muted-foreground text-sm">{ing.unit ?? "—"}</TableCell>

                          <TableCell className="text-right tabular-nums text-sm">
                            {ing.unit_cost != null ? (
                              <div className="flex flex-col items-end gap-0.5">
                                <span>{formatCurrency(ing.unit_cost)}</span>
                                <span className="text-[10px] text-muted-foreground">
                                  {ing.cost_source === "invoice" ? "invoice" : "default"}
                                </span>
                              </div>
                            ) : (
                              <span className="text-muted-foreground text-xs">No cost</span>
                            )}
                          </TableCell>

                          <TableCell className="text-right tabular-nums font-medium">
                            {formatCurrency(ing.line_cost)}
                          </TableCell>

                          <TableCell>
                            <button
                              className="text-muted-foreground hover:text-destructive transition-colors"
                              onClick={() => handleRemoveIngredient(ing.id)}
                            >
                              <X className="h-4 w-4" />
                            </button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}

                {/* Footer total */}
                {ingredients.length > 0 && !ingredientsLoading && (
                  <div className="flex items-center justify-end gap-6 px-4 py-3 border-t border-border bg-muted/30">
                    <span className="text-sm text-muted-foreground">Total Recipe Cost</span>
                    <span className="text-lg font-bold tabular-nums">{formatCurrency(recipeCost)}</span>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        )}
      </div>

      {/* ── New Recipe Dialog ───────────────────────────────────────────────── */}
      <Dialog open={newOpen} onOpenChange={setNewOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>New Recipe</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="recipe-name">Recipe Name *</Label>
              <Input
                id="recipe-name"
                placeholder="e.g. Classic Burger"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && newName.trim()) onCreateSubmit(); }}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="recipe-category">Category</Label>
              <Input
                id="recipe-category"
                placeholder="e.g. Mains, Appetizers"
                value={newCategory}
                onChange={(e) => setNewCategory(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="recipe-price">Selling Price ($)</Label>
              <Input
                id="recipe-price"
                type="number"
                min={0}
                step={0.01}
                placeholder="0.00"
                value={newSellingPrice}
                onChange={(e) => setNewSellingPrice(e.target.value)}
                className="[appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
              />
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => setNewOpen(false)}>Cancel</Button>
            <Button onClick={onCreateSubmit} disabled={!newName.trim()}>Create Recipe</Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Add Ingredient Dialog ───────────────────────────────────────────── */}
      <Dialog open={addIngOpen} onOpenChange={setAddIngOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Add Ingredient</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label>Search Catalog Item</Label>
              <Input
                placeholder="Search by name..."
                value={ingSearch}
                onChange={(e) => setIngSearch(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Item *</Label>
              <Select value={ingCatalogId} onValueChange={setIngCatalogId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select item from catalog" />
                </SelectTrigger>
                <SelectContent>
                  {filteredCatalog.length === 0 ? (
                    <div className="py-3 text-center text-sm text-muted-foreground">No items found</div>
                  ) : (
                    filteredCatalog.slice(0, 100).map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.item_name}
                        {c.unit ? ` (${c.unit})` : ""}
                      </SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ing-qty">Quantity</Label>
              <Input
                id="ing-qty"
                type="number"
                min={0}
                step={0.01}
                value={ingQty}
                onChange={(e) => setIngQty(e.target.value)}
                className="[appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
              />
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => setAddIngOpen(false)}>Cancel</Button>
            <Button onClick={onAddIngredient} disabled={!ingCatalogId}>
              Add Ingredient
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Delete Recipe Confirmation ──────────────────────────────────────── */}
      <AlertDialog open={!!deleteRecipeId} onOpenChange={(open) => { if (!open) setDeleteRecipeId(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Recipe?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete the recipe and all its ingredients. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                if (deleteRecipeId) handleDeleteRecipe(deleteRecipeId);
                setDeleteRecipeId(null);
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
