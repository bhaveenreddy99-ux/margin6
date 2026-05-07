-- =============================================================================
-- Fix: invoice_line_comparisons RLS — safe on current and post-workflow schema
-- =============================================================================
--
-- Schema history
-- --------------
-- The table was created (20260305000001) with purchase_history_id NOT NULL.
-- Migration 20260329120000 was intended to:
--   • add invoice_id column (FK → invoices)
--   • make purchase_history_id nullable
--   • add CHECK (invoice_id IS NOT NULL OR purchase_history_id IS NOT NULL)
--   • recreate RLS policies to cover both FK paths
--
-- On the current production DB that migration was recorded under a different
-- name and its DDL did NOT run.  As a result:
--   • invoice_id column does not exist yet
--   • purchase_history_id is still NOT NULL
--   • existing policies already cover the purchase_history_id path correctly
--
-- This migration is therefore written conditionally:
--
--   BRANCH A (invoice_id column EXISTS):
--     Drop and replace all four policies using the SECURITY DEFINER helper
--     invoice_restaurant_id() for the invoice arm — eliminates the inline
--     correlated subquery that ran inside the invoices RLS context, preventing
--     any circular-RLS risk when the invoices policy changes.
--
--   BRANCH B (invoice_id column DOES NOT EXIST — current production state):
--     Ensure the four purchase_history_id-only policies are in place.
--     The existing policies already satisfy this condition, so on a DB that
--     has already had 20260306000002 applied this block is effectively a no-op.
--
-- When invoice_id is eventually added to the table, re-running this migration
-- (or running db push on the file) will automatically switch to Branch A.
-- =============================================================================

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE  table_schema = 'public'
    AND    table_name   = 'invoice_line_comparisons'
    AND    column_name  = 'invoice_id'
  ) THEN
    -- ── BRANCH A: invoice_id column exists ────────────────────────────────
    -- Use SECURITY DEFINER helpers for both FK arms to avoid inline subqueries
    -- that are subject to the caller's RLS context on invoices.
    -- Why purchase_history_id can be NULL:
    --   Invoice-first rows (created by email/EDI ingestion) have no matching
    --   purchase_history record; purchase_history_id IS NULL for those rows.
    --   The CHECK constraint guarantees at least one FK is always set.

    DROP POLICY IF EXISTS "Members can view invoice line comparisons"   ON public.invoice_line_comparisons;
    DROP POLICY IF EXISTS "Members can create invoice line comparisons" ON public.invoice_line_comparisons;
    DROP POLICY IF EXISTS "Members can update invoice line comparisons" ON public.invoice_line_comparisons;
    DROP POLICY IF EXISTS "Members can delete invoice line comparisons" ON public.invoice_line_comparisons;

    EXECUTE $p$
      CREATE POLICY "Members can view invoice line comparisons"
        ON public.invoice_line_comparisons FOR SELECT TO authenticated
        USING (
          (invoice_id IS NOT NULL
            AND public.is_member_of(public.invoice_restaurant_id(invoice_id)))
          OR
          (purchase_history_id IS NOT NULL
            AND public.is_member_of(public.purchase_history_restaurant_id(purchase_history_id)))
        )
    $p$;

    EXECUTE $p$
      CREATE POLICY "Members can create invoice line comparisons"
        ON public.invoice_line_comparisons FOR INSERT TO authenticated
        WITH CHECK (
          (invoice_id IS NOT NULL
            AND public.is_member_of(public.invoice_restaurant_id(invoice_id)))
          OR
          (purchase_history_id IS NOT NULL
            AND public.is_member_of(public.purchase_history_restaurant_id(purchase_history_id)))
        )
    $p$;

    EXECUTE $p$
      CREATE POLICY "Members can update invoice line comparisons"
        ON public.invoice_line_comparisons FOR UPDATE TO authenticated
        USING (
          (invoice_id IS NOT NULL
            AND public.is_member_of(public.invoice_restaurant_id(invoice_id)))
          OR
          (purchase_history_id IS NOT NULL
            AND public.is_member_of(public.purchase_history_restaurant_id(purchase_history_id)))
        )
        WITH CHECK (
          (invoice_id IS NOT NULL
            AND public.is_member_of(public.invoice_restaurant_id(invoice_id)))
          OR
          (purchase_history_id IS NOT NULL
            AND public.is_member_of(public.purchase_history_restaurant_id(purchase_history_id)))
        )
    $p$;

    EXECUTE $p$
      CREATE POLICY "Members can delete invoice line comparisons"
        ON public.invoice_line_comparisons FOR DELETE TO authenticated
        USING (
          (invoice_id IS NOT NULL
            AND public.is_member_of(public.invoice_restaurant_id(invoice_id)))
          OR
          (purchase_history_id IS NOT NULL
            AND public.is_member_of(public.purchase_history_restaurant_id(purchase_history_id)))
        )
    $p$;

  ELSE
    -- ── BRANCH B: invoice_id column does NOT exist yet (current production) ──
    -- Ensure all four per-command policies are in place using purchase_history_id.
    -- These match what 20260306000002_rls_core_inventory.sql created.
    -- This block is a no-op if those policies already exist with the correct
    -- definitions; it only creates any that are missing.

    DROP POLICY IF EXISTS "Members can view invoice line comparisons"   ON public.invoice_line_comparisons;
    DROP POLICY IF EXISTS "Members can create invoice line comparisons" ON public.invoice_line_comparisons;
    DROP POLICY IF EXISTS "Members can update invoice line comparisons" ON public.invoice_line_comparisons;
    DROP POLICY IF EXISTS "Members can delete invoice line comparisons" ON public.invoice_line_comparisons;

    CREATE POLICY "Members can view invoice line comparisons"
      ON public.invoice_line_comparisons FOR SELECT TO authenticated
      USING (public.is_member_of(public.purchase_history_restaurant_id(purchase_history_id)));

    CREATE POLICY "Members can create invoice line comparisons"
      ON public.invoice_line_comparisons FOR INSERT TO authenticated
      WITH CHECK (public.is_member_of(public.purchase_history_restaurant_id(purchase_history_id)));

    CREATE POLICY "Members can update invoice line comparisons"
      ON public.invoice_line_comparisons FOR UPDATE TO authenticated
      USING     (public.is_member_of(public.purchase_history_restaurant_id(purchase_history_id)))
      WITH CHECK (public.is_member_of(public.purchase_history_restaurant_id(purchase_history_id)));

    CREATE POLICY "Members can delete invoice line comparisons"
      ON public.invoice_line_comparisons FOR DELETE TO authenticated
      USING (public.is_member_of(public.purchase_history_restaurant_id(purchase_history_id)));

  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
