-- Corrected migration aligned to live Supabase RPC signatures.
-- Goal: enable client-generated UUIDs while remaining backward compatible.
--
-- Live signatures this file targets:
--   create_list(p_name text, p_label text)
--   bulk_add_list_items(p_list_id uuid, p_category smallint, p_lines text[])
--   import_list(p_name text, p_label text, p_category_names text, p_rows jsonb, p_has_targets boolean)
--   duplicate_list(p_source_list_id uuid, p_new_name text)
--   duplicate_list(p_source_list_id uuid, p_new_name text, p_label text)
--
-- Notes:
-- - This keeps existing behavior and adds optional id params with defaults.
-- - Existing callers keep working unchanged.

begin;

-- ---------------------------------------------------------------------------
-- 1) create_list: add optional p_id
-- ---------------------------------------------------------------------------
drop function if exists public.create_list(text, text);
drop function if exists public.create_list(text, text, uuid);

create or replace function public.create_list(
  p_name text,
  p_label text default '',
  p_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_trimmed_name text := btrim(coalesce(p_name, ''));
  v_new_list public.lists%rowtype;
begin
  if v_user_id is null then
    raise exception 'Not authenticated';
  end if;

  if v_trimmed_name = '' then
    raise exception 'List name is required';
  end if;

  insert into public.lists (id, name, owner_id)
  values (coalesce(p_id, gen_random_uuid()), v_trimmed_name, v_user_id)
  returning * into v_new_list;

  update public.list_users
  set sort_order = coalesce(sort_order, 0) + 1
  where user_id = v_user_id
    and list_id != v_new_list.id;

  update public.list_users
  set sort_order = 0,
      label = coalesce(nullif(btrim(p_label), ''), '')
  where list_id = v_new_list.id
    and user_id = v_user_id;

  return to_jsonb(v_new_list);
end;
$$;

grant execute on function public.create_list(text, text, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 2) bulk_add_list_items: add optional positional p_item_ids
-- ---------------------------------------------------------------------------
drop function if exists public.bulk_add_list_items(uuid, smallint, text[]);
drop function if exists public.bulk_add_list_items(uuid, smallint, text[], uuid[]);

create or replace function public.bulk_add_list_items(
  p_list_id uuid,
  p_category smallint,
  p_lines text[],
  p_item_ids uuid[] default null
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_target_id uuid;
  v_cat smallint;
  v_cnt int;
  v_in_len int;
begin
  if v_user_id is null then
    raise exception 'Not authenticated';
  end if;

  if not exists (
    select 1 from public.list_users
    where list_id = p_list_id
      and user_id = v_user_id
      and role in ('owner', 'editor')
  ) then
    raise exception 'Not authorized';
  end if;

  if p_lines is null then
    raise exception 'p_lines is required';
  end if;

  v_in_len := coalesce(cardinality(p_lines), 0);
  if v_in_len > 500 then
    raise exception 'Too many lines (max 500)';
  end if;

  if p_item_ids is not null and cardinality(p_item_ids) is distinct from v_in_len then
    raise exception 'p_item_ids length must match p_lines length';
  end if;

  v_cat := least(greatest(coalesce(p_category, 1)::integer, 1), 6)::smallint;

  select id into v_target_id
  from public.members
  where list_id = p_list_id
    and is_target = true
  limit 1;

  with raw as (
    select trim(l) as t, ord
    from unnest(p_lines) with ordinality as x(l, ord)
  ),
  filtered as (
    select
      left(t, 2000) as text,
      row_number() over (order by ord)::int as rn
    from raw
    where length(trim(t)) > 0
  ),
  mx as (
    select coalesce(max(sort_order), -1) as m
    from public.items
    where list_id = p_list_id
  ),
  ins as (
    insert into public.items (id, list_id, text, sort_order, category, archived, archived_at)
    select
      coalesce(
        case when p_item_ids is null then null else p_item_ids[f.rn] end,
        gen_random_uuid()
      ),
      p_list_id,
      f.text,
      mx.m + f.rn,
      v_cat,
      false,
      null
    from filtered f
    cross join mx
    returning id
  ),
  ims as (
    insert into public.item_member_state (item_id, member_id, quantity, done, assigned)
    select i.id, v_target_id, 1, false, true
    from ins i
    where v_target_id is not null
    returning item_id
  )
  select count(*)::int into v_cnt
  from ins
  cross join (select coalesce((select count(*) from ims), 0) as _force_ims) _x;

  return coalesce(v_cnt, 0);
end;
$$;

revoke all on function public.bulk_add_list_items(uuid, smallint, text[], uuid[]) from public;
grant execute on function public.bulk_add_list_items(uuid, smallint, text[], uuid[]) to authenticated;

-- ---------------------------------------------------------------------------
-- 3) import_list: preserve p_has_targets and add optional p_id/p_item_ids
-- ---------------------------------------------------------------------------
drop function if exists public.import_list(text, text, text, jsonb, boolean);
drop function if exists public.import_list(text, text, text, jsonb, boolean, uuid, uuid[]);

create or replace function public.import_list(
  p_name text,
  p_label text default '',
  p_category_names text default null,
  p_rows jsonb default '[]'::jsonb,
  p_has_targets boolean default false,
  p_id uuid default null,
  p_item_ids uuid[] default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_trimmed_name text := btrim(coalesce(p_name, ''));
  v_new_list public.lists%rowtype;
  v_len int;
  v_target_member_id uuid;
begin
  if v_user_id is null then
    raise exception 'Not authenticated';
  end if;

  if v_trimmed_name = '' then
    raise exception 'List name is required';
  end if;

  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    raise exception 'p_rows must be a JSON array';
  end if;

  v_len := jsonb_array_length(p_rows);
  if v_len > 2000 then
    raise exception 'Too many rows (max 2000)';
  end if;

  if p_item_ids is not null and cardinality(p_item_ids) is distinct from v_len then
    raise exception 'p_item_ids length must match p_rows length';
  end if;

  insert into public.lists (id, name, owner_id)
  values (coalesce(p_id, gen_random_uuid()), v_trimmed_name, v_user_id)
  returning * into v_new_list;

  if p_category_names is not null and p_category_names <> '' and p_category_names <> '{}' then
    update public.lists
    set category_names = p_category_names
    where id = v_new_list.id;
    v_new_list.category_names := p_category_names;
  end if;

  -- Create Qty/target member when requested (mirrors existing behavior expectation).
  if coalesce(p_has_targets, false) then
    insert into public.members (list_id, name, created_by, sort_order, is_public, is_target)
    values (v_new_list.id, 'Qty', v_user_id, 0, false, true)
    returning id into v_target_member_id;
  end if;

  if v_len > 0 then
    insert into public.items (id, list_id, text, sort_order, category, comment)
    select
      coalesce(
        case when p_item_ids is null then null else p_item_ids[r.idx::int] end,
        gen_random_uuid()
      ),
      v_new_list.id,
      left(trim(r.elem->>'text'), 2000),
      coalesce((r.elem->>'sort_order')::integer, 0),
      least(greatest(coalesce((r.elem->>'category')::integer, 1), 1), 6)::smallint,
      nullif(left(trim(r.elem->>'comment'), 5000), '')
    from jsonb_array_elements(p_rows) with ordinality as r(elem, idx)
    where length(trim(r.elem->>'text')) > 0;

    if v_target_member_id is not null then
      insert into public.item_member_state (item_id, member_id, quantity, done, assigned)
      select i.id, v_target_member_id, 1, false, true
      from public.items i
      where i.list_id = v_new_list.id;
    end if;
  end if;

  update public.list_users
  set sort_order = coalesce(sort_order, 0) + 1
  where user_id = v_user_id
    and list_id != v_new_list.id;

  update public.list_users
  set sort_order = 0,
      label = coalesce(nullif(btrim(p_label), ''), ''),
      item_text_width = 'auto'
  where list_id = v_new_list.id
    and user_id = v_user_id;

  return to_jsonb(v_new_list);
end;
$$;

grant execute on function public.import_list(text, text, text, jsonb, boolean, uuid, uuid[]) to authenticated;

-- ---------------------------------------------------------------------------
-- 4) duplicate_list: replace both overloads with one backward-compatible one
-- ---------------------------------------------------------------------------
drop function if exists public.duplicate_list(uuid, text);
drop function if exists public.duplicate_list(uuid, text, text);
drop function if exists public.duplicate_list(uuid, text, text, uuid, uuid[], uuid);

create or replace function public.duplicate_list(
  p_source_list_id uuid,
  p_new_name text,
  p_label text default '',
  p_id uuid default null,
  p_item_ids uuid[] default null,
  p_target_member_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_trimmed_name text := btrim(coalesce(p_new_name, ''));
  v_new_list public.lists%rowtype;
  v_result jsonb;
  v_source_target_id uuid;
  v_new_target_id uuid;
  v_item_count int;
begin
  if v_user_id is null then
    raise exception 'Not authenticated';
  end if;

  if v_trimmed_name = '' then
    raise exception 'List name is required';
  end if;

  if not exists (
    select 1
    from public.list_users
    where list_id = p_source_list_id
      and user_id = v_user_id
  ) then
    raise exception 'Access denied';
  end if;

  select count(*)::int into v_item_count
  from public.items
  where list_id = p_source_list_id;

  if p_item_ids is not null and cardinality(p_item_ids) is distinct from v_item_count then
    raise exception 'p_item_ids length must match source item count';
  end if;

  insert into public.lists (id, name, owner_id)
  values (coalesce(p_id, gen_random_uuid()), v_trimmed_name, v_user_id)
  returning * into v_new_list;

  insert into public.items (id, list_id, text, comment, archived, archived_at, sort_order, category)
  select
    coalesce(
      case when p_item_ids is null then null else p_item_ids[src.rn] end,
      gen_random_uuid()
    ),
    v_new_list.id,
    src.text,
    src.comment,
    src.archived,
    src.archived_at,
    src.sort_order,
    src.category
  from (
    select
      i.*,
      row_number() over (order by i.archived, i.sort_order nulls last, i.created_at, i.id)::int as rn
    from public.items i
    where i.list_id = p_source_list_id
  ) src
  order by src.rn;

  update public.list_users
  set sort_order = coalesce(sort_order, 0) + 1
  where user_id = v_user_id
    and list_id != v_new_list.id;

  update public.list_users
  set sort_order = 0,
      label = coalesce(nullif(btrim(p_label), ''), ''),
      item_text_width = 'auto'
  where list_id = v_new_list.id
    and user_id = v_user_id;

  select m.id
    into v_source_target_id
  from public.members m
  where m.list_id = p_source_list_id
    and m.is_target = true
  limit 1;

  if v_source_target_id is not null then
    insert into public.members (id, list_id, name, created_by, sort_order, is_public, is_target)
    select
      coalesce(p_target_member_id, gen_random_uuid()),
      v_new_list.id,
      m.name,
      v_user_id,
      0,
      false,
      true
    from public.members m
    where m.id = v_source_target_id
    returning id into v_new_target_id;

    insert into public.item_member_state (item_id, member_id, quantity, done, assigned, updated_at)
    select
      map.new_item_id,
      v_new_target_id,
      ims.quantity,
      ims.done,
      ims.assigned,
      now()
    from (
      select o.id as old_item_id, n.id as new_item_id
      from (
        select
          id,
          row_number() over (order by archived, sort_order nulls last, created_at, id) as rn
        from public.items
        where list_id = p_source_list_id
      ) o
      join (
        select
          id,
          row_number() over (order by archived, sort_order nulls last, created_at, id) as rn
        from public.items
        where list_id = v_new_list.id
      ) n using (rn)
    ) map
    join public.item_member_state ims
      on ims.item_id = map.old_item_id
     and ims.member_id = v_source_target_id;
  end if;

  v_result := (select get_list_data(v_new_list.id))::jsonb;
  return v_result;
end;
$$;

grant execute on function public.duplicate_list(uuid, text, text, uuid, uuid[], uuid) to authenticated;

commit;
