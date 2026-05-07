-- Atomic cascade delete for an inventory list.
-- Runs entirely inside a single transaction so partial failures leave no orphaned rows.
-- v_list_id captures $1 to eliminate every ambiguity between the 'list_id' parameter
-- and same-named columns in list_item_category_map / list_categories / list_category_sets.
create or replace function public.delete_inventory_list(list_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
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

  -- Purchase orders directly linked to the list
  select array_agg(purchase_orders.id) into po_ids
    from purchase_orders
   where purchase_orders.inventory_list_id = v_list_id;

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

  -- Purchase history directly linked to the list
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
$$;

-- Grant execute to authenticated users (RLS on the underlying tables still applies)
grant execute on function public.delete_inventory_list(uuid) to authenticated;
