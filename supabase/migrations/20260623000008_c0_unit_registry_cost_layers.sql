-- C0-MVP-1: canonical inventory/cost foundation (ADDITIVE ONLY — no behavior change).
--
-- Adds the substrate for provable cost history without touching any production
-- path: receipt confirmation, invoice parsing, inventory counting, KPI formulas,
-- and Smart Order are ALL unchanged. default_unit_cost is NOT removed and remains
-- the live source; catalog_cost_layers is NOT yet wired into any read/write path.
-- Nothing reads `base_unit` or the cost layers in production yet.
--
-- Contents:
--   1. `units` registry (+ standard physics seed).
--   2. `inventory_catalog_items.base_unit` (backfilled, NOT NULL).
--   3. `catalog_cost_layers` immutable, append-only cost history.
--   4. Backfill one genesis layer per item from current default_unit_cost.
--   5. Helper functions: latest layer, base-unit cost, safe projection.
--   6. Apply-time self-verification (fails the migration if invariants break).

-- ── 1. Unit registry ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.units (
  code            text PRIMARY KEY,
  dimension       text NOT NULL CHECK (dimension IN ('mass', 'volume', 'count')),
  to_base_factor  numeric NOT NULL CHECK (to_base_factor > 0),  -- base units of `dimension` per 1 of `code`
  is_base         boolean NOT NULL DEFAULT false,
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- Standard, restaurant-agnostic physics. Dimension bases: mass=g, volume=ml, count=each.
INSERT INTO public.units (code, dimension, to_base_factor, is_base) VALUES
  ('g',    'mass',   1,         true),
  ('kg',   'mass',   1000,      false),
  ('oz',   'mass',   28.349523, false),
  ('lb',   'mass',   453.59237, false),
  ('ml',   'volume', 1,         true),
  ('l',    'volume', 1000,      false),
  ('gal',  'volume', 3785.4118, false),
  ('each', 'count',  1,         true),
  ('ct',   'count',  1,         false)
ON CONFLICT (code) DO NOTHING;

ALTER TABLE public.units ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Anyone authenticated can read units" ON public.units;
CREATE POLICY "Anyone authenticated can read units"
  ON public.units FOR SELECT TO authenticated USING (true);

-- ── 2. base_unit on the catalog (additive; backfilled; not yet consumed) ──────
ALTER TABLE public.inventory_catalog_items
  ADD COLUMN IF NOT EXISTS base_unit text;

-- Conservative backfill from the existing free-text `unit`. Package/unknown units
-- (incl. 'case') map to 'each' — the safe neutral count base. base_unit is NOT
-- consumed by any production path in MVP-1; real per-item base resolution arrives
-- with the conversion tables in MVP-2.
UPDATE public.inventory_catalog_items
SET base_unit = CASE lower(btrim(coalesce(unit, '')))
    WHEN 'lb'  THEN 'lb'  WHEN 'lbs' THEN 'lb' WHEN 'pound' THEN 'lb' WHEN 'pounds' THEN 'lb' WHEN '#' THEN 'lb'
    WHEN 'oz'  THEN 'oz'  WHEN 'ounce' THEN 'oz' WHEN 'ounces' THEN 'oz'
    WHEN 'g'   THEN 'g'   WHEN 'gram' THEN 'g' WHEN 'grams' THEN 'g'
    WHEN 'kg'  THEN 'kg'  WHEN 'kilo' THEN 'kg' WHEN 'kilogram' THEN 'kg'
    WHEN 'ml'  THEN 'ml'  WHEN 'milliliter' THEN 'ml'
    WHEN 'l'   THEN 'l'   WHEN 'liter' THEN 'l' WHEN 'litre' THEN 'l'
    WHEN 'gal' THEN 'gal' WHEN 'gallon' THEN 'gal' WHEN 'gallons' THEN 'gal'
    ELSE 'each'   -- each/ea/ct/count/case/cs/unit/blank/unknown → safe count base
  END
WHERE base_unit IS NULL;

ALTER TABLE public.inventory_catalog_items
  ALTER COLUMN base_unit SET DEFAULT 'each';
ALTER TABLE public.inventory_catalog_items
  ALTER COLUMN base_unit SET NOT NULL;
-- FK last (after backfill guarantees only seeded codes are present).
ALTER TABLE public.inventory_catalog_items
  ADD CONSTRAINT inventory_catalog_items_base_unit_fkey
  FOREIGN KEY (base_unit) REFERENCES public.units(code);

-- ── 3. Immutable, append-only cost layers ────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.catalog_cost_layers (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id          uuid NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  catalog_item_id        uuid NOT NULL REFERENCES public.inventory_catalog_items(id) ON DELETE CASCADE,
  source_invoice_id      uuid REFERENCES public.invoices(id) ON DELETE SET NULL,
  source_invoice_item_id uuid,
  vendor_name            text,
  package_unit           text,
  package_qty            numeric,
  base_unit              text NOT NULL REFERENCES public.units(code),
  base_unit_qty          numeric NOT NULL CHECK (base_unit_qty > 0),
  package_cost           numeric,
  base_unit_cost         numeric NOT NULL,
  prev_base_unit_cost    numeric,
  effective_from         timestamptz NOT NULL DEFAULT now(),
  created_by             uuid,
  source                 text NOT NULL DEFAULT 'backfill'
                            CHECK (source IN ('backfill', 'receipt', 'manual')),
  note                   text,
  created_at             timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_catalog_cost_layers_item_effective
  ON public.catalog_cost_layers (catalog_item_id, effective_from DESC, created_at DESC);

ALTER TABLE public.catalog_cost_layers ENABLE ROW LEVEL SECURITY;
-- Members may read; NO client write policy — layers are written only by
-- SECURITY DEFINER functions / migrations (none wired in MVP-1).
DROP POLICY IF EXISTS "Members can view cost layers" ON public.catalog_cost_layers;
CREATE POLICY "Members can view cost layers"
  ON public.catalog_cost_layers FOR SELECT TO authenticated
  USING (public.is_member_of(restaurant_id));

-- Enforce immutability: append-only. Block UPDATE/DELETE for everyone.
CREATE OR REPLACE FUNCTION public.catalog_cost_layers_block_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'catalog_cost_layers is append-only; % is not permitted', TG_OP;
END;
$$;
DROP TRIGGER IF EXISTS catalog_cost_layers_immutable ON public.catalog_cost_layers;
CREATE TRIGGER catalog_cost_layers_immutable
  BEFORE UPDATE OR DELETE ON public.catalog_cost_layers
  FOR EACH ROW EXECUTE FUNCTION public.catalog_cost_layers_block_mutation();

-- ── 4. Backfill: one genesis layer per item with a current cost ──────────────
-- base_unit_qty = 1 and base_unit_cost = default_unit_cost encodes today's
-- (per-package) cost faithfully → the latest-layer projection EQUALS
-- default_unit_cost, so no value can change when nothing reads the layer yet.
INSERT INTO public.catalog_cost_layers (
  restaurant_id, catalog_item_id, source_invoice_id, vendor_name,
  package_unit, package_qty, base_unit, base_unit_qty,
  package_cost, base_unit_cost, prev_base_unit_cost, effective_from, source, note
)
SELECT
  c.restaurant_id,
  c.id,
  NULL,
  c.vendor_name,
  coalesce(c.cost_unit, 'case'),
  1,
  c.base_unit,
  1,
  c.default_unit_cost,
  c.default_unit_cost,
  NULL,
  coalesce(c.updated_at, c.created_at, now()),
  'backfill',
  'Genesis layer backfilled from inventory_catalog_items.default_unit_cost (C0-MVP-1)'
FROM public.inventory_catalog_items c
WHERE c.default_unit_cost IS NOT NULL;

-- ── 5. Read helpers (additive; NOT wired into any production path) ───────────
-- Latest cost layer id for an item (newest effective_from, then created_at).
CREATE OR REPLACE FUNCTION public.catalog_latest_cost_layer(p_item_id uuid)
RETURNS public.catalog_cost_layers
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT *
  FROM public.catalog_cost_layers
  WHERE catalog_item_id = p_item_id
  ORDER BY effective_from DESC, created_at DESC
  LIMIT 1;
$$;

-- Canonical $/base_unit from the latest layer (NULL if no layer exists).
CREATE OR REPLACE FUNCTION public.catalog_base_unit_cost(p_item_id uuid)
RETURNS numeric
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT base_unit_cost
  FROM public.catalog_cost_layers
  WHERE catalog_item_id = p_item_id
  ORDER BY effective_from DESC, created_at DESC
  LIMIT 1;
$$;

-- Safe projection: latest layer cost, else fall back to the live default_unit_cost.
-- This is what will EVENTUALLY back default_unit_cost; in MVP-1 it is a read-only
-- helper that nothing calls in production.
CREATE OR REPLACE FUNCTION public.catalog_cost_projection(p_item_id uuid)
RETURNS numeric
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT COALESCE(
    public.catalog_base_unit_cost(p_item_id),
    (SELECT default_unit_cost FROM public.inventory_catalog_items WHERE id = p_item_id)
  );
$$;

REVOKE ALL ON FUNCTION public.catalog_latest_cost_layer(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.catalog_base_unit_cost(uuid)    FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.catalog_cost_projection(uuid)   FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.catalog_latest_cost_layer(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.catalog_base_unit_cost(uuid)    TO authenticated;
GRANT EXECUTE ON FUNCTION public.catalog_cost_projection(uuid)   TO authenticated;

-- ── 6. Apply-time self-verification (the migration fails if invariants break) ─
DO $verify$
DECLARE
  v_null_base int;
  v_mismatch  int;
BEGIN
  -- (a) every catalog item resolves a base unit
  SELECT count(*) INTO v_null_base
  FROM public.inventory_catalog_items WHERE base_unit IS NULL;
  IF v_null_base > 0 THEN
    RAISE EXCEPTION 'C0-MVP-1: % catalog item(s) have a NULL base_unit', v_null_base;
  END IF;

  -- (b) every item with a cost resolves a latest layer whose base_unit_cost
  --     equals default_unit_cost (the no-value-change invariant)
  SELECT count(*) INTO v_mismatch
  FROM public.inventory_catalog_items c
  WHERE c.default_unit_cost IS NOT NULL
    AND public.catalog_base_unit_cost(c.id) IS DISTINCT FROM c.default_unit_cost;
  IF v_mismatch > 0 THEN
    RAISE EXCEPTION 'C0-MVP-1: % item(s) where latest cost layer != default_unit_cost', v_mismatch;
  END IF;
END
$verify$;

NOTIFY pgrst, 'reload schema';
