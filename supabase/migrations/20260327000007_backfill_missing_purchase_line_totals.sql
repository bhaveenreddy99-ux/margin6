-- Older invoice saves could leave purchase_history_items.total_cost NULL when the
-- effective line total was still derivable from quantity * unit_cost.

UPDATE public.purchase_history_items
SET total_cost = ROUND(quantity * unit_cost, 2)
WHERE total_cost IS NULL
  AND unit_cost IS NOT NULL;
