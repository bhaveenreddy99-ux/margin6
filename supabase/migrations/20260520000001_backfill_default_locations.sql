-- =============================================================================
-- Backfill: for every restaurant with zero active locations, create a default
-- location named after the restaurant.
--
-- Why: per-location screens (Sales, etc.) become unusable when a restaurant has
-- no locations. New signups will get this auto-created at restaurant-creation
-- time in src/pages/onboarding/CreateRestaurant.tsx; this migration retrofits
-- existing restaurants.
--
-- Idempotent: NOT EXISTS guard skips restaurants that already have any active
-- location. Safe to re-run.
--
-- Note: locations has no updated_at column; defaults populate is_default=false,
-- is_active=true, created_at=now(), storage_types JSON. Address fields are
-- nullable and left NULL — operators can fill them in Settings later.
-- =============================================================================

INSERT INTO public.locations (id, restaurant_id, name, is_active, created_at)
SELECT
  gen_random_uuid(),
  r.id,
  r.name,
  true,
  now()
FROM public.restaurants r
WHERE NOT EXISTS (
  SELECT 1 FROM public.locations l
  WHERE l.restaurant_id = r.id AND l.is_active = true
);

NOTIFY pgrst, 'reload schema';
