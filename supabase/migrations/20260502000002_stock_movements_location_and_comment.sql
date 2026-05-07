-- stock_movements is normally created in 20260329120000_workflow_purchase_orders_invoices_stock.sql.
-- Some databases never had that migration applied; ensure the table exists before altering.
CREATE TABLE IF NOT EXISTS public.stock_movements (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id   uuid NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  catalog_item_id uuid NOT NULL REFERENCES public.inventory_catalog_items(id) ON DELETE CASCADE,
  movement_type   text NOT NULL CHECK (movement_type IN ('receive', 'waste', 'adjustment')),
  quantity        numeric NOT NULL,
  reference_type  text,
  reference_id    uuid,
  invoice_id      uuid REFERENCES public.invoices(id) ON DELETE SET NULL,
  invoice_item_id uuid REFERENCES public.invoice_items(id) ON DELETE SET NULL,
  notes           text,
  created_by      uuid REFERENCES auth.users(id),
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_stock_movements_restaurant_catalog
  ON public.stock_movements (restaurant_id, catalog_item_id);
CREATE INDEX IF NOT EXISTS idx_stock_movements_invoice
  ON public.stock_movements (invoice_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_stock_movements_receive_per_invoice_item
  ON public.stock_movements (invoice_item_id)
  WHERE movement_type = 'receive' AND invoice_item_id IS NOT NULL;

ALTER TABLE public.stock_movements ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Members can view stock movements" ON public.stock_movements;
CREATE POLICY "Members can view stock movements"
  ON public.stock_movements FOR SELECT TO authenticated
  USING (public.is_member_of(restaurant_id));

DROP POLICY IF EXISTS "Members can insert stock movements" ON public.stock_movements;
CREATE POLICY "Members can insert stock movements"
  ON public.stock_movements FOR INSERT TO authenticated
  WITH CHECK (public.is_member_of(restaurant_id));

ALTER TABLE public.stock_movements
  ADD COLUMN IF NOT EXISTS location_id uuid
  REFERENCES public.locations(id);

CREATE INDEX IF NOT EXISTS idx_stock_movements_location_id
  ON public.stock_movements(location_id);

COMMENT ON TABLE public.stock_movements IS
  'Future inventory ledger for real-time stock tracking
   across locations. Currently empty — do not drop.
   Will become the source of truth for current_stock
   once ledger mode is active in a future sprint.';
