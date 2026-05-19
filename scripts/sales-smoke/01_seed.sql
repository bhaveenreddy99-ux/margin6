-- =============================================================================
-- Seed fixtures for sales-entry smoke tests.
-- Runs as the migration role (RLS-bypassing superuser) so we can populate
-- auth.users + restaurant + locations + members + assignments cleanly.
-- =============================================================================

-- Deterministic test UUIDs
\set restaurant_id      '''11111111-1111-1111-1111-111111111111'''
\set location_id        '''22222222-2222-2222-2222-222222222222'''
\set owner_id           '''aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'''
\set manager_id         '''bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'''
\set staff_yes_id       '''cccccccc-cccc-cccc-cccc-cccccccccccc'''
\set staff_no_id        '''dddddddd-dddd-dddd-dddd-dddddddddddd'''

BEGIN;

-- Auth users (minimal columns required by FK)
INSERT INTO auth.users (id, instance_id, email, aud, role)
VALUES
  (:owner_id::uuid,     '00000000-0000-0000-0000-000000000000', 'owner@test.local',     'authenticated', 'authenticated'),
  (:manager_id::uuid,   '00000000-0000-0000-0000-000000000000', 'manager@test.local',   'authenticated', 'authenticated'),
  (:staff_yes_id::uuid, '00000000-0000-0000-0000-000000000000', 'staff_yes@test.local', 'authenticated', 'authenticated'),
  (:staff_no_id::uuid,  '00000000-0000-0000-0000-000000000000', 'staff_no@test.local',  'authenticated', 'authenticated')
ON CONFLICT (id) DO NOTHING;

-- Restaurant (schema has only id, name, created_at — no owner_id column)
INSERT INTO public.restaurants (id, name)
VALUES (:restaurant_id::uuid, 'Smoke Test Restaurant')
ON CONFLICT (id) DO NOTHING;

-- Location
INSERT INTO public.locations (id, restaurant_id, name, is_active)
VALUES (:location_id::uuid, :restaurant_id::uuid, 'Smoke Test Location', true)
ON CONFLICT (id) DO NOTHING;

-- Members
INSERT INTO public.restaurant_members (user_id, restaurant_id, role)
VALUES
  (:owner_id::uuid,     :restaurant_id::uuid, 'OWNER'::app_role),
  (:manager_id::uuid,   :restaurant_id::uuid, 'MANAGER'::app_role),
  (:staff_yes_id::uuid, :restaurant_id::uuid, 'STAFF'::app_role),
  (:staff_no_id::uuid,  :restaurant_id::uuid, 'STAFF'::app_role)
ON CONFLICT (user_id, restaurant_id) DO NOTHING;

-- Location assignments — managers/staff need ula rows; owner does not.
INSERT INTO public.user_location_assignments (
  user_id, location_id, can_see_food_cost_pct, can_see_costs, can_see_inventory_value, can_approve_orders, can_edit_par, is_primary
) VALUES
  (:manager_id::uuid,   :location_id::uuid, true,  true,  true,  true,  true,  true),
  (:staff_yes_id::uuid, :location_id::uuid, true,  false, false, false, false, true),
  (:staff_no_id::uuid,  :location_id::uuid, false, false, false, false, false, true)
ON CONFLICT (user_id, location_id) DO NOTHING;

COMMIT;

\echo 'Seed complete.'
