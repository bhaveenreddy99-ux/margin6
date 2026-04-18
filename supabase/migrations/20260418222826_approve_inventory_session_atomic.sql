-- Atomic initial approval path for inventory sessions.
-- The inventory math stays in TypeScript; this function only commits the
-- initial smart-order run + run items + session approval in one transaction.

create or replace function public.approve_inventory_session_atomic(
  p_session_id uuid,
  p_user_id uuid,
  p_par_guide_id uuid default null,
  p_run_items jsonb default '[]'::jsonb
)
returns table(
  run_id uuid,
  location_id uuid,
  catalog_links_stripped boolean
)
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_session                 public.inventory_sessions%rowtype;
  v_run_id                  uuid;
  v_existing_run_id         uuid;
  v_catalog_links_stripped  boolean := false;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  if auth.uid() <> p_user_id then
    raise exception 'Approved-by user mismatch';
  end if;

  if jsonb_typeof(coalesce(p_run_items, '[]'::jsonb)) <> 'array' then
    raise exception 'Approval run items must be a JSON array';
  end if;

  if jsonb_array_length(coalesce(p_run_items, '[]'::jsonb)) = 0 then
    raise exception 'Approval run items are required.';
  end if;

  select *
  into v_session
  from public.inventory_sessions
  where id = p_session_id
  for update;

  if not found then
    raise exception 'Session not found.';
  end if;

  if not public.has_restaurant_role_any(
    v_session.restaurant_id,
    array['OWNER'::public.app_role, 'MANAGER'::public.app_role]
  ) then
    raise exception 'Inventory approval requires manager or owner access.';
  end if;

  if v_session.status <> 'IN_REVIEW' then
    if v_session.status = 'APPROVED' then
      raise exception 'Session is already approved.';
    end if;

    raise exception 'Only sessions in review can be approved.';
  end if;

  select sor.id
  into v_existing_run_id
  from public.smart_order_runs as sor
  where sor.session_id = p_session_id
  limit 1;

  if v_existing_run_id is not null then
    raise exception 'Session already has a downstream smart order run. Approval retry is blocked until that inconsistency is resolved.';
  end if;

  insert into public.smart_order_runs (
    restaurant_id,
    session_id,
    inventory_list_id,
    location_id,
    par_guide_id,
    created_by
  )
  values (
    v_session.restaurant_id,
    v_session.id,
    v_session.inventory_list_id,
    v_session.location_id,
    p_par_guide_id,
    p_user_id
  )
  returning id into v_run_id;

  with raw_items as (
    select
      item_name,
      suggested_order,
      risk,
      current_stock,
      par_level,
      unit_cost,
      pack_size,
      brand_name,
      nullif(btrim(catalog_item_id), '') as raw_catalog_item_id
    from jsonb_to_recordset(p_run_items) as item(
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
  candidate_items as (
    select
      item_name,
      suggested_order,
      risk,
      current_stock,
      par_level,
      unit_cost,
      pack_size,
      brand_name,
      raw_catalog_item_id,
      case
        when raw_catalog_item_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        then raw_catalog_item_id::uuid
        else null
      end as parsed_catalog_item_id
    from raw_items
  ),
  normalized_items as (
    select
      item_name,
      coalesce(suggested_order, 0) as suggested_order,
      coalesce(nullif(risk, ''), 'GREEN') as risk,
      coalesce(current_stock, 0) as current_stock,
      coalesce(par_level, 0) as par_level,
      unit_cost,
      pack_size,
      brand_name,
      case
        when parsed_catalog_item_id is not null
          and exists (
            select 1
            from public.inventory_catalog_items as ci
            where ci.id = parsed_catalog_item_id
              and ci.restaurant_id = v_session.restaurant_id
          )
        then parsed_catalog_item_id
        else null
      end as catalog_item_id,
      raw_catalog_item_id is not null
        and not (
          parsed_catalog_item_id is not null
          and exists (
            select 1
            from public.inventory_catalog_items as ci
            where ci.id = parsed_catalog_item_id
              and ci.restaurant_id = v_session.restaurant_id
          )
        ) as catalog_link_stripped
    from candidate_items
  )
  select coalesce(bool_or(catalog_link_stripped), false)
  into v_catalog_links_stripped
  from normalized_items;

  insert into public.smart_order_run_items (
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
  select
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
  from (
    with raw_items as (
      select
        item_name,
        suggested_order,
        risk,
        current_stock,
        par_level,
        unit_cost,
        pack_size,
        brand_name,
        nullif(btrim(catalog_item_id), '') as raw_catalog_item_id
      from jsonb_to_recordset(p_run_items) as item(
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
    candidate_items as (
      select
        item_name,
        suggested_order,
        risk,
        current_stock,
        par_level,
        unit_cost,
        pack_size,
        brand_name,
        raw_catalog_item_id,
        case
          when raw_catalog_item_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
          then raw_catalog_item_id::uuid
          else null
        end as parsed_catalog_item_id
      from raw_items
    )
    select
      item_name,
      coalesce(suggested_order, 0) as suggested_order,
      coalesce(nullif(risk, ''), 'GREEN') as risk,
      coalesce(current_stock, 0) as current_stock,
      coalesce(par_level, 0) as par_level,
      unit_cost,
      pack_size,
      brand_name,
      case
        when parsed_catalog_item_id is not null
          and exists (
            select 1
            from public.inventory_catalog_items as ci
            where ci.id = parsed_catalog_item_id
              and ci.restaurant_id = v_session.restaurant_id
          )
        then parsed_catalog_item_id
        else null
      end as catalog_item_id
    from candidate_items
  ) as ni;

  update public.inventory_sessions
  set
    status = 'APPROVED',
    approved_at = now(),
    approved_by = p_user_id,
    updated_at = now()
  where id = v_session.id
    and status = 'IN_REVIEW';

  if not found then
    raise exception 'Session approval failed due to concurrent state change.';
  end if;

  return query
  select
    v_run_id,
    v_session.location_id,
    v_catalog_links_stripped;
end;
$$;

grant execute on function public.approve_inventory_session_atomic(uuid, uuid, uuid, jsonb)
to authenticated;

notify pgrst, 'reload schema';
