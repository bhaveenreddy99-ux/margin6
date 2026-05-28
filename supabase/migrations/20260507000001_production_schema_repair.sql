-- =============================================================================
-- Production Schema Repair
--
-- This migration is IDEMPOTENT and FORWARD-ONLY.
-- It repairs drift between the local migration files and the live database.
-- It does NOT edit old migrations. It does NOT delete migration history.
-- It does NOT regenerate types (do that after applying this migration).
--
-- Root cause: migration 20260329120000_workflow_purchase_orders_invoices_stock.sql
-- and 20260307000006_invoice_line_total_variance.sql and
-- 20260505000001_trusted_receiving.sql were recorded in the live DB migration
-- history but their DDL never executed.
--
-- Live impact (P0 until this repair):
--   - confirm_invoice_receipt() errors on every call (references missing columns)
--   - purchase_orders, purchase_order_items, invoice_items have RLS enabled but
--     zero policies → deny-all, table completely inaccessible to authenticated users
--   - invoice_line_comparisons.invoice_id missing → RLS policies broken
--   - delivery_issues.invoice_id missing → RLS policies broken
-- =============================================================================

-- =============================================================================
-- SECTION 1: invoice_line_comparisons — missing columns
-- =============================================================================

-- From 20260307000006_invoice_line_total_variance.sql
ALTER TABLE public.invoice_line_comparisons
  ADD COLUMN IF NOT EXISTS po_total_cost numeric,
  ADD COLUMN IF NOT EXISTS invoiced_total_cost numeric;

-- total_diff is a generated column; can only add when the two source columns exist.
-- IF NOT EXISTS prevents double-add on re-run.
ALTER TABLE public.invoice_line_comparisons
  ADD COLUMN IF NOT EXISTS total_diff numeric
  GENERATED ALWAYS AS (invoiced_total_cost - po_total_cost) STORED;

-- From 20260329120000_workflow_purchase_orders_invoices_stock.sql
ALTER TABLE public.invoice_line_comparisons
  ADD COLUMN IF NOT EXISTS invoice_id uuid
  REFERENCES public.invoices(id) ON DELETE CASCADE;

ALTER TABLE public.invoice_line_comparisons
  ADD COLUMN IF NOT EXISTS invoice_item_id uuid
  REFERENCES public.invoice_items(id) ON DELETE SET NULL;

ALTER TABLE public.invoice_line_comparisons
  ADD COLUMN IF NOT EXISTS purchase_order_item_id uuid
  REFERENCES public.purchase_order_items(id) ON DELETE SET NULL;

-- From 20260505000001_trusted_receiving.sql
ALTER TABLE public.invoice_line_comparisons
  ADD COLUMN IF NOT EXISTS received_qty_confirmed BOOLEAN DEFAULT false;

COMMENT ON COLUMN public.invoice_line_comparisons.received_qty_confirmed IS
  'True only when a manager/staff explicitly confirmed the received_qty (not auto-filled from invoiced qty).';

-- =============================================================================
-- SECTION 2: invoice_line_comparisons — make purchase_history_id nullable
--            and add CHECK constraint (must happen after invoice_id column exists)
-- =============================================================================

-- Drop old NOT NULL constraint by making column nullable.
-- All existing rows have purchase_history_id set, so this is data-safe.
ALTER TABLE public.invoice_line_comparisons
  ALTER COLUMN purchase_history_id DROP NOT NULL;

-- Re-attach FK in case it was dropped (idempotent: DROP IF EXISTS, then ADD)
ALTER TABLE public.invoice_line_comparisons
  DROP CONSTRAINT IF EXISTS invoice_line_comparisons_purchase_history_id_fkey;

ALTER TABLE public.invoice_line_comparisons
  ADD CONSTRAINT invoice_line_comparisons_purchase_history_id_fkey
  FOREIGN KEY (purchase_history_id) REFERENCES public.purchase_history(id) ON DELETE CASCADE;

-- Every row must have at least one of invoice_id or purchase_history_id.
ALTER TABLE public.invoice_line_comparisons
  DROP CONSTRAINT IF EXISTS invoice_line_comparisons_invoice_or_ph_chk;

ALTER TABLE public.invoice_line_comparisons
  ADD CONSTRAINT invoice_line_comparisons_invoice_or_ph_chk
  CHECK (invoice_id IS NOT NULL OR purchase_history_id IS NOT NULL);

-- =============================================================================
-- SECTION 3: delivery_issues — missing column + nullability + CHECK
-- =============================================================================

ALTER TABLE public.delivery_issues
  ADD COLUMN IF NOT EXISTS invoice_id uuid
  REFERENCES public.invoices(id) ON DELETE CASCADE;

-- Make purchase_history_id nullable (mirror of invoice_line_comparisons above).
ALTER TABLE public.delivery_issues
  ALTER COLUMN purchase_history_id DROP NOT NULL;

ALTER TABLE public.delivery_issues
  DROP CONSTRAINT IF EXISTS delivery_issues_purchase_history_id_fkey;

ALTER TABLE public.delivery_issues
  ADD CONSTRAINT delivery_issues_purchase_history_id_fkey
  FOREIGN KEY (purchase_history_id) REFERENCES public.purchase_history(id) ON DELETE CASCADE;

ALTER TABLE public.delivery_issues
  DROP CONSTRAINT IF EXISTS delivery_issues_invoice_or_ph_chk;

ALTER TABLE public.delivery_issues
  ADD CONSTRAINT delivery_issues_invoice_or_ph_chk
  CHECK (invoice_id IS NOT NULL OR purchase_history_id IS NOT NULL);

-- =============================================================================
-- SECTION 4: stock_movements — trusted-receiving columns
--            (from 20260505000001_trusted_receiving.sql)
-- =============================================================================

ALTER TABLE public.stock_movements
  ADD COLUMN IF NOT EXISTS quantity_unit       TEXT    DEFAULT 'case',
  ADD COLUMN IF NOT EXISTS source_quantity     NUMERIC NULL,
  ADD COLUMN IF NOT EXISTS source_quantity_unit TEXT   NULL,
  ADD COLUMN IF NOT EXISTS conversion_status  TEXT    DEFAULT 'converted_to_case';

COMMENT ON COLUMN public.stock_movements.quantity             IS 'Normalized quantity in CASES — canonical unit for all inventory math.';
COMMENT ON COLUMN public.stock_movements.quantity_unit        IS 'Always ''case'' for movements created by confirm_invoice_receipt.';
COMMENT ON COLUMN public.stock_movements.source_quantity      IS 'Original received quantity as entered/stored (may be in lbs, each, etc.).';
COMMENT ON COLUMN public.stock_movements.source_quantity_unit IS 'Unit of source_quantity (CS, LB, EA, …).';
COMMENT ON COLUMN public.stock_movements.conversion_status    IS 'converted_to_case | passthrough_case | conversion_failed.';

-- =============================================================================
-- SECTION 5: Data backfills (idempotent — only fill rows where target IS NULL)
-- =============================================================================

-- 5a. invoice_line_comparisons.invoice_id:
--     For rows that were created against a purchase_history that has been
--     migrated into invoices (same id), set invoice_id = purchase_history_id.
UPDATE public.invoice_line_comparisons ilc
SET invoice_id = ilc.purchase_history_id
WHERE ilc.invoice_id IS NULL
  AND ilc.purchase_history_id IS NOT NULL
  AND EXISTS (SELECT 1 FROM public.invoices i WHERE i.id = ilc.purchase_history_id);

-- 5b. invoice_line_comparisons line totals backfill (from 20260307000006)
UPDATE public.invoice_line_comparisons AS ilc
SET
  po_total_cost = COALESCE(
    ilc.po_total_cost,
    CASE
      WHEN ilc.po_qty IS NOT NULL AND ilc.po_unit_cost IS NOT NULL
        THEN ilc.po_qty * ilc.po_unit_cost
      ELSE NULL
    END
  ),
  invoiced_total_cost = COALESCE(
    ilc.invoiced_total_cost,
    COALESCE(
      (
        SELECT phi.total_cost
        FROM public.purchase_history_items AS phi
        WHERE phi.id = ilc.purchase_history_item_id
      ),
      CASE
        WHEN ilc.invoiced_qty IS NOT NULL AND ilc.invoiced_unit_cost IS NOT NULL
          THEN ilc.invoiced_qty * ilc.invoiced_unit_cost
        ELSE NULL
      END
    )
  );

-- 5c. delivery_issues.invoice_id backfill (mirror of 5a)
UPDATE public.delivery_issues di
SET invoice_id = di.purchase_history_id
WHERE di.invoice_id IS NULL
  AND di.purchase_history_id IS NOT NULL
  AND EXISTS (SELECT 1 FROM public.invoices i WHERE i.id = di.purchase_history_id);

-- =============================================================================
-- SECTION 6: Missing indexes
-- =============================================================================

-- invoice_line_comparisons
CREATE INDEX IF NOT EXISTS idx_invoice_line_comparisons_invoice_id
  ON public.invoice_line_comparisons (invoice_id);

CREATE INDEX IF NOT EXISTS idx_invoice_line_comparisons_invoice_item_id
  ON public.invoice_line_comparisons (invoice_item_id);

-- delivery_issues
CREATE INDEX IF NOT EXISTS idx_delivery_issues_invoice_id
  ON public.delivery_issues (invoice_id);

-- purchase_orders (were missing from live)
CREATE INDEX IF NOT EXISTS idx_purchase_orders_restaurant_id
  ON public.purchase_orders (restaurant_id);

CREATE INDEX IF NOT EXISTS idx_purchase_orders_po_number
  ON public.purchase_orders (po_number);

CREATE INDEX IF NOT EXISTS idx_purchase_orders_status
  ON public.purchase_orders (restaurant_id, status);

-- purchase_order_items
CREATE INDEX IF NOT EXISTS idx_purchase_order_items_po
  ON public.purchase_order_items (purchase_order_id);

CREATE INDEX IF NOT EXISTS idx_purchase_order_items_catalog
  ON public.purchase_order_items (catalog_item_id);

-- invoice_items
CREATE INDEX IF NOT EXISTS idx_invoice_items_invoice
  ON public.invoice_items (invoice_id);

CREATE INDEX IF NOT EXISTS idx_invoice_items_catalog
  ON public.invoice_items (catalog_item_id);

-- invoices
CREATE INDEX IF NOT EXISTS idx_invoices_restaurant_id
  ON public.invoices (restaurant_id);

CREATE INDEX IF NOT EXISTS idx_invoices_purchase_order_id
  ON public.invoices (purchase_order_id);

CREATE INDEX IF NOT EXISTS idx_invoices_status
  ON public.invoices (restaurant_id, status);

-- =============================================================================
-- SECTION 7: Helper SECURITY DEFINER functions
--            (from 20260329120000 — missing entirely from live DB)
-- =============================================================================

-- Returns the restaurant_id of an invoice without exposing invoices to anon.
CREATE OR REPLACE FUNCTION public.invoice_restaurant_id(p_invoice_id uuid)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT restaurant_id FROM public.invoices WHERE id = p_invoice_id
$$;

-- Returns the restaurant_id of a purchase_order.
CREATE OR REPLACE FUNCTION public.purchase_order_restaurant_id(p_po_id uuid)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT restaurant_id FROM public.purchase_orders WHERE id = p_po_id
$$;

-- =============================================================================
-- SECTION 8: normalize_received_qty_to_cases
--            (from 20260505000001_trusted_receiving.sql — missing from live DB)
-- =============================================================================

CREATE OR REPLACE FUNCTION public.normalize_received_qty_to_cases(
  p_qty       numeric,
  p_unit      text,
  p_pack_size text
)
RETURNS TABLE(
  cases            numeric,
  ok               boolean,
  reason           text,
  conv_status      text
)
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_unit_upper      text    := upper(trim(coalesce(p_unit, 'CS')));
  v_units_per_case  numeric := NULL;
  v_total_per_case  numeric := NULL;
  v_match           text[];
BEGIN
  -- Parse pack_size: "6/4 LB" → units_per_case=6, total_lbs_per_case=24
  --                 "24/1 EA" → units_per_case=24
  IF p_pack_size IS NOT NULL THEN
    v_match := regexp_match(p_pack_size, '(\d+(?:\.\d+)?)\s*/\s*(\d+(?:\.\d+)?)');
    IF v_match IS NOT NULL THEN
      v_units_per_case := v_match[1]::numeric;
      v_total_per_case := v_match[1]::numeric * v_match[2]::numeric;
    ELSE
      v_match := regexp_match(p_pack_size, '(\d+(?:\.\d+)?)');
      IF v_match IS NOT NULL THEN
        v_units_per_case := v_match[1]::numeric;
        v_total_per_case := v_units_per_case;
      END IF;
    END IF;
  END IF;

  -- Case-based: passthrough
  IF v_unit_upper IN ('CS', 'CASE', 'CASES', 'CA', 'CSE', '') THEN
    RETURN QUERY SELECT p_qty, true, NULL::text, 'passthrough_case'::text;
    RETURN;
  END IF;

  -- Weight (lb)
  IF v_unit_upper IN ('LB', 'LBS', 'POUND', 'POUNDS') THEN
    IF v_total_per_case IS NOT NULL AND v_total_per_case > 0 THEN
      RETURN QUERY SELECT round(p_qty / v_total_per_case, 4), true, NULL::text, 'converted_to_case'::text;
    ELSE
      RETURN QUERY SELECT 0::numeric, false,
        format('Cannot convert LB to cases: pack_size "%s" has no usable totalPerCase', coalesce(p_pack_size, '(null)')),
        'conversion_failed'::text;
    END IF;
    RETURN;
  END IF;

  -- Weight (oz)
  IF v_unit_upper IN ('OZ', 'OUNCE', 'OUNCES') THEN
    IF v_total_per_case IS NOT NULL AND v_total_per_case > 0 THEN
      RETURN QUERY SELECT round((p_qty / 16.0) / v_total_per_case, 4), true, NULL::text, 'converted_to_case'::text;
    ELSE
      RETURN QUERY SELECT 0::numeric, false,
        'Cannot convert OZ to cases: no pack totalPerCase',
        'conversion_failed'::text;
    END IF;
    RETURN;
  END IF;

  -- Count-based (each, piece, etc.)
  IF v_unit_upper IN ('EA', 'EACH', 'PC', 'PCS', 'PIECE', 'PIECES', 'CT', 'COUNT', 'UN', 'UNIT', 'UNITS') THEN
    IF v_units_per_case IS NOT NULL AND v_units_per_case > 0 THEN
      RETURN QUERY SELECT round(p_qty / v_units_per_case, 4), true, NULL::text, 'converted_to_case'::text;
    ELSE
      RETURN QUERY SELECT 0::numeric, false,
        format('Cannot convert EA to cases: pack_size "%s" has no usable unitsPerCase', coalesce(p_pack_size, '(null)')),
        'conversion_failed'::text;
    END IF;
    RETURN;
  END IF;

  -- Unknown unit
  RETURN QUERY SELECT 0::numeric, false,
    format('Unknown unit "%s" — cannot convert to cases safely', coalesce(p_unit, '(null)')),
    'conversion_failed'::text;
END;
$$;

GRANT EXECUTE ON FUNCTION public.normalize_received_qty_to_cases(numeric, text, text) TO authenticated;

-- =============================================================================
-- SECTION 9: confirm_invoice_receipt_legacy
--            (from 20260329120000 — missing from live DB, called by main function)
-- =============================================================================

CREATE OR REPLACE FUNCTION public.confirm_invoice_receipt_legacy(
  p_invoice_id    uuid,
  p_restaurant_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_item              RECORD;
  v_receipt_status    text;
  v_confirmed_at      timestamptz;
  v_already_confirmed boolean := false;
  v_confirmed_count   integer := 0;
  v_no_catalog_count  integer := 0;
  v_results           jsonb := '[]'::jsonb;
BEGIN
  IF NOT public.is_member_of(p_restaurant_id) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  SELECT ph.receipt_status, ph.confirmed_at
  INTO v_receipt_status, v_confirmed_at
  FROM public.purchase_history AS ph
  WHERE ph.id = p_invoice_id AND ph.restaurant_id = p_restaurant_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Legacy purchase_history row not found';
  END IF;

  IF v_receipt_status = 'confirmed' THEN
    v_already_confirmed := true;
  ELSE
    UPDATE public.purchase_history
    SET receipt_status = 'confirmed',
        invoice_status = 'COMPLETE',
        confirmed_at   = COALESCE(confirmed_at, now())
    WHERE id = p_invoice_id AND restaurant_id = p_restaurant_id
    RETURNING confirmed_at INTO v_confirmed_at;
  END IF;

  FOR v_item IN
    SELECT phi.item_name, phi.quantity, phi.catalog_item_id
    FROM public.purchase_history_items AS phi
    WHERE phi.purchase_history_id = p_invoice_id
  LOOP
    IF v_item.catalog_item_id IS NULL THEN
      v_no_catalog_count := v_no_catalog_count + 1;
    ELSE
      v_confirmed_count := v_confirmed_count + 1;
    END IF;
    v_results := v_results || jsonb_build_object(
      'item_name',          v_item.item_name,
      'quantity_confirmed', v_item.quantity,
      'status', CASE WHEN v_item.catalog_item_id IS NULL THEN 'no_catalog_match'
                ELSE CASE WHEN v_already_confirmed THEN 'already_confirmed' ELSE 'confirmed' END END
    );
  END LOOP;

  RETURN jsonb_build_object(
    'success',                 true,
    'already_confirmed',       v_already_confirmed,
    'confirmed',               v_confirmed_count,
    'no_catalog',              v_no_catalog_count,
    'inventory_updated',       false,
    'stock_movements_created', 0,
    'confirmed_at',            v_confirmed_at,
    'message', 'Legacy purchase_history receipt confirmed (migrate to invoices for stock movements).',
    'items', v_results
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.confirm_invoice_receipt_legacy(uuid, uuid) TO authenticated;

-- =============================================================================
-- SECTION 10: confirm_invoice_receipt — repaired version
--
-- Changes from the broken live version:
--   1. References ii.quantity_invoiced (live column) instead of ii.quantity
--   2. invoice_line_comparisons JOIN now uses invoice_item_id (being added above)
--      AND invoice_id (being added above)
--   3. Adds trusted-receiving: received_qty_confirmed gate
--   4. Adds unit normalization via normalize_received_qty_to_cases
--   5. Preserves price-sync logic already present on live DB
--   6. Fixes fallback to confirm_invoice_receipt_legacy (function now exists)
-- =============================================================================

CREATE OR REPLACE FUNCTION public.confirm_invoice_receipt(
  p_invoice_id    uuid,
  p_restaurant_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_item               RECORD;
  v_receipt_status     text;
  v_inv_status         text;
  v_confirmed_at       timestamptz;
  v_already_confirmed  boolean := false;
  v_confirmed_count    integer := 0;
  v_no_catalog_count   integer := 0;
  v_conv_failed_count  integer := 0;
  v_unconfirmed_count  integer := 0;
  v_movements_count    integer := 0;
  v_results            jsonb   := '[]'::jsonb;
  v_price_changes      jsonb   := '[]'::jsonb;
  v_price_increases    jsonb   := '[]'::jsonb;
  v_price_decreases    jsonb   := '[]'::jsonb;
  v_cases              numeric;
  v_conv_ok            boolean;
  v_conv_reason        text;
  v_conv_status_str    text;
  v_old_cost           numeric;
  v_new_cost           numeric;
  v_pct_diff           numeric;
  v_member             RECORD;
BEGIN
  IF NOT public.is_member_of(p_restaurant_id) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  -- ── Gate: check for unconfirmed received quantities ──────────────────────
  -- Only enforce if the received_qty_confirmed column exists and has data.
  SELECT COUNT(*) INTO v_unconfirmed_count
  FROM public.invoice_line_comparisons ilc
  WHERE ilc.invoice_id = p_invoice_id
    AND ilc.invoiced_qty > 0
    AND ilc.status NOT IN ('missing_from_invoice')
    AND (ilc.received_qty_confirmed IS NULL OR ilc.received_qty_confirmed = false);

  IF v_unconfirmed_count > 0 THEN
    RETURN jsonb_build_object(
      'success',           false,
      'error',             'received_qty_not_confirmed',
      'unconfirmed_count', v_unconfirmed_count,
      'message', format(
        '%s line(s) have auto-filled received quantities that have not been confirmed. '
        'Please confirm all received quantities before posting.',
        v_unconfirmed_count
      )
    );
  END IF;

  -- ── Lock invoice header ───────────────────────────────────────────────────
  SELECT inv.receipt_status, inv.status
  INTO v_receipt_status, v_inv_status
  FROM public.invoices AS inv
  WHERE inv.id = p_invoice_id
    AND inv.restaurant_id = p_restaurant_id
  FOR UPDATE;

  IF NOT FOUND THEN
    -- Fallback to legacy purchase_history row
    PERFORM 1 FROM public.purchase_history AS ph
    WHERE ph.id = p_invoice_id AND ph.restaurant_id = p_restaurant_id;
    IF FOUND THEN
      RETURN public.confirm_invoice_receipt_legacy(p_invoice_id, p_restaurant_id);
    END IF;
    RAISE EXCEPTION 'Invoice not found';
  END IF;

  IF v_receipt_status = 'confirmed' OR v_inv_status = 'confirmed' THEN
    v_already_confirmed := true;
  ELSE
    UPDATE public.invoices
    SET
      receipt_status = 'confirmed',
      status         = 'confirmed',
      confirmed_at   = COALESCE(confirmed_at, now()),
      updated_at     = now()
    WHERE id = p_invoice_id
      AND restaurant_id = p_restaurant_id
    RETURNING confirmed_at INTO v_confirmed_at;
  END IF;

  -- ── Process each invoice line ─────────────────────────────────────────────
  IF NOT v_already_confirmed THEN
    FOR v_item IN
      SELECT
        ii.id,
        ii.item_name,
        -- Live DB column is quantity_invoiced (not quantity)
        ii.quantity_invoiced                                         AS billed_qty,
        ii.unit_cost                                                 AS invoiced_unit_cost,
        ii.catalog_item_id,
        COALESCE(ilc.received_qty, ii.quantity_invoiced)            AS received_qty_raw,
        COALESCE(ii.unit, 'CS')                                     AS source_unit,
        cat.pack_size
      FROM public.invoice_items AS ii
      LEFT JOIN LATERAL (
        SELECT received_qty
        FROM public.invoice_line_comparisons
        WHERE invoice_item_id = ii.id
          AND invoice_id      = p_invoice_id
        ORDER BY id ASC
        LIMIT 1
      ) AS ilc ON true
      LEFT JOIN public.inventory_catalog_items cat ON cat.id = ii.catalog_item_id
      WHERE ii.invoice_id = p_invoice_id
    LOOP
      IF v_item.catalog_item_id IS NULL THEN
        v_no_catalog_count := v_no_catalog_count + 1;
        v_results := v_results || jsonb_build_object(
          'item_name',          v_item.item_name,
          'quantity_confirmed', v_item.received_qty_raw,
          'status',             'no_catalog_match'
        );
        CONTINUE;
      END IF;

      -- ── Normalize received qty to CASES ────────────────────────────────
      SELECT n.cases, n.ok, n.reason, n.conv_status
      INTO v_cases, v_conv_ok, v_conv_reason, v_conv_status_str
      FROM public.normalize_received_qty_to_cases(
        v_item.received_qty_raw,
        v_item.source_unit,
        v_item.pack_size
      ) AS n;

      IF NOT v_conv_ok THEN
        v_conv_failed_count := v_conv_failed_count + 1;
        v_results := v_results || jsonb_build_object(
          'item_name',   v_item.item_name,
          'source_qty',  v_item.received_qty_raw,
          'source_unit', v_item.source_unit,
          'status',      'unit_conversion_failed',
          'reason',      v_conv_reason
        );
        CONTINUE;
      END IF;

      v_confirmed_count := v_confirmed_count + 1;

      -- ── Stock movement ──────────────────────────────────────────────────
      IF v_cases IS NOT NULL AND v_cases > 0 THEN
        IF NOT EXISTS (
          SELECT 1 FROM public.stock_movements sm
          WHERE sm.invoice_item_id = v_item.id
            AND sm.movement_type   = 'receive'
        ) THEN
          INSERT INTO public.stock_movements (
            restaurant_id,
            catalog_item_id,
            movement_type,
            quantity,
            quantity_unit,
            source_quantity,
            source_quantity_unit,
            conversion_status,
            reference_type,
            reference_id,
            invoice_id,
            invoice_item_id,
            created_by
          ) VALUES (
            p_restaurant_id,
            v_item.catalog_item_id,
            'receive',
            v_cases,
            'case',
            v_item.received_qty_raw,
            v_item.source_unit,
            v_conv_status_str,
            'invoice_receipt',
            p_invoice_id,
            p_invoice_id,
            v_item.id,
            auth.uid()
          );
          v_movements_count := v_movements_count + 1;
        END IF;
      END IF;

      -- ── Price sync ──────────────────────────────────────────────────────
      IF v_item.invoiced_unit_cost IS NOT NULL AND v_item.invoiced_unit_cost > 0 THEN
        SELECT default_unit_cost INTO v_old_cost
        FROM public.inventory_catalog_items
        WHERE id = v_item.catalog_item_id;

        v_new_cost := v_item.invoiced_unit_cost;

        -- Threshold: > $0.01 absolute AND > 1% relative
        IF v_old_cost IS NULL
           OR (
             ABS(v_new_cost - v_old_cost) > 0.01
             AND (
               v_old_cost = 0
               OR (ABS(v_new_cost - v_old_cost) / ABS(v_old_cost)) * 100 > 1.0
             )
           )
        THEN
          UPDATE public.inventory_catalog_items
          SET
            default_unit_cost = v_new_cost,
            updated_at        = now()
          WHERE id = v_item.catalog_item_id;

          v_pct_diff := CASE
            WHEN v_old_cost IS NULL OR v_old_cost = 0 THEN NULL
            ELSE ROUND(((v_new_cost - v_old_cost) / ABS(v_old_cost)) * 100, 1)
          END;

          v_price_changes := v_price_changes || jsonb_build_object(
            'item_name',  v_item.item_name,
            'old_cost',   v_old_cost,
            'new_cost',   v_new_cost,
            'pct_change', v_pct_diff,
            'direction',  CASE WHEN v_new_cost > COALESCE(v_old_cost, 0) THEN 'up' ELSE 'down' END
          );

          IF v_new_cost > COALESCE(v_old_cost, 0) THEN
            v_price_increases := v_price_increases || jsonb_build_object(
              'item_name',  v_item.item_name,
              'old_cost',   v_old_cost,
              'new_cost',   v_new_cost,
              'pct_change', v_pct_diff
            );
          ELSE
            v_price_decreases := v_price_decreases || jsonb_build_object(
              'item_name',  v_item.item_name,
              'old_cost',   v_old_cost,
              'new_cost',   v_new_cost,
              'pct_change', v_pct_diff
            );
          END IF;
        END IF;
      END IF;

      v_results := v_results || jsonb_build_object(
        'item_name',          v_item.item_name,
        'quantity_confirmed', v_cases,
        'quantity_unit',      'case',
        'source_qty',         v_item.received_qty_raw,
        'source_unit',        v_item.source_unit,
        'status',             'confirmed'
      );
    END LOOP;

    -- ── Price-change notifications ────────────────────────────────────────
    IF jsonb_array_length(v_price_changes) > 0 THEN
      FOR v_member IN
        SELECT user_id FROM public.restaurant_members
        WHERE restaurant_id = p_restaurant_id
          AND role IN ('OWNER', 'MANAGER')
      LOOP
        IF jsonb_array_length(v_price_increases) > 0 THEN
          INSERT INTO public.notifications (
            restaurant_id, user_id, type, title, message, severity, data
          ) VALUES (
            p_restaurant_id,
            v_member.user_id,
            'PRICE_INCREASE',
            format('%s item price increase%s on latest invoice',
              jsonb_array_length(v_price_increases),
              CASE WHEN jsonb_array_length(v_price_increases) > 1 THEN 's' ELSE '' END),
            (SELECT string_agg(
              format('%s: $%s to $%s%s',
                item->>'item_name',
                COALESCE(ROUND((item->>'old_cost')::numeric, 2)::text, '?'),
                ROUND((item->>'new_cost')::numeric, 2),
                CASE WHEN item->>'pct_change' IS NOT NULL
                     THEN ' (+' || item->>'pct_change' || '%)' ELSE '' END),
              ', ' ORDER BY (item->>'item_name'))
             FROM jsonb_array_elements(v_price_increases) item),
            'WARNING',
            jsonb_build_object('invoice_id', p_invoice_id, 'items', v_price_increases)
          );
        END IF;

        IF jsonb_array_length(v_price_decreases) > 0 THEN
          INSERT INTO public.notifications (
            restaurant_id, user_id, type, title, message, severity, data
          ) VALUES (
            p_restaurant_id,
            v_member.user_id,
            'PRICE_DECREASE',
            format('%s item price decrease%s on latest invoice',
              jsonb_array_length(v_price_decreases),
              CASE WHEN jsonb_array_length(v_price_decreases) > 1 THEN 's' ELSE '' END),
            (SELECT string_agg(
              format('%s: $%s to $%s%s',
                item->>'item_name',
                COALESCE(ROUND((item->>'old_cost')::numeric, 2)::text, '?'),
                ROUND((item->>'new_cost')::numeric, 2),
                CASE WHEN item->>'pct_change' IS NOT NULL
                     THEN ' (' || item->>'pct_change' || '%)' ELSE '' END),
              ', ' ORDER BY (item->>'item_name'))
             FROM jsonb_array_elements(v_price_decreases) item),
            'INFO',
            jsonb_build_object('invoice_id', p_invoice_id, 'items', v_price_decreases)
          );
        END IF;
      END LOOP;
    END IF;

  ELSE
    -- Already confirmed — return current state
    FOR v_item IN
      SELECT ii.id, ii.item_name, ii.catalog_item_id,
             COALESCE(ilc.received_qty, ii.quantity_invoiced) AS received_qty_raw
      FROM public.invoice_items AS ii
      LEFT JOIN LATERAL (
        SELECT received_qty FROM public.invoice_line_comparisons
        WHERE invoice_item_id = ii.id AND invoice_id = p_invoice_id
        ORDER BY id ASC LIMIT 1
      ) AS ilc ON true
      WHERE ii.invoice_id = p_invoice_id
    LOOP
      IF v_item.catalog_item_id IS NULL THEN
        v_no_catalog_count := v_no_catalog_count + 1;
      ELSE
        v_confirmed_count := v_confirmed_count + 1;
      END IF;
      v_results := v_results || jsonb_build_object(
        'item_name',          v_item.item_name,
        'quantity_confirmed', v_item.received_qty_raw,
        'status', CASE WHEN v_item.catalog_item_id IS NULL THEN 'no_catalog_match' ELSE 'already_confirmed' END
      );
    END LOOP;
  END IF;

  RETURN jsonb_build_object(
    'success',                 true,
    'already_confirmed',       v_already_confirmed,
    'confirmed',               v_confirmed_count,
    'no_catalog',              v_no_catalog_count,
    'unit_conversion_failed',  v_conv_failed_count,
    'inventory_updated',       v_movements_count > 0,
    'stock_movements_created', v_movements_count,
    'price_changes',           v_price_changes,
    'confirmed_at',            v_confirmed_at,
    'message', CASE
      WHEN v_already_confirmed THEN 'Receipt was already confirmed.'
      WHEN v_conv_failed_count > 0 THEN
        format('Receipt confirmed. %s stock movement(s) recorded; %s item(s) skipped due to unit conversion failure.',
               v_movements_count, v_conv_failed_count)
      ELSE
        format('Receipt confirmed. %s stock movement(s) recorded (normalized to cases). %s catalog price(s) updated.',
               v_movements_count, jsonb_array_length(v_price_changes))
    END,
    'items', v_results
  );
END;
$$;

-- =============================================================================
-- SECTION 11: notify_delivery_issues — updated to use invoice_id dual-OR
--             (from 20260329120000 — live version only queries purchase_history_id)
-- =============================================================================

CREATE OR REPLACE FUNCTION public.notify_delivery_issues(
  p_purchase_history_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_restaurant_id   uuid;
  v_po_number       text;
  v_missing         bigint;
  v_partial         bigint;
  v_price           bigint;
  v_total           bigint;
  v_severity        text;
  v_title           text;
  v_message         text;
  v_data            jsonb;
  v_notified        integer := 0;
  v_member          RECORD;
  v_parts           text[];
BEGIN
  -- Resolve restaurant_id via invoices first (new path), then legacy
  SELECT inv.restaurant_id INTO v_restaurant_id
  FROM public.invoices inv WHERE inv.id = p_purchase_history_id;
  IF NOT FOUND THEN
    SELECT ph.restaurant_id INTO v_restaurant_id
    FROM public.purchase_history ph WHERE ph.id = p_purchase_history_id;
  END IF;
  IF v_restaurant_id IS NULL THEN
    RAISE EXCEPTION 'Document not found';
  END IF;
  IF NOT public.is_member_of(v_restaurant_id) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  -- Resolve PO number: invoices path first, then legacy
  v_po_number := '';
  SELECT COALESCE(po.po_number, '')
  INTO v_po_number
  FROM public.invoices inv
  LEFT JOIN public.purchase_orders po ON po.id = inv.purchase_order_id
  WHERE inv.id = p_purchase_history_id;
  IF NOT FOUND OR v_po_number = '' THEN
    SELECT COALESCE(ph.po_number, '') INTO v_po_number
    FROM public.purchase_history ph WHERE ph.id = p_purchase_history_id;
  END IF;

  -- Count issues (check both invoice_id and purchase_history_id columns)
  SELECT
    COUNT(*) FILTER (WHERE ilc.status = 'missing_from_invoice'),
    COUNT(*) FILTER (WHERE ilc.status = 'qty_mismatch' AND ilc.qty_diff < 0),
    COUNT(*) FILTER (WHERE ilc.status = 'price_mismatch' AND ABS(ilc.cost_diff) > 1.00),
    COUNT(*) FILTER (WHERE ilc.status = 'total_mismatch' AND ABS(ilc.total_diff) > 1.00)
  INTO v_missing, v_partial, v_price, v_total
  FROM public.invoice_line_comparisons ilc
  WHERE (ilc.invoice_id = p_purchase_history_id OR ilc.purchase_history_id = p_purchase_history_id)
    AND ilc.catalog_item_id IS NOT NULL;

  IF COALESCE(v_missing, 0) + COALESCE(v_partial, 0) + COALESCE(v_price, 0) + COALESCE(v_total, 0) = 0 THEN
    RETURN jsonb_build_object('notified', 0, 'reason', 'no_qualifying_issues');
  END IF;

  v_severity := CASE WHEN v_missing > 0 THEN 'CRITICAL' ELSE 'WARNING' END;
  v_parts := ARRAY[]::text[];
  IF v_missing > 0 THEN
    v_parts := array_append(v_parts, v_missing || ' missing item' || CASE WHEN v_missing > 1 THEN 's' ELSE '' END);
  END IF;
  IF v_partial > 0 THEN
    v_parts := array_append(v_parts, v_partial || ' partial delivery' || CASE WHEN v_partial > 1 THEN 's' ELSE '' END);
  END IF;
  IF v_price > 0 THEN
    v_parts := array_append(v_parts, v_price || ' price gap' || CASE WHEN v_price > 1 THEN 's' ELSE '' END);
  END IF;
  IF v_total > 0 THEN
    v_parts := array_append(v_parts, v_total || ' line-total gap' || CASE WHEN v_total > 1 THEN 's' ELSE '' END);
  END IF;

  v_title   := 'Delivery Issues Detected';
  v_message := array_to_string(v_parts, ', ')
    || CASE WHEN v_po_number IS NOT NULL AND v_po_number <> '' THEN ' on ' || v_po_number ELSE '' END
    || '. Review the invoice to resolve.';

  v_data := jsonb_build_object(
    'purchase_history_id',  p_purchase_history_id,
    'po_number',            v_po_number,
    'missing_count',        COALESCE(v_missing, 0),
    'partial_count',        COALESCE(v_partial, 0),
    'price_mismatch_count', COALESCE(v_price, 0),
    'total_mismatch_count', COALESCE(v_total, 0)
  );

  FOR v_member IN
    SELECT user_id FROM public.restaurant_members
    WHERE restaurant_id = v_restaurant_id
      AND role IN ('OWNER', 'MANAGER')
  LOOP
    INSERT INTO public.notifications (
      restaurant_id, location_id, user_id, type, title, message, severity, data
    ) VALUES (
      v_restaurant_id, NULL, v_member.user_id, 'DELIVERY_ISSUE',
      v_title, v_message, v_severity, v_data
    )
    ON CONFLICT DO NOTHING;
    v_notified := v_notified + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'notified',             v_notified,
    'missing_count',        COALESCE(v_missing, 0),
    'partial_count',        COALESCE(v_partial, 0),
    'price_mismatch_count', COALESCE(v_price, 0),
    'total_mismatch_count', COALESCE(v_total, 0)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.notify_delivery_issues(uuid) TO authenticated;

-- =============================================================================
-- SECTION 12: get_delivery_issue_pos — updated for dual-path (invoice + legacy)
--             (from 20260329120000)
-- =============================================================================

CREATE OR REPLACE FUNCTION public.get_delivery_issue_pos(
  p_restaurant_id uuid
)
RETURNS TABLE (
  purchase_history_id uuid,
  po_number           text,
  issue_count         bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_member_of(p_restaurant_id) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  RETURN QUERY
  SELECT x.purchase_history_id, x.po_number, x.issue_count
  FROM (
    -- New path: invoices table
    SELECT
      inv.id AS purchase_history_id,
      COALESCE(po.po_number, ''::text) AS po_number,
      COUNT(*)::bigint AS issue_count
    FROM public.invoices inv
    LEFT JOIN public.purchase_orders po ON po.id = inv.purchase_order_id
    JOIN public.invoice_line_comparisons ilc ON ilc.invoice_id = inv.id
    WHERE inv.restaurant_id = p_restaurant_id
      AND ilc.catalog_item_id IS NOT NULL
      AND COALESCE(inv.receipt_status, '') <> 'confirmed'
      AND inv.status <> 'confirmed'
      AND (
        ilc.status = 'missing_from_invoice'
        OR (ilc.status = 'qty_mismatch'   AND ilc.qty_diff < 0)
        OR (ilc.status = 'price_mismatch' AND ABS(ilc.cost_diff) > 1.00)
        OR (ilc.status = 'total_mismatch' AND ABS(ilc.total_diff) > 1.00)
      )
    GROUP BY inv.id, po.po_number

    UNION ALL

    -- Legacy path: purchase_history rows not yet migrated
    SELECT
      ph.id AS purchase_history_id,
      COALESCE(ph.po_number, ''::text) AS po_number,
      COUNT(*)::bigint AS issue_count
    FROM public.purchase_history ph
    JOIN public.invoice_line_comparisons ilc ON ilc.purchase_history_id = ph.id
    WHERE ph.restaurant_id = p_restaurant_id
      AND ilc.invoice_id IS NULL
      AND ilc.catalog_item_id IS NOT NULL
      AND COALESCE(ph.receipt_status, '') <> 'confirmed'
      AND (
        ilc.status = 'missing_from_invoice'
        OR (ilc.status = 'qty_mismatch'   AND ilc.qty_diff < 0)
        OR (ilc.status = 'price_mismatch' AND ABS(ilc.cost_diff) > 1.00)
        OR (ilc.status = 'total_mismatch' AND ABS(ilc.total_diff) > 1.00)
      )
    GROUP BY ph.id, ph.po_number
  ) x
  ORDER BY x.issue_count DESC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_delivery_issue_pos(uuid) TO authenticated;

-- =============================================================================
-- SECTION 13: RLS policies — purchase_orders (currently 0 policies, deny-all)
-- =============================================================================

DROP POLICY IF EXISTS "Members can view purchase orders"   ON public.purchase_orders;
DROP POLICY IF EXISTS "Manager+ can insert purchase orders" ON public.purchase_orders;
DROP POLICY IF EXISTS "Manager+ can update purchase orders" ON public.purchase_orders;
DROP POLICY IF EXISTS "Manager+ can delete purchase orders" ON public.purchase_orders;

CREATE POLICY "Members can view purchase orders"
  ON public.purchase_orders FOR SELECT TO authenticated
  USING (public.is_member_of(restaurant_id));

CREATE POLICY "Manager+ can insert purchase orders"
  ON public.purchase_orders FOR INSERT TO authenticated
  WITH CHECK (public.has_restaurant_role_any(restaurant_id, ARRAY['OWNER'::public.app_role, 'MANAGER'::public.app_role]));

CREATE POLICY "Manager+ can update purchase orders"
  ON public.purchase_orders FOR UPDATE TO authenticated
  USING  (public.has_restaurant_role_any(restaurant_id, ARRAY['OWNER'::public.app_role, 'MANAGER'::public.app_role]))
  WITH CHECK (public.has_restaurant_role_any(restaurant_id, ARRAY['OWNER'::public.app_role, 'MANAGER'::public.app_role]));

CREATE POLICY "Manager+ can delete purchase orders"
  ON public.purchase_orders FOR DELETE TO authenticated
  USING (public.has_restaurant_role_any(restaurant_id, ARRAY['OWNER'::public.app_role, 'MANAGER'::public.app_role]));

-- =============================================================================
-- SECTION 14: RLS policies — purchase_order_items (currently 0 policies)
-- =============================================================================

DROP POLICY IF EXISTS "Members can view purchase order items"    ON public.purchase_order_items;
DROP POLICY IF EXISTS "Manager+ can insert purchase order items" ON public.purchase_order_items;
DROP POLICY IF EXISTS "Manager+ can update purchase order items" ON public.purchase_order_items;
DROP POLICY IF EXISTS "Manager+ can delete purchase order items" ON public.purchase_order_items;

CREATE POLICY "Members can view purchase order items"
  ON public.purchase_order_items FOR SELECT TO authenticated
  USING (public.is_member_of(public.purchase_order_restaurant_id(purchase_order_id)));

CREATE POLICY "Manager+ can insert purchase order items"
  ON public.purchase_order_items FOR INSERT TO authenticated
  WITH CHECK (public.is_member_of(public.purchase_order_restaurant_id(purchase_order_id)));

CREATE POLICY "Manager+ can update purchase order items"
  ON public.purchase_order_items FOR UPDATE TO authenticated
  USING  (public.has_restaurant_role_any(public.purchase_order_restaurant_id(purchase_order_id), ARRAY['OWNER'::public.app_role, 'MANAGER'::public.app_role]))
  WITH CHECK (public.has_restaurant_role_any(public.purchase_order_restaurant_id(purchase_order_id), ARRAY['OWNER'::public.app_role, 'MANAGER'::public.app_role]));

CREATE POLICY "Manager+ can delete purchase order items"
  ON public.purchase_order_items FOR DELETE TO authenticated
  USING (public.has_restaurant_role_any(public.purchase_order_restaurant_id(purchase_order_id), ARRAY['OWNER'::public.app_role, 'MANAGER'::public.app_role]));

-- =============================================================================
-- SECTION 15: RLS policies — invoices (only SELECT exists; missing INSERT/UPDATE/DELETE)
-- =============================================================================

DROP POLICY IF EXISTS "Manager+ can insert invoices" ON public.invoices;
DROP POLICY IF EXISTS "Manager+ can update invoices" ON public.invoices;
DROP POLICY IF EXISTS "Manager+ can delete invoices" ON public.invoices;

CREATE POLICY "Manager+ can insert invoices"
  ON public.invoices FOR INSERT TO authenticated
  WITH CHECK (public.has_restaurant_role_any(restaurant_id, ARRAY['OWNER'::public.app_role, 'MANAGER'::public.app_role]));

CREATE POLICY "Manager+ can update invoices"
  ON public.invoices FOR UPDATE TO authenticated
  USING  (public.has_restaurant_role_any(restaurant_id, ARRAY['OWNER'::public.app_role, 'MANAGER'::public.app_role]))
  WITH CHECK (public.has_restaurant_role_any(restaurant_id, ARRAY['OWNER'::public.app_role, 'MANAGER'::public.app_role]));

CREATE POLICY "Manager+ can delete invoices"
  ON public.invoices FOR DELETE TO authenticated
  USING (public.has_restaurant_role_any(restaurant_id, ARRAY['OWNER'::public.app_role, 'MANAGER'::public.app_role]));

-- =============================================================================
-- SECTION 16: RLS policies — invoice_items (currently 0 policies, deny-all)
-- =============================================================================

DROP POLICY IF EXISTS "Members can view invoice items"    ON public.invoice_items;
DROP POLICY IF EXISTS "Manager+ can insert invoice items" ON public.invoice_items;
DROP POLICY IF EXISTS "Manager+ can update invoice items" ON public.invoice_items;
DROP POLICY IF EXISTS "Manager+ can delete invoice items" ON public.invoice_items;

CREATE POLICY "Members can view invoice items"
  ON public.invoice_items FOR SELECT TO authenticated
  USING (public.is_member_of(public.invoice_restaurant_id(invoice_id)));

CREATE POLICY "Manager+ can insert invoice items"
  ON public.invoice_items FOR INSERT TO authenticated
  WITH CHECK (public.is_member_of(public.invoice_restaurant_id(invoice_id)));

CREATE POLICY "Manager+ can update invoice items"
  ON public.invoice_items FOR UPDATE TO authenticated
  USING  (public.has_restaurant_role_any(public.invoice_restaurant_id(invoice_id), ARRAY['OWNER'::public.app_role, 'MANAGER'::public.app_role]))
  WITH CHECK (public.has_restaurant_role_any(public.invoice_restaurant_id(invoice_id), ARRAY['OWNER'::public.app_role, 'MANAGER'::public.app_role]));

CREATE POLICY "Manager+ can delete invoice items"
  ON public.invoice_items FOR DELETE TO authenticated
  USING (public.has_restaurant_role_any(public.invoice_restaurant_id(invoice_id), ARRAY['OWNER'::public.app_role, 'MANAGER'::public.app_role]));

-- =============================================================================
-- SECTION 17: RLS policies — invoice_line_comparisons + delivery_issues
--             Now that invoice_id column exists, replace the conditional policies
--             written in 20260506000001 / 20260506000002 with the full dual-OR versions.
-- =============================================================================

-- invoice_line_comparisons
DROP POLICY IF EXISTS "Members can view invoice line comparisons"   ON public.invoice_line_comparisons;
DROP POLICY IF EXISTS "Members can create invoice line comparisons" ON public.invoice_line_comparisons;
DROP POLICY IF EXISTS "Members can update invoice line comparisons" ON public.invoice_line_comparisons;
DROP POLICY IF EXISTS "Members can delete invoice line comparisons" ON public.invoice_line_comparisons;

CREATE POLICY "Members can view invoice line comparisons"
  ON public.invoice_line_comparisons FOR SELECT TO authenticated
  USING (
    (invoice_id IS NOT NULL AND public.is_member_of(public.invoice_restaurant_id(invoice_id)))
    OR (purchase_history_id IS NOT NULL AND public.is_member_of(public.purchase_history_restaurant_id(purchase_history_id)))
  );

CREATE POLICY "Members can create invoice line comparisons"
  ON public.invoice_line_comparisons FOR INSERT TO authenticated
  WITH CHECK (
    (invoice_id IS NOT NULL AND public.is_member_of(public.invoice_restaurant_id(invoice_id)))
    OR (purchase_history_id IS NOT NULL AND public.is_member_of(public.purchase_history_restaurant_id(purchase_history_id)))
  );

CREATE POLICY "Members can update invoice line comparisons"
  ON public.invoice_line_comparisons FOR UPDATE TO authenticated
  USING (
    (invoice_id IS NOT NULL AND public.is_member_of(public.invoice_restaurant_id(invoice_id)))
    OR (purchase_history_id IS NOT NULL AND public.is_member_of(public.purchase_history_restaurant_id(purchase_history_id)))
  )
  WITH CHECK (
    (invoice_id IS NOT NULL AND public.is_member_of(public.invoice_restaurant_id(invoice_id)))
    OR (purchase_history_id IS NOT NULL AND public.is_member_of(public.purchase_history_restaurant_id(purchase_history_id)))
  );

CREATE POLICY "Members can delete invoice line comparisons"
  ON public.invoice_line_comparisons FOR DELETE TO authenticated
  USING (
    (invoice_id IS NOT NULL AND public.is_member_of(public.invoice_restaurant_id(invoice_id)))
    OR (purchase_history_id IS NOT NULL AND public.is_member_of(public.purchase_history_restaurant_id(purchase_history_id)))
  );

-- delivery_issues
DROP POLICY IF EXISTS "Members can view delivery issues"   ON public.delivery_issues;
DROP POLICY IF EXISTS "Members can insert delivery issues" ON public.delivery_issues;
DROP POLICY IF EXISTS "Members can update delivery issues" ON public.delivery_issues;
DROP POLICY IF EXISTS "Members can delete delivery issues" ON public.delivery_issues;

CREATE POLICY "Members can view delivery issues"
  ON public.delivery_issues FOR SELECT TO authenticated
  USING (
    (invoice_id IS NOT NULL AND public.is_member_of(public.invoice_restaurant_id(invoice_id)))
    OR (purchase_history_id IS NOT NULL AND public.is_member_of(public.purchase_history_restaurant_id(purchase_history_id)))
  );

CREATE POLICY "Members can insert delivery issues"
  ON public.delivery_issues FOR INSERT TO authenticated
  WITH CHECK (
    (invoice_id IS NOT NULL AND public.is_member_of(public.invoice_restaurant_id(invoice_id)))
    OR (purchase_history_id IS NOT NULL AND public.is_member_of(public.purchase_history_restaurant_id(purchase_history_id)))
  );

CREATE POLICY "Members can update delivery issues"
  ON public.delivery_issues FOR UPDATE TO authenticated
  USING (
    (invoice_id IS NOT NULL AND public.is_member_of(public.invoice_restaurant_id(invoice_id)))
    OR (purchase_history_id IS NOT NULL AND public.is_member_of(public.purchase_history_restaurant_id(purchase_history_id)))
  )
  WITH CHECK (
    (invoice_id IS NOT NULL AND public.is_member_of(public.invoice_restaurant_id(invoice_id)))
    OR (purchase_history_id IS NOT NULL AND public.is_member_of(public.purchase_history_restaurant_id(purchase_history_id)))
  );

-- DELETE is Manager+ only
CREATE POLICY "Members can delete delivery issues"
  ON public.delivery_issues FOR DELETE TO authenticated
  USING (
    (invoice_id IS NOT NULL AND public.has_restaurant_role_any(public.invoice_restaurant_id(invoice_id), ARRAY['OWNER'::public.app_role, 'MANAGER'::public.app_role]))
    OR (purchase_history_id IS NOT NULL AND public.has_restaurant_role_any(public.purchase_history_restaurant_id(purchase_history_id), ARRAY['OWNER'::public.app_role, 'MANAGER'::public.app_role]))
  );

-- =============================================================================
-- Reload PostgREST schema cache
-- =============================================================================
NOTIFY pgrst, 'reload schema';
