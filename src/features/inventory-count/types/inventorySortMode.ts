export type InventorySortMode = "category" | "alphabetic" | "shelf_order";

export const INVENTORY_SORT_STORAGE_KEY = "margin6_inventory_sort";

export function readInventorySortMode(): InventorySortMode {
  if (typeof window === "undefined") return "category";
  const saved = localStorage.getItem(INVENTORY_SORT_STORAGE_KEY);
  if (saved === "alphabetic" || saved === "shelf_order" || saved === "category") return saved;
  return "category";
}

export function persistInventorySortMode(mode: InventorySortMode): void {
  localStorage.setItem(INVENTORY_SORT_STORAGE_KEY, mode);
}

export const INVENTORY_SORT_LABELS: Record<InventorySortMode, string> = {
  category: "By Category",
  alphabetic: "A → Z",
  shelf_order: "Shelf Order",
};
