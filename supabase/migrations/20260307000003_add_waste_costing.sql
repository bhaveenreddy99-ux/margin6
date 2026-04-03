-- Add catalog-linked waste costing so waste entries preserve a cost snapshot
-- instead of remaining quantity-only logs.

ALTER TABLE public.waste_log
  ADD COLUMN IF NOT EXISTS catalog_item_id uuid REFERENCES public.inventory_catalog_items(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS unit_cost numeric,
  ADD COLUMN IF NOT EXISTS total_cost numeric;

CREATE INDEX IF NOT EXISTS waste_log_catalog_item_id_idx
  ON public.waste_log (catalog_item_id);

WITH unique_catalog_items AS (
  SELECT
    restaurant_id,
    lower(trim(item_name)) AS item_name_key,
    min(id) AS catalog_item_id,
    max(default_unit_cost) AS unit_cost
  FROM public.inventory_catalog_items
  GROUP BY restaurant_id, lower(trim(item_name))
  HAVING count(*) = 1
)
UPDATE public.waste_log AS wl
SET
  catalog_item_id = COALESCE(wl.catalog_item_id, uci.catalog_item_id),
  unit_cost = COALESCE(wl.unit_cost, uci.unit_cost),
  total_cost = COALESCE(
    wl.total_cost,
    CASE
      WHEN COALESCE(wl.unit_cost, uci.unit_cost) IS NOT NULL
        THEN wl.quantity * COALESCE(wl.unit_cost, uci.unit_cost)
      ELSE NULL
    END
  )
FROM unique_catalog_items AS uci
WHERE wl.restaurant_id = uci.restaurant_id
  AND lower(trim(wl.item_name)) = uci.item_name_key
  AND (
    wl.catalog_item_id IS NULL
    OR wl.unit_cost IS NULL
    OR wl.total_cost IS NULL
  );

NOTIFY pgrst, 'reload schema';
