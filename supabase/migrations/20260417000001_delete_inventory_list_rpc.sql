-- Atomic cascade delete for an inventory list.
-- Runs entirely inside a single transaction so partial failures leave no orphaned rows.
create or replace function delete_inventory_list(list_id uuid)
returns void
language plpgsql
security definer
as $$
declare
  session_ids  uuid[];
  run_ids      uuid[];
  po_ids       uuid[];
  invoice_ids  uuid[];
  purchase_ids uuid[];
  guide_ids    uuid[];
begin
  -- Category metadata
  delete from list_item_category_map where list_id = delete_inventory_list.list_id;
  delete from list_categories        where list_id = delete_inventory_list.list_id;
  delete from list_category_sets     where list_id = delete_inventory_list.list_id;

  -- Catalog / import artefacts
  delete from inventory_catalog_items  where inventory_list_id = delete_inventory_list.list_id;
  delete from inventory_import_files   where inventory_list_id = delete_inventory_list.list_id;
  delete from import_runs              where inventory_list_id = delete_inventory_list.list_id;
  delete from import_templates         where inventory_list_id = delete_inventory_list.list_id;

  -- Sessions and their children
  select array_agg(id) into session_ids
    from inventory_sessions where inventory_list_id = delete_inventory_list.list_id;

  if session_ids is not null then
    delete from inventory_session_items where session_id = any(session_ids);

    select array_agg(id) into run_ids
      from smart_order_runs where session_id = any(session_ids);

    if run_ids is not null then
      delete from smart_order_run_items where run_id = any(run_ids);

      select array_agg(id) into po_ids
        from purchase_orders where smart_order_run_id = any(run_ids);
      if po_ids is not null then
        select array_agg(id) into invoice_ids
          from invoices where purchase_order_id = any(po_ids);
        if invoice_ids is not null then
          delete from invoice_items where invoice_id = any(invoice_ids);
          delete from invoices       where id = any(invoice_ids);
        end if;
        delete from purchase_order_items where purchase_order_id = any(po_ids);
        delete from purchase_orders       where id = any(po_ids);
      end if;

      select array_agg(id) into purchase_ids
        from purchase_history where smart_order_run_id = any(run_ids);
      if purchase_ids is not null then
        delete from purchase_history_items where purchase_history_id = any(purchase_ids);
        delete from purchase_history        where id = any(purchase_ids);
      end if;

      delete from smart_order_runs where id = any(run_ids);
    end if;

    delete from inventory_sessions where inventory_list_id = delete_inventory_list.list_id;
  end if;

  -- List-level smart order runs (not linked to a session)
  select array_agg(id) into run_ids
    from smart_order_runs where inventory_list_id = delete_inventory_list.list_id;

  if run_ids is not null then
    delete from smart_order_run_items where run_id = any(run_ids);

    select array_agg(id) into po_ids
      from purchase_orders where smart_order_run_id = any(run_ids);
    if po_ids is not null then
      select array_agg(id) into invoice_ids
        from invoices where purchase_order_id = any(po_ids);
      if invoice_ids is not null then
        delete from invoice_items where invoice_id = any(invoice_ids);
        delete from invoices       where id = any(invoice_ids);
      end if;
      delete from purchase_order_items where purchase_order_id = any(po_ids);
      delete from purchase_orders       where id = any(po_ids);
    end if;

    select array_agg(id) into purchase_ids
      from purchase_history where smart_order_run_id = any(run_ids);
    if purchase_ids is not null then
      delete from purchase_history_items where purchase_history_id = any(purchase_ids);
      delete from purchase_history        where id = any(purchase_ids);
    end if;

    delete from smart_order_runs where id = any(run_ids);
  end if;

  -- Purchase orders directly linked to the list
  select array_agg(id) into po_ids
    from purchase_orders where inventory_list_id = delete_inventory_list.list_id;
  if po_ids is not null then
    select array_agg(id) into invoice_ids
      from invoices where purchase_order_id = any(po_ids);
    if invoice_ids is not null then
      delete from invoice_items where invoice_id = any(invoice_ids);
      delete from invoices       where id = any(invoice_ids);
    end if;
    delete from purchase_order_items where purchase_order_id = any(po_ids);
    delete from purchase_orders       where id = any(po_ids);
  end if;

  -- Purchase history directly linked to the list
  select array_agg(id) into purchase_ids
    from purchase_history where inventory_list_id = delete_inventory_list.list_id;
  if purchase_ids is not null then
    delete from purchase_history_items where purchase_history_id = any(purchase_ids);
    delete from purchase_history        where id = any(purchase_ids);
  end if;

  -- PAR guides and items
  select array_agg(id) into guide_ids
    from par_guides where inventory_list_id = delete_inventory_list.list_id;
  if guide_ids is not null then
    delete from par_guide_items where par_guide_id = any(guide_ids);
    delete from par_guides       where id = any(guide_ids);
  end if;

  -- Finally delete the list itself
  delete from inventory_lists where id = delete_inventory_list.list_id;
end;
$$;

-- Grant execute to authenticated users (RLS on the underlying tables still applies)
grant execute on function delete_inventory_list(uuid) to authenticated;
