


SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


CREATE SCHEMA IF NOT EXISTS "public";


ALTER SCHEMA "public" OWNER TO "pg_database_owner";


COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE TYPE "public"."app_role" AS ENUM (
    'OWNER',
    'MANAGER',
    'STAFF'
);


ALTER TYPE "public"."app_role" OWNER TO "postgres";


CREATE TYPE "public"."email_digest_mode" AS ENUM (
    'IMMEDIATE',
    'DAILY_DIGEST'
);


ALTER TYPE "public"."email_digest_mode" OWNER TO "postgres";


CREATE TYPE "public"."invitation_status" AS ENUM (
    'PENDING',
    'ACCEPTED',
    'EXPIRED',
    'REVOKED'
);


ALTER TYPE "public"."invitation_status" OWNER TO "postgres";


CREATE TYPE "public"."notification_severity" AS ENUM (
    'INFO',
    'WARNING',
    'CRITICAL'
);


ALTER TYPE "public"."notification_severity" OWNER TO "postgres";


CREATE TYPE "public"."order_status" AS ENUM (
    'PENDING',
    'PREP',
    'READY',
    'COMPLETED',
    'CANCELED'
);


ALTER TYPE "public"."order_status" OWNER TO "postgres";


CREATE TYPE "public"."recipients_mode" AS ENUM (
    'OWNERS_MANAGERS',
    'ALL',
    'CUSTOM'
);


ALTER TYPE "public"."recipients_mode" OWNER TO "postgres";


CREATE TYPE "public"."session_status" AS ENUM (
    'IN_PROGRESS',
    'IN_REVIEW',
    'APPROVED'
);


ALTER TYPE "public"."session_status" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."accept_pending_invitations"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  inv RECORD;
BEGIN
  FOR inv IN
    SELECT id, restaurant_id, role
    FROM public.invitations
    WHERE email = NEW.email
      AND status = 'PENDING'
      AND expires_at > now()
  LOOP
    -- Add user to restaurant
    INSERT INTO public.restaurant_members (restaurant_id, user_id, role)
    VALUES (inv.restaurant_id, NEW.id, inv.role)
    ON CONFLICT DO NOTHING;

    -- Mark invitation as accepted
    UPDATE public.invitations
    SET status = 'ACCEPTED', accepted_at = now()
    WHERE id = inv.id;
  END LOOP;

  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."accept_pending_invitations"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."accept_user_invites"() RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_email text;
  v_processed int := 0;
  r RECORD;
  v_existing_role public.app_role;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('processed', 0);
  END IF;

  SELECT lower(trim(u.email)) INTO v_email
  FROM auth.users u
  WHERE u.id = v_uid;

  IF v_email IS NULL OR length(v_email) = 0 THEN
    RETURN jsonb_build_object('processed', 0);
  END IF;

  FOR r IN
    SELECT ui.*
    FROM public.user_invites ui
    WHERE lower(trim(ui.email)) = v_email
      AND ui.status = 'PENDING'::public.invitation_status
  LOOP
    IF NOT EXISTS (
      SELECT 1
      FROM public.locations l
      WHERE l.id = r.location_id
        AND l.restaurant_id = r.restaurant_id
    ) THEN
      CONTINUE;
    END IF;

    SELECT rm.role INTO v_existing_role
    FROM public.restaurant_members rm
    WHERE rm.user_id = v_uid
      AND rm.restaurant_id = r.restaurant_id;

    IF FOUND AND v_existing_role = 'OWNER'::public.app_role THEN
      UPDATE public.user_invites
      SET status = 'ACCEPTED'::public.invitation_status,
          accepted_at = now()
      WHERE id = r.id;
      v_processed := v_processed + 1;
      CONTINUE;
    END IF;

    INSERT INTO public.restaurant_members (restaurant_id, user_id, role, default_location_id)
    VALUES (r.restaurant_id, v_uid, r.role, r.location_id)
    ON CONFLICT (user_id, restaurant_id) DO UPDATE
      SET role = EXCLUDED.role,
          default_location_id = COALESCE(EXCLUDED.default_location_id, restaurant_members.default_location_id);

    INSERT INTO public.user_location_assignments (
      user_id,
      location_id,
      role,
      is_primary,
      can_approve_orders,
      can_see_costs,
      can_see_food_cost_pct,
      can_see_inventory_value,
      can_edit_par,
      order_approval_threshold
    )
    VALUES (
      v_uid,
      r.location_id,
      r.role,
      true,
      r.can_approve_orders,
      r.can_see_costs,
      r.can_see_food_cost_pct,
      r.can_see_inventory_value,
      r.can_edit_par,
      r.order_approval_threshold
    )
    ON CONFLICT (user_id, location_id) DO UPDATE
      SET role = EXCLUDED.role,
          is_primary = true,
          can_approve_orders = EXCLUDED.can_approve_orders,
          can_see_costs = EXCLUDED.can_see_costs,
          can_see_food_cost_pct = EXCLUDED.can_see_food_cost_pct,
          can_see_inventory_value = EXCLUDED.can_see_inventory_value,
          can_edit_par = EXCLUDED.can_edit_par,
          order_approval_threshold = EXCLUDED.order_approval_threshold,
          updated_at = now();

    UPDATE public.user_invites
    SET status = 'ACCEPTED'::public.invitation_status,
        accepted_at = now()
    WHERE id = r.id;

    v_processed := v_processed + 1;
  END LOOP;

  RETURN jsonb_build_object('processed', v_processed);
END;
$$;


ALTER FUNCTION "public"."accept_user_invites"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."aggregate_daily_to_weekly"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
DECLARE
  target_date       DATE := COALESCE(NEW.sale_date, OLD.sale_date);
  week_monday       DATE := date_trunc('week', target_date)::DATE;
  target_location   UUID := COALESCE(NEW.location_id, OLD.location_id);
  target_restaurant UUID := COALESCE(NEW.restaurant_id, OLD.restaurant_id);
  existing_method   TEXT;
  agg               RECORD;
BEGIN
  SELECT entry_method INTO existing_method
  FROM public.weekly_sales
  WHERE location_id = target_location
    AND week_start = week_monday;

  -- Manual weekly entry wins; never overwrite it.
  IF existing_method = 'manual_weekly' THEN
    RETURN NULL;
  END IF;

  SELECT
    COUNT(*)                               AS cnt,
    COALESCE(SUM(gross_sales), 0)          AS gross,
    NULLIF(SUM(COALESCE(net_sales, 0)), 0) AS net,
    COALESCE(SUM(comps), 0)                AS comps,
    COALESCE(SUM(discounts), 0)            AS discounts,
    COALESCE(SUM(tax), 0)                  AS tax
  INTO agg
  FROM public.daily_sales
  WHERE location_id = target_location
    AND sale_date >= week_monday
    AND sale_date <  week_monday + INTERVAL '7 days';

  IF agg.cnt = 0 THEN
    -- Only delete rows the trigger created; never touch manual_weekly.
    DELETE FROM public.weekly_sales
    WHERE location_id = target_location
      AND week_start = week_monday
      AND entry_method = 'manual_daily_aggregated';
    RETURN NULL;
  END IF;

  INSERT INTO public.weekly_sales (
    restaurant_id, location_id, week_start,
    gross_sales, net_sales, comps, discounts, tax,
    entry_method, is_partial,
    entered_by_user_id, entered_at, updated_at
  ) VALUES (
    target_restaurant, target_location, week_monday,
    agg.gross, agg.net, agg.comps, agg.discounts, agg.tax,
    'manual_daily_aggregated', (agg.cnt < 7),
    COALESCE(NEW.entered_by_user_id, OLD.entered_by_user_id),
    NOW(), NOW()
  )
  ON CONFLICT (location_id, week_start) DO UPDATE SET
    gross_sales = EXCLUDED.gross_sales,
    net_sales   = EXCLUDED.net_sales,
    comps       = EXCLUDED.comps,
    discounts   = EXCLUDED.discounts,
    tax         = EXCLUDED.tax,
    is_partial  = EXCLUDED.is_partial,
    updated_at  = NOW()
  WHERE public.weekly_sales.entry_method = 'manual_daily_aggregated';

  RETURN NULL;
END;
$$;


ALTER FUNCTION "public"."aggregate_daily_to_weekly"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."alert_pref_restaurant_id"("pref_id" "uuid") RETURNS "uuid"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT restaurant_id FROM public.notification_preferences WHERE id = pref_id
$$;


ALTER FUNCTION "public"."alert_pref_restaurant_id"("pref_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."approve_inventory_session_atomic"("p_session_id" "uuid", "p_user_id" "uuid", "p_par_guide_id" "uuid" DEFAULT NULL::"uuid", "p_run_items" "jsonb" DEFAULT '[]'::"jsonb") RETURNS TABLE("run_id" "uuid", "location_id" "uuid", "catalog_links_stripped" boolean)
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $_$
DECLARE
  v_session                 public.inventory_sessions%rowtype;
  v_run_id                  uuid;
  v_existing_run_id         uuid;
  v_catalog_links_stripped  boolean := false;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  IF auth.uid() <> p_user_id THEN
    RAISE EXCEPTION 'Approved-by user mismatch';
  END IF;

  IF jsonb_typeof(coalesce(p_run_items, '[]'::jsonb)) <> 'array' THEN
    RAISE EXCEPTION 'Approval run items must be a JSON array';
  END IF;

  IF jsonb_array_length(coalesce(p_run_items, '[]'::jsonb)) = 0 THEN
    RAISE EXCEPTION 'Approval run items are required.';
  END IF;

  SELECT *
  INTO v_session
  FROM public.inventory_sessions
  WHERE id = p_session_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Session not found.';
  END IF;

  IF NOT public.has_restaurant_role_any(
    v_session.restaurant_id,
    ARRAY['OWNER'::public.app_role, 'MANAGER'::public.app_role]
  ) THEN
    RAISE EXCEPTION 'Inventory approval requires manager or owner access.';
  END IF;

  IF v_session.status <> 'IN_REVIEW' THEN
    IF v_session.status = 'APPROVED' THEN
      RAISE EXCEPTION 'Session is already approved.';
    END IF;
    RAISE EXCEPTION 'Only sessions in review can be approved.';
  END IF;

  SELECT sor.id
  INTO v_existing_run_id
  FROM public.smart_order_runs AS sor
  WHERE sor.session_id = p_session_id
  LIMIT 1;

  IF v_existing_run_id IS NOT NULL THEN
    RAISE EXCEPTION 'Session already has a downstream smart order run. Approval retry is blocked until that inconsistency is resolved.';
  END IF;

  INSERT INTO public.smart_order_runs (
    restaurant_id,
    session_id,
    inventory_list_id,
    location_id,
    par_guide_id,
    created_by
  )
  VALUES (
    v_session.restaurant_id,
    v_session.id,
    v_session.inventory_list_id,
    v_session.location_id,
    p_par_guide_id,
    p_user_id
  )
  RETURNING id INTO v_run_id;

  -- ── Compute catalog_links_stripped flag ─────────────────────────────────────
  WITH raw_items AS (
    SELECT
      item_name,
      suggested_order,
      risk,
      current_stock,
      par_level,
      unit_cost,
      pack_size,
      brand_name,
      nullif(btrim(catalog_item_id), '') AS raw_catalog_item_id
    FROM jsonb_to_recordset(p_run_items) AS item(
      item_name text,
      suggested_order numeric,
      risk text,
      current_stock numeric,
      par_level numeric,
      unit_cost numeric,
      pack_size text,
      brand_name text,
      catalog_item_id text
    )
  ),
  candidate_items AS (
    SELECT
      item_name,
      suggested_order,
      risk,
      current_stock,
      par_level,
      unit_cost,
      pack_size,
      brand_name,
      raw_catalog_item_id,
      CASE
        WHEN raw_catalog_item_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        THEN raw_catalog_item_id::uuid
        ELSE NULL
      END AS parsed_catalog_item_id
    FROM raw_items
  ),
  normalized_items AS (
    SELECT
      item_name,
      coalesce(suggested_order, 0) AS suggested_order,
      coalesce(nullif(risk, ''), 'GREEN') AS risk,
      coalesce(current_stock, 0) AS current_stock,
      coalesce(par_level, 0) AS par_level,
      unit_cost,
      pack_size,
      brand_name,
      CASE
        WHEN parsed_catalog_item_id IS NOT NULL
          AND EXISTS (
            SELECT 1
            FROM public.inventory_catalog_items AS ci
            WHERE ci.id = parsed_catalog_item_id
              AND ci.restaurant_id = v_session.restaurant_id
          )
        THEN parsed_catalog_item_id
        ELSE NULL
      END AS catalog_item_id,
      raw_catalog_item_id IS NOT NULL
        AND NOT (
          parsed_catalog_item_id IS NOT NULL
          AND EXISTS (
            SELECT 1
            FROM public.inventory_catalog_items AS ci
            WHERE ci.id = parsed_catalog_item_id
              AND ci.restaurant_id = v_session.restaurant_id
          )
        ) AS catalog_link_stripped
    FROM candidate_items
  )
  SELECT coalesce(bool_or(catalog_link_stripped), false)
  INTO v_catalog_links_stripped
  FROM normalized_items;

  -- ── Insert smart order run items ─────────────────────────────────────────────
  INSERT INTO public.smart_order_run_items (
    run_id,
    catalog_item_id,
    item_name,
    suggested_order,
    risk,
    current_stock,
    par_level,
    unit_cost,
    pack_size,
    brand_name
  )
  SELECT
    v_run_id,
    ni.catalog_item_id,
    ni.item_name,
    ni.suggested_order,
    ni.risk,
    ni.current_stock,
    ni.par_level,
    ni.unit_cost,
    ni.pack_size,
    ni.brand_name
  FROM (
    WITH raw_items AS (
      SELECT
        item_name,
        suggested_order,
        risk,
        current_stock,
        par_level,
        unit_cost,
        pack_size,
        brand_name,
        nullif(btrim(catalog_item_id), '') AS raw_catalog_item_id
      FROM jsonb_to_recordset(p_run_items) AS item(
        item_name text,
        suggested_order numeric,
        risk text,
        current_stock numeric,
        par_level numeric,
        unit_cost numeric,
        pack_size text,
        brand_name text,
        catalog_item_id text
      )
    ),
    candidate_items AS (
      SELECT
        item_name,
        suggested_order,
        risk,
        current_stock,
        par_level,
        unit_cost,
        pack_size,
        brand_name,
        raw_catalog_item_id,
        CASE
          WHEN raw_catalog_item_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
          THEN raw_catalog_item_id::uuid
          ELSE NULL
        END AS parsed_catalog_item_id
      FROM raw_items
    )
    SELECT
      item_name,
      coalesce(suggested_order, 0) AS suggested_order,
      coalesce(nullif(risk, ''), 'GREEN') AS risk,
      coalesce(current_stock, 0) AS current_stock,
      coalesce(par_level, 0) AS par_level,
      unit_cost,
      pack_size,
      brand_name,
      CASE
        WHEN parsed_catalog_item_id IS NOT NULL
          AND EXISTS (
            SELECT 1
            FROM public.inventory_catalog_items AS ci
            WHERE ci.id = parsed_catalog_item_id
              AND ci.restaurant_id = v_session.restaurant_id
          )
        THEN parsed_catalog_item_id
        ELSE NULL
      END AS catalog_item_id
    FROM candidate_items
  ) AS ni;

  -- ── Persist approved counts to catalog master ────────────────────────────────
  -- Reuse the already-validated smart_order_run_items rows so we don't re-parse
  -- the JSON or re-validate UUIDs. NULL catalog_item_id rows (unmatched items)
  -- are excluded by the WHERE clause — they remain tracked only in session items.
  UPDATE public.inventory_catalog_items ci
  SET
    current_stock = sori.current_stock,
    updated_at    = now()
  FROM public.smart_order_run_items sori
  WHERE sori.run_id          = v_run_id
    AND sori.catalog_item_id = ci.id
    AND sori.catalog_item_id IS NOT NULL;

  -- ── Mark session as approved ─────────────────────────────────────────────────
  UPDATE public.inventory_sessions
  SET
    status      = 'APPROVED',
    approved_at = now(),
    approved_by = p_user_id,
    updated_at  = now()
  WHERE id     = v_session.id
    AND status = 'IN_REVIEW';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Session approval failed due to concurrent state change.';
  END IF;

  RETURN QUERY
  SELECT
    v_run_id,
    v_session.location_id,
    v_catalog_links_stripped;
END;
$_$;


ALTER FUNCTION "public"."approve_inventory_session_atomic"("p_session_id" "uuid", "p_user_id" "uuid", "p_par_guide_id" "uuid", "p_run_items" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."confirm_invoice_receipt"("p_invoice_id" "uuid", "p_restaurant_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $_$
DECLARE
  v_item                RECORD;
  v_receipt_status      text;
  v_inv_status          text;
  v_confirmed_at        timestamptz;
  v_already_confirmed   boolean := false;
  v_confirmed_count     integer := 0;
  v_no_catalog_count    integer := 0;
  v_conv_failed_count   integer := 0;
  v_unconfirmed_count   integer := 0;
  v_movements_count     integer := 0;
  v_movement_this_item  integer := 0;
  v_results             jsonb   := '[]'::jsonb;
  v_price_changes       jsonb   := '[]'::jsonb;
  v_price_increases     jsonb   := '[]'::jsonb;
  v_price_decreases     jsonb   := '[]'::jsonb;
  v_cases               numeric;
  v_conv_ok             boolean;
  v_conv_reason         text;
  v_conv_status_str     text;
  v_old_cost            numeric;
  v_new_cost            numeric;
  v_pct_diff            numeric;
  v_member              RECORD;
BEGIN
  IF NOT public.is_member_of(p_restaurant_id) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  -- ── Gate: check for unconfirmed received quantities ──────────────────────
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

  -- ── Lock invoice header (prevents concurrent double-post) ─────────────────
  SELECT inv.receipt_status, inv.status
  INTO v_receipt_status, v_inv_status
  FROM public.invoices AS inv
  WHERE inv.id = p_invoice_id
    AND inv.restaurant_id = p_restaurant_id
  FOR UPDATE;

  IF NOT FOUND THEN
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
        ii.quantity_invoiced                                         AS billed_qty,
        CASE
          WHEN ii.total_cost IS NOT NULL AND ii.quantity_invoiced > 0
            THEN ii.total_cost / ii.quantity_invoiced
          ELSE ii.unit_cost
        END                                                          AS invoiced_unit_cost,
        CASE
          WHEN LOWER(COALESCE(ii.unit, 'cs')) IN ('lb', 'lbs', 'kg', 'kgs') THEN 'per_weight_suppressed'
          WHEN ii.total_cost IS NOT NULL AND ii.quantity_invoiced > 0        THEN 'per_case'
          ELSE                                                                    'unit_cost_fallback'
        END                                                          AS price_basis,
        LOWER(COALESCE(ii.unit, 'cs')) IN ('lb', 'lbs', 'kg', 'kgs') AS is_weight_unit,
        ii.catalog_item_id,
        COALESCE(ilc.received_qty, ii.quantity_invoiced)             AS received_qty_raw,
        COALESCE(ii.unit, 'CS')                                      AS source_unit,
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
      BEGIN

        IF v_item.catalog_item_id IS NULL THEN
          v_no_catalog_count := v_no_catalog_count + 1;
          v_results := v_results || jsonb_build_object(
            'item_name',          v_item.item_name,
            'quantity_confirmed', v_item.received_qty_raw,
            'status',             'no_catalog_match'
          );
          CONTINUE;
        END IF;

        -- ── Normalize received qty to CASES ──────────────────────────────
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

        -- ── Stock movement (idempotent via unique index) ──────────────────
        IF v_cases IS NOT NULL AND v_cases > 0 THEN
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
          )
          ON CONFLICT (invoice_item_id)
            WHERE movement_type = 'receive' AND invoice_item_id IS NOT NULL
          DO NOTHING;
          GET DIAGNOSTICS v_movement_this_item = ROW_COUNT;
          v_movements_count := v_movements_count + v_movement_this_item;

          -- ── Increment catalog running stock balance ───────────────────────
          -- Guard: only when the stock_movement was freshly inserted (not a
          -- conflict/skip), so a retried confirmation cannot double-count.
          IF v_movement_this_item > 0 THEN
            UPDATE public.inventory_catalog_items
            SET
              current_stock = COALESCE(current_stock, 0) + v_cases,
              updated_at    = now()
            WHERE id = v_item.catalog_item_id;
          END IF;
        END IF;

        -- ── Price sync ────────────────────────────────────────────────────
        IF v_item.is_weight_unit THEN
          CONTINUE;
        END IF;

        IF v_item.invoiced_unit_cost IS NOT NULL AND v_item.invoiced_unit_cost > 0 THEN
          SELECT default_unit_cost INTO v_old_cost
          FROM public.inventory_catalog_items
          WHERE id = v_item.catalog_item_id;

          v_new_cost := v_item.invoiced_unit_cost;

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
              'item_name',   v_item.item_name,
              'old_cost',    v_old_cost,
              'new_cost',    v_new_cost,
              'pct_change',  v_pct_diff,
              'price_basis', v_item.price_basis,
              'direction',   CASE WHEN v_new_cost > COALESCE(v_old_cost, 0) THEN 'up' ELSE 'down' END
            );

            IF v_new_cost > COALESCE(v_old_cost, 0) THEN
              v_price_increases := v_price_increases || jsonb_build_object(
                'item_name',   v_item.item_name,
                'old_cost',    v_old_cost,
                'new_cost',    v_new_cost,
                'pct_change',  v_pct_diff,
                'price_basis', v_item.price_basis
              );
            ELSE
              v_price_decreases := v_price_decreases || jsonb_build_object(
                'item_name',   v_item.item_name,
                'old_cost',    v_old_cost,
                'new_cost',    v_new_cost,
                'pct_change',  v_pct_diff,
                'price_basis', v_item.price_basis
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

      EXCEPTION WHEN OTHERS THEN
        RAISE EXCEPTION 'Item processing failed: %', SQLERRM
          USING DETAIL = jsonb_build_object(
            'invoice_id',      p_invoice_id,
            'invoice_item_id', v_item.id,
            'catalog_item_id', v_item.catalog_item_id,
            'item_name',       v_item.item_name,
            'sqlerrm',         SQLERRM
          )::text;
      END;
    END LOOP;

    -- ── Price-change notifications (idempotent) ───────────────────────────
    IF jsonb_array_length(v_price_changes) > 0 THEN
      FOR v_member IN
        SELECT user_id FROM public.restaurant_members
        WHERE restaurant_id = p_restaurant_id
          AND role IN ('OWNER', 'MANAGER')
      LOOP
        IF jsonb_array_length(v_price_increases) > 0 THEN
          INSERT INTO public.notifications (
            restaurant_id, user_id, type, title, message, severity, data, idempotency_key
          ) VALUES (
            p_restaurant_id,
            v_member.user_id,
            'PRICE_INCREASE',
            format('%s item price increase%s on latest invoice',
              jsonb_array_length(v_price_increases),
              CASE WHEN jsonb_array_length(v_price_increases) > 1 THEN 's' ELSE '' END),
            (SELECT string_agg(
              format('%s: $%s → $%s/case%s',
                item->>'item_name',
                COALESCE(ROUND((item->>'old_cost')::numeric, 2)::text, '?'),
                ROUND((item->>'new_cost')::numeric, 2),
                CASE WHEN item->>'pct_change' IS NOT NULL
                     THEN ' (+' || item->>'pct_change' || '%)' ELSE '' END),
              ', ' ORDER BY (item->>'item_name'))
             FROM jsonb_array_elements(v_price_increases) item),
            'WARNING'::notification_severity,
            jsonb_build_object('invoice_id', p_invoice_id, 'items', v_price_increases),
            p_invoice_id::text || '::' || v_member.user_id::text || '::PRICE_INCREASE'
          )
          ON CONFLICT (idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING;
        END IF;

        IF jsonb_array_length(v_price_decreases) > 0 THEN
          INSERT INTO public.notifications (
            restaurant_id, user_id, type, title, message, severity, data, idempotency_key
          ) VALUES (
            p_restaurant_id,
            v_member.user_id,
            'PRICE_DECREASE',
            format('%s item price decrease%s on latest invoice',
              jsonb_array_length(v_price_decreases),
              CASE WHEN jsonb_array_length(v_price_decreases) > 1 THEN 's' ELSE '' END),
            (SELECT string_agg(
              format('%s: $%s → $%s/case%s',
                item->>'item_name',
                COALESCE(ROUND((item->>'old_cost')::numeric, 2)::text, '?'),
                ROUND((item->>'new_cost')::numeric, 2),
                CASE WHEN item->>'pct_change' IS NOT NULL
                     THEN ' (' || item->>'pct_change' || '%)' ELSE '' END),
              ', ' ORDER BY (item->>'item_name'))
             FROM jsonb_array_elements(v_price_decreases) item),
            'INFO'::notification_severity,
            jsonb_build_object('invoice_id', p_invoice_id, 'items', v_price_decreases),
            p_invoice_id::text || '::' || v_member.user_id::text || '::PRICE_DECREASE'
          )
          ON CONFLICT (idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING;
        END IF;
      END LOOP;
    END IF;

  ELSE
    -- already_confirmed branch: summarise what exists
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
$_$;


ALTER FUNCTION "public"."confirm_invoice_receipt"("p_invoice_id" "uuid", "p_restaurant_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."confirm_invoice_receipt_legacy"("p_invoice_id" "uuid", "p_restaurant_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
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


ALTER FUNCTION "public"."confirm_invoice_receipt_legacy"("p_invoice_id" "uuid", "p_restaurant_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."create_default_notification_preferences"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  INSERT INTO public.notification_preferences (
    restaurant_id,
    user_id,
    location_id,
    channel_in_app,
    channel_email,
    email_digest_mode,
    digest_hour,
    timezone,
    low_stock_red,
    low_stock_yellow,
    invoice_parsed,
    price_change,
    stock_update
  ) VALUES (
    NEW.id,
    NULL,
    NULL,
    true,
    true,
    'IMMEDIATE',
    8,
    'America/Chicago',
    true,
    false,
    true,
    true,
    true
  )
  ON CONFLICT DO NOTHING;
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."create_default_notification_preferences"() OWNER TO "postgres";

SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."restaurants" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."restaurants" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."create_restaurant_with_owner"("p_name" "text", "p_is_demo" boolean DEFAULT false) RETURNS "public"."restaurants"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  new_restaurant public.restaurants;
  v_user_id uuid := auth.uid();
  v_inv_list_id uuid;
  v_inv_list_id2 uuid;
  v_par_guide_id uuid;
  v_par_guide_id2 uuid;
  v_par_guide_id3 uuid;
  v_par_guide_id4 uuid;
  v_session_id uuid;
  v_session_id2 uuid;
  v_order_id uuid;
  v_smart_run_id uuid;
  v_smart_run_id2 uuid;
  v_purchase_id uuid;
  v_purchase_id2 uuid;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  INSERT INTO public.restaurants (name) VALUES (p_name) RETURNING * INTO new_restaurant;
  INSERT INTO public.restaurant_members (restaurant_id, user_id, role) VALUES (new_restaurant.id, v_user_id, 'OWNER');

  IF p_is_demo THEN
    -- Inventory list 1: Main Kitchen
    INSERT INTO public.inventory_lists (restaurant_id, name, created_by)
    VALUES (new_restaurant.id, 'Main Kitchen', v_user_id)
    RETURNING id INTO v_inv_list_id;

    -- Inventory list 2: Bar
    INSERT INTO public.inventory_lists (restaurant_id, name, created_by)
    VALUES (new_restaurant.id, 'Bar', v_user_id)
    RETURNING id INTO v_inv_list_id2;

    -- Catalog items for Main Kitchen
    INSERT INTO public.inventory_catalog_items (restaurant_id, inventory_list_id, item_name, category, unit, default_par_level, default_unit_cost) VALUES
      (new_restaurant.id, v_inv_list_id, 'Chicken Breast', 'Cooler', 'lbs', 50, 4.50),
      (new_restaurant.id, v_inv_list_id, 'Ground Beef', 'Cooler', 'lbs', 40, 5.00),
      (new_restaurant.id, v_inv_list_id, 'French Fries', 'Frozen', 'bags', 30, 3.00),
      (new_restaurant.id, v_inv_list_id, 'Burger Buns', 'Dry', 'packs', 25, 2.00),
      (new_restaurant.id, v_inv_list_id, 'Lettuce', 'Cooler', 'heads', 20, 1.50),
      (new_restaurant.id, v_inv_list_id, 'Tomatoes', 'Cooler', 'lbs', 15, 2.00),
      (new_restaurant.id, v_inv_list_id, 'Cooking Oil', 'Dry', 'gallons', 10, 8.00),
      (new_restaurant.id, v_inv_list_id, 'Ice Cream', 'Frozen', 'tubs', 12, 6.00);

    -- Catalog items for Bar
    INSERT INTO public.inventory_catalog_items (restaurant_id, inventory_list_id, item_name, category, unit, default_par_level, default_unit_cost) VALUES
      (new_restaurant.id, v_inv_list_id2, 'Vodka', 'Dry', 'bottles', 10, 18.00),
      (new_restaurant.id, v_inv_list_id2, 'Rum', 'Dry', 'bottles', 8, 15.00),
      (new_restaurant.id, v_inv_list_id2, 'Orange Juice', 'Cooler', 'gallons', 6, 4.00),
      (new_restaurant.id, v_inv_list_id2, 'Lime', 'Cooler', 'bags', 5, 3.00),
      (new_restaurant.id, v_inv_list_id2, 'Ice', 'Frozen', 'bags', 20, 2.50);

    -- PAR guides for Main Kitchen (Weekday + Weekend)
    INSERT INTO public.par_guides (restaurant_id, inventory_list_id, name, created_by)
    VALUES (new_restaurant.id, v_inv_list_id, 'Weekday PAR', v_user_id)
    RETURNING id INTO v_par_guide_id;

    INSERT INTO public.par_guide_items (par_guide_id, item_name, category, unit, par_level) VALUES
      (v_par_guide_id, 'Chicken Breast', 'Cooler', 'lbs', 50),
      (v_par_guide_id, 'Ground Beef', 'Cooler', 'lbs', 40),
      (v_par_guide_id, 'French Fries', 'Frozen', 'bags', 30),
      (v_par_guide_id, 'Burger Buns', 'Dry', 'packs', 25),
      (v_par_guide_id, 'Lettuce', 'Cooler', 'heads', 20),
      (v_par_guide_id, 'Tomatoes', 'Cooler', 'lbs', 15),
      (v_par_guide_id, 'Cooking Oil', 'Dry', 'gallons', 10),
      (v_par_guide_id, 'Ice Cream', 'Frozen', 'tubs', 12);

    INSERT INTO public.par_guides (restaurant_id, inventory_list_id, name, created_by)
    VALUES (new_restaurant.id, v_inv_list_id, 'Weekend PAR', v_user_id)
    RETURNING id INTO v_par_guide_id2;

    INSERT INTO public.par_guide_items (par_guide_id, item_name, category, unit, par_level) VALUES
      (v_par_guide_id2, 'Chicken Breast', 'Cooler', 'lbs', 70),
      (v_par_guide_id2, 'Ground Beef', 'Cooler', 'lbs', 55),
      (v_par_guide_id2, 'French Fries', 'Frozen', 'bags', 45),
      (v_par_guide_id2, 'Burger Buns', 'Dry', 'packs', 35),
      (v_par_guide_id2, 'Lettuce', 'Cooler', 'heads', 30),
      (v_par_guide_id2, 'Tomatoes', 'Cooler', 'lbs', 20),
      (v_par_guide_id2, 'Cooking Oil', 'Dry', 'gallons', 15),
      (v_par_guide_id2, 'Ice Cream', 'Frozen', 'tubs', 18);

    -- PAR guides for Bar (Weekday + Weekend)
    INSERT INTO public.par_guides (restaurant_id, inventory_list_id, name, created_by)
    VALUES (new_restaurant.id, v_inv_list_id2, 'Bar Weekday', v_user_id)
    RETURNING id INTO v_par_guide_id3;

    INSERT INTO public.par_guide_items (par_guide_id, item_name, category, unit, par_level) VALUES
      (v_par_guide_id3, 'Vodka', 'Dry', 'bottles', 10),
      (v_par_guide_id3, 'Rum', 'Dry', 'bottles', 8),
      (v_par_guide_id3, 'Orange Juice', 'Cooler', 'gallons', 6),
      (v_par_guide_id3, 'Lime', 'Cooler', 'bags', 5),
      (v_par_guide_id3, 'Ice', 'Frozen', 'bags', 20);

    INSERT INTO public.par_guides (restaurant_id, inventory_list_id, name, created_by)
    VALUES (new_restaurant.id, v_inv_list_id2, 'Bar Weekend', v_user_id)
    RETURNING id INTO v_par_guide_id4;

    INSERT INTO public.par_guide_items (par_guide_id, item_name, category, unit, par_level) VALUES
      (v_par_guide_id4, 'Vodka', 'Dry', 'bottles', 15),
      (v_par_guide_id4, 'Rum', 'Dry', 'bottles', 12),
      (v_par_guide_id4, 'Orange Juice', 'Cooler', 'gallons', 10),
      (v_par_guide_id4, 'Lime', 'Cooler', 'bags', 8),
      (v_par_guide_id4, 'Ice', 'Frozen', 'bags', 30);

    -- Approved session for Main Kitchen
    INSERT INTO public.inventory_sessions (restaurant_id, inventory_list_id, name, status, created_by, approved_by, approved_at)
    VALUES (new_restaurant.id, v_inv_list_id, 'Opening Count', 'APPROVED', v_user_id, v_user_id, now())
    RETURNING id INTO v_session_id;

    INSERT INTO public.inventory_session_items (session_id, item_name, category, unit, current_stock, par_level, unit_cost) VALUES
      (v_session_id, 'Chicken Breast', 'Cooler', 'lbs', 20, 50, 4.50),
      (v_session_id, 'Ground Beef', 'Cooler', 'lbs', 35, 40, 5.00),
      (v_session_id, 'French Fries', 'Frozen', 'bags', 10, 30, 3.00),
      (v_session_id, 'Burger Buns', 'Dry', 'packs', 22, 25, 2.00),
      (v_session_id, 'Lettuce', 'Cooler', 'heads', 8, 20, 1.50),
      (v_session_id, 'Tomatoes', 'Cooler', 'lbs', 12, 15, 2.00),
      (v_session_id, 'Cooking Oil', 'Dry', 'gallons', 3, 10, 8.00),
      (v_session_id, 'Ice Cream', 'Frozen', 'tubs', 5, 12, 6.00);

    -- Approved session for Bar
    INSERT INTO public.inventory_sessions (restaurant_id, inventory_list_id, name, status, created_by, approved_by, approved_at)
    VALUES (new_restaurant.id, v_inv_list_id2, 'Bar Opening', 'APPROVED', v_user_id, v_user_id, now())
    RETURNING id INTO v_session_id2;

    INSERT INTO public.inventory_session_items (session_id, item_name, category, unit, current_stock, par_level, unit_cost) VALUES
      (v_session_id2, 'Vodka', 'Dry', 'bottles', 4, 10, 18.00),
      (v_session_id2, 'Rum', 'Dry', 'bottles', 6, 8, 15.00),
      (v_session_id2, 'Orange Juice', 'Cooler', 'gallons', 2, 6, 4.00),
      (v_session_id2, 'Lime', 'Cooler', 'bags', 3, 5, 3.00),
      (v_session_id2, 'Ice', 'Frozen', 'bags', 8, 20, 2.50);

    -- Smart order run for Main Kitchen
    INSERT INTO public.smart_order_runs (restaurant_id, session_id, inventory_list_id, par_guide_id, created_by)
    VALUES (new_restaurant.id, v_session_id, v_inv_list_id, v_par_guide_id, v_user_id)
    RETURNING id INTO v_smart_run_id;

    INSERT INTO public.smart_order_run_items (run_id, item_name, suggested_order, risk, current_stock, par_level, unit_cost) VALUES
      (v_smart_run_id, 'Chicken Breast', 30, 'RED', 20, 50, 4.50),
      (v_smart_run_id, 'Ground Beef', 5, 'YELLOW', 35, 40, 5.00),
      (v_smart_run_id, 'French Fries', 20, 'RED', 10, 30, 3.00),
      (v_smart_run_id, 'Burger Buns', 3, 'YELLOW', 22, 25, 2.00),
      (v_smart_run_id, 'Lettuce', 12, 'RED', 8, 20, 1.50),
      (v_smart_run_id, 'Tomatoes', 3, 'YELLOW', 12, 15, 2.00),
      (v_smart_run_id, 'Cooking Oil', 7, 'RED', 3, 10, 8.00),
      (v_smart_run_id, 'Ice Cream', 7, 'RED', 5, 12, 6.00);

    -- Purchase history from Main Kitchen smart order
    INSERT INTO public.purchase_history (restaurant_id, inventory_list_id, smart_order_run_id, created_by)
    VALUES (new_restaurant.id, v_inv_list_id, v_smart_run_id, v_user_id)
    RETURNING id INTO v_purchase_id;

    INSERT INTO public.purchase_history_items (purchase_history_id, item_name, quantity, unit_cost, total_cost) VALUES
      (v_purchase_id, 'Chicken Breast', 30, 4.50, 135.00),
      (v_purchase_id, 'Ground Beef', 5, 5.00, 25.00),
      (v_purchase_id, 'French Fries', 20, 3.00, 60.00),
      (v_purchase_id, 'Burger Buns', 3, 2.00, 6.00),
      (v_purchase_id, 'Lettuce', 12, 1.50, 18.00),
      (v_purchase_id, 'Tomatoes', 3, 2.00, 6.00),
      (v_purchase_id, 'Cooking Oil', 7, 8.00, 56.00),
      (v_purchase_id, 'Ice Cream', 7, 6.00, 42.00);

    -- Smart order run for Bar
    INSERT INTO public.smart_order_runs (restaurant_id, session_id, inventory_list_id, par_guide_id, created_by)
    VALUES (new_restaurant.id, v_session_id2, v_inv_list_id2, v_par_guide_id3, v_user_id)
    RETURNING id INTO v_smart_run_id2;

    INSERT INTO public.smart_order_run_items (run_id, item_name, suggested_order, risk, current_stock, par_level, unit_cost) VALUES
      (v_smart_run_id2, 'Vodka', 6, 'RED', 4, 10, 18.00),
      (v_smart_run_id2, 'Rum', 2, 'YELLOW', 6, 8, 15.00),
      (v_smart_run_id2, 'Orange Juice', 4, 'RED', 2, 6, 4.00),
      (v_smart_run_id2, 'Lime', 2, 'YELLOW', 3, 5, 3.00),
      (v_smart_run_id2, 'Ice', 12, 'RED', 8, 20, 2.50);

    -- Purchase history from Bar smart order
    INSERT INTO public.purchase_history (restaurant_id, inventory_list_id, smart_order_run_id, created_by)
    VALUES (new_restaurant.id, v_inv_list_id2, v_smart_run_id2, v_user_id)
    RETURNING id INTO v_purchase_id2;

    INSERT INTO public.purchase_history_items (purchase_history_id, item_name, quantity, unit_cost, total_cost) VALUES
      (v_purchase_id2, 'Vodka', 6, 18.00, 108.00),
      (v_purchase_id2, 'Rum', 2, 15.00, 30.00),
      (v_purchase_id2, 'Orange Juice', 4, 4.00, 16.00),
      (v_purchase_id2, 'Lime', 2, 3.00, 6.00),
      (v_purchase_id2, 'Ice', 12, 2.50, 30.00);

    -- Order
    INSERT INTO public.orders (restaurant_id, created_by, status)
    VALUES (new_restaurant.id, v_user_id, 'COMPLETED')
    RETURNING id INTO v_order_id;

    INSERT INTO public.order_items (order_id, item_name, quantity, unit) VALUES
      (v_order_id, 'Chicken Breast', 10, 'lbs'),
      (v_order_id, 'French Fries', 5, 'bags'),
      (v_order_id, 'Lettuce', 4, 'heads');

    -- Usage events
    INSERT INTO public.usage_events (restaurant_id, item_name, order_id, quantity_used) VALUES
      (new_restaurant.id, 'Chicken Breast', v_order_id, 10),
      (new_restaurant.id, 'French Fries', v_order_id, 5),
      (new_restaurant.id, 'Lettuce', v_order_id, 4);
    INSERT INTO public.usage_events (restaurant_id, item_name, quantity_used) VALUES
      (new_restaurant.id, 'Ground Beef', 8),
      (new_restaurant.id, 'Tomatoes', 3),
      (new_restaurant.id, 'Cooking Oil', 2);
  END IF;

  RETURN new_restaurant;
END;
$$;


ALTER FUNCTION "public"."create_restaurant_with_owner"("p_name" "text", "p_is_demo" boolean) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."custom_list_restaurant_id"("cl_id" "uuid") RETURNS "uuid"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT restaurant_id FROM public.custom_lists WHERE id = cl_id
$$;


ALTER FUNCTION "public"."custom_list_restaurant_id"("cl_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."delete_inventory_list"("list_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $_$
declare
  v_list_id    uuid := $1;
  session_ids  uuid[];
  run_ids      uuid[];
  po_ids       uuid[];
  invoice_ids  uuid[];
  purchase_ids uuid[];
  guide_ids    uuid[];
begin
  -- Category metadata
  delete from list_item_category_map
    where list_item_category_map.list_id = v_list_id;
  delete from list_categories
    where list_categories.list_id = v_list_id;
  delete from list_category_sets
    where list_category_sets.list_id = v_list_id;

  -- Catalog / import artefacts
  delete from inventory_catalog_items
    where inventory_catalog_items.inventory_list_id = v_list_id;
  delete from inventory_import_files
    where inventory_import_files.inventory_list_id = v_list_id;
  delete from import_runs
    where import_runs.inventory_list_id = v_list_id;
  delete from import_templates
    where import_templates.inventory_list_id = v_list_id;

  -- Sessions and their children
  select array_agg(inventory_sessions.id) into session_ids
    from inventory_sessions
   where inventory_sessions.inventory_list_id = v_list_id;

  if session_ids is not null then
    delete from inventory_session_items
      where inventory_session_items.session_id = any(session_ids);

    select array_agg(smart_order_runs.id) into run_ids
      from smart_order_runs
     where smart_order_runs.session_id = any(session_ids);

    if run_ids is not null then
      delete from smart_order_run_items
        where smart_order_run_items.run_id = any(run_ids);

      select array_agg(purchase_orders.id) into po_ids
        from purchase_orders
       where purchase_orders.smart_order_run_id = any(run_ids);

      if po_ids is not null then
        select array_agg(invoices.id) into invoice_ids
          from invoices
         where invoices.purchase_order_id = any(po_ids);

        if invoice_ids is not null then
          delete from invoice_items
            where invoice_items.invoice_id = any(invoice_ids);
          delete from invoices
            where invoices.id = any(invoice_ids);
        end if;

        delete from purchase_order_items
          where purchase_order_items.purchase_order_id = any(po_ids);
        delete from purchase_orders
          where purchase_orders.id = any(po_ids);
      end if;

      select array_agg(purchase_history.id) into purchase_ids
        from purchase_history
       where purchase_history.smart_order_run_id = any(run_ids);

      if purchase_ids is not null then
        delete from purchase_history_items
          where purchase_history_items.purchase_history_id = any(purchase_ids);
        delete from purchase_history
          where purchase_history.id = any(purchase_ids);
      end if;

      delete from smart_order_runs
        where smart_order_runs.id = any(run_ids);
    end if;

    delete from inventory_sessions
      where inventory_sessions.inventory_list_id = v_list_id;
  end if;

  -- List-level smart order runs (not linked to a session)
  select array_agg(smart_order_runs.id) into run_ids
    from smart_order_runs
   where smart_order_runs.inventory_list_id = v_list_id;

  if run_ids is not null then
    delete from smart_order_run_items
      where smart_order_run_items.run_id = any(run_ids);

    select array_agg(purchase_orders.id) into po_ids
      from purchase_orders
     where purchase_orders.smart_order_run_id = any(run_ids);

    if po_ids is not null then
      select array_agg(invoices.id) into invoice_ids
        from invoices
       where invoices.purchase_order_id = any(po_ids);

      if invoice_ids is not null then
        delete from invoice_items
          where invoice_items.invoice_id = any(invoice_ids);
        delete from invoices
          where invoices.id = any(invoice_ids);
      end if;

      delete from purchase_order_items
        where purchase_order_items.purchase_order_id = any(po_ids);
      delete from purchase_orders
        where purchase_orders.id = any(po_ids);
    end if;

    select array_agg(purchase_history.id) into purchase_ids
      from purchase_history
     where purchase_history.smart_order_run_id = any(run_ids);

    if purchase_ids is not null then
      delete from purchase_history_items
        where purchase_history_items.purchase_history_id = any(purchase_ids);
      delete from purchase_history
          where purchase_history.id = any(purchase_ids);
    end if;

    delete from smart_order_runs
      where smart_order_runs.id = any(run_ids);
  end if;

  -- Purchase history directly linked to the list
  -- (purchase_history.inventory_list_id exists; purchase_orders.inventory_list_id does not)
  select array_agg(purchase_history.id) into purchase_ids
    from purchase_history
   where purchase_history.inventory_list_id = v_list_id;

  if purchase_ids is not null then
    delete from purchase_history_items
      where purchase_history_items.purchase_history_id = any(purchase_ids);
    delete from purchase_history
      where purchase_history.id = any(purchase_ids);
  end if;

  -- PAR guides and items
  select array_agg(par_guides.id) into guide_ids
    from par_guides
   where par_guides.inventory_list_id = v_list_id;

  if guide_ids is not null then
    delete from par_guide_items
      where par_guide_items.par_guide_id = any(guide_ids);
    delete from par_guides
      where par_guides.id = any(guide_ids);
  end if;

  -- Finally delete the list itself (FK CASCADE handles any remaining children)
  delete from inventory_lists
    where inventory_lists.id = v_list_id;
end;
$_$;


ALTER FUNCTION "public"."delete_inventory_list"("list_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."delete_restaurant_cascade"("p_restaurant_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_user_id uuid := auth.uid();
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.restaurant_members
    WHERE restaurant_id = p_restaurant_id
      AND user_id = v_user_id
      AND role = 'OWNER'
  ) THEN
    RAISE EXCEPTION 'Only the restaurant owner can delete a restaurant';
  END IF;

  -- Direct restaurant children without ON DELETE CASCADE must be removed first.
  DELETE FROM public.vendor_integrations
  WHERE restaurant_id = p_restaurant_id;

  DELETE FROM public.purchase_history
  WHERE restaurant_id = p_restaurant_id;

  DELETE FROM public.import_runs
  WHERE restaurant_id = p_restaurant_id;

  DELETE FROM public.import_templates
  WHERE restaurant_id = p_restaurant_id;

  DELETE FROM public.inventory_import_files
  WHERE restaurant_id = p_restaurant_id;

  DELETE FROM public.inventory_catalog_items
  WHERE restaurant_id = p_restaurant_id;

  -- The restaurant delete now safely cascades through the remaining graph
  -- (members, lists, sessions, smart-order runs, orders, settings, etc.).
  DELETE FROM public.restaurants
  WHERE id = p_restaurant_id;
END;
$$;


ALTER FUNCTION "public"."delete_restaurant_cascade"("p_restaurant_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."generate_po_number"("p_restaurant_id" "uuid") RETURNS "text"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_seq bigint;
BEGIN
  INSERT INTO public.restaurant_counters (restaurant_id, po_sequence)
  VALUES (p_restaurant_id, 1)
  ON CONFLICT (restaurant_id)
  DO UPDATE SET po_sequence = restaurant_counters.po_sequence + 1
  RETURNING po_sequence INTO v_seq;

  RETURN 'PO-' || to_char(now(), 'YYYYMMDD') || '-' || lpad(v_seq::text, 4, '0');
END;
$$;


ALTER FUNCTION "public"."generate_po_number"("p_restaurant_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_delivery_issue_pos"("p_restaurant_id" "uuid") RETURNS TABLE("purchase_history_id" "uuid", "po_number" "text", "issue_count" bigint)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
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


ALTER FUNCTION "public"."get_delivery_issue_pos"("p_restaurant_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_invoice_stock_audit"("p_invoice_id" "uuid") RETURNS TABLE("invoice_item_id" "uuid", "item_name" "text", "catalog_item_id" "uuid", "catalog_item_name" "text", "quantity_invoiced" numeric, "received_qty_used" numeric, "invoice_unit" "text", "pack_size" "text", "is_catch_weight" boolean, "total_cost" numeric, "unit_cost" numeric, "catalog_stock_unit" "text", "conversion_formula" "text", "conv_status" "text", "expected_stock_qty" numeric, "actual_stock_qty" numeric, "qty_difference" numeric, "price_basis" "text", "status" "text", "issue_reason" "text")
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_restaurant_id uuid;
BEGIN
  -- Authorization: invoice may live in invoices or purchase_history
  SELECT restaurant_id INTO v_restaurant_id FROM public.invoices WHERE id = p_invoice_id;
  IF NOT FOUND THEN
    SELECT restaurant_id INTO v_restaurant_id FROM public.purchase_history WHERE id = p_invoice_id;
  END IF;
  IF v_restaurant_id IS NULL THEN
    RAISE EXCEPTION 'Invoice not found';
  END IF;
  IF NOT public.is_member_of(v_restaurant_id) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  RETURN QUERY
  SELECT
    ii.id                                                           AS invoice_item_id,
    ii.item_name                                                    AS item_name,
    ii.catalog_item_id                                              AS catalog_item_id,
    cat.item_name                                                   AS catalog_item_name,
    ii.quantity_invoiced                                            AS quantity_invoiced,
    COALESCE(ilc.received_qty, ii.quantity_invoiced)                AS received_qty_used,
    COALESCE(ii.unit, 'CS')                                         AS invoice_unit,
    COALESCE(ii.pack_size, cat.pack_size)                           AS pack_size,
    LOWER(COALESCE(ii.unit, 'cs')) = ANY('{lb,lbs,kg,kgs}'::text[]) AS is_catch_weight,
    ii.total_cost                                                   AS total_cost,
    ii.unit_cost                                                    AS unit_cost,
    COALESCE(cat.unit, 'case')                                      AS catalog_stock_unit,

    -- Human-readable formula string mirroring what normalize_received_qty_to_cases does
    CASE
      WHEN norm.ok IS NULL OR norm.ok = false THEN NULL
      WHEN norm.conv_status = 'passthrough_case' THEN
        COALESCE(ilc.received_qty, ii.quantity_invoiced)::text
          || ' ' || COALESCE(ii.unit, 'CS') || ' (already in cases — passthrough)'
      WHEN norm.conv_status = 'converted_to_case' THEN
        COALESCE(ilc.received_qty, ii.quantity_invoiced)::text
          || ' ' || COALESCE(ii.unit, 'CS')
          || ' ÷ '
          || CASE
               WHEN LOWER(COALESCE(ii.unit, 'cs')) IN ('oz', 'ounce', 'ounces')
                 THEN '16 oz/lb × ' || COALESCE(cat.total_per_case, (
                   SELECT (m[1]::numeric * m[2]::numeric)
                   FROM regexp_match(COALESCE(ii.pack_size, cat.pack_size), '(\d+(?:\.\d+)?)\s*/\s*(\d+(?:\.\d+)?)') m
                 ))::text || ' lb/case'
               ELSE COALESCE(
                 CASE
                   WHEN LOWER(COALESCE(ii.unit, 'cs')) IN ('lb','lbs','pound','pounds')
                     THEN COALESCE(cat.total_per_case::text, 'total_per_case from pack_size')
                   ELSE COALESCE(cat.units_per_case::text, 'units_per_case from pack_size')
                 END,
                 'pack_size: ' || COALESCE(ii.pack_size, cat.pack_size, '?')
               )
             END
          || ' = ' || ROUND(norm.cases, 4)::text || ' cases'
          || CASE WHEN COALESCE(ii.pack_size, cat.pack_size) IS NOT NULL
               THEN ' (pack: ' || COALESCE(ii.pack_size, cat.pack_size) || ')'
               ELSE '' END
      ELSE norm.conv_status
    END::text                                                       AS conversion_formula,

    norm.conv_status                                                AS conv_status,

    -- What confirm_invoice_receipt would have written
    CASE
      WHEN norm.ok IS NULL OR norm.ok = false THEN NULL
      ELSE norm.cases
    END                                                             AS expected_stock_qty,

    sm.quantity                                                     AS actual_stock_qty,

    CASE
      WHEN norm.ok IS NULL OR norm.ok = false THEN NULL
      WHEN sm.quantity IS NULL THEN NULL
      ELSE ROUND(sm.quantity - norm.cases, 4)
    END                                                             AS qty_difference,

    -- Price basis used when syncing catalog default_unit_cost
    CASE
      WHEN LOWER(COALESCE(ii.unit, 'cs')) = ANY('{lb,lbs,kg,kgs}'::text[])
        THEN 'per_weight_suppressed'
      WHEN ii.total_cost IS NOT NULL AND COALESCE(ii.quantity_invoiced, 0) > 0
        THEN 'per_case'
      ELSE 'unit_cost_fallback'
    END                                                             AS price_basis,

    -- Primary status (most severe issue wins)
    CASE
      WHEN ii.catalog_item_id IS NULL
        THEN 'NO_CATALOG_MATCH'
      WHEN norm.ok IS NULL OR norm.ok = false
        THEN 'CONVERSION_FAILED'
      WHEN COALESCE(norm.cases, 0) <= 0
        THEN 'NO_STOCK_MOVEMENT'
      WHEN sm.quantity IS NULL
        THEN 'NO_STOCK_MOVEMENT'
      WHEN ABS(sm.quantity - norm.cases) > 0.01
        THEN 'QTY_MISMATCH'
      WHEN LOWER(COALESCE(ii.unit, 'cs')) = ANY('{lb,lbs,kg,kgs}'::text[])
        THEN 'PRICE_BASIS_MISMATCH'
      ELSE 'OK'
    END                                                             AS status,

    -- Plain-English explanation for anything that isn't OK
    CASE
      WHEN ii.catalog_item_id IS NULL
        THEN 'Invoice line not matched to a catalog item — go to List Management to link it, then re-post'
      WHEN norm.ok IS NULL OR norm.ok = false
        THEN COALESCE(norm.reason, 'Unit conversion failed — check pack_size and unit on the catalog item')
      WHEN COALESCE(norm.cases, 0) <= 0
        THEN 'Received quantity is zero — no stock movement expected'
      WHEN sm.quantity IS NULL
        THEN 'No stock movement recorded — the confirm function may have skipped this line (check conversion_failed count on the receipt result)'
      WHEN ABS(sm.quantity - norm.cases) > 0.01
        THEN 'Expected ' || ROUND(norm.cases, 4)::text
             || ' cases, recorded ' || ROUND(sm.quantity, 4)::text
             || ' (Δ ' || ROUND(sm.quantity - norm.cases, 4)::text || ')'
      WHEN LOWER(COALESCE(ii.unit, 'cs')) = ANY('{lb,lbs,kg,kgs}'::text[])
        THEN 'Catch-weight item — stock movement OK, price sync suppressed (per-lb invoice unit cannot be compared to per-case catalog price; catalog price was not updated for this line)'
      ELSE NULL
    END                                                             AS issue_reason

  FROM public.invoice_items ii

  -- Prefer manager-entered received_qty from ILC (same logic as confirm_invoice_receipt)
  LEFT JOIN LATERAL (
    SELECT received_qty
    FROM public.invoice_line_comparisons
    WHERE invoice_item_id = ii.id
      AND invoice_id = p_invoice_id
    ORDER BY id ASC
    LIMIT 1
  ) ilc ON true

  LEFT JOIN public.inventory_catalog_items cat
    ON cat.id = ii.catalog_item_id

  -- Run the same unit-conversion logic used by confirm_invoice_receipt
  LEFT JOIN LATERAL (
    SELECT n.cases, n.ok, n.reason, n.conv_status
    FROM public.normalize_received_qty_to_cases(
      COALESCE(ilc.received_qty, ii.quantity_invoiced),
      COALESCE(ii.unit, 'CS'),
      COALESCE(ii.pack_size, cat.pack_size)
    ) n
  ) norm ON (COALESCE(ilc.received_qty, ii.quantity_invoiced) IS NOT NULL)

  -- The actual stock movement written by confirm_invoice_receipt
  LEFT JOIN public.stock_movements sm
    ON sm.invoice_item_id = ii.id
    AND sm.movement_type = 'receive'

  WHERE ii.invoice_id = p_invoice_id
  ORDER BY
    -- Issues first
    CASE
      WHEN ii.catalog_item_id IS NULL THEN 4
      WHEN norm.ok IS NULL OR norm.ok = false THEN 3
      WHEN sm.quantity IS NULL AND COALESCE(norm.cases, 0) > 0 THEN 3
      WHEN sm.quantity IS NOT NULL AND ABS(sm.quantity - COALESCE(norm.cases, 0)) > 0.01 THEN 2
      ELSE 1
    END DESC,
    ii.item_name ASC;
END;
$$;


ALTER FUNCTION "public"."get_invoice_stock_audit"("p_invoice_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_location_permissions"("p_uid" "uuid", "p_location_id" "uuid") RETURNS TABLE("can_approve_orders" boolean, "can_see_costs" boolean, "can_see_food_cost_pct" boolean, "can_see_inventory_value" boolean, "can_edit_par" boolean, "order_approval_threshold" numeric)
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT
    ula.can_approve_orders,
    ula.can_see_costs,
    ula.can_see_food_cost_pct,
    ula.can_see_inventory_value,
    ula.can_edit_par,
    ula.order_approval_threshold
  FROM public.user_location_assignments ula
  WHERE ula.user_id = p_uid
    AND ula.location_id = p_location_id
$$;


ALTER FUNCTION "public"."get_location_permissions"("p_uid" "uuid", "p_location_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_pack_unit_issues"("p_restaurant_id" "uuid") RETURNS TABLE("invoice_item_id" "uuid", "item_name" "text", "catalog_item_id" "uuid", "catalog_item_name" "text", "invoice_id" "uuid", "vendor_name" "text", "invoice_number" "text", "location_id" "uuid", "confirmed_at" timestamp with time zone, "invoice_unit" "text", "pack_size" "text", "pack_parse_success" boolean, "received_qty" numeric, "invoice_total_cost" numeric, "failure_reason" "text", "conv_status" "text", "confidence" "text")
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  IF NOT public.is_member_of(p_restaurant_id) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  RETURN QUERY
  SELECT
    ii.id                                                AS invoice_item_id,
    ii.item_name                                         AS item_name,
    ii.catalog_item_id                                   AS catalog_item_id,
    cat.item_name                                        AS catalog_item_name,
    inv.id                                               AS invoice_id,
    inv.vendor_name                                      AS vendor_name,
    inv.invoice_number                                   AS invoice_number,
    inv.location_id                                      AS location_id,
    inv.confirmed_at                                     AS confirmed_at,
    COALESCE(ii.unit, 'CS')                              AS invoice_unit,
    COALESCE(cat.pack_size, ii.pack_size)                AS pack_size,
    COALESCE(cat.pack_parse_success, false)              AS pack_parse_success,
    COALESCE(ilc.received_qty, ii.quantity_invoiced)     AS received_qty,
    ii.total_cost                                        AS invoice_total_cost,

    -- failure_reason: run normalization to explain why stock was not created
    CASE
      WHEN norm.ok IS NULL
        THEN 'Pack size missing — add pack_size to the catalog item to enable conversion'
      WHEN norm.ok = false
        THEN COALESCE(norm.reason, 'Unit conversion failed — fix pack_size on the catalog item')
      ELSE
        'Stock movement was not recorded — invoice may need reprocessing'
    END                                                  AS failure_reason,

    COALESCE(norm.conv_status, 'conversion_failed')      AS conv_status,

    -- Confidence: how well the system understands this item's pack structure
    CASE
      WHEN vim.verified_at IS NOT NULL
        THEN 'HIGH'
      WHEN COALESCE(cat.pack_parse_success, false)
           AND cat.units_per_case IS NOT NULL
        THEN 'MEDIUM'
      WHEN cat.pack_size IS NOT NULL
        THEN 'LOW'
      ELSE 'UNKNOWN'
    END                                                  AS confidence

  FROM public.invoice_items ii

  -- Only confirmed invoices for this restaurant
  JOIN public.invoices inv
    ON inv.id = ii.invoice_id
    AND inv.restaurant_id = p_restaurant_id
    AND (inv.receipt_status = 'confirmed' OR inv.status = 'confirmed')

  -- Only items with a catalog match (no-catalog is a different problem)
  JOIN public.inventory_catalog_items cat
    ON cat.id = ii.catalog_item_id

  -- Actual received qty (prefer ILC over invoice qty, same as confirm function)
  LEFT JOIN LATERAL (
    SELECT received_qty
    FROM public.invoice_line_comparisons
    WHERE invoice_item_id = ii.id AND invoice_id = ii.invoice_id
    ORDER BY id ASC LIMIT 1
  ) ilc ON true

  -- Try to convert — if ok=false we have the failure reason; if ok=true but no movement it's a gap
  LEFT JOIN LATERAL (
    SELECT n.ok, n.reason, n.conv_status
    FROM public.normalize_received_qty_to_cases(
      COALESCE(ilc.received_qty, ii.quantity_invoiced),
      COALESCE(ii.unit, 'CS'),
      COALESCE(cat.pack_size, ii.pack_size)
    ) n
  ) norm ON (COALESCE(ilc.received_qty, ii.quantity_invoiced) IS NOT NULL
             AND COALESCE(ilc.received_qty, ii.quantity_invoiced) > 0)

  -- No stock movement recorded
  LEFT JOIN public.stock_movements sm
    ON sm.invoice_item_id = ii.id AND sm.movement_type = 'receive'

  -- Vendor learning state
  LEFT JOIN public.vendor_item_mappings vim
    ON vim.catalog_item_id = ii.catalog_item_id
    AND vim.restaurant_id  = p_restaurant_id
    AND vim.vendor_name    = inv.vendor_name

  WHERE sm.id IS NULL
    AND COALESCE(ilc.received_qty, ii.quantity_invoiced, 0) > 0

  ORDER BY
    -- Conversion failures before gap-only issues
    CASE WHEN norm.ok IS NULL OR norm.ok = false THEN 0 ELSE 1 END,
    -- Most recent first within each tier
    inv.confirmed_at DESC NULLS LAST,
    ii.item_name ASC;
END;
$$;


ALTER FUNCTION "public"."get_pack_unit_issues"("p_restaurant_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."handle_new_user"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name)
  VALUES (NEW.id, NEW.email, COALESCE(NEW.raw_user_meta_data->>'full_name', ''));
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."handle_new_user"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."has_restaurant_role"("r_id" "uuid", "_role" "public"."app_role") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.restaurant_members
    WHERE restaurant_id = r_id AND user_id = auth.uid() AND role = _role
  )
$$;


ALTER FUNCTION "public"."has_restaurant_role"("r_id" "uuid", "_role" "public"."app_role") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."has_restaurant_role_any"("r_id" "uuid", "_roles" "public"."app_role"[]) RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.restaurant_members
    WHERE restaurant_id = r_id AND user_id = auth.uid() AND role = ANY(_roles)
  )
$$;


ALTER FUNCTION "public"."has_restaurant_role_any"("r_id" "uuid", "_roles" "public"."app_role"[]) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."increment_session_item_version"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  NEW.version := OLD.version + 1;
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."increment_session_item_version"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."invitation_restaurant_id"("inv_id" "uuid") RETURNS "uuid"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$ SELECT restaurant_id FROM public.invitations WHERE id = inv_id $$;


ALTER FUNCTION "public"."invitation_restaurant_id"("inv_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."invoice_restaurant_id"("p_invoice_id" "uuid") RETURNS "uuid"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT restaurant_id FROM public.invoices WHERE id = p_invoice_id
$$;


ALTER FUNCTION "public"."invoice_restaurant_id"("p_invoice_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_member_of"("r_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.restaurant_members
    WHERE restaurant_id = r_id AND user_id = auth.uid()
  )
$$;


ALTER FUNCTION "public"."is_member_of"("r_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."list_category_restaurant_id"("lc_list_id" "uuid") RETURNS "uuid"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT restaurant_id FROM public.inventory_lists WHERE id = lc_list_id
$$;


ALTER FUNCTION "public"."list_category_restaurant_id"("lc_list_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."list_item_map_restaurant_id"("p_list_id" "uuid") RETURNS "uuid"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$ SELECT restaurant_id FROM public.inventory_lists WHERE id = p_list_id $$;


ALTER FUNCTION "public"."list_item_map_restaurant_id"("p_list_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."normalize_received_qty_to_cases"("p_qty" numeric, "p_unit" "text", "p_pack_size" "text") RETURNS TABLE("cases" numeric, "ok" boolean, "reason" "text", "conv_status" "text")
    LANGUAGE "plpgsql" IMMUTABLE
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


ALTER FUNCTION "public"."normalize_received_qty_to_cases"("p_qty" numeric, "p_unit" "text", "p_pack_size" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."notify_delivery_issues"("p_purchase_history_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_restaurant_id   uuid;
  v_po_number       text;
  v_missing         bigint;
  v_partial         bigint;
  v_price           bigint;
  v_total           bigint;
  v_missing_names   text[];
  v_severity        text;
  v_title           text;
  v_message         text;
  v_data            jsonb;
  v_notified        integer := 0;
  v_member          RECORD;
  v_parts           text[];
BEGIN
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

  IF v_missing > 0 THEN
    SELECT array_agg(ilc.item_name ORDER BY ilc.item_name)
    INTO v_missing_names
    FROM public.invoice_line_comparisons ilc
    WHERE (ilc.invoice_id = p_purchase_history_id OR ilc.purchase_history_id = p_purchase_history_id)
      AND ilc.status = 'missing_from_invoice'
      AND ilc.catalog_item_id IS NOT NULL;
  END IF;

  v_severity := CASE WHEN v_missing > 0 THEN 'CRITICAL' ELSE 'WARNING' END;
  v_parts    := ARRAY[]::text[];

  IF v_missing > 0 THEN
    v_parts := array_append(
      v_parts,
      v_missing::text || ' ordered item' || CASE WHEN v_missing > 1 THEN 's' ELSE '' END
        || ' missing from delivery'
    );
  END IF;
  IF v_partial > 0 THEN
    v_parts := array_append(v_parts, v_partial::text || ' partial delivery' || CASE WHEN v_partial > 1 THEN 's' ELSE '' END);
  END IF;
  IF v_price > 0 THEN
    v_parts := array_append(v_parts, v_price::text || ' price gap' || CASE WHEN v_price > 1 THEN 's' ELSE '' END);
  END IF;
  IF v_total > 0 THEN
    v_parts := array_append(v_parts, v_total::text || ' line-total gap' || CASE WHEN v_total > 1 THEN 's' ELSE '' END);
  END IF;

  v_title   := 'Delivery Issues Detected';
  v_message := array_to_string(v_parts, ', ')
    || CASE WHEN v_po_number IS NOT NULL AND v_po_number <> '' THEN ' on ' || v_po_number ELSE '' END
    || '.';

  v_data := jsonb_build_object(
    'invoice_id',           p_purchase_history_id,
    'purchase_history_id',  p_purchase_history_id,
    'po_number',            v_po_number,
    'missing_count',        COALESCE(v_missing, 0),
    'partial_count',        COALESCE(v_partial, 0),
    'price_mismatch_count', COALESCE(v_price, 0),
    'total_mismatch_count', COALESCE(v_total, 0),
    'missing_items',        COALESCE(to_jsonb(v_missing_names), '[]'::jsonb)
  );

  FOR v_member IN
    SELECT user_id FROM public.restaurant_members
    WHERE restaurant_id = v_restaurant_id
      AND role IN ('OWNER', 'MANAGER')
  LOOP
    INSERT INTO public.notifications (
      restaurant_id, location_id, user_id, type, title, message, severity, data, idempotency_key
    ) VALUES (
      v_restaurant_id, NULL, v_member.user_id, 'DELIVERY_ISSUE',
      v_title, v_message, v_severity::notification_severity, v_data,
      p_purchase_history_id::text || '::' || v_member.user_id::text || '::DELIVERY_ISSUE'
    )
    ON CONFLICT (idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING;
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


ALTER FUNCTION "public"."notify_delivery_issues"("p_purchase_history_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."notify_pack_conversion_failures"("p_invoice_id" "uuid", "p_failed_items" "jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_restaurant_id uuid;
  v_vendor_name   text;
  v_inv_number    text;
  v_member        RECORD;
  v_notified      integer := 0;
  v_item_names    text;
  v_count         integer;
BEGIN
  SELECT restaurant_id, vendor_name, invoice_number
  INTO v_restaurant_id, v_vendor_name, v_inv_number
  FROM public.invoices WHERE id = p_invoice_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('notified', 0, 'reason', 'invoice_not_found');
  END IF;

  IF NOT public.is_member_of(v_restaurant_id) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  -- Build a comma-separated summary of failed item names
  SELECT
    COUNT(*),
    string_agg(item->>'item_name', ', ' ORDER BY (item->>'item_name'))
  INTO v_count, v_item_names
  FROM jsonb_array_elements(p_failed_items) item;

  IF v_count = 0 OR v_item_names IS NULL THEN
    RETURN jsonb_build_object('notified', 0, 'reason', 'no_failed_items');
  END IF;

  FOR v_member IN
    SELECT user_id
    FROM public.restaurant_members
    WHERE restaurant_id = v_restaurant_id
      AND role IN ('OWNER', 'MANAGER')
  LOOP
    INSERT INTO public.notifications (
      restaurant_id,
      user_id,
      type,
      title,
      message,
      severity,
      data,
      idempotency_key
    ) VALUES (
      v_restaurant_id,
      v_member.user_id,
      'PACK_CONVERSION_FAILURE',
      format('%s item%s failed inventory conversion',
        v_count,
        CASE WHEN v_count > 1 THEN 's' ELSE '' END),
      format('%s — fix pack & unit settings, then reprocess: %s',
        COALESCE('Invoice ' || v_inv_number, 'Invoice'),
        CASE WHEN length(v_item_names) > 120
             THEN left(v_item_names, 117) || '…'
             ELSE v_item_names
        END),
      'WARNING'::notification_severity,
      jsonb_build_object(
        'invoice_id',   p_invoice_id,
        'vendor_name',  v_vendor_name,
        'failed_items', p_failed_items,
        'action_url',   '/app/invoices/pack-issues'
      ),
      p_invoice_id::text || '::' || v_member.user_id::text || '::PACK_CONVERSION_FAILURE'
    )
    ON CONFLICT (idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING;

    v_notified := v_notified + 1;
  END LOOP;

  RETURN jsonb_build_object('notified', v_notified, 'items_count', v_count);
END;
$$;


ALTER FUNCTION "public"."notify_pack_conversion_failures"("p_invoice_id" "uuid", "p_failed_items" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."order_restaurant_id"("o_id" "uuid") RETURNS "uuid"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT restaurant_id FROM public.orders WHERE id = o_id
$$;


ALTER FUNCTION "public"."order_restaurant_id"("o_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."par_guide_restaurant_id"("pg_id" "uuid") RETURNS "uuid"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT restaurant_id FROM public.par_guides WHERE id = pg_id
$$;


ALTER FUNCTION "public"."par_guide_restaurant_id"("pg_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."purchase_history_restaurant_id"("ph_id" "uuid") RETURNS "uuid"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT restaurant_id FROM public.purchase_history WHERE id = ph_id
$$;


ALTER FUNCTION "public"."purchase_history_restaurant_id"("ph_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."purchase_order_restaurant_id"("p_po_id" "uuid") RETURNS "uuid"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT restaurant_id FROM public.purchase_orders WHERE id = p_po_id
$$;


ALTER FUNCTION "public"."purchase_order_restaurant_id"("p_po_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."reminder_restaurant_id"("r_id" "uuid") RETURNS "uuid"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT restaurant_id FROM public.reminders WHERE id = r_id
$$;


ALTER FUNCTION "public"."reminder_restaurant_id"("r_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."reprocess_invoice_item_stock"("p_invoice_item_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_restaurant_id   uuid;
  v_catalog_item_id uuid;
  v_received_qty    numeric;
  v_invoice_unit    text;
  v_pack_size       text;
  v_invoice_id      uuid;
  v_item_name       text;
  v_cases           numeric;
  v_conv_ok         boolean;
  v_conv_reason     text;
  v_conv_status     text;
  v_inserted        integer;
BEGIN
  -- Fetch item with CURRENT catalog pack_size (re-reads after repair)
  SELECT
    inv.restaurant_id,
    ii.catalog_item_id,
    COALESCE(ilc.received_qty, ii.quantity_invoiced),
    COALESCE(ii.unit, 'CS'),
    -- Prefer catalog pack_size (updated by repair) over invoice pack_size
    COALESCE(cat.pack_size, ii.pack_size),
    ii.invoice_id,
    ii.item_name
  INTO
    v_restaurant_id, v_catalog_item_id, v_received_qty,
    v_invoice_unit, v_pack_size, v_invoice_id, v_item_name
  FROM public.invoice_items ii
  JOIN public.invoices inv ON inv.id = ii.invoice_id
  LEFT JOIN public.inventory_catalog_items cat ON cat.id = ii.catalog_item_id
  LEFT JOIN LATERAL (
    SELECT received_qty FROM public.invoice_line_comparisons
    WHERE invoice_item_id = ii.id AND invoice_id = ii.invoice_id
    ORDER BY id ASC LIMIT 1
  ) ilc ON true
  WHERE ii.id = p_invoice_item_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invoice item not found: %', p_invoice_item_id;
  END IF;

  IF NOT public.is_member_of(v_restaurant_id) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  IF v_catalog_item_id IS NULL THEN
    RETURN jsonb_build_object(
      'ok', false, 'reason', 'no_catalog_match',
      'message', 'Invoice line not matched to a catalog item — match it in List Management first'
    );
  END IF;

  IF COALESCE(v_received_qty, 0) <= 0 THEN
    RETURN jsonb_build_object(
      'ok', false, 'reason', 'zero_quantity',
      'message', 'Received quantity is zero — no stock movement needed'
    );
  END IF;

  -- Run unit normalization with current (potentially just-repaired) catalog data
  SELECT n.cases, n.ok, n.reason, n.conv_status
  INTO v_cases, v_conv_ok, v_conv_reason, v_conv_status
  FROM public.normalize_received_qty_to_cases(
    v_received_qty,
    v_invoice_unit,
    v_pack_size
  ) n;

  IF NOT v_conv_ok OR v_cases IS NULL THEN
    RETURN jsonb_build_object(
      'ok',            false,
      'reason',        'conversion_failed',
      'message',       COALESCE(v_conv_reason,
                         'Unit conversion still failing — fix pack_size on the catalog item and try again'),
      'pack_size_used', v_pack_size,
      'invoice_unit',  v_invoice_unit
    );
  END IF;

  IF v_cases <= 0 THEN
    RETURN jsonb_build_object(
      'ok', false, 'reason', 'zero_result',
      'message', 'Conversion produced zero cases — check received quantity and pack_size'
    );
  END IF;

  -- Idempotent insert: uq_stock_movements_receive_per_invoice_item prevents duplicates
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
    v_restaurant_id,
    v_catalog_item_id,
    'receive',
    v_cases,
    'case',
    v_received_qty,
    v_invoice_unit,
    v_conv_status,
    'invoice_receipt',
    v_invoice_id,
    v_invoice_id,
    p_invoice_item_id,
    auth.uid()
  )
  ON CONFLICT (invoice_item_id)
    WHERE movement_type = 'receive' AND invoice_item_id IS NOT NULL
  DO NOTHING;

  GET DIAGNOSTICS v_inserted = ROW_COUNT;

  RETURN jsonb_build_object(
    'ok',             true,
    'cases',          v_cases,
    'conv_status',    v_conv_status,
    'inserted',       v_inserted = 1,
    'already_existed', v_inserted = 0,
    'item_name',      v_item_name,
    'message', CASE
      WHEN v_inserted = 1
        THEN 'Stock movement created: ' || ROUND(v_cases, 4)::text || ' cases'
      ELSE
        'Stock movement already exists (' || ROUND(v_cases, 4)::text
          || ' cases) — no duplicate created'
    END
  );
END;
$$;


ALTER FUNCTION "public"."reprocess_invoice_item_stock"("p_invoice_item_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rls_auto_enable"() RETURNS "event_trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog'
    AS $$
DECLARE
  cmd record;
BEGIN
  FOR cmd IN
    SELECT *
    FROM pg_event_trigger_ddl_commands()
    WHERE command_tag IN ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
      AND object_type IN ('table','partitioned table')
  LOOP
     IF cmd.schema_name IS NOT NULL AND cmd.schema_name IN ('public') AND cmd.schema_name NOT IN ('pg_catalog','information_schema') AND cmd.schema_name NOT LIKE 'pg_toast%' AND cmd.schema_name NOT LIKE 'pg_temp%' THEN
      BEGIN
        EXECUTE format('alter table if exists %s enable row level security', cmd.object_identity);
        RAISE LOG 'rls_auto_enable: enabled RLS on %', cmd.object_identity;
      EXCEPTION
        WHEN OTHERS THEN
          RAISE LOG 'rls_auto_enable: failed to enable RLS on %', cmd.object_identity;
      END;
     ELSE
        RAISE LOG 'rls_auto_enable: skip % (either system schema or not in enforced list: %.)', cmd.object_identity, cmd.schema_name;
     END IF;
  END LOOP;
END;
$$;


ALTER FUNCTION "public"."rls_auto_enable"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."session_item_restaurant_id"("p_session_item_id" "uuid") RETURNS "uuid"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT s.restaurant_id
  FROM public.inventory_session_items isi
  JOIN public.inventory_sessions s ON s.id = isi.session_id
  WHERE isi.id = p_session_item_id
$$;


ALTER FUNCTION "public"."session_item_restaurant_id"("p_session_item_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."session_restaurant_id"("s_id" "uuid") RETURNS "uuid"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT restaurant_id FROM public.inventory_sessions WHERE id = s_id
$$;


ALTER FUNCTION "public"."session_restaurant_id"("s_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_sales_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."set_sales_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."smart_order_run_restaurant_id"("sr_id" "uuid") RETURNS "uuid"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT restaurant_id FROM public.smart_order_runs WHERE id = sr_id
$$;


ALTER FUNCTION "public"."smart_order_run_restaurant_id"("sr_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."submit_smart_order"("p_run_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_run          public.smart_order_runs%ROWTYPE;
  v_po_number    text;
  v_po_id        uuid;
  v_vendor_name  text;
BEGIN
  SELECT *
  INTO v_run
  FROM public.smart_order_runs
  WHERE id = p_run_id
    AND public.is_member_of(restaurant_id)
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Smart order run not found or access denied';
  END IF;

  -- 1) Vendor from catalog items on this run (weighted by suggested order qty)
  SELECT btrim(ici.vendor_name)
  INTO v_vendor_name
  FROM public.smart_order_run_items AS sri
  INNER JOIN public.inventory_catalog_items AS ici
    ON ici.id = sri.catalog_item_id
   AND ici.restaurant_id = v_run.restaurant_id
  WHERE sri.run_id = p_run_id
    AND sri.suggested_order > 0
    AND ici.vendor_name IS NOT NULL
    AND btrim(ici.vendor_name) <> ''
  GROUP BY btrim(ici.vendor_name)
  ORDER BY SUM(GREATEST(sri.suggested_order, 0)) DESC, COUNT(*) DESC
  LIMIT 1;

  -- 2) Fallback: list-level catalog vendor (same list as the run)
  IF v_vendor_name IS NULL AND v_run.inventory_list_id IS NOT NULL THEN
    SELECT btrim(ici.vendor_name)
    INTO v_vendor_name
    FROM public.inventory_catalog_items AS ici
    WHERE ici.inventory_list_id = v_run.inventory_list_id
      AND ici.restaurant_id = v_run.restaurant_id
      AND ici.vendor_name IS NOT NULL
      AND btrim(ici.vendor_name) <> ''
    GROUP BY btrim(ici.vendor_name)
    ORDER BY COUNT(*) DESC
    LIMIT 1;
  END IF;

  IF v_vendor_name IS NULL OR btrim(v_vendor_name) = '' THEN
    RAISE EXCEPTION 'Cannot submit purchase order: no vendor on catalog items for this order. Add vendor names in List Management for items on this list, then try again.';
  END IF;

  v_po_number := v_run.po_number;
  IF v_po_number IS NULL THEN
    v_po_number := public.generate_po_number(v_run.restaurant_id);
    UPDATE public.smart_order_runs
    SET po_number = v_po_number
    WHERE id = p_run_id;
  END IF;

  UPDATE public.smart_order_runs
  SET status       = 'submitted',
      submitted_at = COALESCE(submitted_at, now())
  WHERE id = p_run_id;

  SELECT id INTO v_po_id
  FROM public.purchase_orders
  WHERE smart_order_run_id = p_run_id;

  IF v_po_id IS NULL THEN
    INSERT INTO public.purchase_orders (
      restaurant_id, po_number, vendor_name, status, smart_order_run_id,
      created_from_session_id, inventory_list_id, created_by, submitted_at,
      location_id
    )
    VALUES (
      v_run.restaurant_id,
      v_po_number,
      v_vendor_name,
      'submitted',
      v_run.id,
      v_run.session_id,
      v_run.inventory_list_id,
      v_run.created_by,
      COALESCE(v_run.submitted_at, now()),
      v_run.location_id
    )
    RETURNING id INTO v_po_id;
  ELSE
    UPDATE public.purchase_orders
    SET
      po_number     = v_po_number,
      vendor_name   = v_vendor_name,
      status        = 'submitted',
      submitted_at  = COALESCE(submitted_at, now()),
      location_id   = COALESCE(location_id, v_run.location_id),
      updated_at    = now()
    WHERE id = v_po_id;
  END IF;

  DELETE FROM public.purchase_order_items WHERE purchase_order_id = v_po_id;

  INSERT INTO public.purchase_order_items (
    purchase_order_id, catalog_item_id, item_name, quantity_ordered, unit_cost, total_cost,
    pack_size, brand_name, smart_order_run_item_id
  )
  SELECT
    v_po_id,
    sri.catalog_item_id,
    sri.item_name,
    GREATEST(sri.suggested_order, 0),
    sri.unit_cost,
    GREATEST(sri.suggested_order, 0) * COALESCE(sri.unit_cost, 0),
    sri.pack_size,
    sri.brand_name,
    sri.id
  FROM public.smart_order_run_items sri
  WHERE sri.run_id = p_run_id
    AND sri.suggested_order > 0;

  RETURN jsonb_build_object(
    'purchase_order_id', v_po_id,
    'po_number',         v_po_number,
    'purchase_history_id', NULL
  );
END;
$$;


ALTER FUNCTION "public"."submit_smart_order"("p_run_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."sync_catalog_price_on_receive"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $_$
DECLARE
  v_item_name          text;
  v_old_cost           numeric;
  v_new_cost           numeric;
  v_pct_diff           numeric;
  v_direction          text;
  v_member             RECORD;
  -- invoice cost basis
  v_invoice_unit_cost  numeric;
  v_total_cost         numeric;
  v_qty_invoiced       numeric;
  v_invoice_unit       text;
  v_price_basis        text;
BEGIN
  IF NEW.movement_type <> 'receive' THEN RETURN NEW; END IF;
  IF NEW.invoice_item_id IS NULL     THEN RETURN NEW; END IF;
  IF NEW.catalog_item_id IS NULL     THEN RETURN NEW; END IF;

  -- Fetch all cost fields needed to determine basis
  SELECT unit_cost, total_cost, quantity_invoiced, unit
  INTO v_invoice_unit_cost, v_total_cost, v_qty_invoiced, v_invoice_unit
  FROM public.invoice_items
  WHERE id = NEW.invoice_item_id;

  -- Suppress if invoice is explicitly per-weight: can't compare to per-case catalog price
  IF LOWER(COALESCE(v_invoice_unit, 'cs')) IN ('lb', 'lbs', 'kg', 'kgs') THEN
    RETURN NEW;
  END IF;

  -- Derive per-case invoice cost.
  -- total_cost / quantity_invoiced handles catch-weight items transparently:
  --   CS items:          unit_cost × qty = total_cost  → total/qty = unit_cost  (no change)
  --   catch-weight CS:   unit_cost = per-lb, total_cost = real case cost → total/qty = real case
  IF v_total_cost IS NOT NULL AND v_qty_invoiced IS NOT NULL AND v_qty_invoiced > 0 THEN
    v_new_cost    := v_total_cost / v_qty_invoiced;
    v_price_basis := 'per_case';
  ELSIF v_invoice_unit_cost IS NOT NULL AND v_invoice_unit_cost > 0 THEN
    -- Fallback: unit_cost only — may be wrong for catch-weight, suppress if suspicious
    -- (unit_cost << total_cost / qty is a catch-weight signal, but without total_cost we can't tell)
    v_new_cost    := v_invoice_unit_cost;
    v_price_basis := 'unit_cost_fallback';
  ELSE
    RETURN NEW;
  END IF;

  IF v_new_cost IS NULL OR v_new_cost <= 0 THEN RETURN NEW; END IF;

  -- Current catalog price (always per-case)
  SELECT item_name, default_unit_cost
  INTO v_item_name, v_old_cost
  FROM public.inventory_catalog_items
  WHERE id = NEW.catalog_item_id;

  IF NOT FOUND THEN RETURN NEW; END IF;

  -- Threshold: > $0.01 absolute AND > 1% relative
  IF v_old_cost IS NOT NULL
     AND NOT (
       ABS(v_new_cost - v_old_cost) > 0.01
       AND (
         v_old_cost = 0
         OR (ABS(v_new_cost - v_old_cost) / ABS(v_old_cost)) * 100 > 1.0
       )
     )
  THEN
    RETURN NEW;
  END IF;

  -- Update catalog with correct per-case cost
  UPDATE public.inventory_catalog_items
  SET
    default_unit_cost = v_new_cost,
    updated_at        = now()
  WHERE id = NEW.catalog_item_id;

  v_direction := CASE WHEN v_new_cost > COALESCE(v_old_cost, 0) THEN 'up' ELSE 'down' END;

  v_pct_diff := CASE
    WHEN v_old_cost IS NULL OR v_old_cost = 0 THEN NULL
    ELSE ROUND(((v_new_cost - v_old_cost) / ABS(v_old_cost)) * 100, 1)
  END;

  FOR v_member IN
    SELECT user_id
    FROM public.restaurant_members
    WHERE restaurant_id = NEW.restaurant_id
      AND role IN ('OWNER', 'MANAGER')
  LOOP
    INSERT INTO public.notifications (
      restaurant_id,
      user_id,
      type,
      title,
      message,
      severity,
      data
    ) VALUES (
      NEW.restaurant_id,
      v_member.user_id,
      CASE WHEN v_direction = 'up' THEN 'PRICE_INCREASE' ELSE 'PRICE_DECREASE' END,
      CASE
        WHEN v_direction = 'up' THEN 'Price increase detected'
        ELSE 'Price decrease detected'
      END,
      format(
        '%s: $%s → $%s/case%s',
        v_item_name,
        COALESCE(to_char(v_old_cost, 'FM999990.00'), 'N/A'),
        to_char(v_new_cost, 'FM999990.00'),
        CASE WHEN v_pct_diff IS NOT NULL
             THEN format(' (%s%%)', CASE WHEN v_direction = 'up' THEN '+' ELSE '' END || v_pct_diff::text)
             ELSE ''
        END
      ),
      CASE WHEN v_direction = 'up' THEN 'WARNING'::notification_severity ELSE 'INFO'::notification_severity END,
      jsonb_build_object(
        'catalog_item_id', NEW.catalog_item_id,
        'item_name',       v_item_name,
        'old_cost',        v_old_cost,
        'new_cost',        v_new_cost,
        'pct_change',      v_pct_diff,
        'direction',       v_direction,
        'invoice_id',      NEW.invoice_id,
        'price_basis',     v_price_basis,
        'items', jsonb_build_array(jsonb_build_object(
          'item_name',   v_item_name,
          'old_cost',    v_old_cost,
          'new_cost',    v_new_cost,
          'pct_change',  v_pct_diff,
          'price_basis', v_price_basis
        ))
      )
    );
  END LOOP;

  RETURN NEW;
END;
$_$;


ALTER FUNCTION "public"."sync_catalog_price_on_receive"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."sync_catalog_price_on_receive"() IS 'Fires after every stock_movements INSERT for receive movements. If the invoiced unit cost differs from the catalog price by >1% and >$0.01, updates inventory_catalog_items and creates PRICE_INCREASE/PRICE_DECREASE notifications for all OWNER/MANAGER members of the restaurant.';



CREATE OR REPLACE FUNCTION "public"."sync_par_item_category"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  IF OLD.category_id IS DISTINCT FROM NEW.category_id THEN
    UPDATE public.par_items SET category_id = NEW.category_id WHERE inventory_item_id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."sync_par_item_category"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."user_accessible_location_ids"("p_uid" "uuid") RETURNS SETOF "uuid"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT l.id
  FROM public.locations l
  JOIN public.restaurant_members rm
    ON rm.restaurant_id = l.restaurant_id
  WHERE rm.user_id = p_uid
    AND rm.role = 'OWNER'::public.app_role
    AND l.is_active = true
  UNION
  SELECT ula.location_id
  FROM public.user_location_assignments ula
  WHERE ula.user_id = p_uid
$$;


ALTER FUNCTION "public"."user_accessible_location_ids"("p_uid" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."user_can_access_location"("p_uid" "uuid", "p_location_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT p_location_id IN (
    SELECT * FROM public.user_accessible_location_ids(p_uid)
  )
$$;


ALTER FUNCTION "public"."user_can_access_location"("p_uid" "uuid", "p_location_id" "uuid") OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."alert_recipients" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "notification_pref_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL
);


ALTER TABLE "public"."alert_recipients" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."categories" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "restaurant_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "sort_order" integer DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."categories" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."custom_list_items" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "list_id" "uuid" NOT NULL,
    "item_name" "text" NOT NULL,
    "quantity" numeric,
    "unit" "text",
    "category" "text",
    "sort_order" integer DEFAULT 0
);


ALTER TABLE "public"."custom_list_items" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."custom_lists" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "restaurant_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "categories" "jsonb" DEFAULT '[]'::"jsonb"
);


ALTER TABLE "public"."custom_lists" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."daily_sales" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "restaurant_id" "uuid" NOT NULL,
    "location_id" "uuid" NOT NULL,
    "sale_date" "date" NOT NULL,
    "gross_sales" numeric(12,2) NOT NULL,
    "net_sales" numeric(12,2),
    "comps" numeric(12,2) DEFAULT 0 NOT NULL,
    "discounts" numeric(12,2) DEFAULT 0 NOT NULL,
    "tax" numeric(12,2) DEFAULT 0 NOT NULL,
    "entry_method" "text" DEFAULT 'manual_daily'::"text" NOT NULL,
    "entered_by_user_id" "uuid" NOT NULL,
    "entered_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "daily_sales_comps_check" CHECK (("comps" >= (0)::numeric)),
    CONSTRAINT "daily_sales_entry_method_check" CHECK (("entry_method" = ANY (ARRAY['manual_daily'::"text", 'csv'::"text", 'email_in'::"text", 'pos_api'::"text"]))),
    CONSTRAINT "daily_sales_gross_sales_check" CHECK (("gross_sales" >= (0)::numeric)),
    CONSTRAINT "daily_sales_net_sales_check" CHECK ((("net_sales" IS NULL) OR ("net_sales" >= (0)::numeric)))
);


ALTER TABLE "public"."daily_sales" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."delivery_issues" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "purchase_history_id" "uuid",
    "invoice_line_comparison_id" "uuid",
    "catalog_item_id" "uuid",
    "item_name" "text" NOT NULL,
    "issue_type" "text" NOT NULL,
    "notes" "text",
    "reported_at" timestamp with time zone DEFAULT "now"(),
    "resolved_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "invoice_id" "uuid",
    CONSTRAINT "delivery_issues_invoice_or_ph_chk" CHECK ((("invoice_id" IS NOT NULL) OR ("purchase_history_id" IS NOT NULL))),
    CONSTRAINT "delivery_issues_issue_type_check" CHECK (("issue_type" = ANY (ARRAY['short_shipped'::"text", 'damaged'::"text", 'wrong_item'::"text", 'price_discrepancy'::"text", 'other'::"text"])))
);


ALTER TABLE "public"."delivery_issues" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."failed_inbound_emails" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "received_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "from_address" "text",
    "to_addresses" "text"[],
    "subject" "text",
    "reason" "text" NOT NULL,
    "raw_payload" "jsonb",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."failed_inbound_emails" OWNER TO "postgres";


COMMENT ON TABLE "public"."failed_inbound_emails" IS 'Log of inbound emails that could not be matched to a restaurant invoice_email address. Used for operator recovery and support debugging.';



CREATE TABLE IF NOT EXISTS "public"."import_runs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "restaurant_id" "uuid" NOT NULL,
    "inventory_list_id" "uuid",
    "vendor_name" "text",
    "file_name" "text" NOT NULL,
    "uploaded_by" "uuid",
    "uploaded_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "mapping_used_json" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "confidence_score" numeric,
    "created_count" integer DEFAULT 0,
    "updated_count" integer DEFAULT 0,
    "skipped_count" integer DEFAULT 0,
    "warnings_json" "jsonb" DEFAULT '[]'::"jsonb",
    "template_id" "uuid"
);


ALTER TABLE "public"."import_runs" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."import_templates" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "restaurant_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "vendor_name" "text",
    "file_type" "text" DEFAULT 'csv'::"text",
    "mapping_json" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "header_fingerprint" "text",
    "inventory_list_id" "uuid",
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "last_used_at" timestamp with time zone
);


ALTER TABLE "public"."import_templates" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."inventory_catalog_items" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "restaurant_id" "uuid" NOT NULL,
    "inventory_list_id" "uuid",
    "item_name" "text" NOT NULL,
    "vendor_sku" "text",
    "category" "text",
    "unit" "text",
    "pack_size" "text",
    "default_par_level" numeric,
    "default_unit_cost" numeric,
    "vendor_name" "text",
    "metadata" "jsonb",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "sort_order" integer DEFAULT 0 NOT NULL,
    "list_category_id" "uuid",
    "product_number" "text",
    "brand_name" "text",
    "units_per_case" integer,
    "unit_size" numeric,
    "unit_type" "text",
    "total_per_case" numeric,
    "pack_parse_success" boolean DEFAULT false NOT NULL,
    "cost_unit" "text" DEFAULT 'case'::"text",
    "current_stock" numeric,
    CONSTRAINT "category_length" CHECK ((("category" IS NULL) OR ("length"("category") <= 100))),
    CONSTRAINT "item_name_length" CHECK (("length"("item_name") <= 200)),
    CONSTRAINT "pack_size_length" CHECK ((("pack_size" IS NULL) OR ("length"("pack_size") <= 100))),
    CONSTRAINT "unit_length" CHECK ((("unit" IS NULL) OR ("length"("unit") <= 50))),
    CONSTRAINT "vendor_name_length" CHECK ((("vendor_name" IS NULL) OR ("length"("vendor_name") <= 200))),
    CONSTRAINT "vendor_sku_length" CHECK ((("vendor_sku" IS NULL) OR ("length"("vendor_sku") <= 100)))
);


ALTER TABLE "public"."inventory_catalog_items" OWNER TO "postgres";


COMMENT ON COLUMN "public"."inventory_catalog_items"."units_per_case" IS 'Parsed from pack_size: number of units per case (e.g., 6 from "6/5 Lb")';



COMMENT ON COLUMN "public"."inventory_catalog_items"."unit_size" IS 'Parsed from pack_size: size of one unit (e.g., 5 lb in "6/5 Lb")';



COMMENT ON COLUMN "public"."inventory_catalog_items"."unit_type" IS 'Canonical unit token from pack parser (e.g. lb, gal, each)';



COMMENT ON COLUMN "public"."inventory_catalog_items"."total_per_case" IS 'units_per_case * unit_size when applicable';



COMMENT ON COLUMN "public"."inventory_catalog_items"."pack_parse_success" IS 'True when parsePackSize returned parseSuccess for pack_size';



COMMENT ON COLUMN "public"."inventory_catalog_items"."cost_unit" IS 'Unit default_unit_cost is expressed per -- always case in the canonical model';



COMMENT ON COLUMN "public"."inventory_catalog_items"."current_stock" IS 'Running stock balance in catalog/planning units (cases).
   SET to the approved session count each time a session is approved.
   Incremented by confirmed invoice receipts via confirm_invoice_receipt.
   NULL means no inventory session has been approved yet for this item.';



CREATE TABLE IF NOT EXISTS "public"."inventory_import_files" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "restaurant_id" "uuid" NOT NULL,
    "inventory_list_id" "uuid" NOT NULL,
    "file_name" "text" NOT NULL,
    "file_type" "text" DEFAULT 'csv'::"text",
    "uploaded_by" "uuid",
    "uploaded_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "row_count" integer DEFAULT 0,
    "created_count" integer DEFAULT 0,
    "skipped_count" integer DEFAULT 0,
    "mapping_json" "jsonb" DEFAULT '{}'::"jsonb"
);


ALTER TABLE "public"."inventory_import_files" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."inventory_items" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "restaurant_id" "uuid" NOT NULL,
    "category_id" "uuid" NOT NULL,
    "item_name" "text" NOT NULL,
    "item_number" "text",
    "pack_size" "text" NOT NULL,
    "unit_price" numeric DEFAULT 0 NOT NULL,
    "sort_order" integer DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."inventory_items" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."inventory_lists" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "restaurant_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "location_id" "uuid",
    "active_category_mode" "text" DEFAULT 'list_order'::"text" NOT NULL,
    CONSTRAINT "inventory_lists_active_category_mode_check" CHECK (("active_category_mode" = ANY (ARRAY['list_order'::"text", 'custom_ai'::"text", 'user_manual'::"text", 'recently_purchased'::"text"])))
);


ALTER TABLE "public"."inventory_lists" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."inventory_session_item_zones" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "session_item_id" "uuid" NOT NULL,
    "list_category_id" "uuid" NOT NULL,
    "entered_qty" numeric DEFAULT 0 NOT NULL,
    "entered_unit" "text" NOT NULL,
    "normalized_qty" numeric DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "inventory_session_item_zones_normalized_non_negative" CHECK (("normalized_qty" >= (0)::numeric)),
    CONSTRAINT "inventory_session_item_zones_qty_non_negative" CHECK (("entered_qty" >= (0)::numeric))
);


ALTER TABLE "public"."inventory_session_item_zones" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."inventory_session_items" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "session_id" "uuid" NOT NULL,
    "item_name" "text" NOT NULL,
    "category" "text",
    "unit" "text",
    "current_stock" numeric DEFAULT 0 NOT NULL,
    "par_level" numeric DEFAULT 0 NOT NULL,
    "lead_time_days" integer,
    "unit_cost" numeric,
    "vendor_sku" "text",
    "pack_size" "text",
    "vendor_name" "text",
    "metadata" "jsonb",
    "brand_name" "text",
    "counted_as" "text",
    "counted_value" numeric,
    "conversion_formula" "text",
    "stock_unit" "text" DEFAULT 'case'::"text",
    "version" integer DEFAULT 1 NOT NULL,
    CONSTRAINT "isi_category_length" CHECK ((("category" IS NULL) OR ("length"("category") <= 100))),
    CONSTRAINT "isi_item_name_length" CHECK (("length"("item_name") <= 200)),
    CONSTRAINT "isi_pack_size_length" CHECK ((("pack_size" IS NULL) OR ("length"("pack_size") <= 100))),
    CONSTRAINT "isi_unit_length" CHECK ((("unit" IS NULL) OR ("length"("unit") <= 50))),
    CONSTRAINT "isi_vendor_name_length" CHECK ((("vendor_name" IS NULL) OR ("length"("vendor_name") <= 200))),
    CONSTRAINT "isi_vendor_sku_length" CHECK ((("vendor_sku" IS NULL) OR ("length"("vendor_sku") <= 100)))
);


ALTER TABLE "public"."inventory_session_items" OWNER TO "postgres";


COMMENT ON COLUMN "public"."inventory_session_items"."counted_as" IS 'Unit used for counting: cases, units (bags/bottles), or weight (lbs/gal)';



COMMENT ON COLUMN "public"."inventory_session_items"."counted_value" IS 'Raw value entered by user (e.g., 33 if counted 33 bags)';



COMMENT ON COLUMN "public"."inventory_session_items"."conversion_formula" IS 'Audit trail showing conversion math (e.g., "33 bags ÷ 6 = 5.5 CS")';



COMMENT ON COLUMN "public"."inventory_session_items"."stock_unit" IS 'Unit current_stock is expressed in -- always case in the canonical model';



CREATE TABLE IF NOT EXISTS "public"."inventory_sessions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "restaurant_id" "uuid" NOT NULL,
    "inventory_list_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "status" "public"."session_status" DEFAULT 'IN_PROGRESS'::"public"."session_status" NOT NULL,
    "created_by" "uuid",
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "approved_at" timestamp with time zone,
    "approved_by" "uuid",
    "location_id" "uuid",
    "counting_par_guide_id" "uuid"
);


ALTER TABLE "public"."inventory_sessions" OWNER TO "postgres";


COMMENT ON COLUMN "public"."inventory_sessions"."counting_par_guide_id" IS 'PAR guide selected in Inventory Management for optional read-only PAR column while counting.';



CREATE TABLE IF NOT EXISTS "public"."inventory_settings" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "restaurant_id" "uuid" NOT NULL,
    "default_location_id" "uuid",
    "categories" "jsonb" DEFAULT '["Frozen", "Cooler", "Dry", "Bar", "Produce", "Dairy"]'::"jsonb" NOT NULL,
    "units" "jsonb" DEFAULT '["kg", "lb", "oz", "case", "each", "liter", "gallon"]'::"jsonb" NOT NULL,
    "auto_category_enabled" boolean DEFAULT false NOT NULL,
    "autosave_enabled" boolean DEFAULT false NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."inventory_settings" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."invitations" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "restaurant_id" "uuid" NOT NULL,
    "email" "text" NOT NULL,
    "role" "public"."app_role" DEFAULT 'STAFF'::"public"."app_role" NOT NULL,
    "token" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "status" "public"."invitation_status" DEFAULT 'PENDING'::"public"."invitation_status" NOT NULL,
    "invited_by" "uuid" NOT NULL,
    "expires_at" timestamp with time zone DEFAULT ("now"() + '7 days'::interval) NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "accepted_at" timestamp with time zone
);


ALTER TABLE "public"."invitations" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."invoice_ingestions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "restaurant_id" "uuid" NOT NULL,
    "invoice_id" "uuid" NOT NULL,
    "storage_path" "text" NOT NULL,
    "source_kind" "text" NOT NULL,
    "mime_type" "text",
    "original_filename" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "created_by" "uuid",
    CONSTRAINT "invoice_ingestions_source_kind_check" CHECK (("source_kind" = ANY (ARRAY['file'::"text", 'photo'::"text", 'email'::"text"])))
);


ALTER TABLE "public"."invoice_ingestions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."invoice_items" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "invoice_id" "uuid" NOT NULL,
    "catalog_item_id" "uuid",
    "item_name" "text" NOT NULL,
    "quantity_invoiced" numeric,
    "unit_cost" numeric,
    "total_cost" numeric,
    "unit" "text",
    "pack_size" "text",
    "brand_name" "text",
    "product_number" "text",
    "match_status" "text" DEFAULT 'unmatched'::"text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."invoice_items" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."invoice_line_comparisons" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "purchase_history_id" "uuid",
    "purchase_history_item_id" "uuid",
    "smart_order_run_id" "uuid",
    "catalog_item_id" "uuid",
    "item_name" "text" NOT NULL,
    "po_qty" numeric,
    "po_unit_cost" numeric,
    "invoiced_qty" numeric,
    "invoiced_unit_cost" numeric,
    "qty_diff" numeric GENERATED ALWAYS AS (("invoiced_qty" - "po_qty")) STORED,
    "cost_diff" numeric GENERATED ALWAYS AS (("invoiced_unit_cost" - "po_unit_cost")) STORED,
    "status" "text" DEFAULT 'ok'::"text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "received_qty" numeric,
    "po_total_cost" numeric,
    "invoiced_total_cost" numeric,
    "total_diff" numeric GENERATED ALWAYS AS (("invoiced_total_cost" - "po_total_cost")) STORED,
    "invoice_id" "uuid",
    "invoice_item_id" "uuid",
    "purchase_order_item_id" "uuid",
    "received_qty_confirmed" boolean DEFAULT false,
    CONSTRAINT "invoice_line_comparisons_invoice_or_ph_chk" CHECK ((("invoice_id" IS NOT NULL) OR ("purchase_history_id" IS NOT NULL))),
    CONSTRAINT "invoice_line_comparisons_status_check" CHECK (("status" = ANY (ARRAY['ok'::"text", 'qty_mismatch'::"text", 'price_mismatch'::"text", 'total_mismatch'::"text", 'missing_from_invoice'::"text", 'extra_on_invoice'::"text", 'unmatched'::"text", 'received_short'::"text", 'received_over'::"text"])))
);


ALTER TABLE "public"."invoice_line_comparisons" OWNER TO "postgres";


COMMENT ON COLUMN "public"."invoice_line_comparisons"."received_qty_confirmed" IS 'True only when a manager/staff explicitly confirmed the received_qty (not auto-filled from invoiced qty).';



CREATE TABLE IF NOT EXISTS "public"."invoices" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "restaurant_id" "uuid" NOT NULL,
    "purchase_order_id" "uuid",
    "vendor_name" "text",
    "invoice_number" "text",
    "invoice_date" "date",
    "location_id" "uuid",
    "invoice_subtotal" numeric,
    "invoice_tax" numeric,
    "invoice_total" numeric,
    "status" "text" DEFAULT 'draft'::"text" NOT NULL,
    "receipt_status" "text" DEFAULT 'pending'::"text",
    "pdf_url" "text",
    "created_by" "uuid",
    "confirmed_at" timestamp with time zone,
    "invoice_email" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "invoices_receipt_status_check" CHECK (("receipt_status" = ANY (ARRAY['pending'::"text", 'reviewing'::"text", 'confirmed'::"text", 'issues_reported'::"text"]))),
    CONSTRAINT "invoices_status_check" CHECK (("status" = ANY (ARRAY['draft'::"text", 'review'::"text", 'ready_to_receive'::"text", 'confirmed'::"text"])))
);


ALTER TABLE "public"."invoices" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."list_categories" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "list_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "sort_order" integer DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "category_set_id" "uuid"
);


ALTER TABLE "public"."list_categories" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."list_category_sets" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "list_id" "uuid" NOT NULL,
    "set_type" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "list_category_sets_set_type_check" CHECK (("set_type" = ANY (ARRAY['custom_ai'::"text", 'user_manual'::"text"])))
);


ALTER TABLE "public"."list_category_sets" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."list_item_category_map" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "list_id" "uuid" NOT NULL,
    "category_set_id" "uuid" NOT NULL,
    "catalog_item_id" "uuid" NOT NULL,
    "category_id" "uuid",
    "item_sort_order" integer DEFAULT 0 NOT NULL
);


ALTER TABLE "public"."list_item_category_map" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."location_settings" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "location_id" "uuid" NOT NULL,
    "brand" "text",
    "food_cost_target_pct" numeric(5,2) DEFAULT 30.0 NOT NULL,
    "count_frequency_days" integer DEFAULT 3 NOT NULL,
    "count_overdue_alert_hrs" integer DEFAULT 72 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "invoice_email" "text"
);


ALTER TABLE "public"."location_settings" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."locations" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "restaurant_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "address" "text",
    "city" "text",
    "state" "text",
    "zip" "text",
    "storage_types" "jsonb" DEFAULT '["Cooler", "Freezer", "Dry Storage", "Bar"]'::"jsonb",
    "is_default" boolean DEFAULT false NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."locations" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."notification_preferences" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "restaurant_id" "uuid" NOT NULL,
    "location_id" "uuid",
    "user_id" "uuid",
    "channel_in_app" boolean DEFAULT true NOT NULL,
    "channel_email" boolean DEFAULT true NOT NULL,
    "email_digest_mode" "public"."email_digest_mode" DEFAULT 'IMMEDIATE'::"public"."email_digest_mode" NOT NULL,
    "digest_hour" integer DEFAULT 8 NOT NULL,
    "timezone" "text" DEFAULT 'America/New_York'::"text" NOT NULL,
    "low_stock_red" boolean DEFAULT true NOT NULL,
    "low_stock_yellow" boolean DEFAULT false NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "recipients_mode" "public"."recipients_mode" DEFAULT 'OWNERS_MANAGERS'::"public"."recipients_mode" NOT NULL,
    "invoice_parsed" boolean DEFAULT true NOT NULL,
    "price_change" boolean DEFAULT true NOT NULL,
    "stock_update" boolean DEFAULT true NOT NULL
);


ALTER TABLE "public"."notification_preferences" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."notifications" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "restaurant_id" "uuid" NOT NULL,
    "location_id" "uuid",
    "user_id" "uuid" NOT NULL,
    "type" "text" NOT NULL,
    "title" "text" NOT NULL,
    "message" "text" NOT NULL,
    "severity" "public"."notification_severity" DEFAULT 'INFO'::"public"."notification_severity" NOT NULL,
    "data" "jsonb",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "read_at" timestamp with time zone,
    "emailed_at" timestamp with time zone,
    "failed_at" timestamp with time zone,
    "error_message" "text",
    "idempotency_key" "text"
);


ALTER TABLE "public"."notifications" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."order_items" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "order_id" "uuid" NOT NULL,
    "item_name" "text" NOT NULL,
    "quantity" numeric DEFAULT 0 NOT NULL,
    "unit" "text",
    "catalog_item_id" "uuid"
);


ALTER TABLE "public"."order_items" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."orders" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "restaurant_id" "uuid" NOT NULL,
    "created_by" "uuid",
    "status" "public"."order_status" DEFAULT 'PENDING'::"public"."order_status" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "location_id" "uuid"
);


ALTER TABLE "public"."orders" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."par_guide_items" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "par_guide_id" "uuid" NOT NULL,
    "item_name" "text" NOT NULL,
    "category" "text",
    "unit" "text",
    "par_level" numeric DEFAULT 0 NOT NULL,
    "brand_name" "text",
    "catalog_item_id" "uuid",
    "par_unit" "text" DEFAULT 'case'::"text"
);


ALTER TABLE "public"."par_guide_items" OWNER TO "postgres";


COMMENT ON COLUMN "public"."par_guide_items"."catalog_item_id" IS 'When set, PAR sync and suggestions prefer this inventory_catalog_items row; otherwise item_name matching is used.';



COMMENT ON COLUMN "public"."par_guide_items"."par_unit" IS 'Unit the par_level is expressed in -- always case in the canonical model';



CREATE TABLE IF NOT EXISTS "public"."par_guides" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "restaurant_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "inventory_list_id" "uuid",
    "location_id" "uuid"
);


ALTER TABLE "public"."par_guides" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."par_items" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "restaurant_id" "uuid" NOT NULL,
    "inventory_item_id" "uuid" NOT NULL,
    "category_id" "uuid" NOT NULL,
    "par_level" numeric DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."par_items" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."par_settings" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "restaurant_id" "uuid" NOT NULL,
    "default_lead_time_days" integer DEFAULT 2 NOT NULL,
    "default_reorder_threshold" numeric DEFAULT 80 NOT NULL,
    "auto_apply_last_par" boolean DEFAULT false NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."par_settings" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."profiles" (
    "id" "uuid" NOT NULL,
    "email" "text" NOT NULL,
    "full_name" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."profiles" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."purchase_history" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "restaurant_id" "uuid" NOT NULL,
    "inventory_list_id" "uuid",
    "smart_order_run_id" "uuid",
    "vendor_name" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "created_by" "uuid",
    "location_id" "uuid",
    "invoice_number" "text",
    "invoice_date" "date",
    "pdf_url" "text",
    "invoice_status" "text" DEFAULT 'COMPLETE'::"text" NOT NULL,
    "source" "text",
    "purchase_order_id" "uuid",
    "po_number" "text",
    "receipt_status" "text" DEFAULT 'pending'::"text",
    "confirmed_at" timestamp with time zone,
    "invoice_subtotal" numeric,
    "invoice_tax" numeric,
    "invoice_total" numeric,
    CONSTRAINT "purchase_history_receipt_status_check" CHECK (("receipt_status" = ANY (ARRAY['pending'::"text", 'reviewing'::"text", 'confirmed'::"text", 'issues_reported'::"text"])))
);


ALTER TABLE "public"."purchase_history" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."purchase_history_items" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "purchase_history_id" "uuid" NOT NULL,
    "item_name" "text" NOT NULL,
    "quantity" numeric DEFAULT 0 NOT NULL,
    "unit_cost" numeric,
    "total_cost" numeric,
    "pack_size" "text",
    "catalog_item_id" "uuid",
    "match_status" "text" DEFAULT 'MANUAL'::"text" NOT NULL,
    "brand_name" "text",
    "vendor_sku" "text"
);


ALTER TABLE "public"."purchase_history_items" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."purchase_order_items" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "purchase_order_id" "uuid" NOT NULL,
    "catalog_item_id" "uuid",
    "smart_order_run_item_id" "uuid",
    "item_name" "text" NOT NULL,
    "quantity_ordered" numeric,
    "unit_cost" numeric,
    "total_cost" numeric,
    "pack_size" "text",
    "brand_name" "text",
    "product_number" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."purchase_order_items" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."purchase_orders" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "restaurant_id" "uuid" NOT NULL,
    "smart_order_run_id" "uuid",
    "po_number" "text",
    "vendor_name" "text",
    "status" "text" DEFAULT 'draft'::"text" NOT NULL,
    "notes" "text",
    "created_by" "uuid",
    "submitted_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "location_id" "uuid",
    "created_from_session_id" "uuid",
    "inventory_list_id" "uuid",
    CONSTRAINT "purchase_orders_status_check" CHECK (("status" = ANY (ARRAY['draft'::"text", 'submitted'::"text", 'partially_received'::"text", 'closed'::"text", 'cancelled'::"text"])))
);


ALTER TABLE "public"."purchase_orders" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."reminder_targets" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "reminder_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL
);


ALTER TABLE "public"."reminder_targets" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."reminders" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "restaurant_id" "uuid" NOT NULL,
    "location_id" "uuid",
    "created_by" "uuid",
    "name" "text" NOT NULL,
    "days_of_week" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "time_of_day" "text" DEFAULT '21:00'::"text" NOT NULL,
    "timezone" "text" DEFAULT 'America/New_York'::"text" NOT NULL,
    "is_enabled" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "recipients_mode" "public"."recipients_mode" DEFAULT 'OWNERS_MANAGERS'::"public"."recipients_mode" NOT NULL,
    "inventory_list_id" "uuid",
    "auto_create_session" boolean DEFAULT false NOT NULL,
    "reminder_lead_minutes" integer DEFAULT 60 NOT NULL,
    "lock_after_hours" integer
);


ALTER TABLE "public"."reminders" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."restaurant_counters" (
    "restaurant_id" "uuid" NOT NULL,
    "po_sequence" bigint DEFAULT 0 NOT NULL
);


ALTER TABLE "public"."restaurant_counters" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."restaurant_members" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "restaurant_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "role" "public"."app_role" DEFAULT 'STAFF'::"public"."app_role" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "default_location_id" "uuid"
);


ALTER TABLE "public"."restaurant_members" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."restaurant_settings" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "restaurant_id" "uuid" NOT NULL,
    "business_email" "text",
    "phone" "text",
    "address" "text",
    "currency" "text" DEFAULT 'USD'::"text" NOT NULL,
    "timezone" "text" DEFAULT 'America/New_York'::"text" NOT NULL,
    "date_format" "text" DEFAULT 'MM/DD/YYYY'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "logo_url" "text",
    "invoice_email" "text"
);


ALTER TABLE "public"."restaurant_settings" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."smart_order_run_items" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "run_id" "uuid" NOT NULL,
    "item_name" "text" NOT NULL,
    "suggested_order" numeric DEFAULT 0 NOT NULL,
    "risk" "text" DEFAULT 'GREEN'::"text" NOT NULL,
    "current_stock" numeric DEFAULT 0 NOT NULL,
    "par_level" numeric DEFAULT 0 NOT NULL,
    "unit_cost" numeric,
    "pack_size" "text",
    "brand_name" "text",
    "catalog_item_id" "uuid"
);


ALTER TABLE "public"."smart_order_run_items" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."smart_order_runs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "restaurant_id" "uuid" NOT NULL,
    "session_id" "uuid" NOT NULL,
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "inventory_list_id" "uuid",
    "par_guide_id" "uuid",
    "location_id" "uuid",
    "status" "text" DEFAULT 'draft'::"text" NOT NULL,
    "submitted_at" timestamp with time zone,
    "po_number" "text"
);


ALTER TABLE "public"."smart_order_runs" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."smart_order_settings" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "restaurant_id" "uuid" NOT NULL,
    "auto_create_purchase_history" boolean DEFAULT true NOT NULL,
    "auto_calculate_cost" boolean DEFAULT true NOT NULL,
    "red_threshold" numeric DEFAULT 50 NOT NULL,
    "yellow_threshold" numeric DEFAULT 100 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."smart_order_settings" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."stock_movements" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "restaurant_id" "uuid" NOT NULL,
    "catalog_item_id" "uuid" NOT NULL,
    "movement_type" "text" NOT NULL,
    "quantity" numeric NOT NULL,
    "reference_type" "text",
    "reference_id" "uuid",
    "invoice_id" "uuid",
    "invoice_item_id" "uuid",
    "notes" "text",
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "location_id" "uuid",
    "quantity_unit" "text" DEFAULT 'case'::"text",
    "source_quantity" numeric,
    "source_quantity_unit" "text",
    "conversion_status" "text" DEFAULT 'converted_to_case'::"text",
    CONSTRAINT "stock_movements_movement_type_check" CHECK (("movement_type" = ANY (ARRAY['receive'::"text", 'waste'::"text", 'adjustment'::"text"])))
);


ALTER TABLE "public"."stock_movements" OWNER TO "postgres";


COMMENT ON TABLE "public"."stock_movements" IS 'Future inventory ledger for real-time stock tracking
   across locations. Currently empty — do not drop.
   Will become the source of truth for current_stock
   once ledger mode is active in a future sprint.';



COMMENT ON COLUMN "public"."stock_movements"."quantity" IS 'Normalized quantity in CASES — canonical unit for all inventory math.';



COMMENT ON COLUMN "public"."stock_movements"."quantity_unit" IS 'Always ''case'' for movements created by confirm_invoice_receipt.';



COMMENT ON COLUMN "public"."stock_movements"."source_quantity" IS 'Original received quantity as entered/stored (may be in lbs, each, etc.).';



COMMENT ON COLUMN "public"."stock_movements"."source_quantity_unit" IS 'Unit of source_quantity (CS, LB, EA, …).';



COMMENT ON COLUMN "public"."stock_movements"."conversion_status" IS 'converted_to_case | passthrough_case | conversion_failed.';



CREATE TABLE IF NOT EXISTS "public"."usage_events" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "restaurant_id" "uuid" NOT NULL,
    "item_name" "text" NOT NULL,
    "order_id" "uuid",
    "quantity_used" numeric DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."usage_events" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."user_invites" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "restaurant_id" "uuid" NOT NULL,
    "email" "text" NOT NULL,
    "role" "public"."app_role" NOT NULL,
    "location_id" "uuid" NOT NULL,
    "can_approve_orders" boolean DEFAULT true NOT NULL,
    "can_see_costs" boolean DEFAULT false NOT NULL,
    "can_see_food_cost_pct" boolean DEFAULT true NOT NULL,
    "can_see_inventory_value" boolean DEFAULT false NOT NULL,
    "can_edit_par" boolean DEFAULT true NOT NULL,
    "order_approval_threshold" numeric(10,2),
    "status" "public"."invitation_status" DEFAULT 'PENDING'::"public"."invitation_status" NOT NULL,
    "invited_by" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "accepted_at" timestamp with time zone,
    CONSTRAINT "user_invites_role_chk" CHECK (("role" = ANY (ARRAY['MANAGER'::"public"."app_role", 'STAFF'::"public"."app_role"])))
);


ALTER TABLE "public"."user_invites" OWNER TO "postgres";


COMMENT ON TABLE "public"."user_invites" IS 'Owner-created invites; accept_user_invites() applies membership + ULA on login.';



CREATE TABLE IF NOT EXISTS "public"."user_location_assignments" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "location_id" "uuid" NOT NULL,
    "role" "public"."app_role" DEFAULT 'STAFF'::"public"."app_role" NOT NULL,
    "is_primary" boolean DEFAULT false NOT NULL,
    "can_approve_orders" boolean DEFAULT true NOT NULL,
    "can_see_costs" boolean DEFAULT false NOT NULL,
    "can_see_food_cost_pct" boolean DEFAULT true NOT NULL,
    "can_see_inventory_value" boolean DEFAULT false NOT NULL,
    "can_edit_par" boolean DEFAULT true NOT NULL,
    "order_approval_threshold" numeric(10,2) DEFAULT NULL::numeric,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."user_location_assignments" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."user_ui_state" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "selected_restaurant_id" "uuid",
    "selected_location_id" "uuid",
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."user_ui_state" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."vendor_integrations" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "restaurant_id" "uuid" NOT NULL,
    "location_id" "uuid",
    "vendor_name" "text" NOT NULL,
    "api_key_encrypted" "text",
    "account_id" "text",
    "customer_number" "text",
    "is_enabled" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."vendor_integrations" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."vendor_item_mappings" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "restaurant_id" "uuid" NOT NULL,
    "vendor_name" "text" NOT NULL,
    "vendor_sku" "text",
    "vendor_item_name" "text" NOT NULL,
    "catalog_item_id" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "purchase_unit" "text",
    "units_per_case_override" numeric,
    "total_per_case_override" numeric,
    "is_catch_weight" boolean DEFAULT false NOT NULL,
    "conversion_notes" "text",
    "confidence" "text" DEFAULT 'UNKNOWN'::"text" NOT NULL,
    "verified_at" timestamp with time zone,
    "verified_by" "uuid"
);


ALTER TABLE "public"."vendor_item_mappings" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."waste_log" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "restaurant_id" "uuid" NOT NULL,
    "item_name" "text" NOT NULL,
    "quantity" numeric NOT NULL,
    "reason" "text" NOT NULL,
    "notes" "text",
    "logged_by" "uuid" NOT NULL,
    "logged_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "location_id" "uuid",
    "quantity_unit" "text" DEFAULT 'case'::"text",
    CONSTRAINT "waste_log_quantity_check" CHECK (("quantity" > (0)::numeric))
);


ALTER TABLE "public"."waste_log" OWNER TO "postgres";


COMMENT ON COLUMN "public"."waste_log"."quantity_unit" IS 'Unit the quantity was entered in when logging waste (case, lb, each, etc.)';



CREATE TABLE IF NOT EXISTS "public"."weekly_sales" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "restaurant_id" "uuid" NOT NULL,
    "location_id" "uuid" NOT NULL,
    "week_start" "date" NOT NULL,
    "gross_sales" numeric(12,2) NOT NULL,
    "net_sales" numeric(12,2),
    "comps" numeric(12,2) DEFAULT 0 NOT NULL,
    "discounts" numeric(12,2) DEFAULT 0 NOT NULL,
    "tax" numeric(12,2) DEFAULT 0 NOT NULL,
    "entry_method" "text" DEFAULT 'manual_weekly'::"text" NOT NULL,
    "is_partial" boolean DEFAULT false NOT NULL,
    "entered_by_user_id" "uuid" NOT NULL,
    "entered_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "weekly_sales_comps_check" CHECK (("comps" >= (0)::numeric)),
    CONSTRAINT "weekly_sales_entry_method_check" CHECK (("entry_method" = ANY (ARRAY['manual_weekly'::"text", 'manual_daily_aggregated'::"text", 'csv'::"text", 'email_in'::"text", 'pos_api'::"text"]))),
    CONSTRAINT "weekly_sales_gross_sales_check" CHECK (("gross_sales" >= (0)::numeric)),
    CONSTRAINT "weekly_sales_net_sales_check" CHECK ((("net_sales" IS NULL) OR ("net_sales" >= (0)::numeric)))
);


ALTER TABLE "public"."weekly_sales" OWNER TO "postgres";


ALTER TABLE ONLY "public"."alert_recipients"
    ADD CONSTRAINT "alert_recipients_notification_pref_id_user_id_key" UNIQUE ("notification_pref_id", "user_id");



ALTER TABLE ONLY "public"."alert_recipients"
    ADD CONSTRAINT "alert_recipients_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."categories"
    ADD CONSTRAINT "categories_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."categories"
    ADD CONSTRAINT "categories_restaurant_id_name_key" UNIQUE ("restaurant_id", "name");



ALTER TABLE ONLY "public"."custom_list_items"
    ADD CONSTRAINT "custom_list_items_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."custom_lists"
    ADD CONSTRAINT "custom_lists_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."daily_sales"
    ADD CONSTRAINT "daily_sales_location_id_sale_date_key" UNIQUE ("location_id", "sale_date");



ALTER TABLE ONLY "public"."daily_sales"
    ADD CONSTRAINT "daily_sales_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."delivery_issues"
    ADD CONSTRAINT "delivery_issues_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."failed_inbound_emails"
    ADD CONSTRAINT "failed_inbound_emails_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."import_runs"
    ADD CONSTRAINT "import_runs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."import_templates"
    ADD CONSTRAINT "import_templates_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."inventory_catalog_items"
    ADD CONSTRAINT "inventory_catalog_items_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."inventory_import_files"
    ADD CONSTRAINT "inventory_import_files_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."inventory_items"
    ADD CONSTRAINT "inventory_items_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."inventory_lists"
    ADD CONSTRAINT "inventory_lists_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."inventory_session_item_zones"
    ADD CONSTRAINT "inventory_session_item_zones_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."inventory_session_item_zones"
    ADD CONSTRAINT "inventory_session_item_zones_unique_session_category" UNIQUE ("session_item_id", "list_category_id");



ALTER TABLE ONLY "public"."inventory_session_items"
    ADD CONSTRAINT "inventory_session_items_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."inventory_sessions"
    ADD CONSTRAINT "inventory_sessions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."inventory_settings"
    ADD CONSTRAINT "inventory_settings_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."inventory_settings"
    ADD CONSTRAINT "inventory_settings_restaurant_id_key" UNIQUE ("restaurant_id");



ALTER TABLE ONLY "public"."invitations"
    ADD CONSTRAINT "invitations_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."invitations"
    ADD CONSTRAINT "invitations_restaurant_id_email_status_key" UNIQUE ("restaurant_id", "email", "status");



ALTER TABLE ONLY "public"."invoice_ingestions"
    ADD CONSTRAINT "invoice_ingestions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."invoice_items"
    ADD CONSTRAINT "invoice_items_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."invoice_line_comparisons"
    ADD CONSTRAINT "invoice_line_comparisons_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."invoices"
    ADD CONSTRAINT "invoices_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."list_categories"
    ADD CONSTRAINT "list_categories_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."list_category_sets"
    ADD CONSTRAINT "list_category_sets_list_id_set_type_key" UNIQUE ("list_id", "set_type");



ALTER TABLE ONLY "public"."list_category_sets"
    ADD CONSTRAINT "list_category_sets_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."list_item_category_map"
    ADD CONSTRAINT "list_item_category_map_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."location_settings"
    ADD CONSTRAINT "location_settings_location_id_key" UNIQUE ("location_id");



ALTER TABLE ONLY "public"."location_settings"
    ADD CONSTRAINT "location_settings_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."locations"
    ADD CONSTRAINT "locations_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."notification_preferences"
    ADD CONSTRAINT "notification_preferences_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."notifications"
    ADD CONSTRAINT "notifications_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."order_items"
    ADD CONSTRAINT "order_items_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."orders"
    ADD CONSTRAINT "orders_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."par_guide_items"
    ADD CONSTRAINT "par_guide_items_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."par_guides"
    ADD CONSTRAINT "par_guides_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."par_items"
    ADD CONSTRAINT "par_items_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."par_items"
    ADD CONSTRAINT "par_items_restaurant_id_inventory_item_id_key" UNIQUE ("restaurant_id", "inventory_item_id");



ALTER TABLE ONLY "public"."par_settings"
    ADD CONSTRAINT "par_settings_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."par_settings"
    ADD CONSTRAINT "par_settings_restaurant_id_key" UNIQUE ("restaurant_id");



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."purchase_history_items"
    ADD CONSTRAINT "purchase_history_items_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."purchase_history"
    ADD CONSTRAINT "purchase_history_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."purchase_order_items"
    ADD CONSTRAINT "purchase_order_items_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."purchase_orders"
    ADD CONSTRAINT "purchase_orders_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."reminder_targets"
    ADD CONSTRAINT "reminder_targets_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."reminders"
    ADD CONSTRAINT "reminders_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."restaurant_counters"
    ADD CONSTRAINT "restaurant_counters_pkey" PRIMARY KEY ("restaurant_id");



ALTER TABLE ONLY "public"."restaurant_members"
    ADD CONSTRAINT "restaurant_members_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."restaurant_members"
    ADD CONSTRAINT "restaurant_members_user_id_restaurant_id_key" UNIQUE ("user_id", "restaurant_id");



ALTER TABLE ONLY "public"."restaurant_settings"
    ADD CONSTRAINT "restaurant_settings_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."restaurant_settings"
    ADD CONSTRAINT "restaurant_settings_restaurant_id_key" UNIQUE ("restaurant_id");



ALTER TABLE ONLY "public"."restaurants"
    ADD CONSTRAINT "restaurants_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."smart_order_run_items"
    ADD CONSTRAINT "smart_order_run_items_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."smart_order_runs"
    ADD CONSTRAINT "smart_order_runs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."smart_order_runs"
    ADD CONSTRAINT "smart_order_runs_po_number_key" UNIQUE ("po_number");



ALTER TABLE ONLY "public"."smart_order_settings"
    ADD CONSTRAINT "smart_order_settings_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."smart_order_settings"
    ADD CONSTRAINT "smart_order_settings_restaurant_id_key" UNIQUE ("restaurant_id");



ALTER TABLE ONLY "public"."stock_movements"
    ADD CONSTRAINT "stock_movements_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."purchase_history"
    ADD CONSTRAINT "uq_purchase_history_smart_order_run" UNIQUE ("restaurant_id", "smart_order_run_id");



ALTER TABLE ONLY "public"."usage_events"
    ADD CONSTRAINT "usage_events_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."user_invites"
    ADD CONSTRAINT "user_invites_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."user_location_assignments"
    ADD CONSTRAINT "user_location_assignments_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."user_location_assignments"
    ADD CONSTRAINT "user_location_assignments_user_id_location_id_key" UNIQUE ("user_id", "location_id");



ALTER TABLE ONLY "public"."user_ui_state"
    ADD CONSTRAINT "user_ui_state_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."user_ui_state"
    ADD CONSTRAINT "user_ui_state_user_id_key" UNIQUE ("user_id");



ALTER TABLE ONLY "public"."vendor_integrations"
    ADD CONSTRAINT "vendor_integrations_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."vendor_item_mappings"
    ADD CONSTRAINT "vendor_item_mappings_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."vendor_item_mappings"
    ADD CONSTRAINT "vendor_item_mappings_restaurant_id_vendor_name_vendor_item__key" UNIQUE ("restaurant_id", "vendor_name", "vendor_item_name");



ALTER TABLE ONLY "public"."waste_log"
    ADD CONSTRAINT "waste_log_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."weekly_sales"
    ADD CONSTRAINT "weekly_sales_location_id_week_start_key" UNIQUE ("location_id", "week_start");



ALTER TABLE ONLY "public"."weekly_sales"
    ADD CONSTRAINT "weekly_sales_pkey" PRIMARY KEY ("id");



CREATE INDEX "idx_alert_recipients_notification_pref_id" ON "public"."alert_recipients" USING "btree" ("notification_pref_id");



CREATE INDEX "idx_catalog_items_product_number" ON "public"."inventory_catalog_items" USING "btree" ("product_number");



CREATE INDEX "idx_catalog_items_sort_order" ON "public"."inventory_catalog_items" USING "btree" ("inventory_list_id", "sort_order");



CREATE INDEX "idx_categories_restaurant" ON "public"."categories" USING "btree" ("restaurant_id", "sort_order");



CREATE INDEX "idx_daily_sales_restaurant_location_date" ON "public"."daily_sales" USING "btree" ("restaurant_id", "location_id", "sale_date" DESC);



CREATE INDEX "idx_delivery_issues_invoice_id" ON "public"."delivery_issues" USING "btree" ("invoice_id");



CREATE INDEX "idx_delivery_issues_purchase_history_id" ON "public"."delivery_issues" USING "btree" ("purchase_history_id");



CREATE INDEX "idx_inventory_items_restaurant_category" ON "public"."inventory_items" USING "btree" ("restaurant_id", "category_id", "sort_order");



CREATE INDEX "idx_inventory_session_item_zones_list_category_id" ON "public"."inventory_session_item_zones" USING "btree" ("list_category_id");



CREATE INDEX "idx_inventory_session_item_zones_session_item_id" ON "public"."inventory_session_item_zones" USING "btree" ("session_item_id");



CREATE INDEX "idx_inventory_sessions_counting_par_guide_id" ON "public"."inventory_sessions" USING "btree" ("counting_par_guide_id");



CREATE INDEX "idx_invitations_email" ON "public"."invitations" USING "btree" ("email");



CREATE INDEX "idx_invitations_token" ON "public"."invitations" USING "btree" ("token");



CREATE INDEX "idx_invoice_items_catalog" ON "public"."invoice_items" USING "btree" ("catalog_item_id");



CREATE INDEX "idx_invoice_items_invoice" ON "public"."invoice_items" USING "btree" ("invoice_id");



CREATE INDEX "idx_invoice_line_comparisons_invoice_id" ON "public"."invoice_line_comparisons" USING "btree" ("invoice_id");



CREATE INDEX "idx_invoice_line_comparisons_invoice_item_id" ON "public"."invoice_line_comparisons" USING "btree" ("invoice_item_id");



CREATE INDEX "idx_invoice_line_comparisons_purchase_history_id" ON "public"."invoice_line_comparisons" USING "btree" ("purchase_history_id");



CREATE INDEX "idx_invoices_purchase_order_id" ON "public"."invoices" USING "btree" ("purchase_order_id");



CREATE INDEX "idx_invoices_restaurant_id" ON "public"."invoices" USING "btree" ("restaurant_id");



CREATE INDEX "idx_invoices_status" ON "public"."invoices" USING "btree" ("restaurant_id", "status");



CREATE UNIQUE INDEX "idx_list_item_category_map_unique" ON "public"."list_item_category_map" USING "btree" ("category_set_id", "catalog_item_id");



CREATE INDEX "idx_location_settings_location_id" ON "public"."location_settings" USING "btree" ("location_id");



CREATE INDEX "idx_notifications_restaurant_id_type" ON "public"."notifications" USING "btree" ("restaurant_id", "type");



CREATE INDEX "idx_notifications_user_id_read_at" ON "public"."notifications" USING "btree" ("user_id", "read_at" DESC NULLS LAST);



CREATE INDEX "idx_par_guide_items_catalog_item_id" ON "public"."par_guide_items" USING "btree" ("catalog_item_id") WHERE ("catalog_item_id" IS NOT NULL);



CREATE INDEX "idx_par_items_restaurant" ON "public"."par_items" USING "btree" ("restaurant_id");



CREATE INDEX "idx_po_location_id" ON "public"."purchase_orders" USING "btree" ("location_id");



CREATE INDEX "idx_purchase_history_po_number" ON "public"."purchase_history" USING "btree" ("po_number");



CREATE INDEX "idx_purchase_history_purchase_order_id" ON "public"."purchase_history" USING "btree" ("purchase_order_id");



CREATE INDEX "idx_purchase_order_items_catalog" ON "public"."purchase_order_items" USING "btree" ("catalog_item_id");



CREATE INDEX "idx_purchase_order_items_po" ON "public"."purchase_order_items" USING "btree" ("purchase_order_id");



CREATE INDEX "idx_purchase_orders_inventory_list_id" ON "public"."purchase_orders" USING "btree" ("inventory_list_id") WHERE ("inventory_list_id" IS NOT NULL);



CREATE INDEX "idx_purchase_orders_po_number" ON "public"."purchase_orders" USING "btree" ("po_number");



CREATE INDEX "idx_purchase_orders_restaurant_id" ON "public"."purchase_orders" USING "btree" ("restaurant_id");



CREATE INDEX "idx_purchase_orders_status" ON "public"."purchase_orders" USING "btree" ("restaurant_id", "status");



CREATE INDEX "idx_smart_order_run_items_run_id" ON "public"."smart_order_run_items" USING "btree" ("run_id");



CREATE INDEX "idx_stock_movements_catalog_item_id" ON "public"."stock_movements" USING "btree" ("catalog_item_id");



CREATE INDEX "idx_stock_movements_invoice" ON "public"."stock_movements" USING "btree" ("invoice_id");



CREATE INDEX "idx_stock_movements_location_id" ON "public"."stock_movements" USING "btree" ("location_id");



CREATE INDEX "idx_stock_movements_restaurant_catalog" ON "public"."stock_movements" USING "btree" ("restaurant_id", "catalog_item_id");



CREATE INDEX "idx_ula_location_id" ON "public"."user_location_assignments" USING "btree" ("location_id");



CREATE INDEX "idx_ula_primary" ON "public"."user_location_assignments" USING "btree" ("user_id", "is_primary") WHERE ("is_primary" = true);



CREATE INDEX "idx_ula_user_id" ON "public"."user_location_assignments" USING "btree" ("user_id");



CREATE INDEX "idx_user_invites_email_pending" ON "public"."user_invites" USING "btree" ("lower"("email")) WHERE ("status" = 'PENDING'::"public"."invitation_status");



CREATE INDEX "idx_vendor_item_mappings_catalog" ON "public"."vendor_item_mappings" USING "btree" ("restaurant_id", "catalog_item_id");



CREATE INDEX "idx_vendor_item_mappings_restaurant_vendor" ON "public"."vendor_item_mappings" USING "btree" ("restaurant_id", "vendor_name");



CREATE INDEX "idx_waste_log_location_id" ON "public"."waste_log" USING "btree" ("location_id");



CREATE INDEX "idx_weekly_sales_restaurant_location_week" ON "public"."weekly_sales" USING "btree" ("restaurant_id", "location_id", "week_start" DESC);



CREATE INDEX "invoice_ingestions_invoice_id_idx" ON "public"."invoice_ingestions" USING "btree" ("invoice_id");



CREATE INDEX "invoice_ingestions_restaurant_id_idx" ON "public"."invoice_ingestions" USING "btree" ("restaurant_id");



CREATE UNIQUE INDEX "location_settings_invoice_email_key" ON "public"."location_settings" USING "btree" ("invoice_email") WHERE ("invoice_email" IS NOT NULL);



CREATE UNIQUE INDEX "restaurant_settings_invoice_email_key" ON "public"."restaurant_settings" USING "btree" ("invoice_email") WHERE ("invoice_email" IS NOT NULL);



CREATE UNIQUE INDEX "uq_ilc_invoice_invoice_item" ON "public"."invoice_line_comparisons" USING "btree" ("invoice_id", "invoice_item_id") WHERE ("invoice_item_id" IS NOT NULL);



CREATE UNIQUE INDEX "uq_invoices_restaurant_vendor_number" ON "public"."invoices" USING "btree" ("restaurant_id", "vendor_name", "invoice_number") WHERE (("invoice_number" IS NOT NULL) AND ("vendor_name" IS NOT NULL));



CREATE UNIQUE INDEX "uq_notifications_delivery_issue_per_user" ON "public"."notifications" USING "btree" ("user_id", (("data" ->> 'purchase_history_id'::"text"))) WHERE ("type" = 'DELIVERY_ISSUE'::"text");



CREATE UNIQUE INDEX "uq_notifications_idempotency_key" ON "public"."notifications" USING "btree" ("idempotency_key") WHERE ("idempotency_key" IS NOT NULL);



CREATE UNIQUE INDEX "uq_stock_movements_receive_per_invoice_item" ON "public"."stock_movements" USING "btree" ("invoice_item_id") WHERE (("movement_type" = 'receive'::"text") AND ("invoice_item_id" IS NOT NULL));



CREATE UNIQUE INDEX "uq_user_invites_pending_restaurant_email" ON "public"."user_invites" USING "btree" ("restaurant_id", "lower"("email")) WHERE ("status" = 'PENDING'::"public"."invitation_status");



CREATE UNIQUE INDEX "uq_vendor_item_mappings_sku" ON "public"."vendor_item_mappings" USING "btree" ("restaurant_id", "vendor_name", "vendor_sku") WHERE ("vendor_sku" IS NOT NULL);



CREATE INDEX "waste_log_restaurant_logged_at" ON "public"."waste_log" USING "btree" ("restaurant_id", "logged_at" DESC);



CREATE OR REPLACE TRIGGER "daily_sales_set_updated_at" BEFORE UPDATE ON "public"."daily_sales" FOR EACH ROW EXECUTE FUNCTION "public"."set_sales_updated_at"();



CREATE OR REPLACE TRIGGER "daily_to_weekly_agg" AFTER INSERT OR DELETE OR UPDATE ON "public"."daily_sales" FOR EACH ROW EXECUTE FUNCTION "public"."aggregate_daily_to_weekly"();



CREATE OR REPLACE TRIGGER "on_user_created_accept_invitations" AFTER INSERT ON "public"."profiles" FOR EACH ROW EXECUTE FUNCTION "public"."accept_pending_invitations"();



CREATE OR REPLACE TRIGGER "sync_par_category_on_item_update" AFTER UPDATE ON "public"."inventory_items" FOR EACH ROW EXECUTE FUNCTION "public"."sync_par_item_category"();



CREATE OR REPLACE TRIGGER "trg_create_default_notification_preferences" AFTER INSERT ON "public"."restaurants" FOR EACH ROW EXECUTE FUNCTION "public"."create_default_notification_preferences"();



CREATE OR REPLACE TRIGGER "trg_session_item_version" BEFORE UPDATE ON "public"."inventory_session_items" FOR EACH ROW EXECUTE FUNCTION "public"."increment_session_item_version"();



CREATE OR REPLACE TRIGGER "trg_sync_catalog_price_on_receive" AFTER INSERT ON "public"."stock_movements" FOR EACH ROW EXECUTE FUNCTION "public"."sync_catalog_price_on_receive"();



CREATE OR REPLACE TRIGGER "weekly_sales_set_updated_at" BEFORE UPDATE ON "public"."weekly_sales" FOR EACH ROW EXECUTE FUNCTION "public"."set_sales_updated_at"();



ALTER TABLE ONLY "public"."alert_recipients"
    ADD CONSTRAINT "alert_recipients_notification_pref_id_fkey" FOREIGN KEY ("notification_pref_id") REFERENCES "public"."notification_preferences"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."categories"
    ADD CONSTRAINT "categories_restaurant_id_fkey" FOREIGN KEY ("restaurant_id") REFERENCES "public"."restaurants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."custom_list_items"
    ADD CONSTRAINT "custom_list_items_list_id_fkey" FOREIGN KEY ("list_id") REFERENCES "public"."custom_lists"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."custom_lists"
    ADD CONSTRAINT "custom_lists_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."custom_lists"
    ADD CONSTRAINT "custom_lists_restaurant_id_fkey" FOREIGN KEY ("restaurant_id") REFERENCES "public"."restaurants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."daily_sales"
    ADD CONSTRAINT "daily_sales_entered_by_user_id_fkey" FOREIGN KEY ("entered_by_user_id") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."daily_sales"
    ADD CONSTRAINT "daily_sales_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."daily_sales"
    ADD CONSTRAINT "daily_sales_restaurant_id_fkey" FOREIGN KEY ("restaurant_id") REFERENCES "public"."restaurants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."delivery_issues"
    ADD CONSTRAINT "delivery_issues_catalog_item_id_fkey" FOREIGN KEY ("catalog_item_id") REFERENCES "public"."inventory_catalog_items"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."delivery_issues"
    ADD CONSTRAINT "delivery_issues_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."delivery_issues"
    ADD CONSTRAINT "delivery_issues_invoice_line_comparison_id_fkey" FOREIGN KEY ("invoice_line_comparison_id") REFERENCES "public"."invoice_line_comparisons"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."delivery_issues"
    ADD CONSTRAINT "delivery_issues_purchase_history_id_fkey" FOREIGN KEY ("purchase_history_id") REFERENCES "public"."purchase_history"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."import_runs"
    ADD CONSTRAINT "import_runs_inventory_list_id_fkey" FOREIGN KEY ("inventory_list_id") REFERENCES "public"."inventory_lists"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."import_runs"
    ADD CONSTRAINT "import_runs_restaurant_id_fkey" FOREIGN KEY ("restaurant_id") REFERENCES "public"."restaurants"("id");



ALTER TABLE ONLY "public"."import_runs"
    ADD CONSTRAINT "import_runs_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "public"."import_templates"("id");



ALTER TABLE ONLY "public"."import_templates"
    ADD CONSTRAINT "import_templates_inventory_list_id_fkey" FOREIGN KEY ("inventory_list_id") REFERENCES "public"."inventory_lists"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."import_templates"
    ADD CONSTRAINT "import_templates_restaurant_id_fkey" FOREIGN KEY ("restaurant_id") REFERENCES "public"."restaurants"("id");



ALTER TABLE ONLY "public"."inventory_catalog_items"
    ADD CONSTRAINT "inventory_catalog_items_inventory_list_id_fkey" FOREIGN KEY ("inventory_list_id") REFERENCES "public"."inventory_lists"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."inventory_catalog_items"
    ADD CONSTRAINT "inventory_catalog_items_list_category_id_fkey" FOREIGN KEY ("list_category_id") REFERENCES "public"."list_categories"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."inventory_catalog_items"
    ADD CONSTRAINT "inventory_catalog_items_restaurant_id_fkey" FOREIGN KEY ("restaurant_id") REFERENCES "public"."restaurants"("id");



ALTER TABLE ONLY "public"."inventory_import_files"
    ADD CONSTRAINT "inventory_import_files_inventory_list_id_fkey" FOREIGN KEY ("inventory_list_id") REFERENCES "public"."inventory_lists"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."inventory_import_files"
    ADD CONSTRAINT "inventory_import_files_restaurant_id_fkey" FOREIGN KEY ("restaurant_id") REFERENCES "public"."restaurants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."inventory_items"
    ADD CONSTRAINT "inventory_items_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."inventory_items"
    ADD CONSTRAINT "inventory_items_restaurant_id_fkey" FOREIGN KEY ("restaurant_id") REFERENCES "public"."restaurants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."inventory_lists"
    ADD CONSTRAINT "inventory_lists_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."inventory_lists"
    ADD CONSTRAINT "inventory_lists_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."inventory_lists"
    ADD CONSTRAINT "inventory_lists_restaurant_id_fkey" FOREIGN KEY ("restaurant_id") REFERENCES "public"."restaurants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."inventory_session_item_zones"
    ADD CONSTRAINT "inventory_session_item_zones_list_category_id_fkey" FOREIGN KEY ("list_category_id") REFERENCES "public"."list_categories"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."inventory_session_item_zones"
    ADD CONSTRAINT "inventory_session_item_zones_session_item_id_fkey" FOREIGN KEY ("session_item_id") REFERENCES "public"."inventory_session_items"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."inventory_session_items"
    ADD CONSTRAINT "inventory_session_items_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "public"."inventory_sessions"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."inventory_sessions"
    ADD CONSTRAINT "inventory_sessions_approved_by_fkey" FOREIGN KEY ("approved_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."inventory_sessions"
    ADD CONSTRAINT "inventory_sessions_counting_par_guide_id_fkey" FOREIGN KEY ("counting_par_guide_id") REFERENCES "public"."par_guides"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."inventory_sessions"
    ADD CONSTRAINT "inventory_sessions_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."inventory_sessions"
    ADD CONSTRAINT "inventory_sessions_inventory_list_id_fkey" FOREIGN KEY ("inventory_list_id") REFERENCES "public"."inventory_lists"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."inventory_sessions"
    ADD CONSTRAINT "inventory_sessions_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."inventory_sessions"
    ADD CONSTRAINT "inventory_sessions_restaurant_id_fkey" FOREIGN KEY ("restaurant_id") REFERENCES "public"."restaurants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."inventory_settings"
    ADD CONSTRAINT "inventory_settings_default_location_id_fkey" FOREIGN KEY ("default_location_id") REFERENCES "public"."locations"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."inventory_settings"
    ADD CONSTRAINT "inventory_settings_restaurant_id_fkey" FOREIGN KEY ("restaurant_id") REFERENCES "public"."restaurants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."invitations"
    ADD CONSTRAINT "invitations_restaurant_id_fkey" FOREIGN KEY ("restaurant_id") REFERENCES "public"."restaurants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."invoice_ingestions"
    ADD CONSTRAINT "invoice_ingestions_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."invoice_ingestions"
    ADD CONSTRAINT "invoice_ingestions_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."invoice_ingestions"
    ADD CONSTRAINT "invoice_ingestions_restaurant_id_fkey" FOREIGN KEY ("restaurant_id") REFERENCES "public"."restaurants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."invoice_items"
    ADD CONSTRAINT "invoice_items_catalog_item_id_fkey" FOREIGN KEY ("catalog_item_id") REFERENCES "public"."inventory_catalog_items"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."invoice_items"
    ADD CONSTRAINT "invoice_items_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."invoice_line_comparisons"
    ADD CONSTRAINT "invoice_line_comparisons_catalog_item_id_fkey" FOREIGN KEY ("catalog_item_id") REFERENCES "public"."inventory_catalog_items"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."invoice_line_comparisons"
    ADD CONSTRAINT "invoice_line_comparisons_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."invoice_line_comparisons"
    ADD CONSTRAINT "invoice_line_comparisons_invoice_item_id_fkey" FOREIGN KEY ("invoice_item_id") REFERENCES "public"."invoice_items"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."invoice_line_comparisons"
    ADD CONSTRAINT "invoice_line_comparisons_purchase_history_id_fkey" FOREIGN KEY ("purchase_history_id") REFERENCES "public"."purchase_history"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."invoice_line_comparisons"
    ADD CONSTRAINT "invoice_line_comparisons_purchase_history_item_id_fkey" FOREIGN KEY ("purchase_history_item_id") REFERENCES "public"."purchase_history_items"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."invoice_line_comparisons"
    ADD CONSTRAINT "invoice_line_comparisons_purchase_order_item_id_fkey" FOREIGN KEY ("purchase_order_item_id") REFERENCES "public"."purchase_order_items"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."invoice_line_comparisons"
    ADD CONSTRAINT "invoice_line_comparisons_smart_order_run_id_fkey" FOREIGN KEY ("smart_order_run_id") REFERENCES "public"."smart_order_runs"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."invoices"
    ADD CONSTRAINT "invoices_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."invoices"
    ADD CONSTRAINT "invoices_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."invoices"
    ADD CONSTRAINT "invoices_purchase_order_id_fkey" FOREIGN KEY ("purchase_order_id") REFERENCES "public"."purchase_orders"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."invoices"
    ADD CONSTRAINT "invoices_restaurant_id_fkey" FOREIGN KEY ("restaurant_id") REFERENCES "public"."restaurants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."list_categories"
    ADD CONSTRAINT "list_categories_category_set_id_fkey" FOREIGN KEY ("category_set_id") REFERENCES "public"."list_category_sets"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."list_categories"
    ADD CONSTRAINT "list_categories_list_id_fkey" FOREIGN KEY ("list_id") REFERENCES "public"."inventory_lists"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."list_category_sets"
    ADD CONSTRAINT "list_category_sets_list_id_fkey" FOREIGN KEY ("list_id") REFERENCES "public"."inventory_lists"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."list_item_category_map"
    ADD CONSTRAINT "list_item_category_map_catalog_item_id_fkey" FOREIGN KEY ("catalog_item_id") REFERENCES "public"."inventory_catalog_items"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."list_item_category_map"
    ADD CONSTRAINT "list_item_category_map_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "public"."list_categories"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."list_item_category_map"
    ADD CONSTRAINT "list_item_category_map_category_set_id_fkey" FOREIGN KEY ("category_set_id") REFERENCES "public"."list_category_sets"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."list_item_category_map"
    ADD CONSTRAINT "list_item_category_map_list_id_fkey" FOREIGN KEY ("list_id") REFERENCES "public"."inventory_lists"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."location_settings"
    ADD CONSTRAINT "location_settings_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."locations"
    ADD CONSTRAINT "locations_restaurant_id_fkey" FOREIGN KEY ("restaurant_id") REFERENCES "public"."restaurants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."notification_preferences"
    ADD CONSTRAINT "notification_preferences_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."notification_preferences"
    ADD CONSTRAINT "notification_preferences_restaurant_id_fkey" FOREIGN KEY ("restaurant_id") REFERENCES "public"."restaurants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."notifications"
    ADD CONSTRAINT "notifications_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."notifications"
    ADD CONSTRAINT "notifications_restaurant_id_fkey" FOREIGN KEY ("restaurant_id") REFERENCES "public"."restaurants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."order_items"
    ADD CONSTRAINT "order_items_catalog_item_id_fkey" FOREIGN KEY ("catalog_item_id") REFERENCES "public"."inventory_catalog_items"("id");



ALTER TABLE ONLY "public"."order_items"
    ADD CONSTRAINT "order_items_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."orders"
    ADD CONSTRAINT "orders_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."orders"
    ADD CONSTRAINT "orders_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."orders"
    ADD CONSTRAINT "orders_restaurant_id_fkey" FOREIGN KEY ("restaurant_id") REFERENCES "public"."restaurants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."par_guide_items"
    ADD CONSTRAINT "par_guide_items_catalog_item_id_fkey" FOREIGN KEY ("catalog_item_id") REFERENCES "public"."inventory_catalog_items"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."par_guide_items"
    ADD CONSTRAINT "par_guide_items_par_guide_id_fkey" FOREIGN KEY ("par_guide_id") REFERENCES "public"."par_guides"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."par_guides"
    ADD CONSTRAINT "par_guides_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."par_guides"
    ADD CONSTRAINT "par_guides_inventory_list_id_fkey" FOREIGN KEY ("inventory_list_id") REFERENCES "public"."inventory_lists"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."par_guides"
    ADD CONSTRAINT "par_guides_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."par_guides"
    ADD CONSTRAINT "par_guides_restaurant_id_fkey" FOREIGN KEY ("restaurant_id") REFERENCES "public"."restaurants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."par_items"
    ADD CONSTRAINT "par_items_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."par_items"
    ADD CONSTRAINT "par_items_inventory_item_id_fkey" FOREIGN KEY ("inventory_item_id") REFERENCES "public"."inventory_items"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."par_items"
    ADD CONSTRAINT "par_items_restaurant_id_fkey" FOREIGN KEY ("restaurant_id") REFERENCES "public"."restaurants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."par_settings"
    ADD CONSTRAINT "par_settings_restaurant_id_fkey" FOREIGN KEY ("restaurant_id") REFERENCES "public"."restaurants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_id_fkey" FOREIGN KEY ("id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."purchase_history"
    ADD CONSTRAINT "purchase_history_inventory_list_id_fkey" FOREIGN KEY ("inventory_list_id") REFERENCES "public"."inventory_lists"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."purchase_history_items"
    ADD CONSTRAINT "purchase_history_items_catalog_item_id_fkey" FOREIGN KEY ("catalog_item_id") REFERENCES "public"."inventory_catalog_items"("id");



ALTER TABLE ONLY "public"."purchase_history_items"
    ADD CONSTRAINT "purchase_history_items_purchase_history_id_fkey" FOREIGN KEY ("purchase_history_id") REFERENCES "public"."purchase_history"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."purchase_history"
    ADD CONSTRAINT "purchase_history_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."purchase_history"
    ADD CONSTRAINT "purchase_history_purchase_order_id_fkey" FOREIGN KEY ("purchase_order_id") REFERENCES "public"."smart_order_runs"("id");



ALTER TABLE ONLY "public"."purchase_history"
    ADD CONSTRAINT "purchase_history_restaurant_id_fkey" FOREIGN KEY ("restaurant_id") REFERENCES "public"."restaurants"("id");



ALTER TABLE ONLY "public"."purchase_history"
    ADD CONSTRAINT "purchase_history_smart_order_run_id_fkey" FOREIGN KEY ("smart_order_run_id") REFERENCES "public"."smart_order_runs"("id");



ALTER TABLE ONLY "public"."purchase_order_items"
    ADD CONSTRAINT "purchase_order_items_catalog_item_id_fkey" FOREIGN KEY ("catalog_item_id") REFERENCES "public"."inventory_catalog_items"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."purchase_order_items"
    ADD CONSTRAINT "purchase_order_items_purchase_order_id_fkey" FOREIGN KEY ("purchase_order_id") REFERENCES "public"."purchase_orders"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."purchase_order_items"
    ADD CONSTRAINT "purchase_order_items_smart_order_run_item_id_fkey" FOREIGN KEY ("smart_order_run_item_id") REFERENCES "public"."smart_order_run_items"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."purchase_orders"
    ADD CONSTRAINT "purchase_orders_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."purchase_orders"
    ADD CONSTRAINT "purchase_orders_created_from_session_id_fkey" FOREIGN KEY ("created_from_session_id") REFERENCES "public"."inventory_sessions"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."purchase_orders"
    ADD CONSTRAINT "purchase_orders_inventory_list_id_fkey" FOREIGN KEY ("inventory_list_id") REFERENCES "public"."inventory_lists"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."purchase_orders"
    ADD CONSTRAINT "purchase_orders_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id");



ALTER TABLE ONLY "public"."purchase_orders"
    ADD CONSTRAINT "purchase_orders_restaurant_id_fkey" FOREIGN KEY ("restaurant_id") REFERENCES "public"."restaurants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."purchase_orders"
    ADD CONSTRAINT "purchase_orders_smart_order_run_id_fkey" FOREIGN KEY ("smart_order_run_id") REFERENCES "public"."smart_order_runs"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."reminder_targets"
    ADD CONSTRAINT "reminder_targets_reminder_id_fkey" FOREIGN KEY ("reminder_id") REFERENCES "public"."reminders"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."reminders"
    ADD CONSTRAINT "reminders_inventory_list_id_fkey" FOREIGN KEY ("inventory_list_id") REFERENCES "public"."inventory_lists"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."reminders"
    ADD CONSTRAINT "reminders_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."reminders"
    ADD CONSTRAINT "reminders_restaurant_id_fkey" FOREIGN KEY ("restaurant_id") REFERENCES "public"."restaurants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."restaurant_counters"
    ADD CONSTRAINT "restaurant_counters_restaurant_id_fkey" FOREIGN KEY ("restaurant_id") REFERENCES "public"."restaurants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."restaurant_members"
    ADD CONSTRAINT "restaurant_members_default_location_id_fkey" FOREIGN KEY ("default_location_id") REFERENCES "public"."locations"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."restaurant_members"
    ADD CONSTRAINT "restaurant_members_restaurant_id_fkey" FOREIGN KEY ("restaurant_id") REFERENCES "public"."restaurants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."restaurant_members"
    ADD CONSTRAINT "restaurant_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."restaurant_settings"
    ADD CONSTRAINT "restaurant_settings_restaurant_id_fkey" FOREIGN KEY ("restaurant_id") REFERENCES "public"."restaurants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."smart_order_run_items"
    ADD CONSTRAINT "smart_order_run_items_catalog_item_id_fkey" FOREIGN KEY ("catalog_item_id") REFERENCES "public"."inventory_catalog_items"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."smart_order_run_items"
    ADD CONSTRAINT "smart_order_run_items_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "public"."smart_order_runs"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."smart_order_runs"
    ADD CONSTRAINT "smart_order_runs_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."smart_order_runs"
    ADD CONSTRAINT "smart_order_runs_inventory_list_id_fkey" FOREIGN KEY ("inventory_list_id") REFERENCES "public"."inventory_lists"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."smart_order_runs"
    ADD CONSTRAINT "smart_order_runs_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."smart_order_runs"
    ADD CONSTRAINT "smart_order_runs_par_guide_id_fkey" FOREIGN KEY ("par_guide_id") REFERENCES "public"."par_guides"("id");



ALTER TABLE ONLY "public"."smart_order_runs"
    ADD CONSTRAINT "smart_order_runs_restaurant_id_fkey" FOREIGN KEY ("restaurant_id") REFERENCES "public"."restaurants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."smart_order_runs"
    ADD CONSTRAINT "smart_order_runs_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "public"."inventory_sessions"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."smart_order_settings"
    ADD CONSTRAINT "smart_order_settings_restaurant_id_fkey" FOREIGN KEY ("restaurant_id") REFERENCES "public"."restaurants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."stock_movements"
    ADD CONSTRAINT "stock_movements_catalog_item_id_fkey" FOREIGN KEY ("catalog_item_id") REFERENCES "public"."inventory_catalog_items"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."stock_movements"
    ADD CONSTRAINT "stock_movements_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."stock_movements"
    ADD CONSTRAINT "stock_movements_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."stock_movements"
    ADD CONSTRAINT "stock_movements_invoice_item_id_fkey" FOREIGN KEY ("invoice_item_id") REFERENCES "public"."invoice_items"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."stock_movements"
    ADD CONSTRAINT "stock_movements_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id");



ALTER TABLE ONLY "public"."stock_movements"
    ADD CONSTRAINT "stock_movements_restaurant_id_fkey" FOREIGN KEY ("restaurant_id") REFERENCES "public"."restaurants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."usage_events"
    ADD CONSTRAINT "usage_events_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id");



ALTER TABLE ONLY "public"."usage_events"
    ADD CONSTRAINT "usage_events_restaurant_id_fkey" FOREIGN KEY ("restaurant_id") REFERENCES "public"."restaurants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."user_invites"
    ADD CONSTRAINT "user_invites_invited_by_fkey" FOREIGN KEY ("invited_by") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."user_invites"
    ADD CONSTRAINT "user_invites_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."user_invites"
    ADD CONSTRAINT "user_invites_restaurant_id_fkey" FOREIGN KEY ("restaurant_id") REFERENCES "public"."restaurants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."user_location_assignments"
    ADD CONSTRAINT "user_location_assignments_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."user_location_assignments"
    ADD CONSTRAINT "user_location_assignments_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."user_ui_state"
    ADD CONSTRAINT "user_ui_state_selected_location_id_fkey" FOREIGN KEY ("selected_location_id") REFERENCES "public"."locations"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."user_ui_state"
    ADD CONSTRAINT "user_ui_state_selected_restaurant_id_fkey" FOREIGN KEY ("selected_restaurant_id") REFERENCES "public"."restaurants"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."vendor_integrations"
    ADD CONSTRAINT "vendor_integrations_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id");



ALTER TABLE ONLY "public"."vendor_integrations"
    ADD CONSTRAINT "vendor_integrations_restaurant_id_fkey" FOREIGN KEY ("restaurant_id") REFERENCES "public"."restaurants"("id");



ALTER TABLE ONLY "public"."vendor_item_mappings"
    ADD CONSTRAINT "vendor_item_mappings_catalog_item_id_fkey" FOREIGN KEY ("catalog_item_id") REFERENCES "public"."inventory_catalog_items"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."vendor_item_mappings"
    ADD CONSTRAINT "vendor_item_mappings_restaurant_id_fkey" FOREIGN KEY ("restaurant_id") REFERENCES "public"."restaurants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."vendor_item_mappings"
    ADD CONSTRAINT "vendor_item_mappings_verified_by_fkey" FOREIGN KEY ("verified_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."waste_log"
    ADD CONSTRAINT "waste_log_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id");



ALTER TABLE ONLY "public"."waste_log"
    ADD CONSTRAINT "waste_log_logged_by_fkey" FOREIGN KEY ("logged_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."waste_log"
    ADD CONSTRAINT "waste_log_restaurant_id_fkey" FOREIGN KEY ("restaurant_id") REFERENCES "public"."restaurants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."weekly_sales"
    ADD CONSTRAINT "weekly_sales_entered_by_user_id_fkey" FOREIGN KEY ("entered_by_user_id") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."weekly_sales"
    ADD CONSTRAINT "weekly_sales_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."weekly_sales"
    ADD CONSTRAINT "weekly_sales_restaurant_id_fkey" FOREIGN KEY ("restaurant_id") REFERENCES "public"."restaurants"("id") ON DELETE CASCADE;



CREATE POLICY "Manager+ can create PAR guides" ON "public"."par_guides" FOR INSERT TO "authenticated" WITH CHECK ("public"."has_restaurant_role_any"("restaurant_id", ARRAY['OWNER'::"public"."app_role", 'MANAGER'::"public"."app_role"]));



CREATE POLICY "Manager+ can create PAR items" ON "public"."par_guide_items" FOR INSERT TO "authenticated" WITH CHECK ("public"."is_member_of"("public"."par_guide_restaurant_id"("par_guide_id")));



CREATE POLICY "Manager+ can create purchase history" ON "public"."purchase_history" FOR INSERT TO "authenticated" WITH CHECK ("public"."has_restaurant_role_any"("restaurant_id", ARRAY['OWNER'::"public"."app_role", 'MANAGER'::"public"."app_role"]));



CREATE POLICY "Manager+ can create purchase history items" ON "public"."purchase_history_items" FOR INSERT TO "authenticated" WITH CHECK ("public"."is_member_of"("public"."purchase_history_restaurant_id"("purchase_history_id")));



CREATE POLICY "Manager+ can create reminder targets" ON "public"."reminder_targets" FOR INSERT TO "authenticated" WITH CHECK ("public"."is_member_of"("public"."reminder_restaurant_id"("reminder_id")));



CREATE POLICY "Manager+ can create reminders" ON "public"."reminders" FOR INSERT TO "authenticated" WITH CHECK ("public"."has_restaurant_role_any"("restaurant_id", ARRAY['OWNER'::"public"."app_role", 'MANAGER'::"public"."app_role"]));



CREATE POLICY "Manager+ can create vendor integrations" ON "public"."vendor_integrations" FOR INSERT TO "authenticated" WITH CHECK ("public"."has_restaurant_role_any"("restaurant_id", ARRAY['OWNER'::"public"."app_role", 'MANAGER'::"public"."app_role"]));



CREATE POLICY "Manager+ can delete PAR guides" ON "public"."par_guides" FOR DELETE TO "authenticated" USING ("public"."has_restaurant_role_any"("restaurant_id", ARRAY['OWNER'::"public"."app_role", 'MANAGER'::"public"."app_role"]));



CREATE POLICY "Manager+ can delete PAR items" ON "public"."par_guide_items" FOR DELETE TO "authenticated" USING ("public"."is_member_of"("public"."par_guide_restaurant_id"("par_guide_id")));



CREATE POLICY "Manager+ can delete inventory lists" ON "public"."inventory_lists" FOR DELETE TO "authenticated" USING ("public"."has_restaurant_role_any"("restaurant_id", ARRAY['OWNER'::"public"."app_role", 'MANAGER'::"public"."app_role"]));



CREATE POLICY "Manager+ can delete invoice items" ON "public"."invoice_items" FOR DELETE TO "authenticated" USING (((EXISTS ( SELECT 1
   FROM "public"."invoices" "i"
  WHERE ("i"."id" = "invoice_items"."invoice_id"))) AND "public"."has_restaurant_role_any"("public"."invoice_restaurant_id"("invoice_id"), ARRAY['OWNER'::"public"."app_role", 'MANAGER'::"public"."app_role"])));



CREATE POLICY "Manager+ can delete invoices" ON "public"."invoices" FOR DELETE TO "authenticated" USING ("public"."has_restaurant_role_any"("restaurant_id", ARRAY['OWNER'::"public"."app_role", 'MANAGER'::"public"."app_role"]));



CREATE POLICY "Manager+ can delete locations" ON "public"."locations" FOR DELETE TO "authenticated" USING ("public"."has_restaurant_role_any"("restaurant_id", ARRAY['OWNER'::"public"."app_role", 'MANAGER'::"public"."app_role"]));



CREATE POLICY "Manager+ can delete purchase history" ON "public"."purchase_history" FOR DELETE TO "authenticated" USING ("public"."has_restaurant_role_any"("restaurant_id", ARRAY['OWNER'::"public"."app_role", 'MANAGER'::"public"."app_role"]));



CREATE POLICY "Manager+ can delete purchase history items" ON "public"."purchase_history_items" FOR DELETE TO "authenticated" USING ("public"."is_member_of"("public"."purchase_history_restaurant_id"("purchase_history_id")));



CREATE POLICY "Manager+ can delete purchase order items" ON "public"."purchase_order_items" FOR DELETE TO "authenticated" USING (((EXISTS ( SELECT 1
   FROM "public"."purchase_orders" "po"
  WHERE ("po"."id" = "purchase_order_items"."purchase_order_id"))) AND "public"."has_restaurant_role_any"("public"."purchase_order_restaurant_id"("purchase_order_id"), ARRAY['OWNER'::"public"."app_role", 'MANAGER'::"public"."app_role"])));



CREATE POLICY "Manager+ can delete purchase orders" ON "public"."purchase_orders" FOR DELETE TO "authenticated" USING ("public"."has_restaurant_role_any"("restaurant_id", ARRAY['OWNER'::"public"."app_role", 'MANAGER'::"public"."app_role"]));



CREATE POLICY "Manager+ can delete reminder targets" ON "public"."reminder_targets" FOR DELETE TO "authenticated" USING ("public"."is_member_of"("public"."reminder_restaurant_id"("reminder_id")));



CREATE POLICY "Manager+ can delete reminders" ON "public"."reminders" FOR DELETE TO "authenticated" USING ("public"."has_restaurant_role_any"("restaurant_id", ARRAY['OWNER'::"public"."app_role", 'MANAGER'::"public"."app_role"]));



CREATE POLICY "Manager+ can delete vendor integrations" ON "public"."vendor_integrations" FOR DELETE TO "authenticated" USING ("public"."has_restaurant_role_any"("restaurant_id", ARRAY['OWNER'::"public"."app_role", 'MANAGER'::"public"."app_role"]));



CREATE POLICY "Manager+ can insert inv settings" ON "public"."inventory_settings" FOR INSERT TO "authenticated" WITH CHECK ("public"."has_restaurant_role_any"("restaurant_id", ARRAY['OWNER'::"public"."app_role", 'MANAGER'::"public"."app_role"]));



CREATE POLICY "Manager+ can insert invoice items" ON "public"."invoice_items" FOR INSERT TO "authenticated" WITH CHECK (((EXISTS ( SELECT 1
   FROM "public"."invoices" "i"
  WHERE ("i"."id" = "invoice_items"."invoice_id"))) AND "public"."has_restaurant_role_any"("public"."invoice_restaurant_id"("invoice_id"), ARRAY['OWNER'::"public"."app_role", 'MANAGER'::"public"."app_role"])));



CREATE POLICY "Manager+ can insert invoices" ON "public"."invoices" FOR INSERT TO "authenticated" WITH CHECK ("public"."has_restaurant_role_any"("restaurant_id", ARRAY['OWNER'::"public"."app_role", 'MANAGER'::"public"."app_role"]));



CREATE POLICY "Manager+ can insert locations" ON "public"."locations" FOR INSERT TO "authenticated" WITH CHECK ("public"."has_restaurant_role_any"("restaurant_id", ARRAY['OWNER'::"public"."app_role", 'MANAGER'::"public"."app_role"]));



CREATE POLICY "Manager+ can insert par settings" ON "public"."par_settings" FOR INSERT TO "authenticated" WITH CHECK ("public"."has_restaurant_role_any"("restaurant_id", ARRAY['OWNER'::"public"."app_role", 'MANAGER'::"public"."app_role"]));



CREATE POLICY "Manager+ can insert purchase order items" ON "public"."purchase_order_items" FOR INSERT TO "authenticated" WITH CHECK (((EXISTS ( SELECT 1
   FROM "public"."purchase_orders" "po"
  WHERE ("po"."id" = "purchase_order_items"."purchase_order_id"))) AND "public"."has_restaurant_role_any"("public"."purchase_order_restaurant_id"("purchase_order_id"), ARRAY['OWNER'::"public"."app_role", 'MANAGER'::"public"."app_role"])));



CREATE POLICY "Manager+ can insert purchase orders" ON "public"."purchase_orders" FOR INSERT TO "authenticated" WITH CHECK ("public"."has_restaurant_role_any"("restaurant_id", ARRAY['OWNER'::"public"."app_role", 'MANAGER'::"public"."app_role"]));



CREATE POLICY "Manager+ can insert settings" ON "public"."restaurant_settings" FOR INSERT TO "authenticated" WITH CHECK ("public"."has_restaurant_role_any"("restaurant_id", ARRAY['OWNER'::"public"."app_role", 'MANAGER'::"public"."app_role"]));



CREATE POLICY "Manager+ can insert so settings" ON "public"."smart_order_settings" FOR INSERT TO "authenticated" WITH CHECK ("public"."has_restaurant_role_any"("restaurant_id", ARRAY['OWNER'::"public"."app_role", 'MANAGER'::"public"."app_role"]));



CREATE POLICY "Manager+ can update PAR guides" ON "public"."par_guides" FOR UPDATE TO "authenticated" USING ("public"."has_restaurant_role_any"("restaurant_id", ARRAY['OWNER'::"public"."app_role", 'MANAGER'::"public"."app_role"])) WITH CHECK ("public"."has_restaurant_role_any"("restaurant_id", ARRAY['OWNER'::"public"."app_role", 'MANAGER'::"public"."app_role"]));



CREATE POLICY "Manager+ can update PAR items" ON "public"."par_guide_items" FOR UPDATE TO "authenticated" USING ("public"."is_member_of"("public"."par_guide_restaurant_id"("par_guide_id"))) WITH CHECK ("public"."is_member_of"("public"."par_guide_restaurant_id"("par_guide_id")));



CREATE POLICY "Manager+ can update inv settings" ON "public"."inventory_settings" FOR UPDATE TO "authenticated" USING ("public"."has_restaurant_role_any"("restaurant_id", ARRAY['OWNER'::"public"."app_role", 'MANAGER'::"public"."app_role"])) WITH CHECK ("public"."has_restaurant_role_any"("restaurant_id", ARRAY['OWNER'::"public"."app_role", 'MANAGER'::"public"."app_role"]));



CREATE POLICY "Manager+ can update inventory lists" ON "public"."inventory_lists" FOR UPDATE TO "authenticated" USING ("public"."has_restaurant_role_any"("restaurant_id", ARRAY['OWNER'::"public"."app_role", 'MANAGER'::"public"."app_role"])) WITH CHECK ("public"."has_restaurant_role_any"("restaurant_id", ARRAY['OWNER'::"public"."app_role", 'MANAGER'::"public"."app_role"]));



CREATE POLICY "Manager+ can update invoice items" ON "public"."invoice_items" FOR UPDATE TO "authenticated" USING (((EXISTS ( SELECT 1
   FROM "public"."invoices" "i"
  WHERE ("i"."id" = "invoice_items"."invoice_id"))) AND "public"."has_restaurant_role_any"("public"."invoice_restaurant_id"("invoice_id"), ARRAY['OWNER'::"public"."app_role", 'MANAGER'::"public"."app_role"]))) WITH CHECK (((EXISTS ( SELECT 1
   FROM "public"."invoices" "i"
  WHERE ("i"."id" = "invoice_items"."invoice_id"))) AND "public"."has_restaurant_role_any"("public"."invoice_restaurant_id"("invoice_id"), ARRAY['OWNER'::"public"."app_role", 'MANAGER'::"public"."app_role"])));



CREATE POLICY "Manager+ can update invoices" ON "public"."invoices" FOR UPDATE TO "authenticated" USING ("public"."has_restaurant_role_any"("restaurant_id", ARRAY['OWNER'::"public"."app_role", 'MANAGER'::"public"."app_role"])) WITH CHECK ("public"."has_restaurant_role_any"("restaurant_id", ARRAY['OWNER'::"public"."app_role", 'MANAGER'::"public"."app_role"]));



CREATE POLICY "Manager+ can update locations" ON "public"."locations" FOR UPDATE TO "authenticated" USING ("public"."has_restaurant_role_any"("restaurant_id", ARRAY['OWNER'::"public"."app_role", 'MANAGER'::"public"."app_role"])) WITH CHECK ("public"."has_restaurant_role_any"("restaurant_id", ARRAY['OWNER'::"public"."app_role", 'MANAGER'::"public"."app_role"]));



CREATE POLICY "Manager+ can update par settings" ON "public"."par_settings" FOR UPDATE TO "authenticated" USING ("public"."has_restaurant_role_any"("restaurant_id", ARRAY['OWNER'::"public"."app_role", 'MANAGER'::"public"."app_role"])) WITH CHECK ("public"."has_restaurant_role_any"("restaurant_id", ARRAY['OWNER'::"public"."app_role", 'MANAGER'::"public"."app_role"]));



CREATE POLICY "Manager+ can update purchase history" ON "public"."purchase_history" FOR UPDATE TO "authenticated" USING ("public"."has_restaurant_role_any"("restaurant_id", ARRAY['OWNER'::"public"."app_role", 'MANAGER'::"public"."app_role"])) WITH CHECK ("public"."has_restaurant_role_any"("restaurant_id", ARRAY['OWNER'::"public"."app_role", 'MANAGER'::"public"."app_role"]));



CREATE POLICY "Manager+ can update purchase order items" ON "public"."purchase_order_items" FOR UPDATE TO "authenticated" USING (((EXISTS ( SELECT 1
   FROM "public"."purchase_orders" "po"
  WHERE ("po"."id" = "purchase_order_items"."purchase_order_id"))) AND "public"."has_restaurant_role_any"("public"."purchase_order_restaurant_id"("purchase_order_id"), ARRAY['OWNER'::"public"."app_role", 'MANAGER'::"public"."app_role"]))) WITH CHECK (((EXISTS ( SELECT 1
   FROM "public"."purchase_orders" "po"
  WHERE ("po"."id" = "purchase_order_items"."purchase_order_id"))) AND "public"."has_restaurant_role_any"("public"."purchase_order_restaurant_id"("purchase_order_id"), ARRAY['OWNER'::"public"."app_role", 'MANAGER'::"public"."app_role"])));



CREATE POLICY "Manager+ can update purchase orders" ON "public"."purchase_orders" FOR UPDATE TO "authenticated" USING ("public"."has_restaurant_role_any"("restaurant_id", ARRAY['OWNER'::"public"."app_role", 'MANAGER'::"public"."app_role"])) WITH CHECK ("public"."has_restaurant_role_any"("restaurant_id", ARRAY['OWNER'::"public"."app_role", 'MANAGER'::"public"."app_role"]));



CREATE POLICY "Manager+ can update reminders" ON "public"."reminders" FOR UPDATE TO "authenticated" USING ("public"."has_restaurant_role_any"("restaurant_id", ARRAY['OWNER'::"public"."app_role", 'MANAGER'::"public"."app_role"])) WITH CHECK ("public"."has_restaurant_role_any"("restaurant_id", ARRAY['OWNER'::"public"."app_role", 'MANAGER'::"public"."app_role"]));



CREATE POLICY "Manager+ can update sessions" ON "public"."inventory_sessions" FOR UPDATE TO "authenticated" USING ("public"."has_restaurant_role_any"("restaurant_id", ARRAY['OWNER'::"public"."app_role", 'MANAGER'::"public"."app_role"])) WITH CHECK ("public"."has_restaurant_role_any"("restaurant_id", ARRAY['OWNER'::"public"."app_role", 'MANAGER'::"public"."app_role"]));



CREATE POLICY "Manager+ can update settings" ON "public"."restaurant_settings" FOR UPDATE TO "authenticated" USING ("public"."has_restaurant_role_any"("restaurant_id", ARRAY['OWNER'::"public"."app_role", 'MANAGER'::"public"."app_role"])) WITH CHECK ("public"."has_restaurant_role_any"("restaurant_id", ARRAY['OWNER'::"public"."app_role", 'MANAGER'::"public"."app_role"]));



CREATE POLICY "Manager+ can update so settings" ON "public"."smart_order_settings" FOR UPDATE TO "authenticated" USING ("public"."has_restaurant_role_any"("restaurant_id", ARRAY['OWNER'::"public"."app_role", 'MANAGER'::"public"."app_role"])) WITH CHECK ("public"."has_restaurant_role_any"("restaurant_id", ARRAY['OWNER'::"public"."app_role", 'MANAGER'::"public"."app_role"]));



CREATE POLICY "Manager+ can update vendor integrations" ON "public"."vendor_integrations" FOR UPDATE TO "authenticated" USING ("public"."has_restaurant_role_any"("restaurant_id", ARRAY['OWNER'::"public"."app_role", 'MANAGER'::"public"."app_role"])) WITH CHECK ("public"."has_restaurant_role_any"("restaurant_id", ARRAY['OWNER'::"public"."app_role", 'MANAGER'::"public"."app_role"]));



CREATE POLICY "Manager+ can view reminders" ON "public"."reminders" FOR SELECT TO "authenticated" USING ("public"."is_member_of"("restaurant_id"));



CREATE POLICY "Managers+ can delete daily sales" ON "public"."daily_sales" FOR DELETE TO "authenticated" USING (("public"."is_member_of"("restaurant_id") AND "public"."user_can_access_location"("auth"."uid"(), "location_id") AND "public"."has_restaurant_role_any"("restaurant_id", ARRAY['OWNER'::"public"."app_role", 'MANAGER'::"public"."app_role"])));



CREATE POLICY "Managers+ can delete weekly sales" ON "public"."weekly_sales" FOR DELETE TO "authenticated" USING (("public"."is_member_of"("restaurant_id") AND "public"."user_can_access_location"("auth"."uid"(), "location_id") AND "public"."has_restaurant_role_any"("restaurant_id", ARRAY['OWNER'::"public"."app_role", 'MANAGER'::"public"."app_role"])));



CREATE POLICY "Managers+ can insert daily sales" ON "public"."daily_sales" FOR INSERT TO "authenticated" WITH CHECK (("public"."is_member_of"("restaurant_id") AND "public"."user_can_access_location"("auth"."uid"(), "location_id") AND "public"."has_restaurant_role_any"("restaurant_id", ARRAY['OWNER'::"public"."app_role", 'MANAGER'::"public"."app_role"])));



CREATE POLICY "Managers+ can insert weekly sales" ON "public"."weekly_sales" FOR INSERT TO "authenticated" WITH CHECK (("public"."is_member_of"("restaurant_id") AND "public"."user_can_access_location"("auth"."uid"(), "location_id") AND "public"."has_restaurant_role_any"("restaurant_id", ARRAY['OWNER'::"public"."app_role", 'MANAGER'::"public"."app_role"])));



CREATE POLICY "Managers+ can update daily sales" ON "public"."daily_sales" FOR UPDATE TO "authenticated" USING (("public"."is_member_of"("restaurant_id") AND "public"."user_can_access_location"("auth"."uid"(), "location_id") AND "public"."has_restaurant_role_any"("restaurant_id", ARRAY['OWNER'::"public"."app_role", 'MANAGER'::"public"."app_role"]))) WITH CHECK (("public"."is_member_of"("restaurant_id") AND "public"."user_can_access_location"("auth"."uid"(), "location_id") AND "public"."has_restaurant_role_any"("restaurant_id", ARRAY['OWNER'::"public"."app_role", 'MANAGER'::"public"."app_role"])));



CREATE POLICY "Managers+ can update weekly sales" ON "public"."weekly_sales" FOR UPDATE TO "authenticated" USING (("public"."is_member_of"("restaurant_id") AND "public"."user_can_access_location"("auth"."uid"(), "location_id") AND "public"."has_restaurant_role_any"("restaurant_id", ARRAY['OWNER'::"public"."app_role", 'MANAGER'::"public"."app_role"]))) WITH CHECK (("public"."is_member_of"("restaurant_id") AND "public"."user_can_access_location"("auth"."uid"(), "location_id") AND "public"."has_restaurant_role_any"("restaurant_id", ARRAY['OWNER'::"public"."app_role", 'MANAGER'::"public"."app_role"])));



CREATE POLICY "Members can create catalog items" ON "public"."inventory_catalog_items" FOR INSERT TO "authenticated" WITH CHECK ("public"."is_member_of"("restaurant_id"));



CREATE POLICY "Members can create categories" ON "public"."categories" FOR INSERT TO "authenticated" WITH CHECK ("public"."is_member_of"("restaurant_id"));



CREATE POLICY "Members can create category sets" ON "public"."list_category_sets" FOR INSERT TO "authenticated" WITH CHECK ("public"."is_member_of"("public"."list_category_restaurant_id"("list_id")));



CREATE POLICY "Members can create custom lists" ON "public"."custom_lists" FOR INSERT TO "authenticated" WITH CHECK ("public"."is_member_of"("restaurant_id"));



CREATE POLICY "Members can create import files" ON "public"."inventory_import_files" FOR INSERT TO "authenticated" WITH CHECK ("public"."is_member_of"("restaurant_id"));



CREATE POLICY "Members can create import runs" ON "public"."import_runs" FOR INSERT TO "authenticated" WITH CHECK ("public"."is_member_of"("restaurant_id"));



CREATE POLICY "Members can create import templates" ON "public"."import_templates" FOR INSERT TO "authenticated" WITH CHECK ("public"."is_member_of"("restaurant_id"));



CREATE POLICY "Members can create inventory items" ON "public"."inventory_items" FOR INSERT TO "authenticated" WITH CHECK ("public"."is_member_of"("restaurant_id"));



CREATE POLICY "Members can create inventory lists" ON "public"."inventory_lists" FOR INSERT TO "authenticated" WITH CHECK ("public"."is_member_of"("restaurant_id"));



CREATE POLICY "Members can create invoice line comparisons" ON "public"."invoice_line_comparisons" FOR INSERT TO "authenticated" WITH CHECK (((("invoice_id" IS NOT NULL) AND (EXISTS ( SELECT 1
   FROM "public"."invoices" "i"
  WHERE ("i"."id" = "invoice_line_comparisons"."invoice_id")))) OR (("purchase_history_id" IS NOT NULL) AND (EXISTS ( SELECT 1
   FROM "public"."purchase_history" "ph"
  WHERE ("ph"."id" = "invoice_line_comparisons"."purchase_history_id"))))));



CREATE POLICY "Members can create item category map" ON "public"."list_item_category_map" FOR INSERT TO "authenticated" WITH CHECK ("public"."is_member_of"("public"."list_item_map_restaurant_id"("list_id")));



CREATE POLICY "Members can create list categories" ON "public"."list_categories" FOR INSERT TO "authenticated" WITH CHECK ("public"."is_member_of"("public"."list_category_restaurant_id"("list_id")));



CREATE POLICY "Members can create list items" ON "public"."custom_list_items" FOR INSERT TO "authenticated" WITH CHECK ("public"."is_member_of"("public"."custom_list_restaurant_id"("list_id")));



CREATE POLICY "Members can create notifications" ON "public"."notifications" FOR INSERT TO "authenticated" WITH CHECK ("public"."is_member_of"("restaurant_id"));



CREATE POLICY "Members can create order items" ON "public"."order_items" FOR INSERT TO "authenticated" WITH CHECK ("public"."is_member_of"("public"."order_restaurant_id"("order_id")));



CREATE POLICY "Members can create orders" ON "public"."orders" FOR INSERT TO "authenticated" WITH CHECK ("public"."is_member_of"("restaurant_id"));



CREATE POLICY "Members can create par items" ON "public"."par_items" FOR INSERT TO "authenticated" WITH CHECK ("public"."is_member_of"("restaurant_id"));



CREATE POLICY "Members can create run items" ON "public"."smart_order_run_items" FOR INSERT TO "authenticated" WITH CHECK ("public"."is_member_of"("public"."smart_order_run_restaurant_id"("run_id")));



CREATE POLICY "Members can create session item zones" ON "public"."inventory_session_item_zones" FOR INSERT TO "authenticated" WITH CHECK ("public"."is_member_of"("public"."session_item_restaurant_id"("session_item_id")));



CREATE POLICY "Members can create session items" ON "public"."inventory_session_items" FOR INSERT TO "authenticated" WITH CHECK ("public"."is_member_of"("public"."session_restaurant_id"("session_id")));



CREATE POLICY "Members can create sessions" ON "public"."inventory_sessions" FOR INSERT TO "authenticated" WITH CHECK ("public"."is_member_of"("restaurant_id"));



CREATE POLICY "Members can create smart order runs" ON "public"."smart_order_runs" FOR INSERT TO "authenticated" WITH CHECK ("public"."is_member_of"("restaurant_id"));



CREATE POLICY "Members can create usage events" ON "public"."usage_events" FOR INSERT TO "authenticated" WITH CHECK ("public"."is_member_of"("restaurant_id"));



CREATE POLICY "Members can create vendor item mappings" ON "public"."vendor_item_mappings" FOR INSERT TO "authenticated" WITH CHECK ("public"."is_member_of"("restaurant_id"));



CREATE POLICY "Members can delete alert recipients" ON "public"."alert_recipients" FOR DELETE TO "authenticated" USING ("public"."is_member_of"("public"."alert_pref_restaurant_id"("notification_pref_id")));



CREATE POLICY "Members can delete catalog items" ON "public"."inventory_catalog_items" FOR DELETE TO "authenticated" USING ("public"."is_member_of"("restaurant_id"));



CREATE POLICY "Members can delete categories" ON "public"."categories" FOR DELETE TO "authenticated" USING ("public"."is_member_of"("restaurant_id"));



CREATE POLICY "Members can delete category sets" ON "public"."list_category_sets" FOR DELETE TO "authenticated" USING ("public"."is_member_of"("public"."list_category_restaurant_id"("list_id")));



CREATE POLICY "Members can delete custom lists" ON "public"."custom_lists" FOR DELETE TO "authenticated" USING ("public"."is_member_of"("restaurant_id"));



CREATE POLICY "Members can delete delivery issues" ON "public"."delivery_issues" FOR DELETE TO "authenticated" USING (((("invoice_id" IS NOT NULL) AND "public"."has_restaurant_role_any"("public"."invoice_restaurant_id"("invoice_id"), ARRAY['OWNER'::"public"."app_role", 'MANAGER'::"public"."app_role"])) OR (("purchase_history_id" IS NOT NULL) AND "public"."has_restaurant_role_any"("public"."purchase_history_restaurant_id"("purchase_history_id"), ARRAY['OWNER'::"public"."app_role", 'MANAGER'::"public"."app_role"]))));



CREATE POLICY "Members can delete import files" ON "public"."inventory_import_files" FOR DELETE TO "authenticated" USING ("public"."is_member_of"("restaurant_id"));



CREATE POLICY "Members can delete import runs" ON "public"."import_runs" FOR DELETE TO "authenticated" USING ("public"."is_member_of"("restaurant_id"));



CREATE POLICY "Members can delete import templates" ON "public"."import_templates" FOR DELETE TO "authenticated" USING ("public"."is_member_of"("restaurant_id"));



CREATE POLICY "Members can delete inventory items" ON "public"."inventory_items" FOR DELETE TO "authenticated" USING ("public"."is_member_of"("restaurant_id"));



CREATE POLICY "Members can delete invoice line comparisons" ON "public"."invoice_line_comparisons" FOR DELETE TO "authenticated" USING (((("invoice_id" IS NOT NULL) AND (EXISTS ( SELECT 1
   FROM "public"."invoices" "i"
  WHERE ("i"."id" = "invoice_line_comparisons"."invoice_id")))) OR (("purchase_history_id" IS NOT NULL) AND (EXISTS ( SELECT 1
   FROM "public"."purchase_history" "ph"
  WHERE ("ph"."id" = "invoice_line_comparisons"."purchase_history_id"))))));



CREATE POLICY "Members can delete item category map" ON "public"."list_item_category_map" FOR DELETE TO "authenticated" USING ("public"."is_member_of"("public"."list_item_map_restaurant_id"("list_id")));



CREATE POLICY "Members can delete list categories" ON "public"."list_categories" FOR DELETE TO "authenticated" USING ("public"."is_member_of"("public"."list_category_restaurant_id"("list_id")));



CREATE POLICY "Members can delete list items" ON "public"."custom_list_items" FOR DELETE TO "authenticated" USING ("public"."is_member_of"("public"."custom_list_restaurant_id"("list_id")));



CREATE POLICY "Members can delete order items" ON "public"."order_items" FOR DELETE TO "authenticated" USING ("public"."is_member_of"("public"."order_restaurant_id"("order_id")));



CREATE POLICY "Members can delete orders" ON "public"."orders" FOR DELETE TO "authenticated" USING ("public"."is_member_of"("restaurant_id"));



CREATE POLICY "Members can delete par items" ON "public"."par_items" FOR DELETE TO "authenticated" USING ("public"."is_member_of"("restaurant_id"));



CREATE POLICY "Members can delete run items" ON "public"."smart_order_run_items" FOR DELETE TO "authenticated" USING ("public"."is_member_of"("public"."smart_order_run_restaurant_id"("run_id")));



CREATE POLICY "Members can delete session item zones" ON "public"."inventory_session_item_zones" FOR DELETE TO "authenticated" USING ("public"."is_member_of"("public"."session_item_restaurant_id"("session_item_id")));



CREATE POLICY "Members can delete session items" ON "public"."inventory_session_items" FOR DELETE TO "authenticated" USING ("public"."is_member_of"("public"."session_restaurant_id"("session_id")));



CREATE POLICY "Members can delete sessions" ON "public"."inventory_sessions" FOR DELETE TO "authenticated" USING ("public"."is_member_of"("restaurant_id"));



CREATE POLICY "Members can delete smart order runs" ON "public"."smart_order_runs" FOR DELETE TO "authenticated" USING ("public"."is_member_of"("restaurant_id"));



CREATE POLICY "Members can delete usage events" ON "public"."usage_events" FOR DELETE TO "authenticated" USING ("public"."is_member_of"("restaurant_id"));



CREATE POLICY "Members can delete vendor item mappings" ON "public"."vendor_item_mappings" FOR DELETE TO "authenticated" USING ("public"."is_member_of"("restaurant_id"));



CREATE POLICY "Members can insert alert recipients" ON "public"."alert_recipients" FOR INSERT TO "authenticated" WITH CHECK ("public"."is_member_of"("public"."alert_pref_restaurant_id"("notification_pref_id")));



CREATE POLICY "Members can insert delivery issues" ON "public"."delivery_issues" FOR INSERT TO "authenticated" WITH CHECK (((("invoice_id" IS NOT NULL) AND "public"."is_member_of"("public"."invoice_restaurant_id"("invoice_id"))) OR (("purchase_history_id" IS NOT NULL) AND "public"."is_member_of"("public"."purchase_history_restaurant_id"("purchase_history_id")))));



CREATE POLICY "Members can insert notification prefs" ON "public"."notification_preferences" FOR INSERT TO "authenticated" WITH CHECK ("public"."is_member_of"("restaurant_id"));



CREATE POLICY "Members can insert stock movements" ON "public"."stock_movements" FOR INSERT TO "authenticated" WITH CHECK ("public"."is_member_of"("restaurant_id"));



CREATE POLICY "Members can update catalog items" ON "public"."inventory_catalog_items" FOR UPDATE TO "authenticated" USING ("public"."is_member_of"("restaurant_id")) WITH CHECK ("public"."is_member_of"("restaurant_id"));



CREATE POLICY "Members can update categories" ON "public"."categories" FOR UPDATE TO "authenticated" USING ("public"."is_member_of"("restaurant_id")) WITH CHECK ("public"."is_member_of"("restaurant_id"));



CREATE POLICY "Members can update category sets" ON "public"."list_category_sets" FOR UPDATE TO "authenticated" USING ("public"."is_member_of"("public"."list_category_restaurant_id"("list_id"))) WITH CHECK ("public"."is_member_of"("public"."list_category_restaurant_id"("list_id")));



CREATE POLICY "Members can update custom lists" ON "public"."custom_lists" FOR UPDATE TO "authenticated" USING ("public"."is_member_of"("restaurant_id")) WITH CHECK ("public"."is_member_of"("restaurant_id"));



CREATE POLICY "Members can update delivery issues" ON "public"."delivery_issues" FOR UPDATE TO "authenticated" USING (((("invoice_id" IS NOT NULL) AND "public"."is_member_of"("public"."invoice_restaurant_id"("invoice_id"))) OR (("purchase_history_id" IS NOT NULL) AND "public"."is_member_of"("public"."purchase_history_restaurant_id"("purchase_history_id"))))) WITH CHECK (((("invoice_id" IS NOT NULL) AND "public"."is_member_of"("public"."invoice_restaurant_id"("invoice_id"))) OR (("purchase_history_id" IS NOT NULL) AND "public"."is_member_of"("public"."purchase_history_restaurant_id"("purchase_history_id")))));



CREATE POLICY "Members can update import templates" ON "public"."import_templates" FOR UPDATE TO "authenticated" USING ("public"."is_member_of"("restaurant_id")) WITH CHECK ("public"."is_member_of"("restaurant_id"));



CREATE POLICY "Members can update inventory items" ON "public"."inventory_items" FOR UPDATE TO "authenticated" USING ("public"."is_member_of"("restaurant_id")) WITH CHECK ("public"."is_member_of"("restaurant_id"));



CREATE POLICY "Members can update invoice line comparisons" ON "public"."invoice_line_comparisons" FOR UPDATE TO "authenticated" USING (((("invoice_id" IS NOT NULL) AND (EXISTS ( SELECT 1
   FROM "public"."invoices" "i"
  WHERE ("i"."id" = "invoice_line_comparisons"."invoice_id")))) OR (("purchase_history_id" IS NOT NULL) AND (EXISTS ( SELECT 1
   FROM "public"."purchase_history" "ph"
  WHERE ("ph"."id" = "invoice_line_comparisons"."purchase_history_id")))))) WITH CHECK (((("invoice_id" IS NOT NULL) AND (EXISTS ( SELECT 1
   FROM "public"."invoices" "i"
  WHERE ("i"."id" = "invoice_line_comparisons"."invoice_id")))) OR (("purchase_history_id" IS NOT NULL) AND (EXISTS ( SELECT 1
   FROM "public"."purchase_history" "ph"
  WHERE ("ph"."id" = "invoice_line_comparisons"."purchase_history_id"))))));



CREATE POLICY "Members can update item category map" ON "public"."list_item_category_map" FOR UPDATE TO "authenticated" USING ("public"."is_member_of"("public"."list_item_map_restaurant_id"("list_id"))) WITH CHECK ("public"."is_member_of"("public"."list_item_map_restaurant_id"("list_id")));



CREATE POLICY "Members can update list categories" ON "public"."list_categories" FOR UPDATE TO "authenticated" USING ("public"."is_member_of"("public"."list_category_restaurant_id"("list_id"))) WITH CHECK ("public"."is_member_of"("public"."list_category_restaurant_id"("list_id")));



CREATE POLICY "Members can update list items" ON "public"."custom_list_items" FOR UPDATE TO "authenticated" USING ("public"."is_member_of"("public"."custom_list_restaurant_id"("list_id"))) WITH CHECK ("public"."is_member_of"("public"."custom_list_restaurant_id"("list_id")));



CREATE POLICY "Members can update notification prefs" ON "public"."notification_preferences" FOR UPDATE TO "authenticated" USING ("public"."is_member_of"("restaurant_id")) WITH CHECK ("public"."is_member_of"("restaurant_id"));



CREATE POLICY "Members can update order items" ON "public"."order_items" FOR UPDATE TO "authenticated" USING ("public"."is_member_of"("public"."order_restaurant_id"("order_id"))) WITH CHECK ("public"."is_member_of"("public"."order_restaurant_id"("order_id")));



CREATE POLICY "Members can update orders" ON "public"."orders" FOR UPDATE TO "authenticated" USING ("public"."is_member_of"("restaurant_id")) WITH CHECK ("public"."is_member_of"("restaurant_id"));



CREATE POLICY "Members can update par items" ON "public"."par_items" FOR UPDATE TO "authenticated" USING ("public"."is_member_of"("restaurant_id")) WITH CHECK ("public"."is_member_of"("restaurant_id"));



CREATE POLICY "Members can update session item zones" ON "public"."inventory_session_item_zones" FOR UPDATE TO "authenticated" USING ("public"."is_member_of"("public"."session_item_restaurant_id"("session_item_id"))) WITH CHECK ("public"."is_member_of"("public"."session_item_restaurant_id"("session_item_id")));



CREATE POLICY "Members can update session items" ON "public"."inventory_session_items" FOR UPDATE TO "authenticated" USING ("public"."is_member_of"("public"."session_restaurant_id"("session_id"))) WITH CHECK ("public"."is_member_of"("public"."session_restaurant_id"("session_id")));



CREATE POLICY "Members can update vendor item mappings" ON "public"."vendor_item_mappings" FOR UPDATE TO "authenticated" USING ("public"."is_member_of"("restaurant_id")) WITH CHECK ("public"."is_member_of"("restaurant_id"));



CREATE POLICY "Members can view PAR guides" ON "public"."par_guides" FOR SELECT TO "authenticated" USING ("public"."is_member_of"("restaurant_id"));



CREATE POLICY "Members can view PAR items" ON "public"."par_guide_items" FOR SELECT TO "authenticated" USING ("public"."is_member_of"("public"."par_guide_restaurant_id"("par_guide_id")));



CREATE POLICY "Members can view alert recipients" ON "public"."alert_recipients" FOR SELECT TO "authenticated" USING ("public"."is_member_of"("public"."alert_pref_restaurant_id"("notification_pref_id")));



CREATE POLICY "Members can view catalog items" ON "public"."inventory_catalog_items" FOR SELECT TO "authenticated" USING ("public"."is_member_of"("restaurant_id"));



CREATE POLICY "Members can view categories" ON "public"."categories" FOR SELECT TO "authenticated" USING ("public"."is_member_of"("restaurant_id"));



CREATE POLICY "Members can view category sets" ON "public"."list_category_sets" FOR SELECT TO "authenticated" USING ("public"."is_member_of"("public"."list_category_restaurant_id"("list_id")));



CREATE POLICY "Members can view co-member profiles" ON "public"."profiles" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM ("public"."restaurant_members" "rm_self"
     JOIN "public"."restaurant_members" "rm_other" ON ((("rm_other"."restaurant_id" = "rm_self"."restaurant_id") AND ("rm_other"."user_id" = "profiles"."id"))))
  WHERE ("rm_self"."user_id" = "auth"."uid"()))));



COMMENT ON POLICY "Members can view co-member profiles" ON "public"."profiles" IS 'Team directory: same-restaurant members can read each other''s profile rows (e.g. email, full_name).';



CREATE POLICY "Members can view co-members" ON "public"."restaurant_members" FOR SELECT TO "authenticated" USING ("public"."is_member_of"("restaurant_id"));



CREATE POLICY "Members can view custom lists" ON "public"."custom_lists" FOR SELECT TO "authenticated" USING ("public"."is_member_of"("restaurant_id"));



CREATE POLICY "Members can view daily sales" ON "public"."daily_sales" FOR SELECT TO "authenticated" USING (("public"."is_member_of"("restaurant_id") AND "public"."user_can_access_location"("auth"."uid"(), "location_id") AND ("public"."has_restaurant_role_any"("restaurant_id", ARRAY['OWNER'::"public"."app_role"]) OR (EXISTS ( SELECT 1
   FROM "public"."user_location_assignments" "ula"
  WHERE (("ula"."user_id" = "auth"."uid"()) AND ("ula"."location_id" = "daily_sales"."location_id") AND ("ula"."can_see_food_cost_pct" = true)))))));



CREATE POLICY "Members can view delivery issues" ON "public"."delivery_issues" FOR SELECT TO "authenticated" USING (((("invoice_id" IS NOT NULL) AND "public"."is_member_of"("public"."invoice_restaurant_id"("invoice_id"))) OR (("purchase_history_id" IS NOT NULL) AND "public"."is_member_of"("public"."purchase_history_restaurant_id"("purchase_history_id")))));



CREATE POLICY "Members can view import files" ON "public"."inventory_import_files" FOR SELECT TO "authenticated" USING ("public"."is_member_of"("restaurant_id"));



CREATE POLICY "Members can view import runs" ON "public"."import_runs" FOR SELECT TO "authenticated" USING ("public"."is_member_of"("restaurant_id"));



CREATE POLICY "Members can view import templates" ON "public"."import_templates" FOR SELECT TO "authenticated" USING ("public"."is_member_of"("restaurant_id"));



CREATE POLICY "Members can view inv settings" ON "public"."inventory_settings" FOR SELECT TO "authenticated" USING ("public"."is_member_of"("restaurant_id"));



CREATE POLICY "Members can view inventory items" ON "public"."inventory_items" FOR SELECT TO "authenticated" USING ("public"."is_member_of"("restaurant_id"));



CREATE POLICY "Members can view inventory lists" ON "public"."inventory_lists" FOR SELECT TO "authenticated" USING ("public"."is_member_of"("restaurant_id"));



CREATE POLICY "Members can view invitations" ON "public"."invitations" FOR SELECT TO "authenticated" USING ("public"."is_member_of"("restaurant_id"));



CREATE POLICY "Members can view invoice items" ON "public"."invoice_items" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."invoices" "i"
  WHERE ("i"."id" = "invoice_items"."invoice_id"))));



CREATE POLICY "Members can view invoice line comparisons" ON "public"."invoice_line_comparisons" FOR SELECT TO "authenticated" USING (((("invoice_id" IS NOT NULL) AND (EXISTS ( SELECT 1
   FROM "public"."invoices" "i"
  WHERE ("i"."id" = "invoice_line_comparisons"."invoice_id")))) OR (("purchase_history_id" IS NOT NULL) AND (EXISTS ( SELECT 1
   FROM "public"."purchase_history" "ph"
  WHERE ("ph"."id" = "invoice_line_comparisons"."purchase_history_id"))))));



CREATE POLICY "Members can view invoices" ON "public"."invoices" FOR SELECT TO "authenticated" USING (("public"."is_member_of"("restaurant_id") AND (("location_id" IS NULL) OR "public"."user_can_access_location"("auth"."uid"(), "location_id"))));



CREATE POLICY "Members can view item category map" ON "public"."list_item_category_map" FOR SELECT TO "authenticated" USING ("public"."is_member_of"("public"."list_item_map_restaurant_id"("list_id")));



CREATE POLICY "Members can view list categories" ON "public"."list_categories" FOR SELECT TO "authenticated" USING ("public"."is_member_of"("public"."list_category_restaurant_id"("list_id")));



CREATE POLICY "Members can view list items" ON "public"."custom_list_items" FOR SELECT TO "authenticated" USING ("public"."is_member_of"("public"."custom_list_restaurant_id"("list_id")));



CREATE POLICY "Members can view locations" ON "public"."locations" FOR SELECT TO "authenticated" USING ("public"."is_member_of"("restaurant_id"));



CREATE POLICY "Members can view notification prefs" ON "public"."notification_preferences" FOR SELECT TO "authenticated" USING ("public"."is_member_of"("restaurant_id"));



CREATE POLICY "Members can view order items" ON "public"."order_items" FOR SELECT TO "authenticated" USING ("public"."is_member_of"("public"."order_restaurant_id"("order_id")));



CREATE POLICY "Members can view orders" ON "public"."orders" FOR SELECT TO "authenticated" USING (("public"."is_member_of"("restaurant_id") AND (("location_id" IS NULL) OR "public"."user_can_access_location"("auth"."uid"(), "location_id"))));



CREATE POLICY "Members can view par items" ON "public"."par_items" FOR SELECT TO "authenticated" USING ("public"."is_member_of"("restaurant_id"));



CREATE POLICY "Members can view par settings" ON "public"."par_settings" FOR SELECT TO "authenticated" USING ("public"."is_member_of"("restaurant_id"));



CREATE POLICY "Members can view purchase history" ON "public"."purchase_history" FOR SELECT TO "authenticated" USING (("public"."is_member_of"("restaurant_id") AND (("location_id" IS NULL) OR "public"."user_can_access_location"("auth"."uid"(), "location_id"))));



CREATE POLICY "Members can view purchase history items" ON "public"."purchase_history_items" FOR SELECT TO "authenticated" USING ("public"."is_member_of"("public"."purchase_history_restaurant_id"("purchase_history_id")));



CREATE POLICY "Members can view purchase order items" ON "public"."purchase_order_items" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."purchase_orders" "po"
  WHERE ("po"."id" = "purchase_order_items"."purchase_order_id"))));



CREATE POLICY "Members can view purchase orders" ON "public"."purchase_orders" FOR SELECT TO "authenticated" USING (("public"."is_member_of"("restaurant_id") AND (("location_id" IS NULL) OR "public"."user_can_access_location"("auth"."uid"(), "location_id"))));



CREATE POLICY "Members can view reminder targets" ON "public"."reminder_targets" FOR SELECT TO "authenticated" USING ("public"."is_member_of"("public"."reminder_restaurant_id"("reminder_id")));



CREATE POLICY "Members can view restaurant counters" ON "public"."restaurant_counters" FOR SELECT TO "authenticated" USING ("public"."is_member_of"("restaurant_id"));



CREATE POLICY "Members can view run items" ON "public"."smart_order_run_items" FOR SELECT TO "authenticated" USING ("public"."is_member_of"("public"."smart_order_run_restaurant_id"("run_id")));



CREATE POLICY "Members can view session item zones" ON "public"."inventory_session_item_zones" FOR SELECT TO "authenticated" USING ("public"."is_member_of"("public"."session_item_restaurant_id"("session_item_id")));



CREATE POLICY "Members can view session items" ON "public"."inventory_session_items" FOR SELECT TO "authenticated" USING ("public"."is_member_of"("public"."session_restaurant_id"("session_id")));



CREATE POLICY "Members can view sessions" ON "public"."inventory_sessions" FOR SELECT TO "authenticated" USING (("public"."is_member_of"("restaurant_id") AND (("location_id" IS NULL) OR "public"."user_can_access_location"("auth"."uid"(), "location_id"))));



CREATE POLICY "Members can view settings" ON "public"."restaurant_settings" FOR SELECT TO "authenticated" USING ("public"."is_member_of"("restaurant_id"));



CREATE POLICY "Members can view smart order runs" ON "public"."smart_order_runs" FOR SELECT TO "authenticated" USING (("public"."is_member_of"("restaurant_id") AND (("location_id" IS NULL) OR "public"."user_can_access_location"("auth"."uid"(), "location_id"))));



CREATE POLICY "Members can view so settings" ON "public"."smart_order_settings" FOR SELECT TO "authenticated" USING ("public"."is_member_of"("restaurant_id"));



CREATE POLICY "Members can view stock movements" ON "public"."stock_movements" FOR SELECT TO "authenticated" USING ("public"."is_member_of"("restaurant_id"));



CREATE POLICY "Members can view their restaurants" ON "public"."restaurants" FOR SELECT TO "authenticated" USING ("public"."is_member_of"("id"));



CREATE POLICY "Members can view usage events" ON "public"."usage_events" FOR SELECT TO "authenticated" USING ("public"."is_member_of"("restaurant_id"));



CREATE POLICY "Members can view vendor integrations" ON "public"."vendor_integrations" FOR SELECT TO "authenticated" USING ("public"."is_member_of"("restaurant_id"));



CREATE POLICY "Members can view vendor item mappings" ON "public"."vendor_item_mappings" FOR SELECT TO "authenticated" USING ("public"."is_member_of"("restaurant_id"));



CREATE POLICY "Members can view weekly sales" ON "public"."weekly_sales" FOR SELECT TO "authenticated" USING (("public"."is_member_of"("restaurant_id") AND "public"."user_can_access_location"("auth"."uid"(), "location_id") AND ("public"."has_restaurant_role_any"("restaurant_id", ARRAY['OWNER'::"public"."app_role"]) OR (EXISTS ( SELECT 1
   FROM "public"."user_location_assignments" "ula"
  WHERE (("ula"."user_id" = "auth"."uid"()) AND ("ula"."location_id" = "weekly_sales"."location_id") AND ("ula"."can_see_food_cost_pct" = true)))))));



CREATE POLICY "Owner can delete settings" ON "public"."restaurant_settings" FOR DELETE TO "authenticated" USING ("public"."has_restaurant_role"("restaurant_id", 'OWNER'::"public"."app_role"));



CREATE POLICY "Owners can delete invitations" ON "public"."invitations" FOR DELETE TO "authenticated" USING ("public"."has_restaurant_role"("restaurant_id", 'OWNER'::"public"."app_role"));



CREATE POLICY "Owners can delete members" ON "public"."restaurant_members" FOR DELETE TO "authenticated" USING ("public"."has_restaurant_role"("restaurant_id", 'OWNER'::"public"."app_role"));



CREATE POLICY "Owners can delete user_invites" ON "public"."user_invites" FOR DELETE TO "authenticated" USING ("public"."has_restaurant_role"("restaurant_id", 'OWNER'::"public"."app_role"));



CREATE POLICY "Owners can insert invitations" ON "public"."invitations" FOR INSERT TO "authenticated" WITH CHECK ("public"."has_restaurant_role"("restaurant_id", 'OWNER'::"public"."app_role"));



CREATE POLICY "Owners can insert members" ON "public"."restaurant_members" FOR INSERT TO "authenticated" WITH CHECK (("public"."has_restaurant_role"("restaurant_id", 'OWNER'::"public"."app_role") OR ("auth"."uid"() = "user_id")));



CREATE POLICY "Owners can insert user_invites" ON "public"."user_invites" FOR INSERT TO "authenticated" WITH CHECK (("public"."has_restaurant_role"("restaurant_id", 'OWNER'::"public"."app_role") AND ("invited_by" = "auth"."uid"()) AND (EXISTS ( SELECT 1
   FROM "public"."locations" "l"
  WHERE (("l"."id" = "user_invites"."location_id") AND ("l"."restaurant_id" = "user_invites"."restaurant_id"))))));



CREATE POLICY "Owners can select user_invites" ON "public"."user_invites" FOR SELECT TO "authenticated" USING ("public"."has_restaurant_role"("restaurant_id", 'OWNER'::"public"."app_role"));



CREATE POLICY "Owners can update invitations" ON "public"."invitations" FOR UPDATE TO "authenticated" USING ("public"."has_restaurant_role"("restaurant_id", 'OWNER'::"public"."app_role")) WITH CHECK ("public"."has_restaurant_role"("restaurant_id", 'OWNER'::"public"."app_role"));



CREATE POLICY "Owners can update members" ON "public"."restaurant_members" FOR UPDATE TO "authenticated" USING ("public"."has_restaurant_role"("restaurant_id", 'OWNER'::"public"."app_role")) WITH CHECK ("public"."has_restaurant_role"("restaurant_id", 'OWNER'::"public"."app_role"));



CREATE POLICY "Owners can update restaurants" ON "public"."restaurants" FOR UPDATE TO "authenticated" USING ("public"."has_restaurant_role"("id", 'OWNER'::"public"."app_role")) WITH CHECK ("public"."has_restaurant_role"("id", 'OWNER'::"public"."app_role"));



CREATE POLICY "Owners can update user_invites" ON "public"."user_invites" FOR UPDATE TO "authenticated" USING ("public"."has_restaurant_role"("restaurant_id", 'OWNER'::"public"."app_role")) WITH CHECK ("public"."has_restaurant_role"("restaurant_id", 'OWNER'::"public"."app_role"));



CREATE POLICY "Staff can update in-progress sessions" ON "public"."inventory_sessions" FOR UPDATE TO "authenticated" USING (("public"."is_member_of"("restaurant_id") AND ("status" = 'IN_PROGRESS'::"public"."session_status") AND ("created_by" = "auth"."uid"()))) WITH CHECK (("status" = ANY (ARRAY['IN_PROGRESS'::"public"."session_status", 'IN_REVIEW'::"public"."session_status"])));



CREATE POLICY "Users can insert own profile" ON "public"."profiles" FOR INSERT TO "authenticated" WITH CHECK (("auth"."uid"() = "id"));



CREATE POLICY "Users can insert own ui state" ON "public"."user_ui_state" FOR INSERT TO "authenticated" WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can update own notifications" ON "public"."notifications" FOR UPDATE TO "authenticated" USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can update own profile" ON "public"."profiles" FOR UPDATE TO "authenticated" USING (("auth"."uid"() = "id")) WITH CHECK (("auth"."uid"() = "id"));



CREATE POLICY "Users can update own ui state" ON "public"."user_ui_state" FOR UPDATE TO "authenticated" USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can view own notifications" ON "public"."notifications" FOR SELECT TO "authenticated" USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can view own profile" ON "public"."profiles" FOR SELECT TO "authenticated" USING (("auth"."uid"() = "id"));



CREATE POLICY "Users can view own ui state" ON "public"."user_ui_state" FOR SELECT TO "authenticated" USING (("auth"."uid"() = "user_id"));



ALTER TABLE "public"."alert_recipients" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."categories" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."custom_list_items" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."custom_lists" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."daily_sales" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."delivery_issues" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."failed_inbound_emails" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."import_runs" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."import_templates" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."inventory_catalog_items" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."inventory_import_files" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."inventory_items" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."inventory_lists" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."inventory_session_item_zones" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."inventory_session_items" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."inventory_sessions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."inventory_settings" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."invitations" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."invoice_ingestions" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "invoice_ingestions delete" ON "public"."invoice_ingestions" FOR DELETE TO "authenticated" USING ("public"."is_member_of"("restaurant_id"));



CREATE POLICY "invoice_ingestions insert" ON "public"."invoice_ingestions" FOR INSERT TO "authenticated" WITH CHECK ("public"."is_member_of"("restaurant_id"));



CREATE POLICY "invoice_ingestions select" ON "public"."invoice_ingestions" FOR SELECT TO "authenticated" USING ("public"."is_member_of"("restaurant_id"));



CREATE POLICY "invoice_ingestions update" ON "public"."invoice_ingestions" FOR UPDATE TO "authenticated" USING ("public"."is_member_of"("restaurant_id")) WITH CHECK ("public"."is_member_of"("restaurant_id"));



ALTER TABLE "public"."invoice_items" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."invoice_line_comparisons" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."invoices" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."list_categories" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."list_category_sets" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."list_item_category_map" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."location_settings" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."locations" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "ls_manager_all" ON "public"."location_settings" TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM ("public"."locations" "l"
     JOIN "public"."restaurant_members" "rm" ON (("rm"."restaurant_id" = "l"."restaurant_id")))
  WHERE (("l"."id" = "location_settings"."location_id") AND ("rm"."user_id" = "auth"."uid"()) AND ("rm"."role" = ANY (ARRAY['OWNER'::"public"."app_role", 'MANAGER'::"public"."app_role"]))))));



CREATE POLICY "ls_member_select" ON "public"."location_settings" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM ("public"."locations" "l"
     JOIN "public"."restaurant_members" "rm" ON (("rm"."restaurant_id" = "l"."restaurant_id")))
  WHERE (("l"."id" = "location_settings"."location_id") AND ("rm"."user_id" = "auth"."uid"())))));



CREATE POLICY "no_direct_select" ON "public"."failed_inbound_emails" FOR SELECT USING (false);



ALTER TABLE "public"."notification_preferences" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."notifications" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."order_items" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."orders" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."par_guide_items" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."par_guides" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."par_items" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."par_settings" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."profiles" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."purchase_history" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."purchase_history_items" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."purchase_order_items" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."purchase_orders" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."reminder_targets" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."reminders" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."restaurant_counters" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."restaurant_members" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."restaurant_settings" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."restaurants" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "service_role_insert" ON "public"."failed_inbound_emails" FOR INSERT WITH CHECK (true);



ALTER TABLE "public"."smart_order_run_items" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."smart_order_runs" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."smart_order_settings" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."stock_movements" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "ula_owner_all" ON "public"."user_location_assignments" TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM ("public"."locations" "l"
     JOIN "public"."restaurant_members" "rm" ON (("rm"."restaurant_id" = "l"."restaurant_id")))
  WHERE (("l"."id" = "user_location_assignments"."location_id") AND ("rm"."user_id" = "auth"."uid"()) AND ("rm"."role" = 'OWNER'::"public"."app_role")))));



CREATE POLICY "ula_user_select" ON "public"."user_location_assignments" FOR SELECT TO "authenticated" USING (("user_id" = "auth"."uid"()));



ALTER TABLE "public"."usage_events" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."user_invites" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."user_location_assignments" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."user_ui_state" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."vendor_integrations" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."vendor_item_mappings" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."waste_log" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "waste_log_delete" ON "public"."waste_log" FOR DELETE TO "authenticated" USING ("public"."has_restaurant_role_any"("restaurant_id", ARRAY['OWNER'::"public"."app_role", 'MANAGER'::"public"."app_role"]));



CREATE POLICY "waste_log_insert" ON "public"."waste_log" FOR INSERT TO "authenticated" WITH CHECK (("public"."is_member_of"("restaurant_id") AND ("logged_by" = "auth"."uid"())));



CREATE POLICY "waste_log_read" ON "public"."waste_log" FOR SELECT TO "authenticated" USING (("public"."is_member_of"("restaurant_id") AND (("location_id" IS NULL) OR "public"."user_can_access_location"("auth"."uid"(), "location_id"))));



ALTER TABLE "public"."weekly_sales" ENABLE ROW LEVEL SECURITY;


GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";



GRANT ALL ON FUNCTION "public"."accept_pending_invitations"() TO "anon";
GRANT ALL ON FUNCTION "public"."accept_pending_invitations"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."accept_pending_invitations"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."accept_user_invites"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."accept_user_invites"() TO "anon";
GRANT ALL ON FUNCTION "public"."accept_user_invites"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."accept_user_invites"() TO "service_role";



GRANT ALL ON FUNCTION "public"."aggregate_daily_to_weekly"() TO "anon";
GRANT ALL ON FUNCTION "public"."aggregate_daily_to_weekly"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."aggregate_daily_to_weekly"() TO "service_role";



GRANT ALL ON FUNCTION "public"."alert_pref_restaurant_id"("pref_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."alert_pref_restaurant_id"("pref_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."alert_pref_restaurant_id"("pref_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."approve_inventory_session_atomic"("p_session_id" "uuid", "p_user_id" "uuid", "p_par_guide_id" "uuid", "p_run_items" "jsonb") TO "anon";
GRANT ALL ON FUNCTION "public"."approve_inventory_session_atomic"("p_session_id" "uuid", "p_user_id" "uuid", "p_par_guide_id" "uuid", "p_run_items" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."approve_inventory_session_atomic"("p_session_id" "uuid", "p_user_id" "uuid", "p_par_guide_id" "uuid", "p_run_items" "jsonb") TO "service_role";



GRANT ALL ON FUNCTION "public"."confirm_invoice_receipt"("p_invoice_id" "uuid", "p_restaurant_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."confirm_invoice_receipt"("p_invoice_id" "uuid", "p_restaurant_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."confirm_invoice_receipt"("p_invoice_id" "uuid", "p_restaurant_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."confirm_invoice_receipt_legacy"("p_invoice_id" "uuid", "p_restaurant_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."confirm_invoice_receipt_legacy"("p_invoice_id" "uuid", "p_restaurant_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."confirm_invoice_receipt_legacy"("p_invoice_id" "uuid", "p_restaurant_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."create_default_notification_preferences"() TO "anon";
GRANT ALL ON FUNCTION "public"."create_default_notification_preferences"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."create_default_notification_preferences"() TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."restaurants" TO "anon";
GRANT ALL ON TABLE "public"."restaurants" TO "authenticated";
GRANT ALL ON TABLE "public"."restaurants" TO "service_role";



GRANT ALL ON FUNCTION "public"."create_restaurant_with_owner"("p_name" "text", "p_is_demo" boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."create_restaurant_with_owner"("p_name" "text", "p_is_demo" boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."create_restaurant_with_owner"("p_name" "text", "p_is_demo" boolean) TO "service_role";



GRANT ALL ON FUNCTION "public"."custom_list_restaurant_id"("cl_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."custom_list_restaurant_id"("cl_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."custom_list_restaurant_id"("cl_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."delete_inventory_list"("list_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."delete_inventory_list"("list_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."delete_inventory_list"("list_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."delete_restaurant_cascade"("p_restaurant_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."delete_restaurant_cascade"("p_restaurant_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."delete_restaurant_cascade"("p_restaurant_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."generate_po_number"("p_restaurant_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."generate_po_number"("p_restaurant_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."generate_po_number"("p_restaurant_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."get_delivery_issue_pos"("p_restaurant_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."get_delivery_issue_pos"("p_restaurant_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_delivery_issue_pos"("p_restaurant_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."get_invoice_stock_audit"("p_invoice_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."get_invoice_stock_audit"("p_invoice_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_invoice_stock_audit"("p_invoice_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."get_location_permissions"("p_uid" "uuid", "p_location_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."get_location_permissions"("p_uid" "uuid", "p_location_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_location_permissions"("p_uid" "uuid", "p_location_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."get_pack_unit_issues"("p_restaurant_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."get_pack_unit_issues"("p_restaurant_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_pack_unit_issues"("p_restaurant_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "anon";
GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "service_role";



GRANT ALL ON FUNCTION "public"."has_restaurant_role"("r_id" "uuid", "_role" "public"."app_role") TO "anon";
GRANT ALL ON FUNCTION "public"."has_restaurant_role"("r_id" "uuid", "_role" "public"."app_role") TO "authenticated";
GRANT ALL ON FUNCTION "public"."has_restaurant_role"("r_id" "uuid", "_role" "public"."app_role") TO "service_role";



GRANT ALL ON FUNCTION "public"."has_restaurant_role_any"("r_id" "uuid", "_roles" "public"."app_role"[]) TO "anon";
GRANT ALL ON FUNCTION "public"."has_restaurant_role_any"("r_id" "uuid", "_roles" "public"."app_role"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."has_restaurant_role_any"("r_id" "uuid", "_roles" "public"."app_role"[]) TO "service_role";



GRANT ALL ON FUNCTION "public"."increment_session_item_version"() TO "anon";
GRANT ALL ON FUNCTION "public"."increment_session_item_version"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."increment_session_item_version"() TO "service_role";



GRANT ALL ON FUNCTION "public"."invitation_restaurant_id"("inv_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."invitation_restaurant_id"("inv_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."invitation_restaurant_id"("inv_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."invoice_restaurant_id"("p_invoice_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."invoice_restaurant_id"("p_invoice_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."invoice_restaurant_id"("p_invoice_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."is_member_of"("r_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."is_member_of"("r_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_member_of"("r_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."list_category_restaurant_id"("lc_list_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."list_category_restaurant_id"("lc_list_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."list_category_restaurant_id"("lc_list_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."list_item_map_restaurant_id"("p_list_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."list_item_map_restaurant_id"("p_list_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."list_item_map_restaurant_id"("p_list_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."normalize_received_qty_to_cases"("p_qty" numeric, "p_unit" "text", "p_pack_size" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."normalize_received_qty_to_cases"("p_qty" numeric, "p_unit" "text", "p_pack_size" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."normalize_received_qty_to_cases"("p_qty" numeric, "p_unit" "text", "p_pack_size" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."notify_delivery_issues"("p_purchase_history_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."notify_delivery_issues"("p_purchase_history_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."notify_delivery_issues"("p_purchase_history_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."notify_pack_conversion_failures"("p_invoice_id" "uuid", "p_failed_items" "jsonb") TO "anon";
GRANT ALL ON FUNCTION "public"."notify_pack_conversion_failures"("p_invoice_id" "uuid", "p_failed_items" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."notify_pack_conversion_failures"("p_invoice_id" "uuid", "p_failed_items" "jsonb") TO "service_role";



GRANT ALL ON FUNCTION "public"."order_restaurant_id"("o_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."order_restaurant_id"("o_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."order_restaurant_id"("o_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."par_guide_restaurant_id"("pg_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."par_guide_restaurant_id"("pg_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."par_guide_restaurant_id"("pg_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."purchase_history_restaurant_id"("ph_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."purchase_history_restaurant_id"("ph_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."purchase_history_restaurant_id"("ph_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."purchase_order_restaurant_id"("p_po_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."purchase_order_restaurant_id"("p_po_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."purchase_order_restaurant_id"("p_po_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."reminder_restaurant_id"("r_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."reminder_restaurant_id"("r_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."reminder_restaurant_id"("r_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."reprocess_invoice_item_stock"("p_invoice_item_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."reprocess_invoice_item_stock"("p_invoice_item_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."reprocess_invoice_item_stock"("p_invoice_item_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."rls_auto_enable"() TO "anon";
GRANT ALL ON FUNCTION "public"."rls_auto_enable"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."rls_auto_enable"() TO "service_role";



GRANT ALL ON FUNCTION "public"."session_item_restaurant_id"("p_session_item_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."session_item_restaurant_id"("p_session_item_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."session_item_restaurant_id"("p_session_item_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."session_restaurant_id"("s_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."session_restaurant_id"("s_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."session_restaurant_id"("s_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."set_sales_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."set_sales_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."set_sales_updated_at"() TO "service_role";



GRANT ALL ON FUNCTION "public"."smart_order_run_restaurant_id"("sr_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."smart_order_run_restaurant_id"("sr_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."smart_order_run_restaurant_id"("sr_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."submit_smart_order"("p_run_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."submit_smart_order"("p_run_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."submit_smart_order"("p_run_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."sync_catalog_price_on_receive"() TO "anon";
GRANT ALL ON FUNCTION "public"."sync_catalog_price_on_receive"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."sync_catalog_price_on_receive"() TO "service_role";



GRANT ALL ON FUNCTION "public"."sync_par_item_category"() TO "anon";
GRANT ALL ON FUNCTION "public"."sync_par_item_category"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."sync_par_item_category"() TO "service_role";



GRANT ALL ON FUNCTION "public"."user_accessible_location_ids"("p_uid" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."user_accessible_location_ids"("p_uid" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."user_accessible_location_ids"("p_uid" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."user_can_access_location"("p_uid" "uuid", "p_location_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."user_can_access_location"("p_uid" "uuid", "p_location_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."user_can_access_location"("p_uid" "uuid", "p_location_id" "uuid") TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."alert_recipients" TO "anon";
GRANT ALL ON TABLE "public"."alert_recipients" TO "authenticated";
GRANT ALL ON TABLE "public"."alert_recipients" TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."categories" TO "anon";
GRANT ALL ON TABLE "public"."categories" TO "authenticated";
GRANT ALL ON TABLE "public"."categories" TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."custom_list_items" TO "anon";
GRANT ALL ON TABLE "public"."custom_list_items" TO "authenticated";
GRANT ALL ON TABLE "public"."custom_list_items" TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."custom_lists" TO "anon";
GRANT ALL ON TABLE "public"."custom_lists" TO "authenticated";
GRANT ALL ON TABLE "public"."custom_lists" TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."daily_sales" TO "anon";
GRANT ALL ON TABLE "public"."daily_sales" TO "authenticated";
GRANT ALL ON TABLE "public"."daily_sales" TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."delivery_issues" TO "anon";
GRANT ALL ON TABLE "public"."delivery_issues" TO "authenticated";
GRANT ALL ON TABLE "public"."delivery_issues" TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."failed_inbound_emails" TO "anon";
GRANT ALL ON TABLE "public"."failed_inbound_emails" TO "authenticated";
GRANT ALL ON TABLE "public"."failed_inbound_emails" TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."import_runs" TO "anon";
GRANT ALL ON TABLE "public"."import_runs" TO "authenticated";
GRANT ALL ON TABLE "public"."import_runs" TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."import_templates" TO "anon";
GRANT ALL ON TABLE "public"."import_templates" TO "authenticated";
GRANT ALL ON TABLE "public"."import_templates" TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."inventory_catalog_items" TO "anon";
GRANT ALL ON TABLE "public"."inventory_catalog_items" TO "authenticated";
GRANT ALL ON TABLE "public"."inventory_catalog_items" TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."inventory_import_files" TO "anon";
GRANT ALL ON TABLE "public"."inventory_import_files" TO "authenticated";
GRANT ALL ON TABLE "public"."inventory_import_files" TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."inventory_items" TO "anon";
GRANT ALL ON TABLE "public"."inventory_items" TO "authenticated";
GRANT ALL ON TABLE "public"."inventory_items" TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."inventory_lists" TO "anon";
GRANT ALL ON TABLE "public"."inventory_lists" TO "authenticated";
GRANT ALL ON TABLE "public"."inventory_lists" TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."inventory_session_item_zones" TO "anon";
GRANT ALL ON TABLE "public"."inventory_session_item_zones" TO "authenticated";
GRANT ALL ON TABLE "public"."inventory_session_item_zones" TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."inventory_session_items" TO "anon";
GRANT ALL ON TABLE "public"."inventory_session_items" TO "authenticated";
GRANT ALL ON TABLE "public"."inventory_session_items" TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."inventory_sessions" TO "anon";
GRANT ALL ON TABLE "public"."inventory_sessions" TO "authenticated";
GRANT ALL ON TABLE "public"."inventory_sessions" TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."inventory_settings" TO "anon";
GRANT ALL ON TABLE "public"."inventory_settings" TO "authenticated";
GRANT ALL ON TABLE "public"."inventory_settings" TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."invitations" TO "anon";
GRANT ALL ON TABLE "public"."invitations" TO "authenticated";
GRANT ALL ON TABLE "public"."invitations" TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."invoice_ingestions" TO "anon";
GRANT ALL ON TABLE "public"."invoice_ingestions" TO "authenticated";
GRANT ALL ON TABLE "public"."invoice_ingestions" TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."invoice_items" TO "anon";
GRANT ALL ON TABLE "public"."invoice_items" TO "authenticated";
GRANT ALL ON TABLE "public"."invoice_items" TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."invoice_line_comparisons" TO "anon";
GRANT ALL ON TABLE "public"."invoice_line_comparisons" TO "authenticated";
GRANT ALL ON TABLE "public"."invoice_line_comparisons" TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."invoices" TO "anon";
GRANT ALL ON TABLE "public"."invoices" TO "authenticated";
GRANT ALL ON TABLE "public"."invoices" TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."list_categories" TO "anon";
GRANT ALL ON TABLE "public"."list_categories" TO "authenticated";
GRANT ALL ON TABLE "public"."list_categories" TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."list_category_sets" TO "anon";
GRANT ALL ON TABLE "public"."list_category_sets" TO "authenticated";
GRANT ALL ON TABLE "public"."list_category_sets" TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."list_item_category_map" TO "anon";
GRANT ALL ON TABLE "public"."list_item_category_map" TO "authenticated";
GRANT ALL ON TABLE "public"."list_item_category_map" TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."location_settings" TO "anon";
GRANT ALL ON TABLE "public"."location_settings" TO "authenticated";
GRANT ALL ON TABLE "public"."location_settings" TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."locations" TO "anon";
GRANT ALL ON TABLE "public"."locations" TO "authenticated";
GRANT ALL ON TABLE "public"."locations" TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."notification_preferences" TO "anon";
GRANT ALL ON TABLE "public"."notification_preferences" TO "authenticated";
GRANT ALL ON TABLE "public"."notification_preferences" TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."notifications" TO "anon";
GRANT ALL ON TABLE "public"."notifications" TO "authenticated";
GRANT ALL ON TABLE "public"."notifications" TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."order_items" TO "anon";
GRANT ALL ON TABLE "public"."order_items" TO "authenticated";
GRANT ALL ON TABLE "public"."order_items" TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."orders" TO "anon";
GRANT ALL ON TABLE "public"."orders" TO "authenticated";
GRANT ALL ON TABLE "public"."orders" TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."par_guide_items" TO "anon";
GRANT ALL ON TABLE "public"."par_guide_items" TO "authenticated";
GRANT ALL ON TABLE "public"."par_guide_items" TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."par_guides" TO "anon";
GRANT ALL ON TABLE "public"."par_guides" TO "authenticated";
GRANT ALL ON TABLE "public"."par_guides" TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."par_items" TO "anon";
GRANT ALL ON TABLE "public"."par_items" TO "authenticated";
GRANT ALL ON TABLE "public"."par_items" TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."par_settings" TO "anon";
GRANT ALL ON TABLE "public"."par_settings" TO "authenticated";
GRANT ALL ON TABLE "public"."par_settings" TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."profiles" TO "anon";
GRANT ALL ON TABLE "public"."profiles" TO "authenticated";
GRANT ALL ON TABLE "public"."profiles" TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."purchase_history" TO "anon";
GRANT ALL ON TABLE "public"."purchase_history" TO "authenticated";
GRANT ALL ON TABLE "public"."purchase_history" TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."purchase_history_items" TO "anon";
GRANT ALL ON TABLE "public"."purchase_history_items" TO "authenticated";
GRANT ALL ON TABLE "public"."purchase_history_items" TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."purchase_order_items" TO "anon";
GRANT ALL ON TABLE "public"."purchase_order_items" TO "authenticated";
GRANT ALL ON TABLE "public"."purchase_order_items" TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."purchase_orders" TO "anon";
GRANT ALL ON TABLE "public"."purchase_orders" TO "authenticated";
GRANT ALL ON TABLE "public"."purchase_orders" TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."reminder_targets" TO "anon";
GRANT ALL ON TABLE "public"."reminder_targets" TO "authenticated";
GRANT ALL ON TABLE "public"."reminder_targets" TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."reminders" TO "anon";
GRANT ALL ON TABLE "public"."reminders" TO "authenticated";
GRANT ALL ON TABLE "public"."reminders" TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."restaurant_counters" TO "anon";
GRANT ALL ON TABLE "public"."restaurant_counters" TO "authenticated";
GRANT ALL ON TABLE "public"."restaurant_counters" TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."restaurant_members" TO "anon";
GRANT ALL ON TABLE "public"."restaurant_members" TO "authenticated";
GRANT ALL ON TABLE "public"."restaurant_members" TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."restaurant_settings" TO "anon";
GRANT ALL ON TABLE "public"."restaurant_settings" TO "authenticated";
GRANT ALL ON TABLE "public"."restaurant_settings" TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."smart_order_run_items" TO "anon";
GRANT ALL ON TABLE "public"."smart_order_run_items" TO "authenticated";
GRANT ALL ON TABLE "public"."smart_order_run_items" TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."smart_order_runs" TO "anon";
GRANT ALL ON TABLE "public"."smart_order_runs" TO "authenticated";
GRANT ALL ON TABLE "public"."smart_order_runs" TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."smart_order_settings" TO "anon";
GRANT ALL ON TABLE "public"."smart_order_settings" TO "authenticated";
GRANT ALL ON TABLE "public"."smart_order_settings" TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."stock_movements" TO "anon";
GRANT ALL ON TABLE "public"."stock_movements" TO "authenticated";
GRANT ALL ON TABLE "public"."stock_movements" TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."usage_events" TO "anon";
GRANT ALL ON TABLE "public"."usage_events" TO "authenticated";
GRANT ALL ON TABLE "public"."usage_events" TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."user_invites" TO "anon";
GRANT ALL ON TABLE "public"."user_invites" TO "authenticated";
GRANT ALL ON TABLE "public"."user_invites" TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."user_location_assignments" TO "anon";
GRANT ALL ON TABLE "public"."user_location_assignments" TO "authenticated";
GRANT ALL ON TABLE "public"."user_location_assignments" TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."user_ui_state" TO "anon";
GRANT ALL ON TABLE "public"."user_ui_state" TO "authenticated";
GRANT ALL ON TABLE "public"."user_ui_state" TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."vendor_integrations" TO "anon";
GRANT ALL ON TABLE "public"."vendor_integrations" TO "authenticated";
GRANT ALL ON TABLE "public"."vendor_integrations" TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."vendor_item_mappings" TO "anon";
GRANT ALL ON TABLE "public"."vendor_item_mappings" TO "authenticated";
GRANT ALL ON TABLE "public"."vendor_item_mappings" TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."waste_log" TO "anon";
GRANT ALL ON TABLE "public"."waste_log" TO "authenticated";
GRANT ALL ON TABLE "public"."waste_log" TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."weekly_sales" TO "anon";
GRANT ALL ON TABLE "public"."weekly_sales" TO "authenticated";
GRANT ALL ON TABLE "public"."weekly_sales" TO "service_role";



ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";







