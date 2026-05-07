-- =============================================================================
-- Fix: delivery_issues RLS — adds missing policies + safe on current and
-- post-workflow schema
-- =============================================================================
--
-- Schema history
-- --------------
-- delivery_issues was created with purchase_history_id NOT NULL.
-- Migration 20260329120000 was intended to:
--   • add invoice_id column (FK → invoices)
--   • make purchase_history_id nullable
--   • add CHECK (invoice_id IS NOT NULL OR purchase_history_id IS NOT NULL)
--   • recreate all four RLS policies covering both FK paths
--
-- On the current production DB that migration's DDL did NOT run.  The live
-- schema has no invoice_id column and purchase_history_id remains NOT NULL.
--
-- IMMEDIATE BUG (current production):
-- After the policy-cleanup migrations (20260329115000, 20260329116000) ran,
-- delivery_issues ended up with ONLY an INSERT policy.  The SELECT, UPDATE,
-- and DELETE policies were dropped and never recreated.  This means:
--   • Any authenticated user querying delivery_issues gets 0 rows (RLS
--     implicitly denies without a SELECT policy).
--   • No row can be updated or deleted by anyone.
--
-- Why purchase_history_id can be NULL (future schema):
-- Invoice-first rows (created by email/EDI ingestion with no matching PO)
-- will have purchase_history_id = NULL once the workflow migration runs.
-- The CHECK constraint guarantees at least one FK is always set.
--
-- This migration is written conditionally:
--
--   BRANCH A (invoice_id EXISTS): full dual-OR policies using SECURITY
--     DEFINER helpers for both FK arms.
--
--   BRANCH B (invoice_id DOES NOT EXIST — current production): restore the
--     three missing policies plus harden INSERT, all using purchase_history_id.
--     DELETE is restricted to MANAGER/OWNER (audit trail protection).
-- =============================================================================

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE  table_schema = 'public'
    AND    table_name   = 'delivery_issues'
    AND    column_name  = 'invoice_id'
  ) THEN
    -- ── BRANCH A: invoice_id column exists ────────────────────────────────
    DROP POLICY IF EXISTS "Users can manage delivery_issues for their restaurant" ON public.delivery_issues;
    DROP POLICY IF EXISTS "Members can view delivery issues"    ON public.delivery_issues;
    DROP POLICY IF EXISTS "Members can create delivery issues"  ON public.delivery_issues;
    DROP POLICY IF EXISTS "Members can insert delivery issues"  ON public.delivery_issues;
    DROP POLICY IF EXISTS "Members can update delivery issues"  ON public.delivery_issues;
    DROP POLICY IF EXISTS "Members can delete delivery issues"  ON public.delivery_issues;

    -- Any member may view delivery issues for their restaurant (either FK path).
    EXECUTE $p$
      CREATE POLICY "Members can view delivery issues"
        ON public.delivery_issues FOR SELECT TO authenticated
        USING (
          (invoice_id IS NOT NULL
            AND public.is_member_of(public.invoice_restaurant_id(invoice_id)))
          OR
          (purchase_history_id IS NOT NULL
            AND public.is_member_of(public.purchase_history_restaurant_id(purchase_history_id)))
        )
    $p$;

    -- Any member may file a new delivery issue.
    EXECUTE $p$
      CREATE POLICY "Members can insert delivery issues"
        ON public.delivery_issues FOR INSERT TO authenticated
        WITH CHECK (
          (invoice_id IS NOT NULL
            AND public.is_member_of(public.invoice_restaurant_id(invoice_id)))
          OR
          (purchase_history_id IS NOT NULL
            AND public.is_member_of(public.purchase_history_restaurant_id(purchase_history_id)))
        )
    $p$;

    -- Any member may update delivery issues (e.g. add resolution notes).
    EXECUTE $p$
      CREATE POLICY "Members can update delivery issues"
        ON public.delivery_issues FOR UPDATE TO authenticated
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

    -- DELETE restricted to Manager/Owner: deleting a delivery issue removes
    -- an audit trail entry.
    EXECUTE $p$
      CREATE POLICY "Members can delete delivery issues"
        ON public.delivery_issues FOR DELETE TO authenticated
        USING (
          (invoice_id IS NOT NULL
            AND public.has_restaurant_role_any(
                  public.invoice_restaurant_id(invoice_id),
                  ARRAY['OWNER'::public.app_role, 'MANAGER'::public.app_role]))
          OR
          (purchase_history_id IS NOT NULL
            AND public.has_restaurant_role_any(
                  public.purchase_history_restaurant_id(purchase_history_id),
                  ARRAY['OWNER'::public.app_role, 'MANAGER'::public.app_role]))
        )
    $p$;

  ELSE
    -- ── BRANCH B: invoice_id column does NOT exist yet (current production) ──
    -- Restore SELECT, UPDATE, DELETE (which are entirely missing on production).
    -- Drop all variants first so the block is safe to replay.
    DROP POLICY IF EXISTS "Users can manage delivery_issues for their restaurant" ON public.delivery_issues;
    DROP POLICY IF EXISTS "Members can view delivery issues"    ON public.delivery_issues;
    DROP POLICY IF EXISTS "Members can create delivery issues"  ON public.delivery_issues;
    DROP POLICY IF EXISTS "Members can insert delivery issues"  ON public.delivery_issues;
    DROP POLICY IF EXISTS "Members can update delivery issues"  ON public.delivery_issues;
    DROP POLICY IF EXISTS "Members can delete delivery issues"  ON public.delivery_issues;

    -- SELECT: any member of the restaurant may read delivery issues.
    CREATE POLICY "Members can view delivery issues"
      ON public.delivery_issues FOR SELECT TO authenticated
      USING (public.is_member_of(public.purchase_history_restaurant_id(purchase_history_id)));

    -- INSERT: only members of the owning restaurant may file issues.
    CREATE POLICY "Members can insert delivery issues"
      ON public.delivery_issues FOR INSERT TO authenticated
      WITH CHECK (public.is_member_of(public.purchase_history_restaurant_id(purchase_history_id)));

    -- UPDATE: any member may update (e.g. resolve) an issue.
    -- WITH CHECK prevents moving a row to a different restaurant.
    CREATE POLICY "Members can update delivery issues"
      ON public.delivery_issues FOR UPDATE TO authenticated
      USING     (public.is_member_of(public.purchase_history_restaurant_id(purchase_history_id)))
      WITH CHECK (public.is_member_of(public.purchase_history_restaurant_id(purchase_history_id)));

    -- DELETE: Manager/Owner only — protects the audit trail.
    CREATE POLICY "Members can delete delivery issues"
      ON public.delivery_issues FOR DELETE TO authenticated
      USING (
        public.has_restaurant_role_any(
          public.purchase_history_restaurant_id(purchase_history_id),
          ARRAY['OWNER'::public.app_role, 'MANAGER'::public.app_role]
        )
      );

  END IF;
END $$;

-- ─── Indexes (idempotent) ─────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_delivery_issues_purchase_history_id
  ON public.delivery_issues (purchase_history_id);

-- idx_delivery_issues_invoice_id is created by 20260329120000 when invoice_id
-- is added. Guard it here so this migration stays safe to replay after that.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE  table_schema = 'public'
    AND    table_name   = 'delivery_issues'
    AND    column_name  = 'invoice_id'
  ) THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_delivery_issues_invoice_id
             ON public.delivery_issues (invoice_id)';
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
