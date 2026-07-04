-- Harden delete_inventory_list.
--
-- This function is SECURITY DEFINER and cascade-deletes an inventory list's
-- sessions, smart-order runs, purchase orders, invoices, purchase history, and
-- PAR guides. It previously had NO authorization check, and EXECUTE was granted
-- to both `anon` and `authenticated` — meaning any caller holding the public
-- anon key could destroy another restaurant's data by passing a list UUID.
--
-- Fix: require OWNER/MANAGER on the list's restaurant (matching the existing
-- `inventory_lists` DELETE RLS policy), and revoke anon EXECUTE. The cascade
-- body below is unchanged from the prior definition.

CREATE OR REPLACE FUNCTION public.delete_inventory_list(list_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_list_id        uuid := $1;
  v_restaurant_id  uuid;
  session_ids      uuid[];
  run_ids          uuid[];
  po_ids           uuid[];
  invoice_ids      uuid[];
  purchase_ids     uuid[];
  guide_ids        uuid[];
begin
  -- ── Authorization guard (added) ─────────────────────────────────────────────
  select inventory_lists.restaurant_id into v_restaurant_id
    from inventory_lists
   where inventory_lists.id = v_list_id;

  if v_restaurant_id is null then
    raise exception 'Inventory list not found';
  end if;

  -- Matches the inventory_lists DELETE policy (Manager+). auth.uid() is NULL for
  -- anon, so has_restaurant_role_any returns false and the call is rejected.
  if not public.has_restaurant_role_any(
       v_restaurant_id, array['OWNER','MANAGER']::public.app_role[]) then
    raise exception 'Only a manager or owner can delete an inventory list';
  end if;

  -- ── Cascade body (unchanged) ────────────────────────────────────────────────
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
$function$;

-- Defense in depth: this destructive RPC must never be anon-callable.
REVOKE ALL ON FUNCTION public.delete_inventory_list(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_inventory_list(uuid) TO authenticated;
