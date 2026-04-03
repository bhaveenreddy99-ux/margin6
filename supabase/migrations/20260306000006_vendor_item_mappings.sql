-- =============================================================================
-- Vendor Item Mappings
--
-- Stores a per-restaurant learned dictionary that maps a vendor's invoice line
-- (identified by vendor_name + vendor_sku or vendor_item_name) to a catalog
-- item.  InvoiceReview uses this to auto-match invoice lines without requiring
-- manual selection on every future invoice from the same vendor.
--
-- Also adds vendor_sku to purchase_history_items so that AI-parsed invoices
-- can carry the vendor's SKU through for SKU-first matching.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- Add vendor_sku to purchase_history_items
-- Populated by the invoice parser when a SKU is present on the invoice line.
-- Used by InvoiceReview to prefer SKU-based mapping lookup over name matching.
-- -----------------------------------------------------------------------------
ALTER TABLE public.purchase_history_items
  ADD COLUMN IF NOT EXISTS vendor_sku text;


-- -----------------------------------------------------------------------------
-- vendor_item_mappings
--
-- One row per (restaurant, vendor, invoice_item_name) — updated in place when
-- the user re-selects a different catalog item for the same vendor line name.
--
-- vendor_sku is stored alongside the name so that when an invoice carries a
-- SKU the match can be confirmed without relying on potentially unstable names.
-- The partial unique index on vendor_sku prevents two different catalog items
-- being mapped to the same SKU for the same vendor.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.vendor_item_mappings (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id    uuid        NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  vendor_name      text        NOT NULL,
  vendor_sku       text,                   -- SKU as it appears on vendor invoices (nullable)
  vendor_item_name text        NOT NULL,   -- Item name as it appears on vendor invoices
  catalog_item_id  uuid        NOT NULL REFERENCES public.inventory_catalog_items(id) ON DELETE CASCADE,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),

  -- One canonical catalog mapping per (restaurant, vendor, invoice item name)
  UNIQUE (restaurant_id, vendor_name, vendor_item_name)
);

-- Prevent two catalog items being mapped to the same SKU for the same vendor.
CREATE UNIQUE INDEX IF NOT EXISTS uq_vendor_item_mappings_sku
  ON public.vendor_item_mappings (restaurant_id, vendor_name, vendor_sku)
  WHERE vendor_sku IS NOT NULL;

-- Fast lookups by restaurant + vendor when loading the mapping dictionary.
CREATE INDEX IF NOT EXISTS idx_vendor_item_mappings_restaurant_vendor
  ON public.vendor_item_mappings (restaurant_id, vendor_name);


-- -----------------------------------------------------------------------------
-- RLS
-- All restaurant members can read and manage mappings — they are a shared
-- resource that benefits the whole team on each subsequent invoice.
-- -----------------------------------------------------------------------------
ALTER TABLE public.vendor_item_mappings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can view vendor item mappings"
  ON public.vendor_item_mappings FOR SELECT TO authenticated
  USING (is_member_of(restaurant_id));

CREATE POLICY "Members can create vendor item mappings"
  ON public.vendor_item_mappings FOR INSERT TO authenticated
  WITH CHECK (is_member_of(restaurant_id));

CREATE POLICY "Members can update vendor item mappings"
  ON public.vendor_item_mappings FOR UPDATE TO authenticated
  USING     (is_member_of(restaurant_id))
  WITH CHECK (is_member_of(restaurant_id));

CREATE POLICY "Members can delete vendor item mappings"
  ON public.vendor_item_mappings FOR DELETE TO authenticated
  USING (is_member_of(restaurant_id));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.vendor_item_mappings TO authenticated;


NOTIFY pgrst, 'reload schema';
