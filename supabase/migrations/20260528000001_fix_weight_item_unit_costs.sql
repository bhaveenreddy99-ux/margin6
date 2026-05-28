-- Fix catalog rows that stored PFG per-lb rates instead of per-case prices.

UPDATE public.inventory_catalog_items
SET default_unit_cost = 64.00, updated_at = now()
WHERE restaurant_id = 'a45f9dd2-56c2-499b-a89e-15a42d96ae23'
  AND item_name = 'Turkey Breast Smoked Refrigerated'
  AND default_unit_cost < 10.00;

UPDATE public.inventory_catalog_items
SET default_unit_cost = 59.28, updated_at = now()
WHERE restaurant_id = 'a45f9dd2-56c2-499b-a89e-15a42d96ae23'
  AND item_name ILIKE '%Ham Boneless Log%'
  AND default_unit_cost < 10.00;
