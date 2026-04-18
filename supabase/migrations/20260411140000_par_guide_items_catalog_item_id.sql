-- Nullable link from PAR guide lines to catalog rows (ID-first matching; item_name retained).
ALTER TABLE public.par_guide_items
  ADD COLUMN IF NOT EXISTS catalog_item_id uuid REFERENCES public.inventory_catalog_items (id) ON DELETE SET NULL;

COMMENT ON COLUMN public.par_guide_items.catalog_item_id IS
  'When set, PAR sync and suggestions prefer this inventory_catalog_items row; otherwise item_name matching is used.';

CREATE INDEX IF NOT EXISTS idx_par_guide_items_catalog_item_id
  ON public.par_guide_items (catalog_item_id)
  WHERE catalog_item_id IS NOT NULL;

-- Safe backfill: only rows with exactly one catalog match (same restaurant + list, normalized name).
UPDATE public.par_guide_items pgi
SET catalog_item_id = m.catalog_id
FROM (
  SELECT
    pgi2.id AS par_row_id,
    min(ici.id::text)::uuid AS catalog_id,
    count(ici.id)::integer AS match_count
  FROM public.par_guide_items pgi2
  INNER JOIN public.par_guides pg ON pg.id = pgi2.par_guide_id
  INNER JOIN public.inventory_catalog_items ici
    ON ici.restaurant_id = pg.restaurant_id
   AND ici.inventory_list_id = pg.inventory_list_id
   AND lower(trim(both from coalesce(ici.item_name, ''))) = lower(trim(both from coalesce(pgi2.item_name, '')))
  WHERE pgi2.catalog_item_id IS NULL
    AND pg.inventory_list_id IS NOT NULL
  GROUP BY pgi2.id
  HAVING count(ici.id) = 1
) m
WHERE pgi.id = m.par_row_id
  AND pgi.catalog_item_id IS NULL;
