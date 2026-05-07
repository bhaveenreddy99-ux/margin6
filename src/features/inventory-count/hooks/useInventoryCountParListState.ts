import { useEffect, useState } from "react";
import type { ParGuideItemRow, ParGuideRow } from "@/domain/inventory/enterInventoryTypes";
import type { UseInventoryCountDataArgs } from "@/features/inventory-count/types";
import { fetchParGuideItems, fetchParGuidesForSelectedList } from "@/features/inventory-count/queries/inventoryCountQueries";

type Args = Pick<
  UseInventoryCountDataArgs,
  "currentRestaurantId" | "currentLocationId" | "selectedList" | "selectedPar" | "setSelectedPar"
>;

/**
 * PAR guide list + line items for the hub PAR selector, driven by selected list / PAR.
 * Kept separate from {@link useInventoryCountData} so session/catalog loading stays in one place.
 */
export function useInventoryCountParListState({
  currentRestaurantId,
  currentLocationId,
  selectedList,
  selectedPar,
  setSelectedPar,
}: Args) {
  const [parGuides, setParGuides] = useState<ParGuideRow[]>([]);
  const [parItems, setParItems] = useState<ParGuideItemRow[]>([]);

  useEffect(() => {
    if (!currentRestaurantId || !selectedList) {
      setParGuides([]);
      setSelectedPar("");
      return;
    }
    let cancelled = false;
    fetchParGuidesForSelectedList(currentRestaurantId, selectedList, currentLocationId).then(({ data }) => {
      if (cancelled) return;
      const nextGuides = (data ?? []) as ParGuideRow[];
      setParGuides(nextGuides);
      setSelectedPar(nextGuides[0]?.id || "");
    });
    return () => {
      cancelled = true;
    };
  }, [currentRestaurantId, currentLocationId, selectedList, setSelectedPar]);

  useEffect(() => {
    if (!selectedPar || selectedPar === "none") {
      setParItems([]);
      return;
    }

    fetchParGuideItems(selectedPar).then(({ data }) => {
      setParItems((data ?? []) as ParGuideItemRow[]);
    });
  }, [selectedPar]);

  return { parGuides, parItems };
}
